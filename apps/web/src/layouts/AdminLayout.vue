<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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
  NIcon,
  type MenuOption,
} from 'naive-ui';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.js';
import { localeOptions, saveLocale, type SupportedLocale } from '../i18n/index.js';
import { menuIcons } from '../components/menuIcons.js';
import ThemeToggle from '../components/ThemeToggle.vue';
import { PrismOutline } from '@vicons/ionicons5';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const collapsed = ref(false);
const auth = useAuthStore();

// Track the viewport so the sidebar becomes a floating drawer on small screens.
// Naive UI doesn't re-export `useBreakpoints` (it's an internal vooks helper),
// so we watch matchMedia directly — no new dependency, and it stays in sync with
// the same breakpoints NGrid's `responsive="screen"` uses.
const isMobile = ref(false);
function updateMobile(): void {
  isMobile.value =
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false;
}
onMounted(() => {
  updateMobile();
  window.addEventListener('resize', updateMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', updateMobile));

const menuOptions = computed<MenuOption[]>(() => [
  { key: 'overview', label: t('layout.menu.overview'), icon: menuIcons['overview'] },
  { key: 'upstream-keys', label: t('layout.menu.upstreamKeys'), icon: menuIcons['upstream-keys'] },
  { key: 'public-models', label: t('layout.menu.publicModels'), icon: menuIcons['public-models'] },
  { key: 'model-groups', label: t('layout.menu.modelGroups'), icon: menuIcons['model-groups'] },
  {
    key: 'model-reference',
    label: t('layout.menu.modelReference'),
    icon: menuIcons['model-reference'],
  },
  { key: 'apps', label: t('layout.menu.apps'), icon: menuIcons['apps'] },
  { key: 'usage', label: t('layout.menu.usage'), icon: menuIcons['usage'] },
  { key: 'settings', label: t('layout.menu.settings'), icon: menuIcons['settings'] },
]);

const activeKey = computed<string>(() =>
  typeof route.name === 'string' ? route.name : 'overview',
);

// Page title in the header: reuses the menu i18n key (no new translations needed).
const currentTitle = computed(() => {
  const titleKey = route.meta['titleKey'] as string | undefined;
  if (titleKey) return t(titleKey);
  const menuKey = typeof route.name === 'string' ? route.name : 'overview';
  return t(`layout.menu.${menuKey}`);
});

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
      :show-trigger="!isMobile"
      :collapsed="collapsed"
      :position="isMobile ? 'absolute' : 'static'"
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div class="logo" :class="{ 'logo--collapsed': collapsed }">
        <span class="logo__mark">
          <NIcon :size="collapsed ? 24 : 20"><PrismOutline /></NIcon>
        </span>
        <span v-if="!collapsed" class="logo__text">
          <NText strong class="logo__name">{{ t('layout.brand') }}</NText>
          <NText depth="3" class="logo__sub">{{ t('layout.sub') }}</NText>
        </span>
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
          <NText strong class="header__title">{{ currentTitle }}</NText>
          <NText depth="3" class="header__version">{{ t('layout.version') }}</NText>
        </div>
        <NSpace align="center" :size="12" class="header__right">
          <ThemeToggle />
          <NSelect
            v-model:value="currentLanguage"
            :options="languageOptions"
            size="small"
            :style="{ width: isMobile ? '110px' : '130px' }"
            :consistent-menu-width="false"
          />
          <NDropdown :options="userOptions" trigger="click" @select="onUserMenu">
            <NText style="cursor: pointer">{{ userLabel }}</NText>
          </NDropdown>
        </NSpace>
      </NLayoutHeader>
      <NLayoutContent content-style="padding: 24px;">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
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
.logo--collapsed {
  justify-content: center;
  padding: 0;
}
.logo__mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--n-primary-color), #6366f1);
  color: #fff;
  flex-shrink: 0;
}
.logo__text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  overflow: hidden;
}
.logo__name {
  font-size: 15px;
  white-space: nowrap;
}
.logo__sub {
  font-size: 11px;
  display: block;
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
  overflow: hidden;
}
.header__title {
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.header__version {
  font-size: 12px;
  white-space: nowrap;
}
.header__right {
  flex-shrink: 0;
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 640px) {
  .header__version {
    display: none;
  }
}
</style>
