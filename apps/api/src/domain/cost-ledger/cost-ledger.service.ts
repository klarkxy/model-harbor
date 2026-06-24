import type { Db } from '../../infrastructure/db/client.js';
import { CostLedgerRepository } from '../../infrastructure/db/repositories/cost-ledger.repository.js';
import type { PlanInsert, PlanRow, PricingEntryRow } from '../../infrastructure/db/schema.js';
import type { ProviderType } from '@manageyourllm/shared';

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

  async getActivePricing(
    providerType: ProviderType,
    realModelName: string,
    at = new Date(),
  ): Promise<PricingEntryRow | undefined> {
    return this.repo().findActivePricing(providerType, realModelName, at);
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
