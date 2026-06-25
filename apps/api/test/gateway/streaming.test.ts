import { describe, it, expect, vi } from 'vitest';
import { createStreamTransformer } from '../../src/gateway/streaming.js';
import type { ChatUsageIR } from '@manageyourllm/shared';

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += new TextDecoder().decode(value);
  }
  return result;
}

function makeSource(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index++;
    },
  });
}

describe('createStreamTransformer', () => {
  it('rewrites OpenAI chat stream model and extracts usage', async () => {
    const onUsage = vi.fn<(usage: ChatUsageIR | null) => void>();
    const source = makeSource([
      'data: {"id":"c1","object":"chat.completion.chunk","model":"real-model","choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","model":"real-model","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","model":"real-model","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]);

    const transformed = source.pipeThrough(
      createStreamTransformer({
        requestedModel: 'gpt-4o',
        sourceProtocol: 'openai',
        onUsage,
      }),
    );

    const text = await collectStream(transformed);
    expect(text).toContain('"model":"gpt-4o"');
    expect(text).toContain('data: [DONE]');
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 2, outputTokens: 1, totalTokens: 3 });
  });

  it('rewrites OpenAI Responses stream model', async () => {
    const onUsage = vi.fn<(usage: ChatUsageIR | null) => void>();
    const source = makeSource([
      'data: {"type":"response.created","response":{"id":"r1","model":"real-codex"}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r1","model":"real-codex","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}\n\n',
    ]);

    const transformed = source.pipeThrough(
      createStreamTransformer({
        requestedModel: 'codex-public',
        sourceProtocol: 'codex',
        onUsage,
      }),
    );

    const text = await collectStream(transformed);
    expect(text).toContain('"model":"codex-public"');
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  });

  it('rewrites Anthropic stream model and accumulates usage', async () => {
    const onUsage = vi.fn<(usage: ChatUsageIR | null) => void>();
    const source = makeSource([
      'data: {"type":"message_start","message":{"id":"m1","model":"claude-3-real","usage":{"input_tokens":5}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
    ]);

    const transformed = source.pipeThrough(
      createStreamTransformer({
        requestedModel: 'claude-public',
        sourceProtocol: 'anthropic',
        onUsage,
      }),
    );

    const text = await collectStream(transformed);
    expect(text).toContain('"model":"claude-public"');
    expect(text).toContain('"type":"content_block_delta"');
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });

  it('emits error SSE on malformed event', async () => {
    const onUsage = vi.fn<(usage: ChatUsageIR | null) => void>();
    const source = makeSource(['data: not-json\n\n']);

    const transformed = source.pipeThrough(
      createStreamTransformer({
        requestedModel: 'gpt-4o',
        sourceProtocol: 'openai',
        onUsage,
      }),
    );

    const text = await collectStream(transformed);
    expect(text).toContain('"error"');
    expect(onUsage).toHaveBeenCalledWith(null);
  });
});


describe('createStreamTransformer content collection', () => {
  it('collects OpenAI assistant content', async () => {
    const onComplete = vi.fn<(payload: { content: string; usage: ChatUsageIR | null }) => void>();
    const source = makeSource([
      'data: {"id":"c1","object":"chat.completion.chunk","model":"real-model","choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","model":"real-model","choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","model":"real-model","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ]);

    const transformed = source.pipeThrough(
      createStreamTransformer({
        requestedModel: 'gpt-4o',
        sourceProtocol: 'openai',
        onComplete,
      }),
    );

    await collectStream(transformed);
    expect(onComplete).toHaveBeenCalledWith({
      content: 'Hello world',
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    });
  });

  it('collects Anthropic assistant content', async () => {
    const onComplete = vi.fn<(payload: { content: string; usage: ChatUsageIR | null }) => void>();
    const source = makeSource([
      'data: {"type":"content_block_start","content_block":{"type":"text","text":"Hi "}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
    ]);

    const transformed = source.pipeThrough(
      createStreamTransformer({
        requestedModel: 'claude-public',
        sourceProtocol: 'anthropic',
        onComplete,
      }),
    );

    await collectStream(transformed);
    expect(onComplete).toHaveBeenCalledWith({
      content: 'Hi there',
      usage: { inputTokens: 0, outputTokens: 2, totalTokens: 2 },
    });
  });
});
