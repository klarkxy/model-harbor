import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { RoutingStateRepository } from '../../src/infrastructure/db/repositories/routing-state.repository.js';
import { ClientRepository } from '../../src/infrastructure/db/repositories/client.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import type { TestDb } from '../../src/infrastructure/db/test-helper.js';

describe('routing state repository', () => {
  let testDb: TestDb;
  let repo: RoutingStateRepository;
  let clientId: string;
  let clientKeyId: string;
  let providerAccountId: string;
  let endpointId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    repo = new RoutingStateRepository(testDb.db);
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
    const ep = await new EndpointRepository(testDb.db).create({
      providerAccountId: upstream.id,
      protocol: 'openai',
      baseUrl: 'https://api.openai.com',
      providerType: 'openai_compatible',
    });
    endpointId = ep.id;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('upserts and finds sticky binding', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await repo.upsertStickyBinding({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      conversationFingerprint: 'fp1',
      providerAccountId,
      realModelName: 'gpt-5-prod',
      lastUsedAt: now,
      expiresAt,
    });
    const found = await repo.findStickyBinding(clientId, clientKeyId, 'gpt-5', 'fp1');
    expect(found).toBeDefined();
    expect(found!.hitCount).toBe(1);
  });

  it('persists endpoint identity in sticky binding', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await repo.upsertStickyBinding({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      conversationFingerprint: 'fp3',
      providerAccountId,
      realModelName: 'gpt-5-prod',
      endpointUrl: 'https://api.openai.com/v1',
      lastUsedAt: now,
      expiresAt,
    });
    const found = await repo.findStickyBinding(clientId, clientKeyId, 'gpt-5', 'fp3');
    expect(found).toBeDefined();
    expect(found!.endpointUrl).toBe('https://api.openai.com/v1');
  });

  it('ignores expired sticky binding', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() - 1);
    await repo.upsertStickyBinding({
      clientId: clientId,
      clientKeyId: clientKeyId,
      requestedTargetName: 'gpt-5',
      conversationFingerprint: 'fp2',
      providerAccountId,
      realModelName: 'gpt-5-prod',
      lastUsedAt: now,
      expiresAt,
    });
    const found = await repo.findStickyBinding(clientId, clientKeyId, 'gpt-5', 'fp2');
    expect(found).toBeUndefined();
  });

  it('upserts circuit breaker', async () => {
    await repo.upsertBreaker({
      providerAccountId,
      endpointId,
      realModelName: 'm1',
      state: 'closed',
    });
    await repo.updateBreakerState(providerAccountId, endpointId, 'm1', 'open', {
      failureCount: 5,
      openedAt: new Date(),
    });
    const breaker = await repo.findBreaker(providerAccountId, endpointId, 'm1');
    expect(breaker!.state).toBe('open');
    expect(breaker!.failureCount).toBe(5);
  });
});
