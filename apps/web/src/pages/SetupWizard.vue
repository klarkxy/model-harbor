<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import { useAuthStore } from '../stores/auth.js';
import {
  NCard,
  NSpace,
  NSteps,
  NStep,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NButton,
  NInputNumber,
  NSwitch,
  NAlert,
  NSpin,
  NDivider,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  getSetupStatus,
  verifySetupSecurity,
  setupUpstream,
  setupModels,
  setupClientKey,
  getSetupTestRequest,
} from '../api/admin/setup.js';
import { listProviderPresets } from '../api/admin/provider-presets.js';
import type { ProviderPresetContract, SetupStatusResponse } from '@manageyourllm/contracts';

const { t } = useI18n();
const message = useMessage();
const router = useRouter();
const auth = useAuthStore();

const current = ref(0);
const loading = ref(false);
const status = ref<SetupStatusResponse['data'] | null>(null);
const presets = ref<ProviderPresetContract[]>([]);

const security = ref({ username: '', password: '', displayName: '' });
const upstream = ref({
  name: '',
  providerPresetId: null as string | null,
  providerType: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  supportedModels: '',
});
const createdProviderAccountId = ref<string | null>(null);

const models = ref<Array<{ name: string; displayName: string; realModelName: string }>>([
  { name: '', displayName: '', realModelName: '' },
]);
const createdModelNames = ref<string[]>([]);

const clientKeyResult = ref<{ clientKeyId: string; rawKey: string; clientId: string } | null>(null);
const testModel = ref('');
const testCurl = ref('');

const presetOptions = computed(() =>
  presets.value.map((p) => ({ label: `${p.name} (${p.source})`, value: p.id })),
);

function onPresetChange(presetId: string | null) {
  const preset = presets.value.find((p) => p.id === presetId);
  if (
    preset &&
    preset.descriptorJson &&
    typeof preset.descriptorJson === 'object' &&
    'endpoints' in preset.descriptorJson
  ) {
    const endpoints = (preset.descriptorJson as Record<string, unknown>).endpoints as
      | Array<{ baseUrl?: string }>
      | undefined;
    upstream.value.baseUrl = endpoints?.[0]?.baseUrl ?? upstream.value.baseUrl;
  }
  if (preset) {
    upstream.value.providerType = preset.providerType;
  }
}

async function load() {
  loading.value = true;
  try {
    status.value = await getSetupStatus();
    if (status.value?.complete) {
      finish();
    }
  } finally {
    loading.value = false;
  }
}

async function loadPresets() {
  try {
    presets.value = await listProviderPresets();
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  }
}

