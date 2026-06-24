import { eq, and, gt, lt } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  upstreamKeys,
  upstreamKeyQuotas,
  upstreamKeyCounters,
  type UpstreamKeyInsert,
  type UpstreamKeyRow,
  type UpstreamKeyQuotaInsert,
  type UpstreamKeyQuotaRow,
  type UpstreamKeyCounterInsert,
  type UpstreamKeyCounterRow,
  type QuotaPeriod,
} from '../schema.js';

export interface UpstreamKeyWithQuota extends UpstreamKeyRow {
  quota: UpstreamKeyQuotaRow | undefined;
}

export class UpstreamKeyRepository {
  constructor(private readonly db: Db) {}

  async createUpstreamKey(
    data: Omit<UpstreamKeyInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<UpstreamKeyRow> {
    const now = new Date();
    const row: UpstreamKeyInsert = {
      id: generateId('upstreamKey'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(upstreamKeys).values(row);
    return row as UpstreamKeyRow;
  }

  async findById(id: string): Promise<UpstreamKeyRow | undefined> {
    const rows = await this.db.select().from(upstreamKeys).where(eq(upstreamKeys.id, id)).limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<UpstreamKeyRow | undefined> {
    const rows = await this.db
      .select()
      .from(upstreamKeys)
      .where(eq(upstreamKeys.name, name))
      .limit(1);
    return rows[0];
  }

  async listUpstreamKeys(): Promise<UpstreamKeyRow[]> {
    return this.db
      .select()
      .from(upstreamKeys)
      .orderBy(upstreamKeys.displayOrder, upstreamKeys.name);
  }

  async updateUpstreamKey(
    id: string,
    data: Partial<Omit<UpstreamKeyInsert, 'id' | 'createdAt'>>,
  ): Promise<UpstreamKeyRow | undefined> {
    const now = new Date();
    await this.db
      .update(upstreamKeys)
      .set({ ...data, updatedAt: now })
      .where(eq(upstreamKeys.id, id));
    return this.findById(id);
  }

  async deleteUpstreamKey(id: string): Promise<void> {
    await this.db.delete(upstreamKeys).where(eq(upstreamKeys.id, id));
  }

  async updateFreeze(
    id: string,
    frozen: boolean,
    reason?: string,
  ): Promise<UpstreamKeyRow | undefined> {
    return this.updateUpstreamKey(id, {
      frozen,
      frozenReason: frozen ? (reason ?? null) : null,
    });
  }

  async updateCooldown(
    id: string,
    cooldownUntil: Date | null,
  ): Promise<UpstreamKeyRow | undefined> {
    return this.updateUpstreamKey(id, { cooldownUntil });
  }

  async touchLastUsed(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(upstreamKeys)
      .set({ lastUsedAt: at, updatedAt: at })
      .where(eq(upstreamKeys.id, id));
  }

  // --- Quotas ---

  async createQuota(
    data: Omit<UpstreamKeyQuotaInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<UpstreamKeyQuotaRow> {
    const now = new Date();
    const row: UpstreamKeyQuotaInsert = {
      id: generateId('upstreamKeyQuota'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(upstreamKeyQuotas).values(row);
    return row as UpstreamKeyQuotaRow;
  }

  async findQuotaByUpstreamKey(upstreamKeyId: string): Promise<UpstreamKeyQuotaRow | undefined> {
    const rows = await this.db
      .select()
      .from(upstreamKeyQuotas)
      .where(eq(upstreamKeyQuotas.upstreamKeyId, upstreamKeyId))
      .limit(1);
    return rows[0];
  }

  async updateQuota(
    id: string,
    data: Partial<Omit<UpstreamKeyQuotaInsert, 'id' | 'createdAt'>>,
  ): Promise<UpstreamKeyQuotaRow | undefined> {
    const now = new Date();
    await this.db
      .update(upstreamKeyQuotas)
      .set({ ...data, updatedAt: now })
      .where(eq(upstreamKeyQuotas.id, id));
    const rows = await this.db
      .select()
      .from(upstreamKeyQuotas)
      .where(eq(upstreamKeyQuotas.id, id))
      .limit(1);
    return rows[0];
  }

  async deleteQuota(id: string): Promise<void> {
    await this.db.delete(upstreamKeyQuotas).where(eq(upstreamKeyQuotas.id, id));
  }

  // --- Counters ---

  async createCounter(
    data: Omit<UpstreamKeyCounterInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<UpstreamKeyCounterRow> {
    const now = new Date();
    const row: UpstreamKeyCounterInsert = {
      id: generateId('upstreamKeyCounter'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(upstreamKeyCounters).values(row);
    return row as UpstreamKeyCounterRow;
  }

  async findCounter(
    upstreamKeyId: string,
    period: QuotaPeriod,
    periodStartedAt: Date,
  ): Promise<UpstreamKeyCounterRow | undefined> {
    const rows = await this.db
      .select()
      .from(upstreamKeyCounters)
      .where(
        and(
          eq(upstreamKeyCounters.upstreamKeyId, upstreamKeyId),
          eq(upstreamKeyCounters.period, period),
          eq(upstreamKeyCounters.periodStartedAt, periodStartedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async incrementCounter(
    upstreamKeyId: string,
    period: QuotaPeriod,
    periodStartedAt: Date,
    periodEndsAt: Date,
    delta: { requests?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number },
  ): Promise<UpstreamKeyCounterRow> {
    const existing = await this.findCounter(upstreamKeyId, period, periodStartedAt);
    const now = new Date();
    if (existing) {
      await this.db
        .update(upstreamKeyCounters)
        .set({
          requestCount: existing.requestCount + (delta.requests ?? 0),
          inputTokens: existing.inputTokens + (delta.inputTokens ?? 0),
          outputTokens: existing.outputTokens + (delta.outputTokens ?? 0),
          totalTokens: existing.totalTokens + (delta.totalTokens ?? 0),
          updatedAt: now,
        })
        .where(eq(upstreamKeyCounters.id, existing.id));
      return (await this.findCounter(upstreamKeyId, period, periodStartedAt))!;
    }
    return this.createCounter({
      upstreamKeyId,
      period,
      periodStartedAt,
      periodEndsAt,
      requestCount: delta.requests ?? 0,
      inputTokens: delta.inputTokens ?? 0,
      outputTokens: delta.outputTokens ?? 0,
      totalTokens: delta.totalTokens ?? 0,
    });
  }

  async deleteExpiredCounters(at = new Date()): Promise<void> {
    await this.db.delete(upstreamKeyCounters).where(lt(upstreamKeyCounters.periodEndsAt, at));
  }

  async listActiveCounters(
    upstreamKeyId: string,
    at = new Date(),
  ): Promise<UpstreamKeyCounterRow[]> {
    return this.db
      .select()
      .from(upstreamKeyCounters)
      .where(
        and(
          eq(upstreamKeyCounters.upstreamKeyId, upstreamKeyId),
          gt(upstreamKeyCounters.periodEndsAt, at),
        ),
      );
  }
}
