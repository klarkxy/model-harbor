<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NGi,
  NGrid,
  NSpace,
  NStatistic,
  NTag,
  NText,
  type DataTableColumns,
} from 'naive-ui';
import {
  usageApi,
  traceApi,
  consumptionApi,
  type UsageBreakdownEntry,
  type UsageRecentRow,
  type UsageTargetBreakdownEntry,
  type UsageTotals,
  type UsageWindow,
  type TraceSummary,
  type DailyConsumptionSummary,
} from '../api/admin.js';

const { t } = useI18n();

const windowKind = ref<UsageWindow>('today');
const windowOptions = computed<Array<{ label: string; value: UsageWindow }>>(() => [
  { label: t('usage.windows.today'), value: 'today' },
  { label: t('usage.windows.24h'), value: '24h' },
  { label: t('usage.windows.7d'), value: '7d' },
]);

const totals = ref<UsageTotals | null>(null);
const apps = ref<UsageBreakdownEntry[]>([]);
const consumerKeys = ref<UsageBreakdownEntry[]>([]);
const upstreamKeys = ref<UsageBreakdownEntry[]>([]);
const targets = ref<UsageTargetBreakdownEntry[]>([]);
const recent = ref<UsageRecentRow[]>([]);
const traces = ref<TraceSummary[]>([]);
const consumption = ref<DailyConsumptionSummary[]>([]);
const loading = ref(false);
const lastError = ref<string | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  lastError.value = null;
  try {
    const w = windowKind.value;
    const [t2, a, c, u, tg, r, tr, co] = await Promise.all([
      usageApi.totals(w),
      usageApi.byApp(w),
      usageApi.byConsumerKey(w),
      usageApi.byUpstreamKey(w),
      usageApi.byTarget(w),
      usageApi.recent(100),
      traceApi.list(50),
      consumptionApi.daily({ limit: 30 }),
    ]);
    totals.value = t2;
    apps.value = a.items;
    consumerKeys.value = c.items;
    upstreamKeys.value = u.items;
    targets.value = tg.items;
    recent.value = r.items;
    traces.value = tr.items;
    consumption.value = co.items;
  } catch (err) {
    lastError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

const successRatePct = computed(() =>
  totals.value ? `${(totals.value.successRate * 100).toFixed(1)}%` : '—',
);
const stickyHitRatePct = computed(() =>
  totals.value ? `${(totals.value.stickyHitRate * 100).toFixed(1)}%` : '—',
);

const breakdownColumns = computed<DataTableColumns<UsageBreakdownEntry>>(() => [
  { title: t('usage.columns.name'), key: 'name', ellipsis: { tooltip: true } },
  {
    title: t('usage.columns.requests'),
    key: 'totalRequests',
    sorter: (a, b) => a.totalRequests - b.totalRequests,
    defaultSortOrder: 'descend',
    render: (row) => row.totalRequests.toLocaleString(),
  },
  {
    title: t('usage.columns.success'),
    key: 'successfulRequests',
    render: (row) => row.successfulRequests.toLocaleString(),
  },
  {
    title: t('usage.columns.errors'),
    key: 'failedRequests',
    render: (row) =>
      h(NTag, { size: 'small', type: row.failedRequests > 0 ? 'error' : 'default' }, () =>
        row.failedRequests.toLocaleString(),
      ),
  },
  {
    title: t('usage.columns.tokensInOut'),
    key: 'tokens',
    render: (row) => `${row.inputTokens.toLocaleString()} / ${row.outputTokens.toLocaleString()}`,
  },
]);

const targetColumns = computed<DataTableColumns<UsageTargetBreakdownEntry>>(() => [
  { title: t('usage.columns.name'), key: 'name', ellipsis: { tooltip: true } },
  {
    title: t('usage.columns.type'),
    key: 'targetType',
    width: 120,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.targetType === 'public_model' ? 'info' : 'success' },
        () =>
          row.targetType === 'public_model'
            ? t('common.targetType.publicModel')
            : t('common.targetType.modelGroup'),
      ),
  },
  {
    title: t('usage.columns.requests'),
    key: 'totalRequests',
    sorter: (a, b) => a.totalRequests - b.totalRequests,
    defaultSortOrder: 'descend',
    render: (row) => row.totalRequests.toLocaleString(),
  },
  {
    title: t('usage.columns.errors'),
    key: 'failedRequests',
    render: (row) => row.failedRequests.toLocaleString(),
  },
  {
    title: t('usage.columns.tokensInOut'),
    key: 'tokens',
    render: (row) => `${row.inputTokens.toLocaleString()} / ${row.outputTokens.toLocaleString()}`,
  },
]);

