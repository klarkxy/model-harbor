import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ChatRequestIR,
  type AnthropicMessagesRequest,
  type OpenAIChatCompletionsRequest,
} from '@modelharbor/shared';
import {
  buildAnthropicCompatibleRequest,
  buildOpenAICompatibleRequest,
  createAnthropicCompatibleAdapter,
  createOpenAICompatibleAdapter,
  anthropicRequestToIR,
  openaiRequestToIR,
  getProviderPreset,
  getModelMappings,
  type ProviderRequestContext,
  type ProviderHttpResponse,
} from '../src/modules/providers/index.js';
import { startFakeUpstream, type FakeUpstreamRig } from './fake-upstream.js';

function makeContext(overrides: Partial<ProviderRequestContext> = {}): ProviderRequestContext {
  const ir: ChatRequestIR = {
    sourceProtocol: 'anthropic',
    requestedModel: 'claude-3-5-sonnet',
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 256,
    temperature: 0.5,
    topP: 0.9,
    stream: false,
    metadata: { user_id: 'u_test' },
    rawRequest: null,
  };
  return {
    ir,
    realModelName: 'claude-3-5-sonnet-20240620',
    upstreamKeyId: 'uk_test',
    timeoutMs: 30_000,
    stream: false,
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-KEY',
    ...overrides,
  };
}

function makeResponse(status: number, body: unknown): ProviderHttpResponse {
  return {
    status,
    headers: {},
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
    bodyJson: body,
  };
}

describe('anthropic-compatible adapter', () => {
  it('builds the right request shape', () => {
    // Use a distinct apiKey override so this assertion exercises a non-default
    // value (the adapter just forwards context.apiKey into the header).
    const ctx = makeContext({ apiKey: 'sk-test-XYZ' });
    const req = buildAnthropicCompatibleRequest(ctx);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.com/v1/messages');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-api-key']).toBe('sk-test-XYZ');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(req.body) as AnthropicMessagesRequest;
    expect(body.model).toBe('claude-3-5-sonnet-20240620');
    expect(body.system).toBe('You are helpful.');
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
    expect(body.stream).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.metadata).toEqual({ user_id: 'u_test' });
  });

  it('omits optional fields when not set', () => {
    const ctx = makeContext({
      ir: {
        ...makeContext().ir,
        system: null,
        maxTokens: null,
        temperature: null,
        topP: null,
        metadata: {},
      },
    });
    const req = buildAnthropicCompatibleRequest({
      ...ctx,
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
    });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body['system']).toBeUndefined();
    expect(body['max_tokens']).toBeUndefined();
    expect(body['temperature']).toBeUndefined();
    expect(body['top_p']).toBeUndefined();
    expect(body['metadata']).toBeUndefined();
  });

  it('normalizes a successful response', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const ctx = makeContext();
    const resp = makeResponse(200, {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'hello world' }],
      model: 'claude-3-5-sonnet-20240620',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const ir = adapter.normalizeResponse({ response: resp, request: ctx });
    expect(ir.id).toBe('msg_01');
    expect(ir.model).toBe('claude-3-5-sonnet-20240620');
    expect(ir.content).toBe('hello world');
    expect(ir.stopReason).toBe('end_turn');
    expect(ir.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('concatenates multiple text blocks', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const ctx = makeContext();
    const resp = makeResponse(200, {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'foo ' },
        { type: 'tool_use', id: 'x', name: 'y', input: {} },
        { type: 'text', text: 'bar' },
      ],
      model: 'm',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const ir = adapter.normalizeResponse({ response: resp, request: ctx });
    expect(ir.content).toBe('foo bar');
  });

  it('extracts usage independently', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const resp = makeResponse(200, {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
      model: 'm',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 7, output_tokens: 11 },
    });
    const usage = adapter.extractUsage({ response: resp, request: makeContext() });
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 11, totalTokens: 18 });
  });

  it('classifies 401 as provider_authentication', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const resp = makeResponse(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    const err = adapter.normalizeError({
      response: resp,
      request: makeContext(),
      transportError: undefined,
    });
    expect(err.category).toBe('provider_authentication');
    expect(err.upstreamStatus).toBe(401);
    expect(err.providerMessage).toBe('invalid x-api-key');
    expect(err.providerCode).toBe('authentication_error');
  });

  it('classifies 429 with rate_limit_error code as provider_rate_limit', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const resp = makeResponse(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'too many' },
    });
    const err = adapter.normalizeError({
      response: resp,
      request: makeContext(),
      transportError: undefined,
    });
    expect(err.category).toBe('provider_rate_limit');
  });

  it('classifies 504 as provider_timeout', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const resp = makeResponse(504, { type: 'error', error: { type: 'timeout', message: 'x' } });
    const err = adapter.normalizeError({
      response: resp,
      request: makeContext(),
      transportError: undefined,
    });
    expect(err.category).toBe('provider_timeout');
  });
});

