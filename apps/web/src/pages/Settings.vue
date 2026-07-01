<script setup lang="ts">
import { ref, onMounted, h, defineComponent } from 'vue';
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
  NDivider,
  NPopover,
  NIcon,
} from 'naive-ui';
import { HelpCircleOutline } from '@vicons/ionicons5';
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
  defaultRequestTimeoutMs: 30_000,
  defaultRetries: 0,
  enableStickySession: true,
  enableCircuitBreaker: true,
  firstTokenTimeoutMs: 30_000,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerBaseCooldownMs: 30_000,
  circuitBreakerMaxCooldownMs: 300_000,
  circuitBreakerHalfOpenSuccessCount: 3,
  endpointHealthProbeEnabled: false,
  endpointHealthProbeIntervalMs: 30_000,
  endpointHealthProbeTimeoutMs: 10_000,
  endpointHealthProbeDegradedLatencyMs: 2000,
  contentLogEnabled: false,
  contentLogMaxRows: 1000,
  contentLogRetentionDays: 7,
  contentLogMaxPayloadBytes: 100_000,
});

async function load() {
  loading.value = true;
  try {
    settings.value = await getSettings();
    const s = settings.value;
    form.value = {
      publicBaseUrl: s.publicBaseUrl ?? '',
      defaultRequestTimeoutMs: s.defaultRequestTimeoutMs ?? 30_000,
      defaultRetries: s.defaultRetries ?? 0,
      enableStickySession: !!s.enableStickySession,
      enableCircuitBreaker: !!s.enableCircuitBreaker,
      firstTokenTimeoutMs: s.firstTokenTimeoutMs ?? 30_000,
      circuitBreakerFailureThreshold: s.circuitBreakerFailureThreshold ?? 5,
      circuitBreakerBaseCooldownMs: s.circuitBreakerBaseCooldownMs ?? 30_000,
      circuitBreakerMaxCooldownMs: s.circuitBreakerMaxCooldownMs ?? 300_000,
      circuitBreakerHalfOpenSuccessCount: s.circuitBreakerHalfOpenSuccessCount ?? 3,
      endpointHealthProbeEnabled: !!s.endpointHealthProbeEnabled,
      endpointHealthProbeIntervalMs: s.endpointHealthProbeIntervalMs ?? 30_000,
      endpointHealthProbeTimeoutMs: s.endpointHealthProbeTimeoutMs ?? 10_000,
      endpointHealthProbeDegradedLatencyMs: s.endpointHealthProbeDegradedLatencyMs ?? 2000,
      contentLogEnabled: !!s.contentLogEnabled,
      contentLogMaxRows: s.contentLogMaxRows ?? 1000,
      contentLogRetentionDays: s.contentLogRetentionDays ?? 7,
      contentLogMaxPayloadBytes: s.contentLogMaxPayloadBytes ?? 100_000,
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
      defaultRequestTimeoutMs: form.value.defaultRequestTimeoutMs,
      defaultRetries: form.value.defaultRetries,
      enableStickySession: form.value.enableStickySession,
      enableCircuitBreaker: form.value.enableCircuitBreaker,
      firstTokenTimeoutMs: form.value.firstTokenTimeoutMs,
      circuitBreakerFailureThreshold: form.value.circuitBreakerFailureThreshold,
      circuitBreakerBaseCooldownMs: form.value.circuitBreakerBaseCooldownMs,
      circuitBreakerMaxCooldownMs: form.value.circuitBreakerMaxCooldownMs,
      circuitBreakerHalfOpenSuccessCount: form.value.circuitBreakerHalfOpenSuccessCount,
      endpointHealthProbeEnabled: form.value.endpointHealthProbeEnabled,
      endpointHealthProbeIntervalMs: form.value.endpointHealthProbeIntervalMs,
      endpointHealthProbeTimeoutMs: form.value.endpointHealthProbeTimeoutMs,
      endpointHealthProbeDegradedLatencyMs: form.value.endpointHealthProbeDegradedLatencyMs,
      contentLogEnabled: form.value.contentLogEnabled,
      contentLogMaxRows: form.value.contentLogMaxRows,
      contentLogRetentionDays: form.value.contentLogRetentionDays,
      contentLogMaxPayloadBytes: form.value.contentLogMaxPayloadBytes,
    };
    settings.value = await updateSettings(payload);
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  } finally {
    saving.value = false;
  }
}

// v1 Phase 7：备份与恢复已独立到 Backups.vue。此处只保留系统级参数。
const HintPopover = defineComponent({
  name: 'HintPopover',
  props: {
    hintKey: { type: String, required: true },
  },
  setup(props) {
    return () =>
      h(
        NPopover,
        {
          trigger: 'click',
          placement: 'top',
          width: 360,
          raw: false,
          arrow: true,
        },
        {
          trigger: () =>
            h(
              NButton,
              {
                text: true,
                size: 'tiny',
                tag: 'span',
                style: 'margin-left: 6px; cursor: help;',
                'aria-label': 'help',
              },
              {
                icon: () => h(NIcon, null, { default: () => h(HelpCircleOutline) }),
              },
            ),
          default: () =>
            h(
              'div',
              { style: 'line-height: 1.55; font-size: 13px;' },
              t(`settings.hints.${props.hintKey}`),
            ),
        },
      );
  },
});

