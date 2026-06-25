import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
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
    await new Promise((r) => setTimeout(r, 100));
    await rm(dirname(dbFilePath), {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it('walks through the full admin lifecycle', async () => {
    // 1. Create a local provider preset.
    const presetRes = await app.inject({
      method: 'POST',
      url: '/api/admin/provider-presets',
      cookies: { session: cookie },
      payload: {
        name: 'Custom OpenAI',
        providerType: 'openai_compatible',
        descriptorJson: {
          id: 'custom-openai',
          metadata: { displayName: 'Custom OpenAI' },
          capabilities: {
            protocols: ['openai'],
            supportsTools: true,
            supportsToolChoice: true,
            supportsVision: true,
            supportsJsonMode: true,
            supportsThinking: false,
          },
          endpoints: [
            {
              protocol: 'openai',
              baseUrl: 'https://api.custom.com',
              providerType: 'openai_compatible',
            },
          ],
        },
      },
    });
    expect(presetRes.statusCode).toBe(200);
    const preset = JSON.parse(presetRes.payload).data;
    expect(preset.source).toBe('local');

    // 2. Create an upstream key.
    const upstreamRes = await app.inject({
      method: 'POST',
      url: '/api/admin/upstream-keys',
      cookies: { session: cookie },
      payload: {
        name: 'Happy Upstream',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-happy',
      },
    });
    expect(upstreamRes.statusCode).toBe(200);
    const upstream = JSON.parse(upstreamRes.payload).data;
    expect(upstream.apiKeyPrefix).toBe('sk-h');

    // 3. Create a public model with a candidate.
    const modelRes = await app.inject({
      method: 'POST',
      url: '/api/admin/public-models',
      cookies: { session: cookie },
      payload: {
        name: 'happy-model',
        displayName: 'Happy Model',
        candidates: [{ upstreamKeyId: upstream.id, realModelName: 'gpt-4o' }],
      },
    });
    expect(modelRes.statusCode).toBe(200);
    const model = JSON.parse(modelRes.payload).data;
    expect(model.candidates).toHaveLength(1);

    // 4. Create a model group.
    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/admin/model-groups',
      cookies: { session: cookie },
      payload: {
        name: 'happy-group',
        members: [{ publicModelId: model.id, priority: 100 }],
      },
    });
    expect(groupRes.statusCode).toBe(200);

    // 5. Create an app and a consumer key.
    const appRes = await app.inject({
      method: 'POST',
      url: '/api/admin/apps',
      cookies: { session: cookie },
      payload: { name: 'Happy App' },
    });
    expect(appRes.statusCode).toBe(200);
    const appRow = JSON.parse(appRes.payload).data;

    const keyRes = await app.inject({
      method: 'POST',
      url: '/api/admin/consumer-keys',
      cookies: { session: cookie },
      payload: { appId: appRow.id, name: 'default' },
    });
    expect(keyRes.statusCode).toBe(200);
    const keyRow = JSON.parse(keyRes.payload).data;
    expect(keyRow.rawKey).toMatch(/^ck_/);

    // 6. Create a backup.
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/admin/backups',
      cookies: { session: cookie },
      payload: { type: 'full', note: 'happy path' },
    });
    expect(backupRes.statusCode).toBe(200);
    const backup = JSON.parse(backupRes.payload).data;
    expect(backup.type).toBe('full');

    // 7. Export non-sensitive config.
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/admin/backups/export-config',
      cookies: { session: cookie },
    });
    expect(exportRes.statusCode).toBe(200);
    const exported = JSON.parse(exportRes.payload).data;
    expect(exported.upstreams.some((u: { id: string }) => u.id === upstream.id)).toBe(true);
    expect(exported.publicModels.some((m: { id: string }) => m.id === model.id)).toBe(true);

    // 8. Delete the backup.
    const deleteBackupRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/backups/${backup.id}`,
      cookies: { session: cookie },
    });
    expect(deleteBackupRes.statusCode).toBe(200);

    // 9. Delete the local preset.
    const deletePresetRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/provider-presets/${preset.id}`,
      cookies: { session: cookie },
    });
    expect(deletePresetRes.statusCode).toBe(200);

    // 10. Verify the backup is gone.
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
