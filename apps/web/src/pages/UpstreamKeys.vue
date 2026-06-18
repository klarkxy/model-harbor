<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
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
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NText,
  NPopconfirm,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  providerPresetsApi,
  upstreamKeysApi,
  type DiscoverModelsPayload,
  type ProviderPreset,
  type UpstreamKey,
  type UpstreamKeyCreatePayload,
} from '../api/admin.js';
import ModelMappingEditor, { type ModelMappingItem } from '../components/ModelMappingEditor.vue';

const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const items = ref<UpstreamKey[]>([]);
const loading = ref(false);
const drawerOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const isEdit = computed(() => Boolean(editingId.value));

const presets = ref<ProviderPreset[]>([]);
const presetsLoading = ref(false);
const selectedPresetId = ref<string | null>(null);

const form = ref<UpstreamKeyCreatePayload>({
  name: '',
  providerType: 'anthropic_compatible',
  baseUrl: '',
  apiKey: '',
});
const modelMappings = ref<ModelMappingItem[]>([]);
const fetchingModels = ref(false);
const togglingIds = ref<Set<string>>(new Set());

function resetForm() {
  form.value = {
    name: '',
    providerType: 'anthropic_compatible',
    baseUrl: '',
    apiKey: '',
  };
  selectedPresetId.value = null;
  modelMappings.value = [];
  editingId.value = null;
}

async function refresh() {
  loading.value = true;
  presetsLoading.value = true;
  try {
    const [keysRes, presetsRes] = await Promise.all([
      upstreamKeysApi.list(),
      providerPresetsApi.list(),
    ]);
    items.value = keysRes.items;
    presets.value = presetsRes.items;
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    loading.value = false;
    presetsLoading.value = false;
  }
}

onMounted(refresh);

function openCreate() {
  resetForm();
  drawerOpen.value = true;
}

async function openEdit(row: UpstreamKey) {
  resetForm();
  editingId.value = row.id;
  form.value.name = row.name;
  form.value.providerType = row.providerType;
  form.value.baseUrl = row.baseUrl;
  form.value.apiKey = '';
  selectedPresetId.value = row.providerPresetId;
  try {
    const res = await upstreamKeysApi.getCandidates(row.id);
    modelMappings.value = res.items.map((c) => ({
      realName: c.realName,
      publicName: c.publicName === c.realName ? '' : c.publicName,
      enabled: c.enabled,
    }));
  } catch (err) {
    message.error((err as Error).message);
  }
  drawerOpen.value = true;
}

