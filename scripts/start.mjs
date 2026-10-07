// `pnpm start`: run the production build from the repository root.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareStandalone, startEnv } from './prepare-standalone.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const out = prepareStandalone(root);
  Object.assign(process.env, startEnv(root, process.env));
  // Same process: signals (SIGTERM) reach the app's own shutdown handler.
  await import(pathToFileURL(path.join(out, 'server.js')).href);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
