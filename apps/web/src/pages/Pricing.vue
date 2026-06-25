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
  NInputNumber,
  NPopconfirm,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listPricingEntries,
  createPricingEntry,
  updatePricingEntry,
  deletePricingEntry,
} from '../api/admin/pricing.js';
import { listUpstreamKeys } from '../api/admin/upstream-keys.js';
import { ALL_PROVIDER_TYPES } from '@manageyourllm/shared';
import type { PricingEntryContract, CreatePricingEntryRequest } from '@manageyourllm/contracts';
import type { DataTableColumns, SelectOption } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const entries = ref<PricingEntryContract[]>([]);
const upstreamKeys = ref<{ id: string; name: string }[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingId = ref<string | null>(null);

const defaultForm: CreatePricingEntryRequest = {
  providerType: 'openai_compatible',
  upstreamKeyId: null,
  realModelName: '',
  inputPricePer1k: 0,
  outputPricePer1k: 0,
  currency: 'USD',
  effectiveFrom: new Date().toISOString(),
  effectiveUntil: null,
};
const form = ref<CreatePricingEntryRequest>({ ...defaultForm });
const effectiveFromLocal = ref('');
const effectiveUntilLocal = ref('');

const providerOptions = ALL_PROVIDER_TYPES.map((type) => ({ label: type, value: type }));
const upstreamOptions = computed<SelectOption[]>(() => [
  { label: t('pricing.generic'), value: '' },
  ...upstreamKeys.value.map((u) => ({ label: u.name, value: u.id })),
]);

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

async function load() {
  loading.value = true;
  try {
    const [entriesData, keysData] = await Promise.all([listPricingEntries(), listUpstreamKeys()]);
    entries.value = entriesData;
    upstreamKeys.value = keysData.map((k) => ({ id: k.id, name: k.name }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = { ...defaultForm };
  effectiveFromLocal.value = toLocalInput(form.value.effectiveFrom);
  effectiveUntilLocal.value = '';
  editingId.value = null;
}

function openCreate() {
  resetForm();
  showModal.value = true;
}

function openEdit(row: PricingEntryContract) {
  editingId.value = row.id;
  form.value = {
    providerType: row.providerType,
    upstreamKeyId: row.upstreamKeyId,
    realModelName: row.realModelName,
    inputPricePer1k: row.inputPricePer1k,
    outputPricePer1k: row.outputPricePer1k,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
  };
  effectiveFromLocal.value = toLocalInput(row.effectiveFrom);
  effectiveUntilLocal.value = toLocalInput(row.effectiveUntil);
  showModal.value = true;
}

async function onSave() {
  const body: CreatePricingEntryRequest = {
    ...form.value,
    effectiveFrom: fromLocalInput(effectiveFromLocal.value) ?? form.value.effectiveFrom,
    effectiveUntil: fromLocalInput(effectiveUntilLocal.value),
  };
  try {
    if (editingId.value) {
      await updatePricingEntry(editingId.value, body);
    } else {
      await createPricingEntry(body);
    }
    showModal.value = false;
    resetForm();
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: PricingEntryContract) {
  try {
    await deletePricingEntry(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

function upstreamLabel(id: string | null): string {
  if (!id) return t('pricing.generic');
  return upstreamKeys.value.find((u) => u.id === id)?.name ?? id;
}

function formatRange(from: string, until: string | null): string {
  const start = new Date(from).toLocaleString('zh-CN');
  const end = until ? new Date(until).toLocaleString('zh-CN') : t('pricing.noExpiry');
  return `${start} ~ ${end}`;
}

const columns = computed<DataTableColumns<PricingEntryContract>>(() => [
  { title: t('pricing.providerType'), key: 'providerType' },
  { title: t('pricing.upstream'), key: 'upstreamKeyId', render: (row) => upstreamLabel(row.upstreamKeyId) },
  { title: t('pricing.realModelName'), key: 'realModelName' },
  { title: t('pricing.inputPrice'), key: 'inputPricePer1k', render: (row) => `${row.inputPricePer1k} / 1k` },
  { title: t('pricing.outputPrice'), key: 'outputPricePer1k', render: (row) => `${row.outputPricePer1k} / 1k` },
  { title: t('pricing.currency'), key: 'currency' },
  { title: t('pricing.effectiveRange'), key: 'effectiveRange', render: (row) => formatRange(row.effectiveFrom, row.effectiveUntil) },
  {
    title: t('common.actions'),
    key: 'actions',
    render(row) {
      return h(
        NSpace,
        { size: 'small' },
        {
          default: () => [
            h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDelete(row) },
              {
                trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => t('common.delete') }),
                default: () => t('pricing.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
]);

onMounted(load);
</script>

<template>
  <NCard :title="t('pricing.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('pricing.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="entries" :loading="loading" :row-key="(row) => row.id" />
    </NSpace>

    <NModal
      v-model:show="showModal"
      :title="editingId ? t('pricing.edit') : t('pricing.create')"
      preset="card"
      style="width: 600px"
    >
      <NForm label-placement="left" label-width="140px">
        <NFormItem :label="t('pricing.providerType')">
          <NSelect v-model:value="form.providerType" :options="providerOptions" />
        </NFormItem>
        <NFormItem :label="t('pricing.upstream')">
          <NSelect v-model:value="form.upstreamKeyId" :options="upstreamOptions" clearable />
        </NFormItem>
        <NFormItem :label="t('pricing.realModelName')">
          <NInput v-model:value="form.realModelName" />
        </NFormItem>
        <NFormItem :label="t('pricing.inputPrice')">
          <NInputNumber v-model:value="form.inputPricePer1k" :min="0" />
        </NFormItem>
        <NFormItem :label="t('pricing.outputPrice')">
          <NInputNumber v-model:value="form.outputPricePer1k" :min="0" />
        </NFormItem>
        <NFormItem :label="t('pricing.currency')">
          <NInput v-model:value="form.currency" />
        </NFormItem>
        <NFormItem :label="t('pricing.effectiveFrom')">
          <NInput v-model:value="effectiveFromLocal" :type="'datetime-local' as any" />
        </NFormItem>
        <NFormItem :label="t('pricing.effectiveUntil')">
          <NInput v-model:value="effectiveUntilLocal" :type="'datetime-local' as any" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
