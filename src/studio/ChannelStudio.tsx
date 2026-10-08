'use client';

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Clock3,
  Code2,
  Eye,
  EyeOff,
  Inbox as InboxIcon,
  ListRestart,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Type,
  Webhook,
} from 'lucide-react';
import Image from 'next/image';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localize } from '@/i18n';
import { completeSettings } from '@/settings/defaults';
import { LAUNCHER_SIZE_STYLES } from '@/settings/launcher';
import type { ChannelSettings, LocalizedText } from '@/settings/schema';
import { readableOn } from '@/widget/theme';
import { Inbox } from './Inbox';
import {
  buildMergePatch,
  copyChannel,
  formatApiError,
  parseOrigins,
  type ApiErrorBody,
  type ChannelDto,
  type DeliveryDto,
  type StudioMeta,
} from './types';

type Tab = 'general' | 'appearance' | 'content' | 'behavior' | 'deliveries' | 'debug';
type PreviewScreen = 'welcome' | 'prechat' | 'chat';
type PreviewMode = 'launcher' | PreviewScreen;
type StudioView = 'inbox' | 'channels';
type Notice = { tone: 'success' | 'error'; text: string } | null;
type DeliveryFilter = 'all' | DeliveryDto['status'];

const EMPTY_META: StudioMeta = { version: '', apiVersion: 'v1', locales: [], messages: {} };
const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'Channel', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: SlidersHorizontal },
  { id: 'content', label: 'Content', icon: Type },
  { id: 'behavior', label: 'Behavior', icon: MessageCircle },
  { id: 'deliveries', label: 'Deliveries', icon: ListRestart },
  { id: 'debug', label: 'Debug', icon: Code2 },
];

async function api<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${key}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // The status still gives a useful error when a proxy returns a non-JSON body.
    }
    throw new Error(formatApiError(response.status, body));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function loadChannels(key: string): Promise<ChannelDto[]> {
  const all: ChannelDto[] = [];
  let offset = 0;
  for (;;) {
    const page = await api<{ data: ChannelDto[]; hasMore: boolean }>(`/api/v1/channels?limit=100&offset=${offset}`, key);
    all.push(...page.data);
    if (!page.hasMore) return all;
    offset += page.data.length;
  }
}

async function loadDeliveries(key: string, channelId: string): Promise<{ data: DeliveryDto[]; hasMore: boolean }> {
  return api<{ data: DeliveryDto[]; hasMore: boolean }>(
    `/api/v1/deliveries?channelId=${encodeURIComponent(channelId)}&limit=100`,
    key,
  );
}

