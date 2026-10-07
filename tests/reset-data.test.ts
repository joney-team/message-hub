import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb, getSqlite } from '@/server/db/client';
import { channels, files, messages, visitors, webhookDeliveries } from '@/server/db/schema';
import { createMessage } from '@/server/services/messages';
import { insertChannel, insertVisitor, useTestDb } from './helpers';
// @ts-expect-error plain ESM script without types
import { resetApplicationData } from '../scripts/reset-data.mjs';

const made: string[] = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

describe('reset data script', () => {
  it('clears application rows and uploads while preserving migrations and backups', () => {
    useTestDb();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-reset-'));
    made.push(dataDir);
    const uploads = path.join(dataDir, 'files');
    const backups = path.join(dataDir, 'backups', 'keep');
    fs.mkdirSync(uploads, { recursive: true });
    fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(uploads, 'file_test'), 'upload');
    fs.writeFileSync(path.join(backups, 'hub.db'), 'backup');

    const channel = insertChannel('acme', { webhookUrl: 'https://receiver.test/hook' });
    const { visitor } = insertVisitor(channel.id);
    getDb()
      .insert(files)
      .values({ id: 'file_test', channelId: channel.id, visitorId: visitor.id, name: 'test.txt', mime: 'text/plain', size: 6, createdAt: new Date() })
      .run();
    createMessage({ channel, visitor, direction: 'inbound', text: 'hello', attachments: [] });

    const migrationsBefore = getSqlite().prepare('select count(*) as count from __drizzle_migrations').get() as { count: number };
    const result = resetApplicationData(getSqlite(), dataDir);

    expect(result.counts).toMatchObject({ channels: 1, visitors: 1, messages: 1, files: 1, webhook_deliveries: 1 });
    for (const table of [channels, visitors, messages, files, webhookDeliveries]) expect(getDb().select().from(table).all()).toHaveLength(0);
    expect(fs.readdirSync(uploads)).toEqual([]);
    expect(fs.readFileSync(path.join(backups, 'hub.db'), 'utf8')).toBe('backup');
    expect(getSqlite().prepare('select count(*) as count from __drizzle_migrations').get()).toEqual(migrationsBefore);

    const nextChannel = insertChannel('acme', { webhookUrl: 'https://receiver.test/hook' });
    const nextVisitor = insertVisitor(nextChannel.id).visitor;
    const nextMessage = createMessage({ channel: nextChannel, visitor: nextVisitor, direction: 'inbound', text: 'new', attachments: [] }).message;
    expect(nextMessage.seq).toBe(1);
    expect(getDb().select().from(webhookDeliveries).get()?.id).toBe(1);
  });
});
