import { describe, it, expect } from 'vitest';
import { UpstreamSender } from '../../src/gateway/upstream-sender.js';
import { ProviderTimeoutError } from '@manageyourllm/shared';
import type { ProviderHttpRequest } from '../../src/gateway/providers/adapter.js';

function makeRequest(): ProviderHttpRequest & { timeoutMs: number; firstTokenTimeoutMs?: number } {
  return {
    url: 'https://api.example.com/v1/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { model: 'gpt-4o' },
    timeoutMs: 1000,
  };
}

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index++;
    },
  });
  return {
    status: 200,
    ok: true,
    headers: new Headers({ 'x-request-id': 'req-stream-1' }),
    body: stream as unknown as ReadableStream<Uint8Array>,
  } as Response;
}

function mockStreamFetch(response: Response | { status: number; body: unknown }): typeof fetch {
  return (async () => {
    if ('body' in response && response.body instanceof ReadableStream) {
      return response as Response;
    }
    const { status, body } = response as { status: number; body: unknown };
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(),
      text: async () => JSON.stringify(body),
      body: null,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('UpstreamSender.sendStream', () => {
  it('returns ok:true with status, headers and body for 2xx stream', async () => {
    const sender = new UpstreamSender({
      fetch: mockStreamFetch(makeStreamResponse(['data: [DONE]\n\n'])),
    });

    const res = await sender.sendStream({ ...makeRequest(), firstTokenTimeoutMs: 500 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-stream-1');
    expect(res.body).toBeInstanceOf(ReadableStream);
  });

  it('returns ok:false with error body for non-2xx', async () => {
    const sender = new UpstreamSender({
      fetch: mockStreamFetch({ status: 429, body: { error: 'rate limit' } }),
    });

    const res = await sender.sendStream(makeRequest());
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected not ok');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate limit' });
  });

  it('throws ProviderTimeoutError when first byte arrives too late', async () => {
    const slowStream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => {}); // stall forever
      },
    });
    const sender = new UpstreamSender({
      fetch: mockStreamFetch({
        status: 200,
        body: slowStream,
      } as unknown as Response),
    });

    await expect(
      sender.sendStream({ ...makeRequest(), firstTokenTimeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('passes request to fetch and adds abort signal', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const sender = new UpstreamSender({
      fetch: (async (url, init) => {
        captured = { url: url as string, init: init as RequestInit };
        return makeStreamResponse([]);
      }) as unknown as typeof fetch,
    });

    await sender.sendStream(makeRequest());
    expect(captured?.url).toBe('https://api.example.com/v1/chat/completions');
    expect(captured?.init.method).toBe('POST');
    expect(captured?.init.signal).toBeInstanceOf(AbortSignal);
  });
});