export function ChannelStudio() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [meta, setMeta] = useState<StudioMeta>(EMPTY_META);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChannelDto | null>(null);
  const [saved, setSaved] = useState<ChannelDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryDto[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesHasMore, setDeliveriesHasMore] = useState(false);
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all');
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [view, setView] = useState<StudioView>('inbox');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('general');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('launcher');
  const [previewLocale, setPreviewLocale] = useState('en');
  const [rawSettings, setRawSettings] = useState('');
  const iframe = useRef<HTMLIFrameElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const deliveryRequest = useRef(0);

  const connect = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setNotice(null);
    try {
      const [nextChannels, nextMeta] = await Promise.all([
        loadChannels(trimmed),
        api<StudioMeta>('/api/v1/meta', trimmed),
      ]);
      sessionStorage.setItem('message-hub:studio-key', trimmed);
      setApiKey(trimmed);
      setChannels(nextChannels);
      setMeta(nextMeta);
      const first = nextChannels[0] ?? null;
      setSelectedId(first?.id ?? null);
      setDraft(first ? copyChannel(first) : null);
      setSaved(first ? copyChannel(first) : null);
      if (first) {
        setRawSettings(JSON.stringify(first.settings, null, 2));
        setPreviewLocale(first.settings.defaultLocale);
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not connect' });
      sessionStorage.removeItem('message-hub:studio-key');
      setApiKey('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem('message-hub:studio-key');
    if (stored) queueMicrotask(() => void connect(stored));
  }, [connect]);

  const sendPreview = useCallback(() => {
    if (!draft || !iframe.current?.contentWindow) return;
    iframe.current.contentWindow.postMessage(
      {
        type: 'mh:preview',
        settings: draft.settings,
        locale: previewLocale,
        screen: previewMode === 'launcher' ? 'welcome' : previewMode,
      },
      window.location.origin,
    );
  }, [draft, previewLocale, previewMode]);

  useEffect(() => {
    sendPreview();
  }, [sendPreview]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === iframe.current?.contentWindow && event.data?.type === 'mh:hello') {
        sendPreview();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendPreview]);

  const selectChannel = (channel: ChannelDto) => {
    const changedChannel = channel.id !== selectedId;
    if (changedChannel) deliveryRequest.current++;
    const next = copyChannel(channel);
    setSelectedId(channel.id);
    setDraft(next);
    setSaved(copyChannel(channel));
    setRawSettings(JSON.stringify(channel.settings, null, 2));
    setPreviewLocale(channel.settings.defaultLocale);
    if (changedChannel) {
      setDeliveries([]);
      setDeliveriesHasMore(false);
      setDeliveryError(null);
    }
    setNotice(null);
  };

  const refreshDeliveries = useCallback(
    async (quiet = false) => {
      if (!selectedId || !apiKey) return;
      const request = ++deliveryRequest.current;
      if (!quiet) setDeliveriesLoading(true);
      setDeliveryError(null);
      try {
        const result = await loadDeliveries(apiKey, selectedId);
        if (request !== deliveryRequest.current) return;
        setDeliveries(result.data);
        setDeliveriesHasMore(result.hasMore);
      } catch (error) {
        if (request !== deliveryRequest.current) return;
        setDeliveryError(error instanceof Error ? error.message : 'Could not load deliveries');
      } finally {
        if (request === deliveryRequest.current) setDeliveriesLoading(false);
      }
    },
    [apiKey, selectedId],
  );

  useEffect(() => {
    if (tab !== 'deliveries' || !selectedId) return;
    const initial = window.setTimeout(() => void refreshDeliveries(), 0);
    const timer = window.setInterval(() => void refreshDeliveries(true), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshDeliveries, selectedId, tab]);

  const refresh = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const next = await loadChannels(apiKey);
      setChannels(next);
      const current = next.find((channel) => channel.id === selectedId) ?? next[0] ?? null;
      if (current) selectChannel(current);
      else {
        setSelectedId(null);
        setDraft(null);
        setSaved(null);
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not refresh channels' });
    } finally {
      setLoading(false);
    }
  };

  const updateDraft = (change: (channel: ChannelDto) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = copyChannel(current);
      change(next);
      return next;
    });
  };

  const updateSettings = (change: (settings: ChannelSettings) => void) => {
    updateDraft((channel) => change(channel.settings));
  };

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return channels;
    return channels.filter((channel) => `${channel.name} ${channel.ref ?? ''} ${channel.id}`.toLowerCase().includes(needle));
  }, [channels, query]);

  const save = async () => {
    if (!draft || !saved) return;
    setSaving(true);
    setNotice(null);
    try {
      const settings = buildMergePatch(saved.settings, draft.settings);
      const updated = await api<ChannelDto>(`/api/v1/channels/${draft.id}`, apiKey, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name,
          ref: draft.ref || null,
          allowedOrigins: draft.allowedOrigins,
          ...(settings === undefined ? {} : { settings }),
        }),
      });
      const final =
        draft.webhookUrl === saved.webhookUrl
          ? updated
          : await api<ChannelDto>(`/api/v1/channels/${draft.id}/webhook`, apiKey, {
              method: 'PUT',
              body: JSON.stringify({ webhookUrl: draft.webhookUrl || null }),
            });
      setDraft(copyChannel(final));
      setSaved(copyChannel(final));
      setRawSettings(JSON.stringify(final.settings, null, 2));
      setChannels((items) => items.map((item) => (item.id === final.id ? final : item)));
      setNotice({ tone: 'success', text: 'Channel saved' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save channel' });
    } finally {
      setSaving(false);
    }
  };

  const createChannel = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const created = await api<ChannelDto>('/api/v1/channels', apiKey, {
        method: 'POST',
        body: JSON.stringify({ name: 'Untitled channel' }),
      });
      setChannels((items) => [created, ...items]);
      selectChannel(created);
      setView('channels');
      setTab('general');
      setNotice({ tone: 'success', text: 'Channel created' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not create channel' });
    } finally {
      setLoading(false);
    }
  };

  const deleteSelectedChannel = async () => {
    if (!draft || deleting) return;
    const unsavedWarning = dirty ? '\n\nUnsaved changes will also be discarded.' : '';
    const confirmed = window.confirm(
      `Delete "${draft.name}"?\n\nThis permanently deletes the channel and all of its visitors, messages, deliveries and files.${unsavedWarning}`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setNotice(null);
    try {
      await api<void>(`/api/v1/channels/${draft.id}`, apiKey, { method: 'DELETE' });
      const deletedIndex = channels.findIndex((channel) => channel.id === draft.id);
      const remaining = channels.filter((channel) => channel.id !== draft.id);
      const next = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)] ?? null;
      setChannels(remaining);
      if (next) {
        selectChannel(next);
      } else {
        setSelectedId(null);
        setDraft(null);
        setSaved(null);
        setRawSettings('');
      }
      setNotice({ tone: 'success', text: `Channel "${draft.name}" deleted` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not delete channel' });
    } finally {
      setDeleting(false);
    }
  };

  const logout = () => {
    deliveryRequest.current++;
    sessionStorage.removeItem('message-hub:studio-key');
    setApiKey('');
    setChannels([]);
    setDraft(null);
    setSaved(null);
    setDeliveries([]);
    setNotice(null);
  };

  if (!apiKey) {
    return (
      <main className="studio-login">
        <section className="studio-login-panel">
          <Image className="studio-brand-mark" src="/message-hub-mark.svg" alt="" width={76} height={49} priority />
          <p className="studio-kicker">Message Hub</p>
          <h1>Message Hub Studio</h1>
          <p className="studio-login-copy">Manage customer conversations, customize channels and inspect delivery health.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect(keyInput.current?.value ?? '');
            }}
          >
            <Field label="API key">
              <div className="studio-input-action">
                <input
                  ref={keyInput}
                  autoFocus
                  autoComplete="new-password"
                  name="message-hub-api-key"
                  spellCheck={false}
                  type={showKey ? 'text' : 'password'}
                  placeholder="Enter a management API key"
                />
                <IconButton label={showKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowKey((value) => !value)}>
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </div>
            </Field>
            {notice && <Notice notice={notice} />}
            <button className="studio-primary studio-login-button" type="submit" disabled={loading}>
              {loading ? <RefreshCw className="studio-spin" size={17} /> : <ArrowUpRight size={17} />}
              {loading ? 'Connecting' : 'Open studio'}
            </button>
          </form>
          <p className="studio-security-note">The key is kept only in this browser tab.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`studio-shell${view === 'inbox' ? ' studio-shell-inbox' : ''}`}>
      <aside className="studio-sidebar">
        <div className="studio-sidebar-head">
          <div>
            <p className="studio-kicker">Message Hub</p>
            <h1>Message Hub Studio</h1>
          </div>
          <div className="studio-toolbar">
            <IconButton label="Refresh channels" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={loading ? 'studio-spin' : ''} size={17} />
            </IconButton>
            <IconButton label="Forget API key" onClick={logout}>
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
        <nav className="studio-main-nav" aria-label="Studio">
          <button type="button" data-active={view === 'inbox'} onClick={() => setView('inbox')}>
            <InboxIcon size={17} />
            Inbox
          </button>
          <button type="button" data-active={view === 'channels'} onClick={() => setView('channels')}>
            <Settings2 size={17} />
            Channels
          </button>
        </nav>
        {view === 'channels' ? (
          <>
            <div className="studio-search">
              <Search size={16} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels" />
            </div>
            <button className="studio-create" type="button" onClick={() => void createChannel()}>
              <Plus size={17} />
              New channel
            </button>
            <div className="studio-channel-list">
              {filtered.map((channel) => (
                <button
                  className="studio-channel"
                  data-active={channel.id === selectedId}
                  key={channel.id}
                  type="button"
                  onClick={() => selectChannel(channel)}
                >
                  <span className="studio-channel-icon">
                    <MessageCircle size={16} />
                  </span>
                  <span>
                    <strong>{channel.name}</strong>
                    <small>{channel.ref || channel.id}</small>
                  </span>
                  <span className={channel.connectedAt ? 'studio-status live' : 'studio-status'} title={channel.connectedAt ? 'Connected' : 'Not connected'} />
                </button>
              ))}
              {!filtered.length && <p className="studio-empty-list">{channels.length ? 'No matching channels' : 'No channels yet'}</p>}
            </div>
          </>
        ) : (
          <div className="studio-inbox-sidebar-copy">
            <InboxIcon size={20} />
            <strong>All customer conversations</strong>
            <p>Open a thread to review history and reply as the current support agent.</p>
          </div>
        )}
        <div className="studio-version">Hub {meta.version || 'unknown'} / API {meta.apiVersion}</div>
      </aside>

      {view === 'inbox' ? (
        <Inbox apiKey={apiKey} channels={channels} />
      ) : draft ? (
        <>
          <section className="studio-editor">
            <header className="studio-editor-head">
              <div className="studio-title-block">
                <p>{draft.ref || 'No external reference'}</p>
                <h2>{draft.name}</h2>
              </div>
              <div className="studio-save-area">
                {dirty && <span className="studio-unsaved">Unsaved changes</span>}
                <IconButton label="Delete channel" tone="danger" onClick={() => void deleteSelectedChannel()} disabled={saving || deleting}>
                  {deleting ? <RefreshCw className="studio-spin" size={17} /> : <Trash2 size={17} />}
                </IconButton>
                <button className="studio-primary" type="button" onClick={() => void save()} disabled={!dirty || saving || deleting}>
                  {saving ? <RefreshCw className="studio-spin" size={17} /> : <Save size={17} />}
                  {saving ? 'Saving' : 'Save'}
                </button>
              </div>
            </header>
            {notice && (
              <div className="studio-notice-wrap">
                <Notice notice={notice} />
              </div>
            )}
            <nav className="studio-tabs" aria-label="Channel settings">
              {TABS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-active={tab === item.id}
                    onClick={() => {
                      if (item.id === 'debug' && draft) setRawSettings(JSON.stringify(draft.settings, null, 2));
                      setTab(item.id);
                    }}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="studio-form">
              {tab === 'general' && <GeneralTab draft={draft} update={updateDraft} />}
              {tab === 'appearance' && <AppearanceTab settings={draft.settings} update={updateSettings} />}
              {tab === 'content' && (
                <ContentTab
                  settings={draft.settings}
                  meta={meta}
                  locale={previewLocale}
                  setLocale={setPreviewLocale}
                  update={updateSettings}
                />
              )}
              {tab === 'behavior' && (
                <BehaviorTab
                  settings={draft.settings}
                  meta={meta}
                  locale={previewLocale}
                  setLocale={setPreviewLocale}
                  update={updateSettings}
                />
              )}
              {tab === 'deliveries' && (
                <DeliveriesTab
                  deliveries={deliveries}
                  filter={deliveryFilter}
                  setFilter={setDeliveryFilter}
                  loading={deliveriesLoading}
                  hasMore={deliveriesHasMore}
                  error={deliveryError}
                  retryingId={retryingDeliveryId}
                  refresh={() => void refreshDeliveries()}
                  retry={async (delivery) => {
                    setRetryingDeliveryId(delivery.id);
                    setDeliveryError(null);
                    try {
                      const updated = await api<DeliveryDto>(`/api/v1/deliveries/${delivery.id}/retry`, apiKey, {
                        method: 'POST',
                      });
                      setDeliveries((items) => items.map((item) => (item.id === updated.id ? updated : item)));
                    } catch (error) {
                      setDeliveryError(error instanceof Error ? error.message : 'Could not retry delivery');
                    } finally {
                      setRetryingDeliveryId(null);
                    }
                  }}
                />
              )}
              {tab === 'debug' && (
                <DebugTab
                  channel={draft}
                  raw={rawSettings}
                  setRaw={setRawSettings}
                  applyRaw={() => {
                    try {
                      const parsed = JSON.parse(rawSettings) as ChannelSettings;
                      updateDraft((channel) => {
                        channel.settings = parsed;
                      });
                      setNotice({ tone: 'success', text: 'JSON applied to preview. Save to persist it.' });
                    } catch {
                      setNotice({ tone: 'error', text: 'Settings JSON is invalid' });
                    }
                  }}
                />
              )}
            </div>
          </section>

          <aside className="studio-preview-panel">
            <div className="studio-preview-head">
              <div>
                <p className="studio-kicker">Live preview</p>
                <strong>{previewMode[0].toUpperCase() + previewMode.slice(1)}</strong>
              </div>
              <a href={`/w/${draft.id}`} target="_blank" rel="noreferrer" title="Open live widget">
                <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="studio-segmented">
              {(['launcher', 'welcome', 'prechat', 'chat'] as const).map((mode) => (
                <button key={mode} type="button" data-active={previewMode === mode} onClick={() => setPreviewMode(mode)}>
                  {mode}
                </button>
              ))}
            </div>
            <div className="studio-preview-stage" data-mode={previewMode}>
              {previewMode === 'launcher' ? (
                <LauncherPreview settings={draft.settings} locale={previewLocale} />
              ) : (
                <iframe
                  ref={iframe}
                  title="Widget preview"
                  src={`/w/${draft.id}?preview=1`}
                  onLoad={sendPreview}
                  style={{
                    width: `${Math.min(draft.settings.window.width, 440)}px`,
                    height: `${Math.min(draft.settings.window.height, 720)}px`,
                  }}
                />
              )}
            </div>
            <p className="studio-preview-note">Preview mode does not create visitors or send messages.</p>
          </aside>
        </>
      ) : (
        <section className="studio-no-selection">
          <MessageCircle size={28} />
          <h2>Create your first channel</h2>
          <p>The studio will show its configuration and widget preview here.</p>
          {notice && <Notice notice={notice} />}
          <button className="studio-primary" type="button" onClick={() => void createChannel()}>
            <Plus size={17} />
            New channel
          </button>
        </section>
      )}
    </main>
  );
}

