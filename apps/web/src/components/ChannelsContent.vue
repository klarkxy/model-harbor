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
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../api/admin/channels.js';
import { listModels } from '../api/admin/models.js';
import type { ChannelWithMembers } from '../api/admin/channels.js';
import type { ChannelContract, ModelContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const channels = ref<ChannelContract[]>([]);
const models = ref<ModelContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingChannel = ref<ChannelWithMembers | null>(null);
const form = ref({
  name: '',
  displayName: '',
  description: '',
  enabled: true,
  members: [] as { modelId: string; priority: number; enabled: boolean }[],
});

async function load() {
  loading.value = true;
  try {
    [channels.value, models.value] = await Promise.all([listChannels(), listModels()]);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = { name: '', displayName: '', description: '', enabled: true, members: [] };
}

function openCreate() {
  editingChannel.value = null;
  resetForm();
  showModal.value = true;
}

async function openEdit(row: ChannelContract) {
  const full = await getChannel(row.id);
  editingChannel.value = full;
  form.value = {
    name: full.name,
    displayName: full.displayName ?? '',
    description: full.description ?? '',
    enabled: full.enabled,
    members: full.members.map((m) => ({
      modelId: m.modelId,
      priority: m.priority,
      enabled: m.enabled,
    })),
  };
  showModal.value = true;
}

function addMember() {
  form.value.members.push({ modelId: '', priority: 100, enabled: true });
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
    if (editingChannel.value) {
      await updateChannel(editingChannel.value.id, payload);
    } else {
      await createChannel(payload);
    }
    showModal.value = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: ChannelContract) {
  try {
    await deleteChannel(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const columns: DataTableColumns<ChannelContract> = [
  { title: t('channels.name'), key: 'name' },
  { title: t('channels.displayName'), key: 'displayName' },
  { title: t('channels.members'), key: 'members' },
  {
    title: t('channels.enabled'),
    key: 'enabled',
    render(row) {
      return h('span', {}, row.enabled ? t('common.yes') : t('common.no'));
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    render(row) {
      return h(
        NSpace,
        { size: 'small' },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', onClick: () => openEdit(row) },
              { default: () => t('common.edit') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDelete(row) },
              {
                trigger: () =>
                  h(
                    NButton,
                    { size: 'small', type: 'error' },
                    { default: () => t('common.delete') },
                  ),
                default: () => t('channels.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
];

const modelOptions = computed(() =>
  models.value.map((m) => ({ label: m.displayName || m.name, value: m.id })),
);

onMounted(load);
</script>

<template>
  <NCard :title="t('channels.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('channels.create') }}</NButton>
      </NSpace>
      <NDataTable
        :columns="columns"
        :data="channels"
        :loading="loading"
        :row-key="(row) => row.id"
      />
    </NSpace>

    <NModal
      v-model:show="showModal"
      :title="editingChannel ? t('channels.edit') : t('channels.create')"
      preset="card"
      style="width: 680px"
    >
      <NForm label-placement="left" label-width="100px">
        <NFormItem :label="t('channels.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('channels.displayName')">
          <NInput v-model:value="form.displayName" />
        </NFormItem>
        <NFormItem :label="t('channels.description')">
          <NInput v-model:value="form.description" type="textarea" />
        </NFormItem>
        <NFormItem :label="t('channels.enabled')">
          <NSwitch v-model:value="form.enabled" />
        </NFormItem>
      </NForm>

      <NCard :title="t('channels.members')" size="small">
        <NSpace vertical :size="12">
          <NSpace v-for="(m, index) in form.members" :key="index" align="center">
            <NSelect
              v-model:value="m.modelId"
              :options="modelOptions"
              :placeholder="t('channels.model')"
              style="width: 280px"
            />
            <NInputNumber
              v-model:value="m.priority"
              :placeholder="t('channels.priority')"
              style="width: 90px"
            />
            <NSwitch v-model:value="m.enabled" />
            <NButton size="small" type="error" @click="removeMember(index)">{{
              t('common.delete')
            }}</NButton>
          </NSpace>
          <NButton size="small" @click="addMember">{{ t('channels.addMember') }}</NButton>
        </NSpace>
      </NCard>

      <NSpace justify="end" style="margin-top: 16px">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
