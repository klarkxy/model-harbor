<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NCard, NSpace, NStatistic, NGrid, NGi, NSpin, NAlert, NThing } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { listUpstreamKeys } from '../api/admin/upstream-keys.js';
import { listPublicModels } from '../api/admin/public-models.js';
import { listModelGroups } from '../api/admin/model-groups.js';
import { listApps } from '../api/admin/apps.js';
import { listConsumerKeys } from '../api/admin/consumer-keys.js';
import { listBackups } from '../api/admin/backups.js';
import { getPlanReminders } from '../api/admin/plans.js';
import type { PlanReminderContract } from '@manageyourllm/contracts';

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
const reminders = ref<PlanReminderContract[]>([]);

async function loadStats() {
  loading.value = true;
  try {
    const [upstreamKeys, publicModels, modelGroups, apps, consumerKeys, backups, planReminders] =
      await Promise.all([
        listUpstreamKeys(),
        listPublicModels(),
        listModelGroups(),
        listApps(),
        listConsumerKeys(),
        listBackups(),
        getPlanReminders(),
      ]);
    stats.value = {
      upstreamKeys: upstreamKeys.length,
      publicModels: publicModels.length,
      modelGroups: modelGroups.length,
      apps: apps.length,
      consumerKeys: consumerKeys.length,
      backups: backups.length,
    };
    reminders.value = planReminders;
  } finally {
    loading.value = false;
  }
}

onMounted(loadStats);

function reminderText(reminder: PlanReminderContract): string {
  const parts = reminder.reasons.map((reason) => t(`overview.reminderReason.${reason}`));
  const ratio = `${(reminder.remainingRatio * 100).toFixed(0)}%`;
  const days = reminder.daysUntilExpiry;
  if (days != null) {
    return `${parts.join(' · ')} · ${t('overview.remainingRatio')}: ${ratio} · ${t('overview.daysUntilExpiry')}: ${days}`;
  }
  return `${parts.join(' · ')} · ${t('overview.remainingRatio')}: ${ratio}`;
}

const hasReminders = computed(() => reminders.value.length > 0);
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

    <NCard v-if="hasReminders" :title="t('overview.planReminders')" size="small">
      <NSpace vertical>
        <NAlert
          v-for="reminder in reminders"
          :key="reminder.plan.id"
          type="warning"
          :show-icon="true"
        >
          <NThing :title="reminder.plan.name" :description="reminderText(reminder)" />
        </NAlert>
      </NSpace>
    </NCard>
  </NSpace>
</template>
