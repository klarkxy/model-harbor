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
  listModelGroups,
  getModelGroup,
  createModelGroup,
  updateModelGroup,
  deleteModelGroup,
} from '../api/admin/model-groups.js';
import { listPublicModels } from '../api/admin/public-models.js';
import type { ModelGroupWithMembers } from '../api/admin/model-groups.js';
import type { ModelGroupContract, PublicModelContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const groups = ref<ModelGroupContract[]>([]);
const publicModels = ref<PublicModelContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingGroup = ref<ModelGroupWithMembers | null>(null);
const form = ref({
  name: '',
  displayName: '',
  description: '',
  enabled: true,
  members: [] as { publicModelId: string; priority: number; weight: number; enabled: boolean }[],
});

async function load() {
  loading.value = true;
  try {
    [groups.value, publicModels.value] = await Promise.all([listModelGroups(), listPublicModels()]);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = { name: '', displayName: '', description: '', enabled: true, members: [] };
}

function openCreate() {
  editingGroup.value = null;
  resetForm();
  showModal.value = true;
}

async function openEdit(row: ModelGroupContract) {
  const full = await getModelGroup(row.id);
  editingGroup.value = full;
  form.value = {
    name: full.name,
    displayName: full.displayName ?? '',
    description: full.description ?? '',
    enabled: full.enabled,
    members: full.members.map((m) => ({
      publicModelId: m.publicModelId,
      priority: m.priority,
      weight: m.weight,
      enabled: m.enabled,
    })),
  };
  showModal.value = true;
}

function addMember() {
  form.value.members.push({ publicModelId: '', priority: 100, weight: 1, enabled: true });
}

function removeMember(index: number) {
  form.value.members.splice(index, 1);
}

async function onSave() {
  try {
    const payload = {
      name: form.value.name,
      displayName: form.value.displayName || undefined,
      description: form.value.description || undefined,
      enabled: form.value.enabled,
      members: form.value.members,
    };
    if (editingGroup.value) {
      await updateModelGroup(editingGroup.value.id, payload);
    } else {
      await createModelGroup(payload);
    }
    showModal.value = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: ModelGroupContract) {
  try {
    await deleteModelGroup(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const columns: DataTableColumns<ModelGroupContract> = [
  { title: t('modelGroups.name'), key: 'name' },
  { title: t('modelGroups.displayName'), key: 'displayName' },
  { title: t('modelGroups.members'), key: 'members' },
  {
    title: t('modelGroups.enabled'),
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
            default: () => t('modelGroups.confirmDelete'),
          }),
        ],
      });
    },
  },
];

const modelOptions = computed(() => publicModels.value.map((m) => ({ label: m.displayName || m.name, value: m.id })));

onMounted(load);
</script>

<template>
  <NCard :title="t('modelGroups.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('modelGroups.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="groups" :loading="loading" :row-key="(row) => row.id" />
    </NSpace>

    <NModal v-model:show="showModal" :title="editingGroup ? t('modelGroups.edit') : t('modelGroups.create')" preset="card" style="width: 680px">
      <NForm label-placement="left" label-width="100px">
        <NFormItem :label="t('modelGroups.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('modelGroups.displayName')">
          <NInput v-model:value="form.displayName" />
        </NFormItem>
        <NFormItem :label="t('modelGroups.description')">
          <NInput v-model:value="form.description" type="textarea" />
        </NFormItem>
        <NFormItem :label="t('modelGroups.enabled')">
          <NSwitch v-model:value="form.enabled" />
        </NFormItem>
      </NForm>

      <NCard :title="t('modelGroups.members')" size="small">
        <NSpace vertical :size="12">
          <NSpace v-for="(m, index) in form.members" :key="index" align="center">
            <NSelect v-model:value="m.publicModelId" :options="modelOptions" :placeholder="t('modelGroups.publicModel')" style="width: 240px" />
            <NInputNumber v-model:value="m.priority" :placeholder="t('modelGroups.priority')" style="width: 90px" />
            <NInputNumber v-model:value="m.weight" :placeholder="t('modelGroups.weight')" style="width: 90px" />
            <NSwitch v-model:value="m.enabled" />
            <NButton size="small" type="error" @click="removeMember(index)">{{ t('common.delete') }}</NButton>
          </NSpace>
          <NButton size="small" @click="addMember">{{ t('modelGroups.addMember') }}</NButton>
        </NSpace>
      </NCard>

      <NSpace justify="end" style="margin-top: 16px">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
