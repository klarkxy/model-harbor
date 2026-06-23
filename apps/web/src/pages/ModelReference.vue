<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NInput,
  NModal,
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

const RELE_REPO_URL = 'https://github.com/jeinlee1991/chinese-llm-benchmark';
const RELE_LEADERBOARD_URL = 'https://github.com/jeinlee1991/chinese-llm-benchmark/blob/main/leaderboard/alldata.md';
const RELE_ATTRIBUTION_KEY = 'modelharbor.rele.attributionAcknowledged';

const { t, locale } = useI18n();
const message = useMessage();
const loading = ref(false);
const refreshing = ref(false);
const items = ref<ModelReferenceEntry[]>([]);
const sync = ref<ModelReferenceSyncStatus[]>([]);
const sortState = ref<SortState>(null);
const query = ref('');
const selectedMetric = ref('all');
const selectedProvider = ref('all');
const attributionModalVisible = ref(false);

const preferredScoreKeys = [
  '总分',
  '教育',
  '医疗与心理健康',
  '金融',
  '法律与行政公务',
  '推理与数学计算',
  '语言与指令遵从',
  'agent与工具调用',
  'coding',
] as const;

function score(entry: ModelReferenceEntry, key: string): string {
  const value = entry.scores[key];
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

function scoreValue(entry: ModelReferenceEntry, key: string): number | null {
  const value = entry.scores[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function priceDisplay(entry: ModelReferenceEntry): string | null {
  const value = entry.price?.display;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function priceCnyPerMTok(entry: ModelReferenceEntry): number | null {
  const value = entry.price?.cnyPerMTok;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sortValue(entry: ModelReferenceEntry, key: string | number): string | number | null {
  if (key === 'displayName') return entry.displayName || entry.normalizedModelName || null;
  if (key === 'provider') return entry.provider || null;
  if (key === 'rank') return entry.rank;
  if (key === 'priceDisplay') return priceCnyPerMTok(entry) ?? priceDisplay(entry);
  if (key === 'rawUnit') return entry.rawUnit;
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

function shouldShowAttribution(): boolean {
  try {
    return window.localStorage.getItem(RELE_ATTRIBUTION_KEY) !== 'ack';
  } catch {
    return true;
  }
}

function acknowledgeAttribution(): void {
  try {
    window.localStorage.setItem(RELE_ATTRIBUTION_KEY, 'ack');
  } catch {
    /* storage may be disabled; the modal will simply reappear next visit */
  }
  attributionModalVisible.value = false;
}

function maybeShowAttribution(): void {
  if (shouldShowAttribution() && items.value.length > 0) {
    attributionModalVisible.value = true;
  }
}

async function refreshList(): Promise<void> {
  loading.value = true;
  try {
    const res = await modelReferenceApi.list();
    items.value = res.items;
    sync.value = res.sync;
    maybeShowAttribution();
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
    message.success(t('modelReference.refreshed'));
    maybeShowAttribution();
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

const pagination = computed(() => ({
  showSizePicker: true,
  pageSizes: [20, 50, 100],
}));

const tableScrollX = computed(() => {
  // Fixed columns: model(300) + provider(130) + rank(80) + priceDisplay(110) + rawUnit(160)
  // = 780 plus 96 per score column.
  const fixed = 780;
  return Math.max(960, fixed + visibleScoreKeys.value.length * 96);
});

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
    width: 130,
    render: (row) => row.provider ?? '-',
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'provider' ? sortState.value.order : false,
  },
  {
    title: t('modelReference.columns.rank'),
    key: 'rank',
    width: 80,
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'rank' ? sortState.value.order : false,
    render: (row) => (typeof row.rank === 'number' ? `#${row.rank}` : '-'),
  },
  {
    title: t('modelReference.columns.priceDisplay'),
    key: 'priceDisplay',
    width: 110,
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'priceDisplay' ? sortState.value.order : false,
    render: (row) => priceDisplay(row) ?? '-',
  },
  ...visibleScoreKeys.value.map((key) => scoreColumn(key, 96)),
  {
    title: t('modelReference.columns.rawUnit'),
    key: 'rawUnit',
    width: 160,
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'rawUnit' ? sortState.value.order : false,
    render: (row) => row.rawUnit ?? '-',
  },
]);

function syncLabel(row: ModelReferenceSyncStatus): string {
  return row.lastError ? `${row.status}: ${row.lastError}` : row.status;
}

function resetFilters(): void {
  query.value = '';
  selectedMetric.value = 'all';
  selectedProvider.value = 'all';
  sortState.value = null;
}
</script>

<template>
  <div class="page">
    <NCard>
      <NAlert type="info" :show-icon="true" style="margin-bottom: 16px" closable>
        <template #header>{{ t('modelReference.attribution.title') }}</template>
        {{ t('modelReference.attribution.body') }}
        <a :href="RELE_REPO_URL" target="_blank" rel="noreferrer">{{ RELE_REPO_URL }}</a>
      </NAlert>

      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NSpace align="center" wrap>
          <NText strong>{{ t('modelReference.title') }}</NText>
          <NInput
            v-model:value="query"
            clearable
            :placeholder="t('modelReference.searchPlaceholder')"
            style="width: 260px"
          />
          <NSelect
            v-model:value="selectedMetric"
            :options="metricOptions"
            style="width: 180px"
          />
          <NSelect
            v-model:value="selectedProvider"
            :options="providerOptions"
            filterable
            style="width: 190px"
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
        :data="sortedItems"
        :loading="loading"
        :bordered="false"
        :single-line="false"
        :row-key="(row) => row.id"
        :scroll-x="tableScrollX"
        :pagination="pagination"
        :empty="h(NEmpty, { description: t('modelReference.empty') })"
        @update:sorter="onSorterUpdate"
      />
    </NCard>

    <NModal
      v-model:show="attributionModalVisible"
      preset="card"
      :title="t('modelReference.attribution.modalTitle')"
      style="max-width: 640px"
      :mask-closable="false"
      :closable="true"
      @close="acknowledgeAttribution"
    >
      <p style="margin-top: 0">{{ t('modelReference.attribution.body') }}</p>
      <p>
        <a :href="RELE_REPO_URL" target="_blank" rel="noreferrer">{{ RELE_REPO_URL }}</a>
      </p>
      <p style="margin-bottom: 0; color: var(--text-color-3); font-size: 13px">
        {{ t('modelReference.attribution.cite', { repo: RELE_REPO_URL, leaderboard: RELE_LEADERBOARD_URL }) }}
      </p>
      <template #footer>
        <NSpace justify="end">
          <NButton type="primary" @click="acknowledgeAttribution">
            {{ t('modelReference.attribution.acknowledge') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.page {
  max-width: 1400px;
  margin: 0 auto;
}
</style>
