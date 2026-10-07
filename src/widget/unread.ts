import type { ServerMessage } from './types';

/**
 * Unread agent messages for a visitor returning to a page. `readSeq` is the highest seq they
 * saw with the chat open; with nothing stored yet, whatever is already in history counts as read.
 */
export function computeUnread(messages: ServerMessage[], readSeq: number | null): { unread: number; maxSeq: number } {
  const maxSeq = messages.reduce((m, x) => Math.max(m, x.seq), 0);
  const baseline = readSeq ?? maxSeq;
  return { unread: messages.filter((m) => m.direction === 'outbound' && m.seq > baseline).length, maxSeq };
}
