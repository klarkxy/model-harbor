<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NCard, NSpace, NStatistic, NGrid, NGi, NSpin } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { listUpstreamKeys } from '../api/admin/upstream-keys.js';
import { listPublicModels } from '../api/admin/public-models.js';
import { listModelGroups } from '../api/admin/model-groups.js';
import { listApps } from '../api/admin/apps.js';
import { listConsumerKeys } from '../api/admin/consumer-keys.js';
import { listBackups } from '../api/admin/backups.js';

const { t } = useI18n();
const loading = ref(true);
const stats = ref({
  upstreamKeys: 0,
  publicModels: 0,
  modelGroups: 0,
  apps: 0,
  consumerKeys: 0,
  backups: 0,
});

async function loadStats() {
  loading.value = true;
  try {
    const [upstreamKeys, publicModels, modelGroups, apps, consumerKeys, backups] = await Promise.all([
      listUpstreamKeys(),
      listPublicModels(),
      listModelGroups(),
      listApps(),
      listConsumerKeys(),
      listBackups(),
    ]);
    stats.value = {
      upstreamKeys: upstreamKeys.length,
      publicModels: publicModels.length,
      modelGroups: modelGroups.length,
      apps: apps.length,
      consumerKeys: consumerKeys.length,
      backups: backups.length,
    };
  } finally {
    loading.value = false;
  }
}

onMounted(loadStats);
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('overview.title')">
      <NSpin :show="loading">
        <NGrid :cols="3" :x-gap="16" :y-gap="16">
          <NGi>
            <NStatistic :label="t('overview.upstreamKeys')" :value="stats.upstreamKeys" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.publicModels')" :value="stats.publicModels" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.modelGroups')" :value="stats.modelGroups" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.apps')" :value="stats.apps" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.consumerKeys')" :value="stats.consumerKeys" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.backups')" :value="stats.backups" />
          </NGi>
        </NGrid>
      </NSpin>
    </NCard>
  </NSpace>
</template>