describe('openai-compatible adapter', () => {
  it('builds the right request shape', () => {
    const ctx = makeContext({
      ir: { ...makeContext().ir, sourceProtocol: 'openai', requestedModel: 'gpt-4o-mini' },
      realModelName: 'gpt-4o-mini-2024-07-18',
      apiKey: 'sk-test-XYZ',
    });
    const req = buildOpenAICompatibleRequest(ctx);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.com/v1/chat/completions');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['authorization']).toBe('Bearer sk-test-XYZ');
    const body = JSON.parse(req.body) as OpenAIChatCompletionsRequest;
    expect(body.model).toBe('gpt-4o-mini-2024-07-18');
    // system goes to the messages array as a system role
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
    expect(body.user).toBe('u_test');
  });

  it('normalizes a successful response', () => {
    const adapter = createOpenAICompatibleAdapter();
    const ctx = makeContext();
    const resp = makeResponse(200, {
      id: 'cmpl-1',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini-2024-07-18',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const ir = adapter.normalizeResponse({ response: resp, request: ctx });
    expect(ir.id).toBe('cmpl-1');
    expect(ir.model).toBe('gpt-4o-mini-2024-07-18');
    expect(ir.content).toBe('hi there');
    expect(ir.stopReason).toBe('stop');
    expect(ir.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('returns null usage when upstream omits it', () => {
    const adapter = createOpenAICompatibleAdapter();
    const ctx = makeContext();
    const resp = makeResponse(200, {
      id: 'cmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
    });
    const ir = adapter.normalizeResponse({ response: resp, request: ctx });
    expect(ir.usage).toBeNull();
  });

  it('classifies 401 as provider_authentication', () => {
    const adapter = createOpenAICompatibleAdapter();
    const resp = makeResponse(401, {
      error: {
        message: 'Incorrect API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    const err = adapter.normalizeError({
      response: resp,
      request: makeContext(),
      transportError: undefined,
    });
    expect(err.category).toBe('provider_authentication');
    expect(err.providerCode).toBe('invalid_api_key');
  });

  it('classifies 429 with insufficient_quota as provider_quota', () => {
    const adapter = createOpenAICompatibleAdapter();
    const resp = makeResponse(429, {
      error: { message: 'exceeded', type: 'insufficient_quota', code: 'insufficient_quota' },
    });
    const err = adapter.normalizeError({
      response: resp,
      request: makeContext(),
      transportError: undefined,
    });
    expect(err.category).toBe('provider_quota');
  });

  it('classifies 404 with model_not_found as provider_model_not_found', () => {
    const adapter = createOpenAICompatibleAdapter();
    const resp = makeResponse(404, {
      error: { message: 'model not found', type: 'invalid_request_error', code: 'model_not_found' },
    });
    const err = adapter.normalizeError({
      response: resp,
      request: makeContext(),
      transportError: undefined,
    });
    expect(err.category).toBe('provider_model_not_found');
  });

  it('uses apiPath override when provided', () => {
    const ctx = makeContext({
      ir: { ...makeContext().ir, sourceProtocol: 'openai', requestedModel: 'glm-5' },
      realModelName: 'glm-5',
      baseUrl: 'https://open.bigmodel.cn/api/paas',
      apiPath: '/v4/chat/completions',
    });
    const req = buildOpenAICompatibleRequest(ctx);
    expect(req.url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });
});

describe('provider presets', () => {
  it('exposes all mainstream official presets', () => {
    const presets = [
      'openai',
      'anthropic',
      'deepseek',
      'moonshot',
      'moonshot-cn',
      'minimax',
      'minimax-intl',
      'openrouter',
      'opencode-go',
      'opencode-zen',
      'groq',
      'together',
      'cerebras',
      'fireworks',
      'xai',
      'qwen',
      'qwen-intl',
      'zhipu',
      'zhipu-coding',
      'baichuan',
      'bytedance',
      'hunyuan',
      'qianfan',
      'stepfun',
      'siliconflow',
    ];
    for (const id of presets) {
      const preset = getProviderPreset(id);
      expect(preset, `preset ${id} should exist`).toBeTruthy();
      expect(preset!.endpoints.length).toBeGreaterThan(0);
      expect(getModelMappings(preset!).length).toBe(0);
      for (const ep of preset!.endpoints) {
        expect(ep.protocol).toMatch(/^(anthropic|openai)$/);
        expect(ep.providerType).toMatch(/^(anthropic_compatible|openai_compatible)$/);
        expect(ep.baseUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it('no longer ships hardcoded model mappings', () => {
    const openrouter = getProviderPreset('openrouter')!;
    expect(getModelMappings(openrouter)).toHaveLength(0);

    const openai = getProviderPreset('openai')!;
    expect(getModelMappings(openai)).toHaveLength(0);

    const anthropic = getProviderPreset('anthropic')!;
    expect(getModelMappings(anthropic)).toHaveLength(0);
  });

  it('builds correct upstream URLs for common presets', () => {
    const cases: Array<{
      presetId: string;
      protocol: 'anthropic' | 'openai';
      expectedUrl: string;
    }> = [
      {
        presetId: 'openai',
        protocol: 'openai',
        expectedUrl: 'https://api.openai.com/v1/chat/completions',
      },
      {
        presetId: 'anthropic',
        protocol: 'anthropic',
        expectedUrl: 'https://api.anthropic.com/v1/messages',
      },
      {
        presetId: 'deepseek',
        protocol: 'openai',
        expectedUrl: 'https://api.deepseek.com/v1/chat/completions',
      },
      {
        presetId: 'deepseek',
        protocol: 'anthropic',
        expectedUrl: 'https://api.deepseek.com/anthropic/v1/messages',
      },
      {
        presetId: 'minimax',
        protocol: 'openai',
        expectedUrl: 'https://api.minimaxi.com/v1/chat/completions',
      },
      {
        presetId: 'minimax-intl',
        protocol: 'openai',
        expectedUrl: 'https://api.minimax.io/v1/chat/completions',
      },
      {
        presetId: 'qwen',
        protocol: 'openai',
        expectedUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      },
      {
        presetId: 'zhipu',
        protocol: 'openai',
        expectedUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      },
      {
        presetId: 'bytedance',
        protocol: 'openai',
        expectedUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      },
      {
        presetId: 'qianfan',
        protocol: 'openai',
        expectedUrl: 'https://qianfan.baidubce.com/v2/chat/completions',
      },
      {
        presetId: 'openrouter',
        protocol: 'openai',
        expectedUrl: 'https://openrouter.ai/api/v1/chat/completions',
      },
    ];
    for (const c of cases) {
      const preset = getProviderPreset(c.presetId)!;
      const ep = preset.endpoints.find((e) => e.protocol === c.protocol);
      expect(ep, `${c.presetId}/${c.protocol} endpoint`).toBeTruthy();
      const base = ep!.baseUrl.replace(/\/+$/, '');
      const path =
        ep!.apiPath ?? (c.protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions');
      expect(`${base}${path}`).toBe(c.expectedUrl);
    }
  });
});

describe('IR converters', () => {
  it('converts an Anthropic request to IR', () => {
    const body: AnthropicMessagesRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
      ],
      system: 'You are a test.',
      max_tokens: 100,
      temperature: 0.3,
      metadata: { user_id: 'u_1' },
    };
    const ir = anthropicRequestToIR(body);
    expect(ir.sourceProtocol).toBe('anthropic');
    expect(ir.requestedModel).toBe('claude-3-5-sonnet');
    expect(ir.system).toBe('You are a test.');
    expect(ir.messages).toHaveLength(3);
    expect(ir.messages[0]?.content).toBe('Hello');
    expect(ir.maxTokens).toBe(100);
    expect(ir.temperature).toBe(0.3);
    expect(ir.metadata['user_id']).toBe('u_1');
  });

  it('converts an Anthropic request with content blocks to IR', () => {
    const body: AnthropicMessagesRequest = {
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'text', text: ' there' },
          ],
        },
      ],
    };
    const ir = anthropicRequestToIR(body);
    expect(ir.messages[0]?.content).toBe('hi there');
  });

  it('converts an OpenAI request to IR, folding system into messages', () => {
    const body: OpenAIChatCompletionsRequest = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
      ],
      max_tokens: 50,
      temperature: 0.2,
      top_p: 0.8,
      user: 'u_1',
    };
    const ir = openaiRequestToIR(body);
    expect(ir.sourceProtocol).toBe('openai');
    expect(ir.requestedModel).toBe('gpt-4o-mini');
    expect(ir.system).toBe('be terse');
    // The system message is folded into ir.system and is not in ir.messages
    expect(ir.messages).toHaveLength(3);
    expect(ir.messages[0]?.role).toBe('user');
    expect(ir.maxTokens).toBe(50);
    expect(ir.temperature).toBe(0.2);
    expect(ir.topP).toBe(0.8);
    expect(ir.metadata['user_id']).toBe('u_1');
  });
});

describe('end-to-end through fake upstream', () => {
  let rig: FakeUpstreamRig;
  beforeEach(async () => {
    rig = await startFakeUpstream();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('round-trips an Anthropic request and response', async () => {
    const ctx = makeContext();
    const built = buildAnthropicCompatibleRequest({
      ...ctx,
      baseUrl: rig.baseUrl,
      apiKey: rig.apiKey,
    });

    const resp = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
    });
    const respBody = await resp.json();
    const respText = JSON.stringify(respBody);

    const adapter = createAnthropicCompatibleAdapter();
    const ir = adapter.normalizeResponse({
      response: {
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        bodyText: respText,
        bodyJson: respBody,
      },
      request: ctx,
    });

    expect(resp.status).toBe(200);
    expect(ir.content).toBe('ok');
    expect(rig.anthropicRequests).toHaveLength(1);
    expect(rig.anthropicRequests[0]!.headers['x-api-key']).toBe(rig.apiKey);
    expect(rig.anthropicRequests[0]!.body).toMatchObject({
      model: 'claude-3-5-sonnet-20240620',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('round-trips an OpenAI request and response', async () => {
    const ctx = makeContext({
      ir: { ...makeContext().ir, sourceProtocol: 'openai', requestedModel: 'gpt-4o-mini' },
      realModelName: 'gpt-4o-mini-2024-07-18',
    });
    const built = buildOpenAICompatibleRequest({
      ...ctx,
      baseUrl: rig.baseUrl,
      apiKey: rig.apiKey,
    });

    const resp = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
    });
    const respBody = await resp.json();

    const adapter = createOpenAICompatibleAdapter();
    const ir = adapter.normalizeResponse({
      response: {
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        bodyText: JSON.stringify(respBody),
        bodyJson: respBody,
      },
      request: ctx,
    });

    expect(resp.status).toBe(200);
    expect(ir.content).toBe('ok');
    expect(rig.openaiRequests).toHaveLength(1);
    const auth = rig.openaiRequests[0]!.headers['authorization'];
    expect(auth).toBe(`Bearer ${rig.apiKey}`);
    expect(rig.openaiRequests[0]!.body).toMatchObject({
      model: 'gpt-4o-mini-2024-07-18',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
      ],
    });
  });

  it('normalizes an upstream 401 as provider_authentication over the wire', async () => {
    rig.setAnthropicResponse({
      status: 401,
      body: { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
    });
    const ctx = makeContext();
    const built = buildAnthropicCompatibleRequest({
      ...ctx,
      baseUrl: rig.baseUrl,
      apiKey: 'sk-wrong',
    });

    const resp = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
    });
    const body = await resp.json();

    const adapter = createAnthropicCompatibleAdapter();
    const err = adapter.normalizeError({
      response: {
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        bodyText: JSON.stringify(body),
        bodyJson: body,
      },
      request: ctx,
      transportError: undefined,
    });
    expect(err.category).toBe('provider_authentication');
    expect(err.providerMessage).toBe('bad key');
  });
});

describe('getAdapter registry', () => {
  it('returns the anthropic adapter for anthropic_compatible', async () => {
    const { getAdapter } = await import('../src/modules/providers/index.js');
    expect(getAdapter('anthropic_compatible').type).toBe('anthropic_compatible');
    expect(getAdapter('openai_compatible').type).toBe('openai_compatible');
  });
});

describe('adapter.buildRequest contract', () => {
  it('anthropic-compatible: buildRequest produces a complete, sendable HTTP request', () => {
    // The M4 sender calls `adapter.buildRequest(ctx)` directly and ships the
    // result to fetch. Verify that the request is complete: no empty URL,
    // no empty auth header.
    const adapter = createAnthropicCompatibleAdapter();
    const ctx = makeContext();
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://api.example.com/v1/messages');
    expect(req.method).toBe('POST');
    expect(req.headers['x-api-key']).toBe('sk-test-KEY');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body.length).toBeGreaterThan(0);
  });

  it('anthropic-compatible: normalizes trailing slash on baseUrl', () => {
    const adapter = createAnthropicCompatibleAdapter();
    const ctx = makeContext({ baseUrl: 'https://api.example.com/' });
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://api.example.com/v1/messages');
  });

  it('openai-compatible: buildRequest produces a complete, sendable HTTP request', () => {
    const adapter = createOpenAICompatibleAdapter();
    const ctx = makeContext({
      ir: { ...makeContext().ir, sourceProtocol: 'openai', requestedModel: 'gpt-4o-mini' },
      realModelName: 'gpt-4o-mini-2024-07-18',
    });
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://api.example.com/v1/chat/completions');
    expect(req.method).toBe('POST');
    expect(req.headers['authorization']).toBe('Bearer sk-test-KEY');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body.length).toBeGreaterThan(0);
  });
});
