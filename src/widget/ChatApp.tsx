'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCatalogs, localeInfo, localize, resolveLocale, type CatalogData } from '@/i18n';
import { completeSettings } from '@/settings/defaults';
import type { ChannelSettings } from '@/settings/schema';
import { ChatScreen } from './components/ChatScreen';
import type { ComposerHandle } from './components/Composer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Header } from './components/Header';
import { PreChat } from './components/PreChat';
import { SecondaryButton } from './components/ui';
import { Welcome } from './components/Welcome';
import { I18nProvider, useI18n } from './I18n';
import { chatReducer, initialChatState, type ChatState } from './reducer';
import { playChime } from './sound';
import { computeUnread } from './unread';
import { themeStyle } from './theme';
import type { Profile, ServerMessage } from './types';
import { useChat } from './useChat';
import { useHost } from './useHost';
import { useSession } from './useSession';

type Screen = 'welcome' | 'prechat';

interface I18nState {
  locale: string;
  catalogs: { primary: CatalogData; fallback: CatalogData };
}

interface Props {
  channelId: string;
  channelName: string;
  initialSettings: ChannelSettings;
  /** `?preview=1`: paints settings sent by the parent, never talks to the server. */
  preview: boolean;
}

export function ChatApp(props: Props) {
  const { host, post } = useHost(props.preview);
  const settings = useMemo(() => (props.preview && host.preview?.settings !== undefined ? completeSettings(host.preview.settings) : props.initialSettings), [props.preview, host.preview, props.initialSettings]);

  const [i18n, setI18n] = useState<I18nState | null>(null);
  const explicit = props.preview ? (host.preview?.locale ?? null) : host.explicitLocale;
  const enabled = settings.locales;
  const enabledKey = enabled.join(',');
  const defaultLocale = settings.defaultLocale;
  useEffect(() => {
    if (!host.ready) return;
    const locale = resolveLocale({ explicit, htmlLang: host.htmlLang, navigatorLanguages: navigator.languages, enabled: enabledKey.split(','), defaultLocale });
    let cancelled = false;
    loadCatalogs(locale).then((catalogs) => !cancelled && setI18n({ locale, catalogs }));
    return () => {
      cancelled = true;
    };
  }, [host.ready, explicit, host.htmlLang, enabledKey, defaultLocale]);

  const readySent = useRef(false);
  useEffect(() => {
    if (!i18n || !host.embedded || props.preview || readySent.current) return;
    readySent.current = true;
    post({ type: 'mh:ready' });
  }, [i18n, host.embedded, props.preview, post]);

  const overrides = useMemo(() => {
    const o = (i18n && settings.content.overrides?.[i18n.locale]) ?? {};
    return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string'));
  }, [i18n, settings.content.overrides]);

  useEffect(() => {
    if (!i18n) return;
    document.documentElement.lang = i18n.locale;
    document.documentElement.dir = localeInfo(i18n.locale).dir;
  }, [i18n]);

  const rootProps = {
    className: 'mh-root flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-fg',
    'data-scheme': settings.theme.colorScheme,
    style: themeStyle(settings.theme),
  };

  if (!i18n) {
    return (
      <div {...rootProps} aria-busy="true">
        <div className="h-14 bg-brand" />
        <div className="flex flex-1 flex-col gap-3 p-5" aria-hidden="true">
          <div className="h-6 w-2/3 animate-pulse rounded-mh-sm bg-surface-2" />
          <div className="h-4 w-1/2 animate-pulse rounded-mh-sm bg-surface-2" />
          <div className="mt-4 h-10 w-full animate-pulse rounded-mh-sm bg-surface-2" />
        </div>
      </div>
    );
  }

  return (
    <I18nProvider locale={i18n.locale} catalogs={i18n.catalogs} overrides={overrides}>
      <div {...rootProps} dir={localeInfo(i18n.locale).dir} lang={i18n.locale}>
        <App {...props} settings={settings} host={host} post={post} />
      </div>
    </I18nProvider>
  );
}

const SAMPLE_STATE = (t: ReturnType<typeof useI18n>['t']): ChatState => {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const base = { attachments: [], clientMessageId: null };
  return chatReducer(initialChatState, {
    type: 'loaded',
    hasMore: false,
    messages: [
      { ...base, id: 'p1', seq: 1, direction: 'inbound', text: t('welcome.title'), sender: null, createdAt: at(3) },
      { ...base, id: 'p2', seq: 2, direction: 'outbound', text: t('welcome.subtitle'), sender: { name: t('chat.agent') }, createdAt: at(2) },
    ],
  });
};

