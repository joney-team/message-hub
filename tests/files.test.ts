import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetConfigForTests } from '@/server/config';
import { getDb } from '@/server/db/client';
import { files, webhookDeliveries } from '@/server/db/schema';
import { resetLimitersForTests } from '@/server/http/rate-limit';
import { checkUpload, sanitizeFileName } from '@/server/files-policy';
import { createMessage } from '@/server/services/messages';
import { deleteChannel } from '@/server/services/channels';
import { filesDir, ORPHAN_AFTER_MS, sweepFiles } from '@/server/services/files';
import * as serve from '@/app/files/[id]/route';
import * as widgetFiles from '@/app/api/widget/files/route';
import * as adminFiles from '@/app/api/v1/files/route';
import * as widgetMessages from '@/app/api/widget/messages/route';
import * as adminMessages from '@/app/api/v1/visitors/[id]/messages/route';
import { insertChannel, insertVisitor, useTestDb } from './helpers';

const KEY = 'a'.repeat(20);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-files-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF');

async function upload(handler: unknown, token: string, name: string, bytes: Uint8Array | string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set('file', new File([typeof bytes === 'string' ? bytes : (bytes as BlobPart)], name));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  // Fully buffered body (like a normal HTTP request), so early rejections leave no half-read stream.
  const encoded = new Response(form);
  const req = new Request('http://hub.test/up', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': encoded.headers.get('content-type')! },
    body: await encoded.arrayBuffer(),
  });
  return (handler as (r: Request, c: { params: Promise<object> }) => Promise<Response>)(req, { params: Promise.resolve({}) });
}

const get = (id: string) => serve.GET(new Request('http://hub.test/files/x'), { params: Promise.resolve({ id }) });

async function json(r: Response) {
  return (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => {
  process.env.API_KEYS = `acme:${KEY},other:${'b'.repeat(20)}`;
  process.env.DATA_DIR = tmp;
  process.env.MAX_UPLOAD_MB = '1';
  process.env.PUBLIC_URL = 'https://hub.example.com';
  delete process.env.FILES_BASE_URL;
  resetConfigForTests();
  resetLimitersForTests();
  useTestDb();
  fs.rmSync(filesDir(), { recursive: true, force: true });
});

describe('upload policy', () => {
  it('refuses html, svg, scripts and executables; allows images and documents', () => {
    for (const name of ['x.html', 'x.htm', 'x.svg', 'x.js', 'x.exe', 'x.php', 'x', 'x.', '.html', 'x.html.']) {
      expect(checkUpload(name, PNG).ok, name).toBe(false);
    }
    expect(checkUpload('a.PNG', PNG)).toEqual({ ok: true, mime: 'image/png' });
    expect(checkUpload('a.pdf', PDF)).toEqual({ ok: true, mime: 'application/pdf' });
    expect(checkUpload('notes.txt', new TextEncoder().encode('hi')).ok).toBe(true);
  });

  it('rejects content that does not match its extension (HTML disguised as png/pdf)', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script>');
    expect(checkUpload('evil.png', html).ok).toBe(false);
    expect(checkUpload('evil.pdf', html).ok).toBe(false);
    expect(checkUpload('evil.html.png', html).ok).toBe(false);
  });

  it('sanitises names: no path, control chars or header injection', () => {
    expect(sanitizeFileName('../../etc/passwd.png')).toBe('passwd.png');
    expect(sanitizeFileName('C:\\Users\\x\\a.png')).toBe('a.png');
    expect(sanitizeFileName('a\r\nSet-Cookie: x=1.png')).not.toMatch(/[\r\n]/);
    expect(sanitizeFileName('')).toBe('file');
  });
});

