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
  NSelect,
  NInput,
  NPopconfirm,
  NTag,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listProviderPresets,
  createProviderPreset,
  updateProviderPreset,
  deleteProviderPreset,
} from '../api/admin/provider-presets.js';
import { ALL_PROVIDER_TYPES } from '@manageyourllm/shared';
import type { ProviderPresetContract, CreateLocalPresetRequest } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const presets = ref<ProviderPresetContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingId = ref<string | null>(null);
const form = ref<CreateLocalPresetRequest>({
  name: '',
  providerType: 'openai_compatible',
  descriptorJson: {},
});
const descriptorText = ref('');

const providerOptions = ALL_PROVIDER_TYPES.map((type) => ({ label: type, value: type }));

async function load() {
  loading.value = true;
  try {
    presets.value = await listProviderPresets();
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = { name: '', providerType: 'openai_compatible', descriptorJson: {} };
  descriptorText.value = '';
  editingId.value = null;
}

function openCreate() {
  resetForm();
  descriptorText.value = JSON.stringify(
    {
      id: 'custom',
      metadata: { displayName: 'Custom Provider' },
      capabilities: {
        protocols: ['openai'],
        supportsTools: false,
        supportsToolChoice: false,
        supportsVision: false,
        supportsJsonMode: false,
        supportsThinking: false,
      },
      endpoints: [
        {
          protocol: 'openai',
          baseUrl: 'https://api.example.com',
          providerType: 'openai_compatible',
        },
      ],
    },
    null,
    2,
  );
  showModal.value = true;
}

function openEdit(row: ProviderPresetContract) {
  editingId.value = row.id;
  form.value = {
    name: row.name,
    providerType: row.providerType,
    descriptorJson: row.descriptorJson,
  };
  descriptorText.value = JSON.stringify(row.descriptorJson, null, 2);
  showModal.value = true;
}

function parseDescriptor(): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(descriptorText.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

async function onSave() {
  const descriptorJson = parseDescriptor();
  if (!descriptorJson) {
    message.error(t('providerPresets.invalidDescriptor'));
    return;
  }
  const body = { ...form.value, descriptorJson };
  try {
    if (editingId.value) {
      await updateProviderPreset(editingId.value, body);
    } else {
      await createProviderPreset(body);
    }
    showModal.value = false;
    resetForm();
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: ProviderPresetContract) {
  if (row.source === 'builtin') return;
  try {
    await deleteProviderPreset(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const columns: DataTableColumns<ProviderPresetContract> = [
  { title: t('providerPresets.name'), key: 'name' },
  { title: t('providerPresets.providerType'), key: 'providerType' },
  {
    title: t('providerPresets.source'),
    key: 'source',
    render(row) {
      return h(
        NTag,
        { type: row.source === 'builtin' ? 'default' : 'success', size: 'small' },
        { default: () => t(`providerPresets.${row.source}`) },
      );
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
            row.source === 'local'
              ? h(
                  NPopconfirm,
                  { onPositiveClick: () => onDelete(row) },
                  {
                    trigger: () =>
                      h(
                        NButton,
                        { size: 'small', type: 'error' },
                        { default: () => t('common.delete') },
                      ),
                    default: () => t('providerPresets.confirmDelete'),
                  },
                )
              : null,
          ],
        },
      );
    },
  },
];

onMounted(load);
</script>

<template>
  <NCard :title="t('providerPresets.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('providerPresets.create') }}</NButton>
      </NSpace>
      <NDataTable
        :columns="columns"
        :data="presets"
        :loading="loading"
        :row-key="(row) => row.id"
      />
    </NSpace>

    <NModal
      v-model:show="showModal"
      :title="editingId ? t('providerPresets.edit') : t('providerPresets.create')"
      preset="card"
      style="width: 600px"
    >
      <NForm label-placement="left" label-width="120px">
        <NFormItem :label="t('providerPresets.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('providerPresets.providerType')">
          <NSelect v-model:value="form.providerType" :options="providerOptions" />
        </NFormItem>
        <NFormItem :label="t('providerPresets.descriptorJson')">
          <NInput v-model:value="descriptorText" type="textarea" :rows="14" placeholder="{}" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
