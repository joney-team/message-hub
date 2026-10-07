import type en from './messages/en.json';

/** English is the source of truth: the key type is derived from it. */
export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;

export interface LocaleInfo {
  code: string;
  name: string;
  dir: 'ltr' | 'rtl';
}

/** To add a language: add messages/<code>.json and one line in each of LOCALES, LOADERS and catalog.server.ts. */
export const LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'vi', name: 'Tiếng Việt', dir: 'ltr' },
  { code: 'ko', name: '한국어', dir: 'ltr' },
  { code: 'zh', name: '简体中文', dir: 'ltr' },
  { code: 'ja', name: '日本語', dir: 'ltr' },
  { code: 'th', name: 'ไทย', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'ru', name: 'Русский', dir: 'ltr' },
];

export const SUPPORTED_LOCALES = LOCALES.map((l) => l.code);

/** Lazy loaders: the widget iframe downloads only the catalog it needs. */
export const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./messages/en.json'),
  vi: () => import('./messages/vi.json'),
  ko: () => import('./messages/ko.json'),
  zh: () => import('./messages/zh.json'),
  ja: () => import('./messages/ja.json'),
  th: () => import('./messages/th.json'),
  fr: () => import('./messages/fr.json'),
  ru: () => import('./messages/ru.json'),
};

export function isSupportedLocale(code: string): boolean {
  return SUPPORTED_LOCALES.includes(code);
}
