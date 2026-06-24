<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
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
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { getSetupStatus, verifySetupSecurity, setupUpstream, setupModels, setupConsumerKey, getSetupTestRequest } from '../api/admin/setup.js';
import { listProviderPresets } from '../api/admin/provider-presets.js';
import type { ProviderPresetContract } from '@manageyourllm/contracts';

const { t } = useI18n();
const message = useMessage();
const router = useRouter();

const current = ref(0);
const loading = ref(false);
const status = ref<{
  hasAdmin: boolean;
  hasSafeSecret: boolean;
  hasUpstream: boolean;
  hasPublicModel: boolean;
  hasConsumerKey: boolean;
  complete: boolean;
} | null>(null);
const presets = ref<ProviderPresetContract[]>([]);

const security = ref({ username: '', password: '' });
const upstream = ref({
  name: '',
  providerPresetId: null as string | null,
  providerType: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  supportedModels: '',
});
const createdUpstreamKeyId = ref<string | null>(null);

const models = ref<Array<{ name: string; displayName: string; realModelName: string }>>([
  { name: '', displayName: '', realModelName: '' },
]);
const createdModelNames = ref<string[]>([]);

const consumerKeyResult = ref<{ consumerKeyId: string; rawKey: string; appId: string } | null>(null);
const testModel = ref('');
const testCurl = ref('');

const presetOptions = computed(() => presets.value.map((p) => ({ label: `${p.name} (${p.source})`, value: p.id })));

function onPresetChange(presetId: string | null) {
  const preset = presets.value.find((p) => p.id === presetId);
  if (preset && preset.descriptorJson && typeof preset.descriptorJson === 'object' && 'endpoints' in preset.descriptorJson) {
    const endpoints = (preset.descriptorJson as Record<string, unknown>).endpoints as Array<{ baseUrl?: string }> | undefined;
    upstream.value.baseUrl = endpoints?.[0]?.baseUrl ?? upstream.value.baseUrl;
  }
  if (preset) {
    upstream.value.providerType = preset.providerType;
  }
}

async function load() {
  loading.value = true;
  try {
    [status.value, presets.value] = await Promise.all([getSetupStatus(), listProviderPresets()]);
    if (status.value?.complete) {
      current.value = 4;
    }
  } finally {
    loading.value = false;
  }
}

async function nextSecurity() {
  try {
    const res = await verifySetupSecurity(security.value);
    if (!res.ok) {
      message.error(t('setup.invalidCredentials'));
      return;
    }
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
        ? upstream.value.supportedModels.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
    });
    createdUpstreamKeyId.value = res.upstreamKeyId;
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
            upstreamKeyId: createdUpstreamKeyId.value!,
            realModelName: m.realModelName.trim(),
            priority: 100,
            weight: 1,
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

async function nextConsumerKey() {
  try {
    const res = await setupConsumerKey();
    consumerKeyResult.value = res;
    current.value = 4;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function generateTestRequest() {
  try {
    const res = await getSetupTestRequest({ model: testModel.value });
    testCurl.value = res.curl.replace('<your-consumer-key>', consumerKeyResult.value?.rawKey ?? '<your-consumer-key>');
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
        <NStep :title="t('setup.steps.consumerKey')" />
        <NStep :title="t('setup.steps.test')" />
      </NSteps>

      <div style="margin-top: 24px">
        <!-- Step 0: Security -->
        <NSpace v-if="current === 0" vertical :size="16">
          <NAlert v-if="status && !status.hasSafeSecret" type="warning">{{ t('setup.unsafeSecret') }}</NAlert>
          <NForm label-placement="left" label-width="100px">
            <NFormItem :label="t('login.username')">
              <NInput v-model:value="security.username" />
            </NFormItem>
            <NFormItem :label="t('login.password')">
              <NInput v-model:value="security.password" type="password" />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton type="primary" @click="nextSecurity">{{ t('common.next') }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 1: Upstream -->
        <NSpace v-else-if="current === 1" vertical :size="16">
          <NForm label-placement="left" label-width="120px">
            <NFormItem :label="t('upstreamKeys.name')">
              <NInput v-model:value="upstream.name" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.providerPreset')">
              <NSelect v-model:value="upstream.providerPresetId" :options="presetOptions" clearable @update:value="onPresetChange" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.providerType')">
              <NInput v-model:value="upstream.providerType" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.baseUrl')">
              <NInput v-model:value="upstream.baseUrl" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.apiKey')">
              <NInput v-model:value="upstream.apiKey" type="password" />
            </NFormItem>
            <NFormItem :label="t('setup.supportedModels')">
              <NInput v-model:value="upstream.supportedModels" :placeholder="t('setup.supportedModelsPlaceholder')" />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton @click="current = 0">{{ t('common.prev') }}</NButton>
            <NButton type="primary" @click="nextUpstream">{{ t('common.next') }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 2: Models -->
        <NSpace v-else-if="current === 2" vertical :size="16">
          <NCard v-for="(m, index) in models" :key="index" :title="`${t('publicModels.title')} #${index + 1}`" size="small">
            <NForm label-placement="left" label-width="100px">
              <NFormItem :label="t('publicModels.name')">
                <NInput v-model:value="m.name" />
              </NFormItem>
              <NFormItem :label="t('publicModels.displayName')">
                <NInput v-model:value="m.displayName" />
              </NFormItem>
              <NFormItem :label="t('setup.realModelName')">
                <NInput v-model:value="m.realModelName" />
              </NFormItem>
            </NForm>
            <NSpace justify="end">
              <NButton size="small" type="error" @click="removeModel(index)">{{ t('common.delete') }}</NButton>
            </NSpace>
          </NCard>
          <NButton size="small" @click="addModel">{{ t('setup.addModel') }}</NButton>
          <NSpace justify="end">
            <NButton @click="current = 1">{{ t('common.prev') }}</NButton>
            <NButton type="primary" @click="nextModels">{{ t('common.next') }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 3: Consumer Key -->
        <NSpace v-else-if="current === 3" vertical :size="16">
          <p>{{ t('setup.consumerKeyHint') }}</p>
          <NSpace justify="end">
            <NButton @click="current = 2">{{ t('common.prev') }}</NButton>
            <NButton type="primary" @click="nextConsumerKey">{{ t('setup.createConsumerKey') }}</NButton>
          </NSpace>
        </NSpace>

        <!-- Step 4: Test -->
        <NSpace v-else-if="current === 4" vertical :size="16">
          <NAlert v-if="consumerKeyResult" type="success">
            {{ t('setup.consumerKeyCreated') }}
            <div><strong>{{ t('apps.rawKey') }}:</strong> {{ consumerKeyResult.rawKey }}</div>
          </NAlert>
          <NForm label-placement="left" label-width="100px">
            <NFormItem :label="t('setup.testModel')">
              <NSelect v-model:value="testModel" :options="createdModelNames.map((n) => ({ label: n, value: n }))" />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton @click="current = 3">{{ t('common.prev') }}</NButton>
            <NButton type="primary" @click="generateTestRequest">{{ t('setup.generateCurl') }}</NButton>
          </NSpace>
          <NInput v-if="testCurl" :value="testCurl" type="textarea" rows="6" readonly />
          <NSpace justify="end">
            <NButton type="primary" @click="finish">{{ t('setup.finish') }}</NButton>
          </NSpace>
        </NSpace>
      </div>
    </NCard>
  </NSpin>
</template>
