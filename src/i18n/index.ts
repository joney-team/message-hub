import { LOADERS, SUPPORTED_LOCALES, type LocaleInfo, LOCALES, type MessageKey } from './catalog';

export type { MessageKey } from './catalog';
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;
export type LocalizedText = Record<string, string>;

/** `vi-VN` → `vi`, `EN_us` → `en`. */
export function shortLocale(code: string): string {
  return code.split(/[-_]/)[0].toLowerCase();
}

/** First of `candidates` the channel offers (exact match first, then language only). */
export function matchLocale(candidates: Array<string | null | undefined>, enabled: string[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const exact = enabled.find((e) => e.toLowerCase() === c.toLowerCase().replace('_', '-'));
    if (exact) return exact;
    const short = enabled.find((e) => e.toLowerCase() === shortLocale(c));
    if (short) return short;
  }
  return null;
}

export interface LocaleInputs {
  /** `data-locale` on the script tag, `MessageHub.setLocale()` or `?locale=`. */
  explicit?: string | null;
  /** `<html lang>` of the host page. */
  htmlLang?: string | null;
  navigatorLanguages?: readonly string[];
  enabled: string[];
  defaultLocale: string;
}

/** Order: explicit → host `<html lang>` → browser languages → channel default. */
export function resolveLocale(i: LocaleInputs): string {
  return (
    matchLocale([i.explicit], i.enabled) ??
    matchLocale([i.htmlLang], i.enabled) ??
    matchLocale([...(i.navigatorLanguages ?? [])], i.enabled) ??
    matchLocale([i.defaultLocale], i.enabled) ??
    i.enabled[0] ??
    'en'
  );
}

export function localeInfo(code: string): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? { code, name: code, dir: 'ltr' };
}

/** Pick a channel-owned string: locale → language → default locale. */
export function localize(text: LocalizedText | undefined, locale: string, defaultLocale: string): string | undefined {
  if (!text) return undefined;
  const pick = (code: string) => {
    const v = text[code] ?? text[shortLocale(code)];
    return v && v.trim() ? v : undefined;
  };
  return pick(locale) ?? pick(defaultLocale);
}

export type CatalogData = Record<string, string>;

/** Downloads one catalog (plus English as fallback when different). */
export async function loadCatalogs(locale: string): Promise<{ primary: CatalogData; fallback: CatalogData }> {
  const code = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const [primary, fallback] = await Promise.all([LOADERS[code](), code === 'en' ? null : LOADERS.en()]);
  return { primary: primary.default, fallback: (fallback ?? primary).default };
}

/** Lookup order: channel override → locale catalog → English. Output is always plain text. */
export function createTranslator(
  catalogs: { primary: CatalogData; fallback: CatalogData },
  overrides: Record<string, string> = {},
): Translate {
  return (key, params) => {
    const template = overrides[key] ?? catalogs.primary[key] ?? catalogs.fallback[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
  };
}

export function formatTime(date: Date | number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date);
}

/** "Today" / "Yesterday" come from Intl in the right language; older days use a plain date. */
export function formatDay(date: Date | number, locale: string, now: Date | number = Date.now()): string {
  const d = new Date(date);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date(now))) / 86_400_000);
  if (days === 0 || days === -1) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

export function formatBytes(bytes: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: units[i], unitDisplay: 'narrow', maximumFractionDigits: value < 10 && i > 0 ? 1 : 0 }).format(value);
}
