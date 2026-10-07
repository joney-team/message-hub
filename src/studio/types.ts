import type { ChannelSettings } from '@/settings/schema';

export interface ChannelDto {
  id: string;
  name: string;
  ref: string | null;
  webhookUrl: string | null;
  webhookSecret: string;
  allowedOrigins: string[];
  settings: ChannelSettings;
  embedPath: string;
  connectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioMeta {
  version: string;
  apiVersion: string;
  locales: Array<{ code: string; name: string; dir: 'ltr' | 'rtl' }>;
  messages: Record<string, Record<string, string>>;
}

export interface DeliveryDto {
  id: number;
  channelId: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextAttemptAt: string;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export function copyChannel(channel: ChannelDto): ChannelDto {
  return structuredClone(channel);
}

export function parseOrigins(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function formatApiError(status: number, body: ApiErrorBody | null): string {
  return body?.error?.message || `Request failed (${status})`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Builds the recursive PATCH shape expected by `applySettingsPatch`.
 * Removed keys must be explicit `null`; JSON would otherwise drop `undefined`
 * and leave the old server value in place.
 */
export function buildMergePatch(before: unknown, after: unknown): unknown {
  if (isRecord(before) && isRecord(after)) {
    const patch: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) {
        patch[key] = null;
        continue;
      }
      const child = buildMergePatch(before[key], after[key]);
      if (child !== undefined) patch[key] = child;
    }
    return Object.keys(patch).length ? patch : undefined;
  }
  return JSON.stringify(before) === JSON.stringify(after) ? undefined : after;
}
