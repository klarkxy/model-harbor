import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../src/server/build-server.js';
import { createTestDb } from '../../../src/infrastructure/db/test-helper.js';
import { loginAsAdmin } from '../../helpers/auth.js';

describe('admin management routes', () => {
  let app: FastifyInstance;
  let cookie: string;
  let clientId: string;
  let providerAccountId: string;
  let modelId: string;
  let endpointId: string;

  beforeAll(async () => {
    const testDb = await createTestDb();
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: `file:${testDb.filePath}`,
    });

    cookie = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists provider presets including builtins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/provider-presets',
      cookies: { session: cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((p: { source: string }) => p.source === 'builtin')).toBe(true);
    expect(body.data[0]).toHaveProperty('descriptorJson.endpoints');
  });

  it('creates and manages clients', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      cookies: { session: cookie },
      payload: { name: 'Test Client', description: 'test' },
    });
    expect(create.statusCode).toBe(200);
    const createBody = JSON.parse(create.payload);
    clientId = createBody.data.client.id;
    expect(clientId).toMatch(/^cli_/);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/clients',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload).data.some((a: { id: string }) => a.id === clientId)).toBe(true);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/clients/${clientId}`,
      cookies: { session: cookie },
      payload: { description: 'updated' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.payload).data.description).toBe('updated');
  });

  it('creates and manages provider accounts without exposing secrets', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/provider-accounts',
      cookies: { session: cookie },
      payload: {
        name: 'Test Provider',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test-secret',
      },
    });
    expect(create.statusCode).toBe(200);
    const createBody = JSON.parse(create.payload);
    providerAccountId = createBody.data.id;
    expect(createBody.data.apiKeyPrefix).toBe('sk-t');
    expect(createBody.data).not.toHaveProperty('apiKeyCiphertext');
    expect(createBody.data).not.toHaveProperty('authConfigCiphertext');

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/provider-accounts',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    const listBody = JSON.parse(list.payload);
    expect(listBody.data.some((u: { id: string }) => u.id === providerAccountId)).toBe(true);

    const rotate = await app.inject({
      method: 'POST',
      url: `/api/admin/provider-accounts/${providerAccountId}/rotate`,
      cookies: { session: cookie },
      payload: { apiKey: 'sk-new-secret' },
    });
    expect(rotate.statusCode).toBe(200);
    expect(JSON.parse(rotate.payload).data.apiKeyPrefix).toBe('sk-n');

    const freeze = await app.inject({
      method: 'POST',
      url: `/api/admin/provider-accounts/${providerAccountId}/freeze`,
      cookies: { session: cookie },
      payload: { reason: 'maintenance' },
    });
    expect(freeze.statusCode).toBe(200);
    expect(JSON.parse(freeze.payload).data.frozen).toBe(true);

    const unfreeze = await app.inject({
      method: 'POST',
      url: `/api/admin/provider-accounts/${providerAccountId}/unfreeze`,
      cookies: { session: cookie },
      payload: {},
    });
    expect(unfreeze.statusCode).toBe(200);
    expect(JSON.parse(unfreeze.payload).data.frozen).toBe(false);

    const reorder = await app.inject({
      method: 'POST',
      url: '/api/admin/provider-accounts/reorder',
      cookies: { session: cookie },
      payload: [{ id: providerAccountId, displayOrder: 500 }],
    });
    expect(reorder.statusCode).toBe(200);

    // v1 收口：candidate 必须绑定 endpoint。Provider Account 创建时已自动建了
    // 默认 endpoint（resolvePresetDefaults fallback），列出后取第一个。
    const endpointsRes = await app.inject({
      method: 'GET',
      url: `/api/admin/endpoints?providerAccountId=${providerAccountId}`,
      cookies: { session: cookie },
    });
    expect(endpointsRes.statusCode).toBe(200);
    const endpointsList = JSON.parse(endpointsRes.payload).data;
    expect(endpointsList.length).toBeGreaterThan(0);
    endpointId = endpointsList[0].id;
  });

  it('creates and manages models', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/models',
      cookies: { session: cookie },
      payload: {
        name: 'test-model',
        displayName: 'Test Model',
        candidates: [{ providerAccountId: providerAccountId, endpointId, realModelName: 'gpt-4o' }],
      },
    });
    expect(create.statusCode).toBe(200);
    const createBody = JSON.parse(create.payload);
    modelId = createBody.data.id;
    expect(createBody.data.candidates).toHaveLength(1);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/models',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload).data.some((m: { id: string }) => m.id === modelId)).toBe(true);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/models/${modelId}`,
      cookies: { session: cookie },
      payload: { displayName: 'Updated Model' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.payload).data.displayName).toBe('Updated Model');

    const candidate = createBody.data.candidates[0];
    const reorder = await app.inject({
      method: 'POST',
      url: `/api/admin/models/${modelId}/candidates/reorder`,
      cookies: { session: cookie },
      payload: [{ candidateId: candidate.id, priority: 50 }],
    });
    expect(reorder.statusCode).toBe(200);
    expect(JSON.parse(reorder.payload).data.candidates[0].priority).toBe(50);
  });

  it('creates and manages channels', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/channels',
      cookies: { session: cookie },
      payload: {
        name: 'test-group',
        members: [{ modelId, priority: 100 }],
      },
    });
    expect(create.statusCode).toBe(200);
    const groupId = JSON.parse(create.payload).data.id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/channels',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload).data.some((g: { id: string }) => g.id === groupId)).toBe(true);

    const replace = await app.inject({
      method: 'POST',
      url: `/api/admin/channels/${groupId}/members/replace`,
      cookies: { session: cookie },
      payload: { members: [{ modelId, priority: 200 }] },
    });
    expect(replace.statusCode).toBe(200);
    expect(JSON.parse(replace.payload).data.members[0].priority).toBe(200);
  });

  it('creates, rotates and revokes client keys', async () => {
    // v1 Phase 6 收口：每个 Client 只有一个 active key，rotate / revoke 走
    // `/clients/:id/key/*` 子资源路由；不再提供手动创建 key 的端点。
    const list = await app.inject({
      method: 'GET',
      url: `/api/admin/clients/${clientId}/key`,
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    const initialKeys = JSON.parse(list.payload).data as Array<{ id: string }>;
    expect(initialKeys.length).toBe(1);
    const firstKeyId = initialKeys[0]!.id;

    const rotate = await app.inject({
      method: 'POST',
      url: `/api/admin/clients/${clientId}/key/rotate`,
      cookies: { session: cookie },
      payload: {},
    });
    expect(rotate.statusCode).toBe(200);
    const rotateBody = JSON.parse(rotate.payload);
    expect(rotateBody.data.rawKey).toMatch(/^ck_/);
    // v1：rotate 是在原 key 行上覆盖 hash（同一 id），不再新建行。
    expect(rotateBody.data.clientKey.id).toBe(firstKeyId);
    // 重新查一次列表，rawKey 应当只剩 rotate 后这一份。
    const list2 = await app.inject({
      method: 'GET',
      url: `/api/admin/clients/${clientId}/key`,
      cookies: { session: cookie },
    });
    const afterRotate = JSON.parse(list2.payload).data as Array<{ id: string; keyHash?: string }>;
    expect(afterRotate.length).toBe(1);
    expect(afterRotate[0]!.id).toBe(firstKeyId);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/admin/clients/${clientId}/key/revoke`,
      cookies: { session: cookie },
      payload: {},
    });
    expect(revoke.statusCode).toBe(200);
    expect(JSON.parse(revoke.payload).data.clientKey.enabled).toBe(false);
  });

  it('creates and lists backups', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/backups',
      cookies: { session: cookie },
      payload: {},
    });
    expect(create.statusCode).toBe(200);
    const backupId = JSON.parse(create.payload).data.id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/backups',
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload).data.some((b: { id: string }) => b.id === backupId)).toBe(true);
  });

  it('gets and updates settings', async () => {
    const get = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      cookies: { session: cookie },
    });
    expect(get.statusCode).toBe(200);
    const body = JSON.parse(get.payload);
    // gatewayBasePath / publicEndpointsBasePath 在 v1 已下线，响应里不再有这些字段。
    expect(body.data).not.toHaveProperty('gatewayBasePath');
    expect(body.data).not.toHaveProperty('publicEndpointsBasePath');

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      cookies: { session: cookie },
      payload: {
        defaultRequestTimeoutMs: 60_000,
        enableStickySession: false,
      },
    });
    expect(patch.statusCode).toBe(200);
    const patched = JSON.parse(patch.payload);
    expect(patched.data.defaultRequestTimeoutMs).toBe(60_000);
    expect(patched.data.enableStickySession).toBe(false);
  });

  // v1 Phase 6 验收：Client 创建时后端直接生成 active key，rawKey 只在响应里出现一次。
  it('createClient returns rawKey of the auto-generated active key', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      cookies: { session: cookie },
      payload: { name: 'Auto Key Client' },
    });
    expect(create.statusCode).toBe(200);
    const body = JSON.parse(create.payload);
    expect(body.data).toHaveProperty('client');
    expect(body.data).toHaveProperty('rawKey');
    expect(body.data.rawKey).toMatch(/^ck_/);
    // 该 Client 已经在 /clients/:id/key 列表里能查到刚刚生成的 key。
    const list = await app.inject({
      method: 'GET',
      url: `/api/admin/clients/${body.data.client.id}/key`,
      cookies: { session: cookie },
    });
    expect(list.statusCode).toBe(200);
    const listed = JSON.parse(list.payload).data as Array<{ id: string; keyPrefix: string }>;
    expect(listed.length).toBe(1);
    expect(listed[0]!.keyPrefix).toBe(body.data.rawKey.slice(0, 4));
  });
});
