import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { AppRepository } from '../../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { ObservabilityRepository } from '../../../src/infrastructure/db/repositories/observability.repository.js';
import type { TestDb } from '../../../src/infrastructure/db/test-helper.js';

describe('admin usage routes', () => {
  let app: FastifyInstance;
  let testDb: TestDb;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildServer({
      db: testDb.db,
      client: testDb.client,
      disableBackgroundJobs: true,
      logger: false,
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'change-me-on-first-run' },
    });
    expect(login.statusCode).toBe(200);
    cookie = login.cookies.find((c) => c.name === 'session')!.value;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns usage dashboard', async () => {
    const appRow = await new AppRepository(testDb.db).createApp({
      name: 'Usage App',
      enabled: true,
    });
    const consumerKey = await new ConsumerKeyRepository(testDb.db).createConsumerKey({
      appId: appRow.id,
      name: 'usage-key',
      keyHash: 'hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    const upstream = await new UpstreamKeyRepository(testDb.db).createUpstreamKey({
      name: 'Usage Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    await new ObservabilityRepository(testDb.db).insertUsageRecord({
      appId: appRow.id,
      consumerKeyId: consumerKey.id,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'public_model',
      resolvedTargetId: 'pm_1',
      upstreamKeyId: upstream.id,
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

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/usage/dashboard',
      cookies: { session: cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.summary.requestCount).toBe(1);
    expect(body.data.groups.byUpstream).toHaveLength(1);
    expect(body.data.recent).toHaveLength(1);
  });
});
