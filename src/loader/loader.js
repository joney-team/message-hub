/*
 * Message Hub loader. Plain ES2017, no dependencies. `c` is the channel config the server
 * embeds (see src/app/embed/[file]/route.ts). Rules this file keeps (research 2 §5):
 *  - no fetch / XHR from the host page (the iframe talks to the API, same origin as itself)
 *  - no <style> element and no style="" attribute string: styles are set through the CSSOM
 *    (el.style.x = ...), which a strict CSP `style-src` does not block
 *  - the button lives in a Shadow DOM so the host page's CSS cannot break it
 *  - init -> destroy -> init leaves nothing behind
 */
var NS = 'MessageHub';
var script = document.currentScript;
var scriptSrc = script && script.src ? script.src : '';
if (!scriptSrc) {
  var found = document.querySelector('script[src*="/embed/' + c.channelId + '"]');
  scriptSrc = found ? found.src : '';
}
var hub = '';
try {
  hub = new URL(scriptSrc).origin;
} catch (e) {}
function warn(msg) {
  try {
    console.warn('[MessageHub] ' + msg);
  } catch (e) {}
}
if (!hub) {
  console.error('[MessageHub] Could not tell where the widget is hosted. Load this file with a <script src="https://message-hub.example.com/embed/' + c.channelId + '.js"> tag.');
  return;
}

var prev = window[NS];
if (prev && typeof prev.destroy === 'function') prev.destroy();

var MOBILE_MAX_WIDTH = 768;
var TOKEN_KEY = 'mh:token:' + c.channelId;
var READ_KEY = 'mh:read:' + c.channelId;
var listeners = {};
var state = null; // live instance, null when destroyed

function css(el, styles) {
  for (var k in styles) el.style[k] = styles[k];
  return el;
}
function el(tag, styles, attrs) {
  var node = document.createElement(tag);
  if (styles) css(node, styles);
  if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}
function emit(name, payload) {
  (listeners[name] || []).slice().forEach(function (fn) {
    try {
      fn(payload);
    } catch (e) {
      warn('listener for "' + name + '" threw: ' + (e && e.message));
    }
  });
}
function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}
function writeToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}
function readSeen() {
  try {
    var raw = localStorage.getItem(READ_KEY);
    var n = Number(raw);
    return raw !== null && n >= 0 ? n : null;
  } catch (e) {
    return null;
  }
}
function writeSeen(seq) {
  try {
    var cur = readSeen();
    if (cur === null || seq > cur) localStorage.setItem(READ_KEY, String(seq));
  } catch (e) {}
}
function pageContext() {
  return { url: location.href.split('#')[0], title: document.title, referrer: document.referrer };
}
function short(code) {
  return String(code || '').split(/[-_]/)[0].toLowerCase();
}
function match(candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var want = candidates[i];
    if (!want) continue;
    for (var j = 0; j < c.locales.length; j++) if (c.locales[j].toLowerCase() === String(want).toLowerCase()) return c.locales[j];
    for (var k = 0; k < c.locales.length; k++) if (c.locales[k].toLowerCase() === short(want)) return c.locales[k];
  }
  return null;
}
function currentLocale() {
  var nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  return match([state.locale]) || match([document.documentElement.lang]) || match(nav) || c.defaultLocale;
}
function text(map) {
  if (!map) return '';
  var l = currentLocale();
  return map[l] || map[short(l)] || map[c.defaultLocale] || '';
}
function strings() {
  var l = currentLocale();
  return c.strings[l] || c.strings[c.defaultLocale] || { open: 'Open chat', close: 'Close chat' };
}
function isMobile() {
  return window.innerWidth <= MOBILE_MAX_WIDTH;
}
function validOffset(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 400;
}
function validZIndex(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 2147483647;
}

