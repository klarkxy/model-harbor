<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NSpace,
  NButton,
  NSelect,
  NDataTable,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NSwitch,
  NInput,
  NAlert,
  NText,
  type DataTableColumns,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listModelReferenceEntries,
  getModelReferenceSyncStatus,
  refreshModelReference,
  recommendModelReferenceDraft,
} from '../api/admin/model-reference.js';
import { listUpstreamKeys } from '../api/admin/upstream-keys.js';
import { createPublicModel } from '../api/admin/public-models.js';
import { createModelGroup } from '../api/admin/model-groups.js';
import type { ModelReferenceEntryContract } from '@manageyourllm/contracts';

const { t } = useI18n();
const message = useMessage();

const loading = ref(false);
const refreshing = ref(false);
const entries = ref<ModelReferenceEntryContract[]>([]);
const syncStatus = ref<ModelReferenceEntryContract | null>(null);
const selectedRowKeys = ref<string[]>([]);
const upstreamKeys = ref<Array<{ label: string; value: string }>>([]);

const providerFilter = ref<string | null>(null);
const sortBy = ref<'score' | 'rank' | 'votes' | 'fetchedAt'>('score');
const order = ref<'asc' | 'desc'>('desc');

const showRecommend = ref(false);
const recommendLoading = ref(false);
const recommendForm = ref({
  upstreamKeyId: '',
  createGroup: false,
  groupName: '',
});
const recommendDraft = ref<{
  publicModels: Array<{
    name: string;
    displayName: string;
    description: string;
    candidates: Array<{
      upstreamKeyId: string;
      realModelName: string;
      priority: number;
      weight: number;
      enabled: boolean;
    }>;
    nameConflict: boolean;
  }>;
  modelGroup?: {
    name: string;
    displayName: string;
    description: string;
    members: Array<{
      publicModelName: string;
      priority: number;
      weight: number;
      enabled: boolean;
    }>;
    nameConflict: boolean;
  };
  conflicts: string[];
} | null>(null);

const providerOptions = computed(() => {
  const providers = new Set<string>();
  for (const e of entries.value) {
    if (e.provider) providers.add(e.provider);
  }
  return [
    { label: t('modelReference.allProviders'), value: '' },
    ...Array.from(providers).map((p) => ({ label: p, value: p })),
  ];
});

const sortOptions = computed(() => [
  { label: t('modelReference.sort.scoreDesc'), value: 'score:desc' },
  { label: t('modelReference.sort.scoreAsc'), value: 'score:asc' },
  { label: t('modelReference.sort.rankAsc'), value: 'rank:asc' },
  { label: t('modelReference.sort.votesDesc'), value: 'votes:desc' },
]);

const selectedSort = computed({
  get: () => `${sortBy.value}:${order.value}`,
  set: (value: string) => {
    const [s, o] = value.split(':') as [typeof sortBy.value, typeof order.value];
    sortBy.value = s;
    order.value = o;
    load();
  },
});

const columns = computed<DataTableColumns<ModelReferenceEntryContract>>(() => [
  { type: 'selection', options: ['all', 'none'] },
  {
    title: t('modelReference.rank'),
    key: 'rank',
    width: 80,
    render: (row: ModelReferenceEntryContract) => row.scoresJson.rank ?? '-',
  },
  { title: t('modelReference.model'), key: 'displayName', ellipsis: { tooltip: true } },
  { title: t('modelReference.provider'), key: 'provider', width: 140 },
  {
    title: t('modelReference.score'),
    key: 'score',
    width: 120,
    render: (row: ModelReferenceEntryContract) => row.scoresJson.arenaElo ?? '-',
  },
  {
    title: t('modelReference.votes'),
    key: 'votes',
    width: 120,
    render: (row: ModelReferenceEntryContract) => row.scoresJson.votes ?? '-',
  },
  {
    title: t('modelReference.license'),
    key: 'license',
    width: 120,
    render: (row: ModelReferenceEntryContract) => (row.rawJson as Record<string, string>)?.license ?? '-',
  },
]);

