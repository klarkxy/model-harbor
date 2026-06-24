<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NSpace,
  NButton,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSwitch,
  NInputNumber,
  NPopconfirm,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listPublicModels,
  getPublicModel,
  createPublicModel,
  updatePublicModel,
  deletePublicModel,
} from '../api/admin/public-models.js';
import { listUpstreamKeys } from '../api/admin/upstream-keys.js';
import type { PublicModelWithCandidates } from '../api/admin/public-models.js';
import type { PublicModelContract } from '@manageyourllm/contracts';
import type { UpstreamKeyWithQuota } from '../api/admin/upstream-keys.js';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const models = ref<PublicModelContract[]>([]);
const upstreamKeys = ref<UpstreamKeyWithQuota[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingModel = ref<PublicModelWithCandidates | null>(null);
const form = ref({
  name: '',
  displayName: '',
  description: '',
  enabled: true,
  candidates: [] as { upstreamKeyId: string; realModelName: string; priority: number; weight: number; enabled: boolean }[],
});

async function load() {
  loading.value = true;
  try {
    [models.value, upstreamKeys.value] = await Promise.all([listPublicModels(), listUpstreamKeys()]);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = { name: '', displayName: '', description: '', enabled: true, candidates: [] };
}

function openCreate() {
  editingModel.value = null;
  resetForm();
  showModal.value = true;
}

async function openEdit(row: PublicModelContract) {
  const full = await getPublicModel(row.id);
  editingModel.value = full;
  form.value = {
    name: full.name,
    displayName: full.displayName ?? '',
    description: full.description ?? '',
    enabled: full.enabled,
    candidates: full.candidates.map((c) => ({
      upstreamKeyId: c.upstreamKeyId,
      realModelName: c.realModelName,
      priority: c.priority,
      weight: c.weight,
      enabled: c.enabled,
    })),
  };
  showModal.value = true;
}

function addCandidate() {
  form.value.candidates.push({ upstreamKeyId: '', realModelName: '', priority: 100, weight: 1, enabled: true });
}

function removeCandidate(index: number) {
  form.value.candidates.splice(index, 1);
}

async function onSave() {
  try {
    const payload = {
      name: form.value.name,
      displayName: form.value.displayName || undefined,
      description: form.value.description || undefined,
      enabled: form.value.enabled,
      candidates: form.value.candidates,
    };
    if (editingModel.value) {
      await updatePublicModel(editingModel.value.id, payload);
    } else {
      await createPublicModel(payload);
    }
    showModal.value = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: PublicModelContract) {
  try {
    await deletePublicModel(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const columns: DataTableColumns<PublicModelContract> = [
  { title: t('publicModels.name'), key: 'name' },
  { title: t('publicModels.displayName'), key: 'displayName' },
  { title: t('publicModels.candidates'), key: 'candidates' },
  {
    title: t('publicModels.enabled'),
    key: 'enabled',
    render(row) {
      return h('span', {}, row.enabled ? t('common.yes') : t('common.no'));
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NPopconfirm, { onPositiveClick: () => onDelete(row) }, {
            trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => t('common.delete') }),
            default: () => t('publicModels.confirmDelete'),
          }),
        ],
      });
    },
  },
];

const upstreamOptions = computed(() => upstreamKeys.value.map((k) => ({ label: `${k.name} (${k.providerType})`, value: k.id })));

onMounted(load);
</script>

<template>
  <NCard :title="t('publicModels.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('publicModels.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="models" :loading="loading" :row-key="(row) => row.id" />
    </NSpace>

    <NModal v-model:show="showModal" :title="editingModel ? t('publicModels.edit') : t('publicModels.create')" preset="card" style="width: 680px">
      <NForm label-placement="left" label-width="100px">
        <NFormItem :label="t('publicModels.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('publicModels.displayName')">
          <NInput v-model:value="form.displayName" />
        </NFormItem>
        <NFormItem :label="t('publicModels.description')">
          <NInput v-model:value="form.description" type="textarea" />
        </NFormItem>
        <NFormItem :label="t('publicModels.enabled')">
          <NSwitch v-model:value="form.enabled" />
        </NFormItem>
      </NForm>

      <NCard :title="t('publicModels.candidates')" size="small">
        <NSpace vertical :size="12">
          <NSpace v-for="(c, index) in form.candidates" :key="index" align="center">
            <NSelect v-model:value="c.upstreamKeyId" :options="upstreamOptions" :placeholder="t('publicModels.upstreamKey')" style="width: 220px" />
            <NInput v-model:value="c.realModelName" :placeholder="t('publicModels.realModelName')" style="width: 160px" />
            <NInputNumber v-model:value="c.priority" :placeholder="t('publicModels.priority')" style="width: 90px" />
            <NInputNumber v-model:value="c.weight" :placeholder="t('publicModels.weight')" style="width: 90px" />
            <NSwitch v-model:value="c.enabled" />
            <NButton size="small" type="error" @click="removeCandidate(index)">{{ t('common.delete') }}</NButton>
          </NSpace>
          <NButton size="small" @click="addCandidate">{{ t('publicModels.addCandidate') }}</NButton>
        </NSpace>
      </NCard>

      <NSpace justify="end" style="margin-top: 16px">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
