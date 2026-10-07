import { requireApiKey } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { getOwnedVisitor, serializeVisitor } from '@/server/services/visitors';

export const dynamic = 'force-dynamic';

export const GET = handle<{ id: string }>((req, { id }) => {
  const owner = requireApiKey(req);
  return json(serializeVisitor(getOwnedVisitor(owner, id).visitor));
});
