import { requireManagement } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { rotateWebhookSecret, serializeChannel } from '@/server/services/channels';

export const dynamic = 'force-dynamic';

export const POST = handle<{ id: string }>((req, { id }) => {
  const owner = requireManagement(req);
  return json(serializeChannel(rotateWebhookSecret(owner, id)));
});
