import en from './en.js';
import zhCN from './zh-CN.js';
import zhTW from './zh-TW.js';
import ja from './ja.js';
import ko from './ko.js';
import es from './es.js';
import fr from './fr.js';
import de from './de.js';
import pt from './pt.js';
import ru from './ru.js';

export type { Messages } from './types.js';

export const messages = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
  es,
  fr,
  de,
  pt,
  ru,
};

export type SupportedLocale = keyof typeof messages;

export const supportedLocales: SupportedLocale[] = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'es',
  'fr',
  'de',
  'pt',
  'ru',
];
