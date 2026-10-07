import type { ChannelSettings } from './schema';

/**
 * Plain copy of the zod defaults, so the browser can complete a partial (preview) settings
 * object without bundling zod. A test keeps it identical to `channelSettingsSchema.parse({})`.
 */
export const SETTINGS_DEFAULTS: ChannelSettings = {
  theme: { color: '#1f2937', colorScheme: 'auto', radius: 'md' },
  launcher: { position: 'right', offset: { x: 20, y: 20 }, hidden: false, zIndex: 2147483000 },
  window: { width: 380, height: 640 },
  locales: ['en', 'vi'],
  defaultLocale: 'en',
  content: {},
  preChat: { mode: 'off', fields: [] },
  features: { attachments: true, sound: true },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function merge(base: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = isObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = merge(out[k], v);
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[\w\s,'"-]{1,100}$/;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const httpUrl = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Browser-side completion of unvalidated settings (the live preview sends whatever the
 * form currently holds). Values that end up in CSS or `src` attributes are re-checked.
 */
export function completeSettings(input: unknown): ChannelSettings {
  const s = merge(SETTINGS_DEFAULTS, input) as ChannelSettings;
  s.theme.color = typeof s.theme.color === 'string' && HEX.test(s.theme.color) ? s.theme.color : SETTINGS_DEFAULTS.theme.color;
  s.theme.colorScheme = oneOf(s.theme.colorScheme, ['light', 'dark', 'auto'], 'auto');
  s.theme.radius = oneOf(s.theme.radius, ['none', 'sm', 'md', 'lg'], 'md');
  s.theme.fontFamily = typeof s.theme.fontFamily === 'string' && FONT.test(s.theme.fontFamily) ? s.theme.fontFamily : undefined;
  s.theme.logo = httpUrl(s.theme.logo);
  s.launcher.position = oneOf(s.launcher.position, ['left', 'right'], 'right');
  s.preChat.mode = oneOf(s.preChat.mode, ['off', 'optional', 'required'], 'off');
  if (!Array.isArray(s.preChat.fields)) s.preChat.fields = [];
  if (!Array.isArray(s.locales) || s.locales.length === 0) s.locales = SETTINGS_DEFAULTS.locales;
  if (typeof s.defaultLocale !== 'string' || !s.locales.includes(s.defaultLocale)) s.defaultLocale = s.locales[0];
  return s;
}
