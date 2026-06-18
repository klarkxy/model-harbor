<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NFormItem, NInput, NSpace, NSwitch } from 'naive-ui';

export interface ModelMappingItem {
  realName: string;
  publicName: string;
  enabled: boolean;
}

const props = defineProps<{
  modelValue: ModelMappingItem[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: ModelMappingItem[]): void;
}>();

const { t } = useI18n();

const items = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

function addItem() {
  items.value = [...items.value, { realName: '', publicName: '', enabled: true }];
}

function removeItem(index: number) {
  const next = [...items.value];
  next.splice(index, 1);
  items.value = next;
}

function updateItem(index: number, patch: Partial<ModelMappingItem>) {
  const next = [...items.value];
  next[index] = { ...next[index]!, ...patch };
  items.value = next;
}
</script>

<template>
  <div class="mapping-editor">
    <div
      v-for="(item, index) in items"
      :key="index"
      class="mapping-row"
      :class="{ disabled: !item.enabled }"
    >
      <NInput
        :value="item.realName"
        :placeholder="t('upstreamKeys.drawer.modelMappings.realName')"
        :disabled="disabled"
        @update:value="(v) => updateItem(index, { realName: v })"
      />
      <span class="arrow">→</span>
      <NInput
        :value="item.publicName"
        :placeholder="t('upstreamKeys.drawer.modelMappings.publicName')"
        :disabled="disabled"
        @update:value="(v) => updateItem(index, { publicName: v })"
      />
      <NSwitch
        :value="item.enabled"
        :disabled="disabled"
        @update:value="(v) => updateItem(index, { enabled: v })"
      />
      <NButton v-if="!disabled" quaternary circle size="small" @click="removeItem(index)">
        ✕
      </NButton>
    </div>
    <NButton v-if="!disabled" dashed block @click="addItem">
      {{ t('upstreamKeys.drawer.modelMappings.add') }}
    </NButton>
  </div>
</template>

<style scoped>
.mapping-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mapping-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto auto;
  align-items: center;
  gap: 8px;
}

.mapping-row.disabled {
  opacity: 0.6;
}

.arrow {
  color: var(--n-text-color-disabled);
  font-size: 14px;
}
</style>
