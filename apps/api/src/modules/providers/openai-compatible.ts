import {
  type NormalizedChatResponse,
  type OpenAIChatMessage,
  type OpenAIChatCompletionsRequest,
  type ProviderCapabilities,
  type ProviderType,
} from '@modelharbor/shared';
import type {
  NormalizedProviderError,
  OpenAIResponseShape,
  ProviderAdapter,
  ProviderErrorContext,
  ProviderHttpRequest,
  ProviderRequestContext,
  ProviderResponseContext,
  ProviderStreamEventContext,
  ProviderStreamEventResult,
} from './types.js';
import { classifyHttpError, emptyProviderError, readErrorFromResponse } from './errors.js';

const OPENAI_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

function buildRequestBody(context: ProviderRequestContext): OpenAIChatCompletionsRequest {
  const messages: OpenAIChatMessage[] = [];
  if (context.ir.system) {
    messages.push({ role: 'system', content: context.ir.system });
  }
  for (const m of context.ir.messages) {
    // Skip empty tool messages for M3 (we don't handle them yet)
    if (m.role === 'tool') {
      messages.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId });
      continue;
    }
    if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content });
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    messages.push({ role: m.role, content: m.content });
  }
  const body: OpenAIChatCompletionsRequest = {
    model: context.realModelName,
    messages,
  };
  if (context.ir.maxTokens !== null) body.max_tokens = context.ir.maxTokens;
  if (context.ir.temperature !== null) body.temperature = context.ir.temperature;
  if (context.ir.topP !== null) body.top_p = context.ir.topP;
  if (context.ir.stream) body.stream = true;
  // For sticky-routing we set `user` to the consumer key id so providers can
  // rate-limit per-app if they want to.
  if (context.ir.metadata && typeof context.ir.metadata['user_id'] === 'string') {
    body.user = context.ir.metadata['user_id'] as string;
  }
  return body;
}

function normalizeFinishReason(value: string | null): string | null {
  if (!value) return null;
  switch (value) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
    case 'function_call':
      return value;
    default:
      return value;
  }
}

export function createOpenAICompatibleAdapter(): ProviderAdapter {
  return {
    type: 'openai_compatible' as ProviderType,

    capabilities: {
      protocols: ['openai'],
      supportsStreaming: true,
      supportsSystemPrompt: true,
      supportsTools: false,
      supportsToolChoice: false,
      supportsVision: false,
      supportsJsonMode: false,
      supportsThinking: false,
      usageAvailability: 'on_demand',
    } satisfies ProviderCapabilities,

    buildRequest(context: ProviderRequestContext): ProviderHttpRequest {
      const body = buildRequestBody(context);
      const base = context.baseUrl.replace(/\/+$/, '');
      const path = context.apiPath ?? OPENAI_CHAT_COMPLETIONS_PATH;
      return {
        method: 'POST',
        url: `${base}${path}`,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${context.apiKey}`,
        },
        body: JSON.stringify(body),
      };
    },

    normalizeResponse(context: ProviderResponseContext): NormalizedChatResponse {
      const json = context.response.bodyJson as OpenAIResponseShape | null;
      if (!json || typeof json !== 'object') {
        throw new Error('openai: empty or non-JSON response');
      }
      const first = json.choices?.[0];
      const text = first?.message?.content ?? '';
      const usage = json.usage
        ? {
            inputTokens: json.usage.prompt_tokens ?? 0,
            outputTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : null;
      return {
        id: json.id,
        model: json.model,
        content: text,
        stopReason: normalizeFinishReason(first?.finish_reason ?? null),
        usage,
        rawResponse: json,
      };
    },

    normalizeStreamEvent(context: ProviderStreamEventContext): ProviderStreamEventResult {
      // OpenAI Chat Completions stream events are bare `data: <json>` lines
      // (no `event:` line). The terminal event is `data: [DONE]`. Chunks
      // carry `choices: [{ delta: { content, role }, finish_reason, index }]`
      // and may carry a final `usage` object in the last chunk.
      const data = context.data;
      if (data === '[DONE]') {
        return { kind: 'stop', reason: null };
      }
      let parsed: {
        choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      } | null = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        return { kind: 'ignored' };
      }
      const usage = parsed?.usage;
      if (
        usage &&
        (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number')
      ) {
        const inputTokens = usage.prompt_tokens ?? 0;
        const outputTokens = usage.completion_tokens ?? 0;
        return {
          kind: 'usage',
          inputTokens,
          outputTokens,
          totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
        };
      }
      const choice = parsed?.choices?.[0];
      if (!choice) {
        return { kind: 'ignored' };
      }
      const text = choice.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        return { kind: 'delta', text };
      }
      if (choice.finish_reason) {
        return { kind: 'stop', reason: choice.finish_reason };
      }
      return { kind: 'ignored' };
    },

    normalizeError(context: ProviderErrorContext): NormalizedProviderError {
      const { message, code, bodyJson } = readErrorFromResponse(
        context.response,
        context.request,
        context.transportError,
      );
      if (!context.response) {
        return {
          ...emptyProviderError(),
          category: 'provider_timeout',
          providerMessage: message,
          upstreamStatus: 0,
        };
      }
      const category =
        classifyHttpError(
          context.response.status,
          bodyJson,
          context.response.bodyText,
          message,
          code,
        ) ?? 'provider_unknown';
      return {
        category,
        providerMessage: message,
        providerCode: code,
        upstreamStatus: context.response.status,
      };
    },

    extractUsage(context: ProviderResponseContext): NormalizedChatResponse['usage'] {
      const json = context.response.bodyJson as OpenAIResponseShape | null;
      if (!json || typeof json !== 'object' || !json.usage) return null;
      return {
        inputTokens: json.usage.prompt_tokens ?? 0,
        outputTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
      };
    },
  };
}

// Helper: build an OpenAI-compatible HTTP request. baseUrl + apiKey are
// taken from `context.baseUrl` and `context.apiKey`. Just a typed
// pass-through to `adapter.buildRequest(ctx)` for tests; the M4 sender
// calls the adapter directly.
export function buildOpenAICompatibleRequest(context: ProviderRequestContext): ProviderHttpRequest {
  return createOpenAICompatibleAdapter().buildRequest(context);
}
