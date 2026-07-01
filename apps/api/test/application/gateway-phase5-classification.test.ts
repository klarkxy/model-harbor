import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildServer } from '../../src/server/build-server.js';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientService } from '../../src/application/client.service.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { RoutingStateRepository } from '../../src/infrastructure/db/repositories/routing-state.repository.js';
import { resetEnvForTests } from '../../src/config/env.js';
import { createTestProviderAccountWithEndpoint } from '../helpers/account.js';
import { circuitBreakers } from '../../src/infrastructure/db/schema.js';
import type { Db } from '../../src/infrastructure/db/client.js';

/**
 * v1 Phase 5：错误分类细化验收测试。
 *
 * 核心断言（来自 docs/v1-closure.md 第 89 行与 v1-construction-todo Phase 5 错误分类）：
 * - bad_request / auth / permission / model_not_found **只**记录 Trace 和配置风险提示，
 *   不进入 cooldown / breaker，不应该把整个 Provider Account 的所有 candidate 打掉。
 * - timeout / rate_limit / quota / overloaded / 5xx 仍计入 cooldown / breaker。
 *
 * 测试构造一个 model 有两个 candidate（同一 provider account / 不同 endpoint），
 * 验证：上游返回 401 / 400 / 404 时 circuit_breakers 表无新行；
 * 上游返回 503 / 429 / 529 时 circuit_breakers 表新增一行。
 */
