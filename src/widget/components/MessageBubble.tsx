'use client';

import { memo, useMemo } from 'react';
import { IconFile, IconRetry } from '../icons';
import { useI18n } from '../I18n';
import { tokenize } from '../linkify';
import type { Attachment, ChatMessage } from '../types';

function Text({ text }: { text: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.type === 'link' ? (
          <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all underline underline-offset-2">
            {tok.value}
          </a>
        ) : (
          tok.value
        ),
      )}
    </>
  );
}

function Attachments({ items, mine }: { items: Attachment[]; mine: boolean }) {
  const { t, bytes } = useI18n();
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {items.map((a) => (
        <li key={a.fileId}>
          {a.mime.startsWith('image/') ? (
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by this app */}
              <img src={a.url} alt={t('chat.imageAlt', { name: a.name })} loading="lazy" className="max-h-48 max-w-full rounded-mh-sm object-contain" />
            </a>
          ) : (
            <a
              href={a.url}
              download={a.name}
              className={`flex min-w-0 items-center gap-2 rounded-mh-sm border px-2 py-1.5 text-sm ${mine ? 'border-white/30 hover:bg-white/10' : 'border-line hover:bg-surface'}`}
            >
              <IconFile className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block text-xs opacity-80">{bytes(a.size)}</span>
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Avatar({ name, src }: { name: string; src?: string }) {
  const { t } = useI18n();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- remote agent avatar
    return <img src={src} alt={t('chat.avatar', { name })} width={28} height={28} referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-full bg-surface-2 object-cover" />;
  }
  return (
    <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  showHeader,
  showTime,
  fallbackName,
  onRetry,
}: {
  message: ChatMessage;
  showHeader: boolean;
  showTime: boolean;
  fallbackName: string;
  onRetry: (clientMessageId: string) => void;
}) {
  const { t, time } = useI18n();
  const mine = message.direction === 'inbound';
  const name = message.sender?.name ?? fallbackName;
  return (
    <li className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && (showHeader ? <Avatar name={name} src={message.sender?.avatar} /> : <span className="size-7 shrink-0" aria-hidden="true" />)}
      <div className={`flex min-w-0 max-w-[85%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {!mine && showHeader && <span className="mb-0.5 ms-1 text-xs text-muted">{name}</span>}
        <div
          className={`min-w-0 max-w-full whitespace-pre-wrap break-words rounded-mh px-3 py-2 text-sm ${
            mine ? 'rounded-ee-sm bg-brand text-brand-fg' : 'rounded-es-sm bg-surface-2 text-fg'
          } ${message.status === 'sending' ? 'opacity-70' : ''}`}
        >
          {message.text && <Text text={message.text} />}
          {message.attachments.length > 0 && <Attachments items={message.attachments} mine={mine} />}
        </div>
        {message.status === 'failed' && message.clientMessageId ? (
          <button
            type="button"
            onClick={() => onRetry(message.clientMessageId!)}
            className="mt-1 inline-flex items-center gap-1 rounded-mh-sm text-xs text-danger underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <IconRetry width={12} height={12} />
            {t('chat.failed')} · {t('chat.retry')}
          </button>
        ) : message.status === 'sending' ? (
          <span className="mt-0.5 text-xs text-muted">{t('chat.sending')}</span>
        ) : showTime ? (
          <time dateTime={message.createdAt} className="mt-0.5 text-xs text-muted">
            {time(new Date(message.createdAt))}
          </time>
        ) : null}
      </div>
    </li>
  );
});
