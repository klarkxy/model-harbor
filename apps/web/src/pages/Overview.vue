<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NCard, NSpace, NStatistic, NGrid, NGi, NSpin } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { listProviderAccounts } from '../api/admin/provider-accounts.js';
import { listModels } from '../api/admin/models.js';
import { listClients } from '../api/admin/clients.js';
import { listBackups } from '../api/admin/backups.js';

const { t } = useI18n();
const loading = ref(true);
// v1 Phase 6：一个 client 一个 active key，clientKeys 数量恒等于 clients 数量，
// 不再单独统计。
const stats = ref({
  providerAccounts: 0,
  models: 0,
  clients: 0,
  backups: 0,
});

async function loadStats() {
  loading.value = true;
  try {
    const [providerAccounts, models, clients, backups] = await Promise.all([
      listProviderAccounts(),
      listModels(),
      listClients<Record<string, unknown>>(),
      listBackups(),
    ]);
    stats.value = {
      providerAccounts: providerAccounts.length,
      models: models.length,
      clients: clients.length,
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
            <NStatistic :label="t('overview.providerAccounts')" :value="stats.providerAccounts" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.models')" :value="stats.models" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.clients')" :value="stats.clients" />
          </NGi>
          <NGi>
            <NStatistic :label="t('overview.backups')" :value="stats.backups" />
          </NGi>
        </NGrid>
      </NSpin>
    </NCard>
  </NSpace>
</template>
