// Daily consumption statistics (M8).
//
// Tracks per-day, per-(upstream key + real model) aggregated usage. Updated
// incrementally on every successful request. Retained permanently for
// billing and capacity planning.

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { generateId } from '@modelharbor/shared';
import {
  type Db,
  type ModelConsumptionStatInsert,
  type ModelConsumptionStatRow,
  modelConsumptionStats,
} from '../db/index.js';

export interface ConsumptionDelta {
  requestCount: number;
  successCount: number;
  errorCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
}

function todayDateString(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Atomically update the consumption stats for a given upstream key + model + day.
// Best-effort: never throws.
export async function upsertConsumptionStats(
  db: Db,
  args: {
    upstreamKeyId: string;
    realModelName: string;
    delta: ConsumptionDelta;
    now: Date;
  },
): Promise<void> {
  try {
    const dayDate = todayDateString(args.now);
    const existing = await db
      .select()
      .from(modelConsumptionStats)
      .where(
        and(
          eq(modelConsumptionStats.upstreamKeyId, args.upstreamKeyId),
          eq(modelConsumptionStats.realModelName, args.realModelName),
          eq(modelConsumptionStats.dayDate, dayDate),
        ),
      )
      .get();

    if (existing) {
      // Compute new average latency: weighted average of old and new
      const totalRequests = existing.requestCount + args.delta.requestCount;
      const newAvgLatency =
        totalRequests > 0
          ? Math.round(
              (existing.avgLatencyMs * existing.requestCount + args.delta.latencyMs * args.delta.requestCount) /
                totalRequests,
            )
          : existing.avgLatencyMs;

      await db
        .update(modelConsumptionStats)
        .set({
          requestCount: existing.requestCount + args.delta.requestCount,
          successCount: existing.successCount + args.delta.successCount,
          errorCount: existing.errorCount + args.delta.errorCount,
          cacheReadTokens: existing.cacheReadTokens + args.delta.cacheReadTokens,
          cacheWriteTokens: existing.cacheWriteTokens + args.delta.cacheWriteTokens,
          inputTokens: existing.inputTokens + args.delta.inputTokens,
          outputTokens: existing.outputTokens + args.delta.outputTokens,
          totalTokens: existing.totalTokens + args.delta.totalTokens,
          avgLatencyMs: newAvgLatency,
          updatedAt: args.now,
        })
        .where(eq(modelConsumptionStats.id, existing.id));
      return;
    }

    const row: ModelConsumptionStatInsert = {
      id: generateId('consumptionStat'),
      upstreamKeyId: args.upstreamKeyId,
      realModelName: args.realModelName,
      dayDate,
      requestCount: args.delta.requestCount,
      successCount: args.delta.successCount,
      errorCount: args.delta.errorCount,
      cacheReadTokens: args.delta.cacheReadTokens,
      cacheWriteTokens: args.delta.cacheWriteTokens,
      inputTokens: args.delta.inputTokens,
      outputTokens: args.delta.outputTokens,
      totalTokens: args.delta.totalTokens,
      avgLatencyMs: args.delta.latencyMs,
      updatedAt: args.now,
    };
    await db.insert(modelConsumptionStats).values(row);
  } catch {
    /* best-effort: never break the request */
  }
}

export interface ConsumptionQueryResult {
  upstreamKeyId: string;
  realModelName: string;
  dayDate: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  updatedAt: Date;
}

export async function getConsumptionStats(
  db: Db,
  args: { upstreamKeyId?: string; dayDate?: string; limit?: number; since?: Date; until?: Date },
): Promise<ConsumptionQueryResult[]> {
  const limit = Math.min(500, Math.max(1, args.limit ?? 100));
  let query = db.select().from(modelConsumptionStats).$dynamic();

  const conditions = [];
  if (args.upstreamKeyId) {
    conditions.push(eq(modelConsumptionStats.upstreamKeyId, args.upstreamKeyId));
  }
  if (args.dayDate) {
    conditions.push(eq(modelConsumptionStats.dayDate, args.dayDate));
  }
  if (args.since) {
    conditions.push(gte(modelConsumptionStats.dayDate, todayDateString(args.since)));
  }
  if (args.until) {
    conditions.push(lte(modelConsumptionStats.dayDate, todayDateString(args.until)));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query.orderBy(sql`${modelConsumptionStats.dayDate} DESC`).limit(limit).all();
  return rows.map((r) => ({
    upstreamKeyId: r.upstreamKeyId,
    realModelName: r.realModelName,
    dayDate: r.dayDate,
    requestCount: r.requestCount,
    successCount: r.successCount,
    errorCount: r.errorCount,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    avgLatencyMs: r.avgLatencyMs,
    updatedAt: r.updatedAt,
  }));
}

export interface DailyConsumptionSummary {
  dayDate: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTotalTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
}

export async function getDailyConsumptionSummary(
  db: Db,
  args: { since?: Date; until?: Date; limit?: number },
): Promise<DailyConsumptionSummary[]> {
  const limit = Math.min(500, Math.max(1, args.limit ?? 30));
  let query = db
    .select({
      dayDate: modelConsumptionStats.dayDate,
      totalRequests: sql<number>`SUM(${modelConsumptionStats.requestCount})`,
      totalInputTokens: sql<number>`SUM(${modelConsumptionStats.inputTokens})`,
      totalOutputTokens: sql<number>`SUM(${modelConsumptionStats.outputTokens})`,
      totalTotalTokens: sql<number>`SUM(${modelConsumptionStats.totalTokens})`,
      totalCacheReadTokens: sql<number>`SUM(${modelConsumptionStats.cacheReadTokens})`,
      totalCacheWriteTokens: sql<number>`SUM(${modelConsumptionStats.cacheWriteTokens})`,
    })
    .from(modelConsumptionStats)
    .groupBy(modelConsumptionStats.dayDate)
    .orderBy(sql`${modelConsumptionStats.dayDate} DESC`)
    .limit(limit)
    .$dynamic();

  const conditions = [];
  if (args.since) {
    conditions.push(gte(modelConsumptionStats.dayDate, todayDateString(args.since)));
  }
  if (args.until) {
    conditions.push(lte(modelConsumptionStats.dayDate, todayDateString(args.until)));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query.all();
  return rows.map((r) => ({
    dayDate: r.dayDate,
    totalRequests: Number(r.totalRequests),
    totalInputTokens: Number(r.totalInputTokens),
    totalOutputTokens: Number(r.totalOutputTokens),
    totalTotalTokens: Number(r.totalTotalTokens),
    totalCacheReadTokens: Number(r.totalCacheReadTokens),
    totalCacheWriteTokens: Number(r.totalCacheWriteTokens),
  }));
}
