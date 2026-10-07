import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetConfigForTests } from '@/server/config';
import { getDb } from '@/server/db/client';
import { channels, messages, visitors, webhookDeliveries } from '@/server/db/schema';
import { enqueueEvent } from '@/server/queue/outbox';
import { signWebhook, verifyWebhookSignature } from '@/server/queue/signature';
import {
  DELIVERED_RETENTION_MS,
  MAX_ATTEMPTS,
  MAX_PARALLEL_CHANNELS,
  RETRY_DELAYS_MS,
  cleanupDelivered,
  purgeOldConversations,
  resetWorkerForTests,
  runOnce,
  type WorkerDeps,
} from '@/server/queue/worker';
import { createMessage } from '@/server/services/messages';
import { retryDelivery } from '@/server/services/deliveries';
import { insertChannel, insertVisitor, useTestDb } from './helpers';

const URL_A = 'https://receiver.test/hook';

function setup(over: Partial<typeof channels.$inferInsert> = {}) {
  const channel = insertChannel('acme', { webhookUrl: URL_A, ...over });
  const { visitor } = insertVisitor(channel.id);
  return { channel, visitor };
}

const send = (channel: ReturnType<typeof setup>['channel'], visitor: ReturnType<typeof setup>['visitor'], text: string, direction: 'inbound' | 'outbound' = 'inbound') =>
  createMessage({ channel, visitor, direction, text, attachments: [], context: direction === 'inbound' ? { url: 'https://site.test/p', title: 'P' } : null }).message;

const deliveries = () => getDb().select().from(webhookDeliveries).orderBy(webhookDeliveries.id).all();

function clock(start = Date.now() + 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), get t() { return t; } };
}

const ok = () => new Response('ok', { status: 200 });

beforeEach(() => {
  process.env.API_KEYS = `acme:${'a'.repeat(20)},other:${'b'.repeat(20)}`;
  resetConfigForTests();
  useTestDb();
  resetWorkerForTests();
});

