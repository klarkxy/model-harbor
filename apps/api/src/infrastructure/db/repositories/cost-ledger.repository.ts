import { eq, and, gt, lt, isNull, or, desc, sql } from 'drizzle-orm';
import { generateId } from '@manageyourllm/shared';
import type { Db } from '../client.js';
import {
  pricingEntries,
  plans,
  type PricingEntryInsert,
  type PricingEntryRow,
  type PlanInsert,
  type PlanRow,
} from '../schema.js';
import type { ProviderType } from '@manageyourllm/shared';

export class CostLedgerRepository {
  constructor(private readonly db: Db) {}

  // --- Pricing ---

  async createPricingEntry(
    data: Omit<PricingEntryInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PricingEntryRow> {
    const now = new Date();
    const row: PricingEntryInsert = {
      id: generateId('pricingEntry'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(pricingEntries).values(row);
    return row as PricingEntryRow;
  }

  async findPricingEntryById(id: string): Promise<PricingEntryRow | undefined> {
    const rows = await this.db
      .select()
      .from(pricingEntries)
      .where(eq(pricingEntries.id, id))
      .limit(1);
    return rows[0];
  }

  async findActivePricing(
    providerType: ProviderType,
    realModelName: string,
    at = new Date(),
  ): Promise<PricingEntryRow | undefined> {
    const rows = await this.db
      .select()
      .from(pricingEntries)
      .where(
        and(
          eq(pricingEntries.providerType, providerType),
          eq(pricingEntries.realModelName, realModelName),
          isNull(pricingEntries.providerAccountId), // 通用定价 providerAccountId 为 NULL
          lt(pricingEntries.effectiveFrom, at),
          or(gt(pricingEntries.effectiveUntil, at), isNull(pricingEntries.effectiveUntil)),
        ),
      )
      .orderBy(desc(pricingEntries.effectiveFrom))
      .limit(1);
    return rows[0];
  }

  async findActivePricingForProviderAccount(
    providerType: ProviderType,
    providerAccountId: string,
    realModelName: string,
    at = new Date(),
  ): Promise<PricingEntryRow | undefined> {
    const rows = await this.db
      .select()
      .from(pricingEntries)
      .where(
        and(
          eq(pricingEntries.providerType, providerType),
          eq(pricingEntries.providerAccountId, providerAccountId),
          eq(pricingEntries.realModelName, realModelName),
          lt(pricingEntries.effectiveFrom, at),
          or(gt(pricingEntries.effectiveUntil, at), isNull(pricingEntries.effectiveUntil)),
        ),
      )
      .orderBy(desc(pricingEntries.effectiveFrom))
      .limit(1);
    return rows[0];
  }

  async listPricingEntries(): Promise<PricingEntryRow[]> {
    return this.db
      .select()
      .from(pricingEntries)
      .orderBy(pricingEntries.providerType, pricingEntries.realModelName);
  }

  async updatePricingEntry(
    id: string,
    data: Partial<Omit<PricingEntryInsert, 'id' | 'createdAt'>>,
  ): Promise<PricingEntryRow | undefined> {
    const now = new Date();
    await this.db
      .update(pricingEntries)
      .set({ ...data, updatedAt: now })
      .where(eq(pricingEntries.id, id));
    return this.findPricingEntryById(id);
  }

  async deletePricingEntry(id: string): Promise<void> {
    await this.db.delete(pricingEntries).where(eq(pricingEntries.id, id));
  }

  // --- Plans ---

  async createPlan(data: Omit<PlanInsert, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlanRow> {
    const now = new Date();
    const row: PlanInsert = {
      id: generateId('plan'),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(plans).values(row);
    return row as PlanRow;
  }

  async findPlanById(id: string): Promise<PlanRow | undefined> {
    const rows = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return rows[0];
  }

  async listPlans(): Promise<PlanRow[]> {
    return this.db.select().from(plans).orderBy(desc(plans.createdAt));
  }

  async listPlansByType(planType: PlanRow['planType']): Promise<PlanRow[]> {
    return this.db
      .select()
      .from(plans)
      .where(eq(plans.planType, planType))
      .orderBy(desc(plans.createdAt));
  }

  async updatePlan(
    id: string,
    data: Partial<Omit<PlanInsert, 'id' | 'createdAt'>>,
  ): Promise<PlanRow | undefined> {
    const now = new Date();
    await this.db
      .update(plans)
      .set({ ...data, updatedAt: now })
      .where(eq(plans.id, id));
    return this.findPlanById(id);
  }

  // 原子扣减套餐额度，避免并发 read-modify-write 覆盖。
  // 返回扣减后的最新行；若套餐不存在则返回 undefined。
  async consumePlanAtomic(id: string, amount: number): Promise<PlanRow | undefined> {
    await this.db
      .update(plans)
      .set({
        usedAmount: sql`${plans.usedAmount} + ${amount}`,
        remainingAmount: sql`max(0, ${plans.totalAmount} - (${plans.usedAmount} + ${amount}))`,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, id));
    return this.findPlanById(id);
  }

  async deletePlan(id: string): Promise<void> {
    await this.db.delete(plans).where(eq(plans.id, id));
  }

  // 即将到期或已过期（按 validUntil 与 reminderDays 计算提醒线）
  async findExpiringPlans(withinMs = 7 * 24 * 60 * 60 * 1000, at = new Date()): Promise<PlanRow[]> {
    const deadline = new Date(at.getTime() + withinMs);
    return this.db
      .select()
      .from(plans)
      .where(and(gt(plans.validUntil, at), lt(plans.validUntil, deadline)))
      .orderBy(plans.validUntil);
  }
}
