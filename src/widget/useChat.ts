'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiClientError } from './api';
import { chatReducer, initialChatState, lastSeq } from './reducer';
import { connectStream } from './stream';
import type { ChatMessage, PageContext, Sender, ServerMessage } from './types';

const TYPING_TTL_MS = 10_000;
const PAGE_SIZE = 30;

export function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

interface Options {
  token: string | null;
  page: PageContext;
  onOutbound: (m: ServerMessage) => void;
  onLoaded?: (messages: ServerMessage[]) => void;
  onUnauthorized: () => void;
  onError: (code: string) => void;
}

export interface OutgoingFile {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export function useChat({ token, page, onOutbound, onLoaded, onUnauthorized, onError }: Options) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef(state);
  const cb = useRef({ onOutbound, onLoaded, onUnauthorized, onError, page });
  useEffect(() => {
    stateRef.current = state;
    cb.current = { onOutbound, onLoaded, onUnauthorized, onError, page };
  });
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // History first, then the live stream starting from the newest seq we hold.
  useEffect(() => {
    if (!token) return;
    let stopStream = () => {};
    let cancelled = false;
    (async () => {
      try {
        const page1 = await api.messages(token, { limit: PAGE_SIZE });
        if (cancelled) return;
        dispatch({ type: 'loaded', messages: page1.data, hasMore: page1.hasMore });
        stateRef.current = { ...stateRef.current, messages: page1.data };
        cb.current.onLoaded?.(page1.data);
        stopStream = connectStream({
          token,
          lastSeq: () => lastSeq(stateRef.current.messages),
          onConnection: (value) => dispatch({ type: 'connection', value }),
          onUnauthorized: () => cb.current.onUnauthorized(),
          onFrame: (frame) => {
            try {
              const data = JSON.parse(frame.data);
              if (frame.event === 'message') {
                const message = data as ServerMessage;
                dispatch({ type: 'incoming', message });
                if (message.direction === 'outbound') cb.current.onOutbound(message);
              } else if (frame.event === 'resync') {
                // Missed more than the server replays: reload the latest page of history.
                api
                  .messages(token, { limit: PAGE_SIZE })
                  .then((p) => {
                    dispatch({ type: 'loaded', messages: p.data, hasMore: p.hasMore });
                    stateRef.current = { ...stateRef.current, messages: p.data };
                    cb.current.onLoaded?.(p.data);
                  })
                  .catch(() => {});
              } else if (frame.event === 'typing') {
                dispatch({ type: 'typing', sender: (data as { sender: Sender | null }).sender ?? {} });
                clearTimeout(typingTimer.current);
                typingTimer.current = setTimeout(() => dispatch({ type: 'typing', sender: null }), TYPING_TTL_MS);
              }
            } catch {
              // ignore a malformed frame
            }
          },
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) cb.current.onUnauthorized();
        else dispatch({ type: 'loadFailed' });
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
      clearTimeout(typingTimer.current);
    };
  }, [token]);

  const deliver = useCallback(
    async (m: ChatMessage) => {
      if (!token || !m.clientMessageId) return;
      try {
        const saved = await api.send(token, {
          text: m.text,
          attachments: m.attachments.map((a) => ({ fileId: a.fileId })),
          clientMessageId: m.clientMessageId,
          context: cb.current.page.url || cb.current.page.title || cb.current.page.referrer ? cb.current.page : undefined,
        });
        dispatch({ type: 'incoming', message: saved });
      } catch (err) {
        dispatch({ type: 'failed', clientMessageId: m.clientMessageId });
        const code = err instanceof ApiClientError ? err.code : 'INTERNAL';
        if (err instanceof ApiClientError && err.status === 401) cb.current.onUnauthorized();
        else cb.current.onError(code);
      }
    },
    [token],
  );

  const send = useCallback(
    (text: string, attachments: OutgoingFile[] = []) => {
      const clientMessageId = newClientId();
      const message: ChatMessage = {
        id: `local_${clientMessageId}`,
        seq: 0,
        direction: 'inbound',
        text,
        attachments,
        sender: null,
        clientMessageId,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      dispatch({ type: 'optimistic', message });
      void deliver(message);
    },
    [deliver],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const m = stateRef.current.messages.find((x) => x.clientMessageId === clientMessageId && x.seq === 0);
      if (!m) return;
      dispatch({ type: 'retrying', clientMessageId });
      void deliver(m);
    },
    [deliver],
  );

  const loadOlder = useCallback(async () => {
    const s = stateRef.current;
    if (!token || s.loadingOlder || !s.hasMore) return;
    const oldest = s.messages.find((m) => m.seq > 0);
    if (!oldest) return;
    dispatch({ type: 'olderStarted' });
    try {
      const older = await api.messages(token, { before: oldest.seq, limit: PAGE_SIZE });
      dispatch({ type: 'olderLoaded', messages: older.data, hasMore: older.hasMore });
    } catch {
      dispatch({ type: 'olderFailed' });
    }
  }, [token]);

  return { state, send, retry, loadOlder };
}
