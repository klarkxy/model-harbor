import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ProviderAccountService } from '../../src/application/provider-account.service.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import { EndpointRepository } from '../../src/infrastructure/db/repositories/endpoint.repository.js';
import { EndpointHealthRepository } from '../../src/infrastructure/db/repositories/endpoint-health.repository.js';
import { EndpointHealthWorker } from '../../src/application/endpoint-health-worker.js';
import { UpstreamSender } from '../../src/gateway/upstream-sender.js';
import { resetEnvForTests } from '../../src/config/env.js';

describe('endpoint health worker', () => {
  let dbFilePath: string;
  let accountId: string;
  let endpointId: string;
  let db: import('../../src/infrastructure/db/client.js').Db;
  let client: { close(): Promise<void> };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MYLLM_SECRET_KEY = 'test-secret-key-32chars-long!!';
    resetEnvForTests();

    const testDb = await createTestDb();
    db = testDb.db;
    client = testDb.client;
    dbFilePath = testDb.filePath;

    await new SettingsRepository(db).seedDefaultSettings();

    const service = new ProviderAccountService(db, process.env.MYLLM_SECRET_KEY);
    const account = await service.createProviderAccount({
      name: 'health-upstream',
      providerType: 'openai_compatible',
      baseUrl: 'https://health.example.com',
      apiKey: 'sk-health',
    });
    accountId = account.id;

    const endpointRepo = new EndpointRepository(db);
    const endpoints = await endpointRepo.listByProviderAccount(account.id);
    endpointId = endpoints[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await new Promise((r) => setTimeout(r, 100));
    await rm(dirname(dbFilePath), {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }, 60_000);

  it('records healthy status on 200 within latency threshold', async () => {
    const sender = new UpstreamSender({
      fetch: async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ data: [] }),
        }) as Response,
    });

    const worker = new EndpointHealthWorker({
      db,
      secretKey: process.env.MYLLM_SECRET_KEY!,
      sender,
    });
    const account = (await new ProviderAccountRepository(db).findById(accountId))!;
    const result = await worker.probeOne(account);

    expect(result.ok).toBe(true);

    const health = await new EndpointHealthRepository(db).findByEndpointId(endpointId);
    expect(health).toBeDefined();
    expect(health!.degraded).toBe(false);

    // Phase 2 Slice 2：endpoint health 不再混到 provider account 行。
    // Phase 5 收口后 provider_accounts.cooldown_until 列已删，字段直接不存在。
    const updated = await new ProviderAccountRepository(db).findById(accountId);
    expect((updated as { cooldownUntil?: unknown } | undefined)?.cooldownUntil).toBeUndefined();
  });

  it('records degraded status on slow response', async () => {
    await new SettingsRepository(db).updateSettings({ endpointHealthProbeDegradedLatencyMs: 5 });

    const sender = new UpstreamSender({
      fetch: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ data: [] }),
        } as Response;
      },
    });

    const worker = new EndpointHealthWorker({
      db,
      secretKey: process.env.MYLLM_SECRET_KEY!,
      sender,
    });
    const account = (await new ProviderAccountRepository(db).findById(accountId))!;
    await worker.probeOne(account);

    const health = await new EndpointHealthRepository(db).findByEndpointId(endpointId);
    expect(health).toBeDefined();
    expect(health!.degraded).toBe(true);

    // Phase 2 Slice 2：degraded 不再回写到 account 行。
    // Phase 5 收口后 cooldown_until 列已删。
    const updated = await new ProviderAccountRepository(db).findById(accountId);
    expect((updated as { cooldownUntil?: unknown } | undefined)?.cooldownUntil).toBeUndefined();
  });

  it('records unhealthy status on non-2xx response', async () => {
    const sender = new UpstreamSender({
      fetch: async () =>
        ({
          status: 503,
          ok: false,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ error: { message: 'down' } }),
        }) as Response,
    });

    const worker = new EndpointHealthWorker({
      db,
      secretKey: process.env.MYLLM_SECRET_KEY!,
      sender,
    });
    const account = (await new ProviderAccountRepository(db).findById(accountId))!;
    const result = await worker.probeOne(account);

    expect(result.ok).toBe(false);

    const health = await new EndpointHealthRepository(db).findByEndpointId(endpointId);
    expect(health).toBeDefined();
    expect(health!.degraded).toBe(true);

    // Phase 2 Slice 2：unhealthy 不再回写到 account 行。
    // Phase 5 收口后 cooldown_until 列已删。
    const updated = await new ProviderAccountRepository(db).findById(accountId);
    expect((updated as { cooldownUntil?: unknown } | undefined)?.cooldownUntil).toBeUndefined();
  });

  it('probes each endpoint and records per-endpoint health', async () => {
    const service = new ProviderAccountService(db, process.env.MYLLM_SECRET_KEY!);
    const multiEndpointAccount = await service.createProviderAccount({
      name: 'multi-endpoint-health',
      providerPresetId: 'moonshot',
      providerType: 'moonshot',
      baseUrl: 'https://api.moonshot.ai/anthropic',
      apiKey: 'sk-health',
      endpoints: [
        {
          protocol: 'anthropic',
          baseUrl: 'https://api.moonshot.ai/anthropic',
          providerType: 'anthropic_compatible',
        },
        {
          protocol: 'openai',
          baseUrl: 'https://api.moonshot.ai',
          providerType: 'openai_compatible',
        },
      ],
    });

    const sender = new UpstreamSender({
      fetch: async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ data: [] }),
        }) as Response,
    });

    const worker = new EndpointHealthWorker({
      db,
      secretKey: process.env.MYLLM_SECRET_KEY!,
      sender,
    });

    const result = await worker.probeOne(multiEndpointAccount);
    expect(result.ok).toBe(true);

    const endpointRepo = new EndpointRepository(db);
    const healthRepo = new EndpointHealthRepository(db);
    const endpoints = await endpointRepo.listByProviderAccount(multiEndpointAccount.id);
    expect(endpoints.length).toBe(2);

    for (const ep of endpoints) {
      const health = await healthRepo.findByEndpointId(ep.id);
      expect(health).toBeDefined();
      expect(health!.degraded).toBe(false);
    }
  });
});
