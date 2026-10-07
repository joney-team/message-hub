import { z } from 'zod';

const MIN_KEY_LENGTH = 16;

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  API_KEYS: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  PORT: z.coerce.number().int().positive().default(4200),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  FILES_BASE_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, ''))
    .optional(),
  PUBLIC_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, ''))
    .optional(),
  TRUSTED_PROXIES: z.coerce.number().int().min(0).max(10).default(1),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
});

export interface ApiKey {
  owner: string;
  key: string;
}

export interface Config {
  isProduction: boolean;
  apiKeys: ApiKey[];
  dataDir: string;
  port: number;
  maxUploadBytes: number;
  filesBaseUrl?: string;
  publicUrl?: string;
  /** Reverse proxies in front of the app that append to X-Forwarded-For (0 = none, header ignored). */
  trustedProxies: number;
  messageRetentionDays: number;
}

export class ConfigError extends Error {}

/** `name:key,name:key` → list. Several keys may share a name (key rotation). */
export function parseApiKeys(raw: string): ApiKey[] {
  const keys: ApiKey[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const i = entry.indexOf(':');
    const owner = i > 0 ? entry.slice(0, i).trim() : '';
    const key = i > 0 ? entry.slice(i + 1).trim() : '';
    if (!owner || !/^[\w.-]+$/.test(owner)) {
      throw new ConfigError('API_KEYS: each entry must look like name:key (name = letters, digits, _ . -)');
    }
    if (key.length < MIN_KEY_LENGTH) {
      // Never echo the key itself: it is a secret.
      throw new ConfigError(`API_KEYS: key for "${owner}" must be at least ${MIN_KEY_LENGTH} characters`);
    }
    keys.push({ owner, key });
  }
  return keys;
}

/** Only used when API_KEYS is unset in development/test; refused in production. */
const DEV_API_KEY = 'dev:dev-only-api-key-change-me';

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ConfigError(`Invalid environment: ${fields}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  let raw = e.API_KEYS?.trim();
  if (!raw) {
    if (isProduction) throw new ConfigError('API_KEYS is required in production (format: name:key,name:key)');
    raw = DEV_API_KEY;
  }
  const apiKeys = parseApiKeys(raw);
  if (apiKeys.length === 0) throw new ConfigError('API_KEYS contains no keys');
  return {
    isProduction,
    apiKeys,
    dataDir: e.DATA_DIR,
    port: e.PORT,
    maxUploadBytes: Math.floor(e.MAX_UPLOAD_MB * 1024 * 1024),
    filesBaseUrl: e.FILES_BASE_URL,
    publicUrl: e.PUBLIC_URL,
    trustedProxies: e.TRUSTED_PROXIES,
    messageRetentionDays: e.MESSAGE_RETENTION_DAYS,
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  return (cached ??= loadConfig());
}

export function resetConfigForTests(): void {
  cached = undefined;
}
