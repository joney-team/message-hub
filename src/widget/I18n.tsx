'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, formatBytes, formatDay, formatTime, localeInfo, type CatalogData, type Translate } from '@/i18n';

interface I18n {
  locale: string;
  dir: 'ltr' | 'rtl';
  t: Translate;
  time: (d: Date | number) => string;
  day: (d: Date | number) => string;
  bytes: (n: number) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  catalogs,
  overrides,
  children,
}: {
  locale: string;
  catalogs: { primary: CatalogData; fallback: CatalogData };
  overrides: Record<string, string>;
  children: ReactNode;
}) {
  const value = useMemo<I18n>(
    () => ({
      locale,
      dir: localeInfo(locale).dir,
      t: createTranslator(catalogs, overrides),
      time: (d) => formatTime(d, locale),
      day: (d) => formatDay(d, locale),
      bytes: (n) => formatBytes(n, locale),
    }),
    [locale, catalogs, overrides],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
