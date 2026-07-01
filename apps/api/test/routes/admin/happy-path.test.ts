import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { loginAsAdmin } from '../../helpers/auth.js';
import type { FastifyInstance } from 'fastify';

describe('admin e2e happy path', () => {
  let app: FastifyInstance;
  let cookie: string;
  let dbFilePath: string;

  beforeAll(async () => {
    const testDb = await createTestDb();
    dbFilePath = testDb.filePath;
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: `file:${testDb.filePath}`,
    });
    cookie = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => setTimeout(r, 100));
    await rm(dirname(dbFilePath), {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it('walks through the full admin lifecycle', async () => {
    // 1. Create a provider account.
    const upstreamRes = await app.inject({
      method: 'POST',
      url: '/api/admin/provider-accounts',
      cookies: { session: cookie },
      payload: {
        name: 'Happy Provider',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-happy',
      },
    });
    expect(upstreamRes.statusCode).toBe(200);
    const upstream = JSON.parse(upstreamRes.payload).data;
    expect(upstream.apiKeyPrefix).toBe('sk-h');

    // 1b. v1 收口：candidate 必须绑定 endpoint。Provider Account 创建时已自动
    // 建了默认 endpoint（resolvePresetDefaults fallback），列出后取第一个。
    const endpointsRes = await app.inject({
      method: 'GET',
      url: `/api/admin/endpoints?providerAccountId=${upstream.id}`,
      cookies: { session: cookie },
    });
    expect(endpointsRes.statusCode).toBe(200);
    const endpointsList = JSON.parse(endpointsRes.payload).data;
    expect(endpointsList.length).toBeGreaterThan(0);
    const endpoint = endpointsList[0];

    // 2. Create a model with a candidate.
    const modelRes = await app.inject({
      method: 'POST',
      url: '/api/admin/models',
      cookies: { session: cookie },
      payload: {
        name: 'happy-model',
        displayName: 'Happy Model',
        candidates: [
          {
            providerAccountId: upstream.id,
            endpointId: endpoint.id,
            realModelName: 'gpt-4o',
          },
        ],
      },
    });
    expect(modelRes.statusCode).toBe(200);
    const model = JSON.parse(modelRes.payload).data;
    expect(model.candidates).toHaveLength(1);

    // 3. Create a channel.
    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/admin/channels',
      cookies: { session: cookie },
      payload: {
        name: 'happy-group',
        members: [{ modelId: model.id, priority: 100 }],
      },
    });
    expect(groupRes.statusCode).toBe(200);

    // 4. Create a client — createClient 自动生成 active key，rawKey 在响应里。
    const appRes = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      cookies: { session: cookie },
      payload: { name: 'Happy Client' },
    });
    expect(appRes.statusCode).toBe(200);
    const autoKeyRow = JSON.parse(appRes.payload).data;
    expect(autoKeyRow.rawKey).toMatch(/^ck_/);

    // 5. Create a backup.
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/admin/backups',
      cookies: { session: cookie },
      payload: { type: 'full', note: 'happy path' },
    });
    expect(backupRes.statusCode).toBe(200);
    const backup = JSON.parse(backupRes.payload).data;
    expect(backup.type).toBe('full');

    // 6. Export non-sensitive config.
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/admin/backups/export-config',
      cookies: { session: cookie },
    });
    expect(exportRes.statusCode).toBe(200);
    const exported = JSON.parse(exportRes.payload).data;
    expect(exported.upstreams.some((u: { id: string }) => u.id === upstream.id)).toBe(true);
    expect(exported.models.some((m: { id: string }) => m.id === model.id)).toBe(true);

    // 7. Delete the backup.
    const deleteBackupRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/backups/${backup.id}`,
      cookies: { session: cookie },
    });
    expect(deleteBackupRes.statusCode).toBe(200);

    // 8. Verify the backup is gone.
    const listBackupsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/backups',
      cookies: { session: cookie },
    });
    expect(listBackupsRes.statusCode).toBe(200);
    expect(
      JSON.parse(listBackupsRes.payload).data.some((b: { id: string }) => b.id === backup.id),
    ).toBe(false);
  });
});
