import { getConfig } from '../config';
import { tooManyRequests } from './errors';
import { debug } from '../log';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window limiter kept in memory (single instance). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Counts one hit; throws 429 with Retry-After when the window is full. */
  hit(key: string, now: number = Date.now()): void {
    this.sweep(now);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    if (b.count >= this.limit) throw tooManyRequests((b.resetAt - now) / 1000);
    b.count++;
  }

  reset(): void {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}

const g = globalThis as unknown as { __hub_limiters?: Map<string, RateLimiter> };

/** Named limiter shared across route bundles. */
export function limiter(name: string, limit: number, windowMs: number): RateLimiter {
  const all = (g.__hub_limiters ??= new Map());
  let l = all.get(name);
  if (!l) all.set(name, (l = new RateLimiter(limit, windowMs)));
  return l;
}

export function resetLimitersForTests(): void {
  g.__hub_limiters?.forEach((l) => l.reset());
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Client address as written by OUR trusted proxy. Each proxy appends the address of its
 * peer to X-Forwarded-For, so with N trusted proxies the real client is the Nth entry from
 * the END; anything to its left is client-controlled and ignored. Returns null when the
 * address cannot be established (no proxy configured, header missing, too few hops,
 * malformed): callers must not treat "unknown" as one shared identity.
 */
export function clientIp(req: Request): string | null {
  const proxies = getConfig().trustedProxies;
  if (proxies === 0) return null;
  const header = req.headers.get('x-forwarded-for');
  if (!header) return null;
  const hops = header.split(',').map((h) => h.trim());
  if (hops.length < proxies) return null;
  const ip = hops[hops.length - proxies];
  return IP_RE.test(ip) ? ip : null;
}

/**
 * Per-IP limit when the address is known, plus a generous global ceiling that always applies
 * (the only protection when the address is unknown, e.g. TRUSTED_PROXIES=0).
 */
export function limitByIp(name: string, req: Request, perIp: { limit: number; windowMs: number }, globalLimit: number): void {
  const ip = clientIp(req);
  try {
    if (ip) limiter(`${name}:ip`, perIp.limit, perIp.windowMs).hit(ip);
  } catch (err) {
    debug('rate_limit.exceeded', { name, scope: 'ip' });
    throw err;
  }
  try {
    limiter(`${name}:global`, globalLimit, perIp.windowMs).hit('all');
  } catch (err) {
    debug('rate_limit.exceeded', { name, scope: 'global' });
    throw err;
  }
}
