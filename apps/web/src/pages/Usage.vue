<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NSpace,
  NStatistic,
  NDataTable,
  NSelect,
  NTag,
  NSpin,
  NEmpty,
  NDatePicker,
  NModal,
  NButton,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { getUsageDashboard, getDailyConsumptionStats } from '../api/admin/usage.js';
import { getStickyOverview } from '../api/admin/resilience.js';
import type { StickyBindingContract, StickySessionContract } from '@manageyourllm/contracts';
import type {
  UsageDashboardContract,
  UsageRecordContract,
  UsageGroupItemContract,
  DailyConsumptionStatContract,
} from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const loading = ref(false);
const dashboard = ref<UsageDashboardContract | null>(null);
const sinceOption = ref<'today' | 'last7' | 'last30'>('today');

const dailyLoading = ref(false);
const dailyStats = ref<DailyConsumptionStatContract[]>([]);
const dailyDateTs = ref<number>(Date.now());

const stickyModal = ref<{
  show: boolean;
  loading: boolean;
  bindings: StickyBindingContract[];
  sessions: StickySessionContract[];
}>({
  show: false,
  loading: false,
  bindings: [],
  sessions: [],
});

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
    dashboard.value = await getUsageDashboard(sinceIso.value);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function loadDaily() {
  dailyLoading.value = true;
  try {
    const date = formatDayDate(new Date(dailyDateTs.value));
    dailyStats.value = await getDailyConsumptionStats(date);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    dailyLoading.value = false;
  }
}

