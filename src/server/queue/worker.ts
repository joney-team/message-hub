import { and, eq, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { getConfig } from '../config';
import { channels, visitors, webhookDeliveries } from '../db/schema';
import { sweepFiles } from '../services/files';
import { signWebhook } from './signature';
import { debug, error as logError } from '../log';

export const MAX_ATTEMPTS = 6;
/** Wait after attempt 1..5 fails; attempt 6 failing marks the delivery `failed`. */
export const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
export const MAX_PARALLEL_CHANNELS = 5;
export const POLL_INTERVAL_MS = 2000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const DELIVERED_RETENTION_MS = 7 * 24 * 3600_000;
const CLEANUP_INTERVAL_MS = 3600_000;

type Delivery = typeof webhookDeliveries.$inferSelect;

export interface WorkerDeps {
  now: () => number;
  fetch: typeof fetch;
}

const realDeps: WorkerDeps = { now: () => Date.now(), fetch: (...a) => fetch(...a) };

interface State {
  timer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  running: boolean;
  busy: Set<string>;
  inflight: Set<Promise<void>>;
}

const g = globalThis as unknown as { __hub_worker?: State };
const state = (): State => (g.__hub_worker ??= { running: false, busy: new Set(), inflight: new Set() });

/**
 * Next due delivery per channel. Only the oldest *pending* delivery of a channel
 * may run, so a delivery waiting for retry holds back the ones after it (order is
 * kept). `failed` ones do not block.
 */
function dueHeads(now: number, exclude: Set<string>, limit: number): Delivery[] {
  const db = getDb();
  const rows = db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextAttemptAt, new Date(now)),
        sql`${webhookDeliveries.id} = (select min(d2.id) from webhook_deliveries d2 where d2.channel_id = ${webhookDeliveries.channelId} and d2.status = 'pending')`,
      ),
    )
    .orderBy(webhookDeliveries.id)
    .limit(limit + exclude.size)
    .all();
  return rows.filter((r) => !exclude.has(r.channelId)).slice(0, limit);
}

async function deliverOne(d: Delivery, deps: WorkerDeps): Promise<void> {
  const db = getDb();
  const channel = db.select().from(channels).where(eq(channels.id, d.channelId)).get();
  const fail = (error: string, status: number | null, reason: 'http_error' | 'request_error') => {
    const attempts = d.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    db.update(webhookDeliveries)
      .set({
        attempts,
        lastStatus: status,
        lastError: error.slice(0, 500),
        status: exhausted ? 'failed' : 'pending',
        nextAttemptAt: new Date(deps.now() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!)),
      })
      .where(eq(webhookDeliveries.id, d.id))
      .run();
    debug('webhook.failed', { deliveryId: d.id, channelId: d.channelId, webhookEvent: d.event, attempt: attempts, status, exhausted });
    logError('webhook.delivery_failed', { deliveryId: d.id, channelId: d.channelId, webhookEvent: d.event, attempt: attempts, status, reason, exhausted });
  };
  if (!channel?.webhookUrl) {
    db.update(webhookDeliveries)
      .set({ status: 'failed', attempts: d.attempts + 1, lastError: 'Channel has no webhook URL' })
      .where(eq(webhookDeliveries.id, d.id))
      .run();
    debug('webhook.failed', { deliveryId: d.id, channelId: d.channelId, webhookEvent: d.event, attempt: d.attempts + 1, status: null, exhausted: true });
    logError('webhook.delivery_failed', {
      deliveryId: d.id,
      channelId: d.channelId,
      webhookEvent: d.event,
      attempt: d.attempts + 1,
      status: null,
      reason: 'missing_webhook_url',
      exhausted: true,
    });
    return;
  }
  const body = JSON.stringify({ id: d.id, ...d.payload });
  const timestamp = Math.floor(deps.now() / 1000);
  try {
    debug('webhook.attempt', { deliveryId: d.id, channelId: d.channelId, webhookEvent: d.event, attempt: d.attempts + 1 });
    const res = await deps.fetch(channel.webhookUrl, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'MessageHub-Webhook/2',
        'x-messagehub-event': d.event,
        'x-messagehub-delivery': String(d.id),
        'x-messagehub-signature': signWebhook(channel.webhookSecret, timestamp, body),
      },
      body,
    });
    void res.body?.cancel().catch(() => {});
    if (res.status >= 200 && res.status < 300) {
      db.update(webhookDeliveries)
        .set({ status: 'delivered', attempts: d.attempts + 1, lastStatus: res.status, lastError: null, deliveredAt: new Date(deps.now()) })
        .where(eq(webhookDeliveries.id, d.id))
        .run();
      debug('webhook.delivered', { deliveryId: d.id, channelId: d.channelId, webhookEvent: d.event, attempt: d.attempts + 1, status: res.status });
    } else {
      fail(`HTTP ${res.status}`, res.status, 'http_error');
    }
  } catch (err) {
    fail(err instanceof Error ? `${err.name}: ${err.message}` : 'Request failed', null, 'request_error');
  }
}

