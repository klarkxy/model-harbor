import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { usageRecords, upstreamKeys, publicModelCandidates } from '../src/modules/db/index.js';
import { encryptUpstreamApiKey } from '../src/modules/admin/index.js';
import { generateId } from '@modelharbor/shared';
import { updateCircuitBreakerSettings } from '../src/modules/router/circuit-breaker.js';
import { makeGatewayRig, type GatewayTestRig } from './gateway-helper.js';
import { startFakeUpstream, type FakeUpstreamRig } from './fake-upstream.js';

const ANTHROPIC_STREAM_BODY = {
  model: 'coding-fast',
  messages: [{ role: 'user', content: 'stream please' }],
  max_tokens: 64,
  stream: true,
};

const OPENAI_STREAM_BODY = {
  model: 'coding-fast',
  messages: [{ role: 'user', content: 'stream please' }],
  stream: true,
};

const anthropicStreamFrames = [
  {
    event: 'message_start',
    data: JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'fake-real-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 0 },
      },
    }),
  },
  {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
  },
  { event: 'ping', data: JSON.stringify({ type: 'ping' }) },
  {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello, ' },
    }),
  },
  {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'world!' },
    }),
  },
  { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 0 }) },
  {
    event: 'message_delta',
    data: JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    }),
  },
  { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
];

