'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ALLOWED_EXTENSIONS } from '@/server/files-policy';
import { api, ApiClientError } from '../api';
import { IconClose, IconPaperclip, IconSend } from '../icons';
import { useI18n } from '../I18n';
import type { OutgoingFile } from '../useChat';
import { focusRing } from './ui';

const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');
const MAX_PENDING = 5;

interface Pending {
  key: number;
  file: File;
  status: 'uploading' | 'done' | 'error';
  result?: OutgoingFile;
}

export interface ComposerHandle {
  focus: () => void;
  addFiles: (files: FileList | File[]) => void;
}

export const Composer = forwardRef<ComposerHandle, { token: string; attachments: boolean; onSend: (text: string, files: OutgoingFile[]) => void; onError: (code: string) => void; onUnauthorized: () => void }>(function Composer(
  { token, attachments, onSend, onError, onUnauthorized },
  ref,
) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  // `field-sizing: content` does the resizing where supported; this is the fallback.
  useEffect(() => {
    const el = area.current;
    if (!el || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (!attachments) return;
      const files = [...list].slice(0, MAX_PENDING);
      for (const file of files) {
        const key = ++counter.current;
        setPending((p) => (p.length >= MAX_PENDING ? p : [...p, { key, file, status: 'uploading' }]));
        api
          .upload(token, file)
          .then((r) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'done', result: { fileId: r.id, name: r.name, mime: r.mime, size: r.size, url: r.url } } : x))))
          .catch((err) => {
            setPending((p) => p.filter((x) => x.key !== key));
            if (err instanceof ApiClientError && err.status === 401) onUnauthorized();
            else onError(err instanceof ApiClientError ? err.code : 'INTERNAL');
          });
      }
    },
    [attachments, token, onError, onUnauthorized],
  );

  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), addFiles }), [addFiles]);

  const uploading = pending.some((p) => p.status === 'uploading');
  const ready = pending.filter((p) => p.status === 'done' && p.result).map((p) => p.result!);
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0);

  const send = () => {
    if (!canSend) return;
    onSend(text.trim(), ready);
    setText('');
    setPending([]);
    area.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter confirms an IME candidate (Vietnamese Telex, CJK) and must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div className="border-t border-line bg-surface p-2">
      {pending.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {pending.map((p) => (
            <li key={p.key} className="flex max-w-full items-center gap-1 rounded-mh-sm bg-surface-2 py-1 ps-2 pe-1 text-xs text-fg">
              <span className="truncate" title={p.file.name}>
                {p.status === 'uploading' ? t('composer.uploading', { name: p.file.name }) : p.file.name}
              </span>
              <button
                type="button"
                aria-label={t('composer.removeFile', { name: p.file.name })}
                onClick={() => setPending((l) => l.filter((x) => x.key !== p.key))}
                className={`grid size-6 shrink-0 place-items-center rounded-full hover:bg-black/10 ${focusRing}`}
              >
                <IconClose width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1">
        {attachments && (
          <>
            <input ref={input} type="file" multiple accept={ACCEPT} onChange={onPick} className="sr-only" tabIndex={-1} aria-hidden="true" />
            <button
              type="button"
              aria-label={t('composer.attach')}
              title={t('composer.attach')}
              onClick={() => input.current?.click()}
              className={`grid size-10 shrink-0 place-items-center rounded-mh-sm text-muted hover:bg-surface-2 hover:text-fg ${focusRing}`}
            >
              <IconPaperclip />
            </button>
          </>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('composer.label')}
          placeholder={t('composer.placeholder')}
          maxLength={4000}
          data-autofocus=""
          className="mh-textarea min-w-0 flex-1 resize-none rounded-mh-sm border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
        />
        <button
          type="button"
          aria-label={t('composer.send')}
          title={t('composer.send')}
          disabled={!canSend}
          onClick={send}
          className={`grid size-10 shrink-0 place-items-center rounded-mh-sm bg-brand text-brand-fg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
        >
          <IconSend className="rtl:-scale-x-100" />
        </button>
      </div>
    </div>
  );
});
