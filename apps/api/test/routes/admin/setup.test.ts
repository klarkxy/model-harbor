import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { loginAsAdmin } from '../../helpers/auth.js';

describe('admin setup routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testDb = await createTestDb();
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: `file:${testDb.filePath}`,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns setup status before any admin exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/setup/status' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.hasAdmin).toBe(false);
    expect(body.data.needsSetup).toBe(true);
    expect(body.data.hasSafeSecret).toBe(false); // dev secret is default
    expect(body.data.complete).toBe(false);
  });

  it('creates first admin through security verification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/setup/security',
      payload: { username: 'admin', password: 'change-me-on-first-run', displayName: 'Admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.ok).toBe(true);
    expect(body.data.created).toBe(true);

    const status = await app.inject({ method: 'GET', url: '/api/admin/setup/status' });
    const statusBody = JSON.parse(status.payload);
    expect(statusBody.data.hasAdmin).toBe(true);
    expect(statusBody.data.needsSetup).toBe(false);
  });

  it('rejects wrong security credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/setup/security',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.ok).toBe(false);
  });

  it('creates first upstream and updates setup status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/setup/upstream',
      payload: {
        name: 'OpenAI',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.providerAccountId).toMatch(/^pa_/);

    const status = await app.inject({ method: 'GET', url: '/api/admin/setup/status' });
    const statusBody = JSON.parse(status.payload);
    expect(statusBody.data.hasUpstream).toBe(true);
  });

  it('creates public models and default consumer key through setup', async () => {
    const cookie = await loginAsAdmin(app);

    const upstream = await app.inject({
      method: 'POST',
      url: '/api/admin/setup/upstream',
      payload: {
        name: 'Test Provider',
        providerPresetId: 'openai',
        providerType: 'openai_compatible',
        baseUrl: 'https://example.com',
        apiKey: 'sk-test',
      },
    });
    const providerAccountId = JSON.parse(upstream.payload).data.providerAccountId;

    const models = await app.inject({
      method: 'POST',
      url: '/api/admin/setup/models',
      payload: {
        models: [
          {
            name: 'gpt-4o',
            candidates: [{ providerAccountId, realModelName: 'gpt-4o', priority: 100 }],
          },
        ],
      },
    });
    expect(models.statusCode).toBe(200);
    const modelsBody = JSON.parse(models.payload);
    expect(modelsBody.data.modelIds).toHaveLength(1);

    const key = await app.inject({
      method: 'POST',
      url: '/api/admin/setup/client-key',
      cookies: { session: cookie },
    });
    expect(key.statusCode).toBe(200);
    const keyBody = JSON.parse(key.payload);
    expect(keyBody.data.rawKey).toMatch(/^ck_/);
  });
});
