import type { NormalizedChatResponse, ChatUsageIR } from '@manageyourllm/shared';

function toUsage(usage: ChatUsageIR | null) {
  if (!usage) return undefined;
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  };
}

function mapStopReasonToOpenAI(stopReason: string | null): string | null {
  if (stopReason === 'end_turn') return 'stop';
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'tool_use') return 'tool_calls';
  if (stopReason === 'stop_sequence') return 'stop';
  return stopReason ?? 'stop';
}

function mapStopReasonToAnthropic(stopReason: string | null): string | null {
  if (stopReason === 'stop') return 'end_turn';
  if (stopReason === 'length') return 'max_tokens';
  if (stopReason === 'tool_calls' || stopReason === 'function_call') return 'tool_use';
  return stopReason;
}

export function toOpenAIChatCompletions(
  requestedModel: string,
  normalized: NormalizedChatResponse,
): Record<string, unknown> {
  return {
    id: normalized.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: normalized.content,
        },
        finish_reason: mapStopReasonToOpenAI(normalized.stopReason),
      },
    ],
    usage: toUsage(normalized.usage),
  };
}

export function toOpenAIResponses(
  requestedModel: string,
  normalized: NormalizedChatResponse,
): Record<string, unknown> {
  return {
    id: normalized.id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: requestedModel,
    output: [
      {
        type: 'message',
        id: normalized.id,
        role: 'assistant',
        content: [{ type: 'output_text', text: normalized.content }],
      },
    ],
    usage: normalized.usage
      ? {
          input_tokens: normalized.usage.inputTokens,
          output_tokens: normalized.usage.outputTokens,
          total_tokens: normalized.usage.totalTokens,
        }
      : undefined,
  };
}

export function toAnthropicMessages(
  requestedModel: string,
  normalized: NormalizedChatResponse,
): Record<string, unknown> {
  return {
    id: normalized.id,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content: [{ type: 'text', text: normalized.content }],
    stop_reason: mapStopReasonToAnthropic(normalized.stopReason),
    stop_sequence: null,
    usage: normalized.usage
      ? {
          input_tokens: normalized.usage.inputTokens,
          output_tokens: normalized.usage.outputTokens,
          cache_creation_input_tokens: normalized.usage.cacheWriteTokens ?? 0,
          cache_read_input_tokens: normalized.usage.cacheReadTokens ?? 0,
        }
      : undefined,
  };
}

export function mapResponseToSourceProtocol(
  sourceProtocol: 'openai' | 'anthropic' | 'codex',
  requestedModel: string,
  normalized: NormalizedChatResponse,
): Record<string, unknown> {
  if (sourceProtocol === 'anthropic') {
    return toAnthropicMessages(requestedModel, normalized);
  }
  if (sourceProtocol === 'codex') {
    return toOpenAIResponses(requestedModel, normalized);
  }
  return toOpenAIChatCompletions(requestedModel, normalized);
}
