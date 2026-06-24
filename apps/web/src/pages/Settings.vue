<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSwitch,
  NSpace,
  NButton,
  NSpin,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { getSettings, updateSettings } from '../api/admin/settings.js';
import type { SettingsContract, UpdateSettingsRequest } from '@manageyourllm/contracts';

const { t } = useI18n();
const message = useMessage();

const loading = ref(false);
const saving = ref(false);
const settings = ref<SettingsContract | null>(null);
const form = ref({
  publicBaseUrl: '',
  gatewayBasePath: '',
  defaultRequestTimeoutMs: 30_000,
  defaultRetries: 0,
  enableStickySession: true,
  enableCircuitBreaker: true,
});

async function load() {
  loading.value = true;
  try {
    settings.value = await getSettings();
    const s = settings.value;
    form.value = {
      publicBaseUrl: s.publicBaseUrl ?? '',
      gatewayBasePath: s.gatewayBasePath ?? '',
      defaultRequestTimeoutMs: s.defaultRequestTimeoutMs ?? 30_000,
      defaultRetries: s.defaultRetries ?? 0,
      enableStickySession: !!s.enableStickySession,
      enableCircuitBreaker: !!s.enableCircuitBreaker,
    };
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  saving.value = true;
  try {
    const payload: UpdateSettingsRequest = {
      publicBaseUrl: form.value.publicBaseUrl || null,
      gatewayBasePath: form.value.gatewayBasePath || null,
      defaultRequestTimeoutMs: form.value.defaultRequestTimeoutMs,
      defaultRetries: form.value.defaultRetries,
      enableStickySession: form.value.enableStickySession,
      enableCircuitBreaker: form.value.enableCircuitBreaker,
    };
    settings.value = await updateSettings(payload);
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <NCard :title="t('settings.title')">
    <NSpin :show="loading">
      <NForm label-placement="left" label-width="180px">
        <NFormItem :label="t('settings.publicBaseUrl')">
          <NInput v-model:value="form.publicBaseUrl" />
        </NFormItem>
        <NFormItem :label="t('settings.gatewayBasePath')">
          <NInput v-model:value="form.gatewayBasePath" />
        </NFormItem>
        <NFormItem :label="t('settings.defaultRequestTimeoutMs')">
          <NInputNumber v-model:value="form.defaultRequestTimeoutMs" :min="1000" />
        </NFormItem>
        <NFormItem :label="t('settings.defaultRetries')">
          <NInputNumber v-model:value="form.defaultRetries" :min="0" :max="5" />
        </NFormItem>
        <NFormItem :label="t('settings.enableStickySession')">
          <NSwitch v-model:value="form.enableStickySession" />
        </NFormItem>
        <NFormItem :label="t('settings.enableCircuitBreaker')">
          <NSwitch v-model:value="form.enableCircuitBreaker" />
        </NFormItem>
        <NSpace justify="end">
          <NButton type="primary" :loading="saving" @click="onSave">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </NForm>
    </NSpin>
  </NCard>
</template>
