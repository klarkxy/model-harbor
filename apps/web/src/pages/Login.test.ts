import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { NConfigProvider } from 'naive-ui';
import Login from './Login.vue';
import Overview from './Overview.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mountLogin(initialPath = '/login') {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Overview },
      { path: '/login', component: Login },
      { path: '/apps', component: { template: '<div>apps route</div>' } },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(NConfigProvider, {
    global: { plugins: [router, i18n] },
    slots: { default: Login },
  });
  return { wrapper, router };
}

describe('Login page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits trimmed credentials and follows a safe redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ admin: { id: 'adm_1', username: 'admin', displayName: 'Admin' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper, router } = await mountLogin('/login?redirect=/apps');
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue(' admin ');
    await inputs[1]!.setValue('secret123');
    await wrapper.find('button[type="submit"]').trigger('click');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'admin', password: 'secret123' }),
      }),
    );
    expect(router.currentRoute.value.fullPath).toBe('/apps');
  });

  it('renders the localized 401 error without navigating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { message: 'bad login', type: 'authentication_error', code: 'invalid_login' } },
          401,
        ),
      ),
    );

    const { wrapper, router } = await mountLogin('/login?redirect=https://evil.example');
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('admin');
    await inputs[1]!.setValue('wrong');
    await wrapper.find('button[type="submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Invalid username or password');
    expect(router.currentRoute.value.path).toBe('/login');
  });
});
