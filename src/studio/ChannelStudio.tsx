'use client';

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Code2,
  Eye,
  EyeOff,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Type,
  Webhook,
} from 'lucide-react';
import Image from 'next/image';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelSettings, LocalizedText } from '@/settings/schema';
import { buildMergePatch, copyChannel, formatApiError, parseOrigins, type ApiErrorBody, type ChannelDto, type StudioMeta } from './types';

type Tab = 'general' | 'appearance' | 'content' | 'behavior' | 'debug';
type PreviewScreen = 'welcome' | 'prechat' | 'chat';
type Notice = { tone: 'success' | 'error'; text: string } | null;

const EMPTY_META: StudioMeta = { version: '', apiVersion: 'v1', locales: [], messages: {} };
const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'Channel', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: SlidersHorizontal },
  { id: 'content', label: 'Content', icon: Type },
  { id: 'behavior', label: 'Behavior', icon: MessageCircle },
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
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('general');
  const [previewScreen, setPreviewScreen] = useState<PreviewScreen>('welcome');
  const [previewLocale, setPreviewLocale] = useState('en');
  const [rawSettings, setRawSettings] = useState('');
  const iframe = useRef<HTMLIFrameElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);

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
      { type: 'mh:preview', settings: draft.settings, locale: previewLocale, screen: previewScreen },
      window.location.origin,
    );
  }, [draft, previewLocale, previewScreen]);

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
    const next = copyChannel(channel);
    setSelectedId(channel.id);
    setDraft(next);
    setSaved(copyChannel(channel));
    setRawSettings(JSON.stringify(channel.settings, null, 2));
    setPreviewLocale(channel.settings.defaultLocale);
    setNotice(null);
  };

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
      setTab('general');
      setNotice({ tone: 'success', text: 'Channel created' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not create channel' });
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem('message-hub:studio-key');
    setApiKey('');
    setChannels([]);
    setDraft(null);
    setSaved(null);
    setNotice(null);
  };

  if (!apiKey) {
    return (
      <main className="studio-login">
        <section className="studio-login-panel">
          <Image className="studio-brand-mark" src="/message-hub-mark.svg" alt="" width={76} height={49} priority />
          <p className="studio-kicker">Message Hub</p>
          <h1>Message Hub Studio</h1>
          <p className="studio-login-copy">Inspect, customize and debug every channel owned by an API key.</p>
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
    <main className="studio-shell">
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
        <div className="studio-version">Hub {meta.version || 'unknown'} / API {meta.apiVersion}</div>
      </aside>

      {draft ? (
        <>
          <section className="studio-editor">
            <header className="studio-editor-head">
              <div className="studio-title-block">
                <p>{draft.ref || 'No external reference'}</p>
                <h2>{draft.name}</h2>
              </div>
              <div className="studio-save-area">
                {dirty && <span className="studio-unsaved">Unsaved changes</span>}
                <button className="studio-primary" type="button" onClick={() => void save()} disabled={!dirty || saving}>
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
                <strong>{previewScreen[0].toUpperCase() + previewScreen.slice(1)}</strong>
              </div>
              <a href={`/w/${draft.id}`} target="_blank" rel="noreferrer" title="Open live widget">
                <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="studio-segmented">
              {(['welcome', 'prechat', 'chat'] as const).map((screen) => (
                <button key={screen} type="button" data-active={previewScreen === screen} onClick={() => setPreviewScreen(screen)}>
                  {screen}
                </button>
              ))}
            </div>
            <div className="studio-preview-stage">
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
            </div>
            <p className="studio-preview-note">Preview mode does not create visitors or send messages.</p>
          </aside>
        </>
      ) : (
        <section className="studio-no-selection">
          <MessageCircle size={28} />
          <h2>Create your first channel</h2>
          <p>The studio will show its configuration and widget preview here.</p>
          <button className="studio-primary" type="button" onClick={() => void createChannel()}>
            <Plus size={17} />
            New channel
          </button>
        </section>
      )}
    </main>
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
