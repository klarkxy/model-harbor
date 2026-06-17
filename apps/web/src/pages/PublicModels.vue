<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
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
  NSpace,
  NTag,
  NText,
  NPopconfirm,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  publicModelsApi,
  upstreamKeysApi,
  type PublicModel,
  type PublicModelCreatePayload,
  type UpstreamKey,
} from '../api/admin.js';

const message = useMessage();
const { t } = useI18n();

const items = ref<PublicModel[]>([]);
const upstreamKeyOptions = ref<UpstreamKey[]>([]);
const loading = ref(false);
const drawerOpen = ref(false);
const submitting = ref(false);

const form = ref<PublicModelCreatePayload>({
  name: '',
  displayName: '',
  description: '',
  candidates: [],
});

const candidateRows = ref<
  Array<{ upstreamKeyId: string; realModelName: string; priority: number }>
>([]);

function resetForm() {
  form.value = { name: '', displayName: '', description: '', candidates: [] };
  candidateRows.value = [];
}

async function refresh() {
  loading.value = true;
  try {
    const [res, ukRes] = await Promise.all([publicModelsApi.list(), upstreamKeysApi.list()]);
    items.value = res.items;
    upstreamKeyOptions.value = ukRes.items;
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

function addCandidate() {
  if (upstreamKeyOptions.value.length === 0) {
    message.warning(t('publicModels.toast.createUpstreamKeyFirst'));
    return;
  }
  candidateRows.value.push({
    upstreamKeyId: upstreamKeyOptions.value[0]!.id,
    realModelName: '',
    priority: 100,
  });
}

function removeCandidate(idx: number) {
  candidateRows.value.splice(idx, 1);
}

async function onSubmit() {
  if (!form.value.name) {
    message.error(t('publicModels.validation.required'));
    return;
  }
  submitting.value = true;
  try {
    const payload: PublicModelCreatePayload = {
      name: form.value.name.trim(),
      displayName: form.value.displayName?.trim() || undefined,
      description: form.value.description?.trim() || undefined,
      candidates: candidateRows.value
        .filter((c) => c.realModelName.trim())
        .map((c) => ({
          upstreamKeyId: c.upstreamKeyId,
          realModelName: c.realModelName.trim(),
          priority: c.priority,
        })),
    };
    const created = await publicModelsApi.create(payload);
    items.value = [created, ...items.value];
    drawerOpen.value = false;
    message.success(t('publicModels.toast.created'));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function remove(row: PublicModel) {
  try {
    await publicModelsApi.remove(row.id);
    items.value = items.value.filter((i) => i.id !== row.id);
    message.success(t('publicModels.toast.deleted'));
  } catch (err) {
    message.error((err as Error).message);
  }
}

const columns = computed<DataTableColumns<PublicModel>>(() => [
  { title: t('publicModels.columns.name'), key: 'name', width: 220 },
  { title: t('publicModels.columns.displayName'), key: 'displayName', width: 200 },
  { title: t('publicModels.columns.candidates'), key: 'candidateCount', width: 100 },
  {
    title: t('publicModels.columns.status'),
    key: 'enabled',
    width: 100,
    render: (row) =>
      row.enabled
        ? h(NTag, { type: 'success', size: 'small' }, () => t('publicModels.status.enabled'))
        : h(NTag, { type: 'default', size: 'small' }, () => t('publicModels.status.disabled')),
  },
  {
    title: t('publicModels.columns.actions'),
    key: 'actions',
    width: 110,
    render: (row) =>
      h(
        NPopconfirm,
        { onPositiveClick: () => remove(row) },
        {
          trigger: () =>
            h(NButton, { size: 'small', type: 'error' }, () => t('publicModels.actions.delete')),
          default: () => t('publicModels.confirm', { name: row.name }),
        },
      ),
  },
]);

const keyOptions = computed(() =>
  upstreamKeyOptions.value.map((k) => ({ label: `${k.name} (${k.apiKeyPrefix}…)`, value: k.id })),
);
</script>

<template>
  <div class="page">
    <NCard>
      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NText strong>{{ t('publicModels.title') }}</NText>
        <NButton type="primary" @click="openCreate">{{ t('publicModels.new') }}</NButton>
      </NSpace>

      <NDataTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :single-line="false"
        :row-key="(row) => row.id"
        :empty="h(NEmpty, { description: t('publicModels.empty') })"
      />
    </NCard>

    <NDrawer v-model:show="drawerOpen" :width="560">
      <NDrawerContent :title="t('publicModels.drawer.title')" closable>
        <NForm label-placement="top">
          <NFormItem :label="t('publicModels.drawer.name')" required>
            <NInput
              v-model:value="form.name"
              :placeholder="t('publicModels.drawer.placeholders.name')"
            />
          </NFormItem>
          <NFormItem :label="t('publicModels.drawer.displayName')">
            <NInput
              v-model:value="form.displayName"
              :placeholder="t('publicModels.drawer.placeholders.displayName')"
            />
          </NFormItem>
          <NFormItem :label="t('publicModels.drawer.description')">
            <NInput v-model:value="form.description" type="textarea" :rows="2" />
          </NFormItem>
          <NFormItem :label="t('publicModels.drawer.candidates')">
            <NSpace vertical size="small" style="width: 100%">
              <div
                v-for="(c, idx) in candidateRows"
                :key="idx"
                style="display: flex; gap: 8px; align-items: center"
              >
                <NSelect
                  v-model:value="c.upstreamKeyId"
                  :options="keyOptions"
                  style="flex: 1"
                  :placeholder="t('publicModels.drawer.placeholders.upstreamKey')"
                />
                <NInput
                  v-model:value="c.realModelName"
                  style="flex: 1"
                  :placeholder="t('publicModels.drawer.placeholders.realModelName')"
                />
                <NInputNumber v-model:value="c.priority" :min="0" style="width: 90px" />
                <NButton size="small" type="error" tertiary @click="removeCandidate(idx)"
                  >×</NButton
                >
              </div>
              <NButton size="small" @click="addCandidate">{{
                t('publicModels.drawer.addCandidate')
              }}</NButton>
            </NSpace>
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
