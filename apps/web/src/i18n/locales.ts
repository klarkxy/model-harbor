import type { SupportedLocale } from '../locales/index.js';

export interface LocaleOption {
  value: SupportedLocale;
  label: string;
}

export const localeOptions: LocaleOption[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
];

const STORAGE_KEY = 'modelharbor-locale';

function isSupportedLocale(value: string): value is SupportedLocale {
  return localeOptions.some((opt) => opt.value === value);
}

function detectBrowserLocale(): SupportedLocale {
  const languages = navigator.languages ?? [navigator.language];
  for (const lang of languages) {
    const normalized = lang.toLowerCase();
    if (isSupportedLocale(normalized)) return normalized;
    // Accept base language matches (e.g. "zh" -> "zh-CN")
    const base = normalized.split('-')[0];
    if (!base) continue;
    if (base === 'zh') return 'zh-CN';
    if (isSupportedLocale(base)) return base;
  }
  return 'en';
}

export function getInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && isSupportedLocale(saved)) return saved;
  return detectBrowserLocale();
}

export function saveLocale(locale: SupportedLocale): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, locale);
}
