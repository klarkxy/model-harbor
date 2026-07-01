import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { UsageService } from '../../src/application/usage.service.js';
import { ClientRepository } from '../../src/infrastructure/db/repositories/client.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import { ObservabilityRepository } from '../../src/infrastructure/db/repositories/observability.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('usage service', () => {
  let testDb: TestDb;
  let service: UsageService;
  let clientId: string;
  let clientKeyId: string;
  let providerAccountId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new UsageService(testDb.db);
    const client = await new ClientRepository(testDb.db).createClient({
      name: 'Test App',
      enabled: true,
    });
    clientId = client.id;
    const clientKey = await new ClientRepository(testDb.db).createClientKey({
      clientId: clientId,
      name: 'key',
      keyHash: 'hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    clientKeyId = clientKey.id;
    const upstream = await new ProviderAccountRepository(testDb.db).createProviderAccount({
      name: 'Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    providerAccountId = upstream.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('computes dashboard summary and groups', async () => {
    const repo = new ObservabilityRepository(testDb.db);
    await repo.insertUsageRecord({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      providerAccountId,
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
    expect(dashboard.groups.byClient).toHaveLength(1);
    expect(dashboard.groups.byProviderAccount[0]!.requestCount).toBe(1);
    expect(dashboard.recent).toHaveLength(1);
  });
});
