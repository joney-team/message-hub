import { buildLoader } from '@/loader/build';
import { getChannel, markConnected } from '@/server/services/channels';

export const dynamic = 'force-dynamic';

const FILE_RE = /^(ch_[A-Za-z0-9_-]{22})\.js$/;

/**
 * `<script src="https://message-hub.example.com/embed/ch_xxx.js">`: the loader plus this channel's launcher
 * settings baked in, so the host page never has to call an API (no CORS, no connect-src).
 */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const match = FILE_RE.exec(file);
  const channel = match ? getChannel(match[1]) : undefined;
  if (!channel) return new Response('Unknown channel', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  markConnected(channel);
  const { body, etag } = buildLoader(channel);
  const headers = {
    ETag: etag,
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'public, no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