describe('outbox', () => {
  it('writes the delivery in the same transaction as the message', () => {
    const { channel, visitor } = setup();
    const m = send(channel, visitor, 'hello');
    const [d] = deliveries();
    expect(d).toMatchObject({ event: 'message.created', status: 'pending', attempts: 0, channelId: channel.id });
    expect((d.payload as { data: { message: { id: string } } }).data.message.id).toBe(m.id);
  });

  it('rolls back the delivery when the transaction fails', () => {
    const { channel, visitor } = setup();
    expect(() =>
      getDb().transaction((tx) => {
        enqueueEvent(tx, channel, 'message.created', { message: {}, visitor: {} });
        void visitor;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(deliveries()).toHaveLength(0);
  });

  it('queues nothing for a channel without webhook URL', () => {
    const { channel, visitor } = setup({ webhookUrl: null });
    send(channel, visitor, 'hello');
    expect(deliveries()).toHaveLength(0);
  });

  it('does not queue again for a duplicate clientMessageId', () => {
    const { channel, visitor } = setup();
    const base = { channel, visitor, direction: 'inbound' as const, text: 'x', attachments: [], clientMessageId: 'c1' };
    createMessage(base);
    createMessage(base);
    expect(deliveries()).toHaveLength(1);
  });
});

describe('delivery', () => {
  it('logs safe structured errors even when debug logging is disabled', async () => {
    const previousDebugLog = process.env.DEBUG_LOG;
    process.env.DEBUG_LOG = 'false';
    resetConfigForTests();
    const { channel, visitor } = setup();
    send(channel, visitor, 'secret message');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await runOnce({ now: clock().now, fetch: vi.fn(async () => new Response('receiver details', { status: 503 })) });

      expect(errorSpy).toHaveBeenCalledOnce();
      const line = String(errorSpy.mock.calls[0][0]);
      expect(JSON.parse(line.replace(/^\[hub\] /, ''))).toEqual({
        level: 'error',
        event: 'webhook.delivery_failed',
        deliveryId: 1,
        channelId: channel.id,
        webhookEvent: 'message.created',
        attempt: 1,
        status: 503,
        reason: 'http_error',
        exhausted: false,
      });
      expect(line).not.toContain(URL_A);
      expect(line).not.toContain(channel.webhookSecret);
      expect(line).not.toContain('secret message');
      expect(line).not.toContain('receiver details');
    } finally {
      if (previousDebugLog === undefined) delete process.env.DEBUG_LOG;
      else process.env.DEBUG_LOG = previousDebugLog;
      resetConfigForTests();
      errorSpy.mockRestore();
    }
  });

  it('logs request failures without exposing the destination URL', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await runOnce({ now: clock().now, fetch: vi.fn(async () => Promise.reject(new TypeError(`fetch failed for ${URL_A}`))) });

      const line = String(errorSpy.mock.calls[0][0]);
      expect(line).toContain('"reason":"request_error"');
      expect(line).toContain('"event":"webhook.delivery_failed"');
      expect(line).not.toContain(URL_A);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('posts a signed payload with the documented headers and shape', async () => {
    const { channel, visitor } = setup({ ref: 'ws-1' });
    visitor.profile = {};
    send(channel, visitor, 'hi there');
    send(channel, visitor, 'agent reply', 'outbound');
    const calls: { url: string; init: RequestInit }[] = [];
    const c = clock();
    const deps: WorkerDeps = { now: c.now, fetch: vi.fn(async (url, init) => (calls.push({ url: String(url), init: init! }), ok())) };

    await runOnce(deps);
    await runOnce(deps);
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    const headers = first.init.headers as Record<string, string>;
    expect(first.url).toBe(URL_A);
    expect(first.init.redirect).toBe('manual');
    expect(first.init.signal).toBeInstanceOf(AbortSignal);
    expect(headers['x-messagehub-event']).toBe('message.created');
    expect(headers['x-messagehub-delivery']).toBe('1');
    expect(verifyWebhookSignature(channel.webhookSecret, headers['x-messagehub-signature'], first.init.body as string, { now: Math.floor(c.t / 1000) })).toBe(true);

    const body = JSON.parse(first.init.body as string);
    expect(body).toMatchObject({
      id: 1,
      event: 'message.created',
      channel: { id: channel.id, ref: 'ws-1' },
      data: { message: { direction: 'inbound', text: 'hi there', attachments: [], context: { url: 'https://site.test/p' } }, visitor: { id: visitor.id, profile: {} } },
    });
    expect(typeof body.createdAt).toBe('string');
    const out = JSON.parse(second.init.body as string);
    expect(out.data.message.direction).toBe('outbound');
    expect(out.data.message.context).toBeUndefined();
    expect(deliveries().map((d) => d.status)).toEqual(['delivered', 'delivered']);
  });

  it('retries on the documented backoff schedule and then marks failed', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    const c = clock();
    const fetchMock = vi.fn(async () => new Response('no', { status: 500 }));
    const deps: WorkerDeps = { now: c.now, fetch: fetchMock };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(await runOnce(deps)).toBe(1);
      const d = deliveries()[0];
      expect(d.attempts).toBe(attempt);
      expect(d.lastStatus).toBe(500);
      if (attempt < MAX_ATTEMPTS) {
        expect(d.status).toBe('pending');
        expect(d.nextAttemptAt.getTime()).toBe(c.t + RETRY_DELAYS_MS[attempt - 1]);
        // not due yet one ms before
        c.advance(RETRY_DELAYS_MS[attempt - 1] - 1);
        expect(await runOnce(deps)).toBe(0);
        c.advance(1);
      } else {
        expect(d.status).toBe('failed');
      }
    }
    expect(RETRY_DELAYS_MS).toEqual([10_000, 60_000, 300_000, 1_800_000, 7_200_000]);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    c.advance(10 * 3600_000);
    expect(await runOnce(deps)).toBe(0);
  });

  it('records network errors and timeouts as failures', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    const c = clock();
    await runOnce({ now: c.now, fetch: vi.fn(async () => Promise.reject(new TypeError('fetch failed'))) });
    const d = deliveries()[0];
    expect(d.status).toBe('pending');
    expect(d.lastError).toContain('fetch failed');
    expect(d.lastStatus).toBeNull();
  });

  it('treats a redirect as a failure instead of following it', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    await runOnce({ now: clock().now, fetch: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) });
    expect(deliveries()[0]).toMatchObject({ status: 'pending', lastStatus: 302 });
  });

  it('keeps order inside a channel: a waiting retry holds back later messages', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'first');
    send(channel, visitor, 'second');
    const seen: string[] = [];
    let failFirst = true;
    const c = clock();
    const deps: WorkerDeps = {
      now: c.now,
      fetch: vi.fn(async (_u, init) => {
        const text = JSON.parse(init!.body as string).data.message.text as string;
        seen.push(text);
        if (text === 'first' && failFirst) return new Response('x', { status: 503 });
        return ok();
      }),
    };
    await runOnce(deps);
    expect(await runOnce(deps)).toBe(0); // 'second' must not jump the queue
    expect(seen).toEqual(['first']);
    failFirst = false;
    c.advance(RETRY_DELAYS_MS[0]);
    await runOnce(deps);
    await runOnce(deps);
    expect(seen).toEqual(['first', 'first', 'second']);
  });

  it('a failing channel does not block another channel', async () => {
    const a = setup();
    const b = setup({ webhookUrl: 'https://other.test/hook' });
    send(a.channel, a.visitor, 'for-a');
    send(b.channel, b.visitor, 'for-b');
    const deps: WorkerDeps = {
      now: clock().now,
      fetch: vi.fn(async (url) => (String(url).startsWith('https://receiver.test') ? new Response('x', { status: 500 }) : ok())),
    };
    await runOnce(deps);
    const byChannel = Object.fromEntries(deliveries().map((d) => [d.channelId, d.status]));
    expect(byChannel[a.channel.id]).toBe('pending');
    expect(byChannel[b.channel.id]).toBe('delivered');
  });

  it('a permanently failed delivery does not block later ones', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'dead');
    send(channel, visitor, 'alive');
    getDb().update(webhookDeliveries).set({ status: 'failed' }).where(eq(webhookDeliveries.id, 1)).run();
    const deps: WorkerDeps = { now: clock().now, fetch: vi.fn(async () => ok()) };
    expect(await runOnce(deps)).toBe(1);
    expect(deliveries().map((d) => d.status)).toEqual(['failed', 'delivered']);
  });

  it('runs at most 5 channels in parallel', async () => {
    for (let i = 0; i < 7; i++) {
      const s = setup({ webhookUrl: `https://r${i}.test/h` });
      send(s.channel, s.visitor, `m${i}`);
    }
    let active = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const deps: WorkerDeps = {
      now: clock().now,
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            active++;
            peak = Math.max(peak, active);
            release.push(() => (active--, resolve(ok())));
          }),
      ),
    };
    const first = runOnce(deps);
    await vi.waitFor(() => expect(release).toHaveLength(MAX_PARALLEL_CHANNELS));
    expect(await runOnce(deps)).toBe(0); // all slots busy
    release.forEach((r) => r());
    await first;
    expect(peak).toBe(MAX_PARALLEL_CHANNELS);
    release.splice(0);
    const second = runOnce(deps);
    await vi.waitFor(() => expect(release).toHaveLength(2));
    release.forEach((r) => r());
    await second;
    expect(deliveries().every((d) => d.status === 'delivered')).toBe(true);
  });

  it('pending deliveries survive a restart and are sent afterwards', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'before restart');
    resetWorkerForTests(); // a new process starts with empty in-memory state
    const fetchMock = vi.fn(async () => ok());
    await runOnce({ now: clock().now, fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliveries()[0].status).toBe('delivered');
  });

  it('fails (without throwing) when the channel lost its webhook URL', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    getDb().update(channels).set({ webhookUrl: null }).where(eq(channels.id, channel.id)).run();
    await runOnce({ now: clock().now, fetch: vi.fn() });
    expect(deliveries()[0].status).toBe('failed');
  });
});

