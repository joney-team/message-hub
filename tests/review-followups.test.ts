import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetConfigForTests } from '@/server/config';
import { getDb, getSqlite } from '@/server/db/client';
import { channels, files, visitors } from '@/server/db/schema';
import { resetLimitersForTests } from '@/server/http/rate-limit';
import { hub } from '@/server/realtime/hub';
import { createMessage } from '@/server/services/messages';
import { filesDir, ORPHAN_AFTER_MS, sweepFiles } from '@/server/services/files';
import { normalizeSettings, DEFAULT_SETTINGS, resetSettingsWarningsForTests } from '@/settings';
import * as stream from '@/app/api/widget/stream/route';
import * as me from '@/app/api/widget/me/route';
import * as sessions from '@/app/api/widget/sessions/route';
import * as channelCfg from '@/app/api/widget/channels/[id]/route';
import { insertChannel, insertVisitor, useTestDb } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-followups-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  process.env.API_KEYS = `acme:${'a'.repeat(20)}`;
  process.env.DATA_DIR = tmp;
  delete process.env.TRUSTED_PROXIES;
  resetConfigForTests();
  resetLimitersForTests();
  resetSettingsWarningsForTests();
  useTestDb();
});

async function open(token: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = (await stream.GET(new Request('http://hub.test/s', { headers: { authorization: `Bearer ${token}`, ...headers }, signal: ctrl.signal }), { params: Promise.resolve({}) })) as Response;
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let closed = false;
  return {
    get text() { return buf; },
    get closed() { return closed; },
    async until(re: RegExp, ms = 1000) {
      const start = Date.now();
      while (!re.test(buf)) {
        if (Date.now() - start > ms) throw new Error(`timeout ${re}; got: ${buf}`);
        const r = await Promise.race([reader.read(), new Promise<{ done: false; value: undefined }>((ok) => setTimeout(() => ok({ done: false, value: undefined }), 30))]);
        if (r.done) { closed = true; break; }
        if (r.value) buf += dec.decode(r.value);
      }
    },
    async drain(ms = 300) {
      const start = Date.now();
      while (Date.now() - start < ms && !closed) {
        const r = await Promise.race([reader.read(), new Promise<{ done: false; value: undefined }>((ok) => setTimeout(() => ok({ done: false, value: undefined }), 30))]);
        if (r.done) closed = true;
        else if (r.value) buf += dec.decode(r.value);
      }
    },
    close: () => ctrl.abort(),
  };
}

describe('SSE catch-up beyond the replay cap', () => {
  it('replays what it can, in order, when the gap fits', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    for (let i = 0; i < 5; i++) createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: `m${i}`, attachments: [] });
    const s = await open(a.token, { 'last-event-id': '0' });
    await s.until(/m4[\s\S]*: connected/);
    expect(s.text).not.toContain('event: resync');
    s.close();
  });

  it('tells the client to reload history instead of silently skipping messages when the gap is too large', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    for (let i = 0; i < 205; i++) createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: `m${i}`, attachments: [] });
    const s = await open(a.token, { 'last-event-id': '0' });
    await s.until(/event: resync[\s\S]*: connected/);
    expect(s.text).not.toContain('"text":"m0"');
    // live messages keep flowing after the resync
    createMessage({ channel: ch, visitor: a.visitor, direction: 'outbound', text: 'live', attachments: [] });
    await s.until(/"text":"live"/);
    s.close();
  });
});

