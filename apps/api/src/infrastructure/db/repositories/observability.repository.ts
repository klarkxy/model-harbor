import { eq, desc, lt, and, gte, sql, count, sum } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  usageRecords,
  requestTraceLogs,
  debugContentLogs,
  auditEvents,
  dailyConsumptionStats,
  apps,
  consumerKeys,
  upstreamKeys,
  type UsageRecordInsert,
  type UsageRecordRow,
  type RequestTraceLogInsert,
  type RequestTraceLogRow,
  type DebugContentLogInsert,
  type DebugContentLogRow,
  type AuditEventInsert,
  type AuditEventRow,
  type DailyConsumptionStatInsert,
  type DailyConsumptionStatRow,
} from '../schema.js';

export class ObservabilityRepository {
  constructor(private readonly db: Db) {}

  // --- Usage records ---

  async insertUsageRecord(
    data: Omit<UsageRecordInsert, 'id' | 'createdAt'>,
  ): Promise<UsageRecordRow> {
    const row: UsageRecordInsert = {
      id: generateId('usageRecord'),
      ...data,
      createdAt: new Date(),
    };
    await this.db.insert(usageRecords).values(row);
    return row as UsageRecordRow;
  }

  async listRecentUsageRecords(limit = 100): Promise<UsageRecordRow[]> {
    return this.db.select().from(usageRecords).orderBy(desc(usageRecords.createdAt)).limit(limit);
  }

  async getUsageSummary(since: Date): Promise<{
    requestCount: number;
    successCount: number;
    errorCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    stickyHitCount: number;
  }> {
    const [row] = await this.db
      .select({
        requestCount: count(),
        successCount: sql<number>`sum(case when ${usageRecords.status} = 'success' then 1 else 0 end)`,
        errorCount: sql<number>`sum(case when ${usageRecords.status} != 'success' then 1 else 0 end)`,
        inputTokens: sum(usageRecords.inputTokens),
        outputTokens: sum(usageRecords.outputTokens),
        totalTokens: sum(usageRecords.totalTokens),
        stickyHitCount: sql<number>`sum(case when ${usageRecords.stickyHit} = 1 then 1 else 0 end)`,
      })
      .from(usageRecords)
      .where(gte(usageRecords.createdAt, since));
    return {
      requestCount: row?.requestCount ?? 0,
      successCount: row?.successCount ?? 0,
      errorCount: row?.errorCount ?? 0,
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      stickyHitCount: row?.stickyHitCount ?? 0,
    };
  }

