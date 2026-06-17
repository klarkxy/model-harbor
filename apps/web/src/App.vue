<script setup lang="ts">
import { computed } from 'vue';
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  lightTheme,
  enUS,
  dateEnUS,
  zhCN,
  dateZhCN,
  zhTW,
  dateZhTW,
  jaJP,
  dateJaJP,
  koKR,
  dateKoKR,
  esAR,
  dateEsAR,
  frFR,
  dateFrFR,
  deDE,
  dateDeDE,
  ptBR,
  datePtBR,
  ruRU,
  dateRuRU,
} from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import AdminLayout from './layouts/AdminLayout.vue';

const route = useRoute();
const { locale } = useI18n();

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#3b82f6',
    primaryColorPressed: '#1d4ed8',
    primaryColorSuppl: '#3b82f6',
    borderRadius: '6px',
  },
};

const isStandalone = computed(() => route.meta['standalone'] === true);

const localeMap: Record<string, { locale: typeof enUS; dateLocale: typeof dateEnUS }> = {
  en: { locale: enUS, dateLocale: dateEnUS },
  'zh-CN': { locale: zhCN, dateLocale: dateZhCN },
  'zh-TW': { locale: zhTW, dateLocale: dateZhTW },
  ja: { locale: jaJP, dateLocale: dateJaJP },
  ko: { locale: koKR, dateLocale: dateKoKR },
  es: { locale: esAR, dateLocale: dateEsAR },
  fr: { locale: frFR, dateLocale: dateFrFR },
  de: { locale: deDE, dateLocale: dateDeDE },
  pt: { locale: ptBR, dateLocale: datePtBR },
  ru: { locale: ruRU, dateLocale: dateRuRU },
};

const naiveLocale = computed(() => localeMap[locale.value]?.locale ?? enUS);
const naiveDateLocale = computed(() => localeMap[locale.value]?.dateLocale ?? dateEnUS);
</script>

<template>
  <NConfigProvider
    :theme="lightTheme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <RouterView v-if="isStandalone" />
          <AdminLayout v-else />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
