import type { MessageDto } from '../services/messages';
import type { Sender } from '../db/schema';

export type HubEvent =
  | { type: 'message'; id: number; data: MessageDto }
  | { type: 'typing'; data: { sender: Sender | null } }
  | { type: 'shutdown' };

export type Subscriber = (event: HubEvent) => void;

/** In-memory pub/sub, one set of subscribers per visitor. Valid because we run a single instance. */
class Hub {
  private subs = new Map<string, Set<Subscriber>>();

  subscribe(visitorId: string, fn: Subscriber): () => void {
    let set = this.subs.get(visitorId);
    if (!set) this.subs.set(visitorId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.subs.delete(visitorId);
    };
  }

  publish(visitorId: string, event: HubEvent): void {
    for (const fn of [...(this.subs.get(visitorId) ?? [])]) {
      try {
        fn(event);
      } catch {
        // A broken subscriber must not affect the others.
      }
    }
  }

  /** Tells every stream to close (graceful shutdown). */
  shutdown(): void {
    for (const id of [...this.subs.keys()]) this.publish(id, { type: 'shutdown' });
  }

  countFor(visitorId: string): number {
    return this.subs.get(visitorId)?.size ?? 0;
  }

  count(): number {
    let n = 0;
    for (const set of this.subs.values()) n += set.size;
    return n;
  }
}

const g = globalThis as unknown as { __hub_rt?: Hub };
export const hub: Hub = (g.__hub_rt ??= new Hub());