function LauncherPreview({ settings, locale }: { settings: ChannelSettings; locale: string }) {
  const preview = completeSettings(settings);
  const launcherColor = preview.launcher.color ?? preview.theme.color;
  const launcherSize = LAUNCHER_SIZE_STYLES[preview.launcher.size];
  const label = localize(preview.launcher.label, locale, preview.defaultLocale);
  const side = preview.launcher.position;
  const iconUrl = preview.launcher.icon ?? null;
  const position: CSSProperties = {
    bottom: `min(${preview.launcher.offset.y}px, calc(100% - ${launcherSize.diameter + 12}px))`,
    [side]: `min(${preview.launcher.offset.x}px, calc(100% - ${launcherSize.diameter + 12}px))`,
  };

  return (
    <div className="studio-launcher-preview">
      <div className="studio-launcher-page">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {preview.launcher.hidden ? (
        <div className="studio-launcher-hidden">
          <EyeOff size={18} />
          <span>Default launcher hidden</span>
        </div>
      ) : (
        <button
          className="studio-launcher-button"
          type="button"
          tabIndex={-1}
          aria-label="Launcher preview"
          style={{
            ...position,
            color: readableOn(launcherColor),
            background: launcherColor,
            fontFamily: preview.theme.fontFamily,
            width: label ? 'auto' : launcherSize.diameter,
            height: launcherSize.diameter,
            minWidth: launcherSize.diameter,
            borderRadius: launcherSize.diameter / 2,
            fontSize: launcherSize.font,
            padding: label ? `0 ${launcherSize.paddingEnd}px 0 ${launcherSize.paddingStart}px` : 0,
          }}
        >
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview of an operator-provided launcher asset
            <img src={iconUrl} alt="" referrerPolicy="no-referrer" style={{ width: launcherSize.image, height: launcherSize.image }} />
          ) : (
            <MessageCircle size={launcherSize.icon} />
          )}
          {label && <span>{label}</span>}
        </button>
      )}
    </div>
  );
}