const recentColumns = computed<DataTableColumns<UsageRecentRow>>(() => [
  {
    title: t('usage.columns.time'),
    key: 'createdAt',
    width: 200,
    render: (row) => new Date(row.createdAt).toLocaleString(),
  },
  { title: t('usage.columns.app'), key: 'appId', width: 140, ellipsis: { tooltip: true } },
  {
    title: t('usage.columns.target'),
    key: 'requestedTargetName',
    width: 200,
    ellipsis: { tooltip: true },
  },
  {
    title: t('usage.columns.upstream'),
    key: 'realModelName',
    width: 200,
    ellipsis: { tooltip: true },
  },
  {
    title: t('usage.columns.status'),
    key: 'status',
    width: 110,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.status === 'success' ? 'success' : 'error' },
        () => row.status,
      ),
  },
  {
    title: t('usage.columns.latency'),
    key: 'latencyMs',
    width: 110,
    render: (row) => `${row.latencyMs} ms`,
  },
  {
    title: t('usage.columns.tokensInOutTotal'),
    key: 'tokens',
    width: 180,
    render: (row) =>
      row.totalTokens === null
        ? '—'
        : `${row.inputTokens ?? 0} / ${row.outputTokens ?? 0} / ${row.totalTokens}`,
  },
  {
    title: t('usage.columns.cacheTokens'),
    key: 'cacheTokens',
    width: 160,
    render: (row) =>
      row.cacheReadTokens === null && row.cacheWriteTokens === null
        ? '—'
        : `${row.cacheReadTokens ?? 0} / ${row.cacheWriteTokens ?? 0}`,
  },
  {
    title: t('usage.columns.error'),
    key: 'errorCode',
    width: 160,
    render: (row) => (row.errorCode ? row.errorCode : '—'),
  },
]);

const traceColumns = computed<DataTableColumns<TraceSummary>>(() => [
  {
    title: t('usage.columns.traceId'),
    key: 'requestTraceId',
    width: 240,
    ellipsis: { tooltip: true },
  },
  {
    title: t('usage.columns.target'),
    key: 'requestedTargetName',
    width: 180,
    ellipsis: { tooltip: true },
  },
  {
    title: t('usage.columns.sourceProtocol'),
    key: 'sourceProtocol',
    width: 120,
  },
  {
    title: t('usage.columns.outcome'),
    key: 'finalOutcome',
    width: 110,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.finalOutcome === 'success' ? 'success' : 'default' },
        () => row.finalOutcome ?? '—',
      ),
  },
  {
    title: t('usage.columns.time'),
    key: 'createdAt',
    width: 200,
    render: (row) => new Date(row.createdAt).toLocaleString(),
  },
]);

const consumptionColumns = computed<DataTableColumns<DailyConsumptionSummary>>(() => [
  {
    title: t('usage.columns.dayDate'),
    key: 'dayDate',
    width: 140,
  },
  {
    title: t('usage.columns.requests'),
    key: 'totalRequests',
    render: (row) => row.totalRequests.toLocaleString(),
  },
  {
    title: t('usage.columns.tokensInOut'),
    key: 'tokens',
    render: (row) =>
      `${row.totalInputTokens.toLocaleString()} / ${row.totalOutputTokens.toLocaleString()}`,
  },
  {
    title: t('usage.columns.cacheTokens'),
    key: 'cacheTokens',
    render: (row) =>
      `${row.totalCacheReadTokens.toLocaleString()} / ${row.totalCacheWriteTokens.toLocaleString()}`,
  },
]);
</script>

