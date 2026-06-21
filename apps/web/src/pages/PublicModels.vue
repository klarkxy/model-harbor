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
  NPopconfirm,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NText,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  publicModelsApi,
  upstreamKeysApi,
  type PublicModel,
  type PublicModelCandidate,
  type PublicModelCreatePayload,
  type UpstreamKey,
} from '../api/admin.js';

const message = useMessage();
const { t } = useI18n();

type CandidateDraft = {
  localId: string;
  upstreamKeyId: string;
  realModelName: string;
  priority: number;
  weight: number;
  enabled: boolean;
  endpointProtocol?: PublicModelCandidate['endpointProtocol'];
  endpointProviderType?: PublicModelCandidate['endpointProviderType'];
  endpointBaseUrl?: string | null;
  endpointApiPath?: string | null;
};

const items = ref<PublicModel[]>([]);
const upstreamKeyOptions = ref<UpstreamKey[]>([]);
const loading = ref(false);
const drawerOpen = ref(false);
const arrangeDrawerOpen = ref(false);
const submitting = ref(false);
const savingArrangement = ref(false);
const resettingArrangement = ref(false);
const arrangementLoading = ref(false);
const selectedModel = ref<PublicModel | null>(null);
const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const dragOverPosition = ref<'before' | 'after'>('before');

const form = ref<PublicModelCreatePayload>({
  name: '',
  displayName: '',
  description: '',
  candidates: [],
});

const candidateRows = ref<
  Array<{ upstreamKeyId: string; realModelName: string }>
>([]);
const arrangedRows = ref<CandidateDraft[]>([]);

const upstreamKeyById = computed(
  () => new Map(upstreamKeyOptions.value.map((key) => [key.id, key] as const)),
);

const keyOptions = computed(() =>
  upstreamKeyOptions.value.map((k) => ({ label: `${k.name} (${k.apiKeyPrefix}...)`, value: k.id })),
);

function resetForm() {
  form.value = { name: '', displayName: '', description: '', candidates: [] };
  candidateRows.value = [];
}

