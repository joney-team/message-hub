'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InitPayload, PreviewPayload, ToHost, ToIframe } from './protocol';
import type { PageContext, Profile } from './types';

export interface HostState {
  /** Running inside the loader's iframe (as opposed to opened directly). */
  embedded: boolean;
  /** Direct pages are ready at once; embedded ones after the loader answered `mh:hello`. */
  ready: boolean;
  token: string | null;
  explicitLocale: string | null;
  htmlLang: string | null;
  page: PageContext;
  identity: Profile | null;
  readSeq: number | null;
  open: boolean;
  preview: Omit<PreviewPayload, 'type'> | null;
}

const isEmbedded = () => typeof window !== 'undefined' && window.parent !== window;

const direct = (): HostState => ({
  embedded: false,
  ready: true,
  token: null,
  explicitLocale: new URLSearchParams(window.location.search).get('locale'),
  htmlLang: null,
  page: { referrer: document.referrer || undefined },
  identity: null,
  readSeq: null,
  open: true,
  preview: null,
});

export function useHost(previewMode: boolean) {
  const [host, setHost] = useState<HostState>({
    embedded: false,
    ready: false,
    token: null,
    explicitLocale: null,
    htmlLang: null,
    page: {},
    identity: null,
    readSeq: null,
    open: false,
    preview: null,
  });
  const parentOrigin = useRef<string | null>(null);

  const post = useCallback((message: ToHost) => {
    if (!isEmbedded()) return;
    // Before `mh:init` we do not know who the parent is; the hello carries no data.
    window.parent.postMessage(message, message.type === 'mh:hello' ? '*' : (parentOrigin.current ?? 'null'));
  }, []);

  useEffect(() => {
    const embedded = isEmbedded();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync with the browser environment
    if (!embedded && !previewMode) setHost(direct());

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !embedded) return;
      const data = event.data as ToIframe | PreviewPayload | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type.startsWith('mh:')) return;

      if (data.type === 'mh:preview') {
        // Preview only paints settings the parent sends; it creates no visitor, so any parent may drive it.
        if (previewMode) setHost((h) => ({ ...h, ready: true, embedded: true, preview: { settings: data.settings, locale: data.locale, screen: data.screen } }));
        return;
      }
      if (previewMode) return;
      if (data.type === 'mh:init') {
        parentOrigin.current = event.origin;
        const init = data as InitPayload;
        setHost((h) => ({ ...h, embedded: true, ready: true, token: init.token, explicitLocale: init.locale, htmlLang: init.htmlLang, page: init.page ?? {}, identity: init.identify, readSeq: init.readSeq ?? null, open: init.open }));
        return;
      }
      if (event.origin !== parentOrigin.current) return;
      switch (data.type) {
        case 'mh:open':
          setHost((h) => ({ ...h, open: true, page: data.page ?? h.page }));
          break;
        case 'mh:close':
          setHost((h) => ({ ...h, open: false }));
          break;
        case 'mh:locale':
          setHost((h) => ({ ...h, explicitLocale: data.locale }));
          break;
        case 'mh:identify':
          setHost((h) => ({ ...h, identity: data.profile }));
          break;
      }
    };
    window.addEventListener('message', onMessage);
    // Framed by something that is not our loader (no `mh:init` ever arrives): behave like a standalone page.
    const fallback = embedded && !previewMode ? setTimeout(() => setHost((h) => (h.ready ? h : { ...direct(), embedded: false })), 1500) : undefined;
    if (embedded) {
      if (previewMode) window.parent.postMessage({ type: 'mh:hello' } satisfies ToHost, '*');
      else post({ type: 'mh:hello' });
    }
    return () => {
      clearTimeout(fallback);
      window.removeEventListener('message', onMessage);
    };
  }, [previewMode, post]);

  return { host, post };
}
