import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { NConfigProvider } from 'naive-ui';
import Settings from './Settings.vue';
import { i18n } from '../i18n/index.js';

function mountSettings() {
  setActivePinia(createPinia());
  return mount(NConfigProvider, {
    global: { plugins: [i18n] },
    slots: { default: Settings },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const baseSettings = {
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    baseCooldownMs: 30000,
    maxCooldownMs: 300000,
    halfOpenSuccessCount: 1,
  },
  endpointHealth: {
    probeEnabled: true,
    probeIntervalMs: 60000,
    probeTimeoutMs: 5000,
    degradedLatencyMs: 3000,
  },
  streaming: { firstTokenTimeoutMs: 8000 },
  contentLogging: { enabled: false, retentionDays: 7, maxPayloadBytes: 16384 },
  modelReference: {
    autoPreset: 'balanced',
    autoWeights: {
      intelligence: 0.2,
      chat: 0.14,
      knowledge: 0.14,
      math: 0.12,
      chinese: 0.08,
      reasoning: 0.12,
      coding: 0.12,
      agentic: 0.08,
      costEfficiency: 0,
      price: 0,
      context: 0,
    },
    autoTopN: 5,
  },
};

function stubSettingsAndAudit(overrides: Partial<typeof baseSettings> = {}) {
  vi.mocked(globalThis.fetch).mockImplementation((async (
    url: string,
    init?: RequestInit,
  ) => {
    if (url.endsWith('/api/admin/auth/me') && (!init || init.method === 'GET')) {
      return jsonResponse({ admin: { id: 'adm_1', username: 'admin', displayName: 'Admin' } });
    }
    if (url.endsWith('/api/admin/audit')) {
      return jsonResponse({ items: [] });
    }
    if (url.endsWith('/api/admin/settings') && (!init || init.method === 'GET')) {
      return jsonResponse({ ...baseSettings, ...overrides });
    }
    if (url.endsWith('/api/admin/settings') && init?.method === 'PUT') {
      return jsonResponse({ ...baseSettings, ...overrides });
    }
    if (url.includes('/api/admin/circuit-breakers') && url.endsWith('/reset')) {
      return jsonResponse({ ok: true });
    }
    if (url.includes('/api/admin/circuit-breakers')) {
      return jsonResponse({ items: [] });
    }
    return jsonResponse({});
  }) as unknown as typeof fetch);
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('blocks password change when the new password is too short', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('oldsecret');
    await inputs[1]!.setValue('short');
    await inputs[2]!.setValue('short');
    const buttons = wrapper.findAll('button');
    const changeBtn = buttons.find((b) => b.text().includes('Change password'));
    expect(changeBtn).toBeTruthy();
    await changeBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toMatch(/at least 8/);
  });

  it('blocks password change when the confirmation does not match', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('oldsecret');
    await inputs[1]!.setValue('newsecret123');
    await inputs[2]!.setValue('different');
    const buttons = wrapper.findAll('button');
    const changeBtn = buttons.find((b) => b.text().includes('Change password'));
    expect(changeBtn).toBeTruthy();
    await changeBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toMatch(/at least 8|confirmation/i);
  });

  it('saves the profile display name through PATCH /api/admin/auth/profile', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();

    // The displayName is the second NInput in the account card.
    const inputs = wrapper.findAll('input');
    await inputs[1]!.setValue('  Admin Display  ');
    const buttons = wrapper.findAll('button');
    const saveProfileBtn = buttons.find((b) => b.text().includes('Save profile'));
    expect(saveProfileBtn).toBeTruthy();
    await saveProfileBtn!.trigger('click');
    await flushPromises();

    const patchCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/auth/profile') && (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String((patchCall![1] as RequestInit).body))).toEqual({
      displayName: 'Admin Display',
    });
  });

  it('saves circuit breaker settings via PUT /api/admin/settings', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();

    // All five settings cards (CB / endpoint-health / streaming / content
    // logging / model-reference) render a button labelled "Save" once the
    // settings object is loaded. Index 0 here is the circuit-breaker save.
    const saveButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'Save');
    expect(saveButtons.length).toBe(5);
    await saveButtons[0]!.trigger('click');
    await flushPromises();

    const putCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/settings') && (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall![1] as RequestInit).body)) as {
      circuitBreaker?: unknown;
    };
    expect(body.circuitBreaker).toEqual(baseSettings.circuitBreaker);
  });

  it('saves endpoint health settings via PUT /api/admin/settings', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();

    const saveButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'Save');
    await saveButtons[1]!.trigger('click');
    await flushPromises();

    const putCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/settings') && (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall![1] as RequestInit).body)) as {
      endpointHealth?: unknown;
    };
    expect(body.endpointHealth).toEqual(baseSettings.endpointHealth);
  });

  it('saves streaming settings via PUT /api/admin/settings', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();

    const saveButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'Save');
    await saveButtons[2]!.trigger('click');
    await flushPromises();

    const putCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/settings') && (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall![1] as RequestInit).body)) as {
      streaming?: unknown;
    };
    expect(body.streaming).toEqual(baseSettings.streaming);
  });

  it('saves content-logging settings via PUT /api/admin/settings', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();

    const saveButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'Save');
    await saveButtons[3]!.trigger('click');
    await flushPromises();

    const putCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/settings') && (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall![1] as RequestInit).body)) as {
      contentLogging?: unknown;
    };
    expect(body.contentLogging).toEqual(baseSettings.contentLogging);
  });

  it('saves model-reference settings via PUT /api/admin/settings', async () => {
    stubSettingsAndAudit();
    const wrapper = mountSettings();
    await flushPromises();

    const saveButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'Save');
    await saveButtons[4]!.trigger('click');
    await flushPromises();

    const putCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith('/api/admin/settings') && (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall![1] as RequestInit).body)) as {
      modelReference?: unknown;
    };
    expect(body.modelReference).toEqual(baseSettings.modelReference);
  });

  it('resets a circuit breaker from the breakers table', async () => {
    const breaker = {
      id: 'cb_1',
      upstreamKeyId: 'uk_1',
      upstreamKeyName: 'Primary',
      realModelName: 'gpt-4o',
      state: 'open',
      failureCount: 5,
      successCount: 0,
      openCount: 1,
      openedAt: '2026-06-23T00:00:00.000Z',
      cooldownUntil: null,
      lastErrorCode: 'rate_limit_error',
      lastErrorMessage: 'too many requests',
      updatedAt: '2026-06-23T00:00:00.000Z',
    };
    stubSettingsAndAudit();
    vi.mocked(globalThis.fetch).mockImplementation((async (
      url: string,
      init?: RequestInit,
    ) => {
      if (url.endsWith('/api/admin/auth/me')) {
        return jsonResponse({ admin: { id: 'adm_1', username: 'admin', displayName: 'Admin' } });
      }
      if (url.endsWith('/api/admin/audit')) return jsonResponse({ items: [] });
      if (url.endsWith('/api/admin/settings')) return jsonResponse(baseSettings);
      if (url.includes('/api/admin/circuit-breakers') && url.endsWith('/reset')) {
        return jsonResponse({ ok: true });
      }
      if (url.includes('/api/admin/circuit-breakers')) {
        return jsonResponse({ items: [breaker] });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch);

    const wrapper = mountSettings();
    await flushPromises();

    // The breaker row exposes a Reset button via the action column.
    const resetBtn = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === 'Reset' || /^reset$/i.test(b.text()));
    expect(resetBtn).toBeTruthy();
    await resetBtn!.trigger('click');
    await flushPromises();

    const resetCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url, init]) =>
        String(url).endsWith('/api/admin/circuit-breakers/cb_1/reset') &&
        (init as RequestInit | undefined)?.method === 'POST',
      );
    expect(resetCall).toBeTruthy();
    expect(wrapper.text()).toMatch(/gpt-4o/);
  });
});
