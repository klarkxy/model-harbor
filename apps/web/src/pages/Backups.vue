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
  NInput,
  NSelect,
  NSwitch,
  NPopconfirm,
  NPopover,
  NIcon,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { HelpCircleOutline } from '@vicons/ionicons5';
import {
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  exportConfig,
} from '../api/admin/backups.js';
import type { BackupContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

// v1 Phase 7：从 Settings 拆出来的独立 Backups 页面。
// 负责：创建/恢复/删除完整备份，导出非敏感配置。
const { t } = useI18n();
const message = useMessage();

const backups = ref<BackupContract[]>([]);
const backupsLoading = ref(false);
const showCreateBackup = ref(false);
const createBackupForm = ref<{ type: 'full' | 'config'; note: string }>({
  type: 'full',
  note: '',
});
const restoreForm = ref<{ show: boolean; id: string; confirm: boolean }>({
  show: false,
  id: '',
  confirm: false,
});

async function loadBackups() {
  backupsLoading.value = true;
  try {
    backups.value = await listBackups();
  } finally {
    backupsLoading.value = false;
  }
}

async function onCreateBackup() {
  try {
    await createBackup({
      type: createBackupForm.value.type,
      note: createBackupForm.value.note || undefined,
    });
    showCreateBackup.value = false;
    createBackupForm.value = { type: 'full', note: '' };
    await loadBackups();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onRestoreBackup() {
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

function openRestoreBackup(row: BackupContract) {
  restoreForm.value = { show: true, id: row.id, confirm: false };
}

async function onDeleteBackup(row: BackupContract) {
  try {
    await deleteBackup(row.id);
    await loadBackups();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

async function onExportConfig() {
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

const HintPopover = {
  props: ['hintKey'],
  setup(props: { hintKey: string }) {
    return () =>
      h(
        NPopover,
        { trigger: 'click', placement: 'top', width: 360, arrow: true },
        {
          trigger: () =>
            h(
              NButton,
              {
                text: true,
                size: 'tiny',
                tag: 'span',
                style: 'margin-left: 6px; cursor: help;',
                'aria-label': 'help',
              },
              {
                icon: () => h(NIcon, null, { default: () => h(HelpCircleOutline) }),
              },
            ),
          default: () =>
            h(
              'div',
              { style: 'line-height: 1.55; font-size: 13px;' },
              t(`backups.hints.${props.hintKey}`),
            ),
        },
      );
  },
};

const backupColumns: DataTableColumns<BackupContract> = [
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
              { size: 'small', onClick: () => openRestoreBackup(row) },
              { default: () => t('backups.restore') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDeleteBackup(row) },
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

onMounted(loadBackups);
</script>

<template>
  <NCard :title="t('backups.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton @click="onExportConfig">{{ t('backups.exportConfig') }}</NButton>
        <NButton type="primary" @click="showCreateBackup = true">
          {{ t('backups.create') }}
        </NButton>
      </NSpace>
      <NDataTable
        :columns="backupColumns"
        :data="backups"
        :loading="backupsLoading"
        :row-key="(row: BackupContract) => row.id"
      />
    </NSpace>

    <NModal
      v-model:show="showCreateBackup"
      :title="t('backups.create')"
      preset="card"
      style="width: 480px"
    >
      <NForm label-placement="left" label-width="80px">
        <NFormItem>
          <template #label>
            <span>{{ t('backups.type') }}</span>
            <HintPopover hint-key="backupType" />
          </template>
          <NSelect
            v-model:value="createBackupForm.type"
            :options="[
              { label: t('backups.full'), value: 'full' },
              { label: t('backups.config'), value: 'config' },
            ]"
          />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span>{{ t('backups.note') }}</span>
            <HintPopover hint-key="backupNote" />
          </template>
          <NInput v-model:value="createBackupForm.note" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showCreateBackup = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onCreateBackup">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="restoreForm.show"
      :title="t('backups.restore')"
      preset="card"
      style="width: 480px"
    >
      <NForm label-placement="left" label-width="100px">
        <NFormItem>
          <template #label>
            <span>{{ t('backups.confirm') }}</span>
            <HintPopover hint-key="backupConfirm" />
          </template>
          <NSwitch v-model:value="restoreForm.confirm" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="restoreForm.show = false">{{ t('common.cancel') }}</NButton>
        <NButton type="error" @click="onRestoreBackup">{{ t('backups.restore') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
