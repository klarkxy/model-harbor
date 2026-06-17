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
  NDropdown,
  NSelect,
  type MenuOption,
} from 'naive-ui';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.js';
import { localeOptions, saveLocale, type SupportedLocale } from '../i18n/index.js';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const collapsed = ref(false);
const auth = useAuthStore();

const menuOptions = computed<MenuOption[]>(() => [
  { key: 'overview', label: t('layout.menu.overview') },
  { key: 'upstream-keys', label: t('layout.menu.upstreamKeys') },
  { key: 'public-models', label: t('layout.menu.publicModels') },
  { key: 'model-groups', label: t('layout.menu.modelGroups') },
  { key: 'apps', label: t('layout.menu.apps') },
  { key: 'usage', label: t('layout.menu.usage') },
  { key: 'settings', label: t('layout.menu.settings') },
]);

const activeKey = computed<string>(() =>
  typeof route.name === 'string' ? route.name : 'overview',
);

function onMenuSelect(key: string): void {
  void router.push({ name: key });
}

const userLabel = computed(() => auth.user?.displayName || auth.user?.username || '—');

const userOptions = computed(() => [{ key: 'logout', label: t('layout.user.signOut') }]);

async function onUserMenu(key: string): Promise<void> {
  if (key === 'logout') {
    await auth.logout();
    await router.push({ name: 'login' });
  }
}

const currentLanguage = computed({
  get: () => locale.value as SupportedLocale,
  set: (value: SupportedLocale) => {
    locale.value = value;
    saveLocale(value);
  },
});

const languageOptions = computed(() =>
  localeOptions.map((opt) => ({ label: opt.label, value: opt.value })),
);
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="220"
      show-trigger
      :collapsed="collapsed"
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div class="logo">
        <NText strong>{{ t('layout.brand') }}</NText>
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
        <NSpace align="center" justify="space-between" style="width: 100%">
          <NText depth="3">{{ t('layout.version') }}</NText>
          <NSpace align="center" :size="12">
            <NSelect
              v-model:value="currentLanguage"
              :options="languageOptions"
              size="small"
              style="width: 130px"
              :consistent-menu-width="false"
            />
            <NDropdown :options="userOptions" trigger="click" @select="onUserMenu">
              <NText style="cursor: pointer">{{ userLabel }}</NText>
            </NDropdown>
          </NSpace>
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
  justify-content: center;
  border-bottom: 1px solid var(--n-border-color);
}
.header {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 16px;
}
</style>
