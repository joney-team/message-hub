import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getConfig } from '../config';
import { getDb } from '../db/client';
import { channels, visitors } from '../db/schema';
import { hashToken } from '../ids';
import { unauthorized } from './errors';

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Compares fixed-length digests so neither length nor content leaks via timing. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Admin API: returns the owner name of the matching API key. */
export function requireApiKey(req: Request): string {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  let owner: string | null = null;
  // Check every key (no early exit) so timing does not reveal which one matched.
  for (const entry of getConfig().apiKeys) {
    if (safeEqual(token, entry.key) && owner === null) owner = entry.owner;
  }
  if (!owner) throw unauthorized();
  return owner;
}

export type VisitorRow = typeof visitors.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;

/** Widget API: resolves the visitor (and its channel) from the bearer token. */
export function requireVisitor(req: Request): { visitor: VisitorRow; channel: ChannelRow } {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  const row = getDb()
    .select({ visitor: visitors, channel: channels })
    .from(visitors)
    .innerJoin(channels, eq(channels.id, visitors.channelId))
    .where(eq(visitors.tokenHash, hashToken(token)))
    .get();
  if (!row) throw unauthorized();
  return row;
}
