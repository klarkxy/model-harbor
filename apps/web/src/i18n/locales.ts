import type { SupportedLocale } from '../locales/index.js';

export interface LocaleOption {
  value: SupportedLocale;
  label: string;
}

export const localeOptions: LocaleOption[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
];

const STORAGE_KEY = 'manageyourllm-locale';

function isSupportedLocale(value: string): value is SupportedLocale {
  return localeOptions.some((opt) => opt.value === value);
}

export function getInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'zh-CN';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && isSupportedLocale(saved)) return saved;
  const languages = navigator.languages ?? [navigator.language];
  for (const lang of languages) {
    const normalized = lang.toLowerCase();
    if (isSupportedLocale(normalized)) return normalized;
    if (normalized.startsWith('zh')) return 'zh-CN';
    if (normalized.startsWith('en')) return 'en';
  }
  return 'zh-CN';
}

export function saveLocale(locale: SupportedLocale): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, locale);
}
