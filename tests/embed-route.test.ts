import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@/server/config';
import { getDb } from '@/server/db/client';
import { channels, webhookDeliveries } from '@/server/db/schema';
import { resetWorkerForTests } from '@/server/queue/worker';
import * as embed from '@/app/embed/[file]/route';
import { insertChannel, useTestDb } from './helpers';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const get = (file: string, headers: Record<string, string> = {}) => embed.GET(new Request(`http://hub.test/embed/${file}`, { headers }), { params: Promise.resolve({ file }) });

beforeEach(() => {
  process.env.API_KEYS = `acme:${'a'.repeat(20)}`;
  resetConfigForTests();
  resetWorkerForTests();
  useTestDb();
});

describe('GET /embed/<channel>.js', () => {
  it('serves JavaScript with the right headers, ETag and 304', async () => {
    const ch = insertChannel('acme');
    const res = await get(`${ch.id}.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('cache-control')).toBe('public, no-cache');
    const body = await res.text();
    expect(body).toContain(ch.id);
    expect(() => new Function(body)).not.toThrow();
    const etag = res.headers.get('etag')!;
    expect((await get(`${ch.id}.js`, { 'if-none-match': etag })).status).toBe(304);
  });

  it('returns updated settings when a cached loader revalidates after a settings change', async () => {
    const ch = insertChannel('acme');
    const first = await get(`${ch.id}.js`);
    const etag = first.headers.get('etag')!;
    getDb().update(channels).set({ settings: { launcher: { offset: { x: 64, y: 72 } } } }).run();

    const updated = await get(`${ch.id}.js`, { 'if-none-match': etag });
    expect(updated.status).toBe(200);
    expect(updated.headers.get('etag')).not.toBe(etag);
    expect(await updated.text()).toContain('"offset":{"x":64,"y":72}');
  });

  it.each(['nope.js', 'ch_short.js', '../etc/passwd', `ch_${'A'.repeat(22)}.js`, `ch_${'A'.repeat(22)}`])('404 for %s', async (file) => {
    expect((await get(file)).status).toBe(404);
  });

  it('records the connection once and queues channel.connected', async () => {
    const ch = insertChannel('acme', { webhookUrl: 'https://r.test/h' });
    await get(`${ch.id}.js`);
    await get(`${ch.id}.js`);
    expect(getDb().select().from(channels).get()!.connectedAt).toBeInstanceOf(Date);
    expect(getDb().select().from(webhookDeliveries).all().map((d) => d.event)).toEqual(['channel.connected']);
  });
});

describe('generated loader', () => {
  it('loader.min.ts is up to date with loader.js (run `pnpm build:loader`)', () => {
    const before = readFileSync('src/loader/loader.min.ts', 'utf8');
    execFileSync('node', ['scripts/build-loader.mjs']);
    expect(readFileSync('src/loader/loader.min.ts', 'utf8')).toBe(before);
  });
});
