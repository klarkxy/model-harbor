<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  modelReferenceApi,
  type ModelReferenceEntry,
  type ModelReferenceSyncStatus,
} from '../api/admin.js';

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

const visibleScoreKeys = computed(() => {
  if (selectedMetric.value === 'all') return scoreKeys.value;
  return scoreKeys.value.includes(selectedMetric.value) ? [selectedMetric.value] : scoreKeys.value;
});

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase();
  return items.value.filter((item) => {
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
      h('div', { class: 'model-cell' }, [
        h('a', { href: row.sourceUrl, target: '_blank', rel: 'noreferrer' }, row.displayName),
        h('span', row.normalizedModelName),
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
  sortState.value = null;
  page.value = 1;
}
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
          <NText depth="3">{{ t('modelReference.resultCount', { count: filteredItems.length }) }}</NText>
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
    </NCard>
  </div>
</template>

<style scoped>
.page {
  max-width: 1400px;
  margin: 0 auto;
}

.model-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.model-cell a {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}

.model-cell span {
  color: var(--text-color-3);
  font-size: 12px;
}
</style>
