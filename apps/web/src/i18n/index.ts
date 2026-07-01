import { createI18n } from 'vue-i18n';
import { messages, type Messages } from '../locales/index.js';
import type { SupportedLocale } from '../locales/index.js';
import { getInitialLocale } from './locales.js';

export const i18n = createI18n<[Messages], SupportedLocale>({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'zh-CN',
  messages,
});

export { localeOptions, saveLocale, type LocaleOption } from './locales.js';
export type { SupportedLocale } from '../locales/index.js';
