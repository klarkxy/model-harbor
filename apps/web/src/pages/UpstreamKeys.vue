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
  NTag,
  NPopconfirm,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listUpstreamKeys,
  createUpstreamKey,
  updateUpstreamKey,
  deleteUpstreamKey,
  rotateUpstreamKey,
  freezeUpstreamKey,
  unfreezeUpstreamKey,
} from '../api/admin/upstream-keys.js';
import { listProviderPresets } from '../api/admin/provider-presets.js';
import type { UpstreamKeyWithQuota } from '../api/admin/upstream-keys.js';
import type { ProviderPresetContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const keys = ref<UpstreamKeyWithQuota[]>([]);
const presets = ref<ProviderPresetContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingKey = ref<UpstreamKeyWithQuota | null>(null);
const form = ref({
  name: '',
  providerPresetId: null as string | null,
  providerType: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  enabled: true,
});

const rotateModal = ref<{ show: boolean; id: string; apiKey: string }>({
  show: false,
  id: '',
  apiKey: '',
});

async function load() {
  loading.value = true;
  try {
    [keys.value, presets.value] = await Promise.all([listUpstreamKeys(), listProviderPresets()]);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingKey.value = null;
  form.value = {
    name: '',
    providerPresetId: null,
    providerType: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    enabled: true,
  };
  showModal.value = true;
}

function openEdit(row: UpstreamKeyWithQuota) {
  editingKey.value = row;
  form.value = {
    name: row.name,
    providerPresetId: row.providerPresetId,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    apiKey: '',
    enabled: row.enabled,
  };
  showModal.value = true;
}

function onPresetChange(presetId: string | null) {
  const preset = presets.value.find((p) => p.id === presetId);
  if (preset) {
    form.value.providerType = preset.providerType;
  }
}

async function onSave() {
  try {
    const payload = {
      name: form.value.name,
      providerPresetId: form.value.providerPresetId ?? undefined,
      providerType: form.value.providerType,
      baseUrl: form.value.baseUrl,
      apiKey: form.value.apiKey,
      enabled: form.value.enabled,
    };
    if (editingKey.value) {
      await updateUpstreamKey(editingKey.value.id, payload);
    } else {
      await createUpstreamKey(payload);
    }
    showModal.value = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: UpstreamKeyWithQuota) {
  try {
    await deleteUpstreamKey(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

async function onFreeze(row: UpstreamKeyWithQuota) {
  try {
    await freezeUpstreamKey(row.id, t('upstreamKeys.manualFreeze'));
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onUnfreeze(row: UpstreamKeyWithQuota) {
  try {
    await unfreezeUpstreamKey(row.id);
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onRotateSubmit() {
  try {
    await rotateUpstreamKey(rotateModal.value.id, rotateModal.value.apiKey);
    rotateModal.value.show = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

const columns: DataTableColumns<UpstreamKeyWithQuota> = [
  { title: t('upstreamKeys.name'), key: 'name' },
  { title: t('upstreamKeys.providerType'), key: 'providerType' },
  { title: t('upstreamKeys.baseUrl'), key: 'baseUrl' },
  { title: t('upstreamKeys.apiKeyPrefix'), key: 'apiKeyPrefix' },
  {
    title: t('upstreamKeys.status'),
    key: 'status',
    render(row) {
      const tags: ReturnType<typeof h>[] = [];
      if (row.frozen) tags.push(h(NTag, { type: 'warning' }, { default: () => t('upstreamKeys.frozen') }));
      if (!row.enabled) tags.push(h(NTag, { type: 'default' }, { default: () => t('upstreamKeys.disabled') }));
      if (tags.length === 0) tags.push(h(NTag, { type: 'success' }, { default: () => t('upstreamKeys.active') }));
      return h(NSpace, { size: 4 }, { default: () => tags });
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'small', onClick: () => { rotateModal.value = { show: true, id: row.id, apiKey: '' }; } }, { default: () => t('upstreamKeys.rotate') }),
          row.frozen
            ? h(NButton, { size: 'small', onClick: () => onUnfreeze(row) }, { default: () => t('upstreamKeys.unfreeze') })
            : h(NButton, { size: 'small', onClick: () => onFreeze(row) }, { default: () => t('upstreamKeys.freeze') }),
          h(NPopconfirm, { onPositiveClick: () => onDelete(row) }, {
            trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => t('common.delete') }),
            default: () => t('upstreamKeys.confirmDelete'),
          }),
        ],
      });
    },
  },
];

const presetOptions = computed(() => presets.value.map((p) => ({ label: `${p.name} (${p.source})`, value: p.id })));

onMounted(load);
</script>

<template>
  <NCard :title="t('upstreamKeys.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('upstreamKeys.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="keys" :loading="loading" :row-key="(row) => row.id" />
    </NSpace>

    <NModal v-model:show="showModal" :title="editingKey ? t('upstreamKeys.edit') : t('upstreamKeys.create')" preset="card" style="width: 560px">
      <NForm label-placement="left" label-width="100px">
        <NFormItem :label="t('upstreamKeys.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('upstreamKeys.providerPreset')">
          <NSelect v-model:value="form.providerPresetId" :options="presetOptions" clearable @update:value="onPresetChange" />
        </NFormItem>
        <NFormItem :label="t('upstreamKeys.providerType')">
          <NInput v-model:value="form.providerType" />
        </NFormItem>
        <NFormItem :label="t('upstreamKeys.baseUrl')">
          <NInput v-model:value="form.baseUrl" />
        </NFormItem>
        <NFormItem :label="editingKey ? t('upstreamKeys.newApiKey') : t('upstreamKeys.apiKey')">
          <NInput v-model:value="form.apiKey" type="password" />
        </NFormItem>
        <NFormItem :label="t('upstreamKeys.enabled')">
          <NSwitch v-model:value="form.enabled" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>

    <NModal v-model:show="rotateModal.show" :title="t('upstreamKeys.rotate')" preset="card" style="width: 480px">
      <NFormItem :label="t('upstreamKeys.newApiKey')">
        <NInput v-model:value="rotateModal.apiKey" type="password" />
      </NFormItem>
      <NSpace justify="end">
        <NButton @click="rotateModal.show = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onRotateSubmit">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