function App({ channelId, channelName, settings, preview, host, post }: Props & { settings: ChannelSettings; host: ReturnType<typeof useHost>['host']; post: ReturnType<typeof useHost>['post'] }) {
  const { t, locale } = useI18n();
  const [screen, setScreen] = useState<Screen>('welcome');
  const [previewScreen, setPreviewScreen] = useState<'welcome' | 'prechat' | 'chat'>('welcome');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [starter, setStarter] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const unread = useRef(0);
  const maxSeq = useRef(0);
  const interacted = useRef(false);
  const sample = useMemo(() => SAMPLE_STATE(t), [t]);

  const session = useSession({ channelId, host, locale, enabled: !preview, post });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the screen the parent form asks for
    if (preview) setPreviewScreen(host.preview?.screen ?? 'welcome');
  }, [preview, host.preview?.screen]);

  const showError = useCallback((code: string) => {
    setErrorCode(code);
  }, []);
  useEffect(() => {
    if (!errorCode) return;
    const id = setTimeout(() => setErrorCode(null), 6000);
    return () => clearTimeout(id);
  }, [errorCode]);
  const errorText = errorCode ? errorMessage(t, errorCode) : null;

  // ---- unread badge, `message` event and sound
  const markRead = useCallback(() => {
    if (host.embedded) post({ type: 'mh:read', seq: maxSeq.current });
  }, [host.embedded, post]);

  // The iframe of a returning visitor loads hidden, before any click. Sound stays off until the
  // person has actually interacted with this frame (browsers would block it anyway).
  useEffect(() => {
    const mark = () => (interacted.current = true);
    window.addEventListener('pointerdown', mark, { once: true });
    window.addEventListener('keydown', mark, { once: true });
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);

  const onLoaded = useCallback(
    (messages: ServerMessage[]) => {
      const { unread: n, maxSeq: top } = computeUnread(messages, host.readSeq);
      maxSeq.current = Math.max(maxSeq.current, top);
      if (host.open) return markRead();
      // Closed: report what arrived while the visitor was away; never mark anything as read.
      if (host.embedded && n > 0) {
        unread.current = n;
        post({ type: 'mh:unread', count: n });
      }
    },
    [host.readSeq, host.open, host.embedded, markRead, post],
  );

  const onOutbound = useCallback(
    (m: ServerMessage) => {
      post({ type: 'mh:message', message: { id: m.id, text: m.text, createdAt: m.createdAt } });
      maxSeq.current = Math.max(maxSeq.current, m.seq);
      const away = host.embedded && !host.open;
      if (away) {
        unread.current += 1;
        post({ type: 'mh:unread', count: unread.current });
      } else markRead();
      if (settings.features.sound && (away || document.hidden) && (interacted.current || navigator.userActivation?.hasBeenActive)) playChime();
    },
    [post, markRead, host.embedded, host.open, settings.features.sound],
  );
  useEffect(() => {
    if (!host.open) return;
    if (unread.current > 0) {
      unread.current = 0;
      post({ type: 'mh:unread', count: 0 });
    }
    markRead();
  }, [host.open, post, markRead]);

  // ---- keyboard: Escape asks the loader to close the window (unless a dialog is open)
  useEffect(() => {
    if (!host.embedded || preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) post({ type: 'mh:close-request' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host.embedded, preview, post]);

  // ---- move focus into the window when it opens or the screen changes
  const effectiveScreen = preview ? previewScreen : session.status === 'ready' ? 'chat' : screen;
  useEffect(() => {
    if (!host.open || preview) return;
    // A timeout, not requestAnimationFrame: frames are paused in background tabs and the focus would never arrive.
    const id = setTimeout(() => document.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 30);
    return () => clearTimeout(id);
  }, [host.open, effectiveScreen, preview, session.status]);

  const fields = settings.preChat.fields;
  const needsPreChat = settings.preChat.mode !== 'off' && fields.length > 0 && fields.some((f) => host.identity?.[f.key] === undefined);

  const begin = async (profile?: Profile) => {
    const ok = await session.start(profile);
    if (!ok) setScreen('welcome');
  };
  const onStart = () => (needsPreChat ? setScreen('prechat') : void begin());
  const onStarter = (text: string) => {
    setStarter(text);
    if (needsPreChat) setScreen('prechat');
    else void begin();
  };

  const brandName = localize(settings.content.brandName, locale, settings.defaultLocale) ?? channelName;
  const title = brandName || t('header.title');
  const welcomeTitle = localize(settings.content.welcomeTitle, locale, settings.defaultLocale) ?? t('welcome.title');
  const welcomeSubtitle = localize(settings.content.welcomeSubtitle, locale, settings.defaultLocale) ?? t('welcome.subtitle');
  const greeting = localize(settings.content.greeting, locale, settings.defaultLocale);
  const starters = (settings.content.starters ?? []).map((s) => localize(s, locale, settings.defaultLocale)).filter((s): s is string => !!s);
  const startError = session.errorCode && session.status === 'none' ? errorMessage(t, session.errorCode) : null;

  const onMinimize = host.embedded && !preview ? () => post({ type: 'mh:close-request' }) : undefined;
  const canEnd = !preview && session.status === 'ready';

  let body;
  if (effectiveScreen === 'chat') {
    body = preview ? (
      <ChatScreen
        state={sample}
        token=""
        settings={settings}
        greeting={greeting}
        typingName={null}
        errorText={null}
        composerRef={composer}
        onSend={() => {}}
        onRetry={() => {}}
        onLoadOlder={() => {}}
        onError={() => {}}
        onUnauthorized={() => {}}
        onReload={() => {}}
      />
    ) : session.token ? (
      <LiveChat
        key={`${session.token}:${reloadKey}`}
        token={session.token}
        settings={settings}
        greeting={greeting}
        page={host.page}
        starter={starter}
        onStarterSent={() => setStarter(null)}
        onOutbound={onOutbound}
        onLoaded={onLoaded}
        onUnauthorized={session.expire}
        onError={showError}
        errorText={errorText}
        composer={composer}
        onReload={() => setReloadKey((k) => k + 1)}
      />
    ) : null;
  } else if (effectiveScreen === 'prechat' && settings.preChat.mode !== 'off') {
    body = (
      <PreChat
        fields={fields}
        mode={settings.preChat.mode}
        defaultLocale={settings.defaultLocale}
        initial={host.identity ?? {}}
        busy={session.status === 'starting'}
        onSubmit={(profile) => (preview ? setPreviewScreen('chat') : void begin(profile))}
        onSkip={() => (preview ? setPreviewScreen('chat') : void begin())}
      />
    );
  } else if (session.status === 'checking' && !preview) {
    body = (
      <p role="status" className="m-auto text-sm text-muted">
        {t('chat.loading')}
      </p>
    );
  } else if (session.status === 'error') {
    body = (
      <div className="m-auto flex flex-col items-center gap-3 p-5 text-center">
        <p className="text-sm text-muted">{t('status.loadFailed')}</p>
        <SecondaryButton data-autofocus onClick={session.retry}>
          {t('status.retry')}
        </SecondaryButton>
      </div>
    );
  } else {
    body = (
      <Welcome
        title={welcomeTitle}
        subtitle={welcomeSubtitle}
        starters={starters}
        busy={session.status === 'starting'}
        error={startError}
        onStart={() => (preview ? setPreviewScreen(needsPreChat ? 'prechat' : 'chat') : onStart())}
        onStarter={(text) => (preview ? setPreviewScreen(needsPreChat ? 'prechat' : 'chat') : onStarter(text))}
      />
    );
  }

  return (
    <>
      <Header title={title} logo={settings.theme.logo} onMinimize={onMinimize} onEnd={canEnd ? () => setConfirmEnd(true) : undefined} />
      <main className="flex min-h-0 flex-1 flex-col">{body}</main>
      <ConfirmDialog
        open={confirmEnd}
        title={t('endChat.title')}
        body={t('endChat.body')}
        confirmLabel={t('endChat.confirm')}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          setScreen('welcome');
          setStarter(null);
          void session.end();
        }}
      />
    </>
  );
}

