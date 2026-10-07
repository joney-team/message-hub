import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@/server/config';
import { getDb } from '@/server/db/client';
import { channels } from '@/server/db/schema';
import { hub, type HubEvent } from '@/server/realtime/hub';
import { LOCALES, SUPPORTED_LOCALES } from '@/i18n/catalog';
import { ALL_CATALOGS } from '@/i18n/catalog.server';
import * as channelsRoute from '@/app/api/v1/channels/route';
import * as channelRoute from '@/app/api/v1/channels/[id]/route';
import * as rotateRoute from '@/app/api/v1/channels/[id]/rotate-secret/route';
import * as channelVisitorsRoute from '@/app/api/v1/channels/[id]/visitors/route';
import * as visitorRoute from '@/app/api/v1/visitors/[id]/route';
import * as visitorMessagesRoute from '@/app/api/v1/visitors/[id]/messages/route';
import * as typingRoute from '@/app/api/v1/visitors/[id]/typing/route';
import * as metaRoute from '@/app/api/v1/meta/route';
import * as healthRoute from '@/app/api/health/route';
import { insertChannel, insertVisitor, useTestDb } from './helpers';

const KEY_A = 'a'.repeat(20);
const KEY_B = 'b'.repeat(20);

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response> | Response;

async function call(handler: unknown, key: string | null, opts: { method?: string; url?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(opts.url ?? 'http://hub.test/api', {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opts.params ?? {}) as never });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  process.env.API_KEYS = `a:${KEY_A},b:${KEY_B}`;
  resetConfigForTests();
  useTestDb();
});

describe('auth on /api/v1', () => {
  it('rejects requests without a valid key', async () => {
    expect((await call(channelsRoute.GET, null)).status).toBe(401);
    expect((await call(channelsRoute.GET, 'nope')).status).toBe(401);
    expect((await call(metaRoute.GET, null)).status).toBe(401);
  });
});

describe('channel scoping between API keys', () => {
  it('owner b cannot see or touch a channel created by a', async () => {
    const created = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: 'A channel', ref: 'ws1' } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const params = { id };

    expect((await call(channelRoute.GET, KEY_A, { params })).status).toBe(200);
    for (const [h, method, body] of [
      [channelRoute.GET, 'GET'],
      [channelRoute.PATCH, 'PATCH', { name: 'hijack' }],
      [channelRoute.DELETE, 'DELETE'],
      [rotateRoute.POST, 'POST'],
      [channelVisitorsRoute.GET, 'GET'],
    ] as const) {
      const r = await call(h, KEY_B, { method, params, body });
      expect(r.status, `${method}`).toBe(404);
      expect(r.body.error.code).toBe('CHANNEL_NOT_FOUND');
    }
    expect((await call(channelsRoute.GET, KEY_B)).body.data).toHaveLength(0);
    expect((await call(channelsRoute.GET, KEY_A)).body.data).toHaveLength(1);
    // untouched
    expect((await call(channelRoute.GET, KEY_A, { params })).body.name).toBe('A channel');
  });

  it('owner b cannot reach a visitor or messages of a', async () => {
    const ch = insertChannel('a');
    const { visitor } = insertVisitor(ch.id);
    const params = { id: visitor.id };
    for (const [h, method, body] of [
      [visitorRoute.GET, 'GET'],
      [visitorMessagesRoute.GET, 'GET'],
      [visitorMessagesRoute.POST, 'POST', { text: 'hi' }],
      [visitorMessagesRoute.DELETE, 'DELETE'],
      [typingRoute.POST, 'POST', {}],
    ] as const) {
      const r = await call(h, KEY_B, { method, params, body });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('VISITOR_NOT_FOUND');
    }
  });

  it('lists only own channels and filters by ref', async () => {
    insertChannel('a', { ref: 'ws1' });
    insertChannel('a', { ref: 'ws2' });
    insertChannel('b', { ref: 'ws1' });
    const r = await call(channelsRoute.GET, KEY_A, { url: 'http://hub.test/api/v1/channels?ref=ws1' });
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].ref).toBe('ws1');
    const paged = await call(channelsRoute.GET, KEY_A, { url: 'http://hub.test/api/v1/channels?limit=1' });
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.hasMore).toBe(true);
  });
});

