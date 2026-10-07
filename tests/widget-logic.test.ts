import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { LOCALES, LOADERS, SUPPORTED_LOCALES } from '@/i18n/catalog';
import { ALL_CATALOGS } from '@/i18n/catalog.server';
import { chatReducer, initialChatState, lastSeq, upsert } from '@/widget/reducer';
import { tokenize } from '@/widget/linkify';
import { SseParser } from '@/widget/sse';
import { readableOn, themeStyle } from '@/widget/theme';
import { DEFAULT_SETTINGS } from '@/settings';
import type { ChatMessage, ServerMessage } from '@/widget/types';

const msg = (seq: number, over: Partial<ServerMessage> = {}): ServerMessage => ({
  id: `msg_${seq}`,
  seq,
  direction: 'outbound',
  text: `m${seq}`,
  attachments: [],
  sender: null,
  clientMessageId: null,
  createdAt: new Date(seq * 1000).toISOString(),
  ...over,
});
const local = (cid: string, over: Partial<ChatMessage> = {}): ChatMessage => msg(0, { id: `local_${cid}`, direction: 'inbound', clientMessageId: cid, text: cid, ...over }) as ChatMessage;

describe('linkify', () => {
  it('turns http(s) URLs into links and leaves everything else as text', () => {
    expect(tokenize('see https://example.com/a?b=1, ok')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: ', ok' },
    ]);
    expect(tokenize('www.example.com.')).toEqual([{ type: 'link', value: 'www.example.com', href: 'https://www.example.com/' }, { type: 'text', value: '.' }]);
  });

  it('never produces javascript:, data: or other schemes', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>', 'ftp://x.test']) {
      expect(tokenize(text).every((t) => t.type === 'text'), text).toBe(true);
    }
  });

  it('keeps markup as inert text', () => {
    const t = tokenize('<img src=x onerror=alert(1)> https://ok.test');
    expect(t[0]).toEqual({ type: 'text', value: '<img src=x onerror=alert(1)> ' });
    expect(t[1]).toMatchObject({ type: 'link', href: 'https://ok.test/' });
  });

  it('handles parentheses around and inside URLs', () => {
    expect(tokenize('(https://a.test/x)')[1]).toMatchObject({ value: 'https://a.test/x' });
    expect(tokenize('https://en.wikipedia.org/wiki/Foo_(bar)')[0]).toMatchObject({ value: 'https://en.wikipedia.org/wiki/Foo_(bar)' });
  });

  it('is lossless', () => {
    const text = 'a https://x.test b\nc www.y.test/z) d';
    expect(tokenize(text).map((t) => t.value).join('')).toBe(text);
  });
});

describe('SseParser', () => {
  it('parses frames split across chunks, comments and ids', () => {
    const p = new SseParser();
    expect(p.push('retry: 3000\n\n: connected\n\nid: 5\nevent: mess')).toEqual([]);
    const frames = p.push('age\ndata: {"a":1}\n\nevent: typing\ndata: {}\n\n');
    expect(frames).toEqual([
      { id: '5', event: 'message', data: '{"a":1}' },
      { id: '5', event: 'typing', data: '{}' },
    ]);
  });

  it('reports retry and handles CRLF', () => {
    let retry = 0;
    const p = new SseParser((ms) => (retry = ms));
    const f = p.push('retry: 1500\r\nid: 2\r\ndata: x\r\n\r\n');
    expect(retry).toBe(1500);
    expect(f).toEqual([{ id: '2', event: 'message', data: 'x' }]);
  });
});

