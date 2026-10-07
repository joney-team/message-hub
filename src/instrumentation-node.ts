import { getConfig } from './server/config';
import { closeDb, getDb } from './server/db/client';
import { runMigrations } from './server/db/migrate';
import { startWorker, stopWorker } from './server/queue/worker';
import { hub } from './server/realtime/hub';
import { debug } from './server/log';

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
  const config = getConfig(); // fail fast on bad configuration
  runMigrations(getDb());
  startWorker();
  debug('server.started', {
    production: config.isProduction,
    port: config.port,
    trustedProxies: config.trustedProxies,
    messageRetentionDays: config.messageRetentionDays,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    debug('server.stopping', { streams: hub.count() });
    hub.shutdown();
    await stopWorker();
    closeDb();
    debug('server.stopped', {});
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
