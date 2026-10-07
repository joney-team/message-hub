import { isMessageKey } from '@/i18n/catalog.server';
import { isSupportedLocale } from '@/i18n/catalog';
import { ApiError } from '@/server/http/errors';
import { channelSettingsSchema, type ChannelSettings } from './schema';

export { channelSettingsSchema, type ChannelSettings } from './schema';
export type { LocalizedText } from './schema';

export const DEFAULT_SETTINGS: ChannelSettings = channelSettingsSchema.parse({});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Recursive merge for PATCH: objects merge key by key, arrays and primitives
 * replace, `null` removes a key (to unset an optional value).
 */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete out[k];
    else out[k] = deepMerge(out[k], v);
  }
  return out;
}

function fail(message: string): never {
  throw new ApiError(400, 'VALIDATION_ERROR', message);
}

/** Cross-field rules the zod object shape cannot express. */
function checkSemantics(s: ChannelSettings): void {
  for (const l of s.locales) {
    if (!isSupportedLocale(l)) fail(`settings.locales: unsupported locale "${l}"`);
  }
  if (!s.locales.includes(s.defaultLocale)) fail('settings.defaultLocale must be one of settings.locales');
  for (const [locale, strings] of Object.entries(s.content.overrides ?? {})) {
    if (!isSupportedLocale(locale)) fail(`settings.content.overrides: unsupported locale "${locale}"`);
    for (const key of Object.keys(strings)) {
      if (!isMessageKey(key)) fail(`settings.content.overrides.${locale}: unknown message key "${key}"`);
    }
  }
  const seen = new Set<string>();
  for (const f of s.preChat.fields) {
    if (seen.has(f.key)) fail(`settings.preChat.fields: duplicate key "${f.key}"`);
    seen.add(f.key);
  }
}

/** Validates a full or partial object into a complete settings object. Throws ApiError(400). */
export function parseSettings(input: unknown): ChannelSettings {
  const result = channelSettingsSchema.safeParse(input);
  if (!result.success) {
    const msg = result.error.issues
      .slice(0, 5)
      .map((i) => `settings.${i.path.join('.')}: ${i.message}`)
      .join('; ');
    fail(msg);
  }
  checkSemantics(result.data);
  return result.data;
}

/** Applies a partial PATCH over stored settings and validates the result. */
export function applySettingsPatch(current: unknown, patch: unknown): ChannelSettings {
  if (!isPlainObject(patch)) fail('settings must be an object');
  return parseSettings(deepMerge(normalizeSettings(current), patch));
}

const warned = new Set<string>();

export function resetSettingsWarningsForTests(): void {
  warned.clear();
}

/**
 * Reads stored settings. Never throws: anything missing or invalid (older data, hand-edited
 * rows) falls back to defaults so the widget always gets a full object. Only the broken
 * top-level sections fall back; the rest of the channel's settings are kept, and the affected
 * channel is logged once so the damage does not go unnoticed.
 */
export function normalizeSettings(raw: unknown, channelId = 'unknown'): ChannelSettings {
  const input: Record<string, unknown> = isPlainObject(raw) ? { ...raw } : {};
  const dropped = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = channelSettingsSchema.safeParse(input);
    if (result.success) {
      if (dropped.size > 0) warnOnce(channelId, dropped);
      return result.data;
    }
    let removed = false;
    for (const issue of result.error.issues) {
      const bad = issue.code === 'unrecognized_keys' && issue.path.length === 0 ? issue.keys : [String(issue.path[0] ?? '')];
      for (const key of bad) {
        if (key in input) {
          delete input[key];
          dropped.add(key);
          removed = true;
        }
      }
    }
    if (!removed) break;
  }
  warnOnce(channelId, dropped.size ? dropped : new Set(['(all)']));
  return DEFAULT_SETTINGS;
}

function warnOnce(channelId: string, keys: Set<string>): void {
  const id = `${channelId}:${[...keys].sort().join(',')}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[hub] channel ${channelId}: stored settings are invalid in [${[...keys].join(', ')}]; using defaults for them`);
}