describe('settings', () => {
  it('a channel with empty or missing settings still yields a complete object', async () => {
    const ch = insertChannel('a', { settings: {} });
    getDb().update(channels).set({ settings: { theme: { color: 'not-a-color' }, junk: 1 } }).run();
    const r = await call(channelRoute.GET, KEY_A, { params: { id: ch.id } });
    const s = r.body.settings;
    expect(s.theme.color).toBe('#1f2937');
    expect(s.launcher.position).toBe('right');
    expect(s.launcher.offset).toEqual({ x: 20, y: 20 });
    expect(s.window.width).toBeGreaterThan(0);
    expect(s.locales).toContain('en');
    expect(s.preChat).toEqual({ mode: 'off', fields: [] });
    expect(s.features.attachments).toBe(true);
  });

  it('create without settings stores full defaults', async () => {
    const r = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: 'x' } });
    expect(r.body.settings.theme.radius).toBe('md');
    expect(r.body.webhookSecret).toMatch(/^whsec_/);
    expect(r.body.embedPath).toBe(`/embed/${r.body.id}.js`);
    expect(r.body.settings.locales).toEqual(['en', 'vi']);
  });

  it.each(['ko', 'zh', 'ja', 'th', 'fr', 'ru'])('accepts %s in channel locales, defaults and overrides on create and PATCH', async (locale) => {
    const settings = {
      locales: ['en', locale],
      defaultLocale: locale,
      content: { overrides: { [locale]: { 'composer.send': 'Custom send' } } },
    };
    const created = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: locale, settings } });
    expect(created.status).toBe(201);
    expect(created.body.settings).toMatchObject(settings);

    const patched = await call(channelRoute.PATCH, KEY_A, {
      method: 'PATCH',
      params: { id: created.body.id },
      body: { settings: { locales: [locale], content: { overrides: { [locale]: { 'launcher.open': 'Custom open' } } } } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.settings.locales).toEqual([locale]);
    expect(patched.body.settings.defaultLocale).toBe(locale);
    expect(patched.body.settings.content.overrides[locale]).toEqual({ 'composer.send': 'Custom send', 'launcher.open': 'Custom open' });
    expect((await call(channelRoute.GET, KEY_A, { params: { id: created.body.id } })).body.settings).toEqual(patched.body.settings);
  });

  it('PATCH deep-merges, and null unsets an optional value', async () => {
    const created = await call(channelsRoute.POST, KEY_A, {
      method: 'POST',
      body: { name: 'x', settings: { theme: { color: '#112233', logo: 'https://x.test/l.png' }, launcher: { hidden: true } } },
    });
    const params = { id: created.body.id };
    const r = await call(channelRoute.PATCH, KEY_A, { method: 'PATCH', params, body: { settings: { theme: { radius: 'lg', logo: null }, content: { welcomeTitle: { en: 'Hi' } } } } });
    expect(r.status).toBe(200);
    expect(r.body.settings.theme).toMatchObject({ color: '#112233', radius: 'lg' });
    expect(r.body.settings.theme.logo).toBeUndefined();
    expect(r.body.settings.launcher.hidden).toBe(true);
    expect(r.body.settings.content.welcomeTitle).toEqual({ en: 'Hi' });
  });

  it.each([
    ['unknown override key', { content: { overrides: { en: { 'no.such.key': 'x' } } } }],
    ['unsupported override locale', { content: { overrides: { xx: { 'composer.send': 'Send' } } } }],
    ['unsupported locale', { locales: ['en', 'xx'] }],
    ['defaultLocale outside locales', { locales: ['en'], defaultLocale: 'vi' }],
    ['bad color', { theme: { color: 'red; background:url(x)' } }],
    ['javascript: logo', { theme: { logo: 'javascript:alert(1)' } }],
    ['unknown field', { customCss: 'body{}' }],
    ['duplicate pre-chat key', { preChat: { mode: 'optional', fields: [{ key: 'a', type: 'text' }, { key: 'a', type: 'email' }] } }],
  ])('rejects %s', async (_name, settings) => {
    const r = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: 'x', settings } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid override and a pre-chat form', async () => {
    const r = await call(channelsRoute.POST, KEY_A, {
      method: 'POST',
      body: { name: 'x', settings: { content: { overrides: { vi: { 'composer.send': 'Gửi ngay' } } }, preChat: { mode: 'required', fields: [{ key: 'name', type: 'name', required: true, label: { vi: 'Tên' } }] } } },
    });
    expect(r.status).toBe(201);
    expect(r.body.settings.content.overrides.vi['composer.send']).toBe('Gửi ngay');
  });

  it('normalises allowed origins and rejects paths', async () => {
    const ok = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: 'x', allowedOrigins: ['HTTPS://Example.com/', 'https://*.example.com'] } });
    expect(ok.body.allowedOrigins).toEqual(['https://example.com', 'https://*.example.com']);
    const bad = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: 'x', allowedOrigins: ['https://example.com/path'] } });
    expect(bad.status).toBe(400);
    const injection = await call(channelsRoute.POST, KEY_A, { method: 'POST', body: { name: 'x', allowedOrigins: ["https://a.com; script-src 'none'"] } });
    expect(injection.status).toBe(400);
  });
});

