import type { CSSProperties } from 'react';
import type { ChannelSettings } from '@/settings/schema';

const RADIUS = { none: '0px', sm: '6px', md: '12px', lg: '20px' } as const;

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): '#ffffff' | '#111827' {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.4 ? '#111827' : '#ffffff';
}

/** Everything a channel can customise becomes a CSS variable; there is no free-form CSS. */
export function themeStyle(theme: ChannelSettings['theme']): CSSProperties {
  const vars: Record<string, string> = {
    '--brand': theme.color,
    '--brand-fg': readableOn(theme.color),
    '--mh-radius': RADIUS[theme.radius],
  };
  if (theme.fontFamily) vars['--mh-font'] = theme.fontFamily;
  return vars as CSSProperties;
}
