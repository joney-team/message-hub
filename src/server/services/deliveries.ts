import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { channels, webhookDeliveries } from '../db/schema';
import type { OwnerScope } from '../http/auth';
import { conflict, notFound } from '../http/errors';
import { wakeWorker } from '../queue/worker';

type Row = typeof webhookDeliveries.$inferSelect;

export function serializeDelivery(d: Row) {
  return {
    id: d.id,
    channelId: d.channelId,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: d.nextAttemptAt.toISOString(),
    lastStatus: d.lastStatus,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
  };
}

/** Puts a failed (or waiting) delivery back in line, due immediately. */
export function retryDelivery(owner: OwnerScope, id: number) {
  const row = getDb()
    .select({ d: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(channels, eq(channels.id, webhookDeliveries.channelId))
    .where(
      owner === null
        ? eq(webhookDeliveries.id, id)
        : and(eq(webhookDeliveries.id, id), eq(channels.owner, owner)),
    )
    .get();
  if (!row) throw notFound('DELIVERY_NOT_FOUND', 'Delivery not found');
  if (row.d.status === 'delivered') throw conflict('ALREADY_DELIVERED', 'Delivery already succeeded');
  const updated = getDb()
    .update(webhookDeliveries)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date() })
    .where(eq(webhookDeliveries.id, id))
    .returning()
    .get();
  wakeWorker();
  return serializeDelivery(updated);
}
