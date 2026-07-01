import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { CostLedgerService } from '../../src/application/cost-ledger.service.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('cost ledger service', () => {
  let testDb: TestDb;
  let service: CostLedgerService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new CostLedgerService(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('atomically consumes plan amount', async () => {
    const plan = await service.createPlan({
      planType: 'token',
      name: 'Test Plan',
      providerType: 'openai_compatible',
      totalAmount: 1_000,
      usedAmount: 0,
      unit: 'token',
      period: 'monthly',
      purchasedAt: new Date(),
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      reminderDays: 7,
    });

    const consumed = await service.consumePlan(plan.id, 300);
    expect(consumed).toBeDefined();
    expect(consumed!.usedAmount).toBe(300);
    expect(consumed!.remainingAmount).toBe(700);

    const consumedAgain = await service.consumePlan(plan.id, 400);
    expect(consumedAgain!.usedAmount).toBe(700);
    expect(consumedAgain!.remainingAmount).toBe(300);
  });

  it('rejects negative consume amount', async () => {
    const plan = await service.createPlan({
      planType: 'token',
      name: 'Test Plan',
      providerType: 'openai_compatible',
      totalAmount: 1_000,
      usedAmount: 0,
      unit: 'token',
      period: 'monthly',
      purchasedAt: new Date(),
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      reminderDays: 7,
    });

    await expect(service.consumePlan(plan.id, -10)).rejects.toThrow('非负数');
  });
});
