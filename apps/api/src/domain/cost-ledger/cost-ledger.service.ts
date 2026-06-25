import type { Db } from '../../infrastructure/db/client.js';
import { CostLedgerRepository } from '../../infrastructure/db/repositories/cost-ledger.repository.js';
import type { PlanInsert, PlanRow, PricingEntryRow } from '../../infrastructure/db/schema.js';
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
    upstreamKeyId?: string | null;
    realModelName: string;
    inputPricePer1k: number;
    outputPricePer1k: number;
    currency?: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
  }): Promise<PricingEntryRow> {
    return this.repo().createPricingEntry({
      ...input,
      upstreamKeyId: input.upstreamKeyId ?? null,
      effectiveUntil: input.effectiveUntil ?? null,
    });
  }

  async updatePricingEntry(
    id: string,
    input: Partial<{
      providerType: ProviderType;
      upstreamKeyId: string | null;
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
    upstreamKeyId: string,
    realModelName: string,
    usage: ChatUsageIR | null,
    at = new Date(),
  ): Promise<{ costAmount: number; costCurrency: string }> {
    let pricing = await this.repo().findActivePricingForUpstream(providerType, upstreamKeyId, realModelName, at);
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
}
