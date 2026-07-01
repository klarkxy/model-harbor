import type {
  ChatRequestIR,
  NormalizedChatResponse,
  AnthropicMessagesResponse,
  AnthropicMessagesRequest,
  SourceProtocol,
} from '@manageyourllm/shared';
import {
  ProviderError,
  ProviderAuthError,
  ProviderBadRequestError,
  ProviderContentPolicyError,
  ProviderContextWindowExceededError,
  ProviderModelNotFoundError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  type NormalizedError,
} from '@manageyourllm/shared';
import type {
  BuildRequestContext,
  NormalizeResponseContext,
  NormalizeErrorContext,
  ProviderHttpRequest,
  ProviderAdapter,
} from './adapter.js';
import { parseRetryAfterHeader } from '../retry-after.js';

function buildMessagesBody(ir: ChatRequestIR, realModelName: string): AnthropicMessagesRequest {
  const messages = ir.messages.map((msg) => ({
    role:
      msg.role === 'tool'
        ? ('user' as const)
        : msg.role === 'system'
          ? ('user' as const)
          : msg.role,
    content: msg.content,
  }));
  const body: AnthropicMessagesRequest = {
    model: realModelName,
    messages,
    stream: ir.stream,
  };
  if (ir.system) body.system = ir.system;
  if (ir.maxTokens != null) body.max_tokens = ir.maxTokens;
  if (ir.temperature != null) body.temperature = ir.temperature;
  if (ir.topP != null) body.top_p = ir.topP;
  if (ir.metadata.user_id) body.metadata = { user_id: ir.metadata.user_id };
  return body;
}

function normalizeResponse(body: AnthropicMessagesResponse): NormalizedChatResponse {
  const content = body.content ?? [];
  const text = content
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('');
  const usage = body.usage;
  return {
    id: body.id ?? 'unknown',
    model: body.model ?? 'unknown',
    content: text,
    stopReason: body.stop_reason ?? null,
    usage: usage
      ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheWriteTokens: usage.cache_creation_input_tokens,
        }
      : null,
    rawResponse: body,
  };
}

function normalizeErrorBody(status: number, body: unknown): { message: string; code?: string } {
  if (body && typeof body === 'object') {
    const err = (body as Record<string, unknown>)['error'];
    if (err && typeof err === 'object') {
      return {
        message: String((err as Record<string, unknown>)['message'] ?? 'Upstream error'),
        code: String((err as Record<string, unknown>)['type'] ?? ''),
      };
    }
  }
  return { message: `Upstream HTTP ${status}` };
}

export class AnthropicCompatibleAdapter implements ProviderAdapter {
  buildRequest(ctx: BuildRequestContext): ProviderHttpRequest {
    const {
      providerAccount,
      endpointUrl,
      endpointProtocol,
      endpointPath,
      realModelName,
      ir,
      authHeaders,
    } = ctx;
    const baseUrl = endpointUrl.replace(/\/$/, '');
    const path = endpointPath ?? '/v1/messages';
    const body = buildMessagesBody(ir, realModelName);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...authHeaders,
      ...(providerAccount.defaultHeadersJson ?? {}),
      ...(providerAccount.extraHeadersJson ?? {}),
    };

    // Anthropic-compatible adapter 目前只负责 Anthropic Messages 端点。
    // 若未来需要让它同时发出 OpenAI 格式请求，可在这里根据 endpointProtocol 切换。
    if (endpointProtocol !== 'anthropic') {
      throw new ProviderError(
        `anthropic-compatible adapter 不支持 endpoint protocol: ${endpointProtocol}`,
        { status: 500 },
      );
    }

    return {
      url: `${baseUrl}${path}`,
      method: 'POST',
      headers,
      body: { ...body, ...(providerAccount.extraParamsJson ?? {}) },
    };
  }

  normalizeResponse(ctx: NormalizeResponseContext): NormalizedChatResponse {
    return normalizeResponse(ctx.body as AnthropicMessagesResponse);
  }

  normalizeError(ctx: NormalizeErrorContext): NormalizedError {
    const { status, headers, body } = ctx;
    const { message, code } = normalizeErrorBody(status, body);
    const retryAfterMs = parseRetryAfterHeader(headers?.['retry-after'] ?? headers?.['Retry-After']);
    if (status === 429) return new ProviderRateLimitError(message, { code, status, retryAfterMs });
    if (status === 408) return new ProviderTimeoutError(message, { code, status, retryAfterMs });
    if (code?.includes('quota') || code?.includes('rate_limit')) {
      return new ProviderQuotaError(message, { code, status, retryAfterMs });
    }
    // v1 Phase 5：错误分类细化，4xx 不再全部归 provider_error。
    // Anthropic 错误 type 形如 'authentication_error' / 'permission_error' / 'not_found_error' 等。
    const codeLower = code?.toLowerCase() ?? '';
    const messageLower = message.toLowerCase();
    // LiteLLM 借鉴：context window / content policy 属于请求侧错误，不归 provider_error。
    if (
      codeLower.includes('context_limit') ||
      codeLower.includes('context_window') ||
      codeLower.includes('max_tokens') ||
      messageLower.includes('context limit') ||
      messageLower.includes('context window') ||
      messageLower.includes('token limit') ||
      messageLower.includes('maximum length')
    ) {
      return new ProviderContextWindowExceededError(message, { code, status, retryAfterMs });
    }
    if (
      codeLower.includes('content_policy') ||
      codeLower.includes('content_filter') ||
      codeLower.includes('safety') ||
      messageLower.includes('content policy') ||
      messageLower.includes('safety') ||
      messageLower.includes('policy violation')
    ) {
      return new ProviderContentPolicyError(message, { code, status, retryAfterMs });
    }
    if (status === 401 || status === 403) {
      return new ProviderAuthError(message, { code, status, retryAfterMs });
    }
    if (codeLower.includes('permission') || codeLower.includes('authentication')) {
      return new ProviderAuthError(message, { code, status, retryAfterMs });
    }
    if (status === 404 || codeLower.includes('not_found')) {
      if (codeLower.includes('model') || /model/i.test(message)) {
        return new ProviderModelNotFoundError(message, { code, status, retryAfterMs });
      }
      return new ProviderBadRequestError(message, { code, status, retryAfterMs });
    }
    if (status === 400 || status === 422 || codeLower.includes('invalid_request')) {
      return new ProviderBadRequestError(message, { code, status, retryAfterMs });
    }
    if (status === 529 || codeLower.includes('overloaded') || codeLower.includes('capacity')) {
      return new ProviderOverloadedError(message, { code, status, retryAfterMs });
    }
    return new ProviderError(message, { code, status, retryAfterMs });
  }

  supportsStreaming(sourceProtocol: SourceProtocol, endpointProtocol: SourceProtocol): boolean {
    // Anthropic Messages 端点原生支持 Anthropic 流式，也可为 OpenAI 客户端做跨协议转换。
    if (endpointProtocol === 'anthropic') {
      return sourceProtocol === 'anthropic' || sourceProtocol === 'openai';
    }
    return false;
  }
}