function layout() {
  var s = state;
  var mobile = isMobile();
  var L = s.launcher;
  var launcherOffset = L.offset;
  var side = L.position === 'left' ? 'left' : 'right';
  var other = side === 'left' ? 'right' : 'left';
  var size = c.launcher.diameter;
  css(s.button, { position: 'fixed', bottom: launcherOffset.y + 'px', zIndex: String(L.zIndex), display: L.hidden || (mobile && s.open) ? 'none' : 'flex' });
  s.button.style[side] = launcherOffset.x + 'px';
  s.button.style[other] = 'auto';
  css(s.badge, { display: s.unread > 0 ? 'flex' : 'none' });
  if (!s.frameBox) return;
  var box = s.frameBox;
  box.style.display = 'block';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  css(box, {
    position: 'fixed',
    zIndex: String(L.zIndex + 1),
    overflow: 'hidden',
    background: 'transparent',
    boxShadow: '0 12px 40px rgba(0,0,0,.28)',
    transition: reduce ? 'none' : 'opacity .18s ease, transform .18s ease',
    opacity: s.open ? '1' : '0',
    transform: s.open ? 'none' : 'translateY(12px)',
    visibility: s.open ? 'visible' : 'hidden',
    pointerEvents: s.open ? 'auto' : 'none',
  });
  if (mobile) {
    css(box, {
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      width: '100vw',
      height: '100dvh',
      maxWidth: 'none',
      maxHeight: 'none',
      borderRadius: '0',
      boxShadow: 'none',
    });
  } else {
    var bottom = L.hidden ? launcherOffset.y : launcherOffset.y + size + 12;
    css(box, {
      top: 'auto',
      bottom: bottom + 'px',
      width: c.window.width + 'px',
      height: c.window.height + 'px',
      maxWidth: 'calc(100vw - ' + launcherOffset.x * 2 + 'px)',
      maxHeight: 'calc(100vh - ' + (bottom + 12) + 'px)',
      borderRadius: c.theme.radius,
    });
    box.style[side] = launcherOffset.x + 'px';
    box.style[other] = 'auto';
  }
}

function labelText() {
  var st = strings();
  var open = state.open;
  state.button.setAttribute('aria-label', open ? st.close : st.open);
  state.button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (state.frame) state.frame.setAttribute('title', st.open.replace(/\s*$/, ''));
  var label = text(c.launcher.label);
  state.labelEl.textContent = label;
  var wide = !!label && !open;
  css(state.labelEl, { display: wide ? 'block' : 'none' });
  css(state.button, {
    width: wide ? 'auto' : c.launcher.diameter + 'px',
    padding: wide ? '0 ' + c.launcher.paddingEnd + 'px 0 ' + c.launcher.paddingStart + 'px' : '0',
  });
  state.badgeText.textContent = state.unread > 99 ? '99+' : String(state.unread);
}

function icon(kind) {
  var NSVG = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NSVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(c.launcher.iconSize));
  svg.setAttribute('height', String(c.launcher.iconSize));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  var path = document.createElementNS(NSVG, 'path');
  path.setAttribute('d', kind === 'close' ? 'M18 6 6 18M6 6l12 12' : 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
  svg.appendChild(path);
  return svg;
}

function paintIcon() {
  var slot = state.iconSlot;
  while (slot.firstChild) slot.removeChild(slot.firstChild);
  if (state.open) slot.appendChild(icon('close'));
  else if (c.launcher.icon) {
    var img = el('img', { width: c.launcher.imageSize + 'px', height: c.launcher.imageSize + 'px', objectFit: 'contain', borderRadius: '4px' }, { alt: '', src: c.launcher.icon, referrerpolicy: 'no-referrer' });
    slot.appendChild(img);
  } else slot.appendChild(icon('chat'));
}

function ensureFrame() {
  var s = state;
  if (s.frame) return;
  s.frameBox = el('div', { display: 'none' });
  s.frame = el('iframe', { border: '0', width: '100%', height: '100%', display: 'block', colorScheme: 'normal', background: 'transparent' }, {
    src: hub + '/w/' + encodeURIComponent(c.channelId),
    allow: '',
    referrerpolicy: 'strict-origin-when-cross-origin',
    sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads',
  });
  s.frameBox.appendChild(s.frame);
  s.root.appendChild(s.frameBox);
  s.frameTimer = setTimeout(function () {
    if (!s.ready) warn('The chat window did not start within 15 s. If this page has a Content-Security-Policy, allow frame-src ' + hub + '; if a proxy adds X-Frame-Options, remove it for /w/*.');
  }, 15000);
  labelText();
  layout();
}

function send(msg) {
  if (state && state.frame && state.frame.contentWindow) state.frame.contentWindow.postMessage(msg, hub);
}

function initPayload() {
  return {
    type: 'mh:init',
    token: readToken(),
    locale: state.locale,
    htmlLang: document.documentElement.lang || null,
    page: pageContext(),
    identify: state.identity,
    readSeq: readSeen(),
    open: state.open,
  };
}

