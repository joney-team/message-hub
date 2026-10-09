import { getConfig } from '@/server/config';
import { requireManagement } from '@/server/http/auth';
import { badRequest, handle, json } from '@/server/http/errors';
import { readUpload } from '@/server/http/multipart';
import { limiter } from '@/server/http/rate-limit';
import { getOwnedChannel } from '@/server/services/channels';
import { saveUpload, serializeFile } from '@/server/services/files';

export const dynamic = 'force-dynamic';

/** multipart/form-data with `channelId` and `file`; attach the result to a reply with `attachments: [{ fileId }]`. */
export const POST = handle(async (req) => {
  const owner = requireManagement(req);
  limiter('uploads:owner', 60, 60_000).hit(owner ?? 'studio');
  const { file, fields } = await readUpload(req, getConfig().maxUploadBytes);
  if (!fields.channelId) throw badRequest('VALIDATION_ERROR', 'channelId is required');
  const channel = getOwnedChannel(owner, fields.channelId);
  const saved = await saveUpload({ channel, visitorId: null, file });
  return json(serializeFile(saved), { status: 201 });
});
