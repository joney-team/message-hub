// Next's standalone output (`.next/standalone`) leaves out `.next/static`, `public` and our SQL
// migrations, and its server.js changes the working directory to that folder. Copy them in so
// `node .next/standalone/server.js` is self-contained (the Dockerfile does the same by hand).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function prepareStandalone(root = repoRoot) {
  const out = path.join(root, '.next', 'standalone');
  if (!fs.existsSync(path.join(out, 'server.js'))) throw new Error('No standalone build found. Run `pnpm build` first.');
  const copies = [
    ['.next/static', '.next/static'],
    ['public', 'public'],
    ['drizzle', 'drizzle'],
  ];
  for (const [from, to] of copies) {
    const src = path.join(root, from);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(path.join(out, to), { recursive: true, force: true });
    fs.cpSync(src, path.join(out, to), { recursive: true });
  }
  return out;
}

/** Defaults for running from the repository root: data stays in <repo>/data, not in .next/standalone. */
export function startEnv(root, env) {
  return { ...env, DATA_DIR: env.DATA_DIR ?? path.join(root, 'data'), PORT: env.PORT ?? '4200', HOSTNAME: env.HOSTNAME ?? '0.0.0.0' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    prepareStandalone();
    console.log('standalone output prepared');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
