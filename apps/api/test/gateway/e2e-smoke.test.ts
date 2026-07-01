import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildServer } from '../../src/server/build-server.js';
import { createTestDb } from '../../src/infrastructure/db/test-helper.js';
import { ClientService } from '../../src/application/client.service.js';
import { ModelRepository } from '../../src/infrastructure/db/repositories/model.repository.js';
import { TargetRepository } from '../../src/infrastructure/db/repositories/target.repository.js';
import { resetEnvForTests } from '../../src/config/env.js';
import { createTestProviderAccountWithEndpoint } from '../helpers/account.js';

describe('gateway e2e smoke', () => {
  const originalFetch = globalThis.fetch;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let rawKey: string;
  let dbFilePath: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MYLLM_SECRET_KEY = 'test-secret-key-32chars-long!!';
    process.env.MYLLM_ADMIN_USERNAME = 'admin';
    process.env.MYLLM_ADMIN_PASSWORD = 'password123';
    process.env.MYLLM_ADMIN_DISPLAY_NAME = 'Admin';
    resetEnvForTests();

    const testDb = await createTestDb();
    const { db, client } = testDb;
    dbFilePath = testDb.filePath;

    const { rawKey: createdRawKey } = await new ClientService(db).createClient({
      name: 'e2e-app',
      enabled: true,
    });
    rawKey = createdRawKey;

    const { account: upstream, endpoint } = await createTestProviderAccountWithEndpoint(db, {
      secretKey: process.env.MYLLM_SECRET_KEY!,
      name: 'openai-e2e',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com',
    });

    const model = await new ModelRepository(db).createModel({
      name: 'gpt-4o',
      displayName: 'GPT-4o',
    });
    await new ModelRepository(db).createCandidate({
      modelId: model.id,
      providerAccountId: upstream.id,
      endpointId: endpoint.id,
      realModelName: 'gpt-4o-real',
      enabled: true,
      priority: 100,
    });
    await new TargetRepository(db).createTargetName({
      name: 'gpt-4o',
      targetType: 'model',
      targetId: model.id,
    });

    globalThis.fetch = async () =>
      ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            id: 'chatcmpl-e2e',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o-real',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from e2e' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
          }),
        ok: true,
      }) as Response;

    app = await buildServer({
      db,
      client,
      logger: false,
      disableBackgroundJobs: true,
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

  it('proxies an OpenAI chat completion through the gateway', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.choices[0].message.content).toBe('Hello from e2e');
    expect(body.usage.prompt_tokens).toBe(5);
  });

  it('proxies a streaming chat completion with SSE rewriting', async () => {
    const encoder = new TextEncoder();
    try {
      globalThis.fetch = async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","model":"gpt-4o-real","choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
                ),
              );
              controller.close();
            },
          }),
        }) as Response;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json' },
        payload: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.payload).toContain('data: [DONE]');
      expect(res.payload).toContain('"model":"gpt-4o"');
      expect(res.payload).toContain('"content":"Hello"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
