// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOADER_FUNCTION } from '@/loader/loader.min';
import { buildLoader, loaderConfig, safeJson } from '@/loader/build';
import { DEFAULT_SETTINGS } from '@/settings';
import { ALL_CATALOGS } from '@/i18n/catalog.server';

const HUB = 'https://hub.example.com';
const CHANNEL = 'ch_' + 'a'.repeat(22);

const config = (settings: unknown = {}) => loaderConfig({ id: CHANNEL, settings });

type Api = {
  open(): void;
  close(): void;
  toggle(): void;
  setLocale(l: string | null): void;
  setLauncherPosition(position: { position?: 'left' | 'right'; x?: number; y?: number }): void;
  setLauncherVisible(visible: boolean): void;
  setLauncherZIndex(zIndex: number): void;
  identify(p: unknown): void;
  on(n: string, f: (p?: unknown) => void): () => void;
  destroy(): void;
  init(o?: object): void;
};
const hubApi = () => (window as unknown as { MessageHub: Api }).MessageHub;

/** Runs the real minified loader the way the browser would run `<script src=HUB/embed/ch.js>`. */
function load(cfg = config(), attrs: Record<string, string> = {}) {
  const tag = document.createElement('script');
  tag.src = `${HUB}/embed/${CHANNEL}.js`;
  for (const [k, v] of Object.entries(attrs)) tag.setAttribute(k, v);
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => tag });
  new Function(`(${LOADER_FUNCTION})(${safeJson(cfg)})`)();
}

const root = () => document.getElementById('message-hub-root');
const shadow = () => root()!.shadowRoot!;
const button = () => shadow().querySelector('button')!;
const frame = () => shadow().querySelector('iframe');

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  localStorage.clear();
  setViewportWidth(1024);
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

describe('loader constraints', () => {
  it('draws the launcher without fetch, XHR, <style> or style attribute strings', () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    const setAttr = vi.spyOn(Element.prototype, 'setAttribute');
    load();
    expect(button()).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('style').length + shadow().querySelectorAll('style').length).toBe(0);
    expect(setAttr.mock.calls.filter(([n]) => n === 'style')).toHaveLength(0);
    expect(LOADER_FUNCTION).not.toMatch(/fetch\(|XMLHttpRequest|createElement\(["']style|cssText|insertRule|adoptedStyleSheets/);
    vi.unstubAllGlobals();
  });

  it('is small', () => {
    expect(LOADER_FUNCTION.length).toBeLessThan(12_000);
    expect(buildLoader({ id: CHANNEL, settings: {} }).body.length).toBeLessThan(14_000);
  });

  it('creates the iframe only when the chat is first opened', () => {
    load();
    expect(frame()).toBeNull();
    button().click();
    const f = frame()!;
    expect(f.getAttribute('src')).toBe(`${HUB}/w/${CHANNEL}`);
    expect(f.getAttribute('title')).toBeTruthy();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    button().click();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(shadow().querySelectorAll('iframe')).toHaveLength(1);
  });

  it('init -> destroy -> init x3 leaves exactly one widget and no listener leaks', () => {
    hubApi()?.destroy(); // leftover instance from a previous test
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    load();
    for (let i = 0; i < 3; i++) {
      hubApi().destroy();
      expect(root()).toBeNull();
      hubApi().init({});
      expect(document.querySelectorAll('#message-hub-root')).toHaveLength(1);
    }
    hubApi().destroy();
    expect(root()).toBeNull();
    const count = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'message' || type === 'resize').length;
    expect(count(add)).toBeGreaterThan(0);
    expect(count(remove)).toBe(count(add));
  });

  it('loading the script again replaces the previous instance', () => {
    load();
    load();
    expect(document.querySelectorAll('#message-hub-root')).toHaveLength(1);
  });

  it('honours data-auto-init="false"', () => {
    load(config(), { 'data-auto-init': 'false' });
    expect(root()).toBeNull();
    hubApi().init({});
    expect(root()).not.toBeNull();
  });
});

describe('returning visitors (token already stored)', () => {
  const stored = () => localStorage.setItem(`mh:token:${CHANNEL}`, 'vt_stored');

  it('creates a hidden iframe at init so the stream and badge work before the chat is opened', () => {
    stored();
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    load();
    const f = frame();
    expect(f).not.toBeNull();
    const box = f!.parentElement as HTMLElement;
    expect(box.style.visibility).toBe('hidden');
    expect(box.style.pointerEvents).toBe('none');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(focusSpy).not.toHaveBeenCalled(); // must not steal focus
  });

  it('does not tell a hidden iframe that the chat was opened', () => {
    stored();
    load();
    const posted = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    expect(posted.mock.calls.some(([m]) => (m as { type: string }).type === 'mh:open')).toBe(false);
  });

  it('still creates no iframe for someone who never chatted', () => {
    load();
    expect(frame()).toBeNull();
  });

  it('init -> destroy -> init keeps exactly one hidden iframe', () => {
    stored();
    load();
    for (let i = 0; i < 3; i++) {
      hubApi().destroy();
      expect(root()).toBeNull();
      hubApi().init({});
      expect(shadow().querySelectorAll('iframe')).toHaveLength(1);
    }
    hubApi().open();
    expect(shadow().querySelectorAll('iframe')).toHaveLength(1);
    expect((frame()!.parentElement as HTMLElement).style.visibility).toBe('visible');
  });

  it('a read mark of 0 is a real mark (chat opened, nothing received yet)', () => {
    stored();
    load();
    const win = frame()!.contentWindow!;
    const posted = vi.spyOn(win, 'postMessage');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:hello' }, origin: HUB, source: win }));
    expect(posted.mock.calls.find(([m]) => (m as { type: string }).type === 'mh:init')![0]).toMatchObject({ readSeq: null });
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:read', seq: 0 }, origin: HUB, source: win }));
    expect(localStorage.getItem(`mh:read:${CHANNEL}`)).toBe('0');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:hello' }, origin: HUB, source: win }));
    expect(posted.mock.calls.filter(([m]) => (m as { type: string }).type === 'mh:init').at(-1)![0]).toMatchObject({ readSeq: 0 });
  });

  it('remembers what was read, and hands it to the iframe on init', () => {
    stored();
    load();
    const win = frame()!.contentWindow!;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:read', seq: 42 }, origin: HUB, source: win }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:read', seq: 7 }, origin: HUB, source: win })); // never goes backwards
    expect(localStorage.getItem(`mh:read:${CHANNEL}`)).toBe('42');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:read', seq: 5 }, origin: 'https://evil.example', source: win }));
    expect(localStorage.getItem(`mh:read:${CHANNEL}`)).toBe('42');
    const posted = vi.spyOn(win, 'postMessage');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:hello' }, origin: HUB, source: win }));
    expect(posted.mock.calls.find(([m]) => (m as { type: string }).type === 'mh:init')![0]).toMatchObject({ readSeq: 42, open: false });
  });
});