function draftId() {
  return `candidate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function toDraft(candidate: PublicModelCandidate, idx: number): CandidateDraft {
  return {
    localId: candidate.id || `candidate_${idx}`,
    upstreamKeyId: candidate.upstreamKeyId,
    realModelName: candidate.realModelName,
    priority: candidate.priority,
    weight: candidate.weight,
    enabled: candidate.enabled,
    endpointProtocol: candidate.endpointProtocol,
    endpointProviderType: candidate.endpointProviderType,
    endpointBaseUrl: candidate.endpointBaseUrl,
    endpointApiPath: candidate.endpointApiPath,
  };
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

async function openArrangement(row: PublicModel) {
  arrangementLoading.value = true;
  arrangeDrawerOpen.value = true;
  selectedModel.value = row;
  try {
    const detail = await publicModelsApi.get(row.id);
    selectedModel.value = detail;
    arrangedRows.value = [...(detail.candidates ?? [])]
      .sort((a, b) => a.priority - b.priority)
      .map(toDraft);
  } catch (err) {
    message.error((err as Error).message);
    arrangeDrawerOpen.value = false;
  } finally {
    arrangementLoading.value = false;
  }
}

function addCandidate() {
  if (upstreamKeyOptions.value.length === 0) {
    message.warning(t('publicModels.toast.createUpstreamKeyFirst'));
    return;
  }
  candidateRows.value.push({
    upstreamKeyId: upstreamKeyOptions.value[0]!.id,
    realModelName: '',
  });
}

function addArrangedCandidate() {
  if (upstreamKeyOptions.value.length === 0) {
    message.warning(t('publicModels.toast.createUpstreamKeyFirst'));
    return;
  }
  arrangedRows.value.push({
    localId: draftId(),
    upstreamKeyId: upstreamKeyOptions.value[0]!.id,
    realModelName: '',
    priority: (arrangedRows.value.length + 1) * 10,
    weight: 1,
    enabled: true,
  });
}

function removeCandidate(idx: number) {
  candidateRows.value.splice(idx, 1);
}

function removeArrangedCandidate(idx: number) {
  arrangedRows.value.splice(idx, 1);
}

function clearDragState() {
  draggingIndex.value = null;
  dragOverIndex.value = null;
  dragOverPosition.value = 'before';
}

function reorderArrangedCandidate(
  fromIndex: number,
  targetIndex: number,
  position: 'before' | 'after',
) {
  if (fromIndex === targetIndex) return;
  const copy = [...arrangedRows.value];
  const [moved] = copy.splice(fromIndex, 1);
  if (!moved) return;
  let insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  if (fromIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(copy.length, insertIndex));
  copy.splice(insertIndex, 0, moved);
  arrangedRows.value = copy;
}

function arrangedRowProps(_row: CandidateDraft, idx: number) {
  const classes: string[] = [];
  if (draggingIndex.value === idx) classes.push('candidate-dragging');
  if (dragOverIndex.value === idx) classes.push(`candidate-drop-${dragOverPosition.value}`);
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
        reorderArrangedCandidate(draggingIndex.value, idx, dragOverPosition.value);
      }
      clearDragState();
    },
    onDragend: clearDragState,
  };
}

function keyStatus(row: CandidateDraft) {
  const key = upstreamKeyById.value.get(row.upstreamKeyId);
  if (!key) return { label: t('publicModels.arrange.status.missing'), type: 'error' as const };
  if (!key.enabled) {
    return { label: t('publicModels.arrange.status.upstreamDisabled'), type: 'default' as const };
  }
  if (key.frozen) {
    return { label: t('publicModels.arrange.status.frozen'), type: 'warning' as const };
  }
  if (key.lastHealthStatus === 'degraded') {
    return { label: t('publicModels.arrange.status.degraded'), type: 'warning' as const };
  }
  if (key.lastHealthStatus === 'healthy') {
    return { label: t('publicModels.arrange.status.healthy'), type: 'success' as const };
  }
  return { label: t('publicModels.arrange.status.ready'), type: 'success' as const };
}

function providerLabel(row: CandidateDraft) {
  const key = upstreamKeyById.value.get(row.upstreamKeyId);
  const provider = row.endpointProviderType ?? key?.providerType ?? '-';
  const protocol = row.endpointProtocol ?? key?.endpoints?.[0]?.protocol ?? '-';
  return `${provider} / ${protocol}`;
}

function createPayloadRows(rows: CandidateDraft[]) {
  return rows
    .map((row, idx) => ({
      upstreamKeyId: row.upstreamKeyId,
      realModelName: row.realModelName.trim(),
      priority: (idx + 1) * 10,
      weight: row.weight,
      enabled: row.enabled,
      endpointProtocol: row.endpointProtocol ?? undefined,
      endpointProviderType: row.endpointProviderType ?? undefined,
      endpointBaseUrl: row.endpointBaseUrl ?? undefined,
      endpointApiPath: row.endpointApiPath ?? undefined,
    }))
    .filter((row) => row.realModelName);
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
        .map((c, idx) => ({
          upstreamKeyId: c.upstreamKeyId,
          realModelName: c.realModelName.trim(),
          priority: (idx + 1) * 10,
          weight: 1,
          enabled: true,
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

async function saveArrangement() {
  if (!selectedModel.value) return;
  savingArrangement.value = true;
  try {
    const candidates = createPayloadRows(arrangedRows.value);
    const res = await publicModelsApi.setCandidates(selectedModel.value.id, candidates);
    arrangedRows.value = [...res.candidates].sort((a, b) => a.priority - b.priority).map(toDraft);
    items.value = items.value.map((item) =>
      item.id === selectedModel.value!.id ? { ...item, candidateCount: res.candidates.length } : item,
    );
    message.success(t('publicModels.toast.arrangementSaved'));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    savingArrangement.value = false;
  }
}

async function resetArrangementOrder() {
  if (!selectedModel.value) return;
  resettingArrangement.value = true;
  try {
    const res = await publicModelsApi.resetCandidateOrder(selectedModel.value.id);
    arrangedRows.value = [...res.candidates].sort((a, b) => a.priority - b.priority).map(toDraft);
    message.success(t('publicModels.toast.arrangementReset'));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    resettingArrangement.value = false;
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
    width: 190,
    render: (row) =>
      h(NSpace, { size: 8 }, () => [
        h(NButton, { size: 'small', onClick: () => openArrangement(row) }, () =>
          t('publicModels.actions.arrange'),
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => remove(row) },
          {
            trigger: () =>
              h(NButton, { size: 'small', type: 'error' }, () => t('publicModels.actions.delete')),
            default: () => t('publicModels.confirm', { name: row.name }),
          },
        ),
      ]),
  },
]);

const arrangedColumns = computed<DataTableColumns<CandidateDraft>>(() => [
  {
    title: t('publicModels.arrange.columns.order'),
    key: 'order',
    align: 'center',
    width: 64,
    render: (_row, idx) =>
      h(
        'div',
        {
          class: 'order-handle',
          draggable: true,
          title: t('publicModels.arrange.dragHandle'),
          'data-testid': 'candidate-order-handle',
          onDragstart: (event: DragEvent) => {
            draggingIndex.value = idx;
            event.dataTransfer?.setData('text/plain', String(idx));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          },
          onDragend: clearDragState,
        },
        [h('span', { class: 'order-grip', 'aria-hidden': 'true' })],
      ),
  },
  {
    title: t('publicModels.arrange.columns.upstreamKey'),
    key: 'upstreamKeyId',
    minWidth: 220,
    render: (row) =>
      h(NSelect, {
        value: row.upstreamKeyId,
        options: keyOptions.value,
        filterable: true,
        onUpdateValue: (value: string) => {
          row.upstreamKeyId = value;
        },
      }),
  },
  {
    title: t('publicModels.arrange.columns.realModelName'),
    key: 'realModelName',
    minWidth: 220,
    render: (row) =>
      h(NInput, {
        value: row.realModelName,
        placeholder: t('publicModels.drawer.placeholders.realModelName'),
        onUpdateValue: (value: string) => {
          row.realModelName = value;
        },
      }),
  },
  {
    title: t('publicModels.arrange.columns.status'),
    key: 'status',
    width: 210,
    render: (row) => {
      const status = keyStatus(row);
      return h(NSpace, { size: 6, align: 'center' }, () => [
        h(NSwitch, {
          value: row.enabled,
          size: 'small',
          onUpdateValue: (value: boolean) => {
            row.enabled = value;
          },
        }),
        h(NTag, { type: row.enabled ? 'success' : 'default', size: 'small' }, () =>
          row.enabled ? t('publicModels.status.enabled') : t('publicModels.status.disabled'),
        ),
        h(NTag, { type: status.type, size: 'small' }, () => status.label),
      ]);
    },
  },
  {
    title: t('publicModels.arrange.columns.provider'),
    key: 'provider',
    minWidth: 180,
    render: (row) => h(NText, { depth: 3 }, () => providerLabel(row)),
  },
  {
    title: t('publicModels.columns.actions'),
    key: 'actions',
    width: 86,
    render: (_row, idx) =>
      h(NSpace, { size: 6 }, () => [
        h(
          NButton,
          {
            size: 'small',
            type: 'error',
            tertiary: true,
            onClick: () => removeArrangedCandidate(idx),
          },
          () => t('common.remove'),
        ),
      ]),
  },
]);
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
                class="candidate-row compact"
              >
                <NSelect
                  v-model:value="c.upstreamKeyId"
                  :options="keyOptions"
                  class="field-key"
                  :placeholder="t('publicModels.drawer.placeholders.upstreamKey')"
                />
                <NInput
                  v-model:value="c.realModelName"
                  class="field-model"
                  :placeholder="t('publicModels.drawer.placeholders.realModelName')"
                />
                <NButton size="small" type="error" tertiary @click="removeCandidate(idx)">x</NButton>
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

    <NDrawer v-model:show="arrangeDrawerOpen" :width="860">
      <NDrawerContent
        :title="t('publicModels.arrange.title', { name: selectedModel?.name ?? '' })"
        closable
      >
        <NSpace vertical size="medium">
          <NDataTable
            :columns="arrangedColumns"
            :data="arrangedRows"
            :loading="arrangementLoading"
            :bordered="false"
            :single-line="false"
            :row-key="(row) => row.localId"
            :row-props="arrangedRowProps"
            :empty="h(NEmpty, { description: t('publicModels.arrange.emptyCandidates') })"
          />

          <NButton size="small" @click="addArrangedCandidate">{{
            t('publicModels.drawer.addCandidate')
          }}</NButton>
        </NSpace>
        <template #footer>
          <NSpace justify="end">
            <NPopconfirm
              :positive-text="t('publicModels.arrange.reset')"
              @positive-click="resetArrangementOrder"
            >
              <template #trigger>
                <NButton :loading="resettingArrangement">
                  {{ t('publicModels.arrange.reset') }}
                </NButton>
              </template>
              {{ t('publicModels.arrange.resetConfirm') }}
            </NPopconfirm>
            <NButton @click="arrangeDrawerOpen = false">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" :loading="savingArrangement" @click="saveArrangement">
              {{ t('common.save') }}
            </NButton>
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

.candidate-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.candidate-row.compact {
  flex-wrap: wrap;
}

.field-key,
.field-model {
  flex: 1 1 190px;
}

.order-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #667085;
  cursor: grab;
  user-select: none;
}

.order-handle:hover {
  border-color: #d0d5dd;
  background: #f8fafc;
  color: #344054;
}

.order-handle:active {
  cursor: grabbing;
  background: #eef4ff;
  border-color: #84adff;
}

.order-grip {
  display: block;
  width: 14px;
  height: 20px;
  background-image: radial-gradient(currentColor 1.4px, transparent 1.6px);
  background-size: 7px 7px;
  background-position: 0 1px;
}

:deep(.candidate-dragging td) {
  opacity: 0.55;
}

:deep(.candidate-drop-before td) {
  box-shadow: inset 0 2px 0 #2f7cf6;
}

:deep(.candidate-drop-after td) {
  box-shadow: inset 0 -2px 0 #2f7cf6;
}
</style>
