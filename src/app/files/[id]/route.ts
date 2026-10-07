import fs from 'node:fs';
import { Readable } from 'node:stream';
import { findServedFile } from '@/server/services/files';

export const dynamic = 'force-dynamic';

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

function disposition(kind: 'inline' | 'attachment', name: string): string {
  return `${kind}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/**
 * Serves an upload. The content type comes from the database (decided at upload),
 * never from the file name; `nosniff` + a locked-down CSP make sure it can never run
 * as a page, and only image/audio/video are shown inline.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const served = findServedFile(id);
  if (!served) return notFound();
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(served.path, 'r');
  } catch {
    return notFound();
  }
  const stream = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': served.row.mime,
      'Content-Length': String(served.row.size),
      'Content-Disposition': disposition(served.inline ? 'inline' : 'attachment', served.row.name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