async function load() {
  loading.value = true;
  try {
    const query: Record<string, string> = {
      sortBy: sortBy.value,
      order: order.value,
    };
    if (providerFilter.value) query.provider = providerFilter.value;
    const [data, status, keys] = await Promise.all([
      listModelReferenceEntries(query),
      getModelReferenceSyncStatus(),
      listUpstreamKeys(),
    ]);
    entries.value = data;
    syncStatus.value = status as unknown as ModelReferenceEntryContract;
    upstreamKeys.value = keys.map((k) => ({ label: k.name, value: k.id }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function onRefresh() {
  refreshing.value = true;
  try {
    const result = await refreshModelReference({ force: true });
    if (result.success) {
      message.success(t('modelReference.refreshed'));
      await load();
    } else {
      message.error(result.error ?? t('modelReference.refreshFailed'));
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('modelReference.refreshFailed'));
  } finally {
    refreshing.value = false;
  }
}

function onRecommend() {
  if (selectedRowKeys.value.length === 0) {
    message.warning(t('modelReference.selectEntries'));
    return;
  }
  recommendForm.value = { upstreamKeyId: '', createGroup: false, groupName: '' };
  recommendDraft.value = null;
  showRecommend.value = true;
}

async function onGenerateDraft() {
  recommendLoading.value = true;
  try {
    recommendDraft.value = await recommendModelReferenceDraft({
      entryIds: selectedRowKeys.value,
      upstreamKeyId: recommendForm.value.upstreamKeyId || undefined,
      createGroup: recommendForm.value.createGroup,
      groupName: recommendForm.value.groupName || undefined,
    });
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    recommendLoading.value = false;
  }
}

async function onApplyDraft() {
  if (!recommendDraft.value) return;
  recommendLoading.value = true;
  try {
    const created: Record<string, string> = {};
    for (const pm of recommendDraft.value.publicModels) {
      if (pm.nameConflict) continue;
      const result = await createPublicModel({
        name: pm.name,
        displayName: pm.displayName,
        description: pm.description,
        enabled: true,
        candidates: pm.candidates,
      });
      created[pm.name] = result.id;
    }

    if (recommendDraft.value.modelGroup && !recommendDraft.value.modelGroup.nameConflict) {
      const members = recommendDraft.value.modelGroup.members
        .map((m) => {
          const publicModelId = created[m.publicModelName];
          if (!publicModelId) return null;
          return {
            publicModelId,
            enabled: m.enabled,
            priority: m.priority,
            weight: m.weight,
          };
        })
        .filter(Boolean) as Array<{
        publicModelId: string;
        enabled: boolean;
        priority: number;
        weight: number;
      }>;

      if (members.length > 0) {
        await createModelGroup({
          name: recommendDraft.value.modelGroup.name,
          displayName: recommendDraft.value.modelGroup.displayName,
          description: recommendDraft.value.modelGroup.description,
          enabled: true,
          members,
        });
      }
    }

    message.success(t('modelReference.applied'));
    showRecommend.value = false;
    selectedRowKeys.value = [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('modelReference.applyFailed'));
  } finally {
    recommendLoading.value = false;
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

onMounted(load);
</script>

<template>
  <NSpin :show="loading">
    <NCard :title="t('modelReference.title')">
      <template #header-extra>
        <NSpace>
          <NButton type="primary" :loading="refreshing" @click="onRefresh">
            {{ t('modelReference.refresh') }}
          </NButton>
          <NButton :disabled="selectedRowKeys.length === 0" @click="onRecommend">
            {{ t('modelReference.recommend') }}
          </NButton>
        </NSpace>
      </template>

      <NSpace align="center" style="margin-bottom: 16px">
        <NSelect
          v-model:value="providerFilter"
          :options="providerOptions"
          style="width: 160px"
          @update:value="load"
        />
        <NSelect v-model:value="selectedSort" :options="sortOptions" style="width: 180px" />
        <NText depth="3">
          {{ t('modelReference.lastRefresh') }}: {{ formatDate((syncStatus as any)?.lastRefreshAt) }}
        </NText>
      </NSpace>

      <NDataTable
        :columns="columns"
        :data="entries"
        :row-key="(row: ModelReferenceEntryContract) => row.id"
        v-model:checked-row-keys="selectedRowKeys"
        :bordered="false"
        :single-line="false"
        size="small"
      />
    </NCard>

    <NModal
      v-model:show="showRecommend"
      :title="t('modelReference.recommendTitle')"
      preset="card"
      style="width: 720px; max-width: 90vw"
    >
      <NForm label-placement="left" label-width="140px">
        <NFormItem :label="t('modelReference.upstreamKey')">
          <NSelect
            v-model:value="recommendForm.upstreamKeyId"
            :options="upstreamKeys"
            clearable
            style="width: 260px"
          />
        </NFormItem>
        <NFormItem :label="t('modelReference.createGroup')">
          <NSwitch v-model:value="recommendForm.createGroup" />
        </NFormItem>
        <NFormItem v-if="recommendForm.createGroup" :label="t('modelReference.groupName')">
          <NInput v-model:value="recommendForm.groupName" style="width: 260px" />
        </NFormItem>
        <NSpace justify="end">
          <NButton :loading="recommendLoading" @click="onGenerateDraft">
            {{ t('modelReference.generateDraft') }}
          </NButton>
        </NSpace>
      </NForm>

      <div v-if="recommendDraft" style="margin-top: 16px">
        <NAlert
          v-if="recommendDraft.conflicts.length > 0"
          type="warning"
          style="margin-bottom: 12px"
        >
          {{ t('modelReference.conflicts') }}: {{ recommendDraft.conflicts.join(', ') }}
        </NAlert>

        <NCard size="small" :title="t('modelReference.draftPublicModels')">
          <ul>
            <li v-for="pm in recommendDraft.publicModels" :key="pm.name">
              {{ pm.displayName }}
              <NText v-if="pm.nameConflict" type="error">({{ t('modelReference.nameConflict') }})</NText>
            </li>
          </ul>
        </NCard>

        <NCard
          v-if="recommendDraft.modelGroup"
          size="small"
          :title="t('modelReference.draftModelGroup')"
          style="margin-top: 12px"
        >
          {{ recommendDraft.modelGroup.displayName }}
          <NText v-if="recommendDraft.modelGroup.nameConflict" type="error">
            ({{ t('modelReference.nameConflict') }})
          </NText>
        </NCard>

        <NSpace justify="end" style="margin-top: 16px">
          <NButton :loading="recommendLoading" type="primary" @click="onApplyDraft">
            {{ t('modelReference.apply') }}
          </NButton>
        </NSpace>
      </div>
    </NModal>
  </NSpin>
</template>
