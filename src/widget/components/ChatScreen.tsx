'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { localize } from '@/i18n';
import type { ChannelSettings } from '@/settings/schema';
import { useI18n } from '../I18n';
import type { ChatState } from '../reducer';
import type { ChatMessage } from '../types';
import type { OutgoingFile } from '../useChat';
import { Composer, type ComposerHandle } from './Composer';
import { MessageBubble } from './MessageBubble';
import { SecondaryButton } from './ui';

const NEAR_BOTTOM_PX = 80;

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

export function ChatScreen({
  state,
  token,
  settings,
  greeting,
  typingName,
  errorText,
  composerRef,
  onSend,
  onRetry,
  onLoadOlder,
  onError,
  onUnauthorized,
  onReload,
}: {
  state: ChatState;
  token: string;
  settings: ChannelSettings;
  greeting?: string;
  typingName: string | null;
  errorText: string | null;
  composerRef: React.RefObject<ComposerHandle | null>;
  onSend: (text: string, files: OutgoingFile[]) => void;
  onRetry: (clientMessageId: string) => void;
  onLoadOlder: () => void;
  onError: (code: string) => void;
  onUnauthorized: () => void;
  onReload: () => void;
}) {
  const { t, day, locale } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const { messages, status } = state;
  const lastId = messages.at(-1)?.id;

  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  // Follow the conversation while the reader is at the bottom; keep position when older pages arrive.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastId, messages.length, state.typing, status]);

  const loadOlder = () => {
    prevHeight.current = list.current?.scrollHeight ?? null;
    onLoadOlder();
  };
  useEffect(() => {
    if (!state.loadingOlder && prevHeight.current !== null && !state.hasMore) prevHeight.current = null;
  }, [state.loadingOlder, state.hasMore]);

  const attachments = settings.features.attachments;
  const dropHandlers = attachments
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          composerRef.current?.addFiles(e.dataTransfer.files);
        },
      }
    : {};

  const fallbackName = localize(settings.content.brandName, locale, settings.defaultLocale) ?? t('chat.agent');
  const shouldShowHeader = useCallback(
    (m: ChatMessage, prev?: ChatMessage) => !prev || prev.direction !== m.direction || prev.sender?.name !== m.sender?.name || !sameDay(prev.createdAt, m.createdAt),
    [],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropHandlers}>
      <div
        ref={list}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-label={t('chat.log')}
        aria-relevant="additions"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        {status === 'loading' && <p className="m-auto text-sm text-muted">{t('chat.loading')}</p>}
        {status === 'error' && (
          <div className="m-auto flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted">{t('status.loadFailed')}</p>
            <SecondaryButton onClick={onReload}>{t('status.retry')}</SecondaryButton>
          </div>
        )}
        {status === 'ready' && (
          <>
            {state.hasMore && (
              <SecondaryButton onClick={loadOlder} disabled={state.loadingOlder} className="mx-auto mb-2 min-h-8 px-3 py-1 text-xs">
                {state.loadingOlder ? t('chat.loading') : t('chat.loadOlder')}
              </SecondaryButton>
            )}
            <ul className="flex flex-col gap-1">
              {greeting && (
                <MessageBubble
                  message={{ id: 'greeting', seq: -1, direction: 'outbound', text: greeting, attachments: [], sender: null, clientMessageId: null, createdAt: messages[0]?.createdAt ?? new Date().toISOString() }}
                  showHeader
                  showTime={false}
                  fallbackName={fallbackName}
                  onRetry={onRetry}
                />
              )}
              {messages.length === 0 && !greeting && <li className="py-8 text-center text-sm text-muted">{t('chat.empty')}</li>}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const next = messages[i + 1];
                const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
                const lastOfGroup = !next || next.direction !== m.direction || next.sender?.name !== m.sender?.name || !sameDay(next.createdAt, m.createdAt);
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <li className="my-2 text-center text-xs text-muted first-letter:uppercase" aria-hidden="true">
                        {day(new Date(m.createdAt))}
                      </li>
                    )}
                    <MessageBubble message={m} showHeader={shouldShowHeader(m, newDay ? undefined : prev)} showTime={lastOfGroup} fallbackName={fallbackName} onRetry={onRetry} />
                  </Fragment>
                );
              })}
            </ul>
          </>
        )}
        <div aria-live="polite" className="min-h-5 ps-9 text-xs text-muted">
          {typingName !== null && (typingName ? t('chat.typing', { name: typingName }) : t('chat.typingAnonymous'))}
        </div>
      </div>

      {state.connection === 'reconnecting' && (
        <p role="status" className="bg-surface-2 px-3 py-1 text-center text-xs text-muted">
          {t('status.reconnecting')}
        </p>
      )}
      {errorText && (
        <p role="alert" className="bg-surface-2 px-3 py-2 text-center text-xs text-danger">
          {errorText}
        </p>
      )}
      <Composer ref={composerRef} token={token} attachments={attachments} onSend={onSend} onError={onError} onUnauthorized={onUnauthorized} />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center border-2 border-dashed border-brand bg-surface/90 text-sm font-medium text-fg">{t('composer.dropFiles')}</div>
      )}
    </div>
  );
}