onMounted(load);
</script>

<template>
  <NCard :title="t('settings.title')">
    <NSpin :show="loading">
      <NForm label-placement="left" label-width="240px">
        <NFormItem>
          <template #label>
            <span>{{ t('settings.publicBaseUrl') }}</span>
            <HintPopover hint-key="publicBaseUrl" />
          </template>
          <NInput v-model:value="form.publicBaseUrl" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.defaultRequestTimeoutMs') }}</span>
            <HintPopover hint-key="defaultRequestTimeoutMs" />
          </template>
          <NInputNumber v-model:value="form.defaultRequestTimeoutMs" :min="1000" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.defaultRetries') }}</span>
            <HintPopover hint-key="defaultRetries" />
          </template>
          <NInputNumber v-model:value="form.defaultRetries" :min="0" :max="5" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.enableStickySession') }}</span>
            <HintPopover hint-key="enableStickySession" />
          </template>
          <NSwitch v-model:value="form.enableStickySession" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.enableCircuitBreaker') }}</span>
            <HintPopover hint-key="enableCircuitBreaker" />
          </template>
          <NSwitch v-model:value="form.enableCircuitBreaker" />
        </NFormItem>

        <NDivider />

        <h3 style="margin: 8px 0 12px">{{ t('settings.resilienceTitle') }}</h3>

        <NFormItem>
          <template #label>
            <span>{{ t('settings.firstTokenTimeoutMs') }}</span>
            <HintPopover hint-key="firstTokenTimeoutMs" />
          </template>
          <NInputNumber v-model:value="form.firstTokenTimeoutMs" :min="1000" />
        </NFormItem>

        <NDivider title-placement="left">{{ t('settings.circuitBreaker') }}</NDivider>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.circuitBreakerFailureThreshold') }}</span>
            <HintPopover hint-key="circuitBreakerFailureThreshold" />
          </template>
          <NInputNumber v-model:value="form.circuitBreakerFailureThreshold" :min="1" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.circuitBreakerBaseCooldownMs') }}</span>
            <HintPopover hint-key="circuitBreakerBaseCooldownMs" />
          </template>
          <NInputNumber v-model:value="form.circuitBreakerBaseCooldownMs" :min="1000" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.circuitBreakerMaxCooldownMs') }}</span>
            <HintPopover hint-key="circuitBreakerMaxCooldownMs" />
          </template>
          <NInputNumber v-model:value="form.circuitBreakerMaxCooldownMs" :min="1000" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.circuitBreakerHalfOpenSuccessCount') }}</span>
            <HintPopover hint-key="circuitBreakerHalfOpenSuccessCount" />
          </template>
          <NInputNumber v-model:value="form.circuitBreakerHalfOpenSuccessCount" :min="1" />
        </NFormItem>

        <NDivider title-placement="left">{{ t('settings.endpointHealthProbe') }}</NDivider>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.endpointHealthProbeEnabled') }}</span>
            <HintPopover hint-key="endpointHealthProbeEnabled" />
          </template>
          <NSwitch v-model:value="form.endpointHealthProbeEnabled" />
        </NFormItem>

        <NDivider title-placement="left">{{ t('settings.contentLog') }}</NDivider>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.contentLogEnabled') }}</span>
            <HintPopover hint-key="contentLogEnabled" />
          </template>
          <NSwitch v-model:value="form.contentLogEnabled" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.contentLogMaxRows') }}</span>
            <HintPopover hint-key="contentLogMaxRows" />
          </template>
          <NInputNumber v-model:value="form.contentLogMaxRows" :min="1" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.contentLogRetentionDays') }}</span>
            <HintPopover hint-key="contentLogRetentionDays" />
          </template>
          <NInputNumber v-model:value="form.contentLogRetentionDays" :min="1" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.contentLogMaxPayloadBytes') }}</span>
            <HintPopover hint-key="contentLogMaxPayloadBytes" />
          </template>
          <NInputNumber v-model:value="form.contentLogMaxPayloadBytes" :min="100" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.endpointHealthProbeIntervalMs') }}</span>
            <HintPopover hint-key="endpointHealthProbeIntervalMs" />
          </template>
          <NInputNumber v-model:value="form.endpointHealthProbeIntervalMs" :min="1000" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.endpointHealthProbeTimeoutMs') }}</span>
            <HintPopover hint-key="endpointHealthProbeTimeoutMs" />
          </template>
          <NInputNumber v-model:value="form.endpointHealthProbeTimeoutMs" :min="1000" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('settings.endpointHealthProbeDegradedLatencyMs') }}</span>
            <HintPopover hint-key="endpointHealthProbeDegradedLatencyMs" />
          </template>
          <NInputNumber v-model:value="form.endpointHealthProbeDegradedLatencyMs" :min="1" />
        </NFormItem>

        <NSpace justify="end" style="margin-top: 16px">
          <NButton type="primary" :loading="saving" @click="onSave">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </NForm>
    </NSpin>
  </NCard>
</template>
