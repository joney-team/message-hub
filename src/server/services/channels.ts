import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { channels } from '../db/schema';
import { notFound } from '../http/errors';
import { newId, newWebhookSecret } from '../ids';
import { enqueueEvent } from '../queue/outbox';
import { wakeWorker } from '../queue/worker';
import { fileIdsOfChannel, removeFilesFromDisk } from './files';
import { applySettingsPatch, normalizeSettings, parseSettings } from '@/settings';

export type ChannelRow = typeof channels.$inferSelect;

/** `https://example.com`, `http://localhost:3000`, or a wildcard host `https://*.example.com`. */
const ORIGIN_RE = /^https?:\/\/(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

const origin = z
  .string()
  .max(255)
  .transform((v) => v.trim().toLowerCase().replace(/\/+$/, ''))
  .refine((v) => ORIGIN_RE.test(v), 'Must be an origin like https://example.com (no path)');

const webhookUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const createChannelBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    ref: z.string().trim().max(200).nullish(),
    webhookUrl: webhookUrl.nullish(),
    allowedOrigins: z.array(origin).max(50).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const updateChannelBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    ref: z.string().trim().max(200).nullable().optional(),
    webhookUrl: webhookUrl.nullable().optional(),
    allowedOrigins: z.array(origin).max(50).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export interface ChannelDto {
  id: string;
  name: string;
  ref: string | null;
  webhookUrl: string | null;
  webhookSecret: string;
  allowedOrigins: string[];
  settings: ReturnType<typeof normalizeSettings>;
  embedPath: string;
  connectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeChannel(row: ChannelRow): ChannelDto {
  return {
    id: row.id,
    name: row.name,
    ref: row.ref,
    webhookUrl: row.webhookUrl,
    webhookSecret: row.webhookSecret,
    allowedOrigins: row.allowedOrigins,
    settings: normalizeSettings(row.settings, row.id),
    embedPath: `/embed/${row.id}.js`,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Unknown id and "belongs to another owner" are indistinguishable on purpose. */
export function getOwnedChannel(owner: string, id: string): ChannelRow {
  const row = getDb()
    .select()
    .from(channels)
    .where(and(eq(channels.id, id), eq(channels.owner, owner)))
    .get();
  if (!row) throw notFound('CHANNEL_NOT_FOUND', 'Channel not found');
  return row;
}

export function getChannel(id: string): ChannelRow | undefined {
  return getDb().select().from(channels).where(eq(channels.id, id)).get();
}

export function listChannels(owner: string, opts: { ref?: string; limit: number; offset: number }) {
  const where = opts.ref !== undefined ? and(eq(channels.owner, owner), eq(channels.ref, opts.ref)) : eq(channels.owner, owner);
  const rows = getDb()
    .select()
    .from(channels)
    .where(where)
    .orderBy(desc(channels.createdAt), desc(channels.id))
    .limit(opts.limit + 1)
    .offset(opts.offset)
    .all();
  return { data: rows.slice(0, opts.limit).map(serializeChannel), hasMore: rows.length > opts.limit };
}

export function createChannel(owner: string, body: z.output<typeof createChannelBody>): ChannelRow {
  const now = new Date();
  const row: typeof channels.$inferInsert = {
    id: newId('ch'),
    owner,
    name: body.name,
    ref: body.ref ?? null,
    webhookUrl: body.webhookUrl ?? null,
    webhookSecret: newWebhookSecret(),
    settings: parseSettings(body.settings ?? {}),
    allowedOrigins: body.allowedOrigins ?? [],
    createdAt: now,
    updatedAt: now,
  };
  return getDb().insert(channels).values(row).returning().get();
}

export function updateChannel(owner: string, id: string, body: z.output<typeof updateChannelBody>): ChannelRow {
  const current = getOwnedChannel(owner, id);
  const set: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) set.name = body.name;
  if (body.ref !== undefined) set.ref = body.ref;
  if (body.webhookUrl !== undefined) set.webhookUrl = body.webhookUrl;
  if (body.allowedOrigins !== undefined) set.allowedOrigins = body.allowedOrigins;
  if (body.settings !== undefined) set.settings = applySettingsPatch(current.settings, body.settings);
  return getDb().update(channels).set(set).where(eq(channels.id, id)).returning().get();
}

export function rotateWebhookSecret(owner: string, id: string): ChannelRow {
  getOwnedChannel(owner, id);
  return getDb()
    .update(channels)
    .set({ webhookSecret: newWebhookSecret(), updatedAt: new Date() })
    .where(eq(channels.id, id))
    .returning()
    .get();
}

export function deleteChannel(owner: string, id: string): void {
  getOwnedChannel(owner, id);
  const fileIds = fileIdsOfChannel(id);
  getDb().delete(channels).where(eq(channels.id, id)).run();
  removeFilesFromDisk(fileIds);
}

/** First time the loader is fetched for a channel: record it and tell the main project. */
export function markConnected(channel: ChannelRow): void {
  if (channel.connectedAt) return;
  const now = new Date();
  const changed = getDb().transaction((tx) => {
    const res = tx.update(channels).set({ connectedAt: now }).where(and(eq(channels.id, channel.id), isNull(channels.connectedAt))).run();
    if (res.changes === 0) return false;
    enqueueEvent(tx, channel, 'channel.connected', { connectedAt: now.toISOString() });
    return true;
  });
  if (changed) wakeWorker();
}
