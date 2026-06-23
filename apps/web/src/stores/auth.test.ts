import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ApiClientError } from '../api/client.js';
import { useAuthStore } from './auth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const adminPayload = {
  id: 'admin_1',
  username: 'admin',
  displayName: 'Admin',
};

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('starts with no user and isAuthenticated=false', () => {
    const store = useAuthStore();
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.ready).toBe(false);
  });

  it('fetchMe() populates the user on a 200 response and flips ready=true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ admin: adminPayload }));
    vi.stubGlobal('fetch', fetchMock);

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.user).toEqual(adminPayload);
    expect(store.isAuthenticated).toBe(true);
    expect(store.ready).toBe(true);
  });

  it('fetchMe() swallows 401 (clears the user) but still flips ready=true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: 'unauthenticated', code: 'unauthenticated', type: 'auth_error' } },
        401,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.ready).toBe(true);
  });

  it('fetchMe() rethrows non-401 errors so callers can react to outages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: 'boom', code: 'server_error', type: 'server_error' } },
        500,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = useAuthStore();
    await expect(store.fetchMe()).rejects.toBeInstanceOf(ApiClientError);
    expect(store.ready).toBe(true);
    expect(store.user).toBeNull();
  });

  it('login() sets the user and flips ready=true in one step', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ admin: adminPayload }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const store = useAuthStore();
    await store.login('admin', 'secret');

    expect(store.user).toEqual(adminPayload);
    expect(store.isAuthenticated).toBe(true);
    expect(store.ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'admin', password: 'secret' }),
      }),
    );
  });

  it('logout() clears the user even when the server returns an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: 'server down', code: 'server_error', type: 'server_error' } },
        500,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = useAuthStore();
    store.user = adminPayload;

    // The store wraps `authApi.logout()` in try/finally so the user is
    // cleared locally even if the server fails; the original error still
    // surfaces so callers can decide whether to ignore it.
    await expect(store.logout()).rejects.toBeInstanceOf(ApiClientError);

    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });
});