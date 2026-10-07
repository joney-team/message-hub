import { limitByIp } from '@/server/http/rate-limit';
import { handle, json } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import { createSession, createSessionBody } from '@/server/services/sessions';

export const dynamic = 'force-dynamic';

/** The token is returned once; only its hash is stored. */
export const POST = handle(async (req) => {
  limitByIp('sessions', req, { limit: 20, windowMs: 60_000 }, 300);
  const body = await readJson(req, createSessionBody);
  const session = createSession(body.channelId, { locale: body.locale, profile: body.profile, origin: body.origin, userAgent: req.headers.get('user-agent') });
  return json(session, { status: 201 });
});