describe('launcher settings', () => {
  it('uses the brand colour for the launcher when no custom colour is set', () => {
    load(config({ launcher: { position: 'left', offset: { x: 30, y: 40 }, zIndex: 777 }, theme: { color: '#ffd400' } }));
    const b = button();
    expect(b.style.left).toBe('30px');
    expect(b.style.bottom).toBe('40px');
    expect(b.style.zIndex).toBe('777');
    expect(b.style.background).toContain('rgb(255, 212, 0)');
    expect(b.style.color).toMatch(/17, 24, 39|#111827/);
  });

  it('applies a custom launcher colour with a readable foreground', () => {
    load(config({ launcher: { color: '#0057ff' }, theme: { color: '#ffd400' } }));
    const b = button();
    expect(b.style.background).toContain('rgb(0, 87, 255)');
    expect(b.style.color).toMatch(/255, 255, 255|#ffffff/);
  });

  it('scales the launcher and keeps the desktop chat above it', () => {
    load(config({ launcher: { size: 'xlarge', offset: { x: 20, y: 30 } } }));
    const b = button();
    expect(b.style.width).toBe('72px');
    expect(b.style.height).toBe('72px');
    expect(b.style.minWidth).toBe('72px');
    expect(b.style.borderRadius).toBe('36px');
    expect(b.querySelector('svg')?.getAttribute('width')).toBe('34');
    b.click();
    expect(frame()!.parentElement?.style.bottom).toBe('114px');
  });

  it('uses the same launcher offset on mobile and opens the chat across the full viewport', () => {
    setViewportWidth(768);
    load(config({ launcher: { offset: { x: 30, y: 40 } } }));
    const b = button();
    expect(b.style.right).toBe('30px');
    expect(b.style.bottom).toBe('40px');
    b.click();
    const box = frame()!.parentElement as HTMLElement;
    expect(b.style.display).toBe('none');
    expect(box.style.top).toBe('0px');
    expect(box.style.left).toBe('0px');
    expect(box.style.right).toBe('0px');
    expect(box.style.bottom).toBe('0px');
    expect(box.style.width).toBe('100vw');
    expect(box.style.height).toBe('100dvh');
    expect(box.style.borderRadius).toBe('0px');
    expect(box.style.boxShadow).toBe('none');
  });

  it('keeps the launcher offset while updating chat layout across the mobile breakpoint', () => {
    load(config({ launcher: { offset: { x: 30, y: 40 } } }));
    const b = button();
    expect(b.style.right).toBe('30px');
    expect(b.style.bottom).toBe('40px');

    setViewportWidth(600);
    window.dispatchEvent(new Event('resize'));
    expect(b.style.right).toBe('30px');
    expect(b.style.bottom).toBe('40px');

    b.click();
    const box = frame()!.parentElement as HTMLElement;
    expect(b.style.display).toBe('none');
    expect(box.style.width).toBe('100vw');
    expect(box.style.height).toBe('100dvh');

    setViewportWidth(900);
    window.dispatchEvent(new Event('resize'));
    expect(b.style.display).toBe('flex');
    expect(b.style.right).toBe('30px');
    expect(b.style.bottom).toBe('40px');
    expect(box.style.width).toBe('380px');
    expect(box.style.height).toBe('640px');
  });

  it('keeps desktop layout when only the viewport height is short', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 500 });
    load(config({ launcher: { offset: { x: 30, y: 40 } } }));
    expect(button().style.right).toBe('30px');
    expect(button().style.bottom).toBe('40px');
    button().click();
    const box = frame()!.parentElement as HTMLElement;
    expect(box.style.width).toBe('380px');
    expect(box.style.height).toBe('640px');
  });

  it('hidden launcher draws no button but open() still works', () => {
    load(config({ launcher: { hidden: true } }));
    expect(button().style.display).toBe('none');
    hubApi().open();
    expect(frame()).not.toBeNull();
  });

  it('changes launcher and desktop chat position at runtime', () => {
    load(config({ launcher: { offset: { x: 20, y: 20 } } }));
    const b = button();
    hubApi().setLauncherPosition({ position: 'left', x: 32, y: 96 });
    expect(b.style.left).toBe('32px');
    expect(b.style.right).toBe('auto');
    expect(b.style.bottom).toBe('96px');

    hubApi().open();
    const box = frame()!.parentElement as HTMLElement;
    expect(box.style.left).toBe('32px');
    expect(box.style.right).toBe('auto');
    expect(box.style.bottom).toBe('164px');

    hubApi().setLauncherPosition({ position: 'right', x: 12, y: 24 });
    expect(b.style.left).toBe('auto');
    expect(b.style.right).toBe('12px');
    expect(box.style.left).toBe('auto');
    expect(box.style.right).toBe('12px');
    expect(box.style.bottom).toBe('92px');
  });

  it('changes launcher visibility and z-index at runtime without closing chat', () => {
    load();
    hubApi().open();
    const box = frame()!.parentElement as HTMLElement;
    hubApi().setLauncherVisible(false);
    expect(button().style.display).toBe('none');
    expect(box.style.visibility).toBe('visible');
    expect(box.style.bottom).toBe('20px');

    hubApi().setLauncherZIndex(1200);
    expect(button().style.zIndex).toBe('1200');
    expect(box.style.zIndex).toBe('1201');

    hubApi().setLauncherVisible(true);
    expect(button().style.display).toBe('flex');
    expect(box.style.bottom).toBe('88px');
  });

  it('rejects invalid launcher overrides atomically and init resets valid overrides', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    load(config({ launcher: { position: 'right', offset: { x: 20, y: 20 }, zIndex: 777 } }));
    hubApi().setLauncherPosition({ position: 'left', x: -1, y: 90 });
    hubApi().setLauncherVisible('false' as never);
    hubApi().setLauncherZIndex(1.5);
    expect(button().style.right).toBe('20px');
    expect(button().style.left).toBe('auto');
    expect(button().style.bottom).toBe('20px');
    expect(button().style.display).toBe('flex');
    expect(button().style.zIndex).toBe('777');
    expect(warn).toHaveBeenCalledTimes(3);

    hubApi().setLauncherPosition({ position: 'left', x: 40, y: 80 });
    hubApi().setLauncherVisible(false);
    hubApi().setLauncherZIndex(900);
    hubApi().init({});
    expect(button().style.right).toBe('20px');
    expect(button().style.left).toBe('auto');
    expect(button().style.bottom).toBe('20px');
    expect(button().style.display).toBe('flex');
    expect(button().style.zIndex).toBe('777');
  });

  it('localizes the label and aria-label, and setLocale switches them at runtime', () => {
    load(config({ launcher: { label: { en: 'Chat with us', vi: 'Chat với chúng tôi' } }, content: { overrides: { vi: { 'launcher.open': 'Mở khung chat' } } } }));
    expect(button().getAttribute('aria-label')).toBe('Open chat');
    expect(button().textContent).toContain('Chat with us');
    hubApi().setLocale('vi');
    expect(button().getAttribute('aria-label')).toBe('Mở khung chat');
    expect(button().textContent).toContain('Chat với chúng tôi');
    hubApi().setLocale(null);
    document.documentElement.lang = 'vi-VN';
    hubApi().setLocale(null);
    expect(button().getAttribute('aria-label')).toBe('Mở khung chat');
  });

  it.each(['ko', 'zh', 'ja', 'th', 'fr', 'ru'])('switches the launcher to %s and back without replacing the iframe', (locale) => {
    load(config({ locales: ['en', locale] }));
    const base = ALL_CATALOGS[locale];
    expect(button().getAttribute('aria-label')).toBe('Open chat');
    hubApi().setLocale(`${locale}-XX`);
    expect(button().getAttribute('aria-label')).toBe(base['launcher.open']);
    hubApi().open();
    const f = frame()!;
    expect(button().getAttribute('aria-label')).toBe(base['launcher.close']);
    const posted = vi.spyOn(f.contentWindow!, 'postMessage');
    hubApi().setLocale('en');
    expect(button().getAttribute('aria-label')).toBe('Close chat');
    expect(frame()).toBe(f);
    expect(posted).toHaveBeenCalledWith({ type: 'mh:locale', locale: 'en' }, HUB);
    hubApi().setLocale(null);
    document.documentElement.lang = `${locale}-XX`;
    hubApi().setLocale(null);
    expect(button().getAttribute('aria-label')).toBe(base['launcher.close']);
    hubApi().close();
    expect(button().getAttribute('aria-label')).toBe(base['launcher.open']);
  });

  it('shows the unread badge from the iframe and emits events', () => {
    load();
    hubApi().open();
    const events: unknown[] = [];
    hubApi().on('unread', (n) => events.push(n));
    hubApi().on('message', (m) => events.push(m));
    const win = frame()!.contentWindow!;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:unread', count: 3 }, origin: HUB, source: win }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:message', message: { id: 'm1', text: 'hi', createdAt: 'x' } }, origin: HUB, source: win }));
    expect(events).toEqual([3, { id: 'm1', text: 'hi', createdAt: 'x' }]);
    expect(button().textContent).toContain('3');
  });
});

