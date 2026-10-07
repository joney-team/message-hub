import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from '../db/schema';
import { webhookDeliveries, type channels, type messages, type visitors } from '../db/schema';
import { absoluteFileUrl } from '../file-urls';

type DbLike = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
type ChannelRow = typeof channels.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type VisitorRow = typeof visitors.$inferSelect;

export type WebhookEvent = 'message.created' | 'visitor.created' | 'visitor.updated' | 'channel.connected';

export function messagePayload(m: MessageRow) {
  return {
    id: m.id,
    direction: m.direction,
    text: m.text,
    attachments: m.attachments.map((a) => ({ ...a, url: absoluteFileUrl(a.fileId) })),
    sender: m.sender,
    ...(m.direction === 'inbound' ? { context: m.context } : {}),
    createdAt: m.createdAt.toISOString(),
  };
}

export function visitorPayload(v: VisitorRow) {
  return { id: v.id, locale: v.locale, profile: v.profile };
}

/**
 * Inserts a pending delivery. Call it inside the same transaction as the write
 * that caused the event. Channels without a webhook URL get nothing queued.
 * The caller must `wakeWorker()` after the transaction commits.
 */
export function enqueueEvent(db: DbLike, channel: ChannelRow, event: WebhookEvent, data: Record<string, unknown>): boolean {
  if (!channel.webhookUrl) return false;
  const now = new Date();
  db.insert(webhookDeliveries)
    .values({
      channelId: channel.id,
      event,
      payload: { event, createdAt: now.toISOString(), channel: { id: channel.id, ref: channel.ref }, data },
      status: 'pending',
      nextAttemptAt: now,
      createdAt: now,
    })
    .run();
  return true;
}
