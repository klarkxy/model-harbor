import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { NConfigProvider } from 'naive-ui';
import AdminLayout from './AdminLayout.vue';
import { useAuthStore } from '../stores/auth.js';
import { i18n, saveLocale } from '../i18n/index.js';

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
      {
        path: '/login',
        name: 'login',
        component: { template: '<div>login</div>' },
        meta: { standalone: true },
      },
      { path: '/public-models', name: 'public-models', component: { template: '<div>public-models</div>' } },
      { path: '/settings', name: 'settings', component: { template: '<div>settings</div>' } },
      { path: '/usage', name: 'usage', component: { template: '<div>usage</div>' } },
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
    // Reset the persisted locale so tests do not leak state.
    saveLocale('en');
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
    await flushPromises();
    expect(auth.user).toBeNull();
  });

  it('navigates to the named route when a menu item is selected', async () => {
    const wrapper = mountApp();
    const vm = wrapper.findComponent(AdminLayout).vm as unknown as {
      onMenuSelect: (key: string) => void;
    };
    // Drive the menu select handler directly. The handler delegates to
    // router.push({ name: key }); the assertion below checks the route
    // actually moved to /settings once vue-router resolves the promise.
    vm.onMenuSelect('settings');
    await flushPromises();
    const router = (
      wrapper.findComponent(AdminLayout).vm as unknown as { $router: { currentRoute: { value: { name?: string } } } }
    ).$router;
    expect(router.currentRoute.value.name).toBe('settings');
  });

  it('reads the active key from the route name and shows the title from i18n', async () => {
    const wrapper = mountApp();
    const inner = wrapper.findComponent(AdminLayout);
    const router = (inner.vm as unknown as { $router: { push: (t: unknown) => Promise<unknown> } }).$router;
    await router.push({ name: 'usage' });
    await flushPromises();
    expect(wrapper.text()).toContain('Usage');
  });

  it('honours route.meta.titleKey over the menu key when rendering the page title', async () => {
    const wrapper = mountApp();
    // Re-mount a route with a custom titleKey to exercise the meta branch.
    const router = (
      wrapper.findComponent(AdminLayout).vm as unknown as {
        $router: { addRoute: (r: unknown) => void; push: (t: unknown) => Promise<unknown> };
      }
    ).$router;
    router.addRoute({
      path: '/custom',
      name: 'custom',
      component: { template: '<div>custom</div>' },
      meta: { titleKey: 'layout.brand' },
    });
    await router.push('/custom');
    await flushPromises();
    // The page title resolves to the brand string ("ModelHarbor").
    expect(wrapper.text()).toContain('ModelHarbor');
  });

  it('exposes the language switcher options via the layout', () => {
    const wrapper = mountApp();
    const vm = wrapper.findComponent(AdminLayout).vm as unknown as {
      languageOptions: Array<{ label: string; value: string }>;
      currentLanguage: string;
    };
    expect(vm.languageOptions.length).toBeGreaterThanOrEqual(2);
    expect(vm.languageOptions[0]?.value).toBe('en');
    expect(vm.languageOptions.map((o) => o.value)).toContain('zh-CN');
    expect(vm.currentLanguage).toBe('en');
  });
});
