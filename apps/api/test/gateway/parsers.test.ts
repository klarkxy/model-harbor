import { describe, it, expect } from 'vitest';
import { parseAnthropicMessages } from '../../src/gateway/parsers/anthropic.js';
import { parseOpenAIChatCompletions } from '../../src/gateway/parsers/openai-chat.js';
import { parseOpenAIResponses } from '../../src/gateway/parsers/openai-responses.js';
import { ValidationError } from '@manageyourllm/shared';

describe('gateway parsers', () => {
  describe('parseAnthropicMessages', () => {
    it('parses a basic text request', () => {
      const ir = parseAnthropicMessages({
        model: 'claude-3-5-sonnet',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
        stream: false,
        metadata: { user_id: 'user-1' },
      });
      expect(ir.sourceProtocol).toBe('anthropic');
      expect(ir.requestedModel).toBe('claude-3-5-sonnet');
      expect(ir.messages).toHaveLength(2);
      expect(ir.messages[0].role).toBe('user');
      expect(ir.messages[0].content).toBe('Hello');
      expect(ir.maxTokens).toBe(1024);
      expect(ir.temperature).toBe(0.7);
      expect(ir.topP).toBe(0.9);
      expect(ir.stream).toBe(false);
      expect(ir.metadata).toEqual({ user_id: 'user-1' });
    });

    it('extracts text from content blocks', () => {
      const ir = parseAnthropicMessages({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        max_tokens: 100,
      });
      expect(ir.messages[0].content).toBe('Hello');
    });

    it('extracts system from string or blocks', () => {
      const ir1 = parseAnthropicMessages({
        model: 'claude',
        system: 'Be concise',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(ir1.system).toBe('Be concise');

      const ir2 = parseAnthropicMessages({
        model: 'claude',
        system: [{ type: 'text', text: 'Be helpful' }],
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(ir2.system).toBe('Be helpful');
    });

    it('throws on missing model', () => {
      expect(() =>
        parseAnthropicMessages({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).toThrow(ValidationError);
    });

    it('throws on empty messages', () => {
      expect(() =>
        parseAnthropicMessages({
          model: 'claude',
          messages: [],
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('parseOpenAIChatCompletions', () => {
    it('parses a basic request and merges system messages', () => {
      const ir = parseOpenAIChatCompletions({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        max_tokens: 1024,
        temperature: 0.5,
        user: 'user-1',
      });
      expect(ir.sourceProtocol).toBe('openai');
      expect(ir.requestedModel).toBe('gpt-4o');
      expect(ir.system).toBe('You are helpful');
      expect(ir.messages).toHaveLength(2);
      expect(ir.messages[0].role).toBe('user');
      expect(ir.messages[1].role).toBe('assistant');
      expect(ir.metadata).toEqual({ user_id: 'user-1' });
    });

    it('preserves tool messages and tool call id', () => {
      const ir = parseOpenAIChatCompletions({
        model: 'gpt-4o',
        messages: [{ role: 'tool', content: 'result', tool_call_id: 'call-1' }],
      });
      expect(ir.messages[0].role).toBe('tool');
      expect(ir.messages[0].toolCallId).toBe('call-1');
    });

    it('throws on invalid body', () => {
      expect(() => parseOpenAIChatCompletions(null)).toThrow(ValidationError);
      expect(() => parseOpenAIChatCompletions({ model: 'gpt' })).toThrow(ValidationError);
    });
  });

  describe('parseOpenAIResponses', () => {
    it('parses string input as single user message', () => {
      const ir = parseOpenAIResponses({
        model: 'o1-mini',
        input: 'Hello',
        instructions: 'Be concise',
        max_output_tokens: 512,
      });
      expect(ir.sourceProtocol).toBe('codex');
      expect(ir.requestedModel).toBe('o1-mini');
      expect(ir.messages).toHaveLength(1);
      expect(ir.messages[0].role).toBe('user');
      expect(ir.messages[0].content).toBe('Hello');
      expect(ir.system).toBe('Be concise');
      expect(ir.maxTokens).toBe(512);
    });

    it('parses array input items', () => {
      const ir = parseOpenAIResponses({
        model: 'o1',
        input: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
          { role: 'developer', content: 'System prompt' },
        ],
      });
      expect(ir.messages).toHaveLength(2);
      expect(ir.system).toBe('System prompt');
    });

    it('throws when input is missing', () => {
      expect(() => parseOpenAIResponses({ model: 'o1' })).toThrow(ValidationError);
    });
  });
});
