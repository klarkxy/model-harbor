<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NAlert,
  NForm,
  NFormItem,
  NSelect,
  NInputNumber,
  NSpace,
  NButton,
  NSpin,
  NDataTable,
  NModal,
  NInput,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { listDebugContentLogs, getDebugContentLogByTraceId } from '../api/admin/debug-content.js';
import { getSettings, updateSettings } from '../api/admin/settings.js';
import type { DebugContentLogContract, SettingsContract, UpdateSettingsRequest } from '@manageyourllm/contracts';

const { t } = useI18n();
const message = useMessage();

const loading = ref(false);
const saving = ref(false);
const settings = ref<SettingsContract | null>(null);
const logs = ref<DebugContentLogContract[]>([]);
const selected = ref<DebugContentLogContract | null>(null);
const showDetail = ref(false);

const durationOptions = [
  { label: t('debugContentLogs.duration.off'), value: 'off' },
  { label: t('debugContentLogs.duration.min15'), value: '15' },
  { label: t('debugContentLogs.duration.hour1'), value: '60' },
  { label: t('debugContentLogs.duration.hour4'), value: '240' },
];

const form = ref({
  duration: 'off',
  maxRows: 1000,
});

const isRecording = computed(() => {
  if (!settings.value?.contentLogEnabled) return false;
  const expiresAt = settings.value.contentLogExpiresAt;
  if (!expiresAt) return false;
  return new Date(expiresAt) > new Date();
});

const remainingText = computed(() => {
  if (!isRecording.value || !settings.value?.contentLogExpiresAt) return '';
  const diff = new Date(settings.value.contentLogExpiresAt).getTime() - Date.now();
  const minutes = Math.max(0, Math.ceil(diff / 60_000));
  return t('debugContentLogs.remaining', { minutes });
});

async function load() {
  loading.value = true;
  try {
    const [s, data] = await Promise.all([getSettings(), listDebugContentLogs(50)]);
    settings.value = s;
    logs.value = data;
    form.value.maxRows = s.contentLogMaxRows ?? 1000;
    if (s.contentLogEnabled && s.contentLogExpiresAt && new Date(s.contentLogExpiresAt) > new Date()) {
      form.value.duration = '60';
    } else {
      form.value.duration = 'off';
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  if (!settings.value) return;
  saving.value = true;
  try {
    const payload: UpdateSettingsRequest = {
      contentLogMaxRows: form.value.maxRows,
    };
    if (form.value.duration === 'off') {
      payload.contentLogEnabled = false;
      payload.contentLogExpiresAt = null;
    } else {
      const minutes = Number(form.value.duration);
      const expiresAt = new Date(Date.now() + minutes * 60_000);
      payload.contentLogEnabled = true;
      payload.contentLogExpiresAt = expiresAt.toISOString();
    }
    settings.value = await updateSettings(payload);
    message.success(t('common.saved'));
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  } finally {
    saving.value = false;
  }
}

async function onView(row: DebugContentLogContract) {
  try {
    selected.value = await getDebugContentLogByTraceId(row.requestTraceId ?? row.id);
    showDetail.value = true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  }
}

const columns = computed(() => [
  { title: t('debugContentLogs.time'), key: 'createdAt', width: 180 },
  { title: t('debugContentLogs.traceId'), key: 'requestTraceId', ellipsis: { tooltip: true } },
  {
    title: t('debugContentLogs.tokens'),
    key: 'tokens',
    width: 160,
    render: (row: DebugContentLogContract) =>
      `${row.inputTokens ?? 0} / ${row.outputTokens ?? 0} / ${row.totalTokens ?? 0}`,
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 100,
    render: (row: DebugContentLogContract) =>
      h(NButton, { size: 'small', onClick: () => onView(row) }, () => t('common.view')),
  },
]);

onMounted(load);
</script>

<template>
  <NSpin :show="loading">
    <NAlert
      v-if="isRecording"
      type="warning"
      :title="t('debugContentLogs.recordingTitle')"
      style="margin-bottom: 16px"
    >
      {{ remainingText }}
    </NAlert>
    <NAlert
      v-else
      type="info"
      :title="t('debugContentLogs.notRecordingTitle')"
      style="margin-bottom: 16px"
    >
      {{ t('debugContentLogs.notRecordingDesc') }}
    </NAlert>

    <NCard :title="t('debugContentLogs.controls')">
      <NForm label-placement="left" label-width="140px">
        <NFormItem :label="t('debugContentLogs.duration.label')">
          <NSelect v-model:value="form.duration" :options="durationOptions" style="width: 200px" />
        </NFormItem>
        <NFormItem :label="t('debugContentLogs.maxRows')">
          <NInputNumber v-model:value="form.maxRows" :min="1" :max="10000" style="width: 200px" />
        </NFormItem>
        <NSpace justify="end">
          <NButton type="primary" :loading="saving" @click="onSave">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </NForm>
    </NCard>

    <NCard :title="t('debugContentLogs.recent')" style="margin-top: 16px">
      <NDataTable
        :columns="columns"
        :data="logs"
        :bordered="false"
        :single-line="false"
        size="small"
        :row-key="(row: DebugContentLogContract) => row.id"
      />
    </NCard>

    <NModal
      v-model:show="showDetail"
      :title="t('debugContentLogs.detail')"
      preset="card"
      style="width: 800px; max-width: 90vw"
    >
      <NForm label-placement="top">
        <NFormItem :label="t('debugContentLogs.prompt')">
          <NInput
            type="textarea"
            :value="JSON.stringify(selected?.promptJson ?? null, null, 2)"
            readonly
            :autosize="{ minRows: 4, maxRows: 12 }"
          />
        </NFormItem>
        <NFormItem :label="t('debugContentLogs.response')">
          <NInput
            type="textarea"
            :value="JSON.stringify(selected?.responseJson ?? null, null, 2)"
            readonly
            :autosize="{ minRows: 4, maxRows: 12 }"
          />
        </NFormItem>
      </NForm>
    </NModal>
  </NSpin>
</template>
