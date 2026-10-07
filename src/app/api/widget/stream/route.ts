import { requireVisitor } from '@/server/http/auth';
import { handle, tooManyRequests } from '@/server/http/errors';
import { hub, type HubEvent } from '@/server/realtime/hub';
import { latestSeq, listMessagesAfter, serializeMessage } from '@/server/services/messages';
import { touchVisitor } from '@/server/services/sessions';
import { debug } from '@/server/log';

export const dynamic = 'force-dynamic';

const PING_MS = 25_000;
const MAX_STREAMS_PER_VISITOR = 5;
const RETRY_MS = 3000;
const REPLAY_MAX = 200;

function frame(event: HubEvent): string | null {
  if (event.type === 'message') return `id: ${event.id}\nevent: message\ndata: ${JSON.stringify(event.data)}\n\n`;
  if (event.type === 'typing') return `event: typing\ndata: ${JSON.stringify(event.data)}\n\n`;
  return null;
}

/**
 * Server-sent events. The client reads it with `fetch` (EventSource cannot send the
 * Authorization header). With `Last-Event-ID` the server first replays stored messages
 * newer than that id (up to 200; a bigger gap sends `event: resync` and the client reloads
 * history), then streams live ones; without it, only live ones.
 */
export const GET = handle((req) => {
  const { visitor } = requireVisitor(req);
  if (hub.countFor(visitor.id) >= MAX_STREAMS_PER_VISITOR) throw tooManyRequests(5);
  touchVisitor(visitor);

  const header = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('lastEventId');
  const resumeFrom = header !== null && /^\d+$/.test(header) ? Number(header) : null;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = resumeFrom ?? 0;
      let closed = false;
      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        debug('sse.disconnected', { visitorId: visitor.id, streams: hub.countFor(visitor.id) });
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const onEvent = (event: HubEvent) => {
        if (event.type === 'shutdown') return close();
        if (event.type === 'message') {
          if (event.id <= last) return; // already sent during replay
          last = event.id;
        }
        const f = frame(event);
        if (f) write(f);
      };

      // Subscribe before replaying; both run synchronously, so nothing can slip in between.
      const off = hub.subscribe(visitor.id, onEvent);
      const ping = setInterval(() => write(': ping\n\n'), PING_MS);
      cleanup = () => {
        off();
        clearInterval(ping);
      };
      req.signal.addEventListener('abort', close);

      write(`retry: ${RETRY_MS}\n\n`);
      if (resumeFrom !== null) {
        const missed = listMessagesAfter(visitor.id, resumeFrom, REPLAY_MAX + 1);
        if (missed.length > REPLAY_MAX) {
          // Too many to replay in one go: tell the client to reload history, then continue live.
          write('event: resync\ndata: {}\n\n');
          last = latestSeq(visitor.id);
          debug('sse.resync', { visitorId: visitor.id, resumeFrom });
        } else {
          for (const m of missed) {
            const dto = serializeMessage(m);
            onEvent({ type: 'message', id: dto.seq, data: dto });
          }
        }
      }
      write(': connected\n\n');
      debug('sse.connected', { visitorId: visitor.id, resumed: resumeFrom !== null, streams: hub.countFor(visitor.id) });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
