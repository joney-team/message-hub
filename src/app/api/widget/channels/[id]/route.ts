import { createHash } from 'node:crypto';
import { handle, notFound } from '@/server/http/errors';
import { getChannel } from '@/server/services/channels';
import { normalizeSettings } from '@/settings';

export const dynamic = 'force-dynamic';

/** Public, read-only channel config for the chat iframe and the loader. Nothing secret in here. */
export const GET = handle<{ id: string }>((req, { id }) => {
  const channel = getChannel(id);
  if (!channel) throw notFound('CHANNEL_NOT_FOUND', 'Channel not found');
  const body = JSON.stringify({ id: channel.id, name: channel.name, settings: normalizeSettings(channel.settings, channel.id) });
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
});
