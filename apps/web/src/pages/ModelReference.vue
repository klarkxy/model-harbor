<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NGrid,
  NGi,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import type { EChartsOption } from 'echarts';
import {
  modelReferenceApi,
  type ModelReferenceEntry,
  type ModelReferenceSyncStatus,
} from '../api/admin.js';
import EChart from '../components/EChart.vue';

type SortOrder = 'ascend' | 'descend' | false;
type SortState = { columnKey: string | number; order: SortOrder } | null;

const { t } = useI18n();
const message = useMessage();
const loading = ref(false);
const refreshing = ref(false);
const items = ref<ModelReferenceEntry[]>([]);
const sync = ref<ModelReferenceSyncStatus[]>([]);
const sortState = ref<SortState>(null);
const page = ref(1);
const pageSize = ref(20);
const query = ref('');
const selectedMetric = ref('all');
const selectedProvider = ref('all');

const preferredScoreKeys = [
  'intelligence',
  'chat',
  'knowledge',
  'math',
  'chinese',
  'reasoning',
  'coding',
  'agentic',
  'costEfficiency',
] as const;

function score(entry: ModelReferenceEntry, key: string): string {
  const value = entry.scores[key];
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

function scoreValue(entry: ModelReferenceEntry, key: string): number | null {
  const value = entry.scores[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sortValue(entry: ModelReferenceEntry, key: string | number): string | number | null {
  if (key === 'displayName') return entry.displayName || entry.normalizedModelName || null;
  if (key === 'provider') return entry.provider || null;
  if (typeof key === 'string') return scoreValue(entry, key);
  return null;
}

function compareSortValue(
  left: string | number | null,
  right: string | number | null,
  order: Exclude<SortOrder, false>,
): number {
  const leftEmpty = left === null || left === '';
  const rightEmpty = right === null || right === '';
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  const direction = order === 'ascend' ? 1 : -1;
  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * direction;
  }
  return String(left).localeCompare(String(right)) * direction;
}

function scoreColumn(key: string, width: number) {
  return {
    title: t(`modelReference.columns.${key}`),
    key,
    width,
    render: (row: ModelReferenceEntry) => score(row, key),
    sorter: true,
    sortOrder: sortState.value?.columnKey === key ? sortState.value.order : false,
  };
}

const scoreKeys = computed(() => {
  const keys = new Set<string>();
  for (const item of items.value) {
    for (const [key, value] of Object.entries(item.scores)) {
      if (typeof value === 'number' && Number.isFinite(value)) keys.add(key);
    }
  }
  const preferred = preferredScoreKeys.filter((key) => keys.has(key));
  const extra = [...keys]
    .filter((key) => !preferredScoreKeys.includes(key as (typeof preferredScoreKeys)[number]))
    .sort((a, b) => a.localeCompare(b));
  return [...preferred, ...extra];
});

const metricOptions = computed(() => [
  { label: t('modelReference.allMetrics'), value: 'all' },
  ...scoreKeys.value.map((key) => ({ label: t(`modelReference.columns.${key}`), value: key })),
]);

const providerOptions = computed(() => {
  const providers = [...new Set(items.value.map((item) => item.provider).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b));
  return [{ label: t('modelReference.allProviders'), value: 'all' }, ...providers.map((value) => ({ label: value, value }))];
});

const visibleScoreKeys = computed(() => {
  if (selectedMetric.value === 'all') return scoreKeys.value;
  return scoreKeys.value.includes(selectedMetric.value) ? [selectedMetric.value] : scoreKeys.value;
});

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase();
  return items.value.filter((item) => {
    if (selectedProvider.value !== 'all' && item.provider !== selectedProvider.value) return false;
    if (selectedMetric.value !== 'all' && scoreValue(item, selectedMetric.value) === null) return false;
    if (!q) return true;
    return [item.displayName, item.provider, item.normalizedModelName, item.sourceModelId]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(q));
  });
});

