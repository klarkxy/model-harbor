<script setup lang="ts">
import { ref, onMounted, h } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NSpace,
  NButton,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NSelect,
  NInput,
  NPopconfirm,
  NSwitch,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  exportConfig,
} from '../api/admin/backups.js';
import type { BackupContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const backups = ref<BackupContract[]>([]);
const loading = ref(false);
const showCreate = ref(false);
const createForm = ref({ type: 'full' as 'full' | 'config', note: '' });
const restoreForm = ref<{ show: boolean; id: string; confirm: boolean }>({
  show: false,
  id: '',
  confirm: false,
});

async function load() {
  loading.value = true;
  try {
    backups.value = await listBackups();
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  try {
    await createBackup({ type: createForm.value.type, note: createForm.value.note || undefined });
    showCreate.value = false;
    createForm.value = { type: 'full', note: '' };
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onRestore() {
  if (!restoreForm.value.confirm) {
    message.warning(t('backups.confirmRequired'));
    return;
  }
  try {
    const result = await restoreBackup(restoreForm.value.id, { confirm: true });
    restoreForm.value.show = false;
    if (result.requiresRestart) {
      message.warning(t('backups.restoredRequiresRestart'));
    } else {
      message.success(t('backups.restored'));
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

function openRestore(row: BackupContract) {
  restoreForm.value = { show: true, id: row.id, confirm: false };
}

async function onDelete(row: BackupContract) {
  try {
    await deleteBackup(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

async function onExport() {
  try {
    const config = await exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manageyourllm-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t('backups.exported'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

const columns: DataTableColumns<BackupContract> = [
  { title: t('backups.filename'), key: 'filename' },
  { title: t('backups.type'), key: 'type' },
  { title: t('backups.size'), key: 'sizeBytes' },
  { title: t('backups.schemaVersion'), key: 'schemaVersion' },
  { title: t('backups.note'), key: 'note' },
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
              { size: 'small', onClick: () => openRestore(row) },
              { default: () => t('backups.restore') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDelete(row) },
              {
                trigger: () =>
                  h(
                    NButton,
                    { size: 'small', type: 'error' },
                    { default: () => t('backups.delete') },
                  ),
                default: () => t('backups.confirmRequired'),
              },
            ),
          ],
        },
      );
    },
  },
];

onMounted(load);
</script>

<template>
  <NCard :title="t('backups.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton @click="onExport">{{ t('backups.exportConfig') }}</NButton>
        <NButton type="primary" @click="showCreate = true">{{ t('backups.create') }}</NButton>
      </NSpace>
      <NDataTable
        :columns="columns"
        :data="backups"
        :loading="loading"
        :row-key="(row) => row.id"
      />
    </NSpace>

    <NModal
      v-model:show="showCreate"
      :title="t('backups.create')"
      preset="card"
      style="width: 480px"
    >
      <NForm label-placement="left" label-width="80px">
        <NFormItem :label="t('backups.type')">
          <NSelect
            v-model:value="createForm.type"
            :options="[
              { label: t('backups.full'), value: 'full' },
              { label: t('backups.config'), value: 'config' },
            ]"
          />
        </NFormItem>
        <NFormItem :label="t('backups.note')">
          <NInput v-model:value="createForm.note" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showCreate = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onCreate">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="restoreForm.show"
      :title="t('backups.restore')"
      preset="card"
      style="width: 480px"
    >
      <NForm label-placement="left" label-width="100px">
        <NFormItem :label="t('backups.confirm')">
          <NSwitch v-model:value="restoreForm.confirm" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="restoreForm.show = false">{{ t('common.cancel') }}</NButton>
        <NButton type="error" @click="onRestore">{{ t('backups.restore') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
