<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NSpace,
  NSelect,
  NDataTable,
  NTag,
  NSpin,
  NEmpty,
  NModal,
  NStatistic,
  NButton,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { getTraces, getTrace } from '../api/admin/traces.js';
import type {
  TraceSummaryContract,
  TraceDetailContract,
  TraceEventContract,
} from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();
const router = useRouter();

const loading = ref(false);
const traces = ref<TraceSummaryContract[]>([]);
const sinceOption = ref<'today' | 'last7' | 'last30'>('today');
const showDetail = ref(false);
const detail = ref<TraceDetailContract | null>(null);
const detailLoading = ref(false);

const sinceOptions = [
  { label: t('usage.today'), value: 'today' },
  { label: t('usage.last7Days'), value: 'last7' },
  { label: t('usage.last30Days'), value: 'last30' },
];

const sinceIso = computed(() => {
  const now = new Date();
  let d: Date;
  switch (sinceOption.value) {
    case 'last7':
      d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'last30':
      d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  }
  return d.toISOString();
});

async function load() {
  loading.value = true;
  try {
    traces.value = await getTraces(sinceIso.value);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function openDetail(requestTraceId: string) {
  showDetail.value = true;
  detailLoading.value = true;
  try {
    detail.value = await getTrace(requestTraceId);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
    showDetail.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  showDetail.value = false;
  detail.value = null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

function tokens(row: {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}): string {
  return `${row.inputTokens ?? 0} / ${row.outputTokens ?? 0} / ${row.totalTokens ?? 0}`;
}

function statusTag(status: string) {
  return h(
    NTag,
    { type: status === 'success' ? 'success' : 'error', size: 'small' },
    { default: () => (status === 'success' ? t('trace.success') : t('trace.error')) },
  );
}

function linkButton(label: string, onClick: () => void) {
  return h(
    NButton,
    {
      text: true,
      type: 'primary',
      size: 'small',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      },
    },
    { default: () => label },
  );
}

function targetLink(row: TraceSummaryContract) {
  if (!row.resolvedTargetType || !row.resolvedTargetId) {
    return row.requestedTargetName;
  }
  const routeName = row.resolvedTargetType === 'public_model' ? 'public-models' : 'model-groups';
  return linkButton(row.requestedTargetName, () => {
    void router.push({ name: routeName, query: { highlight: row.resolvedTargetId! } });
  });
}

function upstreamLink(upstreamKeyId: string) {
  return linkButton(upstreamKeyId, () => {
    void router.push({ name: 'upstream-keys', query: { highlight: upstreamKeyId } });
  });
}

const columns = computed<DataTableColumns<TraceSummaryContract>>(() => [
  {
    title: t('trace.time'),
    key: 'createdAt',
    width: 170,
    render: (row) => formatTime(row.createdAt),
  },
  {
    title: t('trace.id'),
    key: 'requestTraceId',
    ellipsis: { tooltip: true },
    width: 200,
    render: (row) => row.requestTraceId,
  },
  {
    title: t('trace.target'),
    key: 'requestedTargetName',
    ellipsis: { tooltip: true },
    render: (row) => targetLink(row),
  },
  {
    title: t('trace.upstream'),
    key: 'upstreamKeyId',
    ellipsis: { tooltip: true },
    render: (row) => upstreamLink(row.upstreamKeyId),
  },
  { title: t('trace.model'), key: 'realModelName', ellipsis: { tooltip: true } },
  { title: t('trace.status'), key: 'status', width: 90, render: (row) => statusTag(row.status) },
  {
    title: t('trace.latency'),
    key: 'latencyMs',
    width: 110,
    render: (row) => `${row.latencyMs} ms`,
  },
  { title: t('trace.tokens'), key: 'tokens', width: 140, render: (row) => tokens(row) },
  { title: t('trace.attempts'), key: 'attemptCount', width: 90 },
]);

const eventColumns = computed<DataTableColumns<TraceEventContract>>(() => [
  { title: t('trace.step'), key: 'step' },
  { title: '#', key: 'stepIndex', width: 70 },
  {
    title: t('trace.status'),
    key: 'status',
    width: 90,
    render: (row) => (row.status ? statusTag(row.status) : '-'),
  },
  {
    title: t('trace.upstream'),
    key: 'upstreamKeyId',
    ellipsis: { tooltip: true },
    render: (row) => (row.upstreamKeyId ? upstreamLink(row.upstreamKeyId) : '-'),
  },
  { title: t('trace.model'), key: 'realModelName', ellipsis: { tooltip: true } },
  {
    title: t('trace.error'),
    key: 'errorCode',
    ellipsis: { tooltip: true },
    render: (row) => row.errorCode ?? '-',
  },
]);

onMounted(load);
</script>

<template>
  <NCard :title="t('trace.title')">
    <NSpace vertical size="large">
      <NSpace align="center">
        <NSelect
          v-model:value="sinceOption"
          :options="sinceOptions"
          style="width: 160px"
          @update:value="load"
        />
      </NSpace>

      <NSpin v-if="loading" />

      <NDataTable
        v-else-if="traces.length"
        :columns="columns"
        :data="traces"
        :bordered="false"
        size="small"
        :row-props="
          (row) => ({ style: { cursor: 'pointer' }, onClick: () => openDetail(row.requestTraceId) })
        "
      />

      <NEmpty v-else :description="t('trace.empty')" />
    </NSpace>
  </NCard>

  <NModal
    v-model:show="showDetail"
    :title="t('trace.detail')"
    preset="card"
    style="width: 900px; max-width: 90vw"
    :bordered="false"
    :segmented="{ content: true }"
  >
    <NSpin v-if="detailLoading" />
    <NSpace v-else-if="detail" vertical size="large">
      <NSpace v-if="detail.summary" justify="space-between">
        <NStatistic :label="t('trace.status')" :value="detail.summary.status" />
        <NStatistic :label="t('trace.latency')" :value="`${detail.summary.latencyMs} ms`" />
        <NStatistic :label="t('trace.tokens')" :value="tokens(detail.summary)" />
        <NStatistic :label="t('trace.attempts')" :value="detail.summary.attemptCount" />
      </NSpace>
      <NEmpty v-else :description="t('trace.noSummary')" />

      <NCard :title="t('trace.steps')" size="small">
        <NDataTable :columns="eventColumns" :data="detail.events" :bordered="false" size="small" />
      </NCard>

      <NSpace justify="end">
        <NButton @click="closeDetail">{{ t('common.close') }}</NButton>
      </NSpace>
    </NSpace>
  </NModal>
</template>
