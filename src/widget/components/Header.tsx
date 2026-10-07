'use client';

import { IconLogout, IconMinimize } from '../icons';
import { useI18n } from '../I18n';
import { IconButton } from './ui';

export function Header({ title, logo, onMinimize, onEnd }: { title: string; logo?: string; onMinimize?: () => void; onEnd?: () => void }) {
  const { t } = useI18n();
  return (
    <header className="flex items-center gap-2 bg-brand py-2 ps-4 pe-2 text-brand-fg">
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element -- remote channel logo, no optimiser in the iframe
        <img src={logo} alt="" width={32} height={32} referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-mh-sm bg-white/20 object-cover" />
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
      {onEnd && (
        <IconButton label={t('header.endChat')} onClick={onEnd}>
          <IconLogout />
        </IconButton>
      )}
      {onMinimize && (
        <IconButton label={t('header.minimize')} onClick={onMinimize}>
          <IconMinimize />
        </IconButton>
      )}
    </header>
  );
}
