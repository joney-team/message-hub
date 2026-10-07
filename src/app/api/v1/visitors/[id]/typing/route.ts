import { z } from 'zod';
import { requireApiKey } from '@/server/http/auth';
import { handle, json } from '@/server/http/errors';
import { readJson } from '@/server/http/validate';
import { hub } from '@/server/realtime/hub';
import { senderSchema } from '@/server/services/messages';
import { getOwnedVisitor } from '@/server/services/visitors';

export const dynamic = 'force-dynamic';

const body = z.object({ sender: senderSchema.optional() }).strict();

/** Not stored: only reaches visitors that currently have the chat open. */
export const POST = handle<{ id: string }>(async (req, { id }) => {
  const owner = requireApiKey(req);
  getOwnedVisitor(owner, id);
  const { sender } = await readJson(req, body);
  hub.publish(id, { type: 'typing', data: { sender: sender ?? null } });
  return json({ ok: true });
});