describe('conversation endpoints', () => {
  it('sends a reply with sender, lists it, publishes it live, and deletes the conversation', async () => {
    const ch = insertChannel('a');
    const { visitor } = insertVisitor(ch.id);
    const events: HubEvent[] = [];
    const off = hub.subscribe(visitor.id, (e) => events.push(e));
    const params = { id: visitor.id };

    const sent = await call(visitorMessagesRoute.POST, KEY_A, { method: 'POST', params, body: { text: 'Hello!', sender: { name: 'Ann', avatar: 'https://x.test/a.png' } } });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ direction: 'outbound', text: 'Hello!', sender: { name: 'Ann' } });
    expect(events).toHaveLength(1);

    const typing = await call(typingRoute.POST, KEY_A, { method: 'POST', params, body: { sender: { name: 'Ann' } } });
    expect(typing.status).toBe(200);
    expect(events[1]).toMatchObject({ type: 'typing' });
    off();

    const list = await call(visitorMessagesRoute.GET, KEY_A, { params });
    expect(list.body.data).toHaveLength(1);

    expect((await call(visitorMessagesRoute.DELETE, KEY_A, { method: 'DELETE', params })).status).toBe(204);
    expect((await call(visitorMessagesRoute.GET, KEY_A, { params })).body.data).toHaveLength(0);
  });

  it('rejects an empty reply and unknown attachments', async () => {
    const ch = insertChannel('a');
    const { visitor } = insertVisitor(ch.id);
    const params = { id: visitor.id };
    expect((await call(visitorMessagesRoute.POST, KEY_A, { method: 'POST', params, body: { text: '   ' } })).status).toBe(400);
    const r = await call(visitorMessagesRoute.POST, KEY_A, { method: 'POST', params, body: { text: 'x', attachments: [{ fileId: 'file_missing' }] } });
    expect(r.body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('paginates history by seq cursor, oldest first within a page', async () => {
    const ch = insertChannel('a');
    const { visitor } = insertVisitor(ch.id);
    const params = { id: visitor.id };
    for (let i = 1; i <= 5; i++) await call(visitorMessagesRoute.POST, KEY_A, { method: 'POST', params, body: { text: `m${i}` } });
    const page1 = await call(visitorMessagesRoute.GET, KEY_A, { params, url: 'http://x/?limit=2' });
    expect(page1.body.data.map((m: { text: string }) => m.text)).toEqual(['m4', 'm5']);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await call(visitorMessagesRoute.GET, KEY_A, { params, url: `http://x/?limit=2&before=${page1.body.data[0].seq}` });
    expect(page2.body.data.map((m: { text: string }) => m.text)).toEqual(['m2', 'm3']);
    expect((await call(visitorMessagesRoute.GET, KEY_A, { params, url: 'http://x/?limit=-1' })).status).toBe(400);
    expect((await call(visitorMessagesRoute.GET, KEY_A, { params, url: 'http://x/?limit=9999' })).status).toBe(400);
  });
});

describe('meta and health', () => {
  it('meta describes settings, locales and every catalog key', async () => {
    const r = await call(metaRoute.GET, KEY_A);
    expect(r.status).toBe(200);
    expect(r.body.settings.jsonSchema.properties.theme).toBeTruthy();
    expect(r.body.settings.defaults.theme.color).toBe('#1f2937');
    expect(r.body.locales).toEqual(LOCALES);
    expect(Object.keys(r.body.messages)).toEqual(SUPPORTED_LOCALES);
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(r.body.messages[locale])).toEqual(Object.keys(r.body.messages.en));
      expect(r.body.messages[locale]).toEqual(ALL_CATALOGS[locale]);
    }
    expect(r.body.messages.en['composer.send']).toBe('Send');
    expect(r.body.settings.defaults.locales).toEqual(['en', 'vi']);
  });

  it('health needs no key', async () => {
    const r = await call(healthRoute.GET, null);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });
});
