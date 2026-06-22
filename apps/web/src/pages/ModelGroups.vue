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
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
  NPopconfirm,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { ReorderFourOutline } from '@vicons/ionicons5';
import {
  modelGroupsApi,
  publicModelsApi,
  settingsApi,
  type AutoGroupRecommendation,
  type ModelGroup,
  type ModelGroupCreatePayload,
  type PublicModel,
} from '../api/admin.js';

const message = useMessage();
const { t } = useI18n();

const items = ref<ModelGroup[]>([]);
const publicModelOptions = ref<PublicModel[]>([]);
const loading = ref(false);
const drawerOpen = ref(false);
const submitting = ref(false);
const previewLoading = ref(false);
const autoPreview = ref<AutoGroupRecommendation[]>([]);
const defaultReferenceRegion = ref<'international' | 'domestic'>('international');
const defaultAutoPreset = ref('balanced');
const defaultAutoTopN = ref(5);
const defaultAutoWeights = ref<Record<string, number>>({});
const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const dragOverPosition = ref<'before' | 'after'>('before');

const form = ref<ModelGroupCreatePayload>({
  name: '',
  displayName: '',
  description: '',
  routingPolicy: 'priority',
  mode: 'manual',
  autoPreset: 'balanced',
  autoReferenceRegion: 'international',
  autoTopN: 5,
  autoWeights: {},
});
const memberRows = ref<Array<{ publicModelId: string; priority: number; weight: number }>>([]);

function resetForm() {
  form.value = {
    name: '',
    displayName: '',
    description: '',
    routingPolicy: 'priority',
    mode: 'manual',
    autoPreset: defaultAutoPreset.value,
    autoReferenceRegion: defaultReferenceRegion.value,
    autoTopN: defaultAutoTopN.value,
    autoWeights: { ...defaultAutoWeights.value },
  };
  memberRows.value = [];
  autoPreview.value = [];
}

