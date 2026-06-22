<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
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

type ReferenceRegion = 'international' | 'domestic';
type SortOrder = 'ascend' | 'descend' | false;
type SortState = { columnKey: string | number; order: SortOrder } | null;

const { t } = useI18n();
const message = useMessage();
const region = ref<ReferenceRegion>('international');
const loading = ref(false);
const refreshing = ref(false);
const items = ref<ModelReferenceEntry[]>([]);
const sync = ref<ModelReferenceSyncStatus[]>([]);
const sortState = ref<SortState>(null);
const page = ref(1);
const pageSize = ref(20);

const regionOptions = computed(() => [
  { label: t('modelGroups.drawer.regions.international'), value: 'international' },
  { label: t('modelGroups.drawer.regions.domestic'), value: 'domestic' },
]);

function fmtDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '-';
}

function score(entry: ModelReferenceEntry, key: string): string {
  const value = entry.scores[key];
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

function scoreValue(entry: ModelReferenceEntry, key: string): number | null {
  const value = entry.scores[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function priceValue(entry: ModelReferenceEntry): number | null {
  const price = entry.price;
  const blended = price.blendedUsdPerMTok ?? price.blendedCnyPerMTok;
  if (typeof blended === 'number' && Number.isFinite(blended)) return blended;
  const input = price.inputUsdPerMTok ?? price.inputCnyPerMTok;
  const output = price.outputUsdPerMTok ?? price.outputCnyPerMTok;
  if (typeof input === 'number' && typeof output === 'number') return (input + output) / 2;
  if (typeof input === 'number') return input;
  if (typeof output === 'number') return output;
  return null;
}

function sortValue(entry: ModelReferenceEntry, key: string | number): string | number | null {
  if (key === 'displayName') return entry.displayName || entry.normalizedModelName || null;
  if (key === 'provider') return entry.provider || null;
  if (key === 'price') return priceValue(entry);
  if (key === 'contextWindow') return entry.contextWindow;
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

function fmtPrice(entry: ModelReferenceEntry): string {
  const price = entry.price;
  const blended =
    typeof price.blendedUsdPerMTok === 'number'
      ? `$${price.blendedUsdPerMTok.toFixed(2)}`
      : typeof price.blendedCnyPerMTok === 'number'
        ? `¥${price.blendedCnyPerMTok.toFixed(2)}`
        : null;
  if (blended) return `${blended}/M`;
  const input =
    typeof price.inputUsdPerMTok === 'number'
      ? `$${price.inputUsdPerMTok.toFixed(2)}`
      : typeof price.inputCnyPerMTok === 'number'
        ? `¥${price.inputCnyPerMTok.toFixed(2)}`
        : null;
  const output =
    typeof price.outputUsdPerMTok === 'number'
      ? `$${price.outputUsdPerMTok.toFixed(2)}`
      : typeof price.outputCnyPerMTok === 'number'
        ? `¥${price.outputCnyPerMTok.toFixed(2)}`
        : null;
  return input || output ? `${input ?? '-'}/${output ?? '-'}` : '-';
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

async function refreshList(): Promise<void> {
  loading.value = true;
  try {
    const res = await modelReferenceApi.list(region.value);
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
    const res = await modelReferenceApi.refresh(region.value, true);
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
  if (!current || !current.order) return items.value;
  const order = current.order;
  return [...items.value].sort((a, b) =>
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

const columns = computed<DataTableColumns<ModelReferenceEntry>>(() => [
  {
    title: t('modelReference.columns.model'),
    key: 'displayName',
    width: 260,
    fixed: 'left',
    ellipsis: { tooltip: true },
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'displayName' ? sortState.value.order : false,
  },
  {
    title: t('modelReference.columns.provider'),
    key: 'provider',
    width: 140,
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'provider' ? sortState.value.order : false,
  },
  scoreColumn('intelligence', 100),
  scoreColumn('reasoning', 100),
  scoreColumn('coding', 90),
  scoreColumn('agentic', 90),
  {
    title: t('modelReference.columns.price'),
    key: 'price',
    width: 130,
    render: fmtPrice,
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'price' ? sortState.value.order : false,
  },
  {
    title: t('modelReference.columns.context'),
    key: 'contextWindow',
    width: 110,
    render: (row) => (row.contextWindow ? row.contextWindow.toLocaleString() : '-'),
    sorter: true,
    sortOrder: sortState.value?.columnKey === 'contextWindow' ? sortState.value.order : false,
  },
]);
</script>

<template>
  <div class="page">
    <NCard>
      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NSpace align="center">
          <NText strong>{{ t('modelReference.title') }}</NText>
          <NSelect
            v-model:value="region"
            :options="regionOptions"
            style="width: 150px"
            @update:value="refreshList"
          />
        </NSpace>
        <NButton type="primary" :loading="refreshing" @click="refreshRemote">
          {{ t('modelReference.refresh') }}
        </NButton>
      </NSpace>

      <NSpace v-if="sync.length > 0" style="margin-bottom: 12px">
        <NTag v-for="row in sync" :key="`${row.region}:${row.source}`" size="small">
          {{ row.source }} · {{ row.status }} · {{ fmtDate(row.lastRefreshAt) }}
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
        :scroll-x="1280"
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
</style>
