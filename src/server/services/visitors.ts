import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { channels, visitors } from '../db/schema';
import type { OwnerScope } from '../http/auth';
import { notFound } from '../http/errors';
import { getOwnedChannel } from './channels';

export type VisitorRow = typeof visitors.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;

export interface VisitorDto {
  id: string;
  channelId: string;
  locale: string | null;
  profile: Record<string, string | number>;
  userAgent: string | null;
  origin: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export function serializeVisitor(v: VisitorRow): VisitorDto {
  return {
    id: v.id,
    channelId: v.channelId,
    locale: v.locale,
    profile: v.profile,
    userAgent: v.userAgent,
    origin: v.origin,
    lastSeenAt: v.lastSeenAt.toISOString(),
    createdAt: v.createdAt.toISOString(),
  };
}

export function listVisitors(owner: OwnerScope, channelId: string, opts: { limit: number; offset: number }) {
  getOwnedChannel(owner, channelId);
  const rows = getDb()
    .select()
    .from(visitors)
    .where(eq(visitors.channelId, channelId))
    .orderBy(desc(visitors.lastSeenAt), desc(visitors.id))
    .limit(opts.limit + 1)
    .offset(opts.offset)
    .all();
  return { data: rows.slice(0, opts.limit).map(serializeVisitor), hasMore: rows.length > opts.limit };
}

/** Visitor of a channel owned by `owner`; anything else is a 404. */
export function getOwnedVisitor(owner: OwnerScope, id: string): { visitor: VisitorRow; channel: ChannelRow } {
  const row = getDb()
    .select({ visitor: visitors, channel: channels })
    .from(visitors)
    .innerJoin(channels, eq(channels.id, visitors.channelId))
    .where(owner === null ? eq(visitors.id, id) : and(eq(visitors.id, id), eq(channels.owner, owner)))
    .get();
  if (!row) throw notFound('VISITOR_NOT_FOUND', 'Visitor not found');
  return row;
}
