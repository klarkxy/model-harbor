<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  NLayout,
  NLayoutHeader,
  NLayoutSider,
  NLayoutContent,
  NMenu,
  NText,
  NSpace,
  NSelect,
  NIcon,
  type MenuOption,
  type SelectOption,
} from 'naive-ui';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { PrismOutline } from '@vicons/ionicons5';
import { LogOutOutline } from '@vicons/ionicons5';
import { localeOptions, type SupportedLocale } from '../i18n/index.js';
import { useAuthStore } from '../stores/auth.js';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const auth = useAuthStore();
const collapsed = ref(false);

const menuOptions = computed<MenuOption[]>(() => [
  { key: 'overview', label: t('layout.menu.overview') },
  { key: 'upstream-keys', label: t('layout.menu.upstreamKeys') },
  { key: 'provider-presets', label: t('layout.menu.providerPresets') },
  { key: 'public-models', label: t('layout.menu.publicModels') },
  { key: 'model-groups', label: t('layout.menu.modelGroups') },
  { key: 'apps', label: t('layout.menu.apps') },
  { key: 'backups', label: t('layout.menu.backups') },
  { key: 'usage', label: t('layout.menu.usage') },
  { key: 'traces', label: t('layout.menu.traces') },
  { key: 'settings', label: t('layout.menu.settings') },
  { key: 'setup', label: t('layout.menu.setup') },
]);

const activeKey = computed<string>(() =>
  typeof route.name === 'string' ? route.name : 'overview',
);

const currentTitle = computed(() => {
  const titleKey = route.meta['titleKey'] as string | undefined;
  if (titleKey) return t(titleKey);
  const menuKey = typeof route.name === 'string' ? route.name : 'overview';
  return t(`layout.menu.${menuKey}`);
});

function onMenuSelect(key: string): void {
  void router.push({ name: key });
}

const currentLanguage = computed({
  get: () => locale.value as SupportedLocale,
  set: (value: SupportedLocale) => {
    locale.value = value;
  },
});
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="220"
      :show-trigger="true"
      :collapsed="collapsed"
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div class="logo">
        <NIcon :size="20"><PrismOutline /></NIcon>
        <span v-if="!collapsed" class="logo__text">{{ t('layout.brand') }}</span>
      </div>
      <NMenu
        :options="menuOptions"
        :value="activeKey"
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        @update:value="onMenuSelect"
      />
    </NLayoutSider>
    <NLayout>
      <NLayoutHeader bordered class="header">
        <div class="header__left">
          <NText strong>{{ currentTitle }}</NText>
          <NText depth="3">{{ t('layout.version') }}</NText>
        </div>
        <NSpace align="center" :size="12">
          <NSelect
            v-model:value="currentLanguage"
            :options="localeOptions as SelectOption[]"
            size="small"
            style="width: 120px"
          />
          <NButton
            size="small"
            quaternary
            @click="
              async () => {
                await auth.logout();
                await router.push({ name: 'login' });
              }
            "
          >
            <template #icon>
              <NIcon><LogOutOutline /></NIcon>
            </template>
            {{ t('layout.menu.login') }}
          </NButton>
        </NSpace>
      </NLayoutHeader>
      <NLayoutContent content-style="padding: 24px;">
        <RouterView />
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>

<style scoped>
.logo {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--n-border-color);
}
.logo__text {
  font-weight: 600;
  white-space: nowrap;
}
.header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
.header__left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
</style>
