import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { ClientRepository } from '../../../src/infrastructure/db/repositories/client.repository.js';
import { ProviderAccountRepository } from '../../../src/infrastructure/db/repositories/provider-account.repository.js';
import { ObservabilityRepository } from '../../../src/infrastructure/db/repositories/observability.repository.js';
import { loginAsAdmin } from '../../helpers/auth.js';
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

    cookie = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns usage dashboard', async () => {
    const clientRow = await new ClientRepository(testDb.db).createClient({
      name: 'Usage App',
      enabled: true,
    });
    const clientKey = await new ClientRepository(testDb.db).createClientKey({
      clientId: clientRow.id,
      name: 'usage-key',
      keyHash: 'hash',
      keyPrefix: 'ck_',
      enabled: true,
    });
    const upstream = await new ProviderAccountRepository(testDb.db).createProviderAccount({
      name: 'Usage Provider',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    await new ObservabilityRepository(testDb.db).insertUsageRecord({
      clientId: clientRow.id,
      clientKeyId: clientKey.id,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'model',
      resolvedTargetId: 'pm_1',
      providerAccountId: upstream.id,
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
    expect(body.data.groups.byProviderAccount).toHaveLength(1);
    expect(body.data.recent).toHaveLength(1);
  });
});
