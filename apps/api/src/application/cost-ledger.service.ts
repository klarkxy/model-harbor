import type { Db } from '../infrastructure/db/client.js';
import { CostLedgerRepository } from '../infrastructure/db/repositories/cost-ledger.repository.js';
import type { PlanInsert, PlanRow, PricingEntryRow } from '../infrastructure/db/schema.js';
import type { ProviderType } from '@manageyourllm/shared';
import type { ChatUsageIR } from '@manageyourllm/shared';

export class CostLedgerService {
  constructor(private readonly db: Db) {}

  private repo(): CostLedgerRepository {
    return new CostLedgerRepository(this.db);
  }

  // --- 定价 ---

  async createPricingEntry(input: {
    providerType: ProviderType;
    providerAccountId?: string | null;
    realModelName: string;
    inputPricePer1k: number;
    outputPricePer1k: number;
    currency?: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
  }): Promise<PricingEntryRow> {
    return this.repo().createPricingEntry({
      ...input,
      providerAccountId: input.providerAccountId ?? null,
      effectiveUntil: input.effectiveUntil ?? null,
    });
  }

  async updatePricingEntry(
    id: string,
    input: Partial<{
      providerType: ProviderType;
      providerAccountId: string | null;
      realModelName: string;
      inputPricePer1k: number;
      outputPricePer1k: number;
      currency: string;
      effectiveFrom: Date;
      effectiveUntil: Date | null;
    }>,
  ): Promise<PricingEntryRow | undefined> {
    return this.repo().updatePricingEntry(id, input);
  }

  async deletePricingEntry(id: string): Promise<void> {
    await this.repo().deletePricingEntry(id);
  }

  async listPricingEntries(): Promise<PricingEntryRow[]> {
    return this.repo().listPricingEntries();
  }

  async getActivePricing(
    providerType: ProviderType,
    realModelName: string,
    at = new Date(),
  ): Promise<PricingEntryRow | undefined> {
    return this.repo().findActivePricing(providerType, realModelName, at);
  }

  async computeCost(
    providerType: ProviderType,
    providerAccountId: string,
    realModelName: string,
    usage: ChatUsageIR | null,
    at = new Date(),
  ): Promise<{ costAmount: number; costCurrency: string }> {
    let pricing = await this.repo().findActivePricingForProviderAccount(
      providerType,
      providerAccountId,
      realModelName,
      at,
    );
    if (!pricing) {
      pricing = await this.repo().findActivePricing(providerType, realModelName, at);
    }
    if (!pricing) {
      return { costAmount: 0, costCurrency: 'USD' };
    }
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cost = Math.round(
      (pricing.inputPricePer1k * inputTokens + pricing.outputPricePer1k * outputTokens) / 1000,
    );
    return { costAmount: cost, costCurrency: pricing.currency };
  }

  // --- 套餐 ---

  async createPlan(
    input: Omit<PlanInsert, 'id' | 'createdAt' | 'updatedAt' | 'remainingAmount'>,
  ): Promise<PlanRow> {
    const remainingAmount = input.totalAmount - (input.usedAmount ?? 0);
    return this.repo().createPlan({
      ...input,
      remainingAmount,
    });
  }

  async listPlans(): Promise<PlanRow[]> {
    return this.repo().listPlans();
  }

  async updatePlan(
    id: string,
    input: Partial<Omit<PlanInsert, 'id' | 'createdAt'>>,
  ): Promise<PlanRow | undefined> {
    return this.repo().updatePlan(id, input);
  }

  async deletePlan(id: string): Promise<void> {
    await this.repo().deletePlan(id);
  }

  async consumePlan(id: string, amount: number): Promise<PlanRow | undefined> {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('消费额度必须是非负数');
    }
    return this.repo().consumePlanAtomic(id, amount);
  }

  async listExpiringPlans(withinMs = 7 * 24 * 60 * 60 * 1000): Promise<PlanRow[]> {
    return this.repo().findExpiringPlans(withinMs);
  }

  async getPlanReminders(
    at = new Date(),
    defaultReminderDays = 7,
  ): Promise<
    Array<{
      plan: PlanRow;
      reasons: Array<'expiring' | 'low_balance'>;
      daysUntilExpiry: number | null;
      remainingRatio: number;
    }>
  > {
    const plans = await this.repo().listPlans();
    const reminders = [];
    for (const plan of plans) {
      const reasons: Array<'expiring' | 'low_balance'> = [];
      let daysUntilExpiry: number | null = null;
      if (plan.validUntil) {
        const ms = plan.validUntil.getTime() - at.getTime();
        daysUntilExpiry = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
        const reminderDays = plan.reminderDays ?? defaultReminderDays;
        if (daysUntilExpiry <= reminderDays) {
          reasons.push('expiring');
        }
      }
      const remainingRatio = plan.totalAmount > 0 ? plan.remainingAmount / plan.totalAmount : 0;
      if (remainingRatio <= 0.1) {
        reasons.push('low_balance');
      }
      if (reasons.length > 0) {
        reminders.push({ plan, reasons, daysUntilExpiry, remainingRatio });
      }
    }
    return reminders;
  }
}
