import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { NConfigProvider } from 'naive-ui';
import AdminLayout from './AdminLayout.vue';
import { useAuthStore } from '../stores/auth.js';
import { i18n } from '../i18n/index.js';

function mountApp() {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div>overview</div>' } },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
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
});
