import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildServer } from '../../src/server/build-server.js';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientService } from '../../src/application/client.service.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import { SettingsRepository } from '../../src/infrastructure/db/repositories/settings.repository.js';
import { resetEnvForTests } from '../../src/config/env.js';
import { createTestProviderAccountWithEndpoint } from '../helpers/account.js';

describe('gateway default retries', () => {
  const originalFetch = globalThis.fetch;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let rawKey: string;
  let dbFilePath: string;
  let _upstream1Id: string;
  let _upstream2Id: string;
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
      name: 'retry-app',
      enabled: true,
    });
    rawKey = createdRawKey;

    const { account: upstream1, endpoint: endpoint1 } = await createTestProviderAccountWithEndpoint(
      db,
      {
        secretKey: process.env.MYLLM_SECRET_KEY!,
        name: 'upstream-1',
        providerType: 'openai_compatible',
        baseUrl: 'https://upstream-1.example.com',
      },
    );
    _upstream1Id = upstream1.id;
    const { account: upstream2, endpoint: endpoint2 } = await createTestProviderAccountWithEndpoint(
      db,
      {
        secretKey: process.env.MYLLM_SECRET_KEY!,
        name: 'upstream-2',
        providerType: 'openai_compatible',
        baseUrl: 'https://upstream-2.example.com',
      },
    );
    _upstream2Id = upstream2.id;

    const model = await new ModelRepository(db).createModel({
      name: 'gpt-retry',
      displayName: 'GPT Retry',
    });
    await new ModelRepository(db).createCandidate({
      modelId: model.id,
      providerAccountId: upstream1.id,
      endpointId: endpoint1.id,
      realModelName: 'model-1',
      enabled: true,
      priority: 100,
      weight: 1,
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
      name: 'gpt-retry',
      targetType: 'model',
      targetId: model.id,
    });

    await new SettingsRepository(db).seedDefaultSettings();
    await new SettingsRepository(db).updateSettings({ defaultRetries: 1 });

    app = await buildServer({
      db,
      client,
      logger: false,
      disableBackgroundJobs: true,
    });
  });

  beforeEach(async () => {
    // 清理可能因前序测试留下的 sticky binding / breaker，确保每次 retries 行为独立。
    const { stickyBindings, stickySessions, circuitBreakers } =
      await import('../../src/infrastructure/db/schema.js');
    await db.delete(stickyBindings);
    await db.delete(stickySessions);
    await db.delete(circuitBreakers);
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

  it('retries up to defaultRetries + 1 candidates and succeeds on the second', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          status: 500,
          ok: false,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ error: { message: 'first upstream down' } }),
        } as Response;
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            id: 'chatcmpl-retry',
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
      payload: JSON.stringify({ model: 'gpt-retry', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.choices[0].message.content).toBe('from second upstream');
    expect(callCount).toBe(2);
  });

  it('stops after defaultRetries + 1 attempts and returns the last error', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return {
        status: 500,
        ok: false,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: { message: `upstream ${callCount} down` } }),
      } as Response;
    };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-retry', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.statusCode).toBe(502);
    expect(callCount).toBe(2);
  });
});
