import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiClientError } from './client.js';

describe('api client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: Partial<Response> & { text?: () => Promise<string> }) {
    const res = {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: response.headers ?? new Headers(),
      text: response.text ?? (async () => ''),
      ...response,
    } as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(res);
    return res;
  }

  it('returns parsed JSON on success', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: 'mdl_xxx', name: 'gpt-5' }),
    });

    const data = await api.get<{ id: string; name: string }>('/api/admin/models');
    expect(data).toEqual({ id: 'mdl_xxx', name: 'gpt-5' });
  });

  it('returns undefined on 204', async () => {
    mockFetch({ ok: true, status: 204 });
    const data = await api.post('/api/auth/logout');
    expect(data).toBeUndefined();
  });

  it('throws ApiClientError with server error shape', async () => {
    mockFetch({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          error: { message: '登录失败', type: 'AuthenticationError', code: 'authentication_error' },
        }),
    });

    await expect(api.get('/api/me')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiClientError);
      const e = err as ApiClientError;
      expect(e.status).toBe(401);
      expect(e.code).toBe('authentication_error');
      expect(e.message).toBe('登录失败');
      return true;
    });
  });

  it('throws fallback ApiClientError for non-JSON error', async () => {
    mockFetch({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html>bad gateway</html>',
    });

    await expect(api.get('/api/x')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiClientError);
      const e = err as ApiClientError;
      expect(e.status).toBe(502);
      expect(e.code).toBe('http_error');
      return true;
    });
  });

  it('truncates long non-JSON error text', async () => {
    const long = 'x'.repeat(1000);
    mockFetch({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => long,
    });

    await expect(api.get('/api/x')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiClientError);
      const e = err as ApiClientError;
      expect(e.message.length).toBeLessThan(long.length);
      return true;
    });
  });
});
