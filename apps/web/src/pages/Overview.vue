<script setup lang="ts">
import { computed, onMounted, ref, h } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  NSpace,
  NCard,
  NStatistic,
  NButton,
  NTag,
  NGrid,
  NGi,
  NDataTable,
  NEmpty,
  type DataTableColumns,
} from 'naive-ui';
import {
  appsApi,
  modelGroupsApi,
  publicModelsApi,
  upstreamKeysApi,
  type AppSummary,
  type ModelGroup,
  type PublicModel,
  type UpstreamKey,
} from '../api/admin.js';

const router = useRouter();
const { t } = useI18n();

const apps = ref<AppSummary[]>([]);
const groups = ref<ModelGroup[]>([]);
const models = ref<PublicModel[]>([]);
const keys = ref<UpstreamKey[]>([]);

async function refresh() {
  try {
    const [a, g, m, k] = await Promise.all([
      appsApi.list(),
      modelGroupsApi.list(),
      publicModelsApi.list(),
      upstreamKeysApi.list(),
    ]);
    apps.value = a.items;
    groups.value = g.items;
    models.value = m.items;
    keys.value = k.items;
  } catch {
    // Overview should never block login; show zeros on error.
  }
}

onMounted(refresh);

const frozenKeys = computed(() => keys.value.filter((k) => k.frozen).length);
const activeKeys = computed(() => keys.value.filter((k) => k.enabled && !k.frozen).length);

const modelColumns = computed<DataTableColumns<PublicModel>>(() => [
  { title: t('overview.modelsCard'), key: 'name' },
  { title: t('common.displayName'), key: 'displayName' },
  { title: t('common.candidates'), key: 'candidateCount', width: 110 },
]);

const groupColumns = computed<DataTableColumns<ModelGroup>>(() => [
  { title: t('overview.groupsCard'), key: 'name' },
  { title: t('common.displayName'), key: 'displayName' },
  { title: t('common.members'), key: 'memberCount', width: 110 },
]);
</script>

<template>
  <div class="overview">
    <NSpace vertical size="large">
      <NCard>
        <NSpace align="center" :size="12">
          <NTag type="success" round>{{ t('overview.banner.tag') }}</NTag>
          <span>{{ t('overview.banner.text') }}</span>
        </NSpace>
      </NCard>

      <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen">
        <NGi :span="1">
          <NCard>
            <NStatistic :label="t('overview.stats.apps')" :value="apps.length" />
          </NCard>
        </NGi>
        <NGi :span="1">
          <NCard>
            <NStatistic :label="t('overview.stats.publicModels')" :value="models.length" />
          </NCard>
        </NGi>
        <NGi :span="1">
          <NCard>
            <NStatistic :label="t('overview.stats.modelGroups')" :value="groups.length" />
          </NCard>
        </NGi>
        <NGi :span="1">
          <NCard>
            <NStatistic :label="t('overview.stats.upstreamKeys')" :value="keys.length" />
            <NSpace :size="6" style="margin-top: 4px">
              <NTag size="small" type="success">{{
                t('overview.stats.active', { count: activeKeys })
              }}</NTag>
              <NTag size="small" type="warning">{{
                t('overview.stats.frozen', { count: frozenKeys })
              }}</NTag>
            </NSpace>
          </NCard>
        </NGi>
      </NGrid>

      <NCard :title="t('overview.modelsCard')">
        <NDataTable
          :columns="modelColumns"
          :data="models"
          :bordered="false"
          :row-key="(r) => r.id"
          :empty="h(NEmpty, { description: t('overview.modelsEmpty') })"
        />
      </NCard>

      <NCard :title="t('overview.groupsCard')">
        <NDataTable
          :columns="groupColumns"
          :data="groups"
          :bordered="false"
          :row-key="(r) => r.id"
          :empty="h(NEmpty, { description: t('overview.groupsEmpty') })"
        />
      </NCard>

      <NCard :title="t('overview.nextSteps.title')">
        <p>{{ t('overview.nextSteps.description') }}</p>
        <NSpace>
          <NButton type="primary" @click="router.push('/upstream-keys')">{{
            t('overview.nextSteps.manageUpstreamKeys')
          }}</NButton>
          <NButton @click="router.push('/public-models')">{{
            t('overview.nextSteps.publicModels')
          }}</NButton>
          <NButton @click="router.push('/apps')">{{ t('overview.nextSteps.apps') }}</NButton>
        </NSpace>
      </NCard>
    </NSpace>
  </div>
</template>

<style scoped>
.overview {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
