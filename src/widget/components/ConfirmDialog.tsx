'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '../I18n';
import { PrimaryButton, SecondaryButton } from './ui';

/** Native `<dialog>`: focus is trapped, Escape closes, focus returns to the opener. */
export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: { open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="mh-confirm-title"
      aria-describedby="mh-confirm-body"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-mh border border-line bg-surface p-5 text-fg shadow-xl backdrop:bg-black/50"
    >
      <h2 id="mh-confirm-title" className="text-base font-semibold">
        {title}
      </h2>
      <p id="mh-confirm-body" className="mt-2 text-sm text-muted">
        {body}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <SecondaryButton onClick={onCancel} autoFocus>
          {t('endChat.cancel')}
        </SecondaryButton>
        <PrimaryButton onClick={onConfirm}>{confirmLabel}</PrimaryButton>
      </div>
    </dialog>
  );
}
