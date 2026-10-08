import { createHash } from 'node:crypto';
import { ALL_CATALOGS } from '@/i18n/catalog.server';
import { readableOn } from '@/widget/theme';
import { normalizeSettings } from '@/settings';
import { LOADER_FUNCTION } from './loader.min';

const RADIUS = { none: '0px', sm: '6px', md: '12px', lg: '20px' } as const;

type ChannelLike = { id: string; settings: unknown };

/** The data the loader needs to draw the launcher without any network request. */
export function loaderConfig(channel: ChannelLike) {
  const s = normalizeSettings(channel.settings, channel.id);
  const launcherColor = s.launcher.color ?? s.theme.color;
  const strings: Record<string, { open: string; close: string }> = {};
  for (const locale of s.locales) {
    const base = ALL_CATALOGS[locale] ?? ALL_CATALOGS.en;
    const o = s.content.overrides?.[locale] ?? {};
    strings[locale] = { open: o['launcher.open'] ?? base['launcher.open'], close: o['launcher.close'] ?? base['launcher.close'] };
  }
  return {
    channelId: channel.id,
    theme: { color: s.theme.color, fg: readableOn(s.theme.color), radius: RADIUS[s.theme.radius] },
    launcher: {
      color: launcherColor,
      fg: readableOn(launcherColor),
      position: s.launcher.position,
      offset: s.launcher.offset,
      mobileOffset: s.launcher.mobileOffset,
      icon: s.launcher.icon ?? null,
      label: s.launcher.label ?? null,
      hidden: s.launcher.hidden,
      zIndex: s.launcher.zIndex,
    },
    window: s.window,
    locales: s.locales,
    defaultLocale: s.defaultLocale,
    strings,
  };
}

/** JSON that is safe inside a script even if someone pastes it into HTML. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function buildLoader(channel: ChannelLike): { body: string; etag: string } {
  const body = `(${LOADER_FUNCTION})(${safeJson(loaderConfig(channel))});\n`;
  return { body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"` };
}
