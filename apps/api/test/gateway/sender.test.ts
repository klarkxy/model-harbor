import { describe, it, expect } from 'vitest';
import { UpstreamSender } from '../../src/gateway/upstream-sender.js';
import { ProviderTimeoutError } from '@manageyourllm/shared';
import type { ProviderHttpRequest } from '../../src/gateway/providers/adapter.js';

function makeRequest(): ProviderHttpRequest & { timeoutMs: number } {
  return {
    url: 'https://api.example.com/v1/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { model: 'gpt-4o' },
    timeoutMs: 1000,
  };
}

function mockFetch(response: {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}): typeof fetch {
  return (async () => {
    const headers = new Headers(response.headers ?? {});
    return {
      status: response.status,
      headers,
      text: async () => JSON.stringify(response.body),
      ok: response.status >= 200 && response.status < 300,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('UpstreamSender', () => {
  it('returns parsed response on success', async () => {
    const sender = new UpstreamSender({
      fetch: mockFetch({
        status: 200,
        headers: { 'x-request-id': 'req-1' },
        body: { id: 'resp-1', choices: [] },
      }),
    });

    const res = await sender.send(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-1');
    expect((res.body as Record<string, unknown>).id).toBe('resp-1');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns text body when JSON parsing fails', async () => {
    const sender = new UpstreamSender({
      fetch: (async () => ({
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
        ok: false,
      })) as unknown as typeof fetch,
    });

    const res = await sender.send(makeRequest());
    expect(res.status).toBe(500);
    expect(res.body).toBe('Internal Server Error');
  });

  it('throws ProviderTimeoutError on timeout', async () => {
    const sender = new UpstreamSender({
      fetch: async () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('abort')), 500);
        }) as never,
    });

    await expect(sender.send({ ...makeRequest(), timeoutMs: 1 })).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it('passes correct fetch arguments', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const sender = new UpstreamSender({
      fetch: (async (url, init) => {
        captured = { url: url as string, init: init as RequestInit };
        return {
          status: 200,
          headers: new Headers(),
          text: async () => '{}',
          ok: true,
        } as Response;
      }) as unknown as typeof fetch,
    });

    await sender.send(makeRequest());
    expect(captured?.url).toBe('https://api.example.com/v1/chat/completions');
    expect(captured?.init.method).toBe('POST');
    expect(captured?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(captured?.init.body).toBe(JSON.stringify({ model: 'gpt-4o' }));
  });
});
