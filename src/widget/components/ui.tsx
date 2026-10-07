'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function IconButton({ label, children, className = '', ...rest }: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid size-9 shrink-0 place-items-center rounded-mh-sm hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-mh-sm bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${className}`}
      {...rest}
    />
  );
}

export function SecondaryButton({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-mh-sm border border-line bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2 ${focusRing} ${className}`}
      {...rest}
    />
  );
}
