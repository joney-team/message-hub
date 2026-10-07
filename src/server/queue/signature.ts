import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/**
 * Receiver-side check (copy into the main project): header `t=<unix s>,v1=<hex>`,
 * HMAC-SHA256 over `"t.body"`; rejects timestamps further than `toleranceSeconds` away.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null,
  body: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signWebhook(secret, t, body).split('v1=')[1], 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
