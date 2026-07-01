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
  NTabs,
  NTabPane,
  NCode,
  NText,
  NInput,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { getTraces, getTrace } from '../api/admin/traces.js';
import { listDebugContentLogs, getDebugContentLogByTraceId } from '../api/admin/debug-content.js';
import { listClients } from '../api/admin/clients.js';
import { listProviderAccounts } from '../api/admin/provider-accounts.js';
import { listEndpoints } from '../api/admin/endpoints.js';
import type {
  TraceSummaryContract,
  TraceDetailContract,
  TraceEventContract,
  DebugContentLogContract,
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

// Debug Content（v1 Phase 7：作为 Trace 页的临时 tab）
const debugLogs = ref<DebugContentLogContract[]>([]);
const debugLoading = ref(false);
const showDebugDetail = ref(false);
const debugDetail = ref<DebugContentLogContract | null>(null);

// v1 Phase 9：Trace 过滤器（客户端 computed 过滤，UX 维度的可见性收敛，
// 不调整后端 schema；v2 可加 server-side query params 减少网络返回）。
const filterClientId = ref<string | null>(null);
const filterProviderAccountId = ref<string | null>(null);
const filterEndpointId = ref<string | null>(null);
const filterModelName = ref<string | null>(null);
const clientOptions = ref<Array<{ label: string; value: string }>>([]);
const providerOptions = ref<Array<{ label: string; value: string }>>([]);
const endpointOptions = ref<Array<{ label: string; value: string }>>([]);
const modelOptions = ref<Array<{ label: string; value: string }>>([]);

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
    // traces 加载后重派生 model 选项（来自行内 requestedTargetName 集合）。
    const seen = new Set<string>();
    modelOptions.value = traces.value
      .map((row) => row.requestedTargetName)
      .filter((name) => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map((name) => ({ label: name, value: name }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function loadDebugLogs() {
  debugLoading.value = true;
  try {
    debugLogs.value = await listDebugContentLogs<DebugContentLogContract>(50);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    debugLoading.value = false;
  }
}

async function loadFilterOptions() {
  // 三个 list 调用并行；用作过滤器下拉。
  try {
    const [clients, accounts, endpoints] = await Promise.all([
      listClients().catch(() => []),
      listProviderAccounts().catch(() => []),
      listEndpoints().catch(() => []),
    ]);
    clientOptions.value = (clients as Array<{ id: string; name: string }>).map((c) => ({
      label: c.name,
      value: c.id,
    }));
    providerOptions.value = (accounts as Array<{ id: string; name: string }>).map((a) => ({
      label: a.name,
      value: a.id,
    }));
    endpointOptions.value = (endpoints as Array<{ id: string; baseUrl: string }>).map((e) => ({
      label: e.baseUrl,
      value: e.id,
    }));
    // Model 选项直接从已加载的 traces 派生（不需要额外 API）。
    const seen = new Set<string>();
    modelOptions.value = traces.value
      .map((row) => row.requestedTargetName)
      .filter((name) => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map((name) => ({ label: name, value: name }));
  } catch {
    // 过滤选项加载失败不阻塞主列表展示。
  }
}

const filteredTraces = computed(() => {
  return traces.value.filter((row) => {
    if (filterClientId.value && row.clientId !== filterClientId.value) return false;
    if (filterProviderAccountId.value && row.providerAccountId !== filterProviderAccountId.value)
      return false;
    if (filterEndpointId.value && row.endpointId !== filterEndpointId.value) return false;
    if (filterModelName.value && row.requestedTargetName !== filterModelName.value) return false;
    return true;
  });
});

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

async function openDebugDetail(traceId: string | null) {
  if (!traceId) {
    message.warning(t('trace.noTraceId'));
    return;
  }
  showDebugDetail.value = true;
  try {
    debugDetail.value = await getDebugContentLogByTraceId<DebugContentLogContract>(traceId);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
    showDebugDetail.value = false;
  }
}

function closeDebugDetail() {
  showDebugDetail.value = false;
  debugDetail.value = null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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
  const routeName = 'models';
  return linkButton(row.requestedTargetName, () => {
    void router.push({ name: routeName, query: { highlight: row.resolvedTargetId! } });
  });
}

function upstreamLink(providerAccountId: string) {
  return linkButton(providerAccountId, () => {
    void router.push({ name: 'provider-accounts', query: { highlight: providerAccountId } });
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
    key: 'providerAccountId',
    ellipsis: { tooltip: true },
    render: (row) => upstreamLink(row.providerAccountId),
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
    key: 'providerAccountId',
    ellipsis: { tooltip: true },
    render: (row) => (row.providerAccountId ? upstreamLink(row.providerAccountId) : '-'),
  },
  { title: t('trace.model'), key: 'realModelName', ellipsis: { tooltip: true } },
  {
    title: t('trace.error'),
    key: 'errorCode',
    ellipsis: { tooltip: true },
    render: (row) => row.errorCode ?? '-',
  },
]);

const debugLogColumns: DataTableColumns<DebugContentLogContract> = [
  {
    title: t('trace.time'),
    key: 'createdAt',
    width: 170,
    render: (row) => formatTime(row.createdAt),
  },
  { title: t('trace.id'), key: 'requestTraceId', ellipsis: { tooltip: true }, width: 240 },
  { title: t('trace.tokens'), key: 'totalTokens', width: 140, render: (row) => tokens(row) },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 90,
    render: (row) =>
      h(
        NButton,
        {
          size: 'small',
          text: true,
          type: 'primary',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            void openDebugDetail(row.requestTraceId);
          },
        },
        { default: () => t('trace.view') },
      ),
  },
];

onMounted(() => {
  void load();
  void loadDebugLogs();
  void loadFilterOptions();
});
</script>

<template>
  <NCard :title="t('trace.title')">
    <NTabs type="line" animated>
      <NTabPane name="traces" :tab="t('trace.tabTraces')">
        <NSpace vertical size="large">
          <NSpace align="center" :wrap-item="false">
            <NSelect
              v-model:value="sinceOption"
              :options="sinceOptions"
              style="width: 160px"
              @update:value="load"
            />
            <NSelect
              v-model:value="filterClientId"
              :options="clientOptions"
              :placeholder="t('trace.filterClient')"
              clearable
              style="width: 180px"
            />
            <NSelect
              v-model:value="filterProviderAccountId"
              :options="providerOptions"
              :placeholder="t('trace.filterProvider')"
              clearable
              style="width: 180px"
            />
            <NSelect
              v-model:value="filterEndpointId"
              :options="endpointOptions"
              :placeholder="t('trace.filterEndpoint')"
              clearable
              style="width: 180px"
            />
            <NSelect
              v-model:value="filterModelName"
              :options="modelOptions"
              :placeholder="t('trace.filterModel')"
              clearable
              style="width: 180px"
            />
          </NSpace>

          <NSpin v-if="loading" />

          <NDataTable
            v-else-if="filteredTraces.length"
            :columns="columns"
            :data="filteredTraces"
            :bordered="false"
            size="small"
            :row-props="
              (row) => ({
                style: { cursor: 'pointer' },
                onClick: () => openDetail(row.requestTraceId),
              })
            "
          />

          <NEmpty v-else :description="t('trace.empty')" />
        </NSpace>
      </NTabPane>

      <NTabPane name="debug" :tab="t('trace.tabDebugContent')">
        <NSpace vertical size="large">
          <NText depth="3">{{ t('trace.debugContentHint') }}</NText>
          <NSpin v-if="debugLoading" />
          <NDataTable
            v-else-if="debugLogs.length"
            :columns="debugLogColumns"
            :data="debugLogs"
            :bordered="false"
            size="small"
            :row-key="(row) => row.requestTraceId"
          />
          <NEmpty v-else :description="t('trace.debugEmpty')" />
        </NSpace>
      </NTabPane>
    </NTabs>
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

  <NModal
    v-model:show="showDebugDetail"
    :title="t('trace.debugContent')"
    preset="card"
    style="width: 900px; max-width: 90vw"
    :bordered="false"
    :segmented="{ content: true }"
  >
    <NSpace v-if="debugDetail" vertical size="large">
      <NSpace>
        <NText strong>{{ t('trace.id') }}: </NText>
        <NText code>{{ debugDetail.requestTraceId }}</NText>
      </NSpace>
      <NCode :code="JSON.stringify(debugDetail, null, 2)" language="json" />
      <NSpace justify="end">
        <NButton @click="closeDebugDetail">{{ t('common.close') }}</NButton>
      </NSpace>
    </NSpace>
  </NModal>
</template>
