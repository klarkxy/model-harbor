<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  type DataTableColumns,
} from 'naive-ui';
import { ApiClientError } from '../api/client.js';
import {
  accountApi,
  auditApi,
  circuitBreakerApi,
  settingsApi,
  type AdminSummary,
  type AuditEvent,
  type CircuitBreakerItem,
  type CircuitBreakerSettings,
  type EndpointHealthSettings,
  type StreamingSettings,
  type ContentLogSettings,
} from '../api/admin.js';

const { t } = useI18n();

const message = ref<string | null>(null);
const error = ref<string | null>(null);
const savingProfile = ref(false);
const savingPassword = ref(false);
const savingCircuitBreaker = ref(false);
const savingEndpointHealth = ref(false);
const savingStreaming = ref(false);
const savingContentLogging = ref(false);
const savingModelReference = ref(false);

const profile = ref<AdminSummary | null>(null);
const displayName = ref<string>('');

const currentPassword = ref<string>('');
const newPassword = ref<string>('');
const confirmPassword = ref<string>('');

const auditEvents = ref<AuditEvent[]>([]);
const auditLoading = ref(false);

const circuitBreakerSettings = ref<CircuitBreakerSettings | null>(null);
const endpointHealthSettings = ref<EndpointHealthSettings | null>(null);
const streamingSettings = ref<StreamingSettings | null>(null);
const contentLogSettings = ref<ContentLogSettings | null>(null);
const modelReferenceSettings = ref<{
  defaultRegion: 'international' | 'domestic';
  autoPreset: string;
  autoWeights: Record<string, number>;
  autoTopN: number;
} | null>(null);
const circuitBreakers = ref<CircuitBreakerItem[]>([]);
const circuitBreakersLoading = ref(false);

async function refreshProfile(): Promise<void> {
  const res = await fetch('/api/admin/auth/me', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(t('settings.account.loadError'));
  }
  const json = (await res.json()) as { admin: AdminSummary };
  profile.value = json.admin;
  displayName.value = json.admin.displayName ?? '';
}

async function refreshAudit(): Promise<void> {
  auditLoading.value = true;
  try {
    const res = await auditApi.list(200);
    auditEvents.value = res.items;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    auditLoading.value = false;
  }
}

async function refreshCircuitBreakerSettings(): Promise<void> {
  try {
    const res = await settingsApi.get();
    circuitBreakerSettings.value = res.circuitBreaker;
    endpointHealthSettings.value = res.endpointHealth;
    streamingSettings.value = res.streaming;
    contentLogSettings.value = res.contentLogging;
    modelReferenceSettings.value = res.modelReference;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function refreshCircuitBreakers(): Promise<void> {
  circuitBreakersLoading.value = true;
  try {
    const res = await circuitBreakerApi.list({ limit: 200 });
    circuitBreakers.value = res.items;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    circuitBreakersLoading.value = false;
  }
}

onMounted(async () => {
  try {
    await Promise.all([refreshProfile(), refreshAudit(), refreshCircuitBreakerSettings(), refreshCircuitBreakers()]);
  } catch (err) {
    error.value = (err as Error).message;
  }
});

async function saveEndpointHealthSettings(): Promise<void> {
  if (!endpointHealthSettings.value) return;
  savingEndpointHealth.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await settingsApi.update({ endpointHealth: endpointHealthSettings.value });
    endpointHealthSettings.value = res.endpointHealth;
    message.value = t('settings.endpointHealth.saved');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingEndpointHealth.value = false;
  }
}

async function saveStreamingSettings(): Promise<void> {
  if (!streamingSettings.value) return;
  savingStreaming.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await settingsApi.update({ streaming: streamingSettings.value });
    streamingSettings.value = res.streaming;
    message.value = t('settings.streaming.saved');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingStreaming.value = false;
  }
}

async function saveContentLogSettings(): Promise<void> {
  if (!contentLogSettings.value) return;
  savingContentLogging.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await settingsApi.update({ contentLogging: contentLogSettings.value });
    contentLogSettings.value = res.contentLogging;
    message.value = t('settings.contentLogging.saved');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingContentLogging.value = false;
  }
}

