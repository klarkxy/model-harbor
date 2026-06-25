import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { AppRepository } from '../../../src/infrastructure/db/repositories/app.repository.js';
import { ConsumerKeyRepository } from '../../../src/infrastructure/db/repositories/consumer-key.repository.js';
import { UpstreamKeyRepository } from '../../../src/infrastructure/db/repositories/upstream-key.repository.js';
import { ObservabilityRepository } from '../../../src/infrastructure/db/repositories/observability.repository.js';
import type { TestDb } from '../../../src/infrastructure/db/test-helper.js';

describe('admin trace routes', () => {
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

  async function seedTrace(traceId: string, status: string) {
    const appRow = await new AppRepository(testDb.db).createApp({
      name: `Trace App ${traceId}`,
      enabled: true,
    });
    const consumerKey = await new ConsumerKeyRepository(testDb.db).createConsumerKey({
      appId: appRow.id,
      name: `trace-key-${traceId}`,
      keyHash: `${traceId}-hash`,
      keyPrefix: 'ck_',
      enabled: true,
    });
    const upstream = await new UpstreamKeyRepository(testDb.db).createUpstreamKey({
      name: `Trace Provider ${traceId}`,
      providerType: 'openai_compatible',
      baseUrl: 'https://api.example.com',
      authType: 'pat',
      apiKeyCiphertext: 'enc',
      apiKeyPrefix: 'sk-',
    });
    const repo = new ObservabilityRepository(testDb.db);
    await repo.insertUsageRecord({
      appId: appRow.id,
      consumerKeyId: consumerKey.id,
      requestedTargetName: 'gpt-5',
      resolvedTargetType: 'public_model',
      resolvedTargetId: 'pm_1',
      requestTraceId: traceId,
      upstreamKeyId: upstream.id,
      realModelName: 'gpt-5-prod',
      sourceProtocol: 'openai',
      providerType: 'openai_compatible',
      status,
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      stickyHit: false,
    });
    await repo.insertTraceLog({
      requestTraceId: traceId,
      step: 'routing_decision',
      stepIndex: 0,
      status: 'ok',
    });
    return { appId: appRow.id, consumerKeyId: consumerKey.id, upstreamKeyId: upstream.id };
  }

  it('returns trace list', async () => {
    const traceId = 'route_trace_1';
    await seedTrace(traceId, 'success');

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/traces',
      cookies: { session: cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
    const trace = body.data.find((t: { requestTraceId: string }) => t.requestTraceId === traceId);
    expect(trace).toBeDefined();
    expect(trace.attemptCount).toBe(1);
  });

  it('returns trace detail', async () => {
    const traceId = 'route_trace_2';
    await seedTrace(traceId, 'provider_error');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/traces/${encodeURIComponent(traceId)}`,
      cookies: { session: cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.summary.requestTraceId).toBe(traceId);
    expect(body.data.events).toBeInstanceOf(Array);
    expect(body.data.events.length).toBe(1);
  });

  it('returns 404 for unknown trace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/traces/nonexistent_trace',
      cookies: { session: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
