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
  NTabs,
  NTabPane,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listPricingEntries,
  createPricingEntry,
  updatePricingEntry,
  deletePricingEntry,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  type CreatePricingEntryRequest,
  type UpdatePricingEntryRequest,
  type PricingEntry,
  type CreatePlanRequest,
  type Plan as PlanContract,
} from '../api/admin/costs.js';
import { listProviderAccounts } from '../api/admin/provider-accounts.js';
import { ALL_PROVIDER_TYPES } from '@manageyourllm/shared';
import type { DataTableColumns, SelectOption } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

// ---- 模型定价 (Pricing) ----
const pricingEntries = ref<PricingEntry[]>([]);
const pricingLoading = ref(false);
const showPricingModal = ref(false);
const editingPricingId = ref<string | null>(null);
const pricingForm = ref({
  providerType: '',
  providerAccountId: '',
  realModelName: '',
  inputPricePer1k: 0,
  outputPricePer1k: 0,
  currency: 'USD',
});
const upsKeys = ref<{ id: string; name: string }[]>([]);

async function loadPricing() {
  pricingLoading.value = true;
  try {
    pricingEntries.value = await listPricingEntries();
    upsKeys.value = (await listProviderAccounts()).map((k) => ({ id: k.id, name: k.name }));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    pricingLoading.value = false;
  }
}

function openCreatePricing() {
  editingPricingId.value = null;
  pricingForm.value = {
    providerType: '',
    providerAccountId: '',
    realModelName: '',
    inputPricePer1k: 0,
    outputPricePer1k: 0,
    currency: 'USD',
  };
  showPricingModal.value = true;
}

function openEditPricing(row: PricingEntry) {
  editingPricingId.value = row.id;
  pricingForm.value = {
    providerType: row.providerType ?? '',
    providerAccountId: row.providerAccountId ?? '',
    realModelName: row.realModelName ?? '',
    inputPricePer1k: row.inputPricePer1k,
    outputPricePer1k: row.outputPricePer1k,
    currency: row.currency,
  };
  showPricingModal.value = true;
}

