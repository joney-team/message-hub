import { requireApiKey } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import { serializeChannel, updateWebhook, updateWebhookBody } from '@/server/services/channels';

export const dynamic = 'force-dynamic';

export const PUT = handle<{ id: string }>(async (req, { id }) => {
  const owner = requireApiKey(req);
  const body = await readJson(req, updateWebhookBody);
  return json(serializeChannel(updateWebhook(owner, id, body)));
});
