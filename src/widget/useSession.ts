'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from './api';
import type { ToHost } from './protocol';
import type { HostState } from './useHost';
import type { Profile, VisitorInfo } from './types';

export type SessionStatus = 'checking' | 'none' | 'starting' | 'ready' | 'error';

const storageKey = (channelId: string) => `mh:token:${channelId}`;

function readStored(channelId: string): string | null {
  try {
    return localStorage.getItem(storageKey(channelId));
  } catch {
    return null;
  }
}

function writeStored(channelId: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(storageKey(channelId), token);
    else localStorage.removeItem(storageKey(channelId));
  } catch {
    // private mode: the conversation just will not survive a reload
  }
}

interface Options {
  channelId: string;
  host: HostState;
  locale: string;
  enabled: boolean;
  post: (m: ToHost) => void;
}

/**
 * The visitor session. Nothing is created on the server until `start()` is called
 * (the person pressed "Start chat"), so a page nobody opens the chat on writes nothing.
 */
export function useSession({ channelId, host, locale, enabled, post }: Options) {
  const [status, setStatus] = useState<SessionStatus>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<VisitorInfo | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const checked = useRef(false);

  const persist = useCallback(
    (value: string | null) => {
      setToken(value);
      if (host.embedded) post({ type: 'mh:token', token: value });
      else writeStored(channelId, value);
    },
    [channelId, host.embedded, post],
  );

  const check = useCallback(
    async (candidate: string) => {
      setStatus('checking');
      try {
        const { visitor: v } = await api.me(candidate);
        setToken(candidate);
        setVisitor(v);
        setStatus('ready');
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          persist(null);
          setStatus('none');
        } else {
          setErrorCode(err instanceof ApiClientError ? err.code : 'INTERNAL');
          setStatus('error');
        }
      }
    },
    [persist],
  );

  // Resume an existing conversation once the host has told us about the stored token.
  useEffect(() => {
    if (!enabled || !host.ready || checked.current) return;
    checked.current = true;
    const stored = host.embedded ? host.token : readStored(channelId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial resume from storage
    if (stored) void check(stored);
    else setStatus('none');
  }, [enabled, host.ready, host.embedded, host.token, channelId, check]);

  const start = useCallback(
    async (profile?: Profile) => {
      setStatus('starting');
      setErrorCode(null);
      try {
        const merged = { ...(host.identity ?? {}), ...(profile ?? {}) };
        const { visitor: v, token: t } = await api.createSession(channelId, { locale, profile: Object.keys(merged).length ? merged : undefined, origin: host.page.url });
        persist(t);
        setVisitor(v);
        setStatus('ready');
        return true;
      } catch (err) {
        setErrorCode(err instanceof ApiClientError ? err.code : 'INTERNAL');
        setStatus('none');
        return false;
      }
    },
    [channelId, host.identity, host.page.url, locale, persist],
  );

  /** Conversation logout: forget the token here and tell the server to stop accepting it. */
  const end = useCallback(async () => {
    const t = token;
    persist(null);
    setVisitor(null);
    setStatus('none');
    if (t) await api.revoke(t).catch(() => {});
  }, [persist, token]);

  const expire = useCallback(() => {
    persist(null);
    setVisitor(null);
    setErrorCode('UNAUTHORIZED');
    setStatus('none');
  }, [persist]);

  const retry = useCallback(() => {
    const stored = host.embedded ? host.token : readStored(channelId);
    if (stored) void check(stored);
    else setStatus('none');
  }, [channelId, check, host.embedded, host.token]);

  // Keep the server's copy of locale / identity current.
  const syncedLocale = useRef<string | null>(null);
  const syncedIdentity = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' || !token || !visitor) return;
    const patch: { locale?: string; profile?: Profile } = {};
    if (locale !== visitor.locale && syncedLocale.current !== locale) {
      syncedLocale.current = locale;
      patch.locale = locale;
    }
    const idKey = JSON.stringify(host.identity ?? {});
    if (host.identity && syncedIdentity.current !== idKey) {
      syncedIdentity.current = idKey;
      patch.profile = host.identity;
    }
    if (!patch.locale && !patch.profile) return;
    api
      .updateMe(token, patch)
      .then(({ visitor: v }) => setVisitor(v))
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 401) expire();
      });
  }, [status, token, visitor, locale, host.identity, expire]);

  return { status, token, visitor, errorCode, start, end, expire, retry };
}
