import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { getDb } from '../db/client';
import { channels, messages, visitors } from '../db/schema';
import type { OwnerScope } from '../http/auth';
import { getOwnedChannel } from './channels';
import { serializeMessage } from './messages';
import { serializeVisitor } from './visitors';

export function listConversations(
  owner: OwnerScope,
  opts: { channelId?: string; limit: number; offset: number },
) {
  if (opts.channelId) getOwnedChannel(owner, opts.channelId);

  const latestSeq = max(messages.seq).as('latest_seq');
  const ownerFilter =
    owner === null
      ? opts.channelId
        ? eq(channels.id, opts.channelId)
        : undefined
      : opts.channelId
        ? and(eq(channels.owner, owner), eq(channels.id, opts.channelId))
        : eq(channels.owner, owner);
  const rows = getDb()
    .select({ visitor: visitors, channel: channels, latestSeq })
    .from(visitors)
    .innerJoin(channels, eq(channels.id, visitors.channelId))
    .innerJoin(messages, eq(messages.visitorId, visitors.id))
    .where(ownerFilter)
    .groupBy(visitors.id, channels.id)
    .orderBy(desc(latestSeq), desc(visitors.lastSeenAt))
    .limit(opts.limit + 1)
    .offset(opts.offset)
    .all();

  const page = rows.slice(0, opts.limit);
  const latestMessages = page.length
    ? getDb()
        .select()
        .from(messages)
        .where(inArray(messages.seq, page.map((row) => row.latestSeq!)))
        .all()
    : [];
  const bySeq = new Map(latestMessages.map((message) => [message.seq, message]));

  return {
    data: page.map((row) => ({
      visitor: serializeVisitor(row.visitor),
      channel: {
        id: row.channel.id,
        name: row.channel.name,
        ref: row.channel.ref,
      },
      latestMessage: serializeMessage(bySeq.get(row.latestSeq!)!),
    })),
    hasMore: rows.length > opts.limit,
  };
}
