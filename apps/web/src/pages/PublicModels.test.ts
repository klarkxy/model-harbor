import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { NConfigProvider, NMessageProvider } from 'naive-ui';
import PublicModels from './PublicModels.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mountPublicModels() {
  return mount(NConfigProvider, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
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
      default: () => h(NMessageProvider, null, { default: () => h(PublicModels) }),
    },
  });
}

function dragEvent(type: string, init: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: 'move',
      setData: vi.fn(),
    },
  });
  return event;
}

describe('PublicModels page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens candidate arrangement, drags a candidate row, and saves normalized priorities', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/admin/public-models') && (!init || init.method === 'GET')) {
        return jsonResponse({
          items: [
            {
              id: 'pm_1',
              name: 'ds-chat',
              displayName: 'DS Chat',
              description: null,
              enabled: true,
              candidateCount: 2,
              createdAt: '2026-06-21T00:00:00.000Z',
              updatedAt: '2026-06-21T00:00:00.000Z',
            },
          ],
        });
      }
      if (url.endsWith('/api/admin/upstream-keys')) {
        return jsonResponse({
          items: [
            {
              id: 'uk_1',
              name: 'Primary',
              providerType: 'anthropic_compatible',
              apiKeyPrefix: 'skp',
              enabled: true,
              frozen: false,
              lastHealthStatus: 'healthy',
              endpoints: [{ protocol: 'anthropic', providerType: 'anthropic_compatible' }],
            },
            {
              id: 'uk_2',
              name: 'Backup',
              providerType: 'openai_compatible',
              apiKeyPrefix: 'skb',
              enabled: true,
              frozen: false,
              lastHealthStatus: 'healthy',
              endpoints: [{ protocol: 'openai', providerType: 'openai_compatible' }],
            },
          ],
        });
      }
      if (url.endsWith('/api/admin/public-models/pm_1') && (!init || init.method === 'GET')) {
        return jsonResponse({
          id: 'pm_1',
          name: 'ds-chat',
          displayName: 'DS Chat',
          description: null,
          enabled: true,
          candidateCount: 2,
          createdAt: '2026-06-21T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
          candidates: [
            {
              id: 'c_1',
              upstreamKeyId: 'uk_1',
              realModelName: 'real-primary',
              priority: 10,
              weight: 1,
              enabled: true,
              endpointProtocol: null,
              endpointProviderType: null,
              endpointBaseUrl: null,
              endpointApiPath: null,
              upstreamKey: {
                id: 'uk_1',
                name: 'Primary',
                providerType: 'anthropic_compatible',
                enabled: true,
                frozen: false,
              },
            },
            {
              id: 'c_2',
              upstreamKeyId: 'uk_2',
              realModelName: 'real-backup',
              priority: 20,
              weight: 7,
              enabled: true,
              endpointProtocol: null,
              endpointProviderType: null,
              endpointBaseUrl: null,
              endpointApiPath: null,
              upstreamKey: {
                id: 'uk_2',
                name: 'Backup',
                providerType: 'openai_compatible',
                enabled: true,
                frozen: false,
              },
            },
          ],
        });
      }
      if (url.endsWith('/api/admin/public-models/pm_1/candidates') && init?.method === 'PUT') {
        return jsonResponse({
          candidates: [
            {
              id: 'c_2_new',
              upstreamKeyId: 'uk_2',
              realModelName: 'real-backup',
              priority: 10,
              weight: 7,
              enabled: true,
              endpointProtocol: null,
              endpointProviderType: null,
              endpointBaseUrl: null,
              endpointApiPath: null,
              upstreamKey: null,
            },
            {
              id: 'c_1_new',
              upstreamKeyId: 'uk_1',
              realModelName: 'real-primary',
              priority: 20,
              weight: 1,
              enabled: true,
              endpointProtocol: null,
              endpointProviderType: null,
              endpointBaseUrl: null,
              endpointApiPath: null,
              upstreamKey: null,
            },
          ],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountPublicModels();
    await flushPromises();

    const arrangeButton = wrapper.findAll('button').find((button) => button.text() === 'Arrange');
    expect(arrangeButton).toBeTruthy();
    await arrangeButton!.trigger('click');
    await flushPromises();

    const handles = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-testid="candidate-order-handle"]'),
    );
    expect(handles).toHaveLength(2);
    const targetRow = handles[1]!.closest('tr') as HTMLTableRowElement;
    Object.defineProperty(targetRow, 'getBoundingClientRect', {
      value: () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100 }),
    });
    handles[0]!.dispatchEvent(dragEvent('dragstart'));
    targetRow.dispatchEvent(dragEvent('dragover', { clientY: 19 }));
    targetRow.dispatchEvent(dragEvent('drop', { clientY: 19 }));
    await flushPromises();

    const saveButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save',
    );
    expect(saveButton).toBeTruthy();
    saveButton!.click();
    await flushPromises();

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/public-models/pm_1/candidates') &&
        (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall![1] as RequestInit).body)) as {
      candidates: Array<{ upstreamKeyId: string; realModelName: string; priority: number; weight: number }>;
    };
    expect(body.candidates).toEqual([
      { upstreamKeyId: 'uk_2', realModelName: 'real-backup', priority: 10, weight: 7, enabled: true },
      { upstreamKeyId: 'uk_1', realModelName: 'real-primary', priority: 20, weight: 1, enabled: true },
    ]);
  });
});