describe('logout closes open streams', () => {
  it('DELETE /api/widget/me ends the visitor\'s stream and the old token stops working', async () => {
    const ch = insertChannel();
    const a = insertVisitor(ch.id);
    const other = insertVisitor(ch.id);
    const s = await open(a.token);
    const o = await open(other.token);
    await s.until(/: connected/);
    await o.until(/: connected/);
    const res = await me.DELETE(new Request('http://x', { method: 'DELETE', headers: { authorization: `Bearer ${a.token}` } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(204);
    await s.drain();
    expect(s.closed).toBe(true);
    expect(hub.countFor(a.visitor.id)).toBe(0);
    expect(hub.countFor(other.visitor.id)).toBe(1); // someone else's stream is untouched
    o.close();
  });
});

describe('orphan file sweep', () => {
  it('does not run one scan of messages per file', () => {
    const ch = insertChannel();
    const { visitor } = insertVisitor(ch.id);
    const old = new Date(Date.now() - ORPHAN_AFTER_MS - 60_000);
    fs.mkdirSync(filesDir(), { recursive: true });
    const used: string[] = [];
    for (let i = 0; i < 40; i++) {
      const id = `file_${String(i).padStart(22, 'x')}`;
      getDb().insert(files).values({ id, channelId: ch.id, visitorId: visitor.id, name: 'a.png', mime: 'image/png', size: 1, createdAt: old }).run();
      fs.writeFileSync(path.join(filesDir(), id), 'x');
      if (i < 10) used.push(id);
    }
    createMessage({ channel: ch, visitor, direction: 'inbound', text: 'x', attachments: used.map((id) => ({ fileId: id, name: 'a.png', mime: 'image/png', size: 1 })) });
    const prepare = vi.spyOn(getSqlite(), 'prepare');
    expect(sweepFiles()).toEqual({ rows: 30, disk: 0 });
    const scans = prepare.mock.calls.filter(([sql]) => /from messages|from "messages"/i.test(String(sql)));
    expect(scans.length).toBeLessThanOrEqual(2);
    expect(getDb().select().from(files).all()).toHaveLength(10);
  });
});

describe('visitors.origin', () => {
  it('stores the origin of the page the chat was started on, normalised', async () => {
    const ch = insertChannel();
    const post = (origin?: string) =>
      sessions.POST(new Request('http://hub.test/s', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: ch.id, origin }) }), { params: Promise.resolve({}) });
    const ok = await post('https://Shop.Example.com/pricing?x=1');
    expect(ok.status).toBe(201);
    expect((await ok.json()).visitor.origin).toBe('https://shop.example.com');
    expect((await (await post()).json()).visitor.origin).toBeNull();
    expect((await (await post('javascript:alert(1)')).json()).visitor.origin).toBeNull();
    expect(getDb().select().from(visitors).all().map((v) => v.origin)).toEqual(['https://shop.example.com', null, null]);
  });
});

describe('normalizeSettings with a bad stored value', () => {
  it('falls back only for the broken section and logs which channel is affected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = { theme: { color: 'not-a-colour', radius: 'lg' }, launcher: { position: 'left', hidden: true }, content: { brandName: { en: 'Acme' } } };
    const s = normalizeSettings(stored, 'ch_broken');
    expect(s.theme).toEqual(DEFAULT_SETTINGS.theme); // the broken section only
    expect(s.launcher).toMatchObject({ position: 'left', hidden: true }); // others kept
    expect(s.launcher.mobileOffset).toEqual({ x: 16, y: 16 }); // added settings are completed for older rows
    expect(s.content.brandName).toEqual({ en: 'Acme' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('ch_broken');
    expect(String(warn.mock.calls[0][0])).toContain('theme');
    normalizeSettings(stored, 'ch_broken'); // not repeated for the same channel
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays silent for valid, empty or missing settings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    normalizeSettings({}, 'ch_a');
    normalizeSettings(undefined, 'ch_b');
    normalizeSettings({ theme: { color: '#112233' } }, 'ch_c');
    expect(warn).not.toHaveBeenCalled();
  });

  it('the public channel config keeps the valid parts of a damaged channel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ch = insertChannel('acme', { settings: { theme: { color: 'bad' }, window: { width: 500 } } });
    getDb().update(channels).set({ settings: { theme: { color: 'bad' }, window: { width: 500 } } }).where(eq(channels.id, ch.id)).run();
    const res = await channelCfg.GET(new Request('http://x'), { params: Promise.resolve({ id: ch.id }) });
    const body = await res.json();
    expect(body.settings.theme.color).toBe('#1f2937');
    expect(body.settings.window.width).toBe(500);
  });
});
