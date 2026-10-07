import { getConfig } from '@/server/config';
import { requireVisitor } from '@/server/http/auth';
import { forbidden, handle, json } from '@/server/http/errors';
import { readUpload } from '@/server/http/multipart';
import { limiter } from '@/server/http/rate-limit';
import { saveUpload, serializeFile } from '@/server/services/files';
import { normalizeSettings } from '@/settings';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const { visitor, channel } = requireVisitor(req);
  if (!normalizeSettings(channel.settings, channel.id).features.attachments) throw forbidden('ATTACHMENTS_DISABLED', 'Attachments are disabled for this channel');
  limiter('uploads:visitor', 10, 60_000).hit(visitor.id);
  const { file } = await readUpload(req, getConfig().maxUploadBytes);
  const saved = await saveUpload({ channel, visitorId: visitor.id, file });
  return json(serializeFile(saved), { status: 201 });
});
