import { z } from 'zod';
import { requireVisitor } from '@/server/http/auth';
import { badRequest, forbidden, handle, json } from '@/server/http/errors';
import { limiter } from '@/server/http/rate-limit';
import { readJson, readQuery } from '@/server/http/validate';
import { normalizeSettings } from '@/settings';
import {
  MAX_ATTACHMENTS,
  MAX_TEXT_LENGTH,
  contextSchema,
  createMessage,
  listMessages,
  resolveAttachments,
  serializeMessage,
} from '@/server/services/messages';
import { touchVisitor } from '@/server/services/sessions';

export const dynamic = 'force-dynamic';

const listQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

const sendBody = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).default(''),
    attachments: z.array(z.object({ fileId: z.string().max(64) }).strict()).max(MAX_ATTACHMENTS).default([]),
    clientMessageId: z.string().regex(/^[\w-]{1,64}$/).optional(),
    context: contextSchema.optional(),
  })
  .strict();

const perVisitor = () => limiter('messages:visitor', 20, 60_000);

export const GET = handle((req) => {
  const { visitor } = requireVisitor(req);
  touchVisitor(visitor);
  return json(listMessages(visitor.id, readQuery(req, listQuery)));
});

export const POST = handle(async (req) => {
  const { visitor, channel } = requireVisitor(req);
  perVisitor().hit(visitor.id);
  const body = await readJson(req, sendBody);
  if (body.attachments.length > 0 && !normalizeSettings(channel.settings, channel.id).features.attachments) {
    throw forbidden('ATTACHMENTS_DISABLED', 'Attachments are disabled for this channel');
  }
  const attachments = resolveAttachments(channel.id, visitor.id, body.attachments.map((a) => a.fileId));
  if (!body.text.trim() && attachments.length === 0) throw badRequest('VALIDATION_ERROR', 'text or attachments is required');
  touchVisitor(visitor);
  const { message, created } = createMessage({
    channel,
    visitor,
    direction: 'inbound',
    text: body.text,
    attachments,
    context: body.context ?? null,
    clientMessageId: body.clientMessageId ?? null,
  });
  return json(serializeMessage(message), { status: created ? 201 : 200 });
});
