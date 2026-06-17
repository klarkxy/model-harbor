<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NCard,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
  NPopconfirm,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { upstreamKeysApi, type UpstreamKey, type UpstreamKeyCreatePayload } from '../api/admin.js';

const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const items = ref<UpstreamKey[]>([]);
const loading = ref(false);
const drawerOpen = ref(false);
const submitting = ref(false);

const form = ref<UpstreamKeyCreatePayload>({
  name: '',
  providerType: 'anthropic_compatible',
  baseUrl: '',
  apiKey: '',
  supportedModels: [],
  quota: { period: 'month' },
});
const supportedModelsText = ref('');

function resetForm() {
  form.value = {
    name: '',
    providerType: 'anthropic_compatible',
    baseUrl: '',
    apiKey: '',
    supportedModels: [],
    quota: { period: 'month' },
  };
  supportedModelsText.value = '';
}

async function refresh() {
  loading.value = true;
  try {
    const res = await upstreamKeysApi.list();
    items.value = res.items;
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

function openCreate() {
  resetForm();
  drawerOpen.value = true;
}

async function onSubmit() {
  if (!form.value.name || !form.value.baseUrl || !form.value.apiKey) {
    message.error(t('upstreamKeys.validation.required'));
    return;
  }
  submitting.value = true;
  try {
    const supportedModels = supportedModelsText.value
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload: UpstreamKeyCreatePayload = {
      ...form.value,
      supportedModels,
    };
    const quota = payload.quota;
    const hasAnyQuotaLimit = Boolean(
      quota?.requestLimit ||
      quota?.inputTokenLimit ||
      quota?.outputTokenLimit ||
      quota?.totalTokenLimit,
    );
    if (!hasAnyQuotaLimit) {
      payload.quota = undefined;
    }
    const created = await upstreamKeysApi.create(payload);
    items.value = [created, ...items.value];
    drawerOpen.value = false;
    message.success(t('upstreamKeys.toast.created'));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function toggleFreeze(row: UpstreamKey) {
  try {
    if (row.frozen) {
      const res = await upstreamKeysApi.unfreeze(row.id);
      message.success(
        res.frozen ? t('upstreamKeys.toast.frozen') : t('upstreamKeys.toast.unfrozen'),
      );
    } else {
      await upstreamKeysApi.freeze(row.id, 'manual freeze');
      message.success(t('upstreamKeys.toast.frozen'));
    }
    await refresh();
  } catch (err) {
    message.error((err as Error).message);
  }
}

const providerOptions = computed(() => [
  { label: t('upstreamKeys.drawer.providers.anthropic'), value: 'anthropic_compatible' },
  { label: t('upstreamKeys.drawer.providers.openai'), value: 'openai_compatible' },
]);

const periodOptions = computed(() => [
  { label: t('common.period.hour'), value: 'hour' },
  { label: t('common.period.day'), value: 'day' },
  { label: t('common.period.week'), value: 'week' },
  { label: t('common.period.month'), value: 'month' },
  { label: t('common.period.total'), value: 'total' },
]);

const columns = computed<DataTableColumns<UpstreamKey>>(() => [
  { title: t('upstreamKeys.columns.name'), key: 'name', fixed: 'left', width: 200 },
  {
    title: t('upstreamKeys.columns.provider'),
    key: 'providerType',
    width: 180,
    render: (row) => h(NTag, { type: 'info', size: 'small' }, () => row.providerType),
  },
  { title: t('upstreamKeys.columns.baseUrl'), key: 'baseUrl', ellipsis: { tooltip: true } },
  {
    title: t('upstreamKeys.columns.models'),
    key: 'supportedModels',
    width: 80,
    render: (row) => String(row.supportedModels.length),
  },
  {
    title: t('upstreamKeys.columns.status'),
    key: 'status',
    width: 110,
    render: (row) =>
      row.frozen
        ? h(NTag, { type: 'warning', size: 'small' }, () => t('upstreamKeys.status.frozen'))
        : row.enabled
          ? h(NTag, { type: 'success', size: 'small' }, () => t('upstreamKeys.status.active'))
          : h(NTag, { type: 'default', size: 'small' }, () => t('upstreamKeys.status.disabled')),
  },
  {
    title: t('upstreamKeys.columns.actions'),
    key: 'actions',
    width: 180,
    render: (row) =>
      h(NSpace, { size: 'small' }, () => [
        h(
          NPopconfirm,
          { onPositiveClick: () => toggleFreeze(row) },
          {
            trigger: () =>
              h(NButton, { size: 'small', type: row.frozen ? 'primary' : 'warning' }, () =>
                row.frozen ? t('upstreamKeys.actions.unfreeze') : t('upstreamKeys.actions.freeze'),
              ),
            default: () =>
              row.frozen ? t('upstreamKeys.confirm.unfreeze') : t('upstreamKeys.confirm.freeze'),
          },
        ),
      ]),
  },
]);
</script>

<template>
  <div class="page">
    <NCard>
      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NText strong>{{ t('upstreamKeys.title') }}</NText>
        <NButton type="primary" @click="openCreate">{{ t('upstreamKeys.new') }}</NButton>
      </NSpace>

      <NDataTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :single-line="false"
        :row-key="(row) => row.id"
        :empty="h(NEmpty, { description: t('upstreamKeys.empty') })"
      />
    </NCard>

    <NDrawer v-model:show="drawerOpen" :width="480">
      <NDrawerContent :title="t('upstreamKeys.drawer.title')" closable>
        <NForm label-placement="top">
          <NFormItem :label="t('upstreamKeys.drawer.name')" required>
            <NInput
              v-model:value="form.name"
              :placeholder="t('upstreamKeys.drawer.placeholders.name')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.provider')" required>
            <NSelect v-model:value="form.providerType" :options="providerOptions" />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.baseUrl')" required>
            <NInput
              v-model:value="form.baseUrl"
              :placeholder="t('upstreamKeys.drawer.placeholders.baseUrl')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.apiKey')" required>
            <NInput
              v-model:value="form.apiKey"
              type="password"
              show-password-on="click"
              :placeholder="t('upstreamKeys.drawer.placeholders.apiKey')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.supportedModels')">
            <NInput
              v-model:value="supportedModelsText"
              type="textarea"
              :rows="3"
              :placeholder="t('upstreamKeys.drawer.placeholders.supportedModels')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.quotaPeriod')">
            <NSelect v-model:value="form.quota!.period" :options="periodOptions" />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.requestLimit')">
            <NInputNumber
              v-model:value="form.quota!.requestLimit"
              :min="0"
              :placeholder="t('common.optional')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.inputTokenLimit')">
            <NInputNumber
              v-model:value="form.quota!.inputTokenLimit"
              :min="0"
              :placeholder="t('common.optional')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.outputTokenLimit')">
            <NInputNumber
              v-model:value="form.quota!.outputTokenLimit"
              :min="0"
              :placeholder="t('common.optional')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.totalTokenLimit')">
            <NInputNumber
              v-model:value="form.quota!.totalTokenLimit"
              :min="0"
              :placeholder="t('common.optional')"
            />
          </NFormItem>
        </NForm>
        <template #footer>
          <NSpace justify="end">
            <NButton @click="drawerOpen = false">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" :loading="submitting" @click="onSubmit">{{
              t('common.create')
            }}</NButton>
          </NSpace>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