function onMessage(e) {
  var s = state;
  // Both checks: the frame we created, speaking from the host we loaded from.
  if (!s || !s.frame || e.source !== s.frame.contentWindow || e.origin !== hub) return;
  var d = e.data;
  if (!d || typeof d.type !== 'string') return;
  switch (d.type) {
    case 'mh:hello':
      send(initPayload());
      break;
    case 'mh:ready':
      s.ready = true;
      clearTimeout(s.frameTimer);
      emit('ready');
      break;
    case 'mh:token':
      writeToken(typeof d.token === 'string' ? d.token : null);
      break;
    case 'mh:read':
      writeSeen(Math.max(0, Math.floor(Number(d.seq)) || 0));
      break;
    case 'mh:unread':
      s.unread = Math.max(0, Number(d.count) || 0);
      labelText();
      layout();
      emit('unread', s.unread);
      break;
    case 'mh:message':
      if (d.message) emit('message', d.message);
      break;
    case 'mh:close-request':
      api.close();
      break;
    case 'mh:error':
      warn('chat reported an error: ' + String(d.code));
      break;
  }
}

function plainProfile(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  var out = {};
  var n = 0;
  for (var k in p) {
    if (!Object.prototype.hasOwnProperty.call(p, k) || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) continue;
    var v = p[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 500);
    else continue;
    if (++n >= 20) break;
  }
  return out;
}

