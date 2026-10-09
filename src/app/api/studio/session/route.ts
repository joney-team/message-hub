import { z } from 'zod';
import { handle, json, unauthorized } from '@/server/http/errors';
import { limitByIp } from '@/server/http/rate-limit';
import { readJson } from '@/server/http/validate';
import {
  createStudioSession,
  expiredStudioSessionCookie,
  requireStudioSession,
  revokeStudioSession,
  studioSessionCookie,
  studioSessionToken,
  verifyStudioPassword,
} from '@/server/studio-auth';

export const dynamic = 'force-dynamic';

const loginBody = z.object({ password: z.string().min(1).max(200) }).strict();

export const GET = handle((req) => {
  requireStudioSession(req);
  return json({ authenticated: true });
});

export const POST = handle(async (req) => {
  limitByIp('studio-login', req, { limit: 10, windowMs: 15 * 60_000 }, 100);
  const { password } = await readJson(req, loginBody);
  if (!verifyStudioPassword(password)) throw unauthorized('Incorrect password');
  const token = createStudioSession();
  return json(
    { authenticated: true },
    { headers: { 'Set-Cookie': studioSessionCookie(token) } },
  );
});

export const DELETE = handle((req) => {
  revokeStudioSession(studioSessionToken(req));
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': expiredStudioSessionCookie(),
    },
  });
});
