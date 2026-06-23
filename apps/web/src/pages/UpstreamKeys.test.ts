import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { NConfigProvider, NMessageProvider } from 'naive-ui';
import UpstreamKeys from './UpstreamKeys.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function upstreamKey(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uk_1',
    name: 'Primary',
    providerType: 'anthropic_compatible',
    baseUrl: 'https://api.anthropic.test',
    authType: 'pat',
    apiKeyPrefix: 'sk-ant',
    defaultHeaders: {},
    extraHeaders: {},
    extraParams: {},
    supportedModels: ['claude-real'],
    candidateCount: 1,
    endpoints: [{ protocol: 'anthropic', providerType: 'anthropic_compatible', baseUrl: 'https://api.anthropic.test' }],
    providerPresetId: null,
    displayOrder: 10,
    enabled: true,
    frozen: false,
    frozenReason: null,
    cooldownUntil: null,
    lastHealthStatus: 'healthy',
    lastErrorCode: null,
    lastErrorMessage: null,
    lastUsedAt: null,
    stickySessionTtlMs: 300000,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    quota: null,
    ...overrides,
  };
}

function providerPreset() {
  return {
    id: 'openai',
    icon: '◎',
    name: 'OpenAI',
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.openai.test',
        providerType: 'openai_compatible',
      },
    ],
    modelMappings: [],
    authStrategies: { default: 'pat', available: ['pat'] },
    branding: { color: '#111111' },
    defaultExtraHeaders: { 'x-provider': 'openai' },
    defaultExtraParams: { temperature: 0.2 },
  };
}

function installFetchMock() {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/admin/upstream-keys') && (!init || init.method === 'GET')) {
      return jsonResponse({
        items: [
          upstreamKey(),
          upstreamKey({
            id: 'uk_2',
            name: 'Backup',
            enabled: false,
            frozen: true,
            providerType: 'openai_compatible',
            baseUrl: 'https://api.openai.test',
            apiKeyPrefix: 'sk-openai',
            candidateCount: 0,
          }),
        ],
      });
    }
    if (url.endsWith('/api/admin/provider-presets')) {
      return jsonResponse({ items: [providerPreset()] });
    }
    if (url.endsWith('/api/admin/upstream-endpoint-health')) {
      return jsonResponse({
        items: [
          {
            id: 'health_1',
            upstreamKeyId: 'uk_1',
            endpointBaseUrl: 'https://api.anthropic.test',
            delayMs: 180,
            lastCheckedAt: Date.parse('2026-06-22T00:00:00.000Z'),
            degraded: false,
            errorCode: null,
            errorMessage: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      });
    }
    if (url.endsWith('/api/admin/upstream-keys/discover-models') && init?.method === 'POST') {
      return jsonResponse({
        items: [
          { realName: 'Claude-Real', publicName: 'claude-real' },
          { realName: 'unused-free', publicName: 'unused-free' },
        ],
      });
    }
    if (url.endsWith('/api/admin/upstream-keys') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string };
      return jsonResponse(upstreamKey({ id: 'uk_new', name: body.name }));
    }
    return jsonResponse({});
  });
}

async function mountUpstreamKeys() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'upstream-keys', component: UpstreamKeys }],
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(NConfigProvider, {
    attachTo: document.body,
    global: {
      plugins: [router, i18n],
      stubs: {
        NDataTable: {
          props: ['data', 'columns'],
          template:
            '<div data-testid="table"><div v-for="row in data" :key="row.id">{{ row.name }} {{ row.providerType }} {{ row.enabled ? "Enabled" : "Disabled" }} {{ row.frozen ? "Frozen" : "Active" }}</div></div>',
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
        NSelect: {
          props: ['value', 'options'],
          emits: ['update:value'],
          template:
            '<select :value="value ?? \'\'" @change="$emit(\'update:value\', $event.target.value || null)"><option v-for="opt in options" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option></select>',
        },
        Select: {
          props: ['value', 'options'],
          emits: ['update:value'],
          template:
            '<select :value="value ?? \'\'" @change="$emit(\'update:value\', $event.target.value || null)"><option v-for="opt in options" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option></select>',
        },
        NInputNumber: {
          props: ['value'],
          emits: ['update:value'],
          template:
            '<input type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />',
        },
        InputNumber: {
          props: ['value'],
          emits: ['update:value'],
          template:
            '<input type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />',
        },
        KeyValueEditor: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<div data-testid="key-value-editor"><button type="button" data-testid="set-extra" @click="$emit(\'update:modelValue\', [{ key: \'x-extra\', value: \'{&quot;nested&quot;:true}\', enabled: true }, { key: \'x-disabled\', value: \'skip\', enabled: false }])">set extra</button></div>',
        },
        ModelMappingEditor: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<div data-testid="mapping-editor"><button type="button" data-testid="set-mappings" @click="$emit(\'update:modelValue\', [{ realName: \'claude-real\', publicName: \'\', enabled: true }, { realName: \'disabled-real\', publicName: \'disabled\', enabled: false }])">set mappings</button><div v-for="m in modelValue" :key="m.realName">{{ m.realName }} {{ m.publicName }}</div></div>',
        },
      },
    },
    slots: {
      default: () => h(NMessageProvider, null, { default: () => h(UpstreamKeys) }),
    },
  });
  return { wrapper, router };
}

describe('UpstreamKeys page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://127.0.0.1:5421' },
      configurable: true,
    });
  });

  it('loads upstream keys, provider presets, and endpoint health on mount', async () => {
    const fetchMock = installFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountUpstreamKeys();
    await flushPromises();

    expect(wrapper.text()).toContain('Primary');
    expect(wrapper.text()).toContain('Backup');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/upstream-keys',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/provider-presets',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/upstream-endpoint-health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('creates a PAT upstream key with normalized mappings, headers, params, and TTL', async () => {
    const fetchMock = installFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { wrapper } = await mountUpstreamKeys();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'New upstream key')!.trigger('click');
    await flushPromises();

    const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement>('input'));
    inputs[0]!.value = '  Local Anthropic  ';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1]!.value = 'https://api.local.test';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[2]!.value = 'sk-local';
    inputs[2]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[3]!.value = '120000';
    inputs[3]!.dispatchEvent(new Event('input', { bubbles: true }));
    const extraButtons = document.body.querySelectorAll<HTMLButtonElement>('[data-testid="set-extra"]');
    extraButtons[0]!.click();
    extraButtons[1]!.click();
    document.body.querySelector<HTMLButtonElement>('[data-testid="set-mappings"]')!.click();
    await flushPromises();

    Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create')!
      .click();
    await flushPromises();

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/upstream-keys') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String((createCall![1] as RequestInit).body))).toEqual({
      name: '  Local Anthropic  ',
      modelMappings: [{ realName: 'claude-real', publicName: 'claude-real', enabled: true }],
      extraHeaders: { 'x-extra': '{"nested":true}' },
      extraParams: { 'x-extra': { nested: true } },
      stickySessionTtlMs: 120000,
      providerType: 'anthropic_compatible',
      baseUrl: 'https://api.local.test',
      authType: 'pat',
      apiKey: 'sk-local',
    });
  });
});
