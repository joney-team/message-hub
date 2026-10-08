import { z } from 'zod';
import { requireApiKey } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { readQuery } from '@/server/http/validate';
import { listConversations } from '@/server/services/conversations';

export const dynamic = 'force-dynamic';

const listQuery = z.object({
  channelId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = handle((req) => {
  const owner = requireApiKey(req);
  return json(listConversations(owner, readQuery(req, listQuery)));
});
