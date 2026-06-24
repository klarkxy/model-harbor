import { eq, desc, lt, and } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  usageRecords,
  requestTraceLogs,
  debugContentLogs,
  auditEvents,
  dailyConsumptionStats,
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

  // --- Trace logs ---

  async insertTraceLog(
    data: Omit<RequestTraceLogInsert, 'id' | 'createdAt'>,
  ): Promise<RequestTraceLogRow> {
    const row: RequestTraceLogInsert = {
      id: generateId('trace'),
      ...data,
      createdAt: new Date(),
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