async function saveModelReferenceSettings(): Promise<void> {
  if (!modelReferenceSettings.value) return;
  savingModelReference.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await settingsApi.update({ modelReference: modelReferenceSettings.value });
    modelReferenceSettings.value = res.modelReference;
    message.value = t('settings.modelReference.saved');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingModelReference.value = false;
  }
}

async function saveProfile(): Promise<void> {
  savingProfile.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await accountApi.updateProfile({ displayName: displayName.value.trim() });
    profile.value = res.admin;
    message.value = t('settings.account.updated');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingProfile.value = false;
  }
}

async function changePassword(): Promise<void> {
  error.value = null;
  message.value = null;
  if (newPassword.value.length < 8) {
    error.value = t('settings.password.tooShort');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('settings.password.mismatch');
    return;
  }
  savingPassword.value = true;
  try {
    await accountApi.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    message.value = t('settings.password.changed');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingPassword.value = false;
  }
}

async function saveCircuitBreakerSettings(): Promise<void> {
  if (!circuitBreakerSettings.value) return;
  savingCircuitBreaker.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await settingsApi.update({ circuitBreaker: circuitBreakerSettings.value });
    circuitBreakerSettings.value = res.circuitBreaker;
    message.value = t('settings.circuitBreaker.saved');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingCircuitBreaker.value = false;
  }
}

async function resetBreaker(row: CircuitBreakerItem): Promise<void> {
  error.value = null;
  message.value = null;
  try {
    await circuitBreakerApi.reset(row.id);
    message.value = t('settings.circuitBreaker.resetOk', { model: row.realModelName });
    await refreshCircuitBreakers();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  }
}

const auditColumns = computed<DataTableColumns<AuditEvent>>(() => [
  {
    title: t('settings.audit.columns.time'),
    key: 'createdAt',
    width: 200,
    render: (row) => new Date(row.createdAt).toLocaleString(),
  },
  { title: t('settings.audit.columns.actor'), key: 'actorUsername', width: 140 },
  {
    title: t('settings.audit.columns.action'),
    key: 'action',
    width: 220,
    ellipsis: { tooltip: true },
  },
  { title: t('settings.audit.columns.resourceType'), key: 'resourceType', width: 140 },
  {
    title: t('settings.audit.columns.resourceId'),
    key: 'resourceId',
    width: 200,
    ellipsis: { tooltip: true },
  },
  { title: t('settings.audit.columns.ip'), key: 'ip', width: 140 },
]);

const breakerColumns = computed<DataTableColumns<CircuitBreakerItem>>(() => [
  {
    title: t('settings.circuitBreaker.columns.state'),
    key: 'state',
    width: 120,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: row.state === 'open' ? 'error' : row.state === 'half_open' ? 'warning' : 'default',
        },
        () => row.state,
      ),
  },
  { title: t('settings.circuitBreaker.columns.upstreamKey'), key: 'upstreamKeyName', width: 200, ellipsis: { tooltip: true } },
  { title: t('settings.circuitBreaker.columns.model'), key: 'realModelName', width: 200, ellipsis: { tooltip: true } },
  { title: t('settings.circuitBreaker.columns.failures'), key: 'failureCount', width: 90 },
  { title: t('settings.circuitBreaker.columns.successes'), key: 'successCount', width: 90 },
  {
    title: t('settings.circuitBreaker.columns.cooldownUntil'),
    key: 'cooldownUntil',
    width: 180,
    render: (row) => (row.cooldownUntil ? new Date(row.cooldownUntil).toLocaleString() : '—'),
  },
  {
    title: t('settings.circuitBreaker.columns.lastError'),
    key: 'lastErrorMessage',
    width: 240,
    ellipsis: { tooltip: true },
    render: (row) => row.lastErrorMessage ?? '—',
  },
  {
    title: t('settings.circuitBreaker.columns.actions'),
    key: 'actions',
    width: 100,
    render: (row) =>
      h(
        NButton,
        { size: 'small', onClick: () => resetBreaker(row) },
        () => t('settings.circuitBreaker.reset'),
      ),
  },
]);

const username = computed(() => profile.value?.username ?? '');

