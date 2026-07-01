import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/build-server.js';
import { createTestDb, type TestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientService } from '../../src/application/client.service.js';
import { ProviderAccountService } from '../../src/application/provider-account.service.js';
import { ModelService } from '../../src/application/model.service.js';
import { ChannelService } from '../../src/application/channel.service.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';

describe('gateway /v1/models', () => {
  let app: FastifyInstance;
  let testDb: TestDb;
  let allKey: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildServer({
      disableBackgroundJobs: true,
      logger: false,
      databaseUrl: `file:${testDb.filePath}`,
    });

    const clientService = new ClientService(testDb.db);
    const allResult = await clientService.createClient({
      name: 'Models Test App',
      enabled: true,
    });
    allKey = allResult.rawKey;

    const accountService = new ProviderAccountService(testDb.db, 'test-secret');
    const upstream = await accountService.createProviderAccount({
      name: 'test-upstream',
      providerType: 'openai_compatible',
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
    });
    // v1 收口：candidate 必须绑定 endpointId。account 创建时 resolvePresetDefaults
    // 已自动建了一个 endpoint（baseUrl=account.baseUrl），直接取它的 id。
    const endpointRepo = new EndpointRepository(testDb.db);
    const endpoints = await endpointRepo.listByProviderAccount(upstream.id);
    const endpointId = endpoints[0]!.id;

    const modelService = new ModelService(testDb.db);
    const gpt4o = await modelService.createModel({
      name: 'gpt-4o',
      displayName: 'GPT-4o',
      enabled: true,
      candidates: [
        { providerAccountId: upstream.id, endpointId, realModelName: 'gpt-4o-2024-08-06' },
      ],
    });

    await modelService.createModel({
      name: 'hidden-model',
      displayName: 'Hidden',
      enabled: true,
      candidates: [{ providerAccountId: upstream.id, endpointId, realModelName: 'hidden-real' }],
    });

    const channelService = new ChannelService(testDb.db);
    await channelService.createChannel({
      name: 'fast',
      displayName: 'Fast',
      enabled: true,
      members: [{ modelId: gpt4o.id }],
    });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('lists all enabled targets for all-access key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${allKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const ids = body.data.data.map((m: { id: string }) => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('hidden-model');
    expect(ids).toContain('fast');
  });

  it('excludes disabled models', async () => {
    const modelService = new ModelService(testDb.db);
    await modelService.createModel({
      name: 'disabled-model',
      displayName: 'Disabled',
      enabled: false,
      candidates: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${allKey}` },
    });
    const body = JSON.parse(res.payload);
    const ids = body.data.data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain('disabled-model');
  });
});