describe('visitor upload', () => {
  it('stores a valid image and serves it safely', async () => {
    const ch = insertChannel();
    const { token } = insertVisitor(ch.id);
    const res = await upload(widgetFiles.POST, token, 'photo.png', PNG);
    expect(res.status).toBe(201);
    const dto = await json(res);
    expect(dto).toMatchObject({ name: 'photo.png', mime: 'image/png', size: PNG.length });
    expect(dto.url).toBe(`/files/${dto.id}`);

    const served = await get(dto.id);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('serves non-media as attachment, with the type chosen at upload', async () => {
    const { token } = insertVisitor(insertChannel().id);
    const dto = await json(await upload(widgetFiles.POST, token, 'doc.pdf', PDF));
    const served = await get(dto.id);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect(served.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it.each(['page.html', 'logo.svg', 'run.js', 'tool.exe', 'noext'])('rejects %s with 415', async (name) => {
    const { token } = insertVisitor(insertChannel().id);
    const res = await upload(widgetFiles.POST, token, name, '<script>alert(1)</script>');
    expect(res.status).toBe(415);
    expect((await json(res)).error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(getDb().select().from(files).all()).toHaveLength(0);
    expect(fs.existsSync(filesDir()) ? fs.readdirSync(filesDir()) : []).toHaveLength(0);
  });

  it('rejects a payload larger than MAX_UPLOAD_MB', async () => {
    const { token } = insertVisitor(insertChannel().id);
    const big = new Uint8Array(2 * 1024 * 1024);
    big.set(PNG);
    const res = await upload(widgetFiles.POST, token, 'big.png', big);
    expect(res.status).toBe(413);
  });

  it('requires a visitor token', async () => {
    expect((await upload(widgetFiles.POST, 'vt_nope', 'a.png', PNG)).status).toBe(401);
  });

  it('refuses uploads when the channel disabled attachments', async () => {
    const { token } = insertVisitor(insertChannel('acme', { settings: { features: { attachments: false } } }).id);
    const res = await upload(widgetFiles.POST, token, 'a.png', PNG);
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe('ATTACHMENTS_DISABLED');
  });

  it('rate limits uploads per visitor', async () => {
    const { token } = insertVisitor(insertChannel().id);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await upload(widgetFiles.POST, token, 'a.png', PNG)).status);
    expect(codes.filter((c) => c === 201)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
  });

  it('rejects non-multipart bodies', async () => {
    const { token } = insertVisitor(insertChannel().id);
    const res = await widgetFiles.POST(new Request('http://x', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });
});

describe('serving', () => {
  it.each(['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', 'file_../../x', 'file_short', '', 'file_' + 'A'.repeat(22) + '/../x', 'x'.repeat(300)])('answers 404 for %s', async (id) => {
    const res = await get(id);
    expect(res.status).toBe(404);
  });

  it('answers 404 for a well-formed unknown id and when the file vanished from disk', async () => {
    expect((await get('file_' + 'A'.repeat(22))).status).toBe(404);
    const { token } = insertVisitor(insertChannel().id);
    const dto = await json(await upload(widgetFiles.POST, token, 'a.png', PNG));
    fs.rmSync(path.join(filesDir(), dto.id));
    expect((await get(dto.id)).status).toBe(404);
  });
});

describe('attaching and delivering', () => {
  it('visitor attaches an upload; the webhook carries an absolute URL; the agent can attach files too', async () => {
    const ch = insertChannel('acme', { webhookUrl: 'https://r.test/h' });
    const { visitor, token } = insertVisitor(ch.id);
    const up = await json(await upload(widgetFiles.POST, token, 'photo.png', PNG));
    const sent = await widgetMessages.POST(
      new Request('http://x', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: '', attachments: [{ fileId: up.id }] }) }),
      { params: Promise.resolve({}) },
    );
    expect(sent.status).toBe(201);
    expect((await json(sent)).attachments[0]).toMatchObject({ fileId: up.id, name: 'photo.png', url: `/files/${up.id}` });
    const d = getDb().select().from(webhookDeliveries).orderBy(webhookDeliveries.id).all().at(-1)!;
    expect((d.payload as any).data.message.attachments[0].url).toBe(`https://hub.example.com/files/${up.id}`); // eslint-disable-line @typescript-eslint/no-explicit-any

    // agent side: upload with API key, attach to a reply
    const agentUp = await json(await upload(adminFiles.POST, KEY, 'reply.pdf', PDF, { channelId: ch.id }));
    const reply = await adminMessages.POST(
      new Request('http://x', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'see file', attachments: [{ fileId: agentUp.id }] }) }),
      { params: Promise.resolve({ id: visitor.id }) },
    );
    expect(reply.status).toBe(201);
  });

  it("an API key cannot upload into another owner's channel", async () => {
    const ch = insertChannel('other');
    const res = await upload(adminFiles.POST, KEY, 'a.png', PNG, { channelId: ch.id });
    expect(res.status).toBe(404);
    expect((await upload(adminFiles.POST, KEY, 'a.png', PNG)).status).toBe(400);
    expect((await upload(adminFiles.POST, 'nope', 'a.png', PNG, { channelId: ch.id })).status).toBe(401);
  });

  it('FILES_BASE_URL moves file URLs to another host', async () => {
    process.env.FILES_BASE_URL = 'https://files.example.com/';
    resetConfigForTests();
    const { token } = insertVisitor(insertChannel().id);
    const dto = await json(await upload(widgetFiles.POST, token, 'a.png', PNG));
    expect(dto.url).toBe(`https://files.example.com/files/${dto.id}`);
  });
});

describe('cleanup', () => {
  it('deleting a channel removes its files from disk', async () => {
    const ch = insertChannel('acme');
    const { token } = insertVisitor(ch.id);
    const dto = await json(await upload(widgetFiles.POST, token, 'a.png', PNG));
    expect(fs.existsSync(path.join(filesDir(), dto.id))).toBe(true);
    deleteChannel('acme', ch.id);
    expect(fs.existsSync(path.join(filesDir(), dto.id))).toBe(false);
    expect(getDb().select().from(files).all()).toHaveLength(0);
  });

  it('sweeps unreferenced uploads older than a day and stray files, keeps referenced ones', async () => {
    const ch = insertChannel();
    const { visitor, token } = insertVisitor(ch.id);
    const used = await json(await upload(widgetFiles.POST, token, 'used.png', PNG));
    const orphan = await json(await upload(widgetFiles.POST, token, 'orphan.png', PNG));
    const fresh = await json(await upload(widgetFiles.POST, token, 'fresh.png', PNG));
    createMessage({ channel: ch, visitor, direction: 'inbound', text: 'x', attachments: [{ fileId: used.id, name: 'used.png', mime: 'image/png', size: 1 }] });
    const old = new Date(Date.now() - ORPHAN_AFTER_MS - 60_000);
    for (const id of [used.id, orphan.id]) getDb().update(files).set({ createdAt: old }).where(eq(files.id, id)).run();
    const stray = path.join(filesDir(), 'file_' + 'Z'.repeat(22));
    fs.writeFileSync(stray, 'x');
    fs.utimesSync(stray, old, old);

    expect(sweepFiles()).toEqual({ rows: 1, disk: 1 });
    expect(fs.existsSync(path.join(filesDir(), used.id))).toBe(true);
    expect(fs.existsSync(path.join(filesDir(), fresh.id))).toBe(true);
    expect(fs.existsSync(path.join(filesDir(), orphan.id))).toBe(false);
    expect(fs.existsSync(stray)).toBe(false);
  });
});
