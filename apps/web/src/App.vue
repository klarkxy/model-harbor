<script setup lang="ts">
import { computed, onMounted } from 'vue';
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
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
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import AdminLayout from './layouts/AdminLayout.vue';
import { useThemeStore, applySystemEffects } from './theme/index.js';

const route = useRoute();
const { locale } = useI18n();
const theme = useThemeStore();

// Sync <html data-theme> with the persisted mode once mounted. The store reads
// localStorage during setup but defers DOM stamping to here (SSR-safe + avoids
// touching document before the app is mounted).
onMounted(() => applySystemEffects(theme.mode));

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
    :theme="theme.naiveTheme"
    :theme-overrides="theme.overrides"
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

<!--
  Global (non-scoped) styles shared across pages. Kept here rather than in a
  separate .css file to match the project's "scoped CSS only" convention while
  still providing a single home for cross-cutting rules: font fallbacks,
  tabular numerals, drag-and-drop visual feedback (previously duplicated with
  hardcoded greys in UpstreamKeys/PublicModels/ModelGroups) and button
  transitions. All colours reference Naive UI CSS variables so dark mode
  follows the theme tokens automatically.
-->
<style>
html,
body,
#app {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code,
pre,
kbd,
.mono {
  font-family: "Fira Code", "SF Mono", Menlo, Consolas, monospace;
}

/* Align numeric columns (statistic values, table counts) for a dashboard feel. */
.tabular-nums,
.n-statistic .n-statistic-value,
.n-data-table .num {
  font-variant-numeric: tabular-nums;
}

/* Drag-and-drop row feedback (shared by UpstreamKeys/PublicModels/ModelGroups).
 * The drop indicator is a 4px primary-coloured bar drawn across the entire
 * target row by attaching a `::before` / `::after` pseudo to every cell.
 * We can't use a single element spanning the row because `<tr>` isn't a
 * reliable positioning ancestor in CSS tables, and pseudo-elements on
 * `<td>` are bounded by the cell's own box. Multiple adjacent cells
 * each draw their own 4px segment at the same `top` / `bottom`, so the
 * line visually appears continuous. The dragging row keeps full opacity
 * and a hover background so the source stays visible while the user
 * hunts for a target. */
.drag-dragging td {
  opacity: 0.4;
  background: var(--n-color-hover) !important;
}
.drag-drop-before > td,
.drag-drop-after > td {
  position: relative;
}
.drag-drop-before > td::before,
.drag-drop-after > td::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--n-primary-color);
  box-shadow: 0 0 6px var(--n-primary-color);
  pointer-events: none;
  z-index: 2;
}
.drag-drop-before > td::before {
  top: 0;
}
.drag-drop-after > td::after {
  bottom: 0;
}
.order-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--n-icon-color);
  cursor: grab;
  user-select: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.order-handle:hover {
  border-color: var(--n-border-color);
  background: var(--n-color-target);
  color: var(--n-text-color-2);
}
.order-handle:active {
  cursor: grabbing;
  background: rgba(37, 99, 235, 0.08);
  border-color: var(--n-primary-color);
}
.order-handle--disabled {
  cursor: not-allowed;
  opacity: 0.5;
  background: transparent;
  border-color: transparent;
}
.order-handle--disabled:hover {
  border-color: transparent;
  background: transparent;
  color: var(--n-icon-color);
}
.order-grip {
  display: block;
  width: 14px;
  height: 20px;
  background-image: radial-gradient(currentColor 1.4px, transparent 1.6px);
  background-size: 7px 7px;
  background-position: 0 1px;
}

/* Soft button transitions on hover/focus (Naive UI ships no transition by default). */
.n-btn {
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease,
    box-shadow 0.15s ease;
}
</style>
