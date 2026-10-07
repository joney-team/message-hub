import { requireApiKey } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import { deleteChannel, getOwnedChannel, serializeChannel, updateChannel, updateChannelBody } from '@/server/services/channels';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = handle<P>((req, { id }) => {
  const owner = requireApiKey(req);
  return json(serializeChannel(getOwnedChannel(owner, id)));
});

export const PATCH = handle<P>(async (req, { id }) => {
  const owner = requireApiKey(req);
  const body = await readJson(req, updateChannelBody);
  return json(serializeChannel(updateChannel(owner, id, body)));
});

export const DELETE = handle<P>((req, { id }) => {
  const owner = requireApiKey(req);
  deleteChannel(owner, id);
  return new Response(null, { status: 204 });
});
