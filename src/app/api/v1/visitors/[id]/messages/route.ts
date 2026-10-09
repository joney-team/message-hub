import { z } from 'zod';
import { requireManagement } from '@/server/http/auth';
import { badRequest, handle, json } from '@/server/http/errors';
import { readJson, readQuery } from '@/server/http/validate';
import {
  MAX_ATTACHMENTS,
  MAX_TEXT_LENGTH,
  createMessage,
  deleteConversation,
  listMessages,
  resolveAttachments,
  senderSchema,
  serializeMessage,
} from '@/server/services/messages';
import { getOwnedVisitor } from '@/server/services/visitors';

export const dynamic = 'force-dynamic';

type P = { id: string };

const listQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

const sendBody = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).default(''),
    attachments: z.array(z.object({ fileId: z.string().max(64) }).strict()).max(MAX_ATTACHMENTS).default([]),
    sender: senderSchema.optional(),
  })
  .strict();

export const GET = handle<P>((req, { id }) => {
  const owner = requireManagement(req);
  getOwnedVisitor(owner, id);
  return json(listMessages(id, readQuery(req, listQuery)));
});

export const POST = handle<P>(async (req, { id }) => {
  const owner = requireManagement(req);
  const { visitor, channel } = getOwnedVisitor(owner, id);
  const body = await readJson(req, sendBody);
  const attachments = resolveAttachments(channel.id, null, body.attachments.map((a) => a.fileId));
  if (!body.text.trim() && attachments.length === 0) throw badRequest('VALIDATION_ERROR', 'text or attachments is required');
  const { message } = createMessage({ channel, visitor, direction: 'outbound', text: body.text, attachments, sender: body.sender ?? null });
  return json(serializeMessage(message), { status: 201 });
});

export const DELETE = handle<P>((req, { id }) => {
  const owner = requireManagement(req);
  getOwnedVisitor(owner, id);
  deleteConversation(id);
  return new Response(null, { status: 204 });
});