describe(
  'gateway Phase 5 error classification (no cooldown on request-side errors)',
  { hookTimeout: 120_000 },
  () => {
    const originalFetch = globalThis.fetch;
    let app: Awaited<ReturnType<typeof buildServer>>;
    let rawKey: string;
    let dbFilePath: string;
    let upstreamId: string;
    let endpoint1Id: string;
    let endpoint2Id: string;
    let _modelId: string;
    let db: Db;

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
        name: 'phase5-app',
        enabled: true,
      });
      rawKey = createdRawKey;

      // 单一 provider account 拥有两个 endpoint（模拟 provider preset 的多 endpoint）。
      const { account, endpoint: ep1 } = await createTestProviderAccountWithEndpoint(db, {
        secretKey: process.env.MYLLM_SECRET_KEY!,
        name: 'phase5-upstream',
        providerType: 'openai_compatible',
        baseUrl: 'https://phase5-ep1.example.com',
      });
      upstreamId = account.id;
      endpoint1Id = ep1.id;

      const { EndpointRepository } =
        await import('../../src/infrastructure/db/repositories/endpoint.repository.js');
      const ep2 = await new EndpointRepository(db).create({
        providerAccountId: account.id,
        protocol: 'openai',
        baseUrl: 'https://phase5-ep2.example.com',
        path: '/v1/chat/completions',
        providerType: account.providerType,
        capabilities: ['chat'],
        enabled: true,
      });
      endpoint2Id = ep2.id;

      const model = await new ModelRepository(db).createModel({
        name: 'phase5-model',
        displayName: 'Phase 5 Model',
      });
      _modelId = model.id;
      await new ModelRepository(db).createCandidate({
        modelId: model.id,
        providerAccountId: account.id,
        endpointId: endpoint1Id,
        realModelName: 'real-model',
        enabled: true,
        priority: 100,
      });
      await new ModelRepository(db).createCandidate({
        modelId: model.id,
        providerAccountId: account.id,
        endpointId: endpoint2Id,
        realModelName: 'real-model',
        enabled: true,
        priority: 200,
      });
      await new TargetRepository(db).createTargetName({
        name: 'phase5-model',
        targetType: 'model',
        targetId: model.id,
      });

      await new SettingsRepository(db).seedDefaultSettings();
      // 调整阈值让单次失败也容易看到效果。
      await new SettingsRepository(db).updateSettings({
        circuitBreakerFailureThreshold: 1,
        circuitBreakerBaseCooldownMs: 30_000,
      });

      app = await buildServer({
        db,
        client,
        logger: false,
        disableBackgroundJobs: true,
      });
    });

    beforeEach(async () => {
      await db.delete(circuitBreakers);
      const { requestTraceLogs, stickyBindings, stickySessions, endpointHealth } =
        await import('../../src/infrastructure/db/schema.js');
      await db.delete(requestTraceLogs);
      await db.delete(stickyBindings);
      await db.delete(stickySessions);
      await db.delete(endpointHealth);
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
    }, 120_000);

    function mockUpstreamStatus(status: number, body: Record<string, unknown>): typeof fetch {
      return (async () =>
        ({
          status,
          ok: false,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify(body),
        }) as Response) as typeof fetch;
    }

    async function injectChatCompletions(): Promise<import('fastify').FastifyReply> {
      return app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
        payload: JSON.stringify({
          model: 'phase5-model',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
    }

    it('upstream 401 (auth) does NOT open breaker or cooldown any candidate', async () => {
      globalThis.fetch = mockUpstreamStatus(401, {
        error: { message: 'Incorrect API key', code: 'invalid_api_key' },
      });
      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(401);

      const rsRepo = new RoutingStateRepository(db);
      const breaker = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker).toBeUndefined();
      // 同账号另一个 endpoint 也不应有 breaker。
      const breaker2 = await rsRepo.findBreaker(upstreamId, endpoint2Id, 'real-model');
      expect(breaker2).toBeUndefined();
    });

    it('upstream 403 (permission) does NOT open breaker or cooldown any candidate', async () => {
      globalThis.fetch = mockUpstreamStatus(403, {
        error: { message: 'Forbidden', code: 'forbidden' },
      });
      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(401);

      const rsRepo = new RoutingStateRepository(db);
      const breaker = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker).toBeUndefined();
    });

    it('upstream 400 (bad_request) does NOT open breaker or cooldown any candidate', async () => {
      globalThis.fetch = mockUpstreamStatus(400, {
        error: { message: 'Bad request', code: 'invalid_request' },
      });
      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(400);

      const rsRepo = new RoutingStateRepository(db);
      const breaker = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker).toBeUndefined();
    });

    it('upstream 404 with model code does NOT open breaker or cooldown any candidate', async () => {
      globalThis.fetch = mockUpstreamStatus(404, {
        error: { message: 'Model not found', code: 'model_not_found' },
      });
      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(404);

      const rsRepo = new RoutingStateRepository(db);
      const breaker = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker).toBeUndefined();
    });

    it('upstream 503 (5xx) DOES open breaker for that candidate', async () => {
      globalThis.fetch = mockUpstreamStatus(503, {
        error: { message: 'Service Unavailable', code: 'service_unavailable' },
      });
      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(502);

      const rsRepo = new RoutingStateRepository(db);
      const breaker = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker).toBeDefined();
      expect(breaker!.state).toBe('open');
      expect(breaker!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('upstream 429 (rate_limit) DOES open breaker for that candidate only', async () => {
      globalThis.fetch = mockUpstreamStatus(429, {
        error: { message: 'Rate limit', code: 'rate_limit_exceeded' },
      });
      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(429);

      const rsRepo = new RoutingStateRepository(db);
      const breaker = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker).not.toBeNull();
      expect(breaker!.state).toBe('open');
    });

    it('after 401 on endpoint1, sibling endpoint (same account) can still serve 200 OK', async () => {
      // endpoint1 返回 401（auth）→ 不应写 breaker；
      // endpoint2 返回 200 OK → 整体请求成功。
      const attemptedUrls: string[] = [];
      globalThis.fetch = (async (input: unknown) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        attemptedUrls.push(url);
        if (url.includes('phase5-ep1.example.com')) {
          return {
            status: 401,
            ok: false,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({ error: { message: 'Incorrect API key', code: 'invalid_api_key' } }),
          } as Response;
        }
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              id: 'chatcmpl-phase5',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'real-model',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'ok from ep2' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
        } as Response;
      }) as typeof fetch;

      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(200);
      // candidate 1 失败，candidate 2 被尝试；attempts 至少 2 次，命中 endpoint2。
      expect(attemptedUrls.length).toBeGreaterThanOrEqual(2);
      expect(attemptedUrls.some((u) => u.includes('phase5-ep2.example.com'))).toBe(true);

      // 关键断言：endpoint1 因 401 没进 cooldown / breaker。
      const rsRepo = new RoutingStateRepository(db);
      const breaker1 = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker1).toBeUndefined();
    });

    it('after 503 on endpoint1 only, sibling endpoint (same account) can still serve 200 OK', async () => {
      // endpoint1 返回 503 → 应该写 breaker（计入 5xx）；
      // endpoint2 返回 200 OK → 整体请求成功，endpoint2 不受影响。
      const attemptedUrls: string[] = [];
      globalThis.fetch = (async (input: unknown) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        attemptedUrls.push(url);
        if (url.includes('phase5-ep1.example.com')) {
          return {
            status: 503,
            ok: false,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => JSON.stringify({ error: { message: 'Service Unavailable' } }),
          } as Response;
        }
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              id: 'chatcmpl-phase5-503',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'real-model',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'ok from ep2 after 503' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
        } as Response;
      }) as typeof fetch;

      const res = await injectChatCompletions();
      expect(res.statusCode).toBe(200);
      // routing 必须先尝试 ep1（priority=100 优先），然后 failover 到 ep2。
      expect(attemptedUrls.length).toBeGreaterThanOrEqual(2);
      expect(attemptedUrls.some((u) => u.includes('phase5-ep1.example.com'))).toBe(true);
      expect(attemptedUrls.some((u) => u.includes('phase5-ep2.example.com'))).toBe(true);

      const rsRepo = new RoutingStateRepository(db);
      // endpoint1 因 503 写了 breaker。
      const breaker1 = await rsRepo.findBreaker(upstreamId, endpoint1Id, 'real-model');
      expect(breaker1).toBeDefined();
      expect(breaker1!.state).toBe('open');
      // endpoint2 不应被波及。
      const breaker2 = await rsRepo.findBreaker(upstreamId, endpoint2Id, 'real-model');
      expect(breaker2).toBeUndefined();
    });
  },
);