async function refreshList(): Promise<void> {
  loading.value = true;
  try {
    const res = await modelReferenceApi.list();
    items.value = res.items;
    sync.value = res.sync;
    page.value = 1;
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function refreshRemote(): Promise<void> {
  refreshing.value = true;
  try {
    const res = await modelReferenceApi.refresh(true);
    items.value = res.items.items;
    sync.value = res.items.sync;
    page.value = 1;
    message.success(t('modelReference.refreshed'));
  } catch (err) {
    message.error((err as Error).message);
    await refreshList();
  } finally {
    refreshing.value = false;
  }
}

onMounted(refreshList);

function onSorterUpdate(next: unknown): void {
  const state = Array.isArray(next) ? next[0] : next;
  if (!state || typeof state !== 'object') {
    sortState.value = null;
    return;
  }
  const candidate = state as { columnKey?: unknown; order?: unknown };
  sortState.value =
    (typeof candidate.columnKey === 'string' || typeof candidate.columnKey === 'number') &&
    (candidate.order === 'ascend' || candidate.order === 'descend')
      ? { columnKey: candidate.columnKey, order: candidate.order }
      : null;
  page.value = 1;
}

const sortedItems = computed(() => {
  const current = sortState.value;
  if (!current || !current.order) {
    if (selectedMetric.value !== 'all') {
      return [...filteredItems.value].sort((a, b) =>
        compareSortValue(scoreValue(a, selectedMetric.value), scoreValue(b, selectedMetric.value), 'descend'),
      );
    }
    return filteredItems.value;
  }
  const order = current.order;
  return [...filteredItems.value].sort((a, b) =>
    compareSortValue(sortValue(a, current.columnKey), sortValue(b, current.columnKey), order),
  );
});

const pagedItems = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedItems.value.slice(start, start + pageSize.value);
});

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: sortedItems.value.length,
  showSizePicker: true,
  pageSizes: [20, 50, 100],
  onUpdatePage: (nextPage: number) => {
    page.value = nextPage;
  },
  onUpdatePageSize: (nextPageSize: number) => {
    pageSize.value = nextPageSize;
    page.value = 1;
  },
}));

const tableScrollX = computed(() => Math.max(760, 470 + visibleScoreKeys.value.length * 104));

const columns = computed<DataTableColumns<ModelReferenceEntry>>(() => [
  {
    title: t('modelReference.columns.model'),
    key: 'displayName',
    width: 300,
    fixed: 'left',
    ellipsis: { tooltip: true },
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'displayName' ? sortState.value.order : false,
    render: (row) =>
      h('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0' }, [
        h(
          'a',
          {
            href: row.sourceUrl,
            target: '_blank',
            rel: 'noreferrer',
            style: 'color:inherit;font-weight:600;text-decoration:none',
          },
          row.displayName,
        ),
        h('span', { style: 'color:var(--text-color-3);font-size:12px' }, row.normalizedModelName),
      ]),
  },
  {
    title: t('modelReference.columns.provider'),
    key: 'provider',
    width: 170,
    render: (row) => row.provider ?? '-',
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'provider' ? sortState.value.order : false,
  },
  ...visibleScoreKeys.value.map((key) => scoreColumn(key, key === 'costEfficiency' ? 120 : 100)),
]);

function syncLabel(row: ModelReferenceSyncStatus): string {
  return row.lastError ? `${row.status}: ${row.lastError}` : row.status;
}

function resetFilters(): void {
  query.value = '';
  selectedMetric.value = 'all';
  selectedProvider.value = 'all';
  sortState.value = null;
  page.value = 1;
}

// ---------- Compare chart state ----------

const compareSelection = ref<string[]>([]);
const compareOptions = computed(() =>
  items.value.map((item) => ({
    label: item.displayName || item.normalizedModelName,
    value: item.id,
  })),
);
const compareModels = computed<ModelReferenceEntry[]>(() =>
  compareSelection.value
    .map((id) => items.value.find((item) => item.id === id))
    .filter((item): item is ModelReferenceEntry => item !== undefined),
);
watch(items, () => {
  compareSelection.value = [];
});

const compareScoreKeys = computed(() => {
  const set = new Set<string>();
  for (const m of compareModels.value) {
    for (const k of Object.keys(m.scores)) {
      const v = m.scores[k];
      if (typeof v === 'number' && Number.isFinite(v)) set.add(k);
    }
  }
  return preferredScoreKeys.filter((k) => set.has(k));
});