async function refresh() {
  loading.value = true;
  try {
    const [res, pmRes, settings] = await Promise.all([
      modelGroupsApi.list(),
      publicModelsApi.list(),
      settingsApi.get(),
    ]);
    items.value = res.items;
    publicModelOptions.value = pmRes.items;
    defaultReferenceRegion.value = settings.modelReference.defaultRegion;
    defaultAutoPreset.value = settings.modelReference.autoPreset;
    defaultAutoTopN.value = settings.modelReference.autoTopN;
    defaultAutoWeights.value = settings.modelReference.autoWeights;
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

function addMember() {
  if (publicModelOptions.value.length === 0) {
    message.warning(t('modelGroups.toast.createPublicModelFirst'));
    return;
  }
  memberRows.value.push({
    publicModelId: publicModelOptions.value[0]!.id,
    priority: (memberRows.value.length + 1) * 10,
    weight: 1,
  });
}

function removeMember(idx: number) {
  memberRows.value.splice(idx, 1);
}

function clearMemberDragState() {
  draggingIndex.value = null;
  dragOverIndex.value = null;
  dragOverPosition.value = 'before';
}

function reorderMember(fromIndex: number, targetIndex: number, position: 'before' | 'after') {
  if (fromIndex === targetIndex) return;
  const copy = [...memberRows.value];
  const [moved] = copy.splice(fromIndex, 1);
  if (!moved) return;
  let insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  if (fromIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(copy.length, insertIndex));
  copy.splice(insertIndex, 0, moved);
  memberRows.value = copy;
}

function memberRowProps(_row: unknown, idx: number) {
  const classes: string[] = [];
  if (draggingIndex.value === idx) classes.push('member-dragging');
  if (dragOverIndex.value === idx) classes.push(`member-drop-${dragOverPosition.value}`);
  return {
    class: classes.join(' '),
    onDragover: (event: DragEvent) => {
      if (draggingIndex.value === null) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      dragOverIndex.value = idx;
      dragOverPosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      if (draggingIndex.value !== null) {
        reorderMember(draggingIndex.value, idx, dragOverPosition.value);
      }
      clearMemberDragState();
    },
    onDragend: clearMemberDragState,
  };
}

async function onSubmit() {
  if (!form.value.name) {
    message.error(t('modelGroups.validation.required'));
    return;
  }
  submitting.value = true;
  try {
    const payload: ModelGroupCreatePayload = {
      name: form.value.name.trim(),
      displayName: form.value.displayName?.trim() || undefined,
      description: form.value.description?.trim() || undefined,
      routingPolicy: form.value.routingPolicy,
      mode: form.value.mode,
      ...(form.value.mode === 'auto_snapshot'
        ? {
            autoPreset: form.value.autoPreset,
            autoReferenceRegion: form.value.autoReferenceRegion,
            autoTopN: form.value.autoTopN,
            autoWeights: form.value.autoWeights,
          }
        : {
            members: memberRows.value.map((m, idx) => ({
              publicModelId: m.publicModelId,
              priority: (idx + 1) * 10,
              weight: 1,
            })),
          }),
    };
    const created = await modelGroupsApi.create(payload);
    items.value = [created, ...items.value];
    drawerOpen.value = false;
    message.success(t('modelGroups.toast.created'));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function previewAutoMembers() {
  if (form.value.mode !== 'auto_snapshot') return;
  previewLoading.value = true;
  try {
    const res = await modelGroupsApi.autoPreview({
      region: form.value.autoReferenceRegion ?? defaultReferenceRegion.value,
      preset: form.value.autoPreset ?? 'balanced',
      weights: form.value.autoWeights,
      topN: form.value.autoTopN ?? 5,
    });
    autoPreview.value = res.items;
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    previewLoading.value = false;
  }
}

async function refreshAuto(row: ModelGroup) {
  try {
    const updated = await modelGroupsApi.refreshAuto(row.id);
    items.value = items.value.map((item) => (item.id === row.id ? updated : item));
    message.success(t('modelGroups.toast.refreshed'));
  } catch (err) {
    message.error((err as Error).message);
  }
}

async function remove(row: ModelGroup) {
  try {
    await modelGroupsApi.remove(row.id);
    items.value = items.value.filter((i) => i.id !== row.id);
    message.success(t('modelGroups.toast.deleted'));
  } catch (err) {
    message.error((err as Error).message);
  }
}

const columns = computed<DataTableColumns<ModelGroup>>(() => [
  { title: t('modelGroups.columns.name'), key: 'name', width: 220 },
  { title: t('modelGroups.columns.displayName'), key: 'displayName', width: 200 },
  {
    title: t('modelGroups.columns.mode'),
    key: 'mode',
    width: 110,
    render: (row) =>
      h(NTag, { size: 'small', type: row.mode === 'auto_snapshot' ? 'info' : 'default' }, () =>
        row.mode === 'auto_snapshot'
          ? t('modelGroups.status.autoSnapshot')
          : t('modelGroups.status.manual'),
      ),
  },
  { title: t('modelGroups.columns.members'), key: 'memberCount', width: 100 },
  {
    title: t('modelGroups.columns.status'),
    key: 'enabled',
    width: 100,
    render: (row) =>
      row.enabled
        ? h(NTag, { type: 'success', size: 'small' }, () => t('modelGroups.status.enabled'))
        : h(NTag, { type: 'default', size: 'small' }, () => t('modelGroups.status.disabled')),
  },
  {
    title: t('modelGroups.columns.actions'),
    key: 'actions',
    width: 190,
    render: (row) =>
      h(NSpace, { size: 8 }, () => [
        row.mode === 'auto_snapshot'
          ? h(
              NButton,
              { size: 'small', secondary: true, onClick: () => refreshAuto(row) },
              () => t('modelGroups.actions.refreshAuto'),
            )
          : null,
        h(
          NPopconfirm,
          { onPositiveClick: () => remove(row) },
          {
            trigger: () =>
              h(NButton, { size: 'small', type: 'error' }, () => t('modelGroups.actions.delete')),
            default: () => t('modelGroups.confirm', { name: row.name }),
          },
        ),
      ]),
  },
]);

const modelOptions = computed(() =>
  publicModelOptions.value.map((m) => ({ label: m.name, value: m.id })),
);

const policyOptions = computed(() => [
  { label: t('modelGroups.drawer.policies.priority'), value: 'priority' },
  { label: t('modelGroups.drawer.policies.roundRobin'), value: 'round_robin' },
  { label: t('modelGroups.drawer.policies.random'), value: 'random' },
  { label: t('modelGroups.drawer.policies.weighted'), value: 'weighted' },
]);

const modeOptions = computed(() => [
  { label: t('modelGroups.drawer.manualMode'), value: 'manual' },
  { label: t('modelGroups.drawer.autoMode'), value: 'auto_snapshot' },
]);

const regionOptions = computed(() => [
  { label: t('modelGroups.drawer.regions.international'), value: 'international' },
  { label: t('modelGroups.drawer.regions.domestic'), value: 'domestic' },
]);

const presetOptions = computed(() => [
  { label: t('modelGroups.drawer.presets.balanced'), value: 'balanced' },
  { label: t('modelGroups.drawer.presets.chat'), value: 'chat' },
  { label: t('modelGroups.drawer.presets.code'), value: 'code' },
  { label: t('modelGroups.drawer.presets.plan'), value: 'plan' },
  { label: t('modelGroups.drawer.presets.cheap'), value: 'cheap' },
]);

const previewColumns = computed<DataTableColumns<AutoGroupRecommendation>>(() => [
  { title: t('modelGroups.drawer.members'), key: 'publicModelName' },
  { title: 'Score', key: 'score', width: 90 },
  {
    title: t('modelReference.columns.source'),
    key: 'source',
    width: 120,
    render: (row) => row.reference.source,
  },
]);
</script>

<template>
  <div class="page">
    <NCard>
      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NText strong>{{ t('modelGroups.title') }}</NText>
        <NButton type="primary" @click="openCreate">{{ t('modelGroups.new') }}</NButton>
      </NSpace>

      <NDataTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :single-line="false"
        :row-key="(row) => row.id"
        :empty="h(NEmpty, { description: t('modelGroups.empty') })"
      />
    </NCard>

    <NDrawer v-model:show="drawerOpen" :width="520">
      <NDrawerContent :title="t('modelGroups.drawer.title')" closable>
        <NForm label-placement="top">
          <NFormItem :label="t('modelGroups.drawer.name')" required>
            <NInput
              v-model:value="form.name"
              :placeholder="t('modelGroups.drawer.placeholders.name')"
            />
          </NFormItem>
          <NFormItem :label="t('modelGroups.drawer.displayName')">
            <NInput
              v-model:value="form.displayName"
              :placeholder="t('modelGroups.drawer.placeholders.displayName')"
            />
          </NFormItem>
          <NFormItem :label="t('modelGroups.drawer.description')">
            <NInput v-model:value="form.description" type="textarea" :rows="2" />
          </NFormItem>
          <NFormItem :label="t('modelGroups.drawer.mode')">
            <NSelect v-model:value="form.mode" :options="modeOptions" />
          </NFormItem>
          <template v-if="form.mode === 'auto_snapshot'">
            <NFormItem :label="t('modelGroups.drawer.autoRegion')">
              <NSelect v-model:value="form.autoReferenceRegion" :options="regionOptions" />
            </NFormItem>
            <NFormItem :label="t('modelGroups.drawer.autoPreset')">
              <NSelect v-model:value="form.autoPreset" :options="presetOptions" />
            </NFormItem>
            <NFormItem :label="t('modelGroups.drawer.autoTopN')">
              <NInputNumber v-model:value="form.autoTopN" :min="1" :max="20" style="width: 160px" />
            </NFormItem>
            <NFormItem :label="t('modelGroups.drawer.members')">
              <NSpace vertical style="width: 100%">
                <NButton size="small" :loading="previewLoading" @click="previewAutoMembers">
                  {{ t('modelGroups.drawer.preview') }}
                </NButton>
                <NDataTable
                  size="small"
                  :columns="previewColumns"
                  :data="autoPreview"
                  :bordered="false"
                  :pagination="false"
                />
              </NSpace>
            </NFormItem>
          </template>
          <NFormItem v-else :label="t('modelGroups.drawer.members')">
            <NSpace vertical size="small" style="width: 100%">
              <div
                v-for="(m, idx) in memberRows"
                :key="idx"
                class="member-row"
                :class="{
                  'member-dragging': draggingIndex === idx,
                  [`member-drop-${dragOverPosition}`]: dragOverIndex === idx,
                }"
                v-bind="memberRowProps(m, idx)"
              >
                <div
                  class="order-handle"
                  draggable="true"
                  :title="t('modelGroups.drawer.dragHandle')"
                  @dragstart="(event: DragEvent) => {
                    draggingIndex = idx;
                    event.dataTransfer?.setData('text/plain', String(idx));
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                  }"
                  @dragend="clearMemberDragState"
                >
                  <span class="order-grip" aria-hidden="true" />
                </div>
                <NSelect
                  v-model:value="m.publicModelId"
                  :options="modelOptions"
                  style="flex: 1"
                  :placeholder="t('modelGroups.drawer.placeholders.publicModel')"
                />
                <NButton size="small" type="error" tertiary @click="removeMember(idx)">×</NButton>
              </div>
              <NButton size="small" @click="addMember">{{
                t('modelGroups.drawer.addMember')
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

.member-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.member-dragging {
  opacity: 0.55;
}

.member-drop-before {
  box-shadow: inset 0 2px 0 #2f7cf6;
}

.member-drop-after {
  box-shadow: inset 0 -2px 0 #2f7cf6;
}
</style>
