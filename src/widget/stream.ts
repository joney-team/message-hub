import { SseParser, type SseFrame } from './sse';
import type { Connection } from './reducer';

const WATCHDOG_MS = 60_000; // the server pings every 25 s
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;

export interface StreamOptions {
  token: string;
  /** Highest message seq known right now; sent as `Last-Event-ID` so a reconnect fills the gap. */
  lastSeq: () => number;
  onFrame: (frame: SseFrame) => void;
  onConnection: (state: Connection) => void;
  onUnauthorized: () => void;
}

/**
 * Reads the SSE stream with `fetch` (EventSource cannot send an Authorization header)
 * and reconnects with backoff. Returns a function that stops it.
 */
export function connectStream(opts: StreamOptions): () => void {
  const stop = new AbortController();
  let backoff = MIN_BACKOFF_MS;
  let serverRetry = 0;

  const run = async () => {
    while (!stop.signal.aborted) {
      const attempt = new AbortController();
      const abortAttempt = () => attempt.abort();
      stop.signal.addEventListener('abort', abortAttempt, { once: true });
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(abortAttempt, WATCHDOG_MS);
      };
      try {
        arm();
        const res = await fetch('/api/widget/stream', {
          headers: { Authorization: `Bearer ${opts.token}`, 'Last-Event-ID': String(opts.lastSeq()), Accept: 'text/event-stream' },
          signal: attempt.signal,
          cache: 'no-store',
        });
        if (res.status === 401) return opts.onUnauthorized();
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        opts.onConnection('online');
        backoff = MIN_BACKOFF_MS;
        const parser = new SseParser((ms) => (serverRetry = ms));
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          for (const frame of parser.push(value)) opts.onFrame(frame);
        }
      } catch {
        // fall through to reconnect
      } finally {
        clearTimeout(watchdog);
        stop.signal.removeEventListener('abort', abortAttempt);
      }
      if (stop.signal.aborted) return;
      opts.onConnection('reconnecting');
      const wait = Math.max(serverRetry, backoff) * (0.8 + Math.random() * 0.4);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      await new Promise((r) => setTimeout(r, wait));
    }
  };
  void run();
  return () => stop.abort();
}