async function onSubmit() {
  const isPreset = Boolean(selectedPresetId.value);
  if (
    !form.value.name ||
    (!isEdit.value && !form.value.apiKey) ||
    (!isPreset && !form.value.baseUrl)
  ) {
    message.error(t('upstreamKeys.validation.required'));
    return;
  }
  const activeMappings = modelMappings.value.filter((m) => m.enabled && m.realName.trim() !== '');
  if (activeMappings.length === 0) {
    message.error(t('upstreamKeys.validation.modelMappings'));
    return;
  }
  submitting.value = true;
  try {
    const mappings = activeMappings.map((m) => ({
      realName: m.realName.trim(),
      publicName: m.publicName.trim() || m.realName.trim(),
      enabled: m.enabled,
    }));
    if (isEdit.value) {
      const id = editingId.value!;
      const updates: Parameters<typeof upstreamKeysApi.update>[1] = { name: form.value.name };
      if (!isPreset) {
        updates.providerType = form.value.providerType;
        updates.baseUrl = form.value.baseUrl;
      }
      await upstreamKeysApi.update(id, updates);
      if (form.value.apiKey) {
        await upstreamKeysApi.rotateSecret(id, form.value.apiKey);
      }
      await upstreamKeysApi.setCandidates(id, mappings);
      await refresh();
      drawerOpen.value = false;
      message.success(t('upstreamKeys.toast.updated'));
    } else {
      const payload: UpstreamKeyCreatePayload = {
        name: form.value.name,
        apiKey: form.value.apiKey,
        modelMappings: mappings,
      };
      if (isPreset) {
        payload.providerPresetId = selectedPresetId.value!;
      } else {
        payload.providerType = form.value.providerType;
        payload.baseUrl = form.value.baseUrl;
      }
      const created = await upstreamKeysApi.create(payload);
      items.value = [created, ...items.value];
      drawerOpen.value = false;
      message.success(t('upstreamKeys.toast.created'));
    }
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function toggleFreeze(row: UpstreamKey) {
  togglingIds.value = new Set(togglingIds.value).add(row.id);
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
  } finally {
    const next = new Set(togglingIds.value);
    next.delete(row.id);
    togglingIds.value = next;
  }
}

async function handleDelete(row: UpstreamKey) {
  try {
    await upstreamKeysApi.delete(row.id);
    message.success(t('upstreamKeys.toast.deleted'));
    await refresh();
  } catch (err) {
    message.error((err as Error).message);
  }
}

const providerOptions = computed(() => [
  { label: t('upstreamKeys.drawer.providers.anthropic'), value: 'anthropic_compatible' },
  { label: t('upstreamKeys.drawer.providers.openai'), value: 'openai_compatible' },
]);

const presetOptions = computed(() => [
  { label: t('upstreamKeys.drawer.preset.manual'), value: '' },
  ...presets.value.map((p) => ({
    label: `${p.icon ? `${p.icon} ` : ''}${t(`providers.${p.id}`)}`,
    value: p.id,
  })),
]);

const selectedPreset = computed(() => presets.value.find((p) => p.id === selectedPresetId.value));

function applyPreset(preset: ProviderPreset | undefined) {
  if (!preset) {
    selectedPresetId.value = null;
    if (!isEdit.value) {
      modelMappings.value = [];
    }
    return;
  }
  // Name follows the selected preset so the admin does not have to type it.
  if (!isEdit.value) {
    form.value.name = t(`providers.${preset.id}`);
  }
  // Use the preset's first endpoint as the recommended default.
  const endpoint = preset.endpoints[0];
  if (endpoint) {
    form.value.providerType = endpoint.providerType;
    form.value.baseUrl = endpoint.baseUrl;
  }
  // Never pre-fill hardcoded model mappings; the admin fetches from upstream.
  if (!isEdit.value) {
    modelMappings.value = [];
  }
}

watch(selectedPresetId, (id) => {
  applyPreset(presets.value.find((p) => p.id === id));
});

const canFetchModels = computed(() =>
  Boolean(form.value.baseUrl?.trim() && (form.value.apiKey.trim() || isEdit.value)),
);

async function handleFetchModels() {
  if (!canFetchModels.value) {
    message.error(t('upstreamKeys.validation.required'));
    return;
  }
  fetchingModels.value = true;
  try {
    const payload: DiscoverModelsPayload = {
      baseUrl: form.value.baseUrl?.trim() ?? '',
      providerType: form.value.providerType ?? 'anthropic_compatible',
      providerPresetId: selectedPresetId.value || undefined,
    };
    if (form.value.apiKey.trim()) {
      payload.apiKey = form.value.apiKey.trim();
    } else if (isEdit.value && editingId.value) {
      payload.upstreamKeyId = editingId.value;
    }
    const result = await upstreamKeysApi.discoverModels(payload);
    const existing = new Map(modelMappings.value.map((m) => [m.realName.trim(), m]));
    let added = 0;
    for (const item of result.items) {
      const realName = item.realName.trim();
      if (!realName || existing.has(realName)) continue;
      const publicName = item.publicName.trim();
      modelMappings.value.push({
        realName,
        publicName: publicName === realName ? '' : publicName,
        enabled: true,
      });
      existing.set(realName, modelMappings.value[modelMappings.value.length - 1]!);
      added++;
    }
    message.success(t('upstreamKeys.drawer.modelMappings.fetchSuccess', { count: added }));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    fetchingModels.value = false;
  }
}

const columns = computed<DataTableColumns<UpstreamKey>>(() => [
  { title: t('upstreamKeys.columns.name'), key: 'name', fixed: 'left', width: 200 },
  {
    title: t('upstreamKeys.columns.provider'),
    key: 'providerType',
    width: 220,
    render: (row) => {
      const preset = presets.value.find((p) => p.id === row.providerPresetId);
      const label = preset ? t(`providers.${preset.id}`) : row.providerType;
      const icon = preset?.icon ?? '';
      return h(NTag, { type: 'info', size: 'small' }, () => `${icon ? `${icon} ` : ''}${label}`);
    },
  },
  { title: t('upstreamKeys.columns.baseUrl'), key: 'baseUrl', ellipsis: { tooltip: true } },
  {
    title: t('upstreamKeys.columns.models'),
    key: 'candidateCount',
    width: 80,
    render: (row) => String(row.candidateCount ?? 0),
  },
  {
    title: t('upstreamKeys.columns.status'),
    key: 'status',
    width: 100,
    render: (row) =>
      h(
        NSwitch,
        {
          size: 'small',
          value: !row.frozen,
          loading: togglingIds.value.has(row.id),
          'on-update:value': () => toggleFreeze(row),
        },
        {
          checked: () => t('upstreamKeys.status.unfrozen'),
          unchecked: () => t('upstreamKeys.status.frozen'),
        },
      ),
  },
  {
    title: t('upstreamKeys.columns.actions'),
    key: 'actions',
    width: 150,
    render: (row) =>
      h(NSpace, { size: 'small', align: 'center' }, () => [
        h(NButton, { size: 'small', onClick: () => openEdit(row) }, () =>
          t('upstreamKeys.actions.edit'),
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => handleDelete(row) },
          {
            trigger: () =>
              h(NButton, { size: 'small', type: 'error' }, () => t('upstreamKeys.actions.delete')),
            default: () => t('upstreamKeys.confirm.delete'),
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
      <NDrawerContent
        :title="isEdit ? t('upstreamKeys.drawer.editTitle') : t('upstreamKeys.drawer.title')"
        closable
      >
        <NForm label-placement="top">
          <NFormItem :label="t('upstreamKeys.drawer.preset.label')">
            <NSelect
              v-model:value="selectedPresetId"
              :options="presetOptions"
              :loading="presetsLoading"
              :placeholder="t('upstreamKeys.drawer.preset.placeholder')"
              :disabled="isEdit"
              clearable
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.name')" required>
            <NInput
              v-model:value="form.name"
              :placeholder="t('upstreamKeys.drawer.placeholders.name')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.provider')" required>
            <NSelect
              v-model:value="form.providerType"
              :options="providerOptions"
              :disabled="Boolean(selectedPreset)"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.baseUrl')" required>
            <NInput
              v-model:value="form.baseUrl"
              :placeholder="t('upstreamKeys.drawer.placeholders.baseUrl')"
              :disabled="Boolean(selectedPreset)"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.apiKey')" :required="!isEdit">
            <NInput
              v-model:value="form.apiKey"
              type="password"
              show-password-on="click"
              :placeholder="
                isEdit
                  ? t('upstreamKeys.drawer.placeholders.apiKeyEdit')
                  : t('upstreamKeys.drawer.placeholders.apiKey')
              "
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.modelMappings.label')" required>
            <NSpace vertical style="width: 100%">
              <NButton
                size="small"
                :disabled="!canFetchModels || fetchingModels"
                :loading="fetchingModels"
                @click="handleFetchModels"
              >
                {{
                  fetchingModels
                    ? t('upstreamKeys.drawer.modelMappings.fetching')
                    : t('upstreamKeys.drawer.modelMappings.fetch')
                }}
              </NButton>
              <ModelMappingEditor v-model="modelMappings" />
            </NSpace>
          </NFormItem>
        </NForm>
        <template #footer>
          <NSpace justify="end">
            <NButton @click="drawerOpen = false">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" :loading="submitting" @click="onSubmit">{{
              isEdit ? t('common.save') : t('common.create')
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
