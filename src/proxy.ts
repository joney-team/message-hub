import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from './server/db/client';
import { channels } from './server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Who may embed the chat page: `frame-ancestors` from the channel's allowed_origins
 * (empty = anywhere). The `?preview=1` mode creates no visitor and sends nothing, so any
 * page may frame it (the main project's settings screen lives on another origin).
 * Request headers like `Origin` cannot do this job: the iframe's own requests are same-origin.
 */
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const id = req.nextUrl.pathname.split('/')[2] ?? '';
  let ancestors = "'self'";
  if (req.nextUrl.searchParams.get('preview') === '1') {
    ancestors = '*';
  } else if (/^ch_[A-Za-z0-9_-]{22}$/.test(id)) {
    const row = getDb().select({ allowedOrigins: channels.allowedOrigins }).from(channels).where(eq(channels.id, id)).get();
    if (row) ancestors = row.allowedOrigins.length > 0 ? `'self' ${row.allowedOrigins.join(' ')}` : '*';
  }
  res.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
  return res;
}

export const config = { matcher: '/w/:path*' };
