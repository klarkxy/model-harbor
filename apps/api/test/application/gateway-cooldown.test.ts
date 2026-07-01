import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildServer } from '../../src/server/build-server.js';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientService } from '../../src/application/client.service.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { ProviderAccountRepository } from '../../src/infrastructure/db/repositories/provider-account.repository.js';
import { RoutingStateRepository } from '../../src/infrastructure/db/repositories/routing-state.repository.js';
import { resetEnvForTests } from '../../src/config/env.js';
import { createTestProviderAccountWithEndpoint } from '../helpers/account.js';

describe('gateway upstream cooldown (per-candidate)', { hookTimeout: 120_000 }, () => {
  const originalFetch = globalThis.fetch;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let rawKey: string;
  let dbFilePath: string;
  let upstream1Id: string;
  let _upstream2Id: string;
  let endpoint1Id: string;
  let _endpoint2Id: string;
  let db: import('../../src/infrastructure/db/client.js').Db;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MYLLM_SECRET_KEY = 'test-secret-key-32chars-long!!';
    process.env.MYLLM_ADMIN_USERNAME = 'admin';
    process.env.MYLLM_ADMIN_PASSWORD = 'password123';
    process.env.MYLLM_ADMIN_DISPLAY_NAME = 'Admin';
    resetEnvForTests();

    const testDb = await createTestDb();
    db = testDb.db;
    const { client } = testDb;
    dbFilePath = testDb.filePath;

    const { rawKey: createdRawKey } = await new ClientService(db).createClient({
      name: 'cooldown-app',
      enabled: true,
    });
    rawKey = createdRawKey;

    const { account: upstream1, endpoint: endpoint1 } = await createTestProviderAccountWithEndpoint(
      db,
      {
        secretKey: process.env.MYLLM_SECRET_KEY!,
        name: 'cooldown-upstream-1',
        providerType: 'openai_compatible',
        baseUrl: 'https://cooldown-1.example.com',
      },
    );
    upstream1Id = upstream1.id;
    endpoint1Id = endpoint1.id;
    const { account: upstream2, endpoint: endpoint2 } = await createTestProviderAccountWithEndpoint(
      db,
      {
        secretKey: process.env.MYLLM_SECRET_KEY!,
        name: 'cooldown-upstream-2',
        providerType: 'openai_compatible',
        baseUrl: 'https://cooldown-2.example.com',
      },
    );
    _upstream2Id = upstream2.id;
    _endpoint2Id = endpoint2.id;

    const model = await new ModelRepository(db).createModel({
      name: 'gpt-cooldown',
      displayName: 'GPT Cooldown',
    });
    await new ModelRepository(db).createCandidate({
      modelId: model.id,
      providerAccountId: upstream1.id,
      endpointId: endpoint1.id,
      realModelName: 'model-1',
      enabled: true,
      priority: 100,
    });
    await new ModelRepository(db).createCandidate({
      modelId: model.id,
      providerAccountId: upstream2.id,
      endpointId: endpoint2.id,
      realModelName: 'model-2',
      enabled: true,
      priority: 200,
    });
    await new TargetRepository(db).createTargetName({
      name: 'gpt-cooldown',
      targetType: 'model',
      targetId: model.id,
    });

    await new SettingsRepository(db).seedDefaultSettings();

    app = await buildServer({
      db,
      client,
      logger: false,
      disableBackgroundJobs: true,
    });
  });

  beforeEach(async () => {
    // 收口 #6 + #13：deleteStaleBreakers 收口后只删 open + cooldown 过期的行。
    // 测试需要把表清干净，所以直接 DELETE 全部 circuit_breakers 行。
    // 之前 `listBreakers()` 是 pure SELECT，是 no-op，留下前一个测试的 breaker 状态。
    const { circuitBreakers } = await import('../../src/infrastructure/db/schema.js');
    await db.delete(circuitBreakers);
    // 重置设置为默认值，避免前一个测试修改的 threshold 影响后续测试。
    await new SettingsRepository(db).updateSettings({
      circuitBreakerFailureThreshold: 5,
      circuitBreakerBaseCooldownMs: 60_000,
      circuitBreakerMaxCooldownMs: 600_000,
    });
  });

  afterAll(async () => {
    await app.close();
    globalThis.fetch = originalFetch;
    await new Promise((r) => setTimeout(r, 100));
    await rm(dirname(dbFilePath), {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it('sets breaker cooldown per (account, endpoint, model) after retriable failures', async () => {
    // 把 breaker threshold 调到 1，让单次失败就触发 open + cooldown。
    await new SettingsRepository(db).updateSettings({ circuitBreakerFailureThreshold: 1 });

    globalThis.fetch = async () =>
      ({
        status: 503,
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
      }) as Response;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-cooldown',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(res.statusCode).toBe(502);

    // provider_accounts 行不再有 cooldownUntil 列；cooldown 仅存在于 circuit_breakers。
    const paRepo = new ProviderAccountRepository(db);
    const upstream = await paRepo.findById(upstream1Id);
    expect((upstream as { cooldownUntil?: unknown }).cooldownUntil).toBeUndefined();

    // breaker 行应当存在，且 cooldownUntil 在未来。
    const rsRepo = new RoutingStateRepository(db);
    const breaker = await rsRepo.findBreaker(upstream1Id, endpoint1Id, 'model-1');
    expect(breaker).toBeDefined();
    expect(breaker?.cooldownUntil).toBeDefined();
    expect(breaker!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('does NOT set per-candidate cooldown on first retriable failure', async () => {
    // breaker threshold 保持默认 5，确保第一次失败不会开 breaker。
    globalThis.fetch = async () =>
      ({
        status: 503,
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { message: 'server error' } }),
      }) as Response;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-cooldown',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(res.statusCode).toBe(502);

    const rsRepo = new RoutingStateRepository(db);
    const breaker = await rsRepo.findBreaker(upstream1Id, endpoint1Id, 'model-1');
    expect(breaker).toBeDefined();
    // 第一次 retriable 失败只累计窗口计数，不触发 cooldown。
    expect(breaker?.cooldownFailureCount).toBe(1);
    expect(breaker?.cooldownFailureWindowStart).toBeDefined();
    expect(breaker?.cooldownUntil).toBeNull();
  });

  it('sets per-candidate cooldown after threshold failures within the window', async () => {
    // breaker threshold 保持默认 5，让 per-candidate cooldown 逻辑先触发。
    const rsRepo = new RoutingStateRepository(db);
    const now = new Date();
    // 预置第一次失败在窗口内。
    await rsRepo.upsertBreaker({
      providerAccountId: upstream1Id,
      endpointId: endpoint1Id,
      realModelName: 'model-1',
      state: 'closed',
      failureCount: 1,
      successCount: 0,
      openCount: 0,
      cooldownUntil: null,
      cooldownFailureCount: 1,
      cooldownFailureWindowStart: now,
      openedAt: null,
      lastErrorCode: 'provider_error',
      lastErrorMessage: 'first failure',
    });

    globalThis.fetch = async () =>
      ({
        status: 503,
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { message: 'server error' } }),
      }) as Response;

    const beforeRequest = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-cooldown',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(res.statusCode).toBe(502);

    const breaker = await rsRepo.findBreaker(upstream1Id, endpoint1Id, 'model-1');
    expect(breaker).toBeDefined();
    expect(breaker?.cooldownFailureCount).toBe(2);
    // 第二次失败在 60s 窗口内，应触发 per-candidate cooldown。
    expect(breaker?.cooldownUntil).toBeDefined();
    expect(breaker!.cooldownUntil!.getTime()).toBeGreaterThan(beforeRequest);
    expect(breaker!.cooldownUntil!.getTime()).toBeLessThanOrEqual(beforeRequest + 10_000);
  });

  it('routes around a breaker in cooldown on the next request', async () => {
    // 手动把 upstream1 的 model-1 置为 cooldown 中。
    const rsRepo = new RoutingStateRepository(db);
    await rsRepo.upsertBreaker({
      providerAccountId: upstream1Id,
      endpointId: endpoint1Id,
      realModelName: 'model-1',
      state: 'open',
      failureCount: 999,
      successCount: 0,
      openCount: 1,
      cooldownUntil: new Date(Date.now() + 60_000),
      openedAt: new Date(),
      lastErrorCode: 'rate_limit',
      lastErrorMessage: 'rate limited',
    });

    let attemptedUrl: string | undefined;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      attemptedUrl = url;
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            id: 'chatcmpl-cooldown',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'model-2',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'from second upstream' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
      } as Response;
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-cooldown',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(attemptedUrl).toContain('cooldown-2.example.com');
  });
});