const openaiStreamChunks = [
  {
    data: JSON.stringify({
      id: 'cmpl-1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'fake-real-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }],
    }),
  },
  {
    data: JSON.stringify({
      id: 'cmpl-1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'fake-real-model',
      choices: [{ index: 0, delta: { content: ', ' }, finish_reason: null }],
    }),
  },
  {
    data: JSON.stringify({
      id: 'cmpl-1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'fake-real-model',
      choices: [{ index: 0, delta: { content: 'world!' }, finish_reason: null }],
    }),
  },
  {
    data: JSON.stringify({
      id: 'cmpl-1',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'fake-real-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }),
  },
  { data: '[DONE]' },
];

function parseSseResponse(text: string): Array<{ event: string | null; data: string }> {
  const out: Array<{ event: string | null; data: string }> = [];
  for (const block of text.split(/\n\n/)) {
    const trimmed = block.replace(/\r$/, '').trim();
    if (trimmed.length === 0) continue;
    let event: string | null = null;
    const dataParts: string[] = [];
    for (const line of trimmed.split(/\n/)) {
      if (line.length === 0) continue;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataParts.push(value);
    }
    if (dataParts.length > 0) out.push({ event, data: dataParts.join('\n') });
  }
  return out;
}

interface LiveRig extends GatewayTestRig {
  port: number;
  closeAll: () => Promise<void>;
}

interface TwoUpstreamRig extends GatewayTestRig {
  fastFake: FakeUpstreamRig;
  slowFake: FakeUpstreamRig;
  fastUpstreamKeyId: string;
  slowUpstreamKeyId: string;
  port: number;
  closeAll: () => Promise<void>;
}

async function startListening(rig: GatewayTestRig): Promise<LiveRig> {
  await rig.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = rig.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('not listening');
  return {
    ...rig,
    port: addr.port,
    closeAll: async () => {
      await rig.app.close();
    },
  };
}

async function makeTwoUpstreamStreamingRig(): Promise<TwoUpstreamRig> {
  const base = await makeGatewayRig({
    providerType: 'anthropic_compatible',
    createGroup: false,
  });
  const fastFake = base.fake;
  const fastUpstreamKeyId = base.upstreamKeyId;
  const slowFake = await startFakeUpstream();
  const now = new Date();
  const enc = encryptUpstreamApiKey(base.rawUpstreamKey, base.secretKey);
  const slowUpstreamKeyId = generateId('upstreamKey');
  await base.db.insert(upstreamKeys).values({
    id: slowUpstreamKeyId,
    name: 'Slow upstream',
    providerType: 'anthropic_compatible',
    baseUrl: slowFake.baseUrl,
    apiKeyCiphertext: enc.ciphertext,
    apiKeyPrefix: enc.prefix,
    supportedModelsJson: JSON.stringify(['fake-real-model']),
    enabled: true,
    frozen: false,
    cooldownUntil: null,
    createdAt: now,
    updatedAt: now,
  });
  await base.db
    .update(publicModelCandidates)
    .set({ priority: 2, updatedAt: now })
    .where(eq(publicModelCandidates.upstreamKeyId, fastUpstreamKeyId));
  await base.db.insert(publicModelCandidates).values({
    id: generateId('publicModel') + '_slow',
    publicModelId: base.ids.publicModelId,
    upstreamKeyId: slowUpstreamKeyId,
    realModelName: 'fake-real-model',
    enabled: true,
    priority: 1,
    weight: 1,
    createdAt: now,
    updatedAt: now,
  });
  await base.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = base.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('not listening');
  return {
    ...base,
    fastFake,
    slowFake,
    fastUpstreamKeyId,
    slowUpstreamKeyId,
    port: addr.port,
    closeAll: async () => {
      await base.app.close();
      await slowFake.close();
      await base.close();
    },
  };
}

function postSse(
  rig: LiveRig,
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  raw: http.IncomingMessage;
}> {
  return new Promise((resolve, _reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: rig.port,
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
            raw: res,
          }),
        );
        res.on('error', _reject);
      },
    );
    req.on('error', _reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function postSseWithAbort(
  rig: LiveRig,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  abortAfterMs: number,
): { promise: Promise<{ statusCode: number; body: string }>; abort: () => void } {
  let resolveOuter: (v: { statusCode: number; body: string }) => void = () => undefined;
  const promise = new Promise<{ statusCode: number; body: string }>((resolve) => {
    resolveOuter = resolve;
  });
  const req = http.request(
    {
      host: '127.0.0.1',
      port: rig.port,
      method: 'POST',
      path,
      headers: { 'content-type': 'application/json', ...headers },
    },
    (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () =>
        resolveOuter({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        }),
      );
      res.on('error', () => {
        resolveOuter({ statusCode: 0, body: Buffer.concat(chunks).toString('utf-8') });
      });
    },
  );
  req.on('error', () => resolveOuter({ statusCode: 0, body: '' }));
  req.write(JSON.stringify(body));
  req.end();
  setTimeout(() => {
    try {
      req.destroy();
    } catch {
      /* ignore */
    }
  }, abortAfterMs);
  return {
    promise,
    abort: () => {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

describe('M5 streaming: /v1/messages (live HTTP)', () => {
  let rig: LiveRig;
  beforeEach(async () => {
    const base = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    rig = await startListening(base);
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('streams multiple events in order and writes a usage record with terminal tokens', async () => {
    rig.fake.setAnthropicStream({ events: anthropicStreamFrames });
    const res = await postSse(rig, '/v1/messages', ANTHROPIC_STREAM_BODY, {
      'x-api-key': rig.rawConsumerKey,
      accept: 'text/event-stream',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseSseResponse(res.body);
    expect(frames).toHaveLength(anthropicStreamFrames.length);
    for (let i = 0; i < frames.length; i++) {
      expect(frames[i]!.event).toBe(anthropicStreamFrames[i]!.event);
      expect(frames[i]!.data).toBe(anthropicStreamFrames[i]!.data);
    }
    const records = await rig.db.select().from(usageRecords).all();
    const streamRec = records.find((r) => r.stream);
    expect(streamRec).toBeTruthy();
    expect(streamRec!.inputTokens).toBe(4);
    expect(streamRec!.outputTokens).toBe(7);
    expect(streamRec!.status).toBe('success');
  });

  it('returns an Anthropic-shaped 404 for an unknown model in stream mode', async () => {
    // The streaming branch in routes.ts must wrap the handler in try/catch
    // so the body matches the Anthropic shape on errors thrown before the
    // first frame (unknown model, denied access, validation). The previous
    // M5 cut threw these out of the route and fell through to the global
    // error handler which returns the OpenAI shape.
    const res = await postSse(
      rig,
      '/v1/messages',
      { ...ANTHROPIC_STREAM_BODY, model: 'does-not-exist' },
      { 'x-api-key': rig.rawConsumerKey },
    );
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('not_found_error');
  });

  it('returns an Anthropic-shaped 400 for a missing model field in stream mode', async () => {
    const body = { stream: true, messages: [{ role: 'user', content: 'x' }], max_tokens: 32 };
    const res = await postSse(rig, '/v1/messages', body, { 'x-api-key': rig.rawConsumerKey });
    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body) as { type: string; error: { type: string } };
    expect(parsed.type).toBe('error');
    expect(parsed.error.type).toBe('invalid_request_error');
  });

  it('records an error usage row when the upstream returns 4xx before any frames', async () => {
    rig.fake.setAnthropicResponse({
      status: 429,
      body: { type: 'error', error: { type: 'rate_limit_error', message: 'too many' } },
    });
    const res = await postSse(rig, '/v1/messages', ANTHROPIC_STREAM_BODY, {
      'x-api-key': rig.rawConsumerKey,
    });
    expect(res.statusCode).toBe(429);
    const records = await rig.db.select().from(usageRecords).all();
    const streamRec = records.find((r) => r.stream);
    expect(streamRec).toBeTruthy();
    expect(streamRec!.status).toBe('error');
    expect(streamRec!.errorCode).toBe('rate_limit_error');
  });

  it('records an error usage row when the upstream closes the stream mid-flight', async () => {
    rig.fake.setAnthropicStream({ events: anthropicStreamFrames, closeAfter: 3 });
    const res = await postSse(rig, '/v1/messages', ANTHROPIC_STREAM_BODY, {
      'x-api-key': rig.rawConsumerKey,
    });
    const frames = parseSseResponse(res.body);
    expect(frames.length).toBeLessThan(anthropicStreamFrames.length);
    const records = await rig.db.select().from(usageRecords).all();
    const streamRec = records.find((r) => r.stream);
    expect(streamRec).toBeTruthy();
    expect(streamRec!.status).toBe('error');
  });
});

describe('M5 streaming: /v1/chat/completions (live HTTP)', () => {
  let rig: LiveRig;
  beforeEach(async () => {
    const base = await makeGatewayRig({
      providerType: 'openai_compatible',
      publicModelName: 'fast-chat',
    });
    rig = await startListening(base);
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('streams multiple OpenAI chunks in order and writes a usage record', async () => {
    rig.fake.setOpenAIStream({ events: openaiStreamChunks });
    const res = await postSse(
      rig,
      '/v1/chat/completions',
      { ...OPENAI_STREAM_BODY, model: 'fast-chat' },
      { authorization: `Bearer ${rig.rawConsumerKey}` },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseSseResponse(res.body);
    expect(frames).toHaveLength(openaiStreamChunks.length);
    expect(frames[frames.length - 1]!.data).toBe('[DONE]');
    const records = await rig.db.select().from(usageRecords).all();
    const streamRec = records.find((r) => r.stream);
    expect(streamRec).toBeTruthy();
    expect(streamRec!.status).toBe('success');
  });

  it('returns an OpenAI-shaped 404 for an unknown model in stream mode', async () => {
    const res = await postSse(
      rig,
      '/v1/chat/completions',
      { ...OPENAI_STREAM_BODY, model: 'does-not-exist' },
      { authorization: `Bearer ${rig.rawConsumerKey}` },
    );
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { error: { type: string; code: string } };
    expect(body.error.type).toBe('TargetNotFoundError');
    expect(body.error.code).toBe('target_not_found');
  });
});

const cozeStreamEvents = [
  {
    event: 'conversation.chat.created',
    data: JSON.stringify({ id: 'chat_1', conversation_id: 'conv_1', bot_id: 'fake' }),
  },
  {
    event: 'conversation.message.delta',
    data: JSON.stringify({ id: 'msg_1', role: 'assistant', type: 'answer', content: 'Hello' }),
  },
  {
    event: 'conversation.message.delta',
    data: JSON.stringify({ id: 'msg_1', role: 'assistant', type: 'answer', content: ', ' }),
  },
  {
    event: 'conversation.message.delta',
    data: JSON.stringify({ id: 'msg_1', role: 'assistant', type: 'answer', content: 'world!' }),
  },
  {
    event: 'conversation.message.completed',
    data: JSON.stringify({
      id: 'msg_1',
      role: 'assistant',
      type: 'answer',
      content: 'Hello, world!',
      usage: { input_count: 4, output_count: 3, token_count: 7 },
    }),
  },
  {
    event: 'conversation.chat.completed',
    data: JSON.stringify({
      id: 'chat_1',
      usage: { input_count: 4, output_count: 3, token_count: 7 },
    }),
  },
  { event: 'done', data: '{}' },
];

describe('M5 streaming: Coze upstream translated to OpenAI', () => {
  let rig: LiveRig;
  beforeEach(async () => {
    const base = await makeGatewayRig({ providerType: 'coze' });
    rig = await startListening(base);
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('translates Coze SSE events into OpenAI chunks and writes a usage record', async () => {
    rig.fake.setCozeStream({ events: cozeStreamEvents });
    const res = await postSse(
      rig,
      '/v1/chat/completions',
      { ...OPENAI_STREAM_BODY, model: 'coding-fast' },
      { authorization: `Bearer ${rig.rawConsumerKey}` },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseSseResponse(res.body);
    // chat.created is ignored; 3 deltas + final stop frame + usage frames + [DONE].
    expect(frames.length).toBeGreaterThan(0);
    const dataFrames = frames.filter((f) => f.data && f.data !== '[DONE]');
    const stopFrame = dataFrames.find((f) => {
      try {
        return JSON.parse(f.data).choices?.[0]?.finish_reason === 'stop';
      } catch {
        return false;
      }
    });
    expect(stopFrame).toBeTruthy();

    const records = await rig.db.select().from(usageRecords).all();
    const streamRec = records.find((r) => r.stream);
    expect(streamRec).toBeTruthy();
    expect(streamRec!.inputTokens).toBe(4);
    expect(streamRec!.outputTokens).toBe(3);
    expect(streamRec!.status).toBe('success');
  });
});

describe('M5 streaming: client disconnect aborts the upstream request', () => {
  let rig: LiveRig;
  beforeEach(async () => {
    const base = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    rig = await startListening(base);
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('aborts the upstream request and records an error usage row when the client disconnects mid-stream', async () => {
    // Per-event delay so the stream runs longer than the client abort.
    rig.fake.setAnthropicStream({ events: anthropicStreamFrames, delayMs: 40 });
    const { promise, abort } = postSseWithAbort(
      rig,
      '/v1/messages',
      ANTHROPIC_STREAM_BODY,
      { 'x-api-key': rig.rawConsumerKey },
      10_000,
    );

    // Wait until the fake upstream has definitely received the request before
    // aborting the client. A fixed timer is flaky because gateway auth/target
    // resolution may still be in progress when the timer fires.
    const waitStart = Date.now();
    while (rig.fake.anthropicRequests.length === 0 && Date.now() - waitStart < 1000) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // The fake upstream received the stream request with stream: true.
    expect(rig.fake.anthropicRequests).toHaveLength(1);
    expect(rig.fake.anthropicRequests[0]!.body).toMatchObject({ stream: true });

    // Now tear down the client socket mid-stream.
    abort();
    await promise.catch(() => ({ statusCode: 0, body: '' }));

    // driveStream records an error row tagged client_disconnected after
    // the upstream fetch is aborted. Poll for it because the server is
    // still finishing up after the client destroyed the socket.
    const start = Date.now();
    let streamRec: { status: string; errorCode: string | null } | undefined;
    while (Date.now() - start < 1000) {
      const records = await rig.db.select().from(usageRecords).all();
      const found = records.find((r) => r.stream);
      if (found) {
        streamRec = found;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(streamRec).toBeTruthy();
    expect(streamRec!.status).toBe('error');
    expect(streamRec!.errorCode).toBe('client_disconnected');
  });
});

describe('M5 streaming: usage records for non-stream /v1/messages', () => {
  let rig: LiveRig;
  beforeEach(async () => {
    const base = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    rig = await startListening(base);
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('writes one usage row per non-stream call', async () => {
    rig.fake.setAnthropicResponse({
      status: 200,
      body: {
        id: 'msg_ns',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    });
    const res = await postSse(
      rig,
      '/v1/messages',
      { model: 'coding-fast', messages: [{ role: 'user', content: 'hi' }], max_tokens: 32 },
      { 'x-api-key': rig.rawConsumerKey },
    );
    expect(res.statusCode).toBe(200);
    const records = await rig.db.select().from(usageRecords).all();
    const nsRec = records.find((r) => !r.stream);
    expect(nsRec).toBeTruthy();
    expect(nsRec!.status).toBe('success');
    expect(nsRec!.inputTokens).toBe(2);
    expect(nsRec!.outputTokens).toBe(3);
  });

  it('attributes non-stream usage to the resolved target, not the underlying public model', async () => {
    // The default rig seeds a model group "coding" containing "coding-fast".
    // We use the gateway-helper's "createGroup: true" default by NOT
    // setting grantPublicModelAccess=false, then issue the call against
    // the group name.
    rig.fake.setAnthropicResponse({
      status: 200,
      body: {
        id: 'msg_grp',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const res = await postSse(
      rig,
      '/v1/messages',
      { model: 'coding', messages: [{ role: 'user', content: 'hi' }], max_tokens: 32 },
      { 'x-api-key': rig.rawConsumerKey },
    );
    expect(res.statusCode).toBe(200);
    const records = await rig.db.select().from(usageRecords).all();
    const nsRec = records.find((r) => !r.stream);
    expect(nsRec).toBeTruthy();
    // Usage is attributed to the *asked-for* model group, not the
    // underlying public model that actually served the request. This is
    // what the M5 / P2 fix enforces.
    expect(nsRec!.resolvedTargetType).toBe('model_group');
    expect(nsRec!.resolvedTargetId).toBe(rig.ids.modelGroupId);
    expect(nsRec!.requestedTargetName).toBe('coding');
  });

  it('attributes public-model calls to the public model target', async () => {
    rig.fake.setAnthropicResponse({
      status: 200,
      body: {
        id: 'msg_pm',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'fake-real-model',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const res = await postSse(
      rig,
      '/v1/messages',
      { model: 'coding-fast', messages: [{ role: 'user', content: 'hi' }], max_tokens: 32 },
      { 'x-api-key': rig.rawConsumerKey },
    );
    expect(res.statusCode).toBe(200);
    const records = await rig.db.select().from(usageRecords).all();
    const nsRec = records.find((r) => !r.stream);
    expect(nsRec).toBeTruthy();
    expect(nsRec!.resolvedTargetType).toBe('public_model');
    expect(nsRec!.resolvedTargetId).toBe(rig.ids.publicModelId);
  });
});

describe('M5 streaming: usage records attribute to the resolved target (group)', () => {
  let rig: LiveRig;
  beforeEach(async () => {
    const base = await makeGatewayRig({ providerType: 'anthropic_compatible' });
    rig = await startListening(base);
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('attributes a successful streaming call against a model group to the group', async () => {
    rig.fake.setAnthropicStream({ events: anthropicStreamFrames });
    const res = await postSse(
      rig,
      '/v1/messages',
      { ...ANTHROPIC_STREAM_BODY, model: 'coding' },
      { 'x-api-key': rig.rawConsumerKey, accept: 'text/event-stream' },
    );
    expect(res.statusCode).toBe(200);
    const records = await rig.db.select().from(usageRecords).all();
    const streamRec = records.find((r) => r.stream);
    expect(streamRec).toBeTruthy();
    expect(streamRec!.resolvedTargetType).toBe('model_group');
    expect(streamRec!.resolvedTargetId).toBe(rig.ids.modelGroupId);
    expect(streamRec!.requestedTargetName).toBe('coding');
  });
});

describe('M7.5 streaming: first-token timeout failover', () => {
  let rig: TwoUpstreamRig;
  beforeEach(async () => {
    rig = await makeTwoUpstreamStreamingRig();
    await updateCircuitBreakerSettings(rig.db, { firstTokenTimeoutMs: 300 });
  });
  afterEach(async () => {
    await rig.closeAll();
  });

  it('switches to the next candidate when the first upstream does not emit a token in time', async () => {
    rig.slowFake.setAnthropicStream({ events: [], hangAfterHeaders: true });
    rig.fastFake.setAnthropicStream({ events: anthropicStreamFrames });

    const start = Date.now();
    const res = await postSse(rig, '/v1/messages', ANTHROPIC_STREAM_BODY, {
      'x-api-key': rig.rawConsumerKey,
      accept: 'text/event-stream',
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseSseResponse(res.body);
    expect(frames).toHaveLength(anthropicStreamFrames.length);
    // It must have waited for the first-token timeout before trying the fast candidate.
    expect(elapsed).toBeGreaterThanOrEqual(200);

    // Both upstreams received a request attempt.
    expect(rig.slowFake.anthropicRequests).toHaveLength(1);
    expect(rig.fastFake.anthropicRequests).toHaveLength(1);

    const records = await rig.db.select().from(usageRecords).all();
    const successRec = records.find((r) => r.stream && r.status === 'success');
    expect(successRec).toBeTruthy();
    expect(successRec!.upstreamKeyId).toBe(rig.fastUpstreamKeyId);
  });
});
