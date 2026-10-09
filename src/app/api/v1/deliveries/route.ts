import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { channels, webhookDeliveries } from '@/server/db/schema';
import { requireManagement } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { pageQuery } from '@/server/http/pagination';
import { readQuery } from '@/server/http/validate';
import { serializeDelivery } from '@/server/services/deliveries';

export const dynamic = 'force-dynamic';

const query = pageQuery.extend({
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
  channelId: z.string().max(64).optional(),
});

export const GET = handle((req) => {
  const owner = requireManagement(req);
  const q = readQuery(req, query);
  const conds = owner === null ? [] : [eq(channels.owner, owner)];
  if (q.status) conds.push(eq(webhookDeliveries.status, q.status));
  if (q.channelId) conds.push(eq(webhookDeliveries.channelId, q.channelId));
  const rows = getDb()
    .select({ d: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(channels, eq(channels.id, webhookDeliveries.channelId))
    .where(and(...conds))
    .orderBy(desc(webhookDeliveries.id))
    .limit(q.limit + 1)
    .offset(q.offset)
    .all();
  return json({ data: rows.slice(0, q.limit).map((r) => serializeDelivery(r.d)), hasMore: rows.length > q.limit });
});
