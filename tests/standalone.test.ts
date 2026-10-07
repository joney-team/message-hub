import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';
import { closeDb, getDb, installDatabase, openDatabase } from '@/server/db/client';
// @ts-expect-error plain ESM script without types
import { prepareStandalone, startEnv } from '../scripts/prepare-standalone.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const made: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-standalone-'));
  made.push(dir);
  return dir;
};
const cwd = process.cwd();

afterEach(() => {
  process.chdir(cwd);
  closeDb();
  while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

/** A fake project: what `next build` leaves behind. */
function fakeBuild() {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.next/standalone'), { recursive: true });
  fs.writeFileSync(path.join(root, '.next/standalone/server.js'), '// server');
  fs.mkdirSync(path.join(root, '.next/static/chunks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.next/static/chunks/a.js'), 'a');
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public/demo.html'), '<html>');
  fs.cpSync(path.join(repo, 'drizzle'), path.join(root, 'drizzle'), { recursive: true });
  return root;
}

describe('standalone output', () => {
  it('migrations are not found from the standalone working directory until prepared', () => {
    const root = fakeBuild();
    process.chdir(path.join(root, '.next/standalone')); // what Next's server.js does
    installDatabase(openDatabase(':memory:'));
    expect(() => runMigrations(getDb())).toThrow(/_journal/);
  });

  it('prepareStandalone copies static files, public and migrations next to server.js', () => {
    const root = fakeBuild();
    prepareStandalone(root);
    const out = path.join(root, '.next/standalone');
    expect(fs.existsSync(path.join(out, '.next/static/chunks/a.js'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'public/demo.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'drizzle/meta/_journal.json'))).toBe(true);
    process.chdir(out);
    installDatabase(openDatabase(':memory:'));
    expect(() => runMigrations(getDb())).not.toThrow();
  });

  it('is repeatable and picks up changes', () => {
    const root = fakeBuild();
    prepareStandalone(root);
    fs.writeFileSync(path.join(root, 'public/demo.html'), '<html>v2');
    prepareStandalone(root);
    expect(fs.readFileSync(path.join(root, '.next/standalone/public/demo.html'), 'utf8')).toBe('<html>v2');
  });

  it('fails clearly when the app was not built', () => {
    expect(() => prepareStandalone(tmp())).toThrow(/pnpm build/);
  });

  it('keeps data in the repository folder, not inside .next/standalone, unless DATA_DIR is set', () => {
    expect(startEnv('/repo', {}).DATA_DIR).toBe('/repo/data');
    expect(startEnv('/repo', { DATA_DIR: '/var/hub' }).DATA_DIR).toBe('/var/hub');
    expect(startEnv('/repo', {}).PORT).toBe('4200');
    expect(startEnv('/repo', { PORT: '5000' }).PORT).toBe('5000');
  });
});
