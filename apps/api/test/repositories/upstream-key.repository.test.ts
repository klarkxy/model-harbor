import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('upstream key repository', () => {
  let testDb: TestDb;
  let repo: UpstreamKeyRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new UpstreamKeyRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('CRUD upstream key and quota', async () => {
    const key = await repo.createUpstreamKey({
      name: 'OpenAI',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
      authType: 'pat',
      apiKeyCiphertext: 'encrypted',
      apiKeyPrefix: 'sk-',
    });
    expect(key.name).toBe('OpenAI');

    const quota = await repo.createQuota({
      upstreamKeyId: key.id,
      period: 'month',
      requestLimit: 1000,
      enabled: true,
    });
    expect(quota.period).toBe('month');

    const foundQuota = await repo.findQuotaByUpstreamKey(key.id);
    expect(foundQuota).toBeDefined();
    expect(foundQuota!.requestLimit).toBe(1000);

    await repo.updateFreeze(key.id, true, 'test freeze');
    const frozen = await repo.findById(key.id);
    expect(frozen!.frozen).toBe(true);

    await repo.deleteUpstreamKey(key.id);
    expect(await repo.findById(key.id)).toBeUndefined();
  });

  it('increments counters', async () => {
    const key = await repo.createUpstreamKey({
      name: 'Anthropic',
      providerType: 'anthropic_compatible',
      baseUrl: 'https://api.anthropic.com',
      authType: 'pat',
      apiKeyCiphertext: 'encrypted',
      apiKeyPrefix: 'sk-ant-',
    });
    const start = new Date();
    const end = new Date(start.getTime() + 60_000);
    const counter = await repo.incrementCounter(key.id, 'hour', start, end, {
      requests: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(counter.requestCount).toBe(1);
    const counter2 = await repo.incrementCounter(key.id, 'hour', start, end, {
      requests: 2,
      inputTokens: 20,
    });
    expect(counter2.requestCount).toBe(3);
    expect(counter2.inputTokens).toBe(30);
  });
});
