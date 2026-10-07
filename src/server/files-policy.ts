/**
 * What may be uploaded. Anything not listed is refused — notably HTML, SVG, scripts
 * and executables, which could run in our origin or get the domain flagged.
 */
interface Rule {
  mime: string;
  /** Served inline in the browser; everything else is downloaded. */
  inline: boolean;
  /** Magic-byte check; omitted for formats without a reliable signature (txt, csv…). */
  magic?: (b: Uint8Array) => boolean;
}

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, s: string, at = 0) => startsWith(b, [...s].map((c) => c.charCodeAt(0)), at);

const png: Rule = { mime: 'image/png', inline: true, magic: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) };
const jpeg: Rule = { mime: 'image/jpeg', inline: true, magic: (b) => startsWith(b, [0xff, 0xd8, 0xff]) };
const zip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const ole = (b: Uint8Array) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]);

export const ALLOWED: Record<string, Rule> = {
  png,
  jpg: jpeg,
  jpeg,
  gif: { mime: 'image/gif', inline: true, magic: (b) => ascii(b, 'GIF8') },
  webp: { mime: 'image/webp', inline: true, magic: (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8) },
  mp4: { mime: 'video/mp4', inline: true, magic: (b) => ascii(b, 'ftyp', 4) },
  webm: { mime: 'video/webm', inline: true, magic: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  mp3: { mime: 'audio/mpeg', inline: true, magic: (b) => ascii(b, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  pdf: { mime: 'application/pdf', inline: false, magic: (b) => ascii(b, '%PDF') },
  txt: { mime: 'text/plain', inline: false },
  csv: { mime: 'text/csv', inline: false },
  doc: { mime: 'application/msword', inline: false, magic: ole },
  xls: { mime: 'application/vnd.ms-excel', inline: false, magic: ole },
  ppt: { mime: 'application/vnd.ms-powerpoint', inline: false, magic: ole },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false, magic: zip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false, magic: zip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inline: false, magic: zip },
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

export function isInlineMime(mime: string): boolean {
  return Object.values(ALLOWED).some((r) => r.mime === mime && r.inline);
}

/** Display name only: no path, no control characters, bounded length. Never used as a path. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return (clean || 'file').slice(-200);
}

export type Verdict = { ok: true; mime: string } | { ok: false };

/** Decides the stored MIME from extension + content, never from the client-declared type. */
export function checkUpload(fileName: string, bytes: Uint8Array): Verdict {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  const rule = Object.prototype.hasOwnProperty.call(ALLOWED, ext) ? ALLOWED[ext] : undefined;
  if (!rule) return { ok: false };
  if (rule.magic && !rule.magic(bytes)) return { ok: false };
  return { ok: true, mime: rule.mime };
}
