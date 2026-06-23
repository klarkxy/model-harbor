import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { NConfigProvider } from 'naive-ui';
import OAuthCallback from './OAuthCallback.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mountOAuthCallback(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/oauth/callback', component: OAuthCallback },
      { path: '/upstream-keys', name: 'upstream-keys', component: { template: '<div>keys</div>' } },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(NConfigProvider, {
    global: { plugins: [router, i18n] },
    slots: { default: OAuthCallback },
  });
  return { wrapper, router };
}

describe('OAuthCallback page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exchanges code and state, then redirects to upstream keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'uk_oauth',
        name: 'OAuth key',
        providerType: 'codex',
        enabled: true,
        frozen: false,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper, router } = await mountOAuthCallback('/oauth/callback?code=abc&state=xyz');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/upstream-keys/oauth-exchange',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ state: 'xyz', code: 'abc' }),
      }),
    );
    expect(wrapper.text()).toContain('Authorization complete');
    expect(router.currentRoute.value.path).toBe('/oauth/callback');

    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('upstream-keys');
  });

  it('shows provider errors without calling the exchange endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountOAuthCallback('/oauth/callback?error=access_denied');
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Authorization failed');
    expect(wrapper.text()).toContain('Provider returned an error: access_denied');
  });

  it('shows a missing params error before exchanging', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountOAuthCallback('/oauth/callback?code=abc');
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Missing authorization code or state');
  });
});
