import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { UsageService } from '../../src/application/usage.service.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { ObservabilityRepository } from '../../src/infrastructure/db/repositories/observability.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('usage service', () => {
  let testDb: TestDb;
  let service: UsageService;
  let appId: string;
  let consumerKeyId: string;
  let upstreamKeyId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new UsageService(testDb.db);
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

  it('computes dashboard summary and groups', async () => {
    const repo = new ObservabilityRepository(testDb.db);
    await repo.insertUsageRecord({
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
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      stickyHit: true,
    });

    const since = new Date(Date.now() - 60_000);
    const dashboard = await service.getDashboard(since);

    expect(dashboard.summary.requestCount).toBe(1);
    expect(dashboard.summary.successRate).toBe(1);
    expect(dashboard.summary.stickyHitRate).toBe(1);
    expect(dashboard.groups.byApp).toHaveLength(1);
    expect(dashboard.groups.byUpstream[0]!.requestCount).toBe(1);
    expect(dashboard.recent).toHaveLength(1);
  });
});
