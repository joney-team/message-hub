import type { PageContext, Profile } from './types';

/**
 * postMessage protocol between the loader (host page) and the chat iframe.
 * The iframe starts with `mh:hello`; the loader answers with `mh:init`. After that the iframe
 * only accepts messages whose `event.source` is its parent and whose origin is the one
 * that sent `mh:init`, and only posts back to that origin.
 */
export interface InitPayload {
  token: string | null;
  /** From `data-locale` / `setLocale()`; wins over everything else. */
  locale: string | null;
  /** `<html lang>` of the host page. */
  htmlLang: string | null;
  page: PageContext;
  identify: Profile | null;
  /** Highest message seq the visitor has read (kept by the loader in the host page's storage). */
  readSeq: number | null;
  open: boolean;
}

export type ToIframe =
  | ({ type: 'mh:init' } & InitPayload)
  | { type: 'mh:open'; page?: PageContext }
  | { type: 'mh:close' }
  | { type: 'mh:locale'; locale: string | null }
  | { type: 'mh:identify'; profile: Profile };

export type ToHost =
  | { type: 'mh:hello' }
  | { type: 'mh:ready' }
  | { type: 'mh:token'; token: string | null }
  | { type: 'mh:unread'; count: number }
  | { type: 'mh:read'; seq: number }
  | { type: 'mh:message'; message: { id: string; text: string; createdAt: string } }
  | { type: 'mh:close-request' }
  | { type: 'mh:error'; code: string };

export interface PreviewPayload {
  type: 'mh:preview';
  settings: unknown;
  locale?: string;
  screen?: 'welcome' | 'prechat' | 'chat';
}