<template>
  <div class="usage-page">
    <NSpace vertical size="large">
      <NCard>
        <NSpace align="center" justify="space-between" style="margin-bottom: 12px">
          <NText strong>{{ t('usage.title') }}</NText>
          <NSpace>
            <NButton
              v-for="opt in windowOptions"
              :key="opt.value"
              :type="windowKind === opt.value ? 'primary' : 'default'"
              size="small"
              @click="((windowKind = opt.value), refresh())"
            >
              {{ opt.label }}
            </NButton>
            <NButton size="small" :loading="loading" @click="refresh">{{
              t('usage.refresh')
            }}</NButton>
          </NSpace>
        </NSpace>
        <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen">
          <NGi :span="1">
            <NCard>
              <NStatistic :label="t('usage.stats.requests')" :value="totals?.totalRequests ?? 0" />
            </NCard>
          </NGi>
          <NGi :span="1">
            <NCard>
              <NStatistic :label="t('usage.stats.successRate')" :value="successRatePct" />
            </NCard>
          </NGi>
          <NGi :span="1">
            <NCard>
              <NStatistic :label="t('usage.stats.stickyHitRate')" :value="stickyHitRatePct" />
            </NCard>
          </NGi>
          <NGi :span="1">
            <NCard>
              <NStatistic
                :label="t('usage.stats.tokens')"
                :value="`${(totals?.inputTokens ?? 0).toLocaleString()} / ${(totals?.outputTokens ?? 0).toLocaleString()}`"
              />
            </NCard>
          </NGi>
        </NGrid>
      </NCard>

      <NCard :title="t('usage.byApp')">
        <NDataTable
          :columns="breakdownColumns"
          :data="apps"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :empty="h(NEmpty, { description: t('usage.empty.app') })"
        />
      </NCard>

      <NCard :title="t('usage.byConsumerKey')">
        <NDataTable
          :columns="breakdownColumns"
          :data="consumerKeys"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :empty="h(NEmpty, { description: t('usage.empty.consumerKey') })"
        />
      </NCard>

      <NCard :title="t('usage.byUpstreamKey')">
        <NDataTable
          :columns="breakdownColumns"
          :data="upstreamKeys"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :empty="h(NEmpty, { description: t('usage.empty.upstreamKey') })"
        />
      </NCard>

      <NCard :title="t('usage.byTarget')">
        <NDataTable
          :columns="targetColumns"
          :data="targets"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => `${r.targetType}:${r.id}`"
          :empty="h(NEmpty, { description: t('usage.empty.target') })"
        />
      </NCard>

      <NCard :title="t('usage.recentRequests')">
        <NDataTable
          :columns="recentColumns"
          :data="recent"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :max-height="480"
          :empty="h(NEmpty, { description: t('usage.empty.recent') })"
        />
      </NCard>

      <NCard :title="t('usage.traces')">
        <NDataTable
          :columns="traceColumns"
          :data="traces"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.requestTraceId"
          :max-height="360"
          :empty="h(NEmpty, { description: t('usage.empty.traces') })"
        />
      </NCard>

      <NCard :title="t('usage.consumption')">
        <NDataTable
          :columns="consumptionColumns"
          :data="consumption"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.dayDate"
          :max-height="360"
          :empty="h(NEmpty, { description: t('usage.empty.consumption') })"
        />
      </NCard>

      <NText v-if="lastError" type="error">{{
        t('usage.loadError', { message: lastError })
      }}</NText>
    </NSpace>
  </div>
</template>

<style scoped>
.usage-page {
  max-width: 1280px;
  margin: 0 auto;
}
</style>
