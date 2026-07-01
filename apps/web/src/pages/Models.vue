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
  NTabs,
  NTabPane,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,
} from '../api/admin/models.js';
import { listProviderAccounts } from '../api/admin/provider-accounts.js';
import { listEndpoints } from '../api/admin/endpoints.js';
import type { ModelWithCandidates } from '../api/admin/models.js';
import type { ModelContract, EndpointContract } from '@manageyourllm/contracts';
import type { ProviderAccount } from '../api/admin/provider-accounts.js';
import type { DataTableColumns } from 'naive-ui';
import ModelReferenceContent from '../components/ModelReferenceContent.vue';
import ChannelsContent from '../components/ChannelsContent.vue';

const { t } = useI18n();
const message = useMessage();

const models = ref<ModelContract[]>([]);
const providerAccounts = ref<ProviderAccount[]>([]);
const endpoints = ref<EndpointContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingModel = ref<ModelWithCandidates | null>(null);
const form = ref({
  name: '',
  displayName: '',
  description: '',
  enabled: true,
  candidates: [] as {
    providerAccountId: string;
    endpointId: string;
    realModelName: string;
    priority: number;
    enabled: boolean;
  }[],
});

async function load() {
  loading.value = true;
  try {
    const [modelsData, accountsData] = await Promise.all([listModels(), listProviderAccounts()]);
    models.value = modelsData;
    providerAccounts.value = accountsData;
    // 拉取每个 providerAccount 下的 endpoints 列表，铺平聚合。
    const lists = await Promise.all(accountsData.map((a) => listEndpoints(a.id).catch(() => [])));
    endpoints.value = lists.flat();
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = {
    name: '',
    displayName: '',
    description: '',
    enabled: true,
    candidates: [],
  };
}

function openCreate() {
  editingModel.value = null;
  resetForm();
  showModal.value = true;
}

async function openEdit(row: ModelContract) {
  const full = await getModel(row.id);
  editingModel.value = full;
  form.value = {
    name: full.name,
    displayName: full.displayName ?? '',
    description: full.description ?? '',
    enabled: full.enabled,
    candidates: full.candidates.map((c) => ({
      providerAccountId: c.providerAccountId,
      endpointId: c.endpointId,
      realModelName: c.realModelName,
      priority: c.priority,
      enabled: c.enabled,
    })),
  };
  showModal.value = true;
}

function addCandidate() {
  form.value.candidates.push({
    providerAccountId: '',
    endpointId: '',
    realModelName: '',
    priority: 100,
    enabled: true,
  });
}

function removeCandidate(index: number) {
  form.value.candidates.splice(index, 1);
}

async function onSave() {
  try {
    const payload = {
      name: form.value.name,
      displayName: form.value.displayName || undefined,
      description: form.value.description || undefined,
      enabled: form.value.enabled,
      candidates: form.value.candidates,
    };
    if (editingModel.value) {
      await updateModel(editingModel.value.id, payload);
    } else {
      await createModel(payload);
    }
    showModal.value = false;
    await load();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(row: ModelContract) {
  try {
    await deleteModel(row.id);
    await load();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const columns: DataTableColumns<ModelContract> = [
  { title: t('models.name'), key: 'name' },
  { title: t('models.displayName'), key: 'displayName' },
  { title: t('models.candidates'), key: 'candidates' },
  {
    title: t('models.enabled'),
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
                default: () => t('models.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
];

const providerAccountOptions = computed(() =>
  providerAccounts.value.map((k) => ({ label: `${k.name} (${k.providerType})`, value: k.id })),
);

const endpointOptionsFor = (providerAccountId: string) =>
  endpoints.value
    .filter((e) => e.providerAccountId === providerAccountId)
    .map((e) => ({ label: `${e.baseUrl} (${e.protocol})`, value: e.id }));

onMounted(load);
</script>

<template>
  <NCard :title="t('models.title')">
    <NTabs type="line" animated>
      <NTabPane name="models" :tab="t('models.title')">
        <NSpace vertical :size="16">
          <NSpace justify="end">
            <NButton type="primary" @click="openCreate">{{ t('models.create') }}</NButton>
          </NSpace>
          <NDataTable
            :columns="columns"
            :data="models"
            :loading="loading"
            :row-key="(row) => row.id"
          />
        </NSpace>

        <NModal
          v-model:show="showModal"
          :title="editingModel ? t('models.edit') : t('models.create')"
          preset="card"
          style="width: 750px"
        >
          <NForm label-placement="left" label-width="100px">
            <NFormItem :label="t('models.name')">
              <NInput v-model:value="form.name" />
            </NFormItem>
            <NFormItem :label="t('models.displayName')">
              <NInput v-model:value="form.displayName" />
            </NFormItem>
            <NFormItem :label="t('models.description')">
              <NInput v-model:value="form.description" type="textarea" />
            </NFormItem>
            <NFormItem :label="t('models.enabled')">
              <NSwitch v-model:value="form.enabled" />
            </NFormItem>
          </NForm>

          <NCard :title="t('models.candidates')" size="small">
            <NSpace vertical :size="12">
              <NSpace v-for="(c, index) in form.candidates" :key="index" align="center" wrap>
                <NSelect
                  v-model:value="c.providerAccountId"
                  :options="providerAccountOptions"
                  :placeholder="t('models.providerAccount')"
                  style="width: 200px"
                  @update:value="() => (c.endpointId = '')"
                />
                <NSelect
                  v-model:value="c.endpointId"
                  :options="endpointOptionsFor(c.providerAccountId)"
                  :placeholder="t('models.endpoint')"
                  style="width: 220px"
                />
                <NInput
                  v-model:value="c.realModelName"
                  :placeholder="t('models.realModelName')"
                  style="width: 200px"
                />
                <NInputNumber
                  v-model:value="c.priority"
                  :placeholder="t('models.priority')"
                  style="width: 90px"
                />
                <NSwitch v-model:value="c.enabled" />
                <NButton size="small" type="error" @click="removeCandidate(index)">{{
                  t('common.delete')
                }}</NButton>
              </NSpace>
              <NButton size="small" @click="addCandidate">{{ t('models.addCandidate') }}</NButton>
            </NSpace>
          </NCard>

          <NSpace justify="end" style="margin-top: 16px">
            <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
          </NSpace>
        </NModal>
      </NTabPane>
      <NTabPane name="channels" :tab="t('channels.title')">
        <ChannelsContent />
      </NTabPane>
      <NTabPane name="reference" tab="Reference">
        <ModelReferenceContent />
      </NTabPane>
    </NTabs>
  </NCard>
</template>
