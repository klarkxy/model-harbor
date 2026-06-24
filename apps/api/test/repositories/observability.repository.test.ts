import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ObservabilityRepository } from '../../src/infrastructure/db/repositories/observability.repository.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('observability repository', () => {
  let testDb: TestDb;
  let repo: ObservabilityRepository;
  let appId: string;
  let consumerKeyId: string;
  let upstreamKeyId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new ObservabilityRepository(testDb.db);
    const app = await new AppRepository(testDb.db).createApp({ name: 'Test App', enabled: true });
    appId = app.id;
    const consumerKey = await new ConsumerKeyRepository(testDb.db).createConsumerKey({
      appId,
      name: 'key',
      keyHash: 'hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    consumerKeyId = consumerKey.id;
    const upstream = await new UpstreamKeyRepository(testDb.db).createUpstreamKey({
      name: 'Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    upstreamKeyId = upstream.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('inserts usage, trace and audit records', async () => {
    const usage = await repo.insertUsageRecord({
      appId,
      consumerKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'public_model',
      resolvedTargetId: 'pm_1',
      upstreamKeyId,
      realModelName: 'gpt-5-prod',
      sourceProtocol: 'openai',
      providerType: 'openai_compatible',
      status: 'success',
      latencyMs: 120,
    });
    expect(usage.id).toBeDefined();

    const trace = await repo.insertTraceLog({
      requestTraceId: 'trace_1',
      step: 'resolve',
      stepIndex: 0,
      appId,
    });
    expect(trace.requestTraceId).toBe('trace_1');

    const audit = await repo.insertAuditEvent({
      action: 'create',
      resourceType: 'upstream_key',
      actorUsername: 'admin',
    });
    expect(audit.action).toBe('create');
  });

  it('upserts daily consumption stats', async () => {
    await repo.upsertDailyStat({
      upstreamKeyId,
      realModelName: 'm1',
      dayDate: '2025-01-01',
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      avgLatencyMs: 100,
      totalCostAmount: 2,
      costCurrency: 'USD',
    });
    await repo.upsertDailyStat({
      upstreamKeyId,
      realModelName: 'm1',
      dayDate: '2025-01-01',
      requestCount: 2,
      successCount: 2,
      errorCount: 0,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      avgLatencyMs: 200,
      totalCostAmount: 5,
      costCurrency: 'USD',
    });
    const stat = await repo.findDailyStat(upstreamKeyId, 'm1', '2025-01-01');
    expect(stat!.requestCount).toBe(3);
    expect(stat!.totalCostAmount).toBe(7);
  });
});