describe('chat reducer', () => {
  it('replaces an optimistic message with its echo (by clientMessageId) without duplicating', () => {
    let s = chatReducer(initialChatState, { type: 'loaded', messages: [msg(1)], hasMore: false });
    s = chatReducer(s, { type: 'optimistic', message: local('c1') });
    expect(s.messages.map((m) => m.id)).toEqual(['msg_1', 'local_c1']);
    s = chatReducer(s, { type: 'incoming', message: msg(2, { id: 'msg_2', direction: 'inbound', clientMessageId: 'c1', text: 'c1' }) });
    expect(s.messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2']);
    s = chatReducer(s, { type: 'incoming', message: msg(2, { id: 'msg_2', direction: 'inbound', clientMessageId: 'c1', text: 'c1' }) });
    expect(s.messages).toHaveLength(2);
  });

  it('inserts server messages before still-pending local ones', () => {
    const list = upsert([msg(1), local('c1')], msg(2));
    expect(list.map((m) => m.id)).toEqual(['msg_1', 'msg_2', 'local_c1']);
  });

  it('marks failures and retries, and clears typing when the agent replies', () => {
    let s = chatReducer(initialChatState, { type: 'optimistic', message: local('c1', { status: 'sending' }) });
    s = chatReducer(s, { type: 'failed', clientMessageId: 'c1' });
    expect(s.messages[0].status).toBe('failed');
    s = chatReducer(s, { type: 'retrying', clientMessageId: 'c1' });
    expect(s.messages[0].status).toBe('sending');
    s = chatReducer(s, { type: 'typing', sender: { name: 'Ann' } });
    s = chatReducer(s, { type: 'incoming', message: msg(3) });
    expect(s.typing).toBeNull();
  });

  it('prepends older pages without duplicates and tracks hasMore', () => {
    let s = chatReducer(initialChatState, { type: 'loaded', messages: [msg(3), msg(4)], hasMore: true });
    s = chatReducer(s, { type: 'olderLoaded', messages: [msg(2), msg(3)], hasMore: false });
    expect(s.messages.map((m) => m.seq)).toEqual([2, 3, 4]);
    expect(s.hasMore).toBe(false);
    expect(lastSeq(s.messages)).toBe(4);
  });

  it('keeps messages typed while history was still loading', () => {
    let s = chatReducer(initialChatState, { type: 'optimistic', message: local('early') });
    s = chatReducer(s, { type: 'loaded', messages: [msg(1)], hasMore: false });
    expect(s.messages.map((m) => m.id)).toEqual(['msg_1', 'local_early']);
  });
});

describe('theme', () => {
  it('picks readable foreground colours', () => {
    expect(readableOn('#ffffff')).toBe('#111827');
    expect(readableOn('#1f2937')).toBe('#ffffff');
    expect(readableOn('#ffd400')).toBe('#111827');
    expect(readableOn('#0057ff')).toBe('#ffffff');
  });

  it('maps settings to CSS variables only', () => {
    const style = themeStyle({ ...DEFAULT_SETTINGS.theme, color: '#0057ff', radius: 'lg', fontFamily: 'Georgia, serif' }) as Record<string, string>;
    expect(style).toEqual({ '--brand': '#0057ff', '--brand-fg': '#ffffff', '--mh-radius': '20px', '--mh-font': 'Georgia, serif' });
  });
});

describe('settings defaults for the browser', () => {
  it('SETTINGS_DEFAULTS is identical to the zod defaults', async () => {
    const { SETTINGS_DEFAULTS } = await import('@/settings/defaults');
    expect(SETTINGS_DEFAULTS).toEqual(DEFAULT_SETTINGS);
  });

  it('completeSettings fills gaps and rejects unsafe values from a preview', async () => {
    const { completeSettings, SETTINGS_DEFAULTS } = await import('@/settings/defaults');
    expect(completeSettings(undefined)).toEqual(SETTINGS_DEFAULTS);
    const s = completeSettings({ theme: { color: 'red;}body{display:none', radius: 'huge', logo: 'javascript:alert(1)', fontFamily: 'x;}' }, preChat: { mode: 'weird', fields: 'nope' }, locales: [], defaultLocale: 'xx' });
    expect(s.theme).toMatchObject({ color: '#1f2937', radius: 'md', colorScheme: 'auto' });
    expect(s.theme.logo).toBeUndefined();
    expect(s.theme.fontFamily).toBeUndefined();
    expect(s.preChat).toEqual({ mode: 'off', fields: [] });
    expect(s.locales).toEqual(['en', 'vi']);
    expect(s.defaultLocale).toBe('en');
    expect(completeSettings({ theme: { color: '#112233' }, launcher: { hidden: true } }).launcher).toMatchObject({ hidden: true, position: 'right' });
    expect(completeSettings({ launcher: { offset: { x: -1, y: 30 }, mobileOffset: { x: 24, y: 401 } } }).launcher).toMatchObject({
      offset: { x: 20, y: 30 },
      mobileOffset: { x: 24, y: 16 },
    });
  });
});

describe('i18n', () => {
  it('resolves the locale in the documented order', async () => {
    const { resolveLocale } = await import('@/i18n');
    const base = { enabled: ['en', 'vi'], defaultLocale: 'en' };
    expect(resolveLocale({ ...base, explicit: 'vi', htmlLang: 'en', navigatorLanguages: ['en-US'] })).toBe('vi');
    expect(resolveLocale({ ...base, htmlLang: 'vi-VN', navigatorLanguages: ['en-US'] })).toBe('vi');
    expect(resolveLocale({ ...base, htmlLang: 'fr', navigatorLanguages: ['de', 'vi'] })).toBe('vi');
    expect(resolveLocale({ ...base, htmlLang: 'fr', navigatorLanguages: ['de'], defaultLocale: 'vi' })).toBe('vi');
    expect(resolveLocale({ enabled: ['en'], defaultLocale: 'en', explicit: 'vi' })).toBe('en'); // not enabled for this channel
  });

  it.each([
    ['ko', 'ko-KR'],
    ['zh', 'zh-CN'],
    ['ja', 'ja-JP'],
    ['th', 'th-TH'],
    ['fr', 'fr-FR'],
    ['ru', 'ru-RU'],
  ])('resolves regional %s from explicit, host and browser preferences only when enabled', async (locale, regional) => {
    const { resolveLocale } = await import('@/i18n');
    const base = { enabled: ['en', locale], defaultLocale: 'en' };
    expect(resolveLocale({ ...base, explicit: regional.toUpperCase().replace('-', '_'), htmlLang: 'en' })).toBe(locale);
    expect(resolveLocale({ ...base, htmlLang: regional, navigatorLanguages: ['en'] })).toBe(locale);
    expect(resolveLocale({ ...base, navigatorLanguages: ['xx', regional] })).toBe(locale);
    expect(resolveLocale({ ...base, defaultLocale: locale })).toBe(locale);
    expect(resolveLocale({ enabled: ['en', 'vi'], defaultLocale: 'en', explicit: regional })).toBe('en');
  });

  it('translates with channel override → locale catalog → English, params and no HTML', async () => {
    const { createTranslator, loadCatalogs } = await import('@/i18n');
    const catalogs = await loadCatalogs('vi');
    const t = createTranslator(catalogs, { 'composer.send': 'Gửi ngay' });
    expect(t('composer.send')).toBe('Gửi ngay');
    expect(t('composer.placeholder')).toBe('Nhập tin nhắn…');
    expect(t('chat.typing', { name: 'Ann' })).toBe('Ann đang soạn tin…');
    const withGap = createTranslator({ primary: {}, fallback: catalogs.fallback });
    expect(withGap('composer.send')).toBe('Send');
    expect(createTranslator(catalogs)('chat.typing', { name: '<b>x</b>' })).toContain('<b>x</b>'); // stays text; React escapes it
  });

  it('localizes channel text with fallback to the default locale', async () => {
    const { localize } = await import('@/i18n');
    const text = { en: 'Hello', vi: 'Xin chào' };
    expect(localize(text, 'vi', 'en')).toBe('Xin chào');
    expect(localize(text, 'vi-VN', 'en')).toBe('Xin chào');
    expect(localize({ en: 'Hello' }, 'vi', 'en')).toBe('Hello');
    expect(localize({ vi: ' ' }, 'vi', 'en')).toBeUndefined();
    expect(localize(undefined, 'vi', 'en')).toBeUndefined();
  });

  it('registers every catalog in the client and server, matching Acme content languages', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'vi', 'ko', 'zh', 'ja', 'th', 'fr', 'ru']);
    const codes = [...SUPPORTED_LOCALES].sort();
    expect(new Set(codes).size).toBe(codes.length);
    expect(Object.keys(LOADERS).sort()).toEqual(codes);
    expect(Object.keys(ALL_CATALOGS).sort()).toEqual(codes);
    expect(readdirSync(new URL('../src/i18n/messages/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()).toEqual(codes);
  });

  it.each(LOCALES)('$code has exactly the English keys and placeholders, with matching lazy and server catalogs', async ({ code, name, dir }) => {
    const { loadCatalogs, localeInfo, createTranslator } = await import('@/i18n');
    const en = ALL_CATALOGS.en;
    const { primary, fallback } = await loadCatalogs(code);
    expect(primary).toEqual(ALL_CATALOGS[code]);
    expect(fallback).toEqual(en);
    expect(Object.keys(primary).sort()).toEqual(Object.keys(en).sort());
    const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en)) {
      expect(primary[key].trim(), `${code}:${key}`).not.toBe('');
      expect(params(primary[key]), `${code}:${key}`).toEqual(params(en[key]));
    }
    expect(localeInfo(code)).toEqual({ code, name, dir });
    expect(createTranslator({ primary, fallback })('chat.typing', { name: '<b>Ann</b>' })).toContain('<b>Ann</b>');
    expect(createTranslator({ primary, fallback }, { 'composer.send': 'Custom send' })('composer.send')).toBe('Custom send');
  });

  it.each([
    ['ko', '보내기'],
    ['zh', '发送'],
    ['ja', '送信'],
    ['th', 'ส่ง'],
    ['fr', 'Envoyer'],
    ['ru', 'Отправить'],
  ])('uses the %s translation instead of the English fallback', async (code, send) => {
    const { loadCatalogs, createTranslator } = await import('@/i18n');
    expect(createTranslator(await loadCatalogs(code))('composer.send')).toBe(send);
  });

  it('loads English for an unsupported locale', async () => {
    const { loadCatalogs } = await import('@/i18n');
    expect(await loadCatalogs('xx')).toEqual({ primary: ALL_CATALOGS.en, fallback: ALL_CATALOGS.en });
  });

  it.each(LOCALES)('formats dates and sizes in $code', async ({ code }) => {
    const { formatTime, formatDay, formatBytes } = await import('@/i18n');
    const now = new Date(2026, 9, 7, 12);
    expect(formatTime(now, code)).toBe(new Intl.DateTimeFormat(code, { timeStyle: 'short' }).format(now));
    expect(formatDay(now, code, now)).toBe(new Intl.RelativeTimeFormat(code, { numeric: 'auto' }).format(0, 'day'));
    expect(formatBytes(1536, code)).toBe(new Intl.NumberFormat(code, { style: 'unit', unit: 'kilobyte', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(1.5));
  });

  it('formats times, days and sizes per locale', async () => {
    const { formatDay, formatBytes } = await import('@/i18n');
    const now = new Date(2026, 9, 7, 12).getTime();
    expect(formatDay(new Date(2026, 9, 7, 8), 'en', now)).toBe('today');
    expect(formatDay(new Date(2026, 9, 6, 8), 'vi', now)).toMatch(/hôm qua/i);
    expect(formatDay(new Date(2026, 8, 1), 'en', now)).toMatch(/Sep/);
    expect(formatBytes(1536, 'en')).toMatch(/1\.5\s?kB/);
  });
});

describe('unread count for a returning visitor', () => {
  it('counts only agent messages newer than what was read', async () => {
    const { computeUnread } = await import('@/widget/unread');
    const m = [msg(1, { direction: 'outbound' }), msg(2, { direction: 'inbound' }), msg(3, { direction: 'outbound' }), msg(4, { direction: 'outbound' })];
    expect(computeUnread(m, 1)).toEqual({ unread: 2, maxSeq: 4 });
    expect(computeUnread(m, 4)).toEqual({ unread: 0, maxSeq: 4 });
    expect(computeUnread(m, 0)).toEqual({ unread: 3, maxSeq: 4 });
  });

  it('with nothing stored yet, everything already in history counts as read', async () => {
    const { computeUnread } = await import('@/widget/unread');
    expect(computeUnread([msg(1), msg(2)], null)).toEqual({ unread: 0, maxSeq: 2 });
    expect(computeUnread([], null)).toEqual({ unread: 0, maxSeq: 0 });
  });
});
