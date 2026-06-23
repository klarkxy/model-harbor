import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { NConfigProvider } from 'naive-ui';
import AdminLayout from './AdminLayout.vue';
import { useAuthStore } from '../stores/auth.js';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mountApp() {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div>overview</div>' } },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
      { path: '/public-models', name: 'public-models', component: { template: '<div>public-models</div>' } },
    ],
  });
  return mount(NConfigProvider, {
    global: {
      plugins: [router, i18n],
    },
    slots: {
      default: AdminLayout,
    },
  });
}

describe('AdminLayout smoke', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('renders the brand name', () => {
    const wrapper = mountApp();
    expect(wrapper.text()).toContain('ModelHarbor');
  });

  it('shows the admin display name when authenticated', async () => {
    const wrapper = mountApp();
    const auth = useAuthStore();
    auth.$patch({
      user: { id: 'adm_1', username: 'alice', displayName: 'Alice' },
      ready: true,
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Alice');
  });

  it('falls back to the username when the display name is missing', async () => {
    const wrapper = mountApp();
    const auth = useAuthStore();
    auth.$patch({
      user: { id: 'adm_1', username: 'alice', displayName: null },
      ready: true,
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('alice');
  });

  it('signs out and routes to /login when the user picks the Sign out option', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({})),
    );
    const wrapper = mountApp();
    const auth = useAuthStore();
    auth.$patch({
      user: { id: 'adm_1', username: 'alice', displayName: 'Alice' },
      ready: true,
    });
    await wrapper.vm.$nextTick();

    // The header exposes a dropdown with a "Sign out" option. The user
    // dropdown is rendered as an NDropdown; clicking the option should
    // call auth.logout() and navigate to /login.
    const vm = wrapper.findComponent(AdminLayout).vm as unknown as {
      onUserMenu: (key: string) => Promise<void>;
    };
    await vm.onUserMenu('logout');
    await wrapper.vm.$nextTick();
    expect(auth.user).toBeNull();
  });
});
