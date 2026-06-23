import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { NConfigProvider } from 'naive-ui';
import Overview from './Overview.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mountOverview() {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: Overview },
      { path: '/upstream-keys', name: 'upstream-keys', component: { template: '<div>keys</div>' } },
      { path: '/public-models', name: 'public-models', component: { template: '<div>models</div>' } },
      { path: '/apps', name: 'apps', component: { template: '<div>apps</div>' } },
    ],
  });
  return {
    wrapper: mount(NConfigProvider, {
      global: { plugins: [router, i18n] },
      slots: { default: Overview },
    }),
    router,
  };
}

describe('Overview page', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('renders the active / frozen upstream key counts after data loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/apps')) return jsonResponse({ items: [] });
        if (url.endsWith('/model-groups')) return jsonResponse({ items: [] });
        if (url.endsWith('/public-models')) return jsonResponse({ items: [] });
        if (url.endsWith('/upstream-keys')) {
          return jsonResponse({
            items: [
              { id: 'uk_1', name: 'A', enabled: true, frozen: false },
              { id: 'uk_2', name: 'B', enabled: true, frozen: false },
              { id: 'uk_3', name: 'C', enabled: false, frozen: true },
              { id: 'uk_4', name: 'D', enabled: true, frozen: true },
            ],
          });
        }
        return jsonResponse({});
      }),
    );

    const { wrapper } = mountOverview();
    await flushPromises();
    expect(wrapper.text()).toMatch(/active\s*2/);
    expect(wrapper.text()).toMatch(/frozen\s*2/);
  });

  it('shows zeros on every stat card when the API returns empty lists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (
          url.endsWith('/apps') ||
          url.endsWith('/model-groups') ||
          url.endsWith('/public-models') ||
          url.endsWith('/upstream-keys') ||
          url.includes('/consumption/daily')
        ) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({});
      }),
    );

    const { wrapper } = mountOverview();
    await flushPromises();
    expect(wrapper.text()).toMatch(/active\s*0/);
    expect(wrapper.text()).toMatch(/frozen\s*0/);
  });

  it('renders the public-model and model-group tables with their rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/apps')) return jsonResponse({ items: [] });
        if (url.endsWith('/model-groups')) {
          return jsonResponse({
            items: [
              { id: 'mg_1', name: 'auto-coder', displayName: 'Auto Coder', memberCount: 4 },
              { id: 'mg_2', name: 'fast', displayName: 'Fast', memberCount: 2 },
            ],
          });
        }
        if (url.endsWith('/public-models')) {
          return jsonResponse({
            items: [
              { id: 'pm_1', name: 'gpt-4o', displayName: 'GPT-4o', candidateCount: 3 },
              { id: 'pm_2', name: 'claude-opus-4', displayName: 'Claude Opus 4', candidateCount: 2 },
            ],
          });
        }
        if (url.endsWith('/upstream-keys')) return jsonResponse({ items: [] });
        return jsonResponse({});
      }),
    );

    const { wrapper } = mountOverview();
    await flushPromises();
    expect(wrapper.text()).toContain('gpt-4o');
    expect(wrapper.text()).toContain('claude-opus-4');
    expect(wrapper.text()).toContain('auto-coder');
    expect(wrapper.text()).toContain('Fast');
  });

  it('navigates to /upstream-keys when the next-step button is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (
          url.endsWith('/apps') ||
          url.endsWith('/model-groups') ||
          url.endsWith('/public-models') ||
          url.endsWith('/upstream-keys') ||
          url.includes('/consumption/daily')
        ) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({});
      }),
    );

    const { wrapper, router } = mountOverview();
    await flushPromises();

    const button = wrapper.findAll('button').find((b) => /manage upstream keys/i.test(b.text()));
    expect(button).toBeTruthy();
    await button!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/upstream-keys');
  });
});