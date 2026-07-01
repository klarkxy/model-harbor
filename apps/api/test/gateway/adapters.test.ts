import { describe, it, expect } from 'vitest';
import { OpenAICompatibleAdapter } from '../../src/gateway/providers/openai-compatible.adapter.js';
import { AnthropicCompatibleAdapter } from '../../src/gateway/providers/anthropic-compatible.adapter.js';
import { getProviderAdapter } from '../../src/gateway/providers/registry.js';
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderQuotaError,
  ProviderTimeoutError,
} from '@manageyourllm/shared';
import type { ProviderAccountRow } from '../../src/infrastructure/db/schema.js';
import type { ChatRequestIR } from '@manageyourllm/shared';
import type {
  BuildRequestContext,
  NormalizeResponseContext,
  NormalizeErrorContext,
} from '../../src/gateway/providers/adapter.js';

function makeProviderAccount(
  providerType: ProviderAccountRow['providerType'],
  overrides: Partial<ProviderAccountRow> = {},
): ProviderAccountRow {
  const now = new Date();
  return {
    id: 'uk',
    name: 'uk',
    providerPresetId: null,
    providerType,
    baseUrl: 'https://api.example.com/',
    authType: 'pat',
    apiKeyCiphertext: 'cipher',
    apiKeyPrefix: 'sk',
    authConfigCiphertext: null,
    defaultHeadersJson: { 'X-Default': '1' },
    extraHeadersJson: { 'X-Extra': '2' },
    extraParamsJson: { store: true },
    supportedModelsJson: [],
    endpointsJson: null,
    displayOrder: 1000,
    enabled: true,
    frozen: false,
    frozenReason: null,
    cooldownUntil: null,
    lastHealthStatus: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastUsedAt: null,
    stickySessionTtlMs: 300000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeIR(overrides: Partial<ChatRequestIR> = {}): ChatRequestIR {
  return {
    sourceProtocol: 'openai',
    requestedModel: 'gpt-4o',
    system: 'be nice',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'tool', content: 'ok', toolCallId: 'tc1' },
    ],
    maxTokens: 512,
    temperature: 0.5,
    topP: 0.9,
    stream: false,
    metadata: { user_id: 'u1' },
    rawRequest: {},
    ...overrides,
  };
}

