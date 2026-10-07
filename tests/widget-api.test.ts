import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@/server/config';
import { getDb, getSqlite } from '@/server/db/client';
import { visitors, webhookDeliveries } from '@/server/db/schema';
import { resetLimitersForTests } from '@/server/http/rate-limit';
import { hub } from '@/server/realtime/hub';
import { createMessage } from '@/server/services/messages';
import * as channelCfg from '@/app/api/widget/channels/[id]/route';
import * as sessions from '@/app/api/widget/sessions/route';
import * as me from '@/app/api/widget/me/route';
import * as msgs from '@/app/api/widget/messages/route';
import * as stream from '@/app/api/widget/stream/route';
import { insertChannel, insertVisitor, useTestDb } from './helpers';

type H = (req: Request, ctx: { params: Promise<never> }) => Promise<Response> | Response;

async function call(handler: unknown, token: string | null, opts: { method?: string; url?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(opts.url ?? 'http://hub.test/api', { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const res = await (handler as H)(req, { params: Promise.resolve(opts.params ?? {}) as never });
  const text = res.status === 204 || res.status === 304 ? '' : await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  process.env.API_KEYS = `acme:${'a'.repeat(20)}`;
  resetConfigForTests();
  useTestDb();
  resetLimitersForTests();
});

describe('sessions', () => {
  it('creates a visitor, returns the token once, stores only its hash, queues visitor.created', async () => {
    const ch = insertChannel('acme', { webhookUrl: 'https://r.test/h', settings: { locales: ['en', 'vi'] } });
    const r = await call(sessions.POST, null, { method: 'POST', body: { channelId: ch.id, locale: 'vi-VN', profile: { name: 'Lan' } } });
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^vt_/);
    expect(r.body.visitor).toMatchObject({ locale: 'vi', profile: { name: 'Lan' }, channelId: ch.id });
    const row = getDb().select().from(visitors).get()!;
    expect(row.tokenHash).not.toBe(r.body.token);
    expect(JSON.stringify(row)).not.toContain(r.body.token);
    expect(getDb().select().from(webhookDeliveries).all().map((d) => d.event)).toEqual(['visitor.created']);
  });

  it.each([
    ['ko', 'ko-KR'],
    ['zh', 'zh-CN'],
    ['ja', 'ja-JP'],
    ['th', 'th-TH'],
    ['fr', 'fr-FR'],
    ['ru', 'ru-RU'],
  ])('persists %s and includes it in visitor and message webhooks', async (locale, regional) => {
    const ch = insertChannel('acme', { webhookUrl: 'https://r.test/h', settings: { locales: ['en', locale] } });
    const created = await call(sessions.POST, null, { method: 'POST', body: { channelId: ch.id, locale: regional } });
    expect(created.status).toBe(201);
    expect(created.body.visitor.locale).toBe(locale);
    const token = created.body.token;
    expect((await call(me.PATCH, token, { method: 'PATCH', body: { locale: 'en-US' } })).body.visitor.locale).toBe('en');
    expect((await call(me.PATCH, token, { method: 'PATCH', body: { locale: regional } })).body.visitor.locale).toBe(locale);
    expect((await call(me.PATCH, token, { method: 'PATCH', body: { locale: 'xx' } })).body.visitor.locale).toBe(locale);
    expect((await call(me.GET, token)).body.visitor.locale).toBe(locale);
    expect((await call(msgs.POST, token, { method: 'POST', body: { text: 'Hello' } })).status).toBe(201);

    const deliveries = getDb().select().from(webhookDeliveries).all();
    expect(deliveries.map((d) => d.event)).toEqual(['visitor.created', 'visitor.updated', 'visitor.updated', 'message.created']);
    for (const [i, expected] of [locale, 'en', locale, locale].entries()) {
      expect(deliveries[i].payload.data).toMatchObject({ visitor: { id: created.body.visitor.id, locale: expected } });
    }
  });

  it('rejects unknown channels and bad bodies, and is rate limited per IP', async () => {
    expect((await call(sessions.POST, null, { method: 'POST', body: { channelId: 'ch_nope' } })).status).toBe(404);
    expect((await call(sessions.POST, null, { method: 'POST', body: { channelId: 'x', profile: { __proto__x: 1, 'bad key': 1 } } })).status).toBe(400);
    const ch = insertChannel();
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const r = await call(sessions.POST, null, { method: 'POST', body: { channelId: ch.id }, headers: { 'x-forwarded-for': '9.9.9.9' } });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    expect((await call(sessions.POST, null, { method: 'POST', body: { channelId: ch.id }, headers: { 'x-forwarded-for': '8.8.8.8' } })).status).toBe(201);
  });
});

describe('public channel config', () => {
  it('returns complete settings with an ETag, 304 on revalidation, 404 for unknown ids and no secrets', async () => {
    const ch = insertChannel('acme', { webhookUrl: 'https://r.test/h', settings: {} });
    const r = await call(channelCfg.GET, null, { params: { id: ch.id } });
    expect(r.status).toBe(200);
    expect(r.body.settings.theme.color).toBe('#1f2937');
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain(ch.webhookSecret);
    expect(raw).not.toContain('r.test');
    const etag = r.headers.get('etag')!;
    expect((await call(channelCfg.GET, null, { params: { id: ch.id }, headers: { 'if-none-match': etag } })).status).toBe(304);
    expect((await call(channelCfg.GET, null, { params: { id: 'ch_nope' } })).status).toBe(404);
  });
});

describe('visitor isolation', () => {
  it('requires a token everywhere', async () => {
    for (const h of [me.GET, me.PATCH, me.DELETE, msgs.GET, msgs.POST, stream.GET]) {
      expect((await call(h, null, { method: 'POST', body: {} })).status).toBe(401);
      expect((await call(h, 'vt_forged', { method: 'POST', body: {} })).status).toBe(401);
    }
  });

  it("visitor A never sees visitor B's messages, even in the same channel", async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const b = insertVisitor(ch.id);
    createMessage({ channel: ch, visitor: b.visitor, direction: 'inbound', text: 'secret of B', attachments: [] });
    createMessage({ channel: ch, visitor: a.visitor, direction: 'inbound', text: 'mine', attachments: [] });
    const list = await call(msgs.GET, a.token);
    expect(list.body.data.map((m: { text: string }) => m.text)).toEqual(['mine']);
    // a cursor pointing at B's message does not widen the scope
    const first = getSqlite().prepare('select seq from messages order by seq desc limit 1').get() as { seq: number };
    const paged = await call(msgs.GET, a.token, { url: `http://x/?before=${first.seq + 10}` });
    expect(JSON.stringify(paged.body)).not.toContain('secret of B');
    expect(JSON.stringify((await call(me.GET, a.token)).body)).not.toContain(b.visitor.id);
  });

  it('cannot attach a file uploaded by someone else', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const b = insertVisitor(ch.id);
    getSqlite().prepare("insert into files (id,channel_id,visitor_id,name,mime,size,created_at) values ('file_b',?,?,'x.png','image/png',1,0)").run(ch.id, b.visitor.id);
    const r = await call(msgs.POST, a.token, { method: 'POST', body: { text: 'x', attachments: [{ fileId: 'file_b' }] } });
    expect(r.status).toBe(400);
  });

  it('revoking invalidates the token', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    expect((await call(me.DELETE, a.token, { method: 'DELETE' })).status).toBe(204);
    expect((await call(me.GET, a.token)).status).toBe(401);
  });
});