async function onSavePricing() {
  try {
    // 创建时写入 effectiveFrom = now；编辑时**不**覆盖 effectiveFrom，
    // 否则会破坏历史成本报表的取价边界（编辑后此前的费用会被错误地按新价计费）。
    if (editingPricingId.value) {
      const updateBody: UpdatePricingEntryRequest = {
        providerType: pricingForm.value.providerType,
        providerAccountId: pricingForm.value.providerAccountId || null,
        realModelName: pricingForm.value.realModelName,
        inputPricePer1k: pricingForm.value.inputPricePer1k,
        outputPricePer1k: pricingForm.value.outputPricePer1k,
        currency: pricingForm.value.currency,
      };
      await updatePricingEntry(editingPricingId.value, updateBody);
    } else {
      const createBody: CreatePricingEntryRequest = {
        providerType: pricingForm.value.providerType,
        providerAccountId: pricingForm.value.providerAccountId || null,
        realModelName: pricingForm.value.realModelName,
        inputPricePer1k: pricingForm.value.inputPricePer1k,
        outputPricePer1k: pricingForm.value.outputPricePer1k,
        currency: pricingForm.value.currency,
        effectiveFrom: new Date().toISOString(),
      };
      await createPricingEntry(createBody);
    }
    showPricingModal.value = false;
    await loadPricing();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDeletePricing(row: PricingEntry) {
  try {
    await deletePricingEntry(row.id);
    await loadPricing();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const providerTypeOptions = ALL_PROVIDER_TYPES.map((t) => ({ label: t, value: t }));
const upsOptions = computed<SelectOption[]>(() => [
  { label: t('costs.noScope'), value: '' as string },
  ...upsKeys.value.map((u) => ({ label: u.name, value: u.id })),
]);

const pricingColumns: DataTableColumns<PricingEntry> = [
  { title: t('costs.providerType'), key: 'providerType' },
  { title: t('costs.model'), key: 'realModelName' },
  { title: t('costs.inputPrice'), key: 'inputPricePer1k' },
  { title: t('costs.outputPrice'), key: 'outputPricePer1k' },
  { title: t('costs.currency'), key: 'currency' },
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
              { size: 'small', onClick: () => openEditPricing(row) },
              { default: () => t('common.edit') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDeletePricing(row) },
              {
                trigger: () =>
                  h(
                    NButton,
                    { size: 'small', type: 'error' },
                    { default: () => t('common.delete') },
                  ),
                default: () => t('costs.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
];

// ---- 套餐账本 (Plans) ----
const plans = ref<PlanContract[]>([]);
const plansLoading = ref(false);
const showPlanModal = ref(false);
const editingPlanId = ref<string | null>(null);

const planTypeOptions = [
  { label: t('costs.typeToken'), value: 'token' },
  { label: t('costs.typeCoding'), value: 'coding' },
];
const periodOptions = ['monthly', 'yearly', 'one_time'].map((p) => ({
  label: t(`costs.period.${p}`),
  value: p,
}));

const defaultPlanForm: Omit<CreatePlanRequest, 'purchasedAt' | 'validFrom' | 'validUntil'> = {
  planType: 'token',
  name: '',
  providerType: null,
  providerAccountId: null,
  totalAmount: 0,
  usedAmount: 0,
  unit: 'token',
  period: 'monthly',
  reminderDays: 7,
  notes: null,
};
const planForm = ref<Omit<CreatePlanRequest, 'purchasedAt' | 'validFrom' | 'validUntil'>>({
  ...defaultPlanForm,
});
const purchasedAtLocal = ref('');
const validFromLocal = ref('');
const validUntilLocal = ref('');

function nowLocal(): string {
  return toLocalInput(new Date().toISOString());
}

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

async function loadPlans() {
  plansLoading.value = true;
  try {
    plans.value = await listPlans();
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    plansLoading.value = false;
  }
}

function resetPlanForm() {
  planForm.value = { ...defaultPlanForm };
  purchasedAtLocal.value = nowLocal();
  validFromLocal.value = nowLocal();
  validUntilLocal.value = '';
  editingPlanId.value = null;
}

function openCreatePlan() {
  resetPlanForm();
  showPlanModal.value = true;
}

function openEditPlan(row: PlanContract) {
  editingPlanId.value = row.id;
  planForm.value = {
    planType: row.planType,
    name: row.name,
    providerType: row.providerType,
    providerAccountId: row.providerAccountId,
    totalAmount: row.totalAmount,
    usedAmount: row.usedAmount,
    unit: row.unit,
    period: row.period,
    reminderDays: row.reminderDays,
    notes: row.notes,
  };
  purchasedAtLocal.value = toLocalInput(row.purchasedAt);
  validFromLocal.value = toLocalInput(row.validFrom);
  validUntilLocal.value = toLocalInput(row.validUntil);
  showPlanModal.value = true;
}

async function onSavePlan() {
  const purchasedAt = fromLocalInput(purchasedAtLocal.value);
  const validFrom = fromLocalInput(validFromLocal.value);
  if (!purchasedAt || !validFrom) {
    message.error(t('common.saveFailed'));
    return;
  }
  const body: CreatePlanRequest = {
    ...planForm.value,
    purchasedAt,
    validFrom,
    validUntil: fromLocalInput(validUntilLocal.value),
  };
  try {
    if (editingPlanId.value) {
      const { usedAmount: _, ...updateBody } = body;
      await updatePlan(editingPlanId.value, updateBody);
    } else {
      await createPlan(body);
    }
    showPlanModal.value = false;
    resetPlanForm();
    await loadPlans();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDeletePlan(row: PlanContract) {
  try {
    await deletePlan(row.id);
    await loadPlans();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

function scopeLabel(row: PlanContract): string {
  if (row.providerAccountId) {
    const name = upsKeys.value.find((u) => u.id === row.providerAccountId)?.name;
    return `${t('costs.upstream')}: ${name ?? row.providerAccountId}`;
  }
  if (row.providerType) return `${t('costs.providerType')}: ${row.providerType}`;
  return t('costs.noScope');
}

function formatRange(from: string, until: string | null): string {
  const start = new Date(from).toLocaleString('zh-CN');
  const end = until ? new Date(until).toLocaleString('zh-CN') : t('costs.noExpiry');
  return `${start} ~ ${end}`;
}

const planColumns = computed<DataTableColumns<PlanContract>>(() => [
  { title: t('costs.name'), key: 'name' },
  { title: t('costs.planType'), key: 'planType' },
  { title: t('costs.scope'), key: 'scope', render: (row) => scopeLabel(row) },
  { title: t('costs.totalAmount'), key: 'totalAmount' },
  { title: t('costs.usedAmount'), key: 'usedAmount' },
  { title: t('costs.remainingAmount'), key: 'remainingAmount' },
  { title: t('costs.unit'), key: 'unit' },
  { title: t('costs.period'), key: 'period' },
  {
    title: t('costs.validity'),
    key: 'validity',
    render: (row) => formatRange(row.validFrom, row.validUntil),
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
              { size: 'small', onClick: () => openEditPlan(row) },
              { default: () => t('common.edit') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDeletePlan(row) },
              {
                trigger: () =>
                  h(
                    NButton,
                    { size: 'small', type: 'error' },
                    { default: () => t('common.delete') },
                  ),
                default: () => t('costs.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
]);

onMounted(() => {
  void loadPricing();
  void loadPlans();
});
</script>

<template>
  <NCard :title="t('costs.title')">
    <NTabs type="line" animated>
      <NTabPane name="pricing" :tab="t('costs.pricing')">
        <NSpace vertical :size="16">
          <NSpace justify="end">
            <NButton type="primary" @click="openCreatePricing">{{
              t('costs.createPricing')
            }}</NButton>
          </NSpace>
          <NDataTable
            :columns="pricingColumns"
            :data="pricingEntries"
            :loading="pricingLoading"
            :row-key="(row) => row.id"
          />
        </NSpace>

        <NModal
          v-model:show="showPricingModal"
          :title="editingPricingId ? t('common.edit') : t('costs.createPricing')"
          preset="card"
          style="width: 600px"
        >
          <NForm label-placement="left" label-width="120px">
            <NFormItem :label="t('costs.providerType')">
              <NSelect
                v-model:value="pricingForm.providerType"
                :options="providerTypeOptions"
                clearable
              />
            </NFormItem>
            <NFormItem :label="t('costs.upstream')">
              <NSelect
                v-model:value="pricingForm.providerAccountId"
                :options="upsOptions"
                clearable
              />
            </NFormItem>
            <NFormItem :label="t('costs.model')">
              <NInput
                v-model:value="pricingForm.realModelName"
                placeholder="* 留空表示该 provider 的通用定价"
              />
            </NFormItem>
            <NFormItem :label="t('costs.inputPrice')">
              <NInputNumber v-model:value="pricingForm.inputPricePer1k" :min="0" />
            </NFormItem>
            <NFormItem :label="t('costs.outputPrice')">
              <NInputNumber v-model:value="pricingForm.outputPricePer1k" :min="0" />
            </NFormItem>
            <NFormItem :label="t('costs.currency')">
              <NInput v-model:value="pricingForm.currency" />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton @click="showPricingModal = false">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" @click="onSavePricing">{{ t('common.save') }}</NButton>
          </NSpace>
        </NModal>
      </NTabPane>

      <NTabPane name="plans" :tab="t('costs.plans')">
        <NSpace vertical :size="16">
          <NSpace justify="end">
            <NButton type="primary" @click="openCreatePlan">{{ t('costs.create') }}</NButton>
          </NSpace>
          <NDataTable
            :columns="planColumns"
            :data="plans"
            :loading="plansLoading"
            :row-key="(row) => row.id"
          />
        </NSpace>

        <NModal
          v-model:show="showPlanModal"
          :title="editingPlanId ? t('costs.edit') : t('costs.create')"
          preset="card"
          style="width: 600px"
        >
          <NForm label-placement="left" label-width="140px">
            <NFormItem :label="t('costs.planType')">
              <NSelect v-model:value="planForm.planType" :options="planTypeOptions" />
            </NFormItem>
            <NFormItem :label="t('costs.name')">
              <NInput v-model:value="planForm.name" />
            </NFormItem>
            <NFormItem :label="t('costs.providerType')">
              <NSelect
                v-model:value="planForm.providerType"
                :options="providerTypeOptions"
                clearable
              />
            </NFormItem>
            <NFormItem :label="t('costs.upstream')">
              <NSelect v-model:value="planForm.providerAccountId" :options="upsOptions" clearable />
            </NFormItem>
            <NFormItem :label="t('costs.totalAmount')">
              <NInputNumber v-model:value="planForm.totalAmount" :min="0" />
            </NFormItem>
            <NFormItem :label="t('costs.unit')">
              <NInput v-model:value="planForm.unit" />
            </NFormItem>
            <NFormItem :label="t('costs.period')">
              <NSelect v-model:value="planForm.period" :options="periodOptions" />
            </NFormItem>
            <NFormItem :label="t('costs.purchasedAt')">
              <NInput v-model:value="purchasedAtLocal" :type="'datetime-local' as any" />
            </NFormItem>
            <NFormItem :label="t('costs.validFrom')">
              <NInput v-model:value="validFromLocal" :type="'datetime-local' as any" />
            </NFormItem>
            <NFormItem :label="t('costs.validUntil')">
              <NInput v-model:value="validUntilLocal" :type="'datetime-local' as any" />
            </NFormItem>
            <NFormItem :label="t('costs.reminderDays')">
              <NInputNumber v-model:value="planForm.reminderDays" :min="0" />
            </NFormItem>
            <NFormItem :label="t('costs.notes')">
              <NInput v-model:value="planForm.notes" type="textarea" />
            </NFormItem>
          </NForm>
          <NSpace justify="end">
            <NButton @click="showPlanModal = false">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" @click="onSavePlan">{{ t('common.save') }}</NButton>
          </NSpace>
        </NModal>
      </NTabPane>
    </NTabs>
  </NCard>
</template>
