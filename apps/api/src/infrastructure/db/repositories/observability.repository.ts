import { eq, desc, lt, and, gte, sql, count, sum, max, isNotNull } from 'drizzle-orm';
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

  async listTraces(
    since: Date,
    limit = 100,
  ): Promise<
    Array<{
      requestTraceId: string;
      appId: string;
      consumerKeyId: string;
      requestedTargetName: string;
      upstreamKeyId: string;
      realModelName: string;
      resolvedTargetType: 'public_model' | 'model_group' | null;
      resolvedTargetId: string | null;
      status: 'success' | 'error' | 'pending';
      latencyMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      createdAt: Date;
      failedCount: number;
    }>
  > {
    const failedAttempts = this.db.$with('failed_attempts').as(
      this.db
        .select({
          requestTraceId: requestTraceLogs.requestTraceId,
          failedCount: count().as('failed_count'),
        })
        .from(requestTraceLogs)
        .where(eq(requestTraceLogs.step, 'upstream_attempt_failed'))
        .groupBy(requestTraceLogs.requestTraceId),
    );

    const rows = await this.db
      .with(failedAttempts)
      .select({
        requestTraceId: usageRecords.requestTraceId,
        appId: usageRecords.appId,
        consumerKeyId: usageRecords.consumerKeyId,
        requestedTargetName: usageRecords.requestedTargetName,
        upstreamKeyId: usageRecords.upstreamKeyId,
        realModelName: usageRecords.realModelName,
        resolvedTargetType: usageRecords.resolvedTargetType,
        resolvedTargetId: usageRecords.resolvedTargetId,
        status: usageRecords.status,
        latencyMs: usageRecords.latencyMs,
        inputTokens: usageRecords.inputTokens,
        outputTokens: usageRecords.outputTokens,
        totalTokens: usageRecords.totalTokens,
        createdAt: usageRecords.createdAt,
        failedCount: sql<number>`coalesce(${failedAttempts.failedCount}, 0)`,
      })
      .from(usageRecords)
      .leftJoin(failedAttempts, eq(usageRecords.requestTraceId, failedAttempts.requestTraceId))
      .where(and(isNotNull(usageRecords.requestTraceId), gte(usageRecords.createdAt, since)))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      requestTraceId: r.requestTraceId!,
      resolvedTargetType: r.resolvedTargetType as 'public_model' | 'model_group' | null,
      resolvedTargetId: r.resolvedTargetId ?? null,
      status: r.status as 'success' | 'error' | 'pending',
      failedCount: Number(r.failedCount ?? 0),
    }));
  }

  async findTraceUsageRecord(requestTraceId: string): Promise<UsageRecordRow | undefined> {
    const rows = await this.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestTraceId, requestTraceId))
      .limit(1);
    return rows[0];
  }

  async getUsageSummary(since: Date): Promise<{
    requestCount: number;
    successCount: number;
    errorCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    stickyHitCount: number;
    costAmount: number;
    costCurrency: string | null;
    unpricedCount: number;
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
        costAmount: sum(usageRecords.costAmount),
        pricedCount: sql<number>`count(${usageRecords.costAmount})`,
      })
      .from(usageRecords)
      .where(gte(usageRecords.createdAt, since));

    const firstCurrency = await this.db
      .select({ currency: usageRecords.costCurrency })
      .from(usageRecords)
      .where(and(gte(usageRecords.createdAt, since), isNotNull(usageRecords.costCurrency)))
      .limit(1);

    return {
      requestCount: row?.requestCount ?? 0,
      successCount: row?.successCount ?? 0,
      errorCount: row?.errorCount ?? 0,
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      stickyHitCount: row?.stickyHitCount ?? 0,
      costAmount: Number(row?.costAmount ?? 0),
      costCurrency: firstCurrency[0]?.currency ?? null,
      unpricedCount: (row?.requestCount ?? 0) - (row?.pricedCount ?? 0),
    };
  }

  async getUsageGroupByApp(since: Date): Promise<
    Array<{
      id: string;
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costAmount: number;
      costCurrency: string | null;
      unpricedCount: number;
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
        costAmount: sum(usageRecords.costAmount),
        costCurrency: max(usageRecords.costCurrency),
        pricedCount: sql<number>`count(${usageRecords.costAmount})`,
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
      costAmount: Number(r.costAmount ?? 0),
      costCurrency: r.costCurrency,
      unpricedCount: r.requestCount - (r.pricedCount ?? 0),
    }));
  }

  async getUsageGroupByConsumerKey(since: Date): Promise<
    Array<{
      id: string;
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costAmount: number;
      costCurrency: string | null;
      unpricedCount: number;
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
        costAmount: sum(usageRecords.costAmount),
        costCurrency: max(usageRecords.costCurrency),
        pricedCount: sql<number>`count(${usageRecords.costAmount})`,
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
      costAmount: Number(r.costAmount ?? 0),
      costCurrency: r.costCurrency,
      unpricedCount: r.requestCount - (r.pricedCount ?? 0),
    }));
  }

  async getUsageGroupByUpstream(since: Date): Promise<
    Array<{
      id: string;
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costAmount: number;
      costCurrency: string | null;
      unpricedCount: number;
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
        costAmount: sum(usageRecords.costAmount),
        costCurrency: max(usageRecords.costCurrency),
        pricedCount: sql<number>`count(${usageRecords.costAmount})`,
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
      costAmount: Number(r.costAmount ?? 0),
      costCurrency: r.costCurrency,
      unpricedCount: r.requestCount - (r.pricedCount ?? 0),
    }));
  }

  async getUsageGroupByTarget(since: Date): Promise<
    Array<{
      name: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costAmount: number;
      costCurrency: string | null;
      unpricedCount: number;
    }>
  > {
    const rows = await this.db
      .select({
        name: usageRecords.requestedTargetName,
        requestCount: count(),
        inputTokens: sum(usageRecords.inputTokens),
        outputTokens: sum(usageRecords.outputTokens),
        totalTokens: sum(usageRecords.totalTokens),
        costAmount: sum(usageRecords.costAmount),
        costCurrency: max(usageRecords.costCurrency),
        pricedCount: sql<number>`count(${usageRecords.costAmount})`,
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
      costAmount: Number(r.costAmount ?? 0),
      costCurrency: r.costCurrency,
      unpricedCount: r.requestCount - (r.pricedCount ?? 0),
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

  async listRecentDebugContentLogs(limit = 100): Promise<DebugContentLogRow[]> {
    return this.db
      .select()
      .from(debugContentLogs)
      .orderBy(desc(debugContentLogs.createdAt))
      .limit(limit);
  }

  async findDebugContentLogByTraceId(
    requestTraceId: string,
  ): Promise<DebugContentLogRow | undefined> {
    const rows = await this.db
      .select()
      .from(debugContentLogs)
      .where(eq(debugContentLogs.requestTraceId, requestTraceId))
      .limit(1);
    return rows[0];
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
