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
  NSpin,
  NEmpty,
  NEllipsis,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listProviderAccounts,
  createProviderAccount,
  updateProviderAccount,
  deleteProviderAccount,
  rotateProviderAccount,
  freezeProviderAccount,
  unfreezeProviderAccount,
  discoverProviderAccountModels,
  pingProviderAccount,
} from '../api/admin/provider-accounts.js';
import type { ProviderAccount } from '../api/admin/provider-accounts.js';
import { listProviderPresets } from '../api/admin/provider-presets.js';
import { listBreakers, resetBreaker } from '../api/admin/resilience.js';
import type { CircuitBreakerContract } from '@manageyourllm/contracts';
import type { ProviderPresetContract, DiscoveredModel } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const keys = ref<ProviderAccount[]>([]);
const presets = ref<ProviderPresetContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingKey = ref<ProviderAccount | null>(null);
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

const discoverModal = ref<{ show: boolean; models: DiscoveredModel[] }>({
  show: false,
  models: [],
});

const pingModal = ref<{ show: boolean; id: string; model: string; result: string }>({
  show: false,
  id: '',
  model: '',
  result: '',
});

const breakerModal = ref<{
  show: boolean;
  providerAccountId: string;
  breakers: CircuitBreakerContract[];
  loading: boolean;
}>({
  show: false,
  providerAccountId: '',
  breakers: [],
  loading: false,
});

