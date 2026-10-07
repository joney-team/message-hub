import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { visitors, type channels } from '../db/schema';
import { notFound } from '../http/errors';
import { hashToken, newId, newVisitorToken } from '../ids';
import { enqueueEvent, visitorPayload } from '../queue/outbox';
import { hub } from '../realtime/hub';
import { wakeWorker } from '../queue/worker';
import { debug } from '../log';
import { getChannel } from './channels';
import { serializeVisitor, type VisitorDto, type VisitorRow } from './visitors';

type ChannelRow = typeof channels.$inferSelect;

const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const TOUCH_INTERVAL_MS = 60_000;

export const localeSchema = z.string().regex(LOCALE_RE).max(35);

export const profileSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, 'Invalid profile key'), z.union([z.string().max(500), z.number().finite()]))
  .refine((p) => Object.keys(p).length <= 20, 'At most 20 profile fields');

export const createSessionBody = z
  .object({ channelId: z.string().max(64), locale: localeSchema.optional(), profile: profileSchema.optional(), origin: z.string().max(2048).optional() })
  .strict();

export const updateMeBody = z.object({ locale: localeSchema.optional(), profile: profileSchema.optional() }).strict();

/** `https://Shop.example.com/a?b` → `https://shop.example.com`; anything that is not http(s) → null. Informational only. */
export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Keeps a locale only if the channel offers it (`vi-VN` → `vi`). */
export function pickLocale(channel: ChannelRow, requested: string | undefined): string | null {
  if (!requested) return null;
  const enabled = (channel.settings as { locales?: string[] }).locales ?? [];
  const short = requested.split('-')[0].toLowerCase();
  return enabled.find((l) => l === requested) ?? enabled.find((l) => l === short) ?? null;
}

export function createSession(
  channelId: string,
  input: { locale?: string; profile?: Record<string, string | number>; userAgent: string | null; origin?: string },
): { visitor: VisitorDto; token: string } {
  const channel = getChannel(channelId);
  if (!channel) throw notFound('CHANNEL_NOT_FOUND', 'Channel not found');
  const token = newVisitorToken();
  const now = new Date();
  const row = getDb().transaction((tx) => {
    const v = tx
      .insert(visitors)
      .values({
        id: newId('vis'),
        channelId,
        tokenHash: hashToken(token),
        locale: pickLocale(channel, input.locale),
        profile: input.profile ?? {},
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        origin: normalizeOrigin(input.origin),
        lastSeenAt: now,
        createdAt: now,
      })
      .returning()
      .get();
    enqueueEvent(tx, channel, 'visitor.created', { visitor: visitorPayload(v) });
    return v;
  });
  wakeWorker();
  debug('visitor.created', { channelId, visitorId: row.id, webhookQueued: Boolean(channel.webhookUrl) });
  return { visitor: serializeVisitor(row), token };
}

/** Writes `lastSeenAt` at most once a minute per visitor. */
export function touchVisitor(v: VisitorRow): void {
  if (Date.now() - v.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  getDb().update(visitors).set({ lastSeenAt: new Date() }).where(eq(visitors.id, v.id)).run();
}

export function updateMe(
  visitor: VisitorRow,
  channel: ChannelRow,
  input: { locale?: string; profile?: Record<string, string | number> },
): VisitorDto {
  const next = { ...visitor.profile, ...(input.profile ?? {}) };
  const locale = input.locale !== undefined ? (pickLocale(channel, input.locale) ?? visitor.locale) : visitor.locale;
  const changed = JSON.stringify(next) !== JSON.stringify(visitor.profile) || locale !== visitor.locale;
  if (!changed) return serializeVisitor(visitor);
  const row = getDb().transaction((tx) => {
    const v = tx.update(visitors).set({ profile: next, locale, lastSeenAt: new Date() }).where(eq(visitors.id, visitor.id)).returning().get();
    enqueueEvent(tx, channel, 'visitor.updated', { visitor: visitorPayload(v) });
    return v;
  });
  wakeWorker();
  debug('visitor.updated', { channelId: channel.id, visitorId: row.id, webhookQueued: Boolean(channel.webhookUrl) });
  return serializeVisitor(row);
}

/** Invalidates the visitor's token (conversation logout) while keeping the conversation for the team. */
export function revokeToken(visitorId: string): void {
  getDb().update(visitors).set({ tokenHash: hashToken(newVisitorToken()) }).where(eq(visitors.id, visitorId)).run();
  hub.publish(visitorId, { type: 'shutdown' }); // close streams opened with the old token
  debug('visitor.token_revoked', { visitorId });
}
