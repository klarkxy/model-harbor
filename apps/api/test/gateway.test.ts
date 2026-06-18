import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  apps,
  consumerKeys,
  publicModelCandidates,
  publicModels,
  targetNames,
  upstreamKeys,
} from '../src/modules/db/index.js';
import { generateId } from '@modelharbor/shared';
import { makeGatewayRig, getUpstreamRow, type GatewayTestRig } from './gateway-helper.js';

const ANTHROPIC_BODY = {
  model: 'coding-fast',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 64,
};

const OPENAI_BODY = {
  model: 'coding-fast',
  messages: [{ role: 'user', content: 'hello' }],
};

function anthropicHeader(key: string): Record<string, string> {
  return { 'x-api-key': key, 'content-type': 'application/json' };
}

function bearerHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

describe('gateway auth', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('rejects /v1/messages without a consumer key', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /v1/messages with a malformed consumer key', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'sk-not-a-mh-key' },
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /v1/messages with a wrong consumer key', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader('mh_wrong-key-value'),
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /v1/chat/completions without a consumer key', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: OPENAI_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a revoked consumer key', async () => {
    await rig.db
      .update(consumerKeys)
      .set({ enabled: false, revokedAt: new Date() })
      .where(eq(consumerKeys.id, rig.ids.consumerKeyId));
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects when the owning app is disabled', async () => {
    await rig.db.update(apps).set({ enabled: false }).where(eq(apps.id, rig.ids.appId));
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('gateway target resolution and access', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns an Anthropic-shaped 404 for an unknown model on /v1/messages', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: { ...ANTHROPIC_BODY, model: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('not_found_error');
  });

  it('returns an OpenAI-shaped 404 for an unknown model on /v1/chat/completions', async () => {
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: bearerHeader(rig.rawConsumerKey),
      payload: { ...OPENAI_BODY, model: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { type: string; code: string; message: string } };
    expect(body.error.type).toBe('TargetNotFoundError');
    expect(body.error.code).toBe('target_not_found');
  });

  it('returns 403 when the consumer key has no access to the requested model', async () => {
    // Build a second public model the consumer key cannot access.
    const now = new Date();
    const otherPmId = generateId('publicModel');
    await rig.db.insert(publicModels).values({
      id: otherPmId,
      name: 'secret-model',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await rig.db.insert(targetNames).values({
      id: `tn_${otherPmId.slice(-6)}`,
      name: 'secret-model',
      targetType: 'public_model',
      targetId: otherPmId,
      createdAt: now,
    });
    await rig.db.insert(publicModelCandidates).values({
      id: generateId('publicModel') + '_c',
      publicModelId: otherPmId,
      upstreamKeyId: rig.upstreamKeyId,
      realModelName: 'secret-real',
      enabled: true,
      priority: 100,
      weight: 1,
      createdAt: now,
      updatedAt: now,
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: { ...ANTHROPIC_BODY, model: 'secret-model' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('gateway happy path: /v1/messages via anthropic_compatible upstream', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig({ providerType: 'anthropic_compatible' });
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns an Anthropic-shaped non-stream response', async () => {
    rig.fake.setAnthropicResponse({
      status: 200,
      body: {
        id: 'msg_42',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi from fake' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 7 },
      },
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: anthropicHeader(rig.rawConsumerKey),
      payload: ANTHROPIC_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      type: string;
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };
    expect(body.id).toBe('msg_42');
    expect(body.type).toBe('message');
    expect(body.content[0]?.text).toBe('hi from fake');
    expect(body.usage.input_tokens).toBe(3);
    expect(body.usage.output_tokens).toBe(7);
    expect(body.model).toBe('fake-real-model');
    // Fake upstream got the request with x-api-key and a real model.
    expect(rig.fake.anthropicRequests).toHaveLength(1);
    expect(rig.fake.anthropicRequests[0]!.headers['x-api-key']).toBe(rig.rawUpstreamKey);
    expect(rig.fake.anthropicRequests[0]!.body).toMatchObject({
      model: 'fake-real-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });
});

describe('gateway happy path: /v1/chat/completions via openai_compatible upstream', () => {
  let rig: GatewayTestRig;
  beforeEach(async () => {
    rig = await makeGatewayRig({
      providerType: 'openai_compatible',
      publicModelName: 'fast-chat',
    });
  });
  afterEach(async () => {
    await rig.close();
  });

  it('returns an OpenAI-shaped non-stream response', async () => {
    rig.fake.setOpenAIResponse({
      status: 200,
      body: {
        id: 'cmpl-1',
        object: 'chat.completion',
        created: 1700000000,
        model: 'fake-real-model',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok chat' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
      },
    });
    const res = await rig.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: bearerHeader(rig.rawConsumerKey),
      payload: { ...OPENAI_BODY, model: 'fast-chat' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      object: string;
      model: string;
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('fake-real-model');
    expect(body.choices[0]?.message.content).toBe('ok chat');
    expect(body.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 });
    expect(rig.fake.openaiRequests).toHaveLength(1);
    expect(rig.fake.openaiRequests[0]!.headers['authorization']).toBe(
      `Bearer ${rig.rawUpstreamKey}`,
    );
  });
});

describe('gateway candidate filtering', () => {
  it('skips a frozen upstream key and returns 503 with no candidates left', async () => {
    const rig = await makeGatewayRig({ upstreamFrozen: true });
    try {
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(503);
      // Anthropic error shape: { type: "error", error: { type, message } }
      const body = res.json() as { type: string; error: { type: string; message: string } };
      expect(body.type).toBe('error');
      expect(body.error.type).toBeTruthy();
      expect(rig.fake.anthropicRequests).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });
  it('skips a disabled upstream key', async () => {
    const rig = await makeGatewayRig({ upstreamEnabled: false });
    try {
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(503);
      expect(rig.fake.anthropicRequests).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });

  it('skips an upstream key that is in cooldown', async () => {
    const future = new Date(Date.now() + 60_000);
    const rig = await makeGatewayRig({ cooldownUntil: future });
    try {
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(503);
      expect(rig.fake.anthropicRequests).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });

  it('skips a disabled public model even when the upstream is healthy', async () => {
    const rig = await makeGatewayRig({ publicModelEnabled: false });
    try {
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(503);
      expect(rig.fake.anthropicRequests).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });

  it('cross-protocol fallback converts an anthropic request to an openai_compatible upstream', async () => {
    const rig = await makeGatewayRig({ providerType: 'openai_compatible' });
    try {
      rig.fake.setOpenAIResponse({
        status: 200,
        body: {
          id: 'cmpl_cross_a',
          object: 'chat.completion',
          created: 1700000000,
          model: 'fake-real-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'cross ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'cross ok',
      );
      expect(rig.fake.openaiRequests).toHaveLength(1);
    } finally {
      await rig.close();
    }
  });

  it('cross-protocol fallback converts an openai request to an anthropic_compatible upstream', async () => {
    const rig = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    try {
      rig.fake.setAnthropicResponse({
        status: 200,
        body: {
          id: 'msg_cross_o',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'cross ok' }],
          model: 'fake-real-model',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 2, output_tokens: 3 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: bearerHeader(rig.rawConsumerKey),
        payload: OPENAI_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect(
        (res.json() as { choices: Array<{ message: { content: string } }> }).choices[0]?.message
          .content,
      ).toBe('cross ok');
      expect(rig.fake.anthropicRequests).toHaveLength(1);
    } finally {
      await rig.close();
    }
  });
});

describe('gateway priority policy', () => {
  it('selects the lower-priority candidate when the higher one is filtered out', async () => {
    // Build a rig with two upstream keys: an anthropic one at priority 10
    // (frozen) and a second anthropic one at priority 100 (healthy). The
    // router should skip the frozen one and use the healthy one.
    const rig = await makeGatewayRig();
    try {
      const now = new Date();
      const healthyUkId = generateId('upstreamKey');
      const healthyEnc = (await import('../src/modules/auth/crypto.js')).encryptSecret(
        'sk-healthy-key-1',
        rig.secretKey,
      );
      await rig.db.insert(upstreamKeys).values({
        id: healthyUkId,
        name: 'Healthy upstream',
        providerType: 'anthropic_compatible',
        baseUrl: rig.fake.baseUrl,
        apiKeyCiphertext: healthyEnc.ciphertext,
        apiKeyPrefix: 'sk-h',
        supportedModelsJson: JSON.stringify(['fake-real-model']),
        enabled: true,
        frozen: false,
        createdAt: now,
        updatedAt: now,
      });
      await rig.db.insert(publicModelCandidates).values({
        id: generateId('publicModel') + '_c2',
        publicModelId: rig.ids.publicModelId,
        upstreamKeyId: healthyUkId,
        realModelName: 'fake-real-model',
        enabled: true,
        priority: 100,
        weight: 1,
        createdAt: now,
        updatedAt: now,
      });
      // Freeze the original (priority 100) upstream so the healthy one wins.
      // The original was seeded at priority 100 too, so order by id is
      // deterministic and we freeze the original.
      await rig.db
        .update(upstreamKeys)
        .set({ frozen: true, frozenReason: 'test' })
        .where(eq(upstreamKeys.id, rig.upstreamKeyId));

      rig.fake.setAnthropicResponse({
        status: 200,
        body: {
          id: 'msg_pri',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'from healthy' }],
          model: 'fake-real-model',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'from healthy',
      );
    } finally {
      await rig.close();
    }
  });
});

describe('gateway failover with cooldown', () => {
  it('cools down a quota-exhausted upstream and falls back to the next candidate', async () => {
    // Two upstream keys: primary (priority 100, picked first) and backup
    // (priority 200, picked second). The fake returns a quota-style 429
    // with an `insufficient_quota` code on the first call and a 200 OK on
    // the second. The router should write a quota-shaped cooldown to the
    // primary and fall back to the backup.
    const rig = await makeGatewayRig();
    try {
      const now = new Date();
      const backupUkId = generateId('upstreamKey');
      const { encryptSecret } = await import('../src/modules/auth/crypto.js');
      const backupEnc = encryptSecret('sk-backup-key-2', rig.secretKey);
      await rig.db.insert(upstreamKeys).values({
        id: backupUkId,
        name: 'Backup upstream',
        providerType: 'anthropic_compatible',
        baseUrl: rig.fake.baseUrl,
        apiKeyCiphertext: backupEnc.ciphertext,
        apiKeyPrefix: 'sk-b',
        supportedModelsJson: JSON.stringify(['fake-real-model']),
        enabled: true,
        frozen: false,
        createdAt: now,
        updatedAt: now,
      });
      await rig.db.insert(publicModelCandidates).values({
        id: generateId('publicModel') + '_b',
        publicModelId: rig.ids.publicModelId,
        upstreamKeyId: backupUkId,
        realModelName: 'fake-real-model',
        enabled: true,
        priority: 200,
        weight: 1,
        createdAt: now,
        updatedAt: now,
      });
      // Original stays at priority 100 and is tried first.
      rig.fake.enqueueAnthropicResponse({
        status: 429,
        body: {
          type: 'error',
          error: { type: 'insufficient_quota', message: 'quota exhausted' },
        },
      });
      rig.fake.setAnthropicResponse({
        status: 200,
        body: {
          id: 'msg_b',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'from backup' }],
          model: 'fake-real-model',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'from backup',
      );
      expect(rig.fake.anthropicRequests).toHaveLength(2);
      // Quota cooldown was written to the primary.
      const primary = await getUpstreamRow(rig.db, rig.upstreamKeyId);
      expect(primary!.cooldownUntil).toBeTruthy();
      expect(primary!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(primary!.lastErrorCode).toBe('insufficient_quota');
      expect(primary!.lastErrorMessage).toBe('quota exhausted');
    } finally {
      await rig.close();
    }
  });
  it('applies a cooldown in the DB when the upstream returns 429 rate_limit_error', async () => {
    // Use only the seeded upstream. After the 429, the gateway has no
    // fallback so it should return the upstream's error and persist a
    // cooldown on the upstream key.
    const rig = await makeGatewayRig();
    try {
      rig.fake.setAnthropicResponse({
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'too many' } },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      // No fallback candidate: 429 from the upstream maps to provider_rate_limit
      // → 429.
      expect(res.statusCode).toBe(429);
      const body = res.json() as { type: string; error: { type: string; message: string } };
      expect(body.type).toBe('error');
      expect(body.error.type).toBe('rate_limit_error');
      expect(body.error.message).toBe('too many');

      // Cooldown was applied.
      const row = await getUpstreamRow(rig.db, rig.upstreamKeyId);
      expect(row).not.toBeNull();
      expect(row!.cooldownUntil).toBeTruthy();
      expect(row!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(row!.lastErrorCode).toBe('rate_limit_error');
      expect(row!.lastErrorMessage).toBe('too many');
    } finally {
      await rig.close();
    }
  });

  it('falls back across candidates when the first returns a 429 rate_limit_error', async () => {
    // Primary upstream is picked first (lower priority number). The fake
    // answers the first call with a 429 rate_limit_error, then a 200 OK.
    // The router should cooldown the primary and try the backup.
    const rig = await makeGatewayRig();
    try {
      const now = new Date();
      const backupUkId = generateId('upstreamKey');
      const { encryptSecret } = await import('../src/modules/auth/crypto.js');
      const backupEnc = encryptSecret('sk-backup-key-2', rig.secretKey);
      await rig.db.insert(upstreamKeys).values({
        id: backupUkId,
        name: 'Backup upstream',
        providerType: 'anthropic_compatible',
        baseUrl: rig.fake.baseUrl,
        apiKeyCiphertext: backupEnc.ciphertext,
        apiKeyPrefix: 'sk-b',
        supportedModelsJson: JSON.stringify(['fake-real-model']),
        enabled: true,
        frozen: false,
        createdAt: now,
        updatedAt: now,
      });
      await rig.db.insert(publicModelCandidates).values({
        id: generateId('publicModel') + '_b',
        publicModelId: rig.ids.publicModelId,
        upstreamKeyId: backupUkId,
        realModelName: 'fake-real-model',
        enabled: true,
        priority: 200,
        weight: 1,
        createdAt: now,
        updatedAt: now,
      });
      // Original stays at priority 100 (picked first).
      rig.fake.enqueueAnthropicResponse({
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'rl' } },
      });
      rig.fake.setAnthropicResponse({
        status: 200,
        body: {
          id: 'msg_b',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'from backup' }],
          model: 'fake-real-model',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'from backup',
      );
      expect(rig.fake.anthropicRequests).toHaveLength(2);
      const primary = await getUpstreamRow(rig.db, rig.upstreamKeyId);
      expect(primary!.cooldownUntil).toBeTruthy();
      expect(primary!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(primary!.lastErrorCode).toBe('rate_limit_error');
    } finally {
      await rig.close();
    }
  });
});

describe('gateway multi-endpoint routing', () => {
  it('routes an Anthropic request to the Anthropic endpoint of a multi-endpoint upstream', async () => {
    const rig = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    try {
      await rig.db
        .update(upstreamKeys)
        .set({
          endpointsJson: JSON.stringify([
            {
              protocol: 'anthropic',
              baseUrl: rig.fake.baseUrl,
              providerType: 'anthropic_compatible',
            },
            { protocol: 'openai', baseUrl: rig.fake.baseUrl, providerType: 'openai_compatible' },
          ]),
        })
        .where(eq(upstreamKeys.id, rig.upstreamKeyId));

      rig.fake.setAnthropicResponse({
        status: 200,
        body: {
          id: 'msg_mm_a',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'from anthropic endpoint' }],
          model: 'fake-real-model',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { content: Array<{ text: string }> }).content[0]?.text).toBe(
        'from anthropic endpoint',
      );
      expect(rig.fake.anthropicRequests).toHaveLength(1);
      expect(rig.fake.openaiRequests).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });

  it('routes an OpenAI request to the OpenAI endpoint of the same upstream', async () => {
    const rig = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    try {
      await rig.db
        .update(upstreamKeys)
        .set({
          endpointsJson: JSON.stringify([
            {
              protocol: 'anthropic',
              baseUrl: rig.fake.baseUrl,
              providerType: 'anthropic_compatible',
            },
            { protocol: 'openai', baseUrl: rig.fake.baseUrl, providerType: 'openai_compatible' },
          ]),
        })
        .where(eq(upstreamKeys.id, rig.upstreamKeyId));

      rig.fake.setOpenAIResponse({
        status: 200,
        body: {
          id: 'cmpl_mm_o',
          object: 'chat.completion',
          created: 1700000000,
          model: 'fake-real-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'from openai endpoint' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: bearerHeader(rig.rawConsumerKey),
        payload: OPENAI_BODY,
      });
      expect(res.statusCode).toBe(200);
      expect(
        (res.json() as { choices: Array<{ message: { content: string } }> }).choices[0]?.message
          .content,
      ).toBe('from openai endpoint');
      expect(rig.fake.openaiRequests).toHaveLength(1);
      expect(rig.fake.anthropicRequests).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });

  it('falls back to cross-protocol conversion when no same-protocol candidate exists', async () => {
    const rig = await makeGatewayRig({ providerType: 'openai_compatible' });
    try {
      await rig.db
        .update(upstreamKeys)
        .set({
          endpointsJson: JSON.stringify([
            { protocol: 'openai', baseUrl: rig.fake.baseUrl, providerType: 'openai_compatible' },
          ]),
        })
        .where(eq(upstreamKeys.id, rig.upstreamKeyId));

      rig.fake.setOpenAIResponse({
        status: 200,
        body: {
          id: 'cmpl_cross',
          object: 'chat.completion',
          created: 1700000000,
          model: 'fake-real-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'cross protocol ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        },
      });
      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: ANTHROPIC_BODY,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        type: string;
        content: Array<{ text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };
      expect(body.type).toBe('message');
      expect(body.content[0]?.text).toBe('cross protocol ok');
      expect(body.usage.input_tokens).toBe(2);
      expect(body.usage.output_tokens).toBe(3);
      expect(rig.fake.openaiRequests).toHaveLength(1);
    } finally {
      await rig.close();
    }
  });

  it('rejects cross-protocol streaming with a clear error', async () => {
    const rig = await makeGatewayRig({ providerType: 'openai_compatible' });
    try {
      await rig.db
        .update(upstreamKeys)
        .set({
          endpointsJson: JSON.stringify([
            { protocol: 'openai', baseUrl: rig.fake.baseUrl, providerType: 'openai_compatible' },
          ]),
        })
        .where(eq(upstreamKeys.id, rig.upstreamKeyId));

      const res = await rig.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: anthropicHeader(rig.rawConsumerKey),
        payload: { ...ANTHROPIC_BODY, stream: true },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { type: string; error: { type: string; message: string } };
      expect(body.type).toBe('error');
      expect(body.error.message).toContain('cross-protocol streaming');
    } finally {
      await rig.close();
    }
  });
});

describe('GET /v1/models', () => {
  it('returns only the public model and group the consumer key can access', async () => {
    const rig = await makeGatewayRig();
    try {
      const res = await rig.app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: anthropicHeader(rig.rawConsumerKey),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        object: string;
        data: Array<{ id: string; metadata: { target_type: string } }>;
      };
      expect(body.object).toBe('list');
      const ids = body.data.map((d) => d.id).sort();
      expect(ids).toEqual(['coding', 'coding-fast']);
    } finally {
      await rig.close();
    }
  });

  it('rejects unauthenticated /v1/models with 401', async () => {
    const rig = await makeGatewayRig();
    try {
      const res = await rig.app.inject({ method: 'GET', url: '/v1/models' });
      expect(res.statusCode).toBe(401);
    } finally {
      await rig.close();
    }
  });
});