const radarOption = computed<EChartsOption>(() => {
  if (compareModels.value.length === 0) {
    return {
      title: {
        text: t('modelReference.compare.selectPlaceholder'),
        left: 'center',
        top: 'middle',
        textStyle: { fontSize: 13, fontWeight: 'normal' },
      },
      radar: { indicator: [] },
    };
  }
  const indicators = compareScoreKeys.value.map((k) => ({
    name: t(`modelReference.columns.${k}`),
    max: Math.max(
      10,
      ...compareModels.value.map((m) => {
        const v = m.scores[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      }),
    ),
  }));
  return {
    tooltip: {},
    legend: { data: compareModels.value.map((m) => m.displayName || m.normalizedModelName), top: 0 },
    radar: { indicator: indicators, radius: '65%' },
    series: [
      {
        type: 'radar',
        data: compareModels.value.map((m) => ({
          name: m.displayName || m.normalizedModelName,
          value: compareScoreKeys.value.map((k) => {
            const v = m.scores[k];
            return typeof v === 'number' && Number.isFinite(v) ? v : 0;
          }),
        })),
      },
    ],
  };
});

const metricCompareKey = computed(() => {
  if (selectedMetric.value !== 'all' && scoreKeys.value.includes(selectedMetric.value)) return selectedMetric.value;
  return scoreKeys.value.includes('intelligence') ? 'intelligence' : scoreKeys.value[0] ?? '';
});

const metricCompareOption = computed<EChartsOption>(() => {
  const key = metricCompareKey.value;
  const data = key
    ? compareModels.value
        .map((m) => ({
          name: m.displayName || m.normalizedModelName,
          value: scoreValue(m, key),
        }))
        .filter((d): d is { name: string; value: number } => d.value !== null)
    : [];
  if (data.length === 0) {
    return {
      title: {
        text: t('modelReference.compare.metric'),
        left: 'center',
        top: 'middle',
        textStyle: { fontSize: 13, fontWeight: 'normal' },
      },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
    };
  }
  const avg = data.reduce((s, d) => s + d.value, 0) / data.length;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 16, top: 24, bottom: 40 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.name),
      axisLabel: { rotate: 20, interval: 0 },
    },
    yAxis: { type: 'value', name: t(`modelReference.columns.${key}`) },
    series: [
      {
        type: 'bar',
        data: data.map((d) => d.value),
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        markLine: {
          data: [{ type: 'average', name: t('modelReference.compare.average') }],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="page">
    <NCard>
      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NSpace align="center" wrap>
          <NText strong>{{ t('modelReference.title') }}</NText>
          <NInput
            v-model:value="query"
            clearable
            :placeholder="t('modelReference.searchPlaceholder')"
            style="width: 260px"
            @update:value="page = 1"
          />
          <NSelect
            v-model:value="selectedMetric"
            :options="metricOptions"
            style="width: 180px"
            @update:value="page = 1"
          />
          <NSelect
            v-model:value="selectedProvider"
            :options="providerOptions"
            filterable
            style="width: 190px"
            @update:value="page = 1"
          />
          <NText depth="3">{{ t('modelReference.resultCount', { count: filteredItems.length }) }}</NText>
          <NSelect
            v-model:value="compareSelection"
            multiple
            filterable
            clearable
            :options="compareOptions"
            :placeholder="t('modelReference.compare.selectPlaceholder')"
            :max-tag-count="1"
            style="width: 280px"
          />
        </NSpace>
        <NSpace>
          <NButton secondary @click="resetFilters">{{ t('modelReference.reset') }}</NButton>
          <NButton type="primary" :loading="refreshing" @click="refreshRemote">
            {{ t('modelReference.refresh') }}
          </NButton>
        </NSpace>
      </NSpace>

      <NSpace v-if="sync.length > 0" style="margin-bottom: 12px">
        <NTag v-for="row in sync" :key="`${row.region}:${row.source}`" size="small">
          {{ syncLabel(row) }}
        </NTag>
      </NSpace>

      <NDataTable
        :columns="columns"
        :data="pagedItems"
        :loading="loading"
        :bordered="false"
        remote
        :single-line="false"
        :row-key="(row) => row.id"
        :scroll-x="tableScrollX"
        :pagination="pagination"
        :empty="h(NEmpty, { description: t('modelReference.empty') })"
        @update:sorter="onSorterUpdate"
      />

      <NCard v-if="compareModels.length > 0" size="small" style="margin-top: 16px">
        <NText strong style="display: block; margin-bottom: 8px">{{ t('modelReference.compare.title') }}</NText>
        <NGrid :cols="2" :x-gap="16" :y-gap="16" responsive="screen">
          <NGi :span="1">
            <NText depth="3" style="display: block; margin-bottom: 4px">
              {{ t('modelReference.compare.radar') }}
            </NText>
            <EChart :option="radarOption" :height="280" />
          </NGi>
          <NGi :span="1">
            <NText depth="3" style="display: block; margin-bottom: 4px">
              {{ t('modelReference.compare.metric') }}
            </NText>
            <EChart :option="metricCompareOption" :height="280" />
          </NGi>
        </NGrid>
      </NCard>
    </NCard>
  </div>
</template>

<style scoped>
.page {
  max-width: 1400px;
  margin: 0 auto;
}
</style>
