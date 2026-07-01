import { describe, it, expect } from 'vitest';
import {
  toOpenAIChatCompletions,
  toAnthropicMessages,
  toOpenAIResponses,
  mapResponseToSourceProtocol,
} from '../../src/gateway/response-mappers.js';
import type { NormalizedChatResponse } from '@manageyourllm/shared';

function makeNormalized(overrides: Partial<NormalizedChatResponse> = {}): NormalizedChatResponse {
  return {
    id: 'resp-1',
    model: 'real-model',
    content: 'Hello',
    stopReason: null,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    rawResponse: {},
    ...overrides,
  };
}

describe('response mappers', () => {
  it('maps Anthropic stop_reason to OpenAI finish_reason', () => {
    const mapped = toOpenAIChatCompletions(
      'public-model',
      makeNormalized({ stopReason: 'end_turn' }),
    );
    expect((mapped.choices as { finish_reason: string }[])[0].finish_reason).toBe('stop');
  });

  it('maps OpenAI stop finish_reason to Anthropic stop_reason', () => {
    const mapped = toAnthropicMessages('public-model', makeNormalized({ stopReason: 'stop' }));
    expect(mapped.stop_reason).toBe('end_turn');
  });

  it('maps OpenAI length finish_reason to Anthropic max_tokens', () => {
    const mapped = toAnthropicMessages('public-model', makeNormalized({ stopReason: 'length' }));
    expect(mapped.stop_reason).toBe('max_tokens');
  });

  it('maps tool_calls to Anthropic tool_use', () => {
    const mapped = toAnthropicMessages(
      'public-model',
      makeNormalized({ stopReason: 'tool_calls' }),
    );
    expect(mapped.stop_reason).toBe('tool_use');
  });

  it('maps end_turn to OpenAI stop', () => {
    const mapped = mapResponseToSourceProtocol(
      'openai',
      'public-model',
      makeNormalized({ stopReason: 'end_turn' }),
    );
    expect((mapped.choices as { finish_reason: string }[])[0].finish_reason).toBe('stop');
  });

  it('maps stop to Anthropic end_turn', () => {
    const mapped = mapResponseToSourceProtocol(
      'anthropic',
      'public-model',
      makeNormalized({ stopReason: 'stop' }),
    );
    expect(mapped.stop_reason).toBe('end_turn');
  });

  it('preserves OpenAI Responses shape', () => {
    const mapped = toOpenAIResponses('public-model', makeNormalized({ stopReason: 'stop' }));
    expect(mapped.object).toBe('response');
    expect(mapped.model).toBe('public-model');
  });
});
