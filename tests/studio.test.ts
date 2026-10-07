import { describe, expect, it } from 'vitest';
import { buildMergePatch, copyChannel, formatApiError, parseOrigins, type ChannelDto } from '@/studio/types';
import { DEFAULT_SETTINGS } from '@/settings';

describe('Channel Studio helpers', () => {
  it('normalizes one allowed origin per line', () => {
    expect(parseOrigins(' https://example.com/ \n\nhttps://*.example.com\r\n')).toEqual([
      'https://example.com/',
      'https://*.example.com',
    ]);
  });

  it('uses API messages when available and falls back to the status', () => {
    expect(formatApiError(400, { error: { message: 'Bad settings' } })).toBe('Bad settings');
    expect(formatApiError(502, null)).toBe('Request failed (502)');
  });

  it('creates an editable deep copy of a channel', () => {
    const original: ChannelDto = {
      id: 'ch_test',
      name: 'Support',
      ref: null,
      webhookUrl: null,
      webhookSecret: 'whsec_test',
      allowedOrigins: ['https://example.com'],
      settings: structuredClone(DEFAULT_SETTINGS),
      embedPath: '/embed/ch_test.js',
      connectedAt: null,
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    };
    const copy = copyChannel(original);
    copy.settings.theme.color = '#112233';
    copy.allowedOrigins.push('https://other.example.com');
    expect(original.settings.theme.color).toBe(DEFAULT_SETTINGS.theme.color);
    expect(original.allowedOrigins).toEqual(['https://example.com']);
  });

  it('uses null for removed optional settings so PATCH clears stored values', () => {
    expect(
      buildMergePatch(
        { theme: { color: '#112233', logo: 'https://example.com/logo.png' }, launcher: { hidden: false } },
        { theme: { color: '#445566' }, launcher: { hidden: false } },
      ),
    ).toEqual({
      theme: { color: '#445566', logo: null },
    });
  });

  it('replaces arrays and omits unchanged settings', () => {
    expect(buildMergePatch({ locales: ['en', 'vi'] }, { locales: ['en'] })).toEqual({ locales: ['en'] });
    expect(buildMergePatch({ theme: { color: '#112233' } }, { theme: { color: '#112233' } })).toBeUndefined();
  });
});
