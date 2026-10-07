'use client';

import { useI18n } from '../I18n';
import { PrimaryButton, SecondaryButton } from './ui';

export function Welcome({
  title,
  subtitle,
  starters,
  busy,
  error,
  onStart,
  onStarter,
}: {
  title: string;
  subtitle: string;
  starters: string[];
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onStarter: (text: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5" tabIndex={0}>
      <div className="mt-4 text-center">
        <h2 className="text-xl font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-mh-sm bg-surface-2 px-3 py-2 text-center text-sm text-danger">
          {error}
        </p>
      )}
      <PrimaryButton data-autofocus onClick={onStart} disabled={busy} className="mx-auto w-full max-w-xs">
        {t('welcome.start')}
      </PrimaryButton>
      {starters.length > 0 && (
        <section aria-label={t('welcome.starters')} className="flex flex-col gap-2">
          <h3 className="sr-only">{t('welcome.starters')}</h3>
          {starters.map((s, i) => (
            <SecondaryButton key={i} onClick={() => onStarter(s)} disabled={busy} className="w-full justify-start text-start">
              {s}
            </SecondaryButton>
          ))}
        </section>
      )}
    </div>
  );
}