describe('OpenAICompatibleAdapter', () => {
  it('builds chat completion request', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real-gpt-4o',
      endpointUrl: 'https://api.example.com/',
      endpointProtocol: 'openai',
      endpointPath: null,
      ir: makeIR(),
      authHeaders: { Authorization: 'Bearer sk-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://api.example.com/v1/chat/completions');
    expect(req.method).toBe('POST');
    expect(req.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
      'X-Default': '1',
      'X-Extra': '2',
    });
    expect(req.body).toMatchObject({
      model: 'real-gpt-4o',
      stream: false,
      max_tokens: 512,
      temperature: 0.5,
      top_p: 0.9,
      store: true,
    });
    const messages = (req.body as Record<string, unknown>).messages as unknown[];
    expect(messages[0]).toEqual({ role: 'system', content: 'be nice' });
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[2]).toEqual({ role: 'tool', content: 'ok', tool_call_id: 'tc1' });
  });

  it('builds responses request for codex protocol', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('codex'),
      realModelName: 'real-codex',
      endpointUrl: 'https://api.example.com/',
      endpointProtocol: 'codex',
      endpointPath: null,
      ir: makeIR({ sourceProtocol: 'codex', requestedModel: 'codex-1' }),
      authHeaders: { Authorization: 'Bearer sk-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://api.example.com/v1/responses');
    expect((req.body as Record<string, unknown>).model).toBe('real-codex');
    expect((req.body as Record<string, unknown>).instructions).toBe('be nice');
    expect((req.body as Record<string, unknown>).max_output_tokens).toBe(512);
  });

  it('sets stream: true and include_usage when ir.stream is true', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real-gpt-4o',
      endpointUrl: 'https://api.example.com/',
      endpointProtocol: 'openai',
      endpointPath: null,
      ir: makeIR({ stream: true }),
      authHeaders: { Authorization: 'Bearer sk-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect((req.body as Record<string, unknown>).stream).toBe(true);
    expect((req.body as Record<string, unknown>).stream_options).toEqual({ include_usage: true });
  });

  it('normalizes chat completion response', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: NormalizeResponseContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real',
      sourceProtocol: 'openai',
      endpointProtocol: 'openai',
      status: 200,
      headers: {},
      body: {
        id: 'resp-1',
        model: 'gpt-4o',
        choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    };
    const res = adapter.normalizeResponse(ctx);
    expect(res.id).toBe('resp-1');
    expect(res.content).toBe('Hi');
    expect(res.stopReason).toBe('stop');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('normalizes responses response', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: NormalizeResponseContext = {
      providerAccount: makeProviderAccount('codex'),
      realModelName: 'real',
      sourceProtocol: 'codex',
      endpointProtocol: 'codex',
      status: 200,
      headers: {},
      body: {
        id: 'resp-2',
        model: 'codex-1',
        output: [{ content: [{ type: 'output_text', text: 'Done' }] }],
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      },
    };
    const res = adapter.normalizeResponse(ctx);
    expect(res.id).toBe('resp-2');
    expect(res.content).toBe('Done');
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  });

  it('builds chat completion request when source is anthropic but endpoint is openai', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real-gpt-4o',
      endpointUrl: 'https://api.example.com/',
      endpointProtocol: 'openai',
      endpointPath: null,
      ir: makeIR({ sourceProtocol: 'anthropic', requestedModel: 'claude-public' }),
      authHeaders: { Authorization: 'Bearer sk-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://api.example.com/v1/chat/completions');
    expect((req.body as Record<string, unknown>).model).toBe('real-gpt-4o');
  });

  it('normalizes rate limit error', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: NormalizeErrorContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real',
      status: 429,
      body: { error: { message: 'Rate limited', code: 'rate_limit_exceeded' } },
    };
    const err = adapter.normalizeError(ctx);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect(err.message).toBe('Rate limited');
  });

  it('normalizes quota error by code', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: NormalizeErrorContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real',
      status: 400,
      body: { error: { message: 'No quota', code: 'insufficient_quota' } },
    };
    const err = adapter.normalizeError(ctx);
    expect(err).toBeInstanceOf(ProviderQuotaError);
  });

  it('normalizes generic error', () => {
    const adapter = new OpenAICompatibleAdapter();
    const ctx: NormalizeErrorContext = {
      providerAccount: makeProviderAccount('openai_compatible'),
      realModelName: 'real',
      status: 500,
      body: { error: { message: 'Boom' } },
    };
    const err = adapter.normalizeError(ctx);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Boom');
  });
});

