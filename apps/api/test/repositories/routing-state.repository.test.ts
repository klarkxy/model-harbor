import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { RoutingStateRepository } from '../../src/infrastructure/db/repositories/routing-state.repository.js';
import { AppRepository } from '../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../src/infrastructure/db/repositories/upstream-key.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('routing state repository', () => {
  let testDb: TestDb;
  let repo: RoutingStateRepository;
  let appId: string;
  let consumerKeyId: string;
  let upstreamKeyId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new RoutingStateRepository(testDb.db);
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

  it('upserts and finds sticky binding', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await repo.upsertStickyBinding({
      appId,
      consumerKeyId,
      requestedTargetName: 'gpt-5',
      conversationFingerprint: 'fp1',
      upstreamKeyId,
      realModelName: 'gpt-5-prod',
      lastUsedAt: now,
      expiresAt,
    });
    const found = await repo.findStickyBinding(appId, consumerKeyId, 'gpt-5', 'fp1');
    expect(found).toBeDefined();
    expect(found!.hitCount).toBe(1);
  });

  it('ignores expired sticky binding', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() - 1);
    await repo.upsertStickyBinding({
      appId,
      consumerKeyId,
      requestedTargetName: 'gpt-5',
      conversationFingerprint: 'fp2',
      upstreamKeyId,
      realModelName: 'gpt-5-prod',
      lastUsedAt: now,
      expiresAt,
    });
    const found = await repo.findStickyBinding(appId, consumerKeyId, 'gpt-5', 'fp2');
    expect(found).toBeUndefined();
  });

  it('upserts circuit breaker', async () => {
    await repo.upsertBreaker({ upstreamKeyId, realModelName: 'm1', state: 'closed' });
    await repo.updateBreakerState(upstreamKeyId, 'm1', 'open', {
      failureCount: 5,
      openedAt: new Date(),
    });
    const breaker = await repo.findBreaker(upstreamKeyId, 'm1');
    expect(breaker!.state).toBe('open');
    expect(breaker!.failureCount).toBe(5);
  });
});
