import en from './en.js';
import zhCN from './zh-CN.js';

export type { Messages } from './types.js';

export const messages = {
  en,
  'zh-CN': zhCN,
};

export type SupportedLocale = keyof typeof messages;

export const supportedLocales: SupportedLocale[] = ['zh-CN', 'en'];
