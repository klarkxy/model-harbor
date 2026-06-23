import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { NConfigProvider, NMessageProvider } from 'naive-ui';
import ModelGroups from './ModelGroups.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function modelGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grp_1',
    name: 'coding',
    displayName: 'Coding',
    description: null,
    enabled: true,
    routingPolicy: 'priority',
    mode: 'manual',
    autoPreset: null,
    autoReferenceRegion: null,
    autoWeights: null,
    autoTopN: null,
    autoLastRefreshedAt: null,
    memberCount: 1,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

function mountModelGroups() {
  return mount(NConfigProvider, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
        NDataTable: {
          props: ['data'],
          template:
            '<div data-testid="table"><div v-for="row in data" :key="row.id ?? row.publicModelName">{{ row.name ?? row.publicModelName }} {{ row.mode ?? "" }} {{ row.score ?? "" }}</div></div>',
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
            '<select :value="value" @change="$emit(\'update:value\', $event.target.value)"><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
        },
        Select: {
          props: ['value', 'options'],
          emits: ['update:value'],
          template:
            '<select :value="value" @change="$emit(\'update:value\', $event.target.value)"><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
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
      },
    },
    slots: {
      default: () => h(NMessageProvider, null, { default: () => h(ModelGroups) }),
    },
  });
}

function installFetchMock() {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/admin/model-groups') && (!init || init.method === 'GET')) {
      return jsonResponse({ items: [modelGroup()] });
    }
    if (url.endsWith('/api/admin/public-models')) {
      return jsonResponse({
        items: [
          {
            id: 'pm_1',
            name: 'claude-public',
            displayName: 'Claude Public',
            description: null,
            enabled: true,
            candidateOrderCustomized: false,
            candidateCount: 1,
            createdAt: '2026-06-22T00:00:00.000Z',
            updatedAt: '2026-06-22T00:00:00.000Z',
          },
        ],
      });
    }
    if (url.endsWith('/api/admin/settings')) {
      return jsonResponse({
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          baseCooldownMs: 1000,
          maxCooldownMs: 60000,
          halfOpenSuccessCount: 2,
        },
        endpointHealth: {
          probeEnabled: true,
          probeIntervalMs: 60000,
          probeTimeoutMs: 2000,
          degradedLatencyMs: 3000,
        },
        streaming: { firstTokenTimeoutMs: 10000 },
        contentLogging: { enabled: false, retentionDays: 7, maxPayloadBytes: 8192 },
        modelReference: {
          autoPreset: 'code',
          autoWeights: { coding: 2 },
          autoTopN: 3,
        },
      });
    }
    if (url.endsWith('/api/admin/model-groups/auto-preview') && init?.method === 'POST') {
      return jsonResponse({
        items: [
          {
            publicModelId: 'pm_1',
            publicModelName: 'claude-public',
            displayName: 'Claude Public',
            score: 91.4,
            reference: {
              source: 'datalearner',
              displayName: 'Claude 3.5 Sonnet',
              provider: 'Anthropic',
              scores: { coding: 91.4 },
              price: {},
              contextWindow: 200000,
              outputSpeed: 70,
              latencyMs: 420,
              sourceUrl: 'https://example.test/leaderboard',
              fetchedAt: '2026-06-22T00:00:00.000Z',
            },
          },
        ],
        publicModels: [],
      });
    }
    if (url.endsWith('/api/admin/model-groups') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; mode?: string };
      return jsonResponse(
        modelGroup({
          id: `grp_${body.name}`,
          name: body.name,
          mode: body.mode ?? 'manual',
          displayName: body.name,
          memberCount: body.mode === 'auto_snapshot' ? 3 : 1,
        }),
      );
    }
    return jsonResponse({});
  });
}

describe('ModelGroups page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('creates a manual group with normalized member priorities', async () => {
    const fetchMock = installFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountModelGroups();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'New model group')!.trigger('click');
    await flushPromises();

    const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    ));
    inputs[0]!.value = '  local-coding  ';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1]!.value = 'Local Coding';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[2]!.value = 'Manual route';
    inputs[2]!.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === '+ Add member')!
      .click();
    Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create')!
      .click();
    await flushPromises();

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/model-groups') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
      name: 'local-coding',
      displayName: 'Local Coding',
      description: 'Manual route',
      routingPolicy: 'priority',
      mode: 'manual',
      members: [{ publicModelId: 'pm_1', priority: 10, weight: 1 }],
    });
  });

  it('previews and creates an auto snapshot group from default settings', async () => {
    const fetchMock = installFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountModelGroups();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'New model group')!.trigger('click');
    await flushPromises();

    const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    ));
    inputs[0]!.value = 'auto-code';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    const select = document.body.querySelector<HTMLSelectElement>('select')!;
    select.value = 'auto_snapshot';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Preview')!
      .click();
    await flushPromises();

    expect(document.body.textContent).toContain('claude-public');
    const previewCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/admin/model-groups/auto-preview') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(previewCall).toBeTruthy();
    expect(JSON.parse(String((previewCall![1] as RequestInit).body))).toEqual({
      preset: 'code',
      weights: { coding: 2 },
      topN: 3,
    });

    Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create')!
      .click();
    await flushPromises();

    const createCall = fetchMock.mock.calls.findLast(
      ([url, init]) =>
        String(url).endsWith('/api/admin/model-groups') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String((createCall![1] as RequestInit).body))).toEqual({
      name: 'auto-code',
      routingPolicy: 'priority',
      mode: 'auto_snapshot',
      autoPreset: 'code',
      autoTopN: 3,
      autoWeights: { coding: 2 },
    });
  });
});