describe('AnthropicCompatibleAdapter', () => {
  it('builds messages request', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('anthropic_compatible', {
        baseUrl: 'https://anthropic.example/',
      }),
      realModelName: 'claude-3',
      endpointUrl: 'https://anthropic.example/',
      endpointProtocol: 'anthropic',
      endpointPath: null,
      ir: makeIR({ sourceProtocol: 'anthropic' }),
      authHeaders: { 'x-api-key': 'ak-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://anthropic.example/v1/messages');
    expect(req.headers).toMatchObject({
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'ak-test',
    });
    expect(req.body).toMatchObject({
      model: 'claude-3',
      system: 'be nice',
      stream: false,
      max_tokens: 512,
      store: true,
    });
  });

  it('sets stream: true when ir.stream is true', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('anthropic_compatible'),
      realModelName: 'claude-3',
      endpointUrl: 'https://api.example.com/',
      endpointProtocol: 'anthropic',
      endpointPath: null,
      ir: makeIR({ sourceProtocol: 'anthropic', stream: true }),
      authHeaders: { 'x-api-key': 'ak-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect((req.body as Record<string, unknown>).stream).toBe(true);
  });

  it('builds messages request when source is openai but endpoint is anthropic', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: BuildRequestContext = {
      providerAccount: makeProviderAccount('anthropic_compatible', {
        baseUrl: 'https://anthropic.example/',
      }),
      realModelName: 'claude-3',
      endpointUrl: 'https://anthropic.example/',
      endpointProtocol: 'anthropic',
      endpointPath: null,
      ir: makeIR({ sourceProtocol: 'openai', requestedModel: 'gpt-4o' }),
      authHeaders: { 'x-api-key': 'ak-test' },
    };
    const req = adapter.buildRequest(ctx);
    expect(req.url).toBe('https://anthropic.example/v1/messages');
    expect((req.body as Record<string, unknown>).model).toBe('claude-3');
  });

  it('normalizes messages response with cache usage', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: NormalizeResponseContext = {
      providerAccount: makeProviderAccount('anthropic_compatible'),
      realModelName: 'claude-3',
      sourceProtocol: 'anthropic',
      endpointProtocol: 'anthropic',
      status: 200,
      headers: {},
      body: {
        id: 'msg-1',
        model: 'claude-3-opus',
        content: [{ type: 'text', text: 'Hello back' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 3,
        },
      },
    };
    const res = adapter.normalizeResponse(ctx);
    expect(res.content).toBe('Hello back');
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cacheReadTokens: 5,
      cacheWriteTokens: 3,
    });
  });

  it('normalizes anthropic rate limit error', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: NormalizeErrorContext = {
      providerAccount: makeProviderAccount('anthropic_compatible'),
      realModelName: 'claude-3',
      status: 429,
      body: { error: { type: 'rate_limit_error', message: 'Too fast' } },
    };
    const err = adapter.normalizeError(ctx);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect(err.message).toBe('Too fast');
  });

  it('normalizes anthropic quota error by type', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: NormalizeErrorContext = {
      providerAccount: makeProviderAccount('anthropic_compatible'),
      realModelName: 'claude-3',
      status: 400,
      body: { error: { type: 'quota_exceeded', message: 'Over quota' } },
    };
    const err = adapter.normalizeError(ctx);
    expect(err).toBeInstanceOf(ProviderQuotaError);
  });

  it('maps timeout status to ProviderTimeoutError', () => {
    const adapter = new AnthropicCompatibleAdapter();
    const ctx: NormalizeErrorContext = {
      providerAccount: makeProviderAccount('anthropic_compatible'),
      realModelName: 'claude-3',
      status: 408,
      body: {},
    };
    const err = adapter.normalizeError(ctx);
    expect(err).toBeInstanceOf(ProviderTimeoutError);
  });
});

describe('OpenAICompatibleAdapter supportsStreaming', () => {
  const adapter = new OpenAICompatibleAdapter();

  it('supports native OpenAI and Codex streaming', () => {
    expect(adapter.supportsStreaming('openai', 'openai')).toBe(true);
    expect(adapter.supportsStreaming('codex', 'codex')).toBe(true);
    expect(adapter.supportsStreaming('openai', 'codex')).toBe(true);
    expect(adapter.supportsStreaming('codex', 'openai')).toBe(true);
  });

  it('supports Anthropic client to OpenAI chat endpoint streaming', () => {
    expect(adapter.supportsStreaming('anthropic', 'openai')).toBe(true);
  });

  it('does not support Anthropic client to Codex endpoint streaming', () => {
    expect(adapter.supportsStreaming('anthropic', 'codex')).toBe(false);
  });
});

describe('AnthropicCompatibleAdapter supportsStreaming', () => {
  const adapter = new AnthropicCompatibleAdapter();

  it('supports native Anthropic streaming', () => {
    expect(adapter.supportsStreaming('anthropic', 'anthropic')).toBe(true);
  });

  it('supports OpenAI client to Anthropic endpoint streaming', () => {
    expect(adapter.supportsStreaming('openai', 'anthropic')).toBe(true);
  });

  it('does not support Codex client to Anthropic endpoint streaming', () => {
    expect(adapter.supportsStreaming('codex', 'anthropic')).toBe(false);
  });
});

describe('provider adapter registry', () => {
  it('returns OpenAI adapter for openai-compatible family', () => {
    expect(getProviderAdapter('openai_compatible')).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(getProviderAdapter('coze')).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(getProviderAdapter('openrouter')).toBeInstanceOf(OpenAICompatibleAdapter);
  });

  it('returns OpenAI adapter for codex', () => {
    expect(getProviderAdapter('codex')).toBeInstanceOf(OpenAICompatibleAdapter);
  });

  it('returns Anthropic adapter for anthropic-compatible family', () => {
    expect(getProviderAdapter('anthropic_compatible')).toBeInstanceOf(AnthropicCompatibleAdapter);
    expect(getProviderAdapter('deepseek')).toBeInstanceOf(AnthropicCompatibleAdapter);
  });

  it('throws on unsupported provider type', () => {
    expect(() => getProviderAdapter('unknown' as ProviderAccountRow['providerType'])).toThrow(
      ProviderError,
    );
  });
});