function DeliveriesTab({
  deliveries,
  filter,
  setFilter,
  loading,
  hasMore,
  error,
  retryingId,
  refresh,
  retry,
}: {
  deliveries: DeliveryDto[];
  filter: DeliveryFilter;
  setFilter: (filter: DeliveryFilter) => void;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  retryingId: number | null;
  refresh: () => void;
  retry: (delivery: DeliveryDto) => Promise<void>;
}) {
  const filtered = filter === 'all' ? deliveries : deliveries.filter((delivery) => delivery.status === filter);
  const counts = deliveries.reduce(
    (result, delivery) => {
      result[delivery.status]++;
      return result;
    },
    { pending: 0, delivered: 0, failed: 0 },
  );

  return (
    <div className="studio-sections studio-deliveries">
      <section className="studio-delivery-toolbar">
        <div>
          <h3>Webhook delivery queue</h3>
          <p>Latest delivery attempts for this channel. This view refreshes every 5 seconds.</p>
        </div>
        <IconButton label="Refresh deliveries" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'studio-spin' : ''} size={17} />
        </IconButton>
      </section>

      <div className="studio-delivery-filters" role="group" aria-label="Filter deliveries">
        {([
          ['all', `All ${deliveries.length}`],
          ['pending', `Pending ${counts.pending}`],
          ['failed', `Failed ${counts.failed}`],
          ['delivered', `Delivered ${counts.delivered}`],
        ] as Array<[DeliveryFilter, string]>).map(([value, label]) => (
          <button key={value} type="button" data-active={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {error && <Notice notice={{ tone: 'error', text: error }} />}
      {hasMore && <p className="studio-delivery-limit">Showing the latest 100 deliveries.</p>}

      <div className="studio-delivery-list">
        {filtered.map((delivery) => (
          <article className="studio-delivery" data-status={delivery.status} key={delivery.id}>
            <div className="studio-delivery-main">
              <span className="studio-delivery-state" aria-hidden="true">
                {delivery.status === 'delivered' ? <Check size={16} /> : delivery.status === 'failed' ? <CircleAlert size={16} /> : <Clock3 size={16} />}
              </span>
              <div>
                <div className="studio-delivery-title">
                  <strong>{delivery.event}</strong>
                  <span>#{delivery.id}</span>
                  <span className="studio-delivery-status">{delivery.status}</span>
                </div>
                <dl className="studio-delivery-meta">
                  <div>
                    <dt>Created</dt>
                    <dd>{new Date(delivery.createdAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{delivery.attempts}</dd>
                  </div>
                  <div>
                    <dt>HTTP</dt>
                    <dd>{delivery.lastStatus ?? 'No response'}</dd>
                  </div>
                  <div>
                    <dt>{delivery.status === 'delivered' ? 'Delivered' : delivery.status === 'pending' ? 'Next attempt' : 'Queue'}</dt>
                    <dd>
                      {delivery.status === 'delivered' && delivery.deliveredAt
                        ? new Date(delivery.deliveredAt).toLocaleString()
                        : delivery.status === 'pending'
                          ? new Date(delivery.nextAttemptAt).toLocaleString()
                          : 'Manual retry required'}
                    </dd>
                  </div>
                </dl>
                {delivery.lastError && <p className="studio-delivery-error">{delivery.lastError}</p>}
              </div>
            </div>
            {delivery.status !== 'delivered' && (
              <button
                className="studio-secondary studio-delivery-retry"
                type="button"
                disabled={retryingId !== null}
                onClick={() => void retry(delivery)}
              >
                <RotateCcw className={retryingId === delivery.id ? 'studio-spin' : ''} size={15} />
                {retryingId === delivery.id ? 'Retrying' : 'Retry now'}
              </button>
            )}
          </article>
        ))}
        {!loading && !filtered.length && (
          <div className="studio-delivery-empty">
            <Webhook size={22} />
            <strong>{deliveries.length ? 'No deliveries match this filter' : 'No webhook deliveries yet'}</strong>
            <p>Deliveries appear after the channel produces an event and has a webhook URL configured.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function GeneralTab({ draft, update }: { draft: ChannelDto; update: (change: (channel: ChannelDto) => void) => void }) {
  return (
    <div className="studio-sections">
      <Section title="Identity" description="Internal channel details used by your main application.">
        <div className="studio-grid two">
          <Field label="Name">
            <input value={draft.name} onChange={(event) => update((channel) => (channel.name = event.target.value))} />
          </Field>
          <Field label="Reference" hint="Optional workspace or tenant ID">
            <input value={draft.ref ?? ''} onChange={(event) => update((channel) => (channel.ref = event.target.value || null))} />
          </Field>
        </div>
      </Section>
      <Section title="Webhook" description="Events are delivered to this URL using the channel secret.">
        <Field label="Webhook URL">
          <div className="studio-input-icon">
            <Webhook size={16} />
            <input
              type="url"
              placeholder="https://example.com/webhooks/message-hub"
              value={draft.webhookUrl ?? ''}
              onChange={(event) => update((channel) => (channel.webhookUrl = event.target.value || null))}
            />
          </div>
        </Field>
      </Section>
      <Section title="Allowed origins" description="One origin per line. Leave empty to allow the widget on any website.">
        <Field label="Origins" hint="Supports https://*.example.com">
          <textarea
            rows={5}
            placeholder={'https://example.com\nhttps://*.example.com'}
            value={draft.allowedOrigins.join('\n')}
            onChange={(event) => update((channel) => (channel.allowedOrigins = parseOrigins(event.target.value)))}
          />
        </Field>
      </Section>
      <Section title="Embed" description="Use this script URL on the website that should show the widget.">
        <CopyValue value={`${typeof window === 'undefined' ? '' : window.location.origin}${draft.embedPath}`} />
      </Section>
      <Section title="Runtime API" description="Control the embedded widget from the host website through window.MessageHub.">
        <RuntimeApiReference />
      </Section>
    </div>
  );
}

function RuntimeApiReference() {
  return (
    <div className="studio-runtime-api">
      <p className="studio-runtime-note">
        Launcher overrides apply immediately for the current page. Calling <code>init()</code> again resets them to the saved channel settings.
      </p>
      <dl>
        <div>
          <dt><code>setLauncherPosition({'{ position?, x?, y? }'})</code></dt>
          <dd>Move the launcher and desktop chat window. Position is left or right; x and y are integer pixel offsets from 0 to 400.</dd>
        </div>
        <div>
          <dt><code>setLauncherVisible(visible)</code></dt>
          <dd>Show or hide the launcher button. Hiding it does not close an open chat window.</dd>
        </div>
        <div>
          <dt><code>setLauncherZIndex(zIndex)</code></dt>
          <dd>Set the launcher stacking level to an integer from 0 to 2147483647. The chat window is placed one level above it.</dd>
        </div>
        <div>
          <dt><code>open() · close() · toggle()</code></dt>
          <dd>Open, close or toggle the chat window.</dd>
        </div>
        <div>
          <dt><code>setLocale(code | null)</code></dt>
          <dd>Switch to an enabled locale, or pass null to resume automatic locale detection.</dd>
        </div>
        <div>
          <dt><code>identify(profile)</code></dt>
          <dd>Merge visitor profile fields such as name, email or customerId into the current session.</dd>
        </div>
        <div>
          <dt><code>on(event, handler) · off(event, handler)</code></dt>
          <dd>Subscribe to ready, open, close, message or unread events. on() returns an unsubscribe function.</dd>
        </div>
        <div>
          <dt><code>init(options?) · destroy()</code></dt>
          <dd>Create or remove the widget. init supports locale, identify and open options.</dd>
        </div>
      </dl>
      <div className="studio-runtime-example">
        <strong>Responsive launcher example</strong>
        <pre><code>{`const syncLauncher = () => {
  const mobile = matchMedia('(max-width: 768px)').matches;
  MessageHub.setLauncherPosition({
    position: 'right',
    x: 16,
    y: mobile ? 88 : 20,
  });
};

syncLauncher();
addEventListener('resize', syncLauncher);
MessageHub.setLauncherZIndex(1000);
MessageHub.setLauncherVisible(true);`}</code></pre>
      </div>
    </div>
  );
}

function AppearanceTab({ settings, update }: SettingsTabProps) {
  return (
    <div className="studio-sections">
      <Section title="Brand" description="Core colors, surfaces and identity shown inside the chat window.">
        <div className="studio-grid two">
          <Field label="Brand color">
            <div className="studio-color-input">
              <input
                type="color"
                value={settings.theme.color}
                onChange={(event) => update((next) => (next.theme.color = event.target.value))}
              />
              <input value={settings.theme.color} onChange={(event) => update((next) => (next.theme.color = event.target.value))} />
            </div>
          </Field>
          <Field label="Color scheme">
            <Select
              value={settings.theme.colorScheme}
              onChange={(value) => update((next) => (next.theme.colorScheme = value as ChannelSettings['theme']['colorScheme']))}
              options={[
                ['auto', 'System'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
          </Field>
          <Field label="Corner radius">
            <Select
              value={settings.theme.radius}
              onChange={(value) => update((next) => (next.theme.radius = value as ChannelSettings['theme']['radius']))}
              options={[
                ['none', 'Square'],
                ['sm', 'Small'],
                ['md', 'Medium'],
                ['lg', 'Large'],
              ]}
            />
          </Field>
          <Field label="Font family" hint="Must already be available on the visitor device">
            <input
              placeholder="Inter, Arial, sans-serif"
              value={settings.theme.fontFamily ?? ''}
              onChange={(event) => update((next) => (next.theme.fontFamily = event.target.value || undefined))}
            />
          </Field>
        </div>
        <Field label="Logo URL">
          <input
            type="url"
            placeholder="https://example.com/logo.png"
            value={settings.theme.logo ?? ''}
            onChange={(event) => update((next) => (next.theme.logo = event.target.value || undefined))}
          />
        </Field>
      </Section>
      <Section title="Window size" description="Desktop widget dimensions. The widget remains responsive on small screens.">
        <div className="studio-grid two">
          <NumberField label="Width" min={280} max={800} value={settings.window.width} onChange={(value) => update((next) => (next.window.width = value))} suffix="px" />
          <NumberField label="Height" min={360} max={1000} value={settings.window.height} onChange={(value) => update((next) => (next.window.height = value))} suffix="px" />
        </div>
      </Section>
    </div>
  );
}

function ContentTab({
  settings,
  meta,
  locale,
  setLocale,
  update,
}: SettingsTabProps & { meta: StudioMeta; locale: string; setLocale: (locale: string) => void }) {
  const setText = (field: keyof ChannelSettings['content'], value: string) => {
    update((next) => {
      const current = next.content[field];
      if (field === 'starters' || field === 'overrides') return;
      const localized = { ...((current as LocalizedText | undefined) ?? {}) };
      if (value) localized[locale] = value;
      else delete localized[locale];
      (next.content[field] as LocalizedText | undefined) = Object.keys(localized).length ? localized : undefined;
    });
  };

  const contentValue = (field: 'brandName' | 'welcomeTitle' | 'welcomeSubtitle' | 'greeting') => settings.content[field]?.[locale] ?? '';
  const starterText = (settings.content.starters ?? []).map((item) => item[locale] ?? '').join('\n');
  const overrides = settings.content.overrides?.[locale] ?? {};

  return (
    <div className="studio-sections">
      <LocaleBar settings={settings} meta={meta} locale={locale} setLocale={setLocale} update={update} />
      <Section title="Welcome content" description="Channel-specific copy for the selected preview language.">
        <div className="studio-grid two">
          <Field label="Brand name">
            <input value={contentValue('brandName')} onChange={(event) => setText('brandName', event.target.value)} />
          </Field>
          <Field label="Welcome title">
            <input value={contentValue('welcomeTitle')} onChange={(event) => setText('welcomeTitle', event.target.value)} />
          </Field>
        </div>
        <Field label="Welcome subtitle">
          <textarea rows={3} value={contentValue('welcomeSubtitle')} onChange={(event) => setText('welcomeSubtitle', event.target.value)} />
        </Field>
        <Field label="First chat message">
          <textarea rows={3} value={contentValue('greeting')} onChange={(event) => setText('greeting', event.target.value)} />
        </Field>
        <Field label="Quick questions" hint="One question per line, up to 6">
          <textarea
            rows={5}
            value={starterText}
            onChange={(event) => {
              const lines = event.target.value.split(/\r?\n/).slice(0, 6);
              update((next) => {
                const current = next.content.starters ?? [];
                next.content.starters = lines.map((line, index) => {
                  const item = { ...(current[index] ?? {}) };
                  if (line) item[locale] = line;
                  else delete item[locale];
                  return item;
                });
              });
            }}
          />
        </Field>
      </Section>
      <Section title="Interface wording" description="Override built-in widget text for this language. Empty values use the catalog default.">
        <div className="studio-copy-list">
          {Object.entries(meta.messages[locale] ?? meta.messages.en ?? {}).map(([key, fallback]) => (
            <Field key={key} label={key} hint={fallback}>
              <input
                value={overrides[key] ?? ''}
                placeholder={fallback}
                onChange={(event) =>
                  update((next) => {
                    const all = { ...(next.content.overrides ?? {}) };
                    const current = { ...(all[locale] ?? {}) };
                    if (event.target.value) current[key] = event.target.value;
                    else delete current[key];
                    if (Object.keys(current).length) all[locale] = current;
                    else delete all[locale];
                    next.content.overrides = Object.keys(all).length ? all : undefined;
                  })
                }
              />
            </Field>
          ))}
        </div>
      </Section>
    </div>
  );
}

function BehaviorTab({
  settings,
  meta,
  locale,
  setLocale,
  update,
}: SettingsTabProps & { meta: StudioMeta; locale: string; setLocale: (locale: string) => void }) {
  const previewSettings = completeSettings(settings);
  const launcherColor = previewSettings.launcher.color ?? previewSettings.theme.color;

  return (
    <div className="studio-sections">
      <LocaleBar settings={settings} meta={meta} locale={locale} setLocale={setLocale} update={update} />
      <Section title="Launcher" description="Position and behavior of the button injected into the host website.">
        <div className="studio-grid two">
          <Field label="Position">
            <Select
              value={settings.launcher.position}
              onChange={(value) => update((next) => (next.launcher.position = value as 'left' | 'right'))}
              options={[
                ['left', 'Left'],
                ['right', 'Right'],
              ]}
            />
          </Field>
          <Field label="Size">
            <Select
              value={settings.launcher.size}
              onChange={(value) => update((next) => (next.launcher.size = value as ChannelSettings['launcher']['size']))}
              options={[
                ['small', 'Small'],
                ['medium', 'Medium'],
                ['large', 'Large'],
                ['xlarge', 'Extra large'],
              ]}
            />
          </Field>
          <Field label="Launcher color" hint="Leave empty to use the brand color">
            <div className="studio-color-input">
              <input
                type="color"
                value={launcherColor}
                onChange={(event) => update((next) => (next.launcher.color = event.target.value))}
              />
              <input
                placeholder={settings.theme.color}
                value={settings.launcher.color ?? ''}
                onChange={(event) => update((next) => (next.launcher.color = event.target.value || undefined))}
              />
            </div>
          </Field>
          <Field label="Label">
            <input
              value={settings.launcher.label?.[locale] ?? ''}
              onChange={(event) =>
                update((next) => {
                  const label = { ...(next.launcher.label ?? {}) };
                  if (event.target.value) label[locale] = event.target.value;
                  else delete label[locale];
                  next.launcher.label = Object.keys(label).length ? label : undefined;
                })
              }
            />
          </Field>
          <NumberField label="Horizontal offset" min={0} max={400} value={settings.launcher.offset.x} onChange={(value) => update((next) => (next.launcher.offset.x = value))} suffix="px" />
          <NumberField label="Bottom offset" min={0} max={400} value={settings.launcher.offset.y} onChange={(value) => update((next) => (next.launcher.offset.y = value))} suffix="px" />
          <NumberField label="Z-index" min={0} max={2147483647} value={settings.launcher.zIndex} onChange={(value) => update((next) => (next.launcher.zIndex = value))} />
          <Toggle label="Hide default launcher" checked={settings.launcher.hidden} onChange={(value) => update((next) => (next.launcher.hidden = value))} />
        </div>
        <Field label="Custom icon URL">
          <input
            type="url"
            value={settings.launcher.icon ?? ''}
            onChange={(event) => update((next) => (next.launcher.icon = event.target.value || undefined))}
          />
        </Field>
      </Section>
      <Section title="Pre-chat form" description="Collect visitor profile fields before a conversation starts.">
        <Field label="Mode">
          <Select
            value={settings.preChat.mode}
            onChange={(value) => update((next) => (next.preChat.mode = value as ChannelSettings['preChat']['mode']))}
            options={[
              ['off', 'Off'],
              ['optional', 'Optional'],
              ['required', 'Required'],
            ]}
          />
        </Field>
        <div className="studio-field-list">
          {settings.preChat.fields.map((field, index) => (
            <div className="studio-repeat-row" key={`${field.key}-${index}`}>
              <div className="studio-repeat-head">
                <strong>Field {index + 1}</strong>
                <IconButton
                  label={`Remove ${field.key}`}
                  tone="danger"
                  onClick={() => update((next) => next.preChat.fields.splice(index, 1))}
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
              <div className="studio-grid two">
                <Field label="Key">
                  <input value={field.key} onChange={(event) => update((next) => (next.preChat.fields[index].key = event.target.value))} />
                </Field>
                <Field label="Type">
                  <Select
                    value={field.type}
                    onChange={(value) => update((next) => (next.preChat.fields[index].type = value as typeof field.type))}
                    options={['text', 'number', 'name', 'phone', 'email'].map((value) => [value, value] as [string, string])}
                  />
                </Field>
                <Field label={`Label (${locale})`}>
                  <input
                    value={field.label?.[locale] ?? ''}
                    onChange={(event) =>
                      update((next) => {
                        const label = { ...(next.preChat.fields[index].label ?? {}) };
                        if (event.target.value) label[locale] = event.target.value;
                        else delete label[locale];
                        next.preChat.fields[index].label = Object.keys(label).length ? label : undefined;
                      })
                    }
                  />
                </Field>
                <Field label={`Placeholder (${locale})`}>
                  <input
                    value={field.placeholder?.[locale] ?? ''}
                    onChange={(event) =>
                      update((next) => {
                        const placeholder = { ...(next.preChat.fields[index].placeholder ?? {}) };
                        if (event.target.value) placeholder[locale] = event.target.value;
                        else delete placeholder[locale];
                        next.preChat.fields[index].placeholder = Object.keys(placeholder).length ? placeholder : undefined;
                      })
                    }
                  />
                </Field>
              </div>
              <Toggle
                label="Required field"
                checked={field.required ?? false}
                onChange={(value) => update((next) => (next.preChat.fields[index].required = value || undefined))}
              />
            </div>
          ))}
        </div>
        <button
          className="studio-secondary"
          type="button"
          disabled={settings.preChat.fields.length >= 10}
          onClick={() =>
            update((next) =>
              next.preChat.fields.push({
                key: `field_${next.preChat.fields.length + 1}`,
                type: 'text',
              }),
            )
          }
        >
          <Plus size={16} />
          Add field
        </button>
      </Section>
      <Section title="Features" description="Capabilities available to visitors in this channel.">
        <div className="studio-toggle-stack">
          <Toggle label="File attachments" checked={settings.features.attachments} onChange={(value) => update((next) => (next.features.attachments = value))} />
          <Toggle label="Notification sound" checked={settings.features.sound} onChange={(value) => update((next) => (next.features.sound = value))} />
        </div>
      </Section>
    </div>
  );
}

function DebugTab({
  channel,
  raw,
  setRaw,
  applyRaw,
}: {
  channel: ChannelDto;
  raw: string;
  setRaw: (value: string) => void;
  applyRaw: () => void;
}) {
  return (
    <div className="studio-sections">
      <Section title="Runtime details" description="Identifiers and timestamps returned by the management API.">
        <dl className="studio-details">
          <Detail label="Channel ID" value={channel.id} copy />
          <Detail label="Embed path" value={channel.embedPath} copy />
          <Detail label="Webhook secret" value={channel.webhookSecret} copy secret />
          <Detail label="Connected" value={channel.connectedAt ? new Date(channel.connectedAt).toLocaleString() : 'Not connected'} />
          <Detail label="Created" value={new Date(channel.createdAt).toLocaleString()} />
          <Detail label="Updated" value={new Date(channel.updatedAt).toLocaleString()} />
        </dl>
      </Section>
      <Section title="Raw settings JSON" description="Apply JSON to the live preview, then use Save to validate and persist it.">
        <textarea className="studio-code" rows={24} spellCheck={false} value={raw} onChange={(event) => setRaw(event.target.value)} />
        <button className="studio-secondary" type="button" onClick={applyRaw}>
          <Code2 size={16} />
          Apply JSON
        </button>
      </Section>
    </div>
  );
}

interface SettingsTabProps {
  settings: ChannelSettings;
  update: (change: (settings: ChannelSettings) => void) => void;
}

function LocaleBar({
  settings,
  meta,
  locale,
  setLocale,
  update,
}: SettingsTabProps & { meta: StudioMeta; locale: string; setLocale: (locale: string) => void }) {
  return (
    <Section title="Languages" description="Enable widget languages and select which one you are editing.">
      <div className="studio-locale-list">
        {meta.locales.map((item) => {
          const enabled = settings.locales.includes(item.code);
          return (
            <label key={item.code} data-active={locale === item.code}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) =>
                  update((next) => {
                    if (event.target.checked) next.locales = [...next.locales, item.code];
                    else if (next.locales.length > 1) next.locales = next.locales.filter((code) => code !== item.code);
                    if (!next.locales.includes(next.defaultLocale)) next.defaultLocale = next.locales[0];
                  })
                }
              />
              <button type="button" onClick={() => enabled && setLocale(item.code)} disabled={!enabled}>
                {item.name}
              </button>
            </label>
          );
        })}
      </div>
      <div className="studio-grid two">
        <Field label="Editing language">
          <Select
            value={settings.locales.includes(locale) ? locale : settings.defaultLocale}
            onChange={setLocale}
            options={meta.locales.filter((item) => settings.locales.includes(item.code)).map((item) => [item.code, item.name])}
          />
        </Field>
        <Field label="Default language">
          <Select
            value={settings.defaultLocale}
            onChange={(value) => update((next) => (next.defaultLocale = value))}
            options={meta.locales.filter((item) => settings.locales.includes(item.code)).map((item) => [item.code, item.name])}
          />
        </Field>
      </div>
    </Section>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="studio-section">
      <div className="studio-section-title">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="studio-section-body">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="studio-field">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="studio-number">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </Field>
  );
}

function Select({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <span className="studio-select">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} />
    </span>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="studio-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true">
        <i />
      </span>
      <strong>{label}</strong>
    </label>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <button className="studio-icon-button" data-tone={tone} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      {children}
    </button>
  );
}

function Notice({ notice }: { notice: Exclude<Notice, null> }) {
  return (
    <div className="studio-notice" data-tone={notice.tone}>
      {notice.tone === 'success' ? <Check size={16} /> : <CircleAlert size={16} />}
      <span>{notice.text}</span>
    </div>
  );
}

function CopyValue({ value, secret = false }: { value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="studio-copy-value">
      <code>{secret ? `${value.slice(0, 8)}${'*'.repeat(18)}` : value}</code>
      <IconButton
        label="Copy value"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={16} /> : <Clipboard size={16} />}
      </IconButton>
    </div>
  );
}

function Detail({ label, value, copy, secret }: { label: string; value: string; copy?: boolean; secret?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{copy ? <CopyValue value={value} secret={secret} /> : value}</dd>
    </div>
  );
}
