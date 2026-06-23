import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { NConfigProvider } from 'naive-ui';
import Usage from './Usage.vue';
import { i18n } from '../i18n/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mountUsage() {
  return mount(NConfigProvider, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
        EChart: {
          props: ['option', 'height'],
          template: '<div data-testid="chart">{{ option?.title?.text ?? "" }}</div>',
        },
        NDrawer: {
          props: ['show'],
          template: '<div v-if="show" class="drawer"><slot /></div>',
        },
        NDrawerContent: {
          props: ['title'],
          template: '<section><h2>{{ title }}</h2><slot /></section>',
        },
      },
    },
    slots: { default: () => h(Usage) },
  });
}

describe('Usage page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('loads usage dashboards and renders computed rates', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/usage/totals')) {
        return jsonResponse({
          totalRequests: 10,
          successfulRequests: 8,
          failedRequests: 2,
          stickyHits: 3,
          inputTokens: 1200,
          outputTokens: 800,
          totalTokens: 2000,
          successRate: 0.8,
          stickyHitRate: 0.3,
        });
      }
      if (url.includes('/api/admin/usage/by-app')) {
        return jsonResponse({
          items: [
            {
              id: 'app_1',
              name: 'IDE',
              totalRequests: 10,
              successfulRequests: 8,
              failedRequests: 2,
              inputTokens: 1200,
              outputTokens: 800,
              totalTokens: 2000,
            },
          ],
        });
      }
      if (url.includes('/api/admin/usage/by-consumer-key')) return jsonResponse({ items: [] });
      if (url.includes('/api/admin/usage/by-upstream-key')) return jsonResponse({ items: [] });
      if (url.includes('/api/admin/usage/by-target')) {
        return jsonResponse({
          items: [
            {
              id: 'pm_1',
              name: 'claude-public',
              targetType: 'public_model',
              totalRequests: 10,
              successfulRequests: 8,
              failedRequests: 2,
              inputTokens: 1200,
              outputTokens: 800,
              totalTokens: 2000,
            },
          ],
        });
      }
      if (url.includes('/api/admin/usage/recent')) {
        return jsonResponse({
          items: [
            {
              id: 'usage_1',
              appId: 'app_1',
              consumerKeyId: 'ck_1',
              requestedTargetName: 'claude-public',
              resolvedTargetType: 'public_model',
              resolvedTargetId: 'pm_1',
              upstreamKeyId: 'uk_1',
              realModelName: 'claude-real',
              sourceProtocol: 'anthropic',
              stream: false,
              stickyHit: true,
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              status: 'success',
              errorCode: null,
              latencyMs: 240,
              createdAt: '2026-06-22T00:00:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/admin/usage/traces/trace_1')) {
        return jsonResponse({
          requestTraceId: 'trace_1',
          steps: [
            {
              id: 'step_1',
              requestTraceId: 'trace_1',
              step: 'candidate.accepted',
              stepIndex: 1,
              requestedTargetName: 'claude-public',
              upstreamKeyName: 'Primary',
              realModelName: 'claude-real',
              latencyMs: 240,
              errorMessage: null,
              errorCode: null,
            },
          ],
        });
      }
      if (url.includes('/api/admin/usage/traces')) {
        return jsonResponse({
          items: [
            {
              requestTraceId: 'trace_1',
              requestedTargetName: 'claude-public',
              consumerKeyId: 'ck_1',
              appId: 'app_1',
              sourceProtocol: 'anthropic',
              createdAt: '2026-06-22T00:00:00.000Z',
              finalOutcome: 'success',
            },
          ],
        });
      }
      if (url.includes('/api/admin/usage/consumption/daily')) {
        return jsonResponse({
          items: [
            {
              dayDate: '2026-06-22',
              totalRequests: 10,
              totalInputTokens: 1200,
              totalOutputTokens: 800,
              totalTotalTokens: 2000,
              totalCacheReadTokens: 0,
              totalCacheWriteTokens: 0,
            },
          ],
        });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountUsage();
    await flushPromises();

    expect(wrapper.text()).toContain('80.0%');
    expect(wrapper.text()).toContain('30.0%');
    expect(wrapper.text()).toContain('IDE');
    expect(wrapper.text()).toContain('claude-public');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/usage/totals?window=today',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});
