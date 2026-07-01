import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { CostLedgerRepository } from '../../src/infrastructure/db/repositories/cost-ledger.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('cost ledger repository', () => {
  let testDb: TestDb;
  let repo: CostLedgerRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new CostLedgerRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('CRUD pricing entry', async () => {
    const entry = await repo.createPricingEntry({
      providerType: 'openai_compatible',
      realModelName: 'gpt-4o',
      inputPricePer1k: 5,
      outputPricePer1k: 15,
      currency: 'USD',
      effectiveFrom: new Date(),
    });
    expect(entry.inputPricePer1k).toBe(5);
    const found = await repo.findPricingEntryById(entry.id);
    expect(found).toBeDefined();
  });

  it('CRUD plan and finds expiring plans', async () => {
    const plan = await repo.createPlan({
      planType: 'token',
      name: 'OpenAI 月度套餐',
      providerType: 'openai_compatible',
      totalAmount: 1_000_000,
      usedAmount: 0,
      remainingAmount: 1_000_000,
      unit: 'token',
      period: 'monthly',
      purchasedAt: new Date(),
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      reminderDays: 7,
    });
    expect(plan.planType).toBe('token');
    const expiring = await repo.findExpiringPlans(7 * 24 * 60 * 60 * 1000);
    expect(expiring.some((p) => p.id === plan.id)).toBe(true);
  });
});
