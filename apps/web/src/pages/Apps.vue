<script setup lang="ts">
import { ref, onMounted, computed, h } from 'vue';
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
  NSwitch,
  NSpin,
  NTag,
  NText,
  NPopconfirm,
  NSelect,
  type SelectOption,
  type SelectGroupOption,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { listApps, createApp, updateApp, deleteApp } from '../api/admin/apps.js';
import {
  listConsumerKeysByApp,
  createConsumerKey,
  getConsumerKey,
  updateConsumerKey,
  rotateConsumerKey,
  revokeConsumerKey,
  deleteConsumerKey,
  type ConsumerKeyWithAccess,
} from '../api/admin/consumer-keys.js';
import { listPublicModels } from '../api/admin/public-models.js';
import { listModelGroups } from '../api/admin/model-groups.js';
import type { AppContract, ConsumerKeyContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';

const { t } = useI18n();
const message = useMessage();

const apps = ref<AppContract[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingApp = ref<AppContract | null>(null);
const form = ref({ name: '', description: '', enabled: true });

const consumerKeyMap = ref<Record<string, ConsumerKeyContract[]>>({});
const consumerKeyLoading = ref<Record<string, boolean>>({});
const rawKeyModal = ref<{ show: boolean; title: string; rawKey: string }>({
  show: false,
  title: '',
  rawKey: '',
});

const publicModels = ref<Array<{ id: string; name: string }>>([]);
const modelGroups = ref<Array<{ id: string; name: string }>>([]);

const keyModal = ref<{
  show: boolean;
  appId: string;
  editing: ConsumerKeyContract | null;
  form: { name: string; accessMode: 'all' | 'restricted'; enabled: boolean; selectedTargets: string[] };
  loading: boolean;
}>({
  show: false,
  appId: '',
  editing: null,
  form: { name: '', accessMode: 'all', enabled: true, selectedTargets: [] },
  loading: false,
});

const targetOptions = computed<(SelectGroupOption | SelectOption)[]>(() => [
  {
    type: 'group',
    label: t('publicModels.title'),
    key: 'public_models',
    children: publicModels.value.map((m) => ({ label: m.name, value: `public_model:${m.id}` })),
  },
  {
    type: 'group',
    label: t('modelGroups.title'),
    key: 'model_groups',
    children: modelGroups.value.map((g) => ({ label: g.name, value: `model_group:${g.id}` })),
  },
]);

async function loadTargets() {
  const [models, groups] = await Promise.all([listPublicModels(), listModelGroups()]);
  publicModels.value = models.map((m) => ({ id: m.id, name: m.displayName || m.name }));
  modelGroups.value = groups.map((g) => ({ id: g.id, name: g.displayName || g.name }));
}

async function loadApps() {
  loading.value = true;
  try {
    apps.value = await listApps();
    for (const app of apps.value) {
      await loadConsumerKeys(app.id);
    }
  } finally {
    loading.value = false;
  }
}

async function loadConsumerKeys(appId: string) {
  consumerKeyLoading.value[appId] = true;
  try {
    consumerKeyMap.value[appId] = await listConsumerKeysByApp(appId);
  } finally {
    consumerKeyLoading.value[appId] = false;
  }
}

function openCreate() {
  editingApp.value = null;
  form.value = { name: '', description: '', enabled: true };
  showModal.value = true;
}

function openEdit(app: AppContract) {
  editingApp.value = app;
  form.value = { name: app.name, description: app.description ?? '', enabled: app.enabled };
  showModal.value = true;
}

async function onSave() {
  try {
    if (editingApp.value) {
      await updateApp(editingApp.value.id, form.value);
    } else {
      await createApp(form.value);
    }
    showModal.value = false;
    await loadApps();
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(app: AppContract) {
  try {
    await deleteApp(app.id);
    await loadApps();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

async function createKey(app: AppContract) {
  try {
    const res = await createConsumerKey({ appId: app.id, name: t('apps.defaultKeyName') });
    await loadConsumerKeys(app.id);
    rawKeyModal.value = { show: true, title: t('apps.newKeyCreated'), rawKey: res.rawKey };
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function openKeyEdit(appId: string, key: ConsumerKeyContract) {
  keyModal.value = {
    show: true,
    appId,
    editing: key,
    form: { name: key.name, accessMode: key.accessMode, enabled: key.enabled, selectedTargets: [] },
    loading: true,
  };
  try {
    const detail: ConsumerKeyWithAccess = await getConsumerKey(key.id);
    keyModal.value.form.selectedTargets = detail.access.map(
      (a) => `${a.targetType}:${a.targetId}`,
    );
  } finally {
    keyModal.value.loading = false;
  }
}

async function onSaveKey() {
  const { editing, appId, form } = keyModal.value;
  if (!editing) return;
  const body: Parameters<typeof updateConsumerKey>[1] = {
    name: form.name,
    accessMode: form.accessMode,
    enabled: form.enabled,
  };
  if (form.accessMode === 'restricted') {
    body.accessTargets = form.selectedTargets.map((value) => {
      const [targetType, ...rest] = value.split(':');
      return { targetType: targetType as 'public_model' | 'model_group', targetId: rest.join(':') };
    });
  }
  try {
    await updateConsumerKey(editing.id, body);
    keyModal.value.show = false;
    await loadConsumerKeys(appId);
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function rotateKey(appId: string, key: ConsumerKeyContract) {
  try {
    const res = await rotateConsumerKey(key.id);
    await loadConsumerKeys(appId);
    rawKeyModal.value = { show: true, title: t('apps.keyRotated'), rawKey: res.rawKey };
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function revokeKey(appId: string, key: ConsumerKeyContract) {
  try {
    await revokeConsumerKey(key.id);
    await loadConsumerKeys(appId);
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function removeKey(appId: string, key: ConsumerKeyContract) {
  try {
    await deleteConsumerKey(key.id);
    await loadConsumerKeys(appId);
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

const columns: DataTableColumns<AppContract> = [
  { title: t('apps.name'), key: 'name' },
  { title: t('apps.description'), key: 'description' },
  {
    title: t('apps.enabled'),
    key: 'enabled',
    render(row) {
      return h(NTag, { type: row.enabled ? 'success' : 'default' }, { default: () => (row.enabled ? t('common.yes') : t('common.no')) });
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => t('common.edit') }),
          h(NButton, { size: 'small', onClick: () => createKey(row) }, { default: () => t('apps.createKey') }),
          h(NPopconfirm, { onPositiveClick: () => onDelete(row) }, {
            trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => t('common.delete') }),
            default: () => t('apps.confirmDelete'),
          }),
        ],
      });
    },
  },
];

onMounted(async () => {
  await loadTargets();
  await loadApps();
});
</script>

<template>
  <NCard :title="t('apps.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('apps.create') }}</NButton>
      </NSpace>
      <NDataTable :columns="columns" :data="apps" :loading="loading" :row-key="(row) => row.id" />

      <NModal v-model:show="showModal" :title="editingApp ? t('apps.edit') : t('apps.create')" preset="card" style="width: 480px">
        <NForm label-placement="left" label-width="80px">
          <NFormItem :label="t('apps.name')">
            <NInput v-model:value="form.name" />
          </NFormItem>
          <NFormItem :label="t('apps.description')">
            <NInput v-model:value="form.description" type="textarea" />
          </NFormItem>
          <NFormItem :label="t('apps.enabled')">
            <NSwitch v-model:value="form.enabled" />
          </NFormItem>
        </NForm>
        <NSpace justify="end">
          <NButton @click="showModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
        </NSpace>
      </NModal>

      <NModal v-model:show="rawKeyModal.show" :title="rawKeyModal.title" preset="card" style="width: 520px">
        <NSpin :show="false">
          <NFormItem :label="t('apps.rawKey')">
            <NInput :value="rawKeyModal.rawKey" readonly />
          </NFormItem>
          <NText type="warning">{{ t('apps.rawKeyWarning') }}</NText>
        </NSpin>
        <template #footer>
          <NSpace justify="end">
            <NButton @click="rawKeyModal.show = false">{{ t('common.close') }}</NButton>
          </NSpace>
        </template>
      </NModal>

      <NModal v-model:show="keyModal.show" :title="t('consumerKeys.edit')" preset="card" style="width: 560px">
        <NSpin :show="keyModal.loading">
          <NForm label-placement="left" label-width="120px">
            <NFormItem :label="t('consumerKeys.name')">
              <NInput v-model:value="keyModal.form.name" />
            </NFormItem>
            <NFormItem :label="t('consumerKeys.enabled')">
              <NSwitch v-model:value="keyModal.form.enabled" />
            </NFormItem>
            <NFormItem :label="t('consumerKeys.accessMode')">
              <NSelect
                v-model:value="keyModal.form.accessMode"
                :options="[
                  { label: t('consumerKeys.accessModeAll'), value: 'all' },
                  { label: t('consumerKeys.accessModeRestricted'), value: 'restricted' },
                ]"
              />
            </NFormItem>
            <NFormItem v-if="keyModal.form.accessMode === 'restricted'" :label="t('consumerKeys.accessTargets')">
              <NSelect
                v-model:value="keyModal.form.selectedTargets"
                multiple
                :options="targetOptions"
                :placeholder="t('consumerKeys.accessTargets')"
              />
            </NFormItem>
          </NForm>
        </NSpin>
        <NSpace justify="end">
          <NButton @click="keyModal.show = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="keyModal.loading" @click="onSaveKey">{{ t('common.save') }}</NButton>
        </NSpace>
      </NModal>

      <NCard v-for="app in apps" :key="`keys-${app.id}`" :title="`${app.name} - ${t('apps.consumerKeys')}`" size="small">
        <NDataTable
          :data="consumerKeyMap[app.id] ?? []"
          :loading="consumerKeyLoading[app.id]"
          :columns="[
            { title: t('consumerKeys.name'), key: 'name' },
            { title: t('consumerKeys.prefix'), key: 'keyPrefix' },
            { title: t('consumerKeys.accessMode'), key: 'accessMode' },
            { title: t('consumerKeys.enabled'), key: 'enabled' },
            {
              title: t('common.actions'),
              key: 'actions',
              render(row) {
                return h(NSpace, { size: 'small' }, {
                  default: () => [
                    h(NButton, { size: 'small', onClick: () => openKeyEdit(app.id, row) }, { default: () => t('common.edit') }),
                    h(NButton, { size: 'small', onClick: () => rotateKey(app.id, row) }, { default: () => t('consumerKeys.rotate') }),
                    h(NButton, { size: 'small', onClick: () => revokeKey(app.id, row) }, { default: () => t('consumerKeys.revoke') }),
                    h(NPopconfirm, { onPositiveClick: () => removeKey(app.id, row) }, {
                      trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => t('common.delete') }),
                      default: () => t('consumerKeys.confirmDelete'),
                    }),
                  ],
                });
              },
            },
          ]"
          :row-key="(row) => row.id"
        />
      </NCard>
    </NSpace>
  </NCard>
</template>
