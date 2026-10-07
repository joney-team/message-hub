import { and, desc, eq, gt, inArray, lt, max } from 'drizzle-orm';
import { z } from 'zod';
import { fileUrl } from '../file-urls';
import { getDb } from '../db/client';
import { files, messages, type Attachment, type MessageContext, type Sender, type visitors, type channels } from '../db/schema';
import { badRequest } from '../http/errors';
import { newId } from '../ids';
import { enqueueEvent, messagePayload, visitorPayload } from '../queue/outbox';
import { wakeWorker } from '../queue/worker';
import { hub } from '../realtime/hub';
import { debug } from '../log';

export type MessageRow = typeof messages.$inferSelect;
type VisitorRow = typeof visitors.$inferSelect;
type ChannelRow = typeof channels.$inferSelect;

export const MAX_TEXT_LENGTH = 4000;
export const MAX_ATTACHMENTS = 10;

export const senderSchema = z
  .object({
    id: z.string().max(200).optional(),
    name: z.string().max(100).optional(),
    avatar: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  })
  .strict();

export const contextSchema = z
  .object({
    url: z.string().max(2048).optional(),
    title: z.string().max(500).optional(),
    referrer: z.string().max(2048).optional(),
  })
  .strict();

export interface AttachmentDto extends Attachment {
  url: string;
}

export interface MessageDto {
  id: string;
  seq: number;
  direction: 'inbound' | 'outbound';
  text: string;
  attachments: AttachmentDto[];
  sender: Sender | null;
  context: MessageContext | null;
  clientMessageId: string | null;
  createdAt: string;
}

export function serializeMessage(m: MessageRow): MessageDto {
  return {
    id: m.id,
    seq: m.seq,
    direction: m.direction,
    text: m.text,
    attachments: m.attachments.map((a) => ({ ...a, url: fileUrl(a.fileId) })),
    sender: m.sender,
    context: m.context,
    clientMessageId: m.clientMessageId,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Turns file ids into attachments. A file must belong to the same channel, and
 * a visitor may only attach files they uploaded themselves.
 */
export function resolveAttachments(channelId: string, visitorId: string | null, fileIds: string[]): Attachment[] {
  if (fileIds.length === 0) return [];
  const unique = [...new Set(fileIds)];
  const rows = getDb().select().from(files).where(and(eq(files.channelId, channelId), inArray(files.id, unique))).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return unique.map((id) => {
    const f = byId.get(id);
    if (!f || (visitorId !== null && f.visitorId !== visitorId)) throw badRequest('FILE_NOT_FOUND', `Unknown file ${id}`);
    return { fileId: f.id, name: f.name, mime: f.mime, size: f.size };
  });
}

export interface NewMessage {
  channel: ChannelRow;
  visitor: VisitorRow;
  direction: 'inbound' | 'outbound';
  text: string;
  attachments: Attachment[];
  sender?: Sender | null;
  context?: MessageContext | null;
  clientMessageId?: string | null;
}

/**
 * Stores a message and notifies the visitor's open streams. Returns the existing
 * row when (visitor, clientMessageId) was already stored, so retries never duplicate.
 */
export function createMessage(input: NewMessage): { message: MessageRow; created: boolean } {
  const db = getDb();
  const result = db.transaction((tx) => {
    if (input.clientMessageId) {
      const existing = tx
        .select()
        .from(messages)
        .where(and(eq(messages.visitorId, input.visitor.id), eq(messages.clientMessageId, input.clientMessageId)))
        .get();
      if (existing) return { message: existing, created: false };
    }
    const message = tx
      .insert(messages)
      .values({
        id: newId('msg'),
        channelId: input.channel.id,
        visitorId: input.visitor.id,
        direction: input.direction,
        text: input.text,
        attachments: input.attachments,
        sender: input.sender ?? null,
        context: input.context ?? null,
        clientMessageId: input.clientMessageId ?? null,
        createdAt: new Date(),
      })
      .returning()
      .get();
    // Same transaction as the message: a stored message can never lose its webhook.
    enqueueEvent(tx, input.channel, 'message.created', {
      message: messagePayload(message),
      visitor: visitorPayload(input.visitor),
    });
    return { message, created: true };
  });
  if (result.created) {
    wakeWorker();
    const dto = serializeMessage(result.message);
    hub.publish(input.visitor.id, { type: 'message', id: dto.seq, data: dto });
    debug('message.created', {
      messageId: result.message.id,
      seq: dto.seq,
      channelId: input.channel.id,
      visitorId: input.visitor.id,
      direction: input.direction,
      attachmentCount: input.attachments.length,
      webhookQueued: Boolean(input.channel.webhookUrl),
    });
  } else {
    debug('message.deduplicated', { messageId: result.message.id, visitorId: input.visitor.id });
  }
  return result;
}

export function listMessages(visitorId: string, opts: { before?: number; limit: number }) {
  const where = opts.before !== undefined ? and(eq(messages.visitorId, visitorId), lt(messages.seq, opts.before)) : eq(messages.visitorId, visitorId);
  const rows = getDb().select().from(messages).where(where).orderBy(desc(messages.seq)).limit(opts.limit + 1).all();
  const page = rows.slice(0, opts.limit).reverse();
  return { data: page.map(serializeMessage), hasMore: rows.length > opts.limit };
}

/** Messages newer than `seq`, oldest first (used to catch a reconnecting stream up). */
export function listMessagesAfter(visitorId: string, seq: number, limit = 200): MessageRow[] {
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.visitorId, visitorId), gt(messages.seq, seq)))
    .orderBy(messages.seq)
    .limit(limit)
    .all();
}

export function latestSeq(visitorId: string): number {
  return getDb().select({ seq: max(messages.seq) }).from(messages).where(eq(messages.visitorId, visitorId)).get()?.seq ?? 0;
}

export function deleteConversation(visitorId: string): number {
  return getDb().delete(messages).where(eq(messages.visitorId, visitorId)).run().changes;
}
