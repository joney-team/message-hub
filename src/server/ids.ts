import { createHash, randomBytes } from 'node:crypto';

export type IdPrefix = 'ch' | 'vis' | 'msg' | 'file';

/** Unguessable id: prefix + 128 random bits (22 url-safe chars). */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(16).toString('base64url')}`;
}

export const ID_PATTERN = /^(ch|vis|msg|file)_[A-Za-z0-9_-]{22}$/;

export function isId(prefix: IdPrefix, value: string): boolean {
  return value.startsWith(`${prefix}_`) && ID_PATTERN.test(value);
}

/** Visitor bearer token: 256 random bits. Only its SHA-256 is stored. */
export function newVisitorToken(): string {
  return `vt_${randomBytes(32).toString('base64url')}`;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
