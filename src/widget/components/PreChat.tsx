'use client';

import { useId, useState, type FormEvent } from 'react';
import { localize } from '@/i18n';
import type { ChannelSettings } from '@/settings/schema';
import { useI18n } from '../I18n';
import type { Profile } from '../types';
import { PrimaryButton, SecondaryButton } from './ui';

type Field = ChannelSettings['preChat']['fields'][number];

const INPUT: Record<Field['type'], { type: string; inputMode?: 'tel' | 'email' | 'decimal' | 'text'; autoComplete?: string }> = {
  text: { type: 'text' },
  name: { type: 'text', autoComplete: 'name' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  number: { type: 'text', inputMode: 'decimal' },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PreChat({
  fields,
  mode,
  defaultLocale,
  initial,
  busy,
  onSubmit,
  onSkip,
}: {
  fields: Field[];
  mode: 'optional' | 'required';
  defaultLocale: string;
  initial: Profile;
  busy: boolean;
  onSubmit: (profile: Profile) => void;
  onSkip: () => void;
}) {
  const { t, locale } = useI18n();
  const uid = useId();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, String(initial[f.key] ?? '')])));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const profile: Profile = {};
    for (const f of fields) {
      const v = (values[f.key] ?? '').trim();
      if (!v) {
        if (f.required) next[f.key] = t('prechat.required');
        continue;
      }
      if (f.type === 'email' && !EMAIL.test(v)) next[f.key] = t('prechat.invalid');
      else if (f.type === 'number' && !Number.isFinite(Number(v.replace(',', '.')))) next[f.key] = t('prechat.invalid');
      else if (f.type === 'phone' && !/^[+\d][\d\s().-]{5,}$/.test(v)) next[f.key] = t('prechat.invalid');
      else profile[f.key] = f.type === 'number' ? Number(v.replace(',', '.')) : v;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) onSubmit(profile);
    else document.getElementById(`${uid}-${fields.find((f) => next[f.key])?.key}`)?.focus();
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div>
        <h2 className="text-lg font-semibold text-fg">{t('prechat.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('prechat.subtitle')}</p>
      </div>
      {fields.map((f, i) => {
        const id = `${uid}-${f.key}`;
        const label = localize(f.label, locale, defaultLocale) ?? t(`field.${f.type}`);
        const error = errors[f.key];
        const spec = INPUT[f.type];
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-fg">
              {label}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            <input
              id={id}
              name={f.key}
              type={spec.type}
              inputMode={spec.inputMode}
              autoComplete={spec.autoComplete}
              required={f.required}
              aria-required={f.required || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
              placeholder={localize(f.placeholder, locale, defaultLocale)}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              data-autofocus={i === 0 ? '' : undefined}
              className="min-h-10 w-full rounded-mh-sm border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand aria-[invalid=true]:border-danger"
            />
            {error && (
              <p id={`${id}-err`} className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>
        );
      })}
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <PrimaryButton type="submit" disabled={busy}>
          {t('prechat.submit')}
        </PrimaryButton>
        {mode === 'optional' && (
          <SecondaryButton onClick={onSkip} disabled={busy}>
            {t('prechat.skip')}
          </SecondaryButton>
        )}
      </div>
    </form>
  );
}
