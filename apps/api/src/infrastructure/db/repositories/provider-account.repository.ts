import { eq, and, gt, lt, count, inArray } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  providerAccounts,
  providerAccountQuotas,
  providerAccountCounters,
  type ProviderAccountInsert,
  type ProviderAccountRow,
  type ProviderAccountQuotaInsert,
  type ProviderAccountQuotaRow,
  type ProviderAccountCounterInsert,
  type ProviderAccountCounterRow,
  type QuotaPeriod,
} from '../schema.js';

export interface ProviderAccountWithQuota extends ProviderAccountRow {
  quota: ProviderAccountQuotaRow | undefined;
}

export class ProviderAccountRepository {
  constructor(private readonly db: Db) {}

  async createProviderAccount(
    data: Omit<ProviderAccountInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProviderAccountRow> {
    const now = new Date();
    const row: ProviderAccountInsert = {
      id: generateId('providerAccount'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(providerAccounts).values(row);
    return row as ProviderAccountRow;
  }

  async findById(id: string): Promise<ProviderAccountRow | undefined> {
    const rows = await this.db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, id))
      .limit(1);
    return rows[0];
  }

  async findByName(name: string): Promise<ProviderAccountRow | undefined> {
    const rows = await this.db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.name, name))
      .limit(1);
    return rows[0];
  }

  async findByIds(ids: string[]): Promise<Map<string, ProviderAccountRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(providerAccounts)
      .where(inArray(providerAccounts.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }

  async listProviderAccounts(): Promise<ProviderAccountRow[]> {
    return this.db
      .select()
      .from(providerAccounts)
      .orderBy(providerAccounts.displayOrder, providerAccounts.name);
  }

  async hasProviderAccounts(): Promise<boolean> {
    const rows = await this.db.select({ count: count() }).from(providerAccounts);
    return (rows[0]?.count ?? 0) > 0;
  }

  async updateProviderAccount(
    id: string,
    data: Partial<Omit<ProviderAccountInsert, 'id' | 'createdAt'>>,
  ): Promise<ProviderAccountRow | undefined> {
    const now = new Date();
    await this.db
      .update(providerAccounts)
      .set({ ...data, updatedAt: now })
      .where(eq(providerAccounts.id, id));
    return this.findById(id);
  }

  async deleteProviderAccount(id: string): Promise<void> {
    await this.db.delete(providerAccounts).where(eq(providerAccounts.id, id));
  }

  async updateFreeze(
    id: string,
    frozen: boolean,
    reason?: string,
  ): Promise<ProviderAccountRow | undefined> {
    return this.updateProviderAccount(id, {
      frozen,
      frozenReason: frozen ? (reason ?? null) : null,
    });
  }

  async touchLastUsed(id: string, at = new Date()): Promise<void> {
    await this.db
      .update(providerAccounts)
      .set({ lastUsedAt: at, updatedAt: at })
      .where(eq(providerAccounts.id, id));
  }

  // --- Quotas ---

  async createQuota(
    data: Omit<ProviderAccountQuotaInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProviderAccountQuotaRow> {
    const now = new Date();
    const row: ProviderAccountQuotaInsert = {
      id: generateId('providerAccountQuota'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(providerAccountQuotas).values(row);
    return row as ProviderAccountQuotaRow;
  }

  async findQuotaByProviderAccount(
    providerAccountId: string,
  ): Promise<ProviderAccountQuotaRow | undefined> {
    const rows = await this.db
      .select()
      .from(providerAccountQuotas)
      .where(eq(providerAccountQuotas.providerAccountId, providerAccountId))
      .limit(1);
    return rows[0];
  }

  async updateQuota(
    id: string,
    data: Partial<Omit<ProviderAccountQuotaInsert, 'id' | 'createdAt'>>,
  ): Promise<ProviderAccountQuotaRow | undefined> {
    const now = new Date();
    await this.db
      .update(providerAccountQuotas)
      .set({ ...data, updatedAt: now })
      .where(eq(providerAccountQuotas.id, id));
    const rows = await this.db
      .select()
      .from(providerAccountQuotas)
      .where(eq(providerAccountQuotas.id, id))
      .limit(1);
    return rows[0];
  }

  async deleteQuota(id: string): Promise<void> {
    await this.db.delete(providerAccountQuotas).where(eq(providerAccountQuotas.id, id));
  }

  // --- Counters ---

  async createCounter(
    data: Omit<ProviderAccountCounterInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProviderAccountCounterRow> {
    const now = new Date();
    const row: ProviderAccountCounterInsert = {
      id: generateId('providerAccountCounter'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(providerAccountCounters).values(row);
    return row as ProviderAccountCounterRow;
  }

  async findCounter(
    providerAccountId: string,
    period: QuotaPeriod,
    periodStartedAt: Date,
  ): Promise<ProviderAccountCounterRow | undefined> {
    const rows = await this.db
      .select()
      .from(providerAccountCounters)
      .where(
        and(
          eq(providerAccountCounters.providerAccountId, providerAccountId),
          eq(providerAccountCounters.period, period),
          eq(providerAccountCounters.periodStartedAt, periodStartedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async incrementCounter(
    providerAccountId: string,
    period: QuotaPeriod,
    periodStartedAt: Date,
    periodEndsAt: Date,
    delta: { requests?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number },
  ): Promise<ProviderAccountCounterRow> {
    const existing = await this.findCounter(providerAccountId, period, periodStartedAt);
    const now = new Date();
    if (existing) {
      await this.db
        .update(providerAccountCounters)
        .set({
          requestCount: existing.requestCount + (delta.requests ?? 0),
          inputTokens: existing.inputTokens + (delta.inputTokens ?? 0),
          outputTokens: existing.outputTokens + (delta.outputTokens ?? 0),
          totalTokens: existing.totalTokens + (delta.totalTokens ?? 0),
          updatedAt: now,
        })
        .where(eq(providerAccountCounters.id, existing.id));
      return (await this.findCounter(providerAccountId, period, periodStartedAt))!;
    }
    return this.createCounter({
      providerAccountId,
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
    await this.db
      .delete(providerAccountCounters)
      .where(lt(providerAccountCounters.periodEndsAt, at));
  }

  async listActiveCounters(
    providerAccountId: string,
    at = new Date(),
  ): Promise<ProviderAccountCounterRow[]> {
    return this.db
      .select()
      .from(providerAccountCounters)
      .where(
        and(
          eq(providerAccountCounters.providerAccountId, providerAccountId),
          gt(providerAccountCounters.periodEndsAt, at),
        ),
      );
  }
}
