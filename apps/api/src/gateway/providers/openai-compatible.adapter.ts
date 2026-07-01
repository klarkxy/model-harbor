import type {
  ChatRequestIR,
  NormalizedChatResponse,
  OpenAIChatCompletionsResponse,
  OpenAIResponsesResponse,
  OpenAIChatMessage,
  OpenAIResponsesInputItem,
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

function buildChatCompletionBody(ir: ChatRequestIR): Record<string, unknown> {
  const messages: OpenAIChatMessage[] = [];
  if (ir.system) {
    messages.push({ role: 'system', content: ir.system });
  }
  for (const msg of ir.messages) {
    if (msg.role === 'tool') {
      messages.push({ role: 'tool', content: msg.content, tool_call_id: msg.toolCallId });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  const body: Record<string, unknown> = {
    model: ir.requestedModel,
    messages,
    stream: ir.stream,
  };
  if (ir.maxTokens != null) body.max_tokens = ir.maxTokens;
  if (ir.temperature != null) body.temperature = ir.temperature;
  if (ir.topP != null) body.top_p = ir.topP;
  if (ir.stream) body.stream_options = { include_usage: true };
  return body;
}

function buildResponsesBody(ir: ChatRequestIR): Record<string, unknown> {
  let input: string | OpenAIResponsesInputItem[];
  if (ir.messages.length === 1 && ir.messages[0]?.role === 'user') {
    input = ir.messages[0].content;
  } else {
    input = ir.messages.map((msg) => {
      if (msg.role === 'tool') {
        return { type: 'message', role: 'tool', content: msg.content, call_id: msg.toolCallId };
      }
      return { type: 'message', role: msg.role, content: msg.content };
    });
  }
  const body: Record<string, unknown> = { model: ir.requestedModel, input, stream: ir.stream };
  if (ir.system) body.instructions = ir.system;
  if (ir.maxTokens != null) body.max_output_tokens = ir.maxTokens;
  if (ir.temperature != null) body.temperature = ir.temperature;
  if (ir.topP != null) body.top_p = ir.topP;
  if (ir.stream) body.stream_options = { include_usage: true };
  return body;
}

function normalizeChatResponse(body: OpenAIChatCompletionsResponse): NormalizedChatResponse {
  const choice = body.choices?.[0];
  const messageContent = choice?.message?.content ?? '';
  const usage = body.usage;
  return {
    id: body.id ?? 'unknown',
    model: body.model ?? 'unknown',
    content: typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent),
    stopReason: choice?.finish_reason ?? null,
    usage: usage
      ? {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : null,
    rawResponse: body,
  };
}

function normalizeResponsesResponse(body: OpenAIResponsesResponse): NormalizedChatResponse {
  const output = body.output?.[0];
  const text = output?.content?.[0]?.text ?? '';
  const usage = body.usage;
  return {
    id: body.id ?? 'unknown',
    model: body.model ?? 'unknown',
    content: text,
    stopReason: null,
    usage: usage
      ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.total_tokens,
        }
      : null,
    rawResponse: body,
  };
}

function normalizeErrorBody(
  status: number,
  body: unknown,
): { message: string; code?: string | null } {
  if (body && typeof body === 'object') {
    const err = (body as Record<string, unknown>)['error'];
    if (err && typeof err === 'object') {
      return {
        message: String((err as Record<string, unknown>)['message'] ?? 'Upstream error'),
        code: (err as Record<string, unknown>)['code'] as string | null | undefined,
      };
    }
  }
  return { message: `Upstream HTTP ${status}` };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
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
    const isResponses = endpointProtocol === 'codex';
    const defaultPath = isResponses ? '/v1/responses' : '/v1/chat/completions';
    const path = endpointPath ?? defaultPath;
    const baseUrl = endpointUrl.replace(/\/$/, '');
    const body = isResponses
      ? buildResponsesBody({ ...ir, requestedModel: realModelName })
      : buildChatCompletionBody({ ...ir, requestedModel: realModelName });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(providerAccount.defaultHeadersJson ?? {}),
      ...(providerAccount.extraHeadersJson ?? {}),
    };

    return {
      url: `${baseUrl}${path}`,
      method: 'POST',
      headers,
      body: { ...body, ...(providerAccount.extraParamsJson ?? {}) },
    };
  }

  normalizeResponse(ctx: NormalizeResponseContext): NormalizedChatResponse {
    const body = ctx.body as OpenAIChatCompletionsResponse | OpenAIResponsesResponse;
    if (ctx.endpointProtocol === 'codex') {
      return normalizeResponsesResponse(body as OpenAIResponsesResponse);
    }
    return normalizeChatResponse(body as OpenAIChatCompletionsResponse);
  }

  normalizeError(ctx: NormalizeErrorContext): NormalizedError {
    const { status, body } = ctx;
    const { message, code } = normalizeErrorBody(status, body);
    if (status === 429) return new ProviderRateLimitError(message, { code });
    if (status === 408) return new ProviderTimeoutError(message, { code });
    if (code === 'insufficient_quota' || code === 'quota_exceeded') {
      return new ProviderQuotaError(message, { code });
    }
    // v1 Phase 5：错误分类细化，4xx 不再全部归 provider_error。
    // LiteLLM 借鉴：context window / content policy 属于请求侧错误，不归 provider_error。
    const codeLower = (code ?? '').toLowerCase();
    const messageLower = message.toLowerCase();
    if (
      codeLower.includes('context_length') ||
      codeLower.includes('context_window') ||
      codeLower.includes('max_tokens') ||
      messageLower.includes('context length') ||
      messageLower.includes('context window') ||
      messageLower.includes('maximum context length') ||
      messageLower.includes('tokens') && messageLower.includes('limit')
    ) {
      return new ProviderContextWindowExceededError(message, { code, status });
    }
    if (
      codeLower.includes('content_filter') ||
      codeLower.includes('content_policy') ||
      codeLower.includes('moderation') ||
      codeLower.includes('safety') ||
      messageLower.includes('content policy') ||
      messageLower.includes('content filter') ||
      messageLower.includes('moderation')
    ) {
      return new ProviderContentPolicyError(message, { code, status });
    }
    if (status === 401 || status === 403) return new ProviderAuthError(message, { code, status });
    if (status === 404) {
      // 404 但 code 明显指 model 而不是端点路径，认作 model_not_found；
      // 否则仍按 4xx 兜底为 bad_request，让 Trace 提示路径配置风险。
      if (typeof code === 'string' && /model/i.test(code)) {
        return new ProviderModelNotFoundError(message, { code, status });
      }
      return new ProviderBadRequestError(message, { code, status });
    }
    if (status === 400 || status === 422)
      return new ProviderBadRequestError(message, { code, status });
    // 5xx / 其他：归 ProviderError，保留计入 cooldown / breaker 的语义。
    // overloaded（529 或 code 字段含 overloaded / capacity）单独归类便于排障，
    // 也保留计入 cooldown。
    if (
      status === 529 ||
      (typeof code === 'string' && (/overloaded/i.test(code) || /capacity/i.test(code)))
    ) {
      return new ProviderOverloadedError(message, { code, status });
    }
    return new ProviderError(message, { code, status });
  }

  supportsStreaming(sourceProtocol: SourceProtocol, endpointProtocol: SourceProtocol): boolean {
    const openaiFamily = new Set<SourceProtocol>(['openai', 'codex']);
    // OpenAI/Codex 端点原生支持 OpenAI 家族流式。
    if (openaiFamily.has(endpointProtocol) && openaiFamily.has(sourceProtocol)) {
      return true;
    }
    // Anthropic 客户端 → OpenAI Chat 上游流式可转换。
    if (sourceProtocol === 'anthropic' && endpointProtocol === 'openai') {
      return true;
    }
    return false;
  }
}