async function load() {
  loading.value = true;
  try {
    [keys.value, presets.value] = await Promise.all([
      listProviderAccounts(),
      listProviderPresets(),
    ]);
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

function openEdit(row: ProviderAccount) {
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
      await updateProviderAccount(editingKey.value.id, payload);
    } else {
      await createProviderAccount(payload);
    }
    showModal.value = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: ProviderAccount) {
  try {
    await deleteProviderAccount(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

async function onFreeze(row: ProviderAccount) {
  try {
    await freezeProviderAccount(row.id, t('providerAccounts.manualFreeze'));
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onUnfreeze(row: ProviderAccount) {
  try {
    await unfreezeProviderAccount(row.id);
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onRotateSubmit() {
  try {
    await rotateProviderAccount(rotateModal.value.id, rotateModal.value.apiKey);
    rotateModal.value.show = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDiscover(row: ProviderAccount) {
  try {
    const models = await discoverProviderAccountModels(row.id);
    discoverModal.value = { show: true, models };
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('providerAccounts.discoverFailed'));
  }
}

async function onPing(row: ProviderAccount) {
  pingModal.value = {
    show: true,
    id: row.id,
    model: row.supportedModelsJson?.[0] ?? '',
    result: '',
  };
}

async function onPingSubmit() {
  try {
    const result = await pingProviderAccount(
      pingModal.value.id,
      pingModal.value.model || undefined,
    );
    pingModal.value.result = result.ok
      ? t('providerAccounts.pingOk', { latency: result.latencyMs })
      : t('providerAccounts.pingFailed', { error: result.error ?? '' });
  } catch (err) {
    pingModal.value.result = t('providerAccounts.pingFailed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function openBreakers(row: ProviderAccount) {
  breakerModal.value = { show: true, providerAccountId: row.id, breakers: [], loading: true };
  try {
    const all = await listBreakers();
    breakerModal.value.breakers = all.filter((b) => b.providerAccountId === row.id);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    breakerModal.value.loading = false;
  }
}

async function onResetBreaker(breaker: CircuitBreakerContract) {
  try {
    // 收口 #3：必须把 endpointId 透传给后端；contract schema 现在保证这个字段存在。
    if (!breaker.endpointId) {
      message.error('breaker.endpointId 缺失，无法重置');
      return;
    }
    await resetBreaker(breaker.providerAccountId, breaker.realModelName, breaker.endpointId);
    message.success(t('common.saved'));
    await openBreakers({ id: breakerModal.value.providerAccountId } as ProviderAccount);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

function breakerStateType(state: string) {
  switch (state) {
    case 'open':
      return 'error';
    case 'half_open':
      return 'warning';
    default:
      return 'success';
  }
}

const columns: DataTableColumns<ProviderAccount> = [
  { title: t('providerAccounts.name'), key: 'name' },
  { title: t('providerAccounts.providerType'), key: 'providerType' },
  { title: t('providerAccounts.baseUrl'), key: 'baseUrl' },
  { title: t('providerAccounts.apiKeyPrefix'), key: 'apiKeyPrefix' },
  {
    title: t('providerAccounts.status'),
    key: 'status',
    render(row) {
      const tags: ReturnType<typeof h>[] = [];
      if (row.frozen)
        tags.push(h(NTag, { type: 'warning' }, { default: () => t('providerAccounts.frozen') }));
      if (!row.enabled)
        tags.push(h(NTag, { type: 'default' }, { default: () => t('providerAccounts.disabled') }));
      if (tags.length === 0)
        tags.push(h(NTag, { type: 'success' }, { default: () => t('providerAccounts.active') }));
      return h(NSpace, { size: 4 }, { default: () => tags });
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
              NButton,
              { size: 'small', onClick: () => onDiscover(row) },
              { default: () => t('providerAccounts.discover') },
            ),
            h(
              NButton,
              { size: 'small', onClick: () => onPing(row) },
              { default: () => t('providerAccounts.ping') },
            ),
            h(
              NButton,
              {
                size: 'small',
                onClick: () => {
                  rotateModal.value = { show: true, id: row.id, apiKey: '' };
                },
              },
              { default: () => t('providerAccounts.rotate') },
            ),
            row.frozen
              ? h(
                  NButton,
                  { size: 'small', onClick: () => onUnfreeze(row) },
                  { default: () => t('providerAccounts.unfreeze') },
                )
              : h(
                  NButton,
                  { size: 'small', onClick: () => onFreeze(row) },
                  { default: () => t('providerAccounts.freeze') },
                ),
            h(
              NButton,
              { size: 'small', onClick: () => openBreakers(row) },
              { default: () => t('providerAccounts.breakers') },
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
                default: () => t('providerAccounts.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
];

const presetOptions = computed(() =>
  presets.value.map((p) => ({ label: `${p.name} (${p.source})`, value: p.id })),
);

onMounted(load);
</script>

<template>
  <NCard :title="t('providerAccounts.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('providerAccounts.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="keys" :loading="loading" :row-key="(row) => row.id" />
    </NSpace>

    <NModal
      v-model:show="showModal"
      :title="editingKey ? t('providerAccounts.edit') : t('providerAccounts.create')"
      preset="card"
      style="width: 560px"
    >
      <NForm label-placement="left" label-width="100px">
        <NFormItem :label="t('providerAccounts.name')">
          <NInput v-model:value="form.name" />
        </NFormItem>
        <NFormItem :label="t('providerAccounts.providerPreset')">
          <NSelect
            v-model:value="form.providerPresetId"
            :options="presetOptions"
            clearable
            @update:value="onPresetChange"
          />
        </NFormItem>
        <NFormItem :label="t('providerAccounts.providerType')">
          <NInput v-model:value="form.providerType" />
        </NFormItem>
        <NFormItem :label="t('providerAccounts.baseUrl')">
          <NInput v-model:value="form.baseUrl" />
        </NFormItem>
        <NFormItem
          :label="editingKey ? t('providerAccounts.newApiKey') : t('providerAccounts.apiKey')"
        >
          <NInput v-model:value="form.apiKey" type="password" />
        </NFormItem>
        <NFormItem :label="t('providerAccounts.enabled')">
          <NSwitch v-model:value="form.enabled" />
        </NFormItem>
      </NForm>
      <NSpace justify="end">
        <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="rotateModal.show"
      :title="t('providerAccounts.rotate')"
      preset="card"
      style="width: 480px"
    >
      <NFormItem :label="t('providerAccounts.newApiKey')">
        <NInput v-model:value="rotateModal.apiKey" type="password" />
      </NFormItem>
      <NSpace justify="end">
        <NButton @click="rotateModal.show = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onRotateSubmit">{{ t('common.save') }}</NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="discoverModal.show"
      :title="t('providerAccounts.discover')"
      preset="card"
      style="width: 480px"
    >
      <NDataTable
        :columns="[
          { title: 'ID', key: 'id' },
          { title: 'Object', key: 'object' },
          { title: 'Owned By', key: 'ownedBy' },
        ]"
        :data="discoverModal.models"
        :row-key="(row) => row.id"
      />
      <NSpace justify="end">
        <NButton @click="discoverModal.show = false">{{ t('common.close') }}</NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="breakerModal.show"
      :title="t('breaker.title')"
      preset="card"
      style="width: 720px; max-width: 90vw"
    >
      <NSpin v-if="breakerModal.loading" />
      <NDataTable
        v-else
        :columns="[
          { title: t('breaker.realModelName'), key: 'realModelName' },
          {
            title: t('breaker.state'),
            key: 'state',
            render: (row) =>
              h(
                NTag,
                { type: breakerStateType(row.state), size: 'small' },
                { default: () => t(`breaker.state.${row.state}`) },
              ),
          },
          { title: t('breaker.failureCount'), key: 'failureCount' },
          { title: t('breaker.successCount'), key: 'successCount' },
          {
            title: t('breaker.lastErrorCode'),
            key: 'lastErrorCode',
            render: (row) => row.lastErrorCode || '-',
          },
          {
            title: t('breaker.lastErrorMessage'),
            key: 'lastErrorMessage',
            width: 220,
            render: (row) =>
              row.lastErrorMessage
                ? h(NEllipsis, { tooltip: true }, { default: () => row.lastErrorMessage })
                : '-',
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (row) =>
              h(
                NButton,
                { size: 'small', onClick: () => onResetBreaker(row) },
                { default: () => t('providerAccounts.resetBreaker') },
              ),
          },
        ]"
        :data="breakerModal.breakers"
        :bordered="false"
        size="small"
        :row-key="(row) => `${row.providerAccountId}:${row.realModelName}`"
      />
      <NEmpty
        v-if="!breakerModal.loading && breakerModal.breakers.length === 0"
        :description="t('breaker.noBreakers')"
      />
      <NSpace justify="end" style="margin-top: 12px">
        <NButton @click="breakerModal.show = false">{{ t('common.close') }}</NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="pingModal.show"
      :title="t('providerAccounts.ping')"
      preset="card"
      style="width: 480px"
    >
      <NForm label-placement="left" label-width="80px">
        <NFormItem :label="t('providerAccounts.realModelName')">
          <NInput v-model:value="pingModal.model" />
        </NFormItem>
      </NForm>
      <NInput
        v-if="pingModal.result"
        :value="pingModal.result"
        type="textarea"
        readonly
        :autosize="{ minRows: 2, maxRows: 4 }"
      />
      <NSpace justify="end">
        <NButton @click="pingModal.show = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" @click="onPingSubmit">{{ t('providerAccounts.ping') }}</NButton>
      </NSpace>
    </NModal>
  </NCard>
</template>