describe('postMessage security', () => {
  function open() {
    load();
    hubApi().open();
    const win = frame()!.contentWindow!;
    const posted = vi.spyOn(win, 'postMessage');
    return { win, posted };
  }

  it('answers hello with init, targeted at the hub origin only', () => {
    localStorage.setItem(`mh:token:${CHANNEL}`, 'vt_stored');
    const { win, posted } = open();
    hubApi().identify({ name: 'Lan', bad: { nested: 1 } });
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:hello' }, origin: HUB, source: win }));
    const init = posted.mock.calls.find(([m]) => (m as { type: string }).type === 'mh:init')!;
    expect(init[1]).toBe(HUB);
    expect(init[0]).toMatchObject({ token: 'vt_stored', open: true, identify: { name: 'Lan' } });
    expect((init[0] as { identify: object }).identify).not.toHaveProperty('bad');
  });

  it('ignores messages from another origin or another window', () => {
    const { win, posted } = open();
    const close = vi.fn();
    hubApi().on('close', close);
    for (const ev of [
      { origin: 'https://evil.example', source: win },
      { origin: HUB, source: window },
      { origin: HUB, source: null },
    ]) {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:hello' }, ...ev }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:token', token: 'vt_evil' }, ...ev }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:close-request' }, ...ev }));
    }
    expect(posted.mock.calls.filter(([m]) => (m as { type: string }).type === 'mh:init')).toHaveLength(0);
    expect(localStorage.getItem(`mh:token:${CHANNEL}`)).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('stores the token the iframe reports, and clears it on logout', () => {
    const { win } = open();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:token', token: 'vt_new' }, origin: HUB, source: win }));
    expect(localStorage.getItem(`mh:token:${CHANNEL}`)).toBe('vt_new');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:token', token: null }, origin: HUB, source: win }));
    expect(localStorage.getItem(`mh:token:${CHANNEL}`)).toBeNull();
  });

  it('close-request from the iframe closes the window', () => {
    const { win } = open();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mh:close-request' }, origin: HUB, source: win }));
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('embed config', () => {
  it('has a complete launcher config even for empty settings', () => {
    const c = config();
    expect(c.launcher).toMatchObject({
      color: '#1f2937',
      fg: '#ffffff',
      size: 'medium',
      diameter: 56,
      iconSize: 26,
      imageSize: 28,
      position: 'right',
      hidden: false,
      offset: { x: 20, y: 20 },
    });
    expect(c.window).toEqual(DEFAULT_SETTINGS.window);
    expect(c.strings.en.open).toBe('Open chat');
    expect(c.strings.vi.open).toBe('Mở chat');
  });

  it('escapes JSON so a hostile label cannot break out of the script', () => {
    const c = config({ launcher: { label: { en: '</script><script>alert(1)</script>\u2028' } } });
    const body = buildLoader({ id: CHANNEL, settings: { launcher: { label: c.launcher.label } } }).body;
    expect(body).not.toContain('</script>');
    expect(body).not.toContain('\u2028');
    expect(body).toContain('\\u003c/script\\u003e');
  });
});
