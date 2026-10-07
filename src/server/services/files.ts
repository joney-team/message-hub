import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray, lt, sql } from 'drizzle-orm';
import { getConfig } from '../config';
import { dataDir, getDb } from '../db/client';
import { channels, files, messages } from '../db/schema';
import { ApiError } from '../http/errors';
import { checkUpload, isInlineMime, sanitizeFileName } from '../files-policy';
import { fileUrl } from '../file-urls';
import { isId, newId } from '../ids';

type ChannelRow = typeof channels.$inferSelect;
type FileRow = typeof files.$inferSelect;

export const ORPHAN_AFTER_MS = 24 * 3600_000;

export function filesDir(): string {
  return path.join(/*turbopackIgnore: true*/ dataDir(), 'files');
}

/** Only ever built from an id that passed `isId`, so it cannot leave `filesDir()`. */
function filePath(id: string): string {
  return path.join(/*turbopackIgnore: true*/ filesDir(), id);
}

export interface FileDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export function serializeFile(f: FileRow): FileDto {
  return { id: f.id, name: f.name, mime: f.mime, size: f.size, url: fileUrl(f.id) };
}

export async function saveUpload(input: { channel: ChannelRow; visitorId: string | null; file: File }): Promise<FileRow> {
  const max = getConfig().maxUploadBytes;
  if (input.file.size > max) throw new ApiError(413, 'FILE_TOO_LARGE', `File exceeds ${Math.floor(max / 1024 / 1024)} MB`);
  if (input.file.size === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'File is empty');
  const name = sanitizeFileName(input.file.name);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const verdict = checkUpload(name, bytes);
  if (!verdict.ok) throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed');

  const id = newId('file');
  await fs.promises.mkdir(filesDir(), { recursive: true });
  await fs.promises.writeFile(filePath(id), bytes, { flag: 'wx' });
  try {
    return getDb()
      .insert(files)
      .values({ id, channelId: input.channel.id, visitorId: input.visitorId, name, mime: verdict.mime, size: bytes.byteLength, createdAt: new Date() })
      .returning()
      .get();
  } catch (err) {
    await fs.promises.rm(filePath(id), { force: true });
    throw err;
  }
}

export interface ServedFile {
  row: FileRow;
  path: string;
  inline: boolean;
}

export function findServedFile(id: string): ServedFile | null {
  if (!isId('file', id)) return null;
  const row = getDb().select().from(files).where(eq(files.id, id)).get();
  if (!row) return null;
  return { row, path: filePath(id), inline: isInlineMime(row.mime) };
}

function removeFromDisk(ids: string[]): void {
  for (const id of ids) {
    if (isId('file', id)) fs.rmSync(filePath(id), { force: true });
  }
}

/** Deletes a channel's files from disk. Call right after the channel (and its file rows) are gone. */
export function removeFilesFromDisk(ids: string[]): void {
  removeFromDisk(ids);
}

export function fileIdsOfChannel(channelId: string): string[] {
  return getDb().select({ id: files.id }).from(files).where(eq(files.channelId, channelId)).all().map((r) => r.id);
}

/**
 * Hourly janitor: (1) file rows no message references, older than a day (uploaded but
 * never sent, or their conversation was deleted); (2) files on disk with no row.
 */
export function sweepFiles(now: number = Date.now()): { rows: number; disk: number } {
  const db = getDb();
  const cutoff = new Date(now - ORPHAN_AFTER_MS);
  // One pass over messages that have attachments, instead of one scan per file.
  const referenced = new Set<string>();
  for (const row of db.select({ a: messages.attachments }).from(messages).where(sql`${messages.attachments} != '[]'`).all()) {
    for (const att of row.a) referenced.add(att.fileId);
  }
  const orphans = db
    .select({ id: files.id })
    .from(files)
    .where(lt(files.createdAt, cutoff))
    .all()
    .map((r) => r.id)
    .filter((id) => !referenced.has(id));
  if (orphans.length) {
    db.delete(files).where(inArray(files.id, orphans)).run();
    removeFromDisk(orphans);
  }
  let disk = 0;
  const dir = filesDir();
  if (fs.existsSync(dir)) {
    const known = new Set(db.select({ id: files.id }).from(files).all().map((r) => r.id));
    for (const entry of fs.readdirSync(dir)) {
      if (known.has(entry)) continue;
      const p = path.join(/*turbopackIgnore: true*/ dir, entry);
      if (fs.statSync(p).mtimeMs < now - ORPHAN_AFTER_MS) {
        fs.rmSync(p, { force: true });
        disk++;
      }
    }
  }
  return { rows: orphans.length, disk };
}