describe('sending messages', () => {
  it('stores inbound text with page context and returns the same message for a repeated clientMessageId', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const body = { text: 'hello', clientMessageId: 'c-1', context: { url: 'https://site.test/p', title: 'Pricing', referrer: '' } };
    const one = await call(msgs.POST, a.token, { method: 'POST', body });
    const two = await call(msgs.POST, a.token, { method: 'POST', body });
    expect(one.status).toBe(201);
    expect(two.status).toBe(200);
    expect(two.body.id).toBe(one.body.id);
    expect(one.body).toMatchObject({ direction: 'inbound', context: { title: 'Pricing' } });
    expect((await call(msgs.GET, a.token)).body.data).toHaveLength(1);
  });

  it('validates text and rejects script-ish structure only as data (stored verbatim, escaped at render)', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    expect((await call(msgs.POST, a.token, { method: 'POST', body: { text: '' } })).status).toBe(400);
    expect((await call(msgs.POST, a.token, { method: 'POST', body: { text: 'x'.repeat(4001) } })).status).toBe(400);
    expect((await call(msgs.POST, a.token, { method: 'POST', body: { text: 'x', extra: 1 } })).status).toBe(400);
    const xss = await call(msgs.POST, a.token, { method: 'POST', body: { text: '<img src=x onerror=alert(1)>' } });
    expect(xss.body.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('rate limits sending per visitor (20 per minute)', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const b = insertVisitor(ch.id);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await call(msgs.POST, a.token, { method: 'POST', body: { text: `m${i}` } })).status);
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    const limited = await call(msgs.POST, a.token, { method: 'POST', body: { text: 'again' } });
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await call(msgs.POST, b.token, { method: 'POST', body: { text: 'other visitor ok' } })).status).toBe(201);
  });

  it('refuses attachments when the channel disabled them', async () => {
    const ch = insertChannel('acme', { settings: { features: { attachments: false } } });
    const a = insertVisitor(ch.id);
    const r = await call(msgs.POST, a.token, { method: 'POST', body: { text: 'x', attachments: [{ fileId: 'file_x' }] } });
    expect(r.body.error.code).toBe('ATTACHMENTS_DISABLED');
  });
});