const referenceRegionOptions = computed(() => [
  { label: t('modelGroups.drawer.regions.international'), value: 'international' },
  { label: t('modelGroups.drawer.regions.domestic'), value: 'domestic' },
]);

const autoPresetOptions = computed(() => [
  { label: t('modelGroups.drawer.presets.balanced'), value: 'balanced' },
  { label: t('modelGroups.drawer.presets.chat'), value: 'chat' },
  { label: t('modelGroups.drawer.presets.code'), value: 'code' },
  { label: t('modelGroups.drawer.presets.plan'), value: 'plan' },
  { label: t('modelGroups.drawer.presets.cheap'), value: 'cheap' },
]);

const autoWeightKeys = [
  'intelligence',
  'chat',
  'knowledge',
  'math',
  'chinese',
  'reasoning',
  'coding',
  'agentic',
  'costEfficiency',
  'price',
  'context',
] as const;
</script>

<template>
  <div class="settings-page">
    <NSpace vertical size="large">
      <NCard :title="t('settings.account.title')">
        <NForm label-placement="top" style="max-width: 480px">
          <NFormItem :label="t('settings.account.username')">
            <NInput :value="username" readonly />
          </NFormItem>
          <NFormItem :label="t('settings.account.displayName')">
            <NInput v-model:value="displayName" :placeholder="t('settings.account.placeholder')" />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingProfile" @click="saveProfile">
              {{ t('settings.account.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.password.title')">
        <NForm label-placement="top" style="max-width: 480px">
          <NFormItem :label="t('settings.password.current')">
            <NInput v-model:value="currentPassword" type="password" show-password-on="click" />
          </NFormItem>
          <NFormItem :label="t('settings.password.new')">
            <NInput v-model:value="newPassword" type="password" show-password-on="click" />
          </NFormItem>
          <NFormItem :label="t('settings.password.confirm')">
            <NInput v-model:value="confirmPassword" type="password" show-password-on="click" />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingPassword" @click="changePassword">
              {{ t('settings.password.change') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.circuitBreaker.title')">
        <NSpin v-if="!circuitBreakerSettings" />
        <NForm v-else label-placement="top" style="max-width: 640px">
          <NFormItem :label="t('settings.circuitBreaker.enabled')">
            <NSwitch v-model:value="circuitBreakerSettings.enabled" />
          </NFormItem>
          <NFormItem :label="t('settings.circuitBreaker.failureThreshold')">
            <NInputNumber v-model:value="circuitBreakerSettings.failureThreshold" :min="1" style="width: 200px" />
          </NFormItem>
          <NFormItem :label="t('settings.circuitBreaker.baseCooldownMs')">
            <NInputNumber v-model:value="circuitBreakerSettings.baseCooldownMs" :min="1000" :step="1000" style="width: 200px" />
          </NFormItem>
          <NFormItem :label="t('settings.circuitBreaker.maxCooldownMs')">
            <NInputNumber v-model:value="circuitBreakerSettings.maxCooldownMs" :min="1000" :step="1000" style="width: 200px" />
          </NFormItem>
          <NFormItem :label="t('settings.circuitBreaker.halfOpenSuccessCount')">
            <NInputNumber v-model:value="circuitBreakerSettings.halfOpenSuccessCount" :min="1" style="width: 200px" />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingCircuitBreaker" @click="saveCircuitBreakerSettings">
              {{ t('settings.circuitBreaker.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.endpointHealth.title')">
        <NSpin v-if="!endpointHealthSettings" />
        <NForm v-else label-placement="top" style="max-width: 640px">
          <NFormItem :label="t('settings.endpointHealth.enabled')">
            <NSwitch v-model:value="endpointHealthSettings.probeEnabled" />
          </NFormItem>
          <NFormItem :label="t('settings.endpointHealth.intervalMs')">
            <NInputNumber
              v-model:value="endpointHealthSettings.probeIntervalMs"
              :min="60000"
              :step="60000"
              style="width: 200px"
            />
          </NFormItem>
          <NFormItem :label="t('settings.endpointHealth.timeoutMs')">
            <NInputNumber
              v-model:value="endpointHealthSettings.probeTimeoutMs"
              :min="1000"
              :step="1000"
              style="width: 200px"
            />
          </NFormItem>
          <NFormItem :label="t('settings.endpointHealth.degradedLatencyMs')">
            <NInputNumber
              v-model:value="endpointHealthSettings.degradedLatencyMs"
              :min="1000"
              :step="1000"
              style="width: 200px"
            />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingEndpointHealth" @click="saveEndpointHealthSettings">
              {{ t('settings.endpointHealth.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.streaming.title')">
        <NSpin v-if="!streamingSettings" />
        <NForm v-else label-placement="top" style="max-width: 640px">
          <NFormItem :label="t('settings.streaming.firstTokenTimeoutMs')">
            <NInputNumber
              v-model:value="streamingSettings.firstTokenTimeoutMs"
              :min="0"
              :step="1000"
              style="width: 200px"
            />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingStreaming" @click="saveStreamingSettings">
              {{ t('settings.streaming.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.contentLogging.title')">
        <NAlert type="warning" style="margin-bottom: 16px">
          {{ t('settings.contentLogging.warning') }}
        </NAlert>
        <NSpin v-if="!contentLogSettings" />
        <NForm v-else label-placement="top" style="max-width: 640px">
          <NFormItem :label="t('settings.contentLogging.enabled')">
            <NSwitch v-model:value="contentLogSettings.enabled" />
          </NFormItem>
          <NFormItem :label="t('settings.contentLogging.retentionDays')">
            <NInputNumber
              v-model:value="contentLogSettings.retentionDays"
              :min="1"
              :step="1"
              style="width: 200px"
            />
          </NFormItem>
          <NFormItem :label="t('settings.contentLogging.maxPayloadBytes')">
            <NInputNumber
              v-model:value="contentLogSettings.maxPayloadBytes"
              :min="0"
              :step="1024"
              style="width: 200px"
            />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingContentLogging" @click="saveContentLogSettings">
              {{ t('settings.contentLogging.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.modelReference.title')">
        <NSpin v-if="!modelReferenceSettings" />
        <NForm v-else label-placement="top" style="max-width: 640px">
          <NFormItem :label="t('settings.modelReference.defaultRegion')">
            <NSelect
              v-model:value="modelReferenceSettings.defaultRegion"
              :options="referenceRegionOptions"
              style="width: 220px"
            />
          </NFormItem>
          <NFormItem :label="t('settings.modelReference.autoPreset')">
            <NSelect
              v-model:value="modelReferenceSettings.autoPreset"
              :options="autoPresetOptions"
              style="width: 220px"
            />
          </NFormItem>
          <NFormItem :label="t('settings.modelReference.autoTopN')">
            <NInputNumber
              v-model:value="modelReferenceSettings.autoTopN"
              :min="1"
              :max="20"
              style="width: 160px"
            />
          </NFormItem>
          <NFormItem :label="t('settings.modelReference.autoWeights')">
            <NSpace>
              <NFormItem
                v-for="key in autoWeightKeys"
                :key="key"
                :label="t(`modelReference.columns.${key}`)"
                label-placement="top"
                style="width: 118px"
              >
                <NInputNumber
                  v-model:value="modelReferenceSettings.autoWeights[key]"
                  :min="0"
                  :step="0.05"
                  style="width: 118px"
                />
              </NFormItem>
            </NSpace>
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingModelReference" @click="saveModelReferenceSettings">
              {{ t('settings.modelReference.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.circuitBreaker.listTitle')" :loading="circuitBreakersLoading">
        <NDataTable
          :columns="breakerColumns"
          :data="circuitBreakers"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :max-height="480"
        />
      </NCard>

      <NCard :title="t('settings.audit.title')" :loading="auditLoading">
        <NDataTable
          :columns="auditColumns"
          :data="auditEvents"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :max-height="480"
        />
      </NCard>

      <NAlert v-if="error" type="error" :show-icon="false">{{ error }}</NAlert>
      <NAlert v-if="message" type="success" :show-icon="false">{{ message }}</NAlert>
      <NText depth="3" style="font-size: 12px">
        {{ t('settings.secretsNote') }}
      </NText>
    </NSpace>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1100px;
  margin: 0 auto;
}
</style>