async function openStickyModal() {
  stickyModal.value = { show: true, loading: true, bindings: [], sessions: [] };
  try {
    const overview = await getStickyOverview();
    stickyModal.value.bindings = overview.bindings;
    stickyModal.value.sessions = overview.sessions;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    stickyModal.value.loading = false;
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

onMounted(() => {
  load();
  loadDaily();
});

function formatDayDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function costLabel(amount: number | null, currency: string | null): string {
  if (amount == null || currency == null) return '-';
  return `${(amount / 1_000_000).toFixed(4)} ${currency}`;
}

function tokens(row: {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}): string {
  return `${row.inputTokens ?? 0} / ${row.outputTokens ?? 0} / ${row.totalTokens ?? 0}`;
}

const groupColumns = computed<DataTableColumns<UsageGroupItemContract>>(() => [
  { title: t('usage.name'), key: 'name' },
  { title: t('usage.requestCount'), key: 'requestCount' },
  { title: t('usage.tokens'), key: 'tokens', render: (row) => tokens(row) },
  {
    title: t('usage.cost'),
    key: 'cost',
    render: (row) => costLabel(row.costAmount, row.costCurrency),
  },
  { title: t('usage.unpricedCount'), key: 'unpricedCount' },
]);

const recentColumns = computed<DataTableColumns<UsageRecordContract>>(() => [
  { title: t('usage.time'), key: 'createdAt', width: 180 },
  { title: t('usage.target'), key: 'requestedTargetName' },
  { title: t('usage.upstream'), key: 'providerAccountId' },
  { title: t('usage.model'), key: 'realModelName' },
  {
    title: t('usage.status'),
    key: 'status',
    render(row) {
      return h(
        NTag,
        { type: row.status === 'success' ? 'success' : 'error', size: 'small' },
        { default: () => (row.status === 'success' ? t('usage.success') : t('usage.error')) },
      );
    },
  },
  { title: t('usage.latency'), key: 'latencyMs', render: (row) => `${row.latencyMs} ms` },
  { title: t('usage.tokens'), key: 'tokens', render: (row) => tokens(row) },
  {
    title: t('usage.cost'),
    key: 'cost',
    render: (row) => costLabel(row.costAmount, row.costCurrency),
  },
]);

const dailyColumns = computed<DataTableColumns<DailyConsumptionStatContract>>(() => [
  { title: t('usage.upstream'), key: 'providerAccountId' },
  { title: t('usage.model'), key: 'realModelName' },
  { title: t('usage.requestCount'), key: 'requestCount' },
  { title: t('usage.tokens'), key: 'tokens', render: (row) => tokens(row) },
  {
    title: t('usage.avgLatency'),
    key: 'avgLatencyMs',
    render: (row) => `${row.avgLatencyMs} ms`,
  },
  {
    title: t('usage.cost'),
    key: 'cost',
    render: (row) => costLabel(row.totalCostAmount, row.costCurrency),
  },
]);
</script>

<template>
  <NCard :title="t('usage.title')">
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

      <template v-else-if="dashboard">
        <NSpace justify="space-between">
          <NStatistic :label="t('usage.requestCount')" :value="dashboard.summary.requestCount" />
          <NStatistic
            :label="t('usage.successRate')"
            :value="percent(dashboard.summary.successRate)"
          />
          <NStatistic :label="t('usage.inputTokens')" :value="dashboard.summary.inputTokens" />
          <NStatistic :label="t('usage.outputTokens')" :value="dashboard.summary.outputTokens" />
          <NStatistic :label="t('usage.totalTokens')" :value="dashboard.summary.totalTokens" />
          <NStatistic
            :label="t('usage.stickyHitRate')"
            :value="percent(dashboard.summary.stickyHitRate)"
          />
          <NButton size="small" @click="openStickyModal">{{ t('usage.viewSticky') }}</NButton>
          <NStatistic
            :label="t('usage.cost')"
            :value="costLabel(dashboard.summary.costAmount, dashboard.summary.costCurrency)"
          />
          <NStatistic :label="t('usage.unpricedCount')" :value="dashboard.summary.unpricedCount" />
        </NSpace>

        <NCard :title="t('usage.byClient')" size="small">
          <NDataTable
            :columns="groupColumns"
            :data="dashboard.groups.byClient"
            :bordered="false"
            size="small"
          />
        </NCard>

        <NCard :title="t('usage.byClientKey')" size="small">
          <NDataTable
            :columns="groupColumns"
            :data="dashboard.groups.byClientKey"
            :bordered="false"
            size="small"
          />
        </NCard>

        <NCard :title="t('usage.byProviderAccount')" size="small">
          <NDataTable
            :columns="groupColumns"
            :data="dashboard.groups.byProviderAccount"
            :bordered="false"
            size="small"
          />
        </NCard>

        <NCard :title="t('usage.byTarget')" size="small">
          <NDataTable
            :columns="groupColumns"
            :data="dashboard.groups.byTarget"
            :bordered="false"
            size="small"
          />
        </NCard>

        <NCard :title="t('usage.recentRequests')" size="small">
          <NDataTable
            :columns="recentColumns"
            :data="dashboard.recent"
            :bordered="false"
            size="small"
          />
        </NCard>
      </template>

      <NEmpty v-else :description="t('usage.empty')" />

      <NCard :title="t('usage.dailyConsumptionStats')" size="small">
        <NSpace align="center" style="margin-bottom: 12px">
          <NDatePicker v-model:value="dailyDateTs" type="date" @update:value="loadDaily" />
        </NSpace>
        <NSpin v-if="dailyLoading" />
        <NDataTable
          v-else
          :columns="dailyColumns"
          :data="dailyStats"
          :bordered="false"
          size="small"
        />
      </NCard>
    </NSpace>

    <NModal
      v-model:show="stickyModal.show"
      :title="t('sticky.title')"
      preset="card"
      style="width: 900px; max-width: 90vw"
    >
      <NSpin v-if="stickyModal.loading" />
      <NSpace v-else vertical size="large">
        <NCard :title="t('sticky.bindings')" size="small">
          <NDataTable
            v-if="stickyModal.bindings.length"
            :columns="[
              { title: t('sticky.clientKey'), key: 'clientKeyId' },
              { title: t('sticky.target'), key: 'requestedTargetName' },
              { title: t('sticky.upstream'), key: 'providerAccountId' },
              { title: t('sticky.model'), key: 'realModelName' },
              { title: t('sticky.hitCount'), key: 'hitCount' },
              {
                title: t('sticky.lastUsedAt'),
                key: 'lastUsedAt',
                render: (row) => formatTime(row.lastUsedAt),
              },
              {
                title: t('sticky.expiresAt'),
                key: 'expiresAt',
                render: (row) => formatTime(row.expiresAt),
              },
            ]"
            :data="stickyModal.bindings"
            :bordered="false"
            size="small"
            :row-key="(row) => row.id"
          />
          <NEmpty v-else :description="t('sticky.noBindings')" />
        </NCard>
        <NCard :title="t('sticky.sessions')" size="small">
          <NDataTable
            v-if="stickyModal.sessions.length"
            :columns="[
              { title: t('sticky.clientKey'), key: 'clientKeyId' },
              { title: t('sticky.target'), key: 'requestedTargetName' },
              { title: t('sticky.upstream'), key: 'providerAccountId' },
              { title: t('sticky.model'), key: 'realModelName' },
              { title: t('sticky.hitCount'), key: 'hitCount' },
              { title: t('sticky.ttlMs'), key: 'ttlMs' },
              {
                title: t('sticky.lastUsedAt'),
                key: 'lastUsedAt',
                render: (row) => formatTime(row.lastUsedAt),
              },
              {
                title: t('sticky.expiresAt'),
                key: 'expiresAt',
                render: (row) => formatTime(row.expiresAt),
              },
            ]"
            :data="stickyModal.sessions"
            :bordered="false"
            size="small"
            :row-key="(row) => row.id"
          />
          <NEmpty v-else :description="t('sticky.noSessions')" />
        </NCard>
        <NSpace justify="end">
          <NButton @click="stickyModal.show = false">{{ t('common.close') }}</NButton>
        </NSpace>
      </NSpace>
    </NModal>
  </NCard>
</template>
