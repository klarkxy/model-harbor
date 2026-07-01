<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useMessage } from 'naive-ui';
import { NSpace, NFormItem, NSelect, NInput, NButton, NSpin } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { generateSnippet } from '../api/admin/snippets.js';
import { SNIPPET_CLIENTS, type SnippetClient } from '@manageyourllm/contracts';
import { listModels } from '../api/admin/models.js';

const props = defineProps<{
  model?: string;
  apiKey?: string;
  selectableClient?: boolean;
}>();

const { t } = useI18n();
const message = useMessage();

const selectedClient = ref<SnippetClient>('generic_openai');
const selectedModel = ref(props.model ?? '');
const content = ref('');
const loading = ref(false);
const models = ref<Array<{ id: string; name: string }>>([]);

const clientOptions = computed(() =>
  SNIPPET_CLIENTS.map((c) => ({
    label: t(`snippets.clients.${c}`),
    value: c,
  })),
);

const modelOptions = computed(() => models.value.map((m) => ({ label: m.name, value: m.name })));

async function loadModels() {
  if (props.model) return;
  try {
    const fetched = await listModels();
    models.value = fetched.map((m) => ({ id: m.id, name: m.name }));
    if (!selectedModel.value && models.value.length > 0) {
      selectedModel.value = models.value[0]!.name;
    }
  } catch {
    message.error(t('common.loadFailed'));
  }
}

async function render() {
  if (!selectedModel.value) return;
  loading.value = true;
  try {
    const result = await generateSnippet({
      client: selectedClient.value,
      model: selectedModel.value,
      apiKey: props.apiKey,
    });
    content.value = result.content;
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.loadFailed'));
  } finally {
    loading.value = false;
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(content.value);
    message.success(t('snippets.copied'));
  } catch {
    message.error(t('snippets.copyFailed'));
  }
}

watch([() => props.model, () => props.apiKey], () => {
  if (props.model) selectedModel.value = props.model;
  void render();
});

watch([selectedClient, selectedModel], () => {
  void render();
});

onMounted(async () => {
  await loadModels();
  await render();
});
</script>

<template>
  <NSpin :show="loading">
    <NSpace vertical :size="16">
      <NFormItem :label="t('snippets.client')" v-if="selectableClient !== false">
        <NSelect v-model:value="selectedClient" :options="clientOptions" />
      </NFormItem>
      <NFormItem :label="t('snippets.model')" v-if="!props.model">
        <NSelect
          v-model:value="selectedModel"
          :options="modelOptions"
          :placeholder="t('snippets.model')"
        />
      </NFormItem>
      <NInput :value="content" type="textarea" rows="10" readonly />
      <NSpace justify="end">
        <NButton @click="copy" :disabled="!content">{{ t('snippets.copy') }}</NButton>
      </NSpace>
    </NSpace>
  </NSpin>
</template>
