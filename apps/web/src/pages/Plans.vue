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
import { listPlans, createPlan, updatePlan, deletePlan } from '../api/admin/plans.js';
import { listUpstreamKeys } from '../api/admin/upstream-keys.js';
import { ALL_PROVIDER_TYPES } from '@manageyourllm/shared';
import type { PlanContract, CreatePlanRequest } from '@manageyourllm/contracts';
import type { DataTableColumns, SelectOption } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const plans = ref<PlanContract[]>([]);
const upstreamKeys = ref<{ id: string; name: string }[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingId = ref<string | null>(null);

const planTypeOptions = [
  { label: t('plans.typeToken'), value: 'token' },
  { label: t('plans.typeCoding'), value: 'coding' },
];
const providerOptions = ALL_PROVIDER_TYPES.map((type) => ({ label: type, value: type }));
const periodOptions = ['monthly', 'yearly', 'one_time'].map((p) => ({ label: t(`plans.period.${p}`), value: p }));

const defaultForm: CreatePlanRequest = {
  planType: 'token',
  name: '',
  providerType: null,
  upstreamKeyId: null,
  totalAmount: 0,
  usedAmount: 0,
  unit: 'token',
  period: 'monthly',
  purchasedAt: new Date().toISOString(),
  validFrom: new Date().toISOString(),
  validUntil: null,
  reminderDays: 7,
  notes: null,
};
const form = ref<CreatePlanRequest>({ ...defaultForm });
const purchasedAtLocal = ref('');
const validFromLocal = ref('');
const validUntilLocal = ref('');

const upstreamOptions = computed<SelectOption[]>(() => [
  { label: t('plans.noScope'), value: '' },
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
    const [plansData, keysData] = await Promise.all([listPlans(), listUpstreamKeys()]);
    plans.value = plansData;
    upstreamKeys.value = keysData.map((k) => ({ id: k.id, name: k.name }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = { ...defaultForm };
  purchasedAtLocal.value = toLocalInput(form.value.purchasedAt);
  validFromLocal.value = toLocalInput(form.value.validFrom);
  validUntilLocal.value = '';
  editingId.value = null;
}

function openCreate() {
  resetForm();
  showModal.value = true;
}

function openEdit(row: PlanContract) {
  editingId.value = row.id;
  form.value = {
    planType: row.planType,
    name: row.name,
    providerType: row.providerType,
    upstreamKeyId: row.upstreamKeyId,
    totalAmount: row.totalAmount,
    usedAmount: row.usedAmount,
    unit: row.unit,
    period: row.period,
    purchasedAt: row.purchasedAt,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    reminderDays: row.reminderDays,
    notes: row.notes,
  };
  purchasedAtLocal.value = toLocalInput(row.purchasedAt);
  validFromLocal.value = toLocalInput(row.validFrom);
  validUntilLocal.value = toLocalInput(row.validUntil);
  showModal.value = true;
}

async function onSave() {
  const body: CreatePlanRequest = {
    ...form.value,
    purchasedAt: fromLocalInput(purchasedAtLocal.value) ?? form.value.purchasedAt,
    validFrom: fromLocalInput(validFromLocal.value) ?? form.value.validFrom,
    validUntil: fromLocalInput(validUntilLocal.value),
  };
  try {
    if (editingId.value) {
      await updatePlan(editingId.value, body);
    } else {
      await createPlan(body);
    }
    showModal.value = false;
    resetForm();
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: PlanContract) {
  try {
    await deletePlan(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

function scopeLabel(row: PlanContract): string {
  if (row.upstreamKeyId) {
    const name = upstreamKeys.value.find((u) => u.id === row.upstreamKeyId)?.name;
    return `${t('plans.upstream')}: ${name ?? row.upstreamKeyId}`;
  }
  if (row.providerType) {
    return `${t('plans.providerType')}: ${row.providerType}`;
  }
  return t('plans.noScope');
}

function formatRange(from: string, until: string | null): string {
  const start = new Date(from).toLocaleString('zh-CN');
  const end = until ? new Date(until).toLocaleString('zh-CN') : t('plans.noExpiry');
  return `${start} ~ ${end}`;
}

const columns = computed<DataTableColumns<PlanContract>>(() => [
  { title: t('plans.name'), key: 'name' },
  { title: t('plans.planType'), key: 'planType' },
  { title: t('plans.scope'), key: 'scope', render: (row) => scopeLabel(row) },
  { title: t('plans.totalAmount'), key: 'totalAmount' },
  { title: t('plans.usedAmount'), key: 'usedAmount' },
  { title: t('plans.remainingAmount'), key: 'remainingAmount' },
  { title: t('plans.unit'), key: 'unit' },
  { title: t('plans.period'), key: 'period' },
  { title: t('plans.validity'), key: 'validity', render: (row) => formatRange(row.validFrom, row.validUntil) },
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
                default: () => t('plans.confirmDelete'),
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
  <NCard :title="t('plans.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('plans.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="plans" :loading="loading" :row-key="(row) => row.id" />
    </NSpace>

    <NModal
      v-model:show="showModal"
      :title="editingId ? t('plans.edit') : t('plans.create')"
      preset="card"
      style="width: 600px"
    >
      <NForm label-placement="left" label-width="140px">
        <NFormItem :label="t('plans.planType')">
          <NSelect v-model:value="form.planType" :options="planTypeOptions" />
        </NFormItem>
        <NFormItem :label="t('plans.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('plans.providerType')">
          <NSelect v-model:value="form.providerType" :options="providerOptions" clearable />
        </NFormItem>
        <NFormItem :label="t('plans.upstream')">
          <NSelect v-model:value="form.upstreamKeyId" :options="upstreamOptions" clearable />
        </NFormItem>
        <NFormItem :label="t('plans.totalAmount')">
          <NInputNumber v-model:value="form.totalAmount" :min="0" />
        </NFormItem>
        <NFormItem :label="t('plans.unit')">
          <NInput v-model:value="form.unit" />
        </NFormItem>
        <NFormItem :label="t('plans.period')">
          <NSelect v-model:value="form.period" :options="periodOptions" />
        </NFormItem>
        <NFormItem :label="t('plans.purchasedAt')">
          <NInput v-model:value="purchasedAtLocal" :type="'datetime-local' as any" />
        </NFormItem>
        <NFormItem :label="t('plans.validFrom')">
          <NInput v-model:value="validFromLocal" :type="'datetime-local' as any" />
        </NFormItem>
        <NFormItem :label="t('plans.validUntil')">
          <NInput v-model:value="validUntilLocal" :type="'datetime-local' as any" />
        </NFormItem>
        <NFormItem :label="t('plans.reminderDays')">
          <NInputNumber v-model:value="form.reminderDays" :min="0" />
        </NFormItem>
        <NFormItem :label="t('plans.notes')">
          <NInput v-model:value="form.notes" type="textarea" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
