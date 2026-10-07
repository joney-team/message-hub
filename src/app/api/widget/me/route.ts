import { requireVisitor } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import { revokeToken, touchVisitor, updateMe, updateMeBody } from '@/server/services/sessions';
import { serializeVisitor } from '@/server/services/visitors';

export const dynamic = 'force-dynamic';

export const GET = handle((req) => {
  const { visitor } = requireVisitor(req);
  touchVisitor(visitor);
  return json({ visitor: serializeVisitor(visitor) });
});

export const PATCH = handle(async (req) => {
  const { visitor, channel } = requireVisitor(req);
  const body = await readJson(req, updateMeBody);
  return json({ visitor: updateMe(visitor, channel, body) });
});

/** Conversation logout: the token stops working. The team keeps the conversation. */
export const DELETE = handle((req) => {
  const { visitor } = requireVisitor(req);
  revokeToken(visitor.id);
  return new Response(null, { status: 204 });
});
