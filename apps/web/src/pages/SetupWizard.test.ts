import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { NMessageProvider } from 'naive-ui';
import { i18n } from '../i18n/index.js';
import { useAuthStore } from '../stores/auth.js';
import SetupWizard from './SetupWizard.vue';
import {
  getSetupStatus,
  verifySetupSecurity,
  setupUpstream,
  setupModels,
  setupClientKey,
  getSetupTestRequest,
} from '../api/admin/setup.js';
import { listProviderPresets } from '../api/admin/provider-presets.js';
import { listModels } from '../api/admin/models.js';
import { generateSnippet } from '../api/admin/snippets.js';

vi.mock('../api/admin/setup.js', () => ({
  getSetupStatus: vi.fn(),
  verifySetupSecurity: vi.fn(),
  setupUpstream: vi.fn(),
  setupModels: vi.fn(),
  setupClientKey: vi.fn(),
  getSetupTestRequest: vi.fn(),
}));

vi.mock('../api/admin/provider-presets.js', () => ({
  listProviderPresets: vi.fn(),
}));

vi.mock('../api/admin/models.js', () => ({
  listModels: vi.fn(),
}));

vi.mock('../api/admin/snippets.js', () => ({
  generateSnippet: vi.fn(),
}));

vi.mock('../stores/auth.js', () => ({
  useAuthStore: vi.fn(),
}));

function mountWizard() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div>overview</div>' } },
      { path: '/setup', name: 'setup', component: SetupWizard },
    ],
  });
  const wrapper = mount(
    {
      render: () => h(NMessageProvider, () => h(SetupWizard)),
    },
    {
      global: { plugins: [i18n, router] },
      attachTo: document.body,
    },
  );
  return { wrapper, router };
}

describe('SetupWizard', () => {
  const login = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ login } as unknown as ReturnType<
      typeof useAuthStore
    >);
  });

  it('redirects to overview when setup is already complete', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({
      hasAdmin: true,
      needsSetup: false,
      hasSafeSecret: true,
      hasUpstream: true,
      hasModel: true,
      hasClientKey: true,
      complete: true,
    });

    const { router } = mountWizard();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('overview');
  });

  it('walks through the full setup flow', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({
      hasAdmin: false,
      needsSetup: true,
      hasSafeSecret: false,
      hasUpstream: false,
      hasModel: false,
      hasClientKey: false,
      complete: false,
    });
    vi.mocked(verifySetupSecurity).mockResolvedValue({
      ok: true,
      created: true,
      needsSetup: false,
    });
    login.mockResolvedValue(undefined);
    vi.mocked(listProviderPresets).mockResolvedValue([]);
    vi.mocked(setupUpstream).mockResolvedValue({ providerAccountId: 'pa_1' });
    vi.mocked(setupModels).mockResolvedValue({ modelIds: ['mdl_1'] });
    vi.mocked(setupClientKey).mockResolvedValue({
      clientKeyId: 'ck_1',
      rawKey: 'raw_key',
      clientId: 'cli_1',
    });
    vi.mocked(getSetupTestRequest).mockResolvedValue({ curl: 'curl test <your-client-key>' });
    vi.mocked(listModels).mockResolvedValue([]);
    vi.mocked(generateSnippet).mockResolvedValue({
      client: 'generic_openai',
      model: 'gpt-4',
      apiKey: 'raw_key',
      gatewayUrl: 'http://localhost/v1/chat/completions',
      content: 'snippet',
    });

    const { wrapper, router } = mountWizard();
    await flushPromises();

    expect(wrapper.find('[data-testid="setup-username"]').exists()).toBe(true);

    await wrapper.find('[data-testid="setup-username"]').find('input').setValue('admin');
    await wrapper.find('[data-testid="setup-password"]').find('input').setValue('password');
    await wrapper.find('[data-testid="setup-displayName"]').find('input').setValue('Admin');
    await wrapper.find('[data-testid="setup-next-security"]').trigger('click');
    await flushPromises();

    expect(verifySetupSecurity).toHaveBeenCalledWith({
      username: 'admin',
      password: 'password',
      displayName: 'Admin',
    });
    expect(login).toHaveBeenCalledWith('admin', 'password');
    expect(listProviderPresets).toHaveBeenCalled();

    expect(wrapper.find('[data-testid="setup-upstream-name"]').exists()).toBe(true);
    await wrapper.find('[data-testid="setup-upstream-name"]').find('input').setValue('OpenAI');
    await wrapper
      .find('[data-testid="setup-upstream-providerType"]')
      .find('input')
      .setValue('openai');
    await wrapper
      .find('[data-testid="setup-upstream-baseUrl"]')
      .find('input')
      .setValue('https://api.openai.com');
    await wrapper.find('[data-testid="setup-upstream-apiKey"]').find('input').setValue('sk-test');
    await wrapper.find('[data-testid="setup-next-upstream"]').trigger('click');
    await flushPromises();

    expect(setupUpstream).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'OpenAI',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
      }),
    );

    expect(wrapper.find('[data-testid="setup-model-name-0"]').exists()).toBe(true);
    await wrapper.find('[data-testid="setup-model-name-0"]').find('input').setValue('gpt-4');
    await wrapper.find('[data-testid="setup-model-real-0"]').find('input').setValue('gpt-4o');
    await wrapper.find('[data-testid="setup-next-models"]').trigger('click');
    await flushPromises();

    expect(setupModels).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [
          expect.objectContaining({
            name: 'gpt-4',
            candidates: [
              expect.objectContaining({ providerAccountId: 'pa_1', realModelName: 'gpt-4o' }),
            ],
          }),
        ],
      }),
    );

    expect(wrapper.find('[data-testid="setup-create-client-key"]').exists()).toBe(true);
    await wrapper.find('[data-testid="setup-create-client-key"]').trigger('click');
    await flushPromises();

    expect(setupClientKey).toHaveBeenCalled();

    expect(wrapper.find('[data-testid="setup-generate-curl"]').exists()).toBe(true);
    await wrapper.find('[data-testid="setup-generate-curl"]').trigger('click');
    await flushPromises();

    expect(getSetupTestRequest).toHaveBeenCalledWith({ model: 'gpt-4' });

    await wrapper.find('[data-testid="setup-finish"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('overview');
  });
});
