import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { ConfigError, loadConfig, parseApiKeys, resetConfigForTests } from '@/server/config';
import { getDb } from '@/server/db/client';
import { channels, messages, visitors, webhookDeliveries } from '@/server/db/schema';
import { ID_PATTERN, hashToken, isId, newId, newVisitorToken } from '@/server/ids';
import { requireApiKey, requireVisitor, safeEqual } from '@/server/http/auth';
import { ApiError, handle } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import { bearer, insertChannel, insertVisitor, useTestDb } from './helpers';

const KEY = 'k'.repeat(20);

describe('config', () => {
  it('refuses to start in production without API_KEYS', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
  });

  it('falls back to a dev key outside production', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).apiKeys).toHaveLength(1);
  });

  it('parses multiple owners, allowing the same owner twice (key rotation)', () => {
    const keys = parseApiKeys(`acme:${KEY}, other:${'z'.repeat(16)},acme:${'y'.repeat(16)}`);
    expect(keys.map((k) => k.owner)).toEqual(['acme', 'other', 'acme']);
  });

  it('rejects short keys without echoing the secret', () => {
    try {
      parseApiKeys('acme:short-secret');
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('short-secret');
    }
  });

  it('does not log secrets while loading', () => {
    const spy = vi.spyOn(console, 'log');
    loadConfig({ NODE_ENV: 'production', API_KEYS: `acme:${KEY}` });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reads limits', () => {
    const c = loadConfig({ NODE_ENV: 'production', API_KEYS: `a:${KEY}`, MAX_UPLOAD_MB: '2', FILES_BASE_URL: 'https://files.example.com/' });
    expect(c.maxUploadBytes).toBe(2 * 1024 * 1024);
    expect(c.filesBaseUrl).toBe('https://files.example.com');
  });
});

describe('ids', () => {
  it('are prefixed, unique and unguessable-looking', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('msg')));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(ID_PATTERN);
    expect(isId('ch', newId('msg'))).toBe(false);
    expect(isId('ch', '../etc/passwd')).toBe(false);
  });

  it('hashes tokens deterministically', () => {
    const t = newVisitorToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
});

describe('http helpers', () => {
  it('handle() maps ApiError and hides unknown errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = handle(() => {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'nope');
    });
    const res = await bad(new Request('http://x'), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'CHANNEL_NOT_FOUND', message: 'nope' } });

    const boom = handle(() => {
      throw new Error('secret db path');
    });
    const res2 = await boom(new Request('http://x'), { params: Promise.resolve({}) });
    expect(res2.status).toBe(500);
    expect(JSON.stringify(await res2.json())).not.toContain('secret');
  });

  it('readJson validates and limits size', async () => {
    const schema = z.object({ a: z.string() });
    const ok = new Request('http://x', { method: 'POST', body: JSON.stringify({ a: 'x' }) });
    expect(await readJson(ok, schema)).toEqual({ a: 'x' });
    await expect(readJson(new Request('http://x', { method: 'POST', body: '{"a":1}' }), schema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(readJson(new Request('http://x', { method: 'POST', body: 'nope' }), schema)).rejects.toMatchObject({ code: 'INVALID_JSON' });
    await expect(readJson(new Request('http://x', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(100) }) }), schema, 50)).rejects.toMatchObject({ status: 413 });
  });
});

describe('auth', () => {
  beforeEach(() => {
    process.env.API_KEYS = `acme:${KEY},other:${'o'.repeat(20)}`;
    resetConfigForTests();
    useTestDb();
  });

  it('maps an API key to its owner', () => {
    expect(requireApiKey(bearer(KEY))).toBe('acme');
    expect(requireApiKey(bearer('o'.repeat(20)))).toBe('other');
  });

  it('rejects missing, malformed and wrong keys with 401', () => {
    for (const req of [new Request('http://x'), bearer('wrong'), new Request('http://x', { headers: { authorization: `Basic ${KEY}` } })]) {
      expect(() => requireApiKey(req)).toThrowError(expect.objectContaining({ status: 401 }));
    }
  });

  it('safeEqual handles different lengths', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  it('resolves a visitor from its token and rejects others', () => {
    const ch = insertChannel();
    const { visitor, token } = insertVisitor(ch.id);
    expect(requireVisitor(bearer(token)).visitor.id).toBe(visitor.id);
    expect(() => requireVisitor(bearer('vt_unknown'))).toThrowError(expect.objectContaining({ status: 401 }));
    expect(() => requireVisitor(new Request('http://x'))).toThrowError(expect.objectContaining({ status: 401 }));
  });
});

describe('schema', () => {
  beforeEach(useTestDb);

  it('cascades channel deletion to visitors, messages and deliveries', () => {
    const db = getDb();
    const ch = insertChannel();
    const { visitor } = insertVisitor(ch.id);
    const now = new Date();
    db.insert(messages).values({ id: newId('msg'), channelId: ch.id, visitorId: visitor.id, direction: 'inbound', text: 'hi', attachments: [], createdAt: now }).run();
    db.insert(webhookDeliveries).values({ channelId: ch.id, event: 'message.created', payload: {}, status: 'pending', nextAttemptAt: now, createdAt: now }).run();
    db.delete(channels).where(eq(channels.id, ch.id)).run();
    expect(db.select().from(visitors).all()).toHaveLength(0);
    expect(db.select().from(messages).all()).toHaveLength(0);
    expect(db.select().from(webhookDeliveries).all()).toHaveLength(0);
  });

  it('dedupes (visitor, clientMessageId)', () => {
    const db = getDb();
    const ch = insertChannel();
    const { visitor } = insertVisitor(ch.id);
    const row = { channelId: ch.id, visitorId: visitor.id, direction: 'inbound' as const, text: 'x', attachments: [], clientMessageId: 'c1', createdAt: new Date() };
    db.insert(messages).values({ ...row, id: newId('msg') }).run();
    expect(() => db.insert(messages).values({ ...row, id: newId('msg') }).run()).toThrow();
    // NULL client ids never collide
    db.insert(messages).values({ ...row, clientMessageId: null, id: newId('msg') }).run();
    db.insert(messages).values({ ...row, clientMessageId: null, id: newId('msg') }).run();
  });

  it('seq is monotonic', () => {
    const db = getDb();
    const ch = insertChannel();
    const { visitor } = insertVisitor(ch.id);
    const mk = () => db.insert(messages).values({ id: newId('msg'), channelId: ch.id, visitorId: visitor.id, direction: 'inbound', text: 'x', attachments: [], createdAt: new Date() }).returning({ seq: messages.seq }).get();
    expect(mk().seq).toBeLessThan(mk().seq);
  });
});
