export type Token = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/**
 * Splits plain text into text and link tokens. Only http(s) links are produced and the
 * result is data (never HTML), so it can be rendered as React text and `<a>` safely.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = trimUrl(m[0]);
    const start = m.index ?? 0;
    const href = toHref(raw);
    if (!href) continue;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'link', value: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

function toHref(candidate: string): string | null {
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Drops sentence punctuation after a URL, and a `)` only when it has no matching `(` inside the URL. */
function trimUrl(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s.at(-1);
    if (last === undefined) return s;
    if (/[.,;:!?»”’'\]}]/.test(last) || (last === ')' && count(s, ')') > count(s, '('))) s = s.slice(0, -1);
    else return s;
  }
}
