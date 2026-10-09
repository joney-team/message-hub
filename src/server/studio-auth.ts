import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import { getConfig } from './config';
import { getDb } from './db/client';
import { studioCredentials, studioSessions } from './db/schema';
import { hashToken } from './ids';
import { unauthorized } from './http/errors';

export const DEFAULT_STUDIO_PASSWORD = 'messagehub@sayhi';
export const STUDIO_SESSION_COOKIE = 'message_hub_studio';
export const STUDIO_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const CREDENTIAL_ID = 1;
const PASSWORD_PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
  return [
    PASSWORD_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

function verifyHash(password: string, encoded: string): boolean {
  const [prefix, costValue, blockSizeValue, parallelismValue, saltValue, hashValue] = encoded.split('$');
  if (prefix !== PASSWORD_PREFIX || !saltValue || !hashValue) return false;
  try {
    const N = Number(costValue);
    const r = Number(blockSizeValue);
    const p = Number(parallelismValue);
    if (N !== SCRYPT_COST || r !== SCRYPT_BLOCK_SIZE || p !== SCRYPT_PARALLELISM) return false;
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltValue, 'base64url'), expected.length, { N, r, p });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function verifyStudioPassword(password: string): boolean {
  const credential = getDb()
    .select({ passwordHash: studioCredentials.passwordHash })
    .from(studioCredentials)
    .where(eq(studioCredentials.id, CREDENTIAL_ID))
    .get();
  if (credential) return verifyHash(password, credential.passwordHash);

  const matchesDefault = timingSafeEqual(
    Buffer.from(hashToken(password), 'hex'),
    Buffer.from(hashToken(DEFAULT_STUDIO_PASSWORD), 'hex'),
  );
  if (matchesDefault) {
    getDb()
      .insert(studioCredentials)
      .values({ id: CREDENTIAL_ID, passwordHash: passwordHash(DEFAULT_STUDIO_PASSWORD), updatedAt: new Date() })
      .onConflictDoNothing()
      .run();
  }
  return matchesDefault;
}

export function changeStudioPassword(currentPassword: string, newPassword: string): void {
  if (!verifyStudioPassword(currentPassword)) throw unauthorized('Current password is incorrect');
  const nextHash = passwordHash(newPassword);
  const now = new Date();
  getDb()
    .insert(studioCredentials)
    .values({ id: CREDENTIAL_ID, passwordHash: nextHash, updatedAt: now })
    .onConflictDoUpdate({
      target: studioCredentials.id,
      set: { passwordHash: nextHash, updatedAt: now },
    })
    .run();
  getDb().delete(studioSessions).run();
}

export function createStudioSession(now = new Date()): string {
  const token = `st_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(now.getTime() + STUDIO_SESSION_MAX_AGE_SECONDS * 1000);
  getDb().delete(studioSessions).where(lte(studioSessions.expiresAt, now)).run();
  getDb()
    .insert(studioSessions)
    .values({ tokenHash: hashToken(token), expiresAt, createdAt: now })
    .run();
  return token;
}

export function revokeStudioSession(token: string | null): void {
  if (token) getDb().delete(studioSessions).where(eq(studioSessions.tokenHash, hashToken(token))).run();
}

export function studioSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === STUDIO_SESSION_COOKIE) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function requireStudioSession(req: Request, now = new Date()): void {
  const token = studioSessionToken(req);
  if (!token) throw unauthorized();
  const session = getDb()
    .select({ expiresAt: studioSessions.expiresAt })
    .from(studioSessions)
    .where(eq(studioSessions.tokenHash, hashToken(token)))
    .get();
  if (!session || session.expiresAt <= now) {
    revokeStudioSession(token);
    throw unauthorized();
  }
}

export function studioSessionCookie(token: string): string {
  const parts = [
    `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${STUDIO_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    'Priority=High',
  ];
  if (getConfig().isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function expiredStudioSessionCookie(): string {
  return `${STUDIO_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
}
