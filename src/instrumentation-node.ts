import { getConfig } from './server/config';
import { closeDb, getDb } from './server/db/client';
import { runMigrations } from './server/db/migrate';
import { startWorker, stopWorker } from './server/queue/worker';
import { hub } from './server/realtime/hub';

/** Runs once per server process: configuration check, migrations, webhook worker, graceful shutdown. */
export function startServer(): void {
  try {
    boot();
  } catch (err) {
    // Next only logs a failing hook and keeps serving; a misconfigured hub must not run.
    console.error('[hub] startup failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

function boot(): void {
  getConfig(); // fail fast on bad configuration
  runMigrations(getDb());
  startWorker();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    hub.shutdown();
    await stopWorker();
    closeDb();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