describe('manual retry and cleanup', () => {
  it('retry puts a failed delivery back to pending, scoped to its owner', () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    getDb().update(webhookDeliveries).set({ status: 'failed', attempts: 6 }).run();
    expect(() => retryDelivery('other', 1)).toThrowError(expect.objectContaining({ status: 404 }));
    expect(retryDelivery('acme', 1)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('refuses to retry a delivered one', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'x');
    await runOnce({ now: clock().now, fetch: vi.fn(async () => ok()) });
    expect(() => retryDelivery('acme', 1)).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it('removes delivered rows older than 7 days only', async () => {
    const { channel, visitor } = setup();
    send(channel, visitor, 'old');
    send(channel, visitor, 'pending');
    const now = Date.now();
    getDb().update(webhookDeliveries).set({ status: 'delivered', deliveredAt: new Date(now - DELIVERED_RETENTION_MS - 1000) }).where(eq(webhookDeliveries.id, 1)).run();
    expect(cleanupDelivered(now)).toBe(1);
    expect(deliveries().map((d) => d.id)).toEqual([2]);
  });
});

describe('retention', () => {
  it('is off by default and, when set, removes idle visitors with their messages', () => {
    const { channel, visitor } = setup({ webhookUrl: null });
    send(channel, visitor, 'old message');
    const idle = getDb().select().from(visitors).get()!;
    getDb().update(visitors).set({ lastSeenAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(visitors.id, idle.id)).run();
    expect(purgeOldConversations()).toBe(0);
    process.env.MESSAGE_RETENTION_DAYS = '30';
    resetConfigForTests();
    const other = insertVisitor(channel.id).visitor;
    expect(purgeOldConversations()).toBe(1);
    expect(getDb().select().from(visitors).all().map((v) => v.id)).toEqual([other.id]);
    expect(getDb().select().from(messages).all()).toHaveLength(0);
    delete process.env.MESSAGE_RETENTION_DAYS;
  });
});

describe('signature', () => {
  const body = '{"a":1}';
  const secret = 'whsec_test';
  const t = 1_760_000_000;
  const header = signWebhook(secret, t, body);

  it('verifies a valid signature', () => {
    expect(header).toMatch(/^t=1760000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, header, body, { now: t })).toBe(true);
  });

  it('rejects tampering, wrong secret, stale timestamps and junk', () => {
    expect(verifyWebhookSignature(secret, header, '{"a":2}', { now: t })).toBe(false);
    expect(verifyWebhookSignature('whsec_other', header, body, { now: t })).toBe(false);
    expect(verifyWebhookSignature(secret, header, body, { now: t + 301 })).toBe(false);
    expect(verifyWebhookSignature(secret, null, body, { now: t })).toBe(false);
    expect(verifyWebhookSignature(secret, 'garbage', body, { now: t })).toBe(false);
    expect(verifyWebhookSignature(secret, `t=${t},v1=zz`, body, { now: t })).toBe(false);
  });
});