describe('profile updates', () => {
  it('merges profile, queues visitor.updated only on change', async () => {
    const ch = insertChannel('acme', { webhookUrl: 'https://r.test/h' });
    const a = insertVisitor(ch.id);
    const patch = (body: unknown) => call(me.PATCH, a.token, { method: 'PATCH', body });
    expect((await patch({ profile: { name: 'Lan' } })).body.visitor.profile).toEqual({ name: 'Lan' });
    expect((await patch({ profile: { email: 'l@x.test' } })).body.visitor.profile).toEqual({ name: 'Lan', email: 'l@x.test' });
    await patch({ profile: { name: 'Lan' } }); // no-op
    expect(getDb().select().from(webhookDeliveries).all().map((d) => d.event)).toEqual(['visitor.updated', 'visitor.updated']);
  });
});

describe('SSE stream', () => {
  async function open(token: string, headers: Record<string, string> = {}) {
    const ctrl = new AbortController();
    const res = (await stream.GET(new Request('http://hub.test/api/widget/stream', { headers: { authorization: `Bearer ${token}`, ...headers }, signal: ctrl.signal }), { params: Promise.resolve({}) })) as Response;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    return {
      res,
      async until(re: RegExp, ms = 1000) {
        const start = Date.now();
        while (!re.test(buf)) {
          if (Date.now() - start > ms) throw new Error(`timeout waiting for ${re}; got: ${buf}`);
          const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), 50))]);
          if (r.value) buf += dec.decode(r.value);
        }
        return buf;
      },
      get text() {
        return buf;
      },
      close: () => ctrl.abort(),
    };
  }

  it('has SSE headers that defeat proxy buffering', async () => {
    const a = insertVisitor(insertChannel().id);
    const s = await open(a.token);
    expect(s.res.headers.get('content-type')).toContain('text/event-stream');
    expect(s.res.headers.get('x-accel-buffering')).toBe('no');
    expect(s.res.headers.get('cache-control')).toContain('no-cache');
    await s.until(/: connected/);
    s.close();
  });

  it('pushes live messages and typing events to the right visitor only', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const b = insertVisitor(ch.id);
    const sa = await open(a.token);
    const sb = await open(b.token);
    await sa.until(/: connected/);
    await sb.until(/: connected/);
    createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'for A', attachments: [] });
    hub.publish(a.visitor.id, { type: 'typing', data: { sender: { name: 'Ann' } } });
    const got = await sa.until(/event: typing/);
    expect(got).toMatch(/event: message\ndata: .*"text":"for A"/);
    expect(got).toMatch(/event: typing\ndata: {"sender":{"name":"Ann"}}/);
    expect(sb.text).not.toContain('for A');
    sa.close();
    sb.close();
    expect(hub.countFor(a.visitor.id)).toBe(0);
  });

  it('replays messages missed since Last-Event-ID, in order, without duplicates', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const m1 = createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'one', attachments: [] }).message;
    createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'two', attachments: [] });
    createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'three', attachments: [] });
    const s = await open(a.token, { 'last-event-id': String(m1.seq) });
    const text = await s.until(/three[\s\S]*: connected/);
    expect(text).not.toContain('"text":"one"');
    expect(text.indexOf('"text":"two"')).toBeLessThan(text.indexOf('"text":"three"'));
    expect(text.match(/"text":"two"/g)).toHaveLength(1);
    expect(text).toMatch(new RegExp(`id: ${m1.seq + 1}\\n`));
    createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'four', attachments: [] });
    await s.until(/"text":"four"/);
    s.close();
  });

  it('without Last-Event-ID nothing old is replayed', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'old', attachments: [] });
    const s = await open(a.token);
    expect(await s.until(/: connected/)).not.toContain('old');
    s.close();
  });

  it('closes streams on shutdown', async () => {
    const a = insertVisitor(insertChannel().id);
    const s = await open(a.token);
    await s.until(/: connected/);
    hub.shutdown();
    expect(hub.countFor(a.visitor.id)).toBe(0);
  });

  it('caps concurrent streams per visitor', async () => {
    const a = insertVisitor(insertChannel().id);
    const open5 = await Promise.all(Array.from({ length: 5 }, () => open(a.token)));
    const sixth = await call(stream.GET, a.token);
    expect(sixth.status).toBe(429);
    open5.forEach((s) => s.close());
  });
});