const ERROR_CODES = ['UNAUTHORIZED', 'RATE_LIMITED', 'PAYLOAD_TOO_LARGE', 'FILE_TOO_LARGE', 'FILE_TYPE_NOT_ALLOWED', 'ATTACHMENTS_DISABLED', 'VALIDATION_ERROR', 'NETWORK', 'INTERNAL'] as const;

/** API error code → translated sentence; unknown codes read as a generic failure. */
function errorMessage(t: ReturnType<typeof useI18n>['t'], code: string): string {
  const known = (ERROR_CODES as readonly string[]).includes(code) ? (code as (typeof ERROR_CODES)[number]) : 'INTERNAL';
  return t(`error.${known}`);
}

function LiveChat({
  token,
  settings,
  greeting,
  page,
  starter,
  onStarterSent,
  onOutbound,
  onLoaded,
  onUnauthorized,
  onError,
  errorText,
  composer,
  onReload,
}: {
  token: string;
  settings: ChannelSettings;
  greeting?: string;
  page: import('./types').PageContext;
  starter: string | null;
  onStarterSent: () => void;
  onOutbound: (m: ServerMessage) => void;
  onLoaded: (messages: ServerMessage[]) => void;
  onUnauthorized: () => void;
  onError: (code: string) => void;
  errorText: string | null;
  composer: React.RefObject<ComposerHandle | null>;
  onReload: () => void;
}) {
  const chat = useChat({ token, page, onOutbound, onLoaded, onUnauthorized, onError });
  const sentStarter = useRef(false);
  const { send } = chat;
  const ready = chat.state.status === 'ready';
  useEffect(() => {
    if (!starter || !ready || sentStarter.current) return;
    sentStarter.current = true;
    send(starter);
    onStarterSent();
  }, [starter, ready, send, onStarterSent]);

  const typing = chat.state.typing;
  return (
    <ChatScreen
      state={chat.state}
      token={token}
      settings={settings}
      greeting={greeting}
      typingName={typing ? (typing.name ?? '') : null}
      errorText={errorText}
      composerRef={composer}
      onSend={(text, files) => send(text, files)}
      onRetry={chat.retry}
      onLoadOlder={chat.loadOlder}
      onError={onError}
      onUnauthorized={onUnauthorized}
      onReload={onReload}
    />
  );
}
