<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NEmpty } from 'naive-ui';

const props = defineProps<{
  title: string;
  description?: string;
}>();

const { t } = useI18n();
const description = computed(() => props.description ?? t('emptyState.description'));
</script>

<template>
  <div class="empty-state">
    <NEmpty :description="description">
      <template #extra>
        <p>{{ title }}</p>
      </template>
    </NEmpty>
  </div>
</template>

<style scoped>
.empty-state {
  max-width: 960px;
  margin: 24px auto;
  padding: 0 16px;
}
</style>