/**
 * One scheduling pass: starts deliveries for idle channels (up to the parallel
 * limit) and resolves when they all settle. Exported for tests with fake deps.
 */
export async function runOnce(deps: WorkerDeps = realDeps): Promise<number> {
  const s = state();
  const slots = MAX_PARALLEL_CHANNELS - s.busy.size;
  if (slots <= 0) return 0;
  const heads = dueHeads(deps.now(), s.busy, slots);
  const jobs = heads.map((d) => {
    s.busy.add(d.channelId);
    const p = deliverOne(d, deps)
      .catch((err) => console.error('[hub] delivery error:', err instanceof Error ? err.message : 'unknown'))
      .finally(() => {
        s.busy.delete(d.channelId);
        s.inflight.delete(p);
      });
    s.inflight.add(p);
    return p;
  });
  await Promise.all(jobs);
  return heads.length;
}

export function cleanupDelivered(now: number = Date.now()): number {
  return getDb()
    .delete(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'delivered'), lt(webhookDeliveries.deliveredAt, new Date(now - DELIVERED_RETENTION_MS))))
    .run().changes;
}

/** MESSAGE_RETENTION_DAYS > 0: drop visitors (and, by cascade, their messages) idle for longer than that. */
export function purgeOldConversations(now: number = Date.now()): number {
  const days = getConfig().messageRetentionDays;
  if (days <= 0) return 0;
  return getDb()
    .delete(visitors)
    .where(lt(visitors.lastSeenAt, new Date(now - days * 86_400_000)))
    .run().changes;
}

async function loop(): Promise<void> {
  const s = state();
  if (!s.running) return;
  try {
    // Drain: keep going while there was work, so a backlog does not wait 2s per message.
    while (s.running && (await runOnce()) > 0);
  } catch (err) {
    console.error('[hub] worker error:', err instanceof Error ? err.message : 'unknown');
  }
  if (s.running) s.timer = setTimeout(loop, POLL_INTERVAL_MS);
}

/** Wake the worker now (new delivery queued). Cheap and safe to call when stopped. */
export function wakeWorker(): void {
  const s = state();
  if (!s.running) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(loop, 0);
  debug('worker.woken', {});
}

export function startWorker(): void {
  const s = state();
  if (s.running) return;
  s.running = true;
  s.timer = setTimeout(loop, 0);
  debug('worker.started', {});
  s.cleanupTimer = setInterval(() => {
    try {
      const deliveries = cleanupDelivered();
      const conversations = purgeOldConversations();
      const files = sweepFiles();
      if (deliveries || conversations || files.rows || files.disk) {
        debug('worker.cleanup', { deliveries, conversations, fileRows: files.rows, filesOnDisk: files.disk });
      }
    } catch (err) {
      console.error('[hub] cleanup error:', err instanceof Error ? err.message : 'unknown');
    }
  }, CLEANUP_INTERVAL_MS);
  s.cleanupTimer.unref();
}

/** Stops scheduling and waits (bounded) for requests already in flight. */
export async function stopWorker(graceMs = 5000): Promise<void> {
  const s = state();
  s.running = false;
  clearTimeout(s.timer);
  clearInterval(s.cleanupTimer);
  await Promise.race([Promise.allSettled([...s.inflight]), new Promise((r) => setTimeout(r, graceMs))]);
  debug('worker.stopped', { inFlight: s.inflight.size });
}

export function resetWorkerForTests(): void {
  const s = state();
  s.running = false;
  s.busy.clear();
  s.inflight.clear();
}
