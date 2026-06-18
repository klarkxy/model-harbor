import {
  type AnthropicContentBlock,
  type AnthropicMessagesRequest,
  type NormalizedChatResponse,
  type ProviderCapabilities,
  type ProviderType,
} from '@modelharbor/shared';
import type {
  AnthropicResponseShape,
  NormalizedProviderError,
  ProviderAdapter,
  ProviderErrorContext,
  ProviderHttpRequest,
  ProviderRequestContext,
  ProviderResponseContext,
  ProviderStreamEventContext,
  ProviderStreamEventResult,
} from './types.js';
import { classifyHttpError, emptyProviderError, readErrorFromResponse } from './errors.js';

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MESSAGES_PATH = '/v1/messages';

function buildMessagesBody(context: ProviderRequestContext): AnthropicMessagesRequest {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of context.ir.messages) {
    if (m.role !== 'user' && m.role !== 'assistant') {
      // The Anthropic Messages API only accepts user/assistant; system goes
      // to the top-level `system` field. M3 just drops tool/system messages
      // here (they were already extracted by the IR converter).
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }
  const body: AnthropicMessagesRequest = {
    model: context.realModelName,
    messages,
  };
  if (context.ir.system) body.system = context.ir.system;
  if (context.ir.maxTokens !== null) body.max_tokens = context.ir.maxTokens;
  if (context.ir.temperature !== null) body.temperature = context.ir.temperature;
  if (context.ir.topP !== null) body.top_p = context.ir.topP;
  if (context.ir.stream) body.stream = true;
  if (context.ir.metadata && Object.keys(context.ir.metadata).length > 0) {
    body.metadata = context.ir.metadata;
  }
  return body;
}

function extractAssistantText(content: AnthropicContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const t = (block as { text?: string }).text;
      if (typeof t === 'string') parts.push(t);
    }
  }
  return parts.join('');
}

function normalizeStopReason(value: string | null): string | null {
  if (!value) return null;
  switch (value) {
    case 'end_turn':
    case 'max_tokens':
    case 'stop_sequence':
    case 'tool_use':
      return value;
    default:
      return value;
  }
}

export function createAnthropicCompatibleAdapter(): ProviderAdapter {
  return {
    type: 'anthropic_compatible' as ProviderType,

    capabilities: {
      protocols: ['anthropic'],
      supportsStreaming: true,
      supportsSystemPrompt: true,
      supportsTools: false,
      supportsToolChoice: false,
      supportsVision: false,
      supportsJsonMode: false,
      supportsThinking: false,
      usageAvailability: 'always',
    } satisfies ProviderCapabilities,

    buildRequest(context: ProviderRequestContext): ProviderHttpRequest {
      const body = buildMessagesBody(context);
      // Concatenate baseUrl with the protocol path. The baseUrl is the upstream
      // key's configured URL (e.g. "https://api.anthropic.com") and we append
      // the fixed path. Trailing slashes on baseUrl are normalized so we don't
      // produce "//v1/messages". When apiPath is provided it overrides the
      // default path entirely.
      const base = context.baseUrl.replace(/\/+$/, '');
      const path = context.apiPath ?? ANTHROPIC_MESSAGES_PATH;
      return {
        method: 'POST',
        url: `${base}${path}`,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': context.apiKey,
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      };
    },

    normalizeResponse(context: ProviderResponseContext): NormalizedChatResponse {
      const json = context.response.bodyJson as AnthropicResponseShape | null;
      if (!json || typeof json !== 'object') {
        throw new Error('anthropic: empty or non-JSON response');
      }
      const text = extractAssistantText(json.content ?? []);
      const input = json.usage?.input_tokens ?? 0;
      const output = json.usage?.output_tokens ?? 0;
      return {
        id: json.id,
        model: json.model,
        content: text,
        stopReason: normalizeStopReason(json.stop_reason ?? null),
        usage: {
          inputTokens: input,
          outputTokens: output,
          totalTokens: input + output,
        },
        rawResponse: json,
      };
    },

    normalizeStreamEvent(context: ProviderStreamEventContext): ProviderStreamEventResult {
      // Anthropic Messages stream events:
      //   message_start, content_block_start, ping, content_block_delta,
      //   content_block_stop, message_delta (carries usage + stop_reason),
      //   message_stop.
      // We surface a normalized kind for each so the gateway can drive
      // response handling (capture usage, know when to end) while still
      // forwarding the raw event frame to the client.
      const event = context.event ?? '';
      const data = context.data;
      if (event === 'message_start') {
        // message_start also carries the initial input_tokens count. The
        // SDK (and our tests) wants input tokens available before the
        // first delta arrives, so surface a usage kind when present.
        let parsed: {
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        } | null = null;
        try {
          parsed = JSON.parse(data) as {
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          };
        } catch {
          return { kind: 'open' };
        }
        const usage = parsed?.message?.usage;
        if (
          usage &&
          (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number')
        ) {
          const inputTokens = usage.input_tokens ?? 0;
          const outputTokens = usage.output_tokens ?? 0;
          return {
            kind: 'usage',
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
        }
        return { kind: 'open' };
      }
      if (event === 'content_block_delta') {
        let parsed: { delta?: { type?: string; text?: string } } | null = null;
        try {
          parsed = JSON.parse(data) as { delta?: { type?: string; text?: string } };
        } catch {
          return { kind: 'ignored' };
        }
        const text = parsed?.delta?.type === 'text_delta' ? parsed.delta.text : undefined;
        if (typeof text === 'string') {
          return { kind: 'delta', text };
        }
        return { kind: 'ignored' };
      }
      if (event === 'message_delta') {
        let parsed: {
          delta?: { stop_reason?: string | null };
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        } | null = null;
        try {
          parsed = JSON.parse(data) as {
            delta?: { stop_reason?: string | null };
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
        } catch {
          return { kind: 'stop', reason: null };
        }
        const reason = parsed?.delta?.stop_reason ?? null;
        const usage = parsed?.usage;
        // message_delta carries the final output_tokens. We emit a usage
        // event with output_tokens and a sentinel of -1 for input_tokens
        // so the gateway can merge this with the input_tokens it
        // captured from message_start without losing it. The gateway
        // translates -1 to "keep previous input_tokens".
        if (usage && typeof usage.output_tokens === 'number') {
          return {
            kind: 'usage',
            inputTokens: -1,
            outputTokens: usage.output_tokens,
            totalTokens: -1,
          };
        }
        return { kind: 'stop', reason };
      }
      if (event === 'message_stop') {
        return { kind: 'stop', reason: null };
      }
      // content_block_start, content_block_stop, ping, anything else
      return { kind: 'ignored' };
    },

    normalizeError(context: ProviderErrorContext): NormalizedProviderError {
      const { message, code, bodyJson } = readErrorFromResponse(
        context.response,
        context.request,
        context.transportError,
      );
      if (!context.response) {
        // transport error
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
      const json = context.response.bodyJson as AnthropicResponseShape | null;
      if (!json || typeof json !== 'object' || !json.usage) return null;
      const input = json.usage.input_tokens ?? 0;
      const output = json.usage.output_tokens ?? 0;
      return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
      };
    },
  };
}

// Helper: build an Anthropic-compatible HTTP request. baseUrl + apiKey are
// taken from `context.baseUrl` and `context.apiKey`. Just a typed
// pass-through to `adapter.buildRequest(ctx)` for tests; the M4 sender
// calls the adapter directly.
export function buildAnthropicCompatibleRequest(
  context: ProviderRequestContext,
): ProviderHttpRequest {
  return createAnthropicCompatibleAdapter().buildRequest(context);
}