async function nextSecurity() {
  try {
    const res = await verifySetupSecurity({
      username: security.value.username,
      password: security.value.password,
      displayName: security.value.displayName || undefined,
    });
    if (!res.ok) {
      message.error(t('setup.invalidCredentials'));
      return;
    }
    await auth.login(security.value.username, security.value.password);
    await loadPresets();
    current.value = 1;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function nextUpstream() {
  try {
    const res = await setupUpstream({
      name: upstream.value.name,
      providerPresetId: upstream.value.providerPresetId ?? undefined,
      providerType: upstream.value.providerType,
      baseUrl: upstream.value.baseUrl,
      apiKey: upstream.value.apiKey,
      supportedModels: upstream.value.supportedModels
        ? upstream.value.supportedModels
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    });
    createdProviderAccountId.value = res.providerAccountId;
    current.value = 2;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

function addModel() {
  models.value.push({ name: '', displayName: '', realModelName: '' });
}

function removeModel(index: number) {
  models.value.splice(index, 1);
}

async function nextModels() {
  try {
    const payload = models.value
      .filter((m) => m.name.trim() && m.realModelName.trim())
      .map((m) => ({
        name: m.name.trim(),
        displayName: m.displayName.trim() || undefined,
        candidates: [
          {
            providerAccountId: createdProviderAccountId.value!,
            realModelName: m.realModelName.trim(),
            priority: 100,
            enabled: true,
          },
        ],
      }));
    if (payload.length === 0) {
      message.warning(t('setup.atLeastOneModel'));
      return;
    }
    const res = await setupModels({ models: payload });
    createdModelNames.value = payload.map((m) => m.name);
    testModel.value = payload[0]?.name ?? '';
    current.value = 3;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function nextClientKey() {
  try {
    const res = await setupClientKey();
    clientKeyResult.value = res;
    current.value = 4;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function generateTestRequest() {
  try {
    const res = await getSetupTestRequest({ model: testModel.value });
    testCurl.value = res.curl.replace(
      '<your-client-key>',
      clientKeyResult.value?.rawKey ?? '<your-client-key>',
    );
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

function finish() {
  void router.push({ name: 'overview' });
}

onMounted(load);
</script>

<template>
  <NSpin :show="loading">
    <NCard :title="t('setup.title')" style="max-width: 800px; margin: 40px auto">
      <NSteps :current="current" size="small">
        <NStep :title="t('setup.steps.security')" />
        <NStep :title="t('setup.steps.upstream')" />
        <NStep :title="t('setup.steps.models')" />
        <NStep :title="t('setup.steps.clientKey')" />
        <NStep :title="t('setup.steps.test')" />
      </NSteps>

      <div style="margin-top: 24px">
        <!-- Step 0: Security -->
        <NSpace v-if="current === 0" vertical :size="16">
          <NAlert v-if="status && !status.hasSafeSecret" type="warning">{{
            t('setup.unsafeSecret')
          }}</NAlert>
          <NForm label-placement="left" label-width="100px">
            <NFormItem :label="t('login.username')">
              <NInput v-model:value="security.username" data-testid="setup-username" />
            </NFormItem>
            <NFormItem :label="t('login.password')">
              <NInput
                v-model:value="security.password"
                type="password"
                data-testid="setup-password"
              />
            </NFormItem>
            <NFormItem :label="t('setup.displayName')">
              <NInput v-model:value="security.displayName" data-testid="setup-displayName" />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton type="primary" data-testid="setup-next-security" @click="nextSecurity">{{
              t('common.next')
            }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 1: Upstream -->
        <NSpace v-else-if="current === 1" vertical :size="16">
          <NForm label-placement="left" label-width="120px">
            <NFormItem :label="t('providerAccounts.name')">
              <NInput v-model:value="upstream.name" data-testid="setup-upstream-name" />
            </NFormItem>
            <NFormItem :label="t('providerAccounts.providerPreset')">
              <NSelect
                v-model:value="upstream.providerPresetId"
                :options="presetOptions"
                clearable
                @update:value="onPresetChange"
              />
            </NFormItem>
            <NFormItem :label="t('providerAccounts.providerType')">
              <NInput
                v-model:value="upstream.providerType"
                data-testid="setup-upstream-providerType"
              />
            </NFormItem>
            <NFormItem :label="t('providerAccounts.baseUrl')">
              <NInput v-model:value="upstream.baseUrl" data-testid="setup-upstream-baseUrl" />
            </NFormItem>
            <NFormItem :label="t('providerAccounts.apiKey')">
              <NInput
                v-model:value="upstream.apiKey"
                type="password"
                data-testid="setup-upstream-apiKey"
              />
            </NFormItem>
            <NFormItem :label="t('setup.supportedModels')">
              <NInput
                v-model:value="upstream.supportedModels"
                :placeholder="t('setup.supportedModelsPlaceholder')"
              />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton @click="current = 0">{{ t('common.prev') }}</NButton>
            <NButton type="primary" data-testid="setup-next-upstream" @click="nextUpstream">{{
              t('common.next')
            }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 2: Models -->
        <NSpace v-else-if="current === 2" vertical :size="16">
          <NCard
            v-for="(m, index) in models"
            :key="index"
            :title="`${t('models.title')} #${index + 1}`"
            size="small"
          >
            <NForm label-placement="left" label-width="100px">
              <NFormItem :label="t('models.name')">
                <NInput v-model:value="m.name" :data-testid="`setup-model-name-${index}`" />
              </NFormItem>
              <NFormItem :label="t('models.displayName')">
                <NInput
                  v-model:value="m.displayName"
                  :data-testid="`setup-model-displayName-${index}`"
                />
              </NFormItem>
              <NFormItem :label="t('setup.realModelName')">
                <NInput
                  v-model:value="m.realModelName"
                  :data-testid="`setup-model-real-${index}`"
                />
              </NFormItem>
            </NForm>
            <NSpace justify="end">
              <NButton size="small" type="error" @click="removeModel(index)">{{
                t('common.delete')
              }}</NButton>
            </NSpace>
          </NCard>
          <NButton size="small" @click="addModel">{{ t('setup.addModel') }}</NButton>
          <NSpace justify="end">
            <NButton @click="current = 1">{{ t('common.prev') }}</NButton>
            <NButton type="primary" data-testid="setup-next-models" @click="nextModels">{{
              t('common.next')
            }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 3: Client Key -->
        <NSpace v-else-if="current === 3" vertical :size="16">
          <p>{{ t('setup.clientKeyHint') }}</p>
          <NSpace justify="end">
            <NButton @click="current = 2">{{ t('common.prev') }}</NButton>
            <NButton type="primary" data-testid="setup-create-client-key" @click="nextClientKey">{{
              t('setup.createClientKey')
            }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 4: Test -->
        <NSpace v-else-if="current === 4" vertical :size="16">
          <NAlert v-if="clientKeyResult" type="success">
            {{ t('setup.clientKeyCreated') }}
            <div>
              <strong>{{ t('clients.rawKey') }}:</strong> {{ clientKeyResult.rawKey }}
            </div>
          </NAlert>
          <NForm label-placement="left" label-width="100px">
            <NFormItem :label="t('setup.testModel')">
              <NSelect
                v-model:value="testModel"
                :options="createdModelNames.map((n) => ({ label: n, value: n }))"
              />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton @click="current = 3">{{ t('common.prev') }}</NButton>
            <NButton
              type="primary"
              data-testid="setup-generate-curl"
              @click="generateTestRequest"
              >{{ t('setup.generateCurl') }}</NButton
            >
          </NSpace>
          <NInput v-if="testCurl" :value="testCurl" type="textarea" rows="6" readonly />
          <NSpace justify="end">
            <NButton type="primary" data-testid="setup-finish" @click="finish">{{
              t('setup.finish')
            }}</NButton>
          </NSpace>
        </NSpace>
      </div>
    </NCard>
  </NSpin>
</template>
