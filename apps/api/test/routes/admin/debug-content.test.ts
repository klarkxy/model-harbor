import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { ObservabilityRepository } from '../../../src/infrastructure/db/repositories/observability.repository.js';
import type { TestDb } from '../../../src/infrastructure/db/test-helper.js';

describe('admin debug content routes', () => {
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

  it('lists recent debug content logs', async () => {
    const repo = new ObservabilityRepository(testDb.db);
    await repo.insertDebugContentLog({
      requestTraceId: 'trace_list_1',
      promptJson: [{ role: 'user', content: 'hi' }],
      responseJson: { content: 'hello' },
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/debug-content?limit=10',
      cookies: { session: cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.some((row: { requestTraceId: string }) => row.requestTraceId === 'trace_list_1')).toBe(true);
  });

  it('returns a debug content log by trace id', async () => {
    const repo = new ObservabilityRepository(testDb.db);
    await repo.insertDebugContentLog({
      requestTraceId: 'trace_detail_1',
      promptJson: [{ role: 'user', content: 'question' }],
      responseJson: { content: 'answer' },
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/debug-content/trace_detail_1',
      cookies: { session: cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.requestTraceId).toBe('trace_detail_1');
    expect(body.data.inputTokens).toBe(2);
  });

  it('returns 404 for missing trace id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/debug-content/missing_trace',
      cookies: { session: cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
