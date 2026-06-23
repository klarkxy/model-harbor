import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { NConfigProvider, NMessageProvider } from 'naive-ui';
import Apps from './Apps.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mountApps() {
  return mount(NConfigProvider, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
        AppConsumerKeys: {
          props: ['app'],
          template: '<div data-testid="consumer-keys">keys for {{ app.name }}</div>',
        },
        NDrawer: {
          props: ['show'],
          template: '<div v-if="show" class="drawer"><slot /></div>',
        },
        NDrawerContent: {
          props: ['title'],
          template:
            '<section><h2>{{ title }}</h2><slot /><footer><slot name="footer" /></footer></section>',
        },
      },
    },
    slots: {
      default: () => h(NMessageProvider, null, { default: () => h(Apps) }),
    },
  });
}

describe('Apps page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('restores the last selected app and shows its consumer keys panel', async () => {
    localStorage.setItem('modelharbor:lastSelectedAppId', 'app_2');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: 'app_1',
              name: 'CLI',
              description: 'Local CLI',
              enabled: true,
              createdAt: '2026-06-22T00:00:00.000Z',
              updatedAt: '2026-06-22T00:00:00.000Z',
            },
            {
              id: 'app_2',
              name: 'IDE',
              description: 'Editor',
              enabled: false,
              createdAt: '2026-06-22T00:00:00.000Z',
              updatedAt: '2026-06-22T00:00:00.000Z',
            },
          ],
        }),
      ),
    );

    const wrapper = mountApps();
    await flushPromises();

    expect(wrapper.text()).toContain('CLI');
    expect(wrapper.text()).toContain('IDE');
    expect(wrapper.find('[data-testid="consumer-keys"]').text()).toContain('keys for IDE');
  });

  it('creates an app with a trimmed optional description', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/admin/apps') && (!init || init.method === 'GET')) {
        return jsonResponse({ items: [] });
      }
      if (url.endsWith('/api/admin/apps') && init?.method === 'POST') {
        return jsonResponse({
          id: 'app_new',
          name: 'Local IDE',
          description: 'dev client',
          enabled: true,
          createdAt: '2026-06-22T00:00:00.000Z',
          updatedAt: '2026-06-22T00:00:00.000Z',
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountApps();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'New app')!.trigger('click');
    await flushPromises();

    const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    ));
    inputs[0]!.value = '  Local IDE  ';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1]!.value = '  dev client  ';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    const createButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Create',
    );
    expect(createButton).toBeTruthy();
    createButton!.click();
    await flushPromises();

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/apps') && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
      name: 'Local IDE',
      description: 'dev client',
    });
    expect(wrapper.text()).toContain('Local IDE');
  });
});
