import { z } from 'zod';
import { handle, json } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import {
  changeStudioPassword,
  createStudioSession,
  requireStudioSession,
  studioSessionCookie,
} from '@/server/studio-auth';

export const dynamic = 'force-dynamic';

const body = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
  })
  .strict();

export const PUT = handle(async (req) => {
  requireStudioSession(req);
  const input = await readJson(req, body);
  changeStudioPassword(input.currentPassword, input.newPassword);
  const token = createStudioSession();
  return json(
    { changed: true },
    { headers: { 'Set-Cookie': studioSessionCookie(token) } },
  );
});
