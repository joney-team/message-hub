import { requireManagement } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { pageQuery } from '@/server/http/pagination';
import { readJson, readQuery } from '@/server/http/validate';
import { createChannel, createChannelBody, listChannels, ownerForNewChannel, serializeChannel } from '@/server/services/channels';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export const GET = handle((req) => {
  const owner = requireManagement(req);
  const q = readQuery(req, pageQuery.extend({ ref: z.string().max(200).optional() }));
  return json(listChannels(owner, q));
});

export const POST = handle(async (req) => {
  const owner = requireManagement(req);
  const body = await readJson(req, createChannelBody);
  return json(serializeChannel(createChannel(ownerForNewChannel(owner), body)), { status: 201 });
});