  async getUsageGroupByApp(
    since: Date,
  ): Promise<
    Array<{
      id: string;
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>
  > {
    const rows = await this.db
      .select({
        id: apps.id,
        name: apps.name,
        requestCount: count(),
        inputTokens: sum(usageRecords.inputTokens),
        outputTokens: sum(usageRecords.outputTokens),
        totalTokens: sum(usageRecords.totalTokens),
      })
      .from(usageRecords)
      .innerJoin(apps, eq(usageRecords.appId, apps.id))
      .where(gte(usageRecords.createdAt, since))
      .groupBy(apps.id, apps.name, usageRecords.appId)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      requestCount: r.requestCount,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.totalTokens ?? 0),
    }));
  }

  async getUsageGroupByConsumerKey(
    since: Date,
  ): Promise<
    Array<{
      id: string;
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>
  > {
    const rows = await this.db
      .select({
        id: consumerKeys.id,
        name: consumerKeys.name,
        requestCount: count(),
        inputTokens: sum(usageRecords.inputTokens),
        outputTokens: sum(usageRecords.outputTokens),
        totalTokens: sum(usageRecords.totalTokens),
      })
      .from(usageRecords)
      .innerJoin(consumerKeys, eq(usageRecords.consumerKeyId, consumerKeys.id))
      .where(gte(usageRecords.createdAt, since))
      .groupBy(consumerKeys.id, consumerKeys.name, usageRecords.consumerKeyId)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      requestCount: r.requestCount,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.totalTokens ?? 0),
    }));
  }

  async getUsageGroupByUpstream(
    since: Date,
  ): Promise<
    Array<{
      id: string;
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>
  > {
    const rows = await this.db
      .select({
        id: upstreamKeys.id,
        name: upstreamKeys.name,
        requestCount: count(),
        inputTokens: sum(usageRecords.inputTokens),
        outputTokens: sum(usageRecords.outputTokens),
        totalTokens: sum(usageRecords.totalTokens),
      })
      .from(usageRecords)
      .innerJoin(upstreamKeys, eq(usageRecords.upstreamKeyId, upstreamKeys.id))
      .where(gte(usageRecords.createdAt, since))
      .groupBy(upstreamKeys.id, upstreamKeys.name, usageRecords.upstreamKeyId)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      requestCount: r.requestCount,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.totalTokens ?? 0),
    }));
  }

  async getUsageGroupByTarget(
    since: Date,
  ): Promise<
    Array<{
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>
  > {
    const rows = await this.db
      .select({
        name: usageRecords.requestedTargetName,
        requestCount: count(),
        inputTokens: sum(usageRecords.inputTokens),
        outputTokens: sum(usageRecords.outputTokens),
        totalTokens: sum(usageRecords.totalTokens),
      })
      .from(usageRecords)
      .where(gte(usageRecords.createdAt, since))
      .groupBy(usageRecords.requestedTargetName)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      name: r.name,
      requestCount: r.requestCount,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.totalTokens ?? 0),
    }));
  }

  // --- Trace logs ---

  async insertTraceLog(
    data: Omit<RequestTraceLogInsert, 'id' | 'createdAt'> & { createdAt?: Date },
  ): Promise<RequestTraceLogRow> {
    const row: RequestTraceLogInsert = {
      id: generateId('trace'),
      ...data,
      createdAt: data.createdAt ?? new Date(),
    };
    await this.db.insert(requestTraceLogs).values(row);
    return row as RequestTraceLogRow;
  }

  async listTraceLogsByRequestTraceId(requestTraceId: string): Promise<RequestTraceLogRow[]> {
    return this.db
      .select()
      .from(requestTraceLogs)
      .where(eq(requestTraceLogs.requestTraceId, requestTraceId))
      .orderBy(requestTraceLogs.stepIndex);
  }

  async listRecentTraceLogs(limit = 100): Promise<RequestTraceLogRow[]> {
    return this.db
      .select()
      .from(requestTraceLogs)
      .orderBy(desc(requestTraceLogs.createdAt))
      .limit(limit);
  }

  // --- Debug content logs ---

  async insertDebugContentLog(
    data: Omit<DebugContentLogInsert, 'id' | 'createdAt'>,
  ): Promise<DebugContentLogRow> {
    const row: DebugContentLogInsert = {
      id: generateId('contentLog'),
      ...data,
      createdAt: new Date(),
    };
    await this.db.insert(debugContentLogs).values(row);
    return row as DebugContentLogRow;
  }

  async deleteOldDebugContentLogs(before: Date): Promise<void> {
    await this.db.delete(debugContentLogs).where(lt(debugContentLogs.createdAt, before));
  }

  async deleteOldTraceLogs(before: Date): Promise<void> {
    await this.db.delete(requestTraceLogs).where(lt(requestTraceLogs.createdAt, before));
  }

  async deleteOldAuditEvents(before: Date): Promise<void> {
    await this.db.delete(auditEvents).where(lt(auditEvents.createdAt, before));
  }

  // --- Audit events ---

  async insertAuditEvent(data: Omit<AuditEventInsert, 'id' | 'createdAt'>): Promise<AuditEventRow> {
    const row: AuditEventInsert = {
      id: generateId('auditEvent'),
      ...data,
      createdAt: new Date(),
    };
    await this.db.insert(auditEvents).values(row);
    return row as AuditEventRow;
  }

  async listRecentAuditEvents(limit = 100): Promise<AuditEventRow[]> {
    return this.db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(limit);
  }

  async deleteOldDailyStats(before: Date): Promise<void> {
    await this.db.delete(dailyConsumptionStats).where(lt(dailyConsumptionStats.updatedAt, before));
  }

  // --- Daily consumption stats ---

  async upsertDailyStat(
    data: Omit<DailyConsumptionStatInsert, 'id' | 'updatedAt'>,
  ): Promise<DailyConsumptionStatRow> {
    const existing = await this.findDailyStat(data.upstreamKeyId, data.realModelName, data.dayDate);
    const now = new Date();
    if (existing) {
      const requestCount = data.requestCount ?? 0;
      const totalCount = existing.requestCount + requestCount;
      const avgLatencyMs =
        totalCount === 0
          ? 0
          : Math.round(
              (existing.avgLatencyMs * existing.requestCount +
                (data.avgLatencyMs ?? 0) * requestCount) /
                totalCount,
            );
      await this.db
        .update(dailyConsumptionStats)
        .set({
          requestCount: existing.requestCount + requestCount,
          successCount: existing.successCount + (data.successCount ?? 0),
          errorCount: existing.errorCount + (data.errorCount ?? 0),
          inputTokens: existing.inputTokens + (data.inputTokens ?? 0),
          outputTokens: existing.outputTokens + (data.outputTokens ?? 0),
          totalTokens: existing.totalTokens + (data.totalTokens ?? 0),
          cacheReadTokens: existing.cacheReadTokens + (data.cacheReadTokens ?? 0),
          cacheWriteTokens: existing.cacheWriteTokens + (data.cacheWriteTokens ?? 0),
          avgLatencyMs,
          totalCostAmount: existing.totalCostAmount + (data.totalCostAmount ?? 0),
          updatedAt: now,
        })
        .where(eq(dailyConsumptionStats.id, existing.id));
      return (await this.findDailyStatById(existing.id))!;
    }
    const row: DailyConsumptionStatInsert = {
      id: generateId('usageRecord'),
      ...data,
      updatedAt: now,
    };
    await this.db.insert(dailyConsumptionStats).values(row);
    return row as DailyConsumptionStatRow;
  }

  async findDailyStat(
    upstreamKeyId: string,
    realModelName: string,
    dayDate: string,
  ): Promise<DailyConsumptionStatRow | undefined> {
    const rows = await this.db
      .select()
      .from(dailyConsumptionStats)
      .where(
        and(
          eq(dailyConsumptionStats.upstreamKeyId, upstreamKeyId),
          eq(dailyConsumptionStats.realModelName, realModelName),
          eq(dailyConsumptionStats.dayDate, dayDate),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async findDailyStatById(id: string): Promise<DailyConsumptionStatRow | undefined> {
    const rows = await this.db
      .select()
      .from(dailyConsumptionStats)
      .where(eq(dailyConsumptionStats.id, id))
      .limit(1);
    return rows[0];
  }

  async listDailyStatsByDay(dayDate: string): Promise<DailyConsumptionStatRow[]> {
    return this.db
      .select()
      .from(dailyConsumptionStats)
      .where(eq(dailyConsumptionStats.dayDate, dayDate))
      .orderBy(desc(dailyConsumptionStats.totalCostAmount));
  }
}