var api = {
  init: function (options) {
    options = options || {};
    if (state) api.destroy();
    try {
      var host = el('div', { all: 'initial' }, { id: 'message-hub-root' });
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      var btnStyles = {
        width: c.launcher.diameter + 'px', height: c.launcher.diameter + 'px', minWidth: c.launcher.diameter + 'px',
        borderRadius: c.launcher.diameter / 2 + 'px', border: '0', padding: '0', margin: '0',
        cursor: 'pointer', alignItems: 'center', justifyContent: 'center', gap: '8px',
        background: c.launcher.color, color: c.launcher.fg, boxShadow: '0 6px 20px rgba(0,0,0,.28)',
        font: '600 ' + c.launcher.fontSize + 'px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', outline: 'none',
      };
      var button = el('button', btnStyles, { type: 'button' });
      var iconSlot = el('span', { display: 'flex', alignItems: 'center', justifyContent: 'center' });
      var labelEl = el('span', { display: 'none', whiteSpace: 'nowrap', paddingInlineEnd: '6px' });
      var badge = el('span', {
        position: 'absolute', top: '-4px', right: '-4px', minWidth: '20px', height: '20px', padding: '0 5px', boxSizing: 'border-box',
        borderRadius: '10px', background: '#dc2626', color: '#fff', font: '700 12px/20px system-ui, sans-serif', alignItems: 'center', justifyContent: 'center', display: 'none',
      }, { 'aria-hidden': 'true' });
      var badgeText = el('span');
      badge.appendChild(badgeText);
      button.appendChild(iconSlot);
      button.appendChild(labelEl);
      var wrap = el('div', { display: 'contents' });
      wrap.appendChild(button);
      button.appendChild(badge);
      button.style.position = 'fixed';
      root.appendChild(wrap);

      state = {
        host: host, root: root, button: button, iconSlot: iconSlot, labelEl: labelEl, badge: badge, badgeText: badgeText,
        frame: null, frameBox: null, frameTimer: 0, open: false, ready: false, unread: 0,
        locale: options.locale ? String(options.locale) : (script && script.getAttribute('data-locale')) || null,
        identity: plainProfile(options.identify),
        launcher: {
          position: c.launcher.position,
          offset: { x: c.launcher.offset.x, y: c.launcher.offset.y },
          hidden: c.launcher.hidden,
          zIndex: c.launcher.zIndex,
        },
        onResize: function () { layout(); },
        focusVisible: false,
      };
      // :focus-visible cannot be set through the CSSOM, so mirror it with listeners.
      button.addEventListener('focus', function () {
        var visible = false;
        try { visible = button.matches(':focus-visible'); } catch (e) { visible = true; }
        if (visible) css(button, { outline: '3px solid ' + c.launcher.fg, outlineOffset: '2px', boxShadow: '0 0 0 5px ' + c.launcher.color + ', 0 6px 20px rgba(0,0,0,.28)' });
      });
      button.addEventListener('blur', function () { css(button, { outline: 'none', boxShadow: '0 6px 20px rgba(0,0,0,.28)' }); });
      button.addEventListener('click', function () { api.toggle(); });
      window.addEventListener('message', onMessage);
      window.addEventListener('resize', state.onResize);
      (document.body || document.documentElement).appendChild(host);
      paintIcon();
      labelText();
      layout();
      // A returning visitor (token stored) gets a hidden iframe at once, so the stream and the unread
      // badge work before the chat is opened. Someone who never chatted gets none and writes nothing.
      if (readToken()) ensureFrame();
      if (options.open) api.open();
    } catch (err) {
      console.error('[MessageHub] init failed:', err);
      api.destroy();
    }
  },
  open: function () {
    if (!state) return;
    var wasOpen = state.open;
    state.open = true;
    state.unread = 0;
    ensureFrame();
    paintIcon();
    labelText();
    layout();
    if (!wasOpen) {
      send({ type: 'mh:open', page: pageContext() });
      try { state.frame.focus(); } catch (e) {}
      emit('open');
    }
  },
  close: function () {
    if (!state || !state.open) return;
    var s = state;
    s.open = false;
    send({ type: 'mh:close' });
    paintIcon();
    labelText();
    layout();
    // Give focus back to the button if it was inside the chat window (keyboard users).
    if (s.frame && (document.activeElement === s.host || s.root.activeElement === s.frame || document.activeElement === s.frame)) {
      try { s.button.focus(); } catch (e) {}
    }
    emit('close');
  },
  toggle: function () {
    if (state && state.open) api.close();
    else api.open();
  },
  setLocale: function (code) {
    if (!state) return;
    state.locale = code ? String(code) : null;
    labelText();
    send({ type: 'mh:locale', locale: state.locale });
  },
  setLauncherPosition: function (position) {
    if (!state) return;
    if (!position || typeof position !== 'object' || Array.isArray(position)) return warn('setLauncherPosition() expects { position?, x?, y? }');
    var hasPosition = Object.prototype.hasOwnProperty.call(position, 'position');
    var hasX = Object.prototype.hasOwnProperty.call(position, 'x');
    var hasY = Object.prototype.hasOwnProperty.call(position, 'y');
    if (!hasPosition && !hasX && !hasY) return warn('setLauncherPosition() expects at least one of position, x or y');
    if (hasPosition && position.position !== 'left' && position.position !== 'right') return warn('setLauncherPosition().position must be "left" or "right"');
    if (hasX && !validOffset(position.x)) return warn('setLauncherPosition().x must be an integer from 0 to 400');
    if (hasY && !validOffset(position.y)) return warn('setLauncherPosition().y must be an integer from 0 to 400');
    if (hasPosition) state.launcher.position = position.position;
    if (hasX) state.launcher.offset.x = position.x;
    if (hasY) state.launcher.offset.y = position.y;
    layout();
  },
  setLauncherVisible: function (visible) {
    if (!state) return;
    if (typeof visible !== 'boolean') return warn('setLauncherVisible() expects a boolean');
    state.launcher.hidden = !visible;
    layout();
  },
  setLauncherZIndex: function (zIndex) {
    if (!state) return;
    if (!validZIndex(zIndex)) return warn('setLauncherZIndex() expects an integer from 0 to 2147483647');
    state.launcher.zIndex = zIndex;
    layout();
  },
  identify: function (profile) {
    if (!state) return;
    var p = plainProfile(profile);
    if (!p) return warn('identify() expects an object like { name, email }');
    state.identity = Object.assign({}, state.identity || {}, p);
    send({ type: 'mh:identify', profile: state.identity });
  },
  on: function (name, fn) {
    if (typeof fn !== 'function') return function () {};
    (listeners[name] = listeners[name] || []).push(fn);
    return function () { api.off(name, fn); };
  },
  off: function (name, fn) {
    listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; });
  },
  destroy: function () {
    var s = state;
    if (!s) return;
    state = null;
    clearTimeout(s.frameTimer);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', s.onResize);
    if (s.host.parentNode) s.host.parentNode.removeChild(s.host);
  },
};

window[NS] = api;
if (!script || script.getAttribute('data-auto-init') !== 'false') api.init({});
