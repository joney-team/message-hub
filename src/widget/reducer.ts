import type { ChatMessage, ServerMessage, Sender } from './types';

export type Connection = 'connecting' | 'online' | 'reconnecting';

export interface ChatState {
  status: 'loading' | 'ready' | 'error';
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  typing: Sender | null;
  connection: Connection;
}

export const initialChatState: ChatState = {
  status: 'loading',
  messages: [],
  hasMore: false,
  loadingOlder: false,
  typing: null,
  connection: 'connecting',
};

export type ChatAction =
  | { type: 'loaded'; messages: ServerMessage[]; hasMore: boolean }
  | { type: 'loadFailed' }
  | { type: 'olderStarted' }
  | { type: 'olderLoaded'; messages: ServerMessage[]; hasMore: boolean }
  | { type: 'olderFailed' }
  | { type: 'incoming'; message: ServerMessage }
  | { type: 'optimistic'; message: ChatMessage }
  | { type: 'failed'; clientMessageId: string }
  | { type: 'retrying'; clientMessageId: string }
  | { type: 'typing'; sender: Sender | null }
  | { type: 'connection'; value: Connection };

const isLocal = (m: ChatMessage) => m.seq === 0;

function sameMessage(a: ChatMessage, b: ServerMessage): boolean {
  return a.id === b.id || (!!b.clientMessageId && a.clientMessageId === b.clientMessageId);
}

/** Stored messages in server order; optimistic ones stay at the end until their echo arrives. */
export function upsert(list: ChatMessage[], incoming: ServerMessage): ChatMessage[] {
  const i = list.findIndex((m) => sameMessage(m, incoming));
  if (i !== -1) {
    const next = list.slice();
    next[i] = incoming;
    return next;
  }
  let at = list.length;
  while (at > 0 && isLocal(list[at - 1])) at--;
  return [...list.slice(0, at), incoming, ...list.slice(at)];
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded': {
      // Keep optimistic messages typed while history was loading.
      const locals = state.messages.filter(isLocal);
      return { ...state, status: 'ready', messages: [...action.messages, ...locals.filter((l) => !action.messages.some((m) => sameMessage(l, m)))], hasMore: action.hasMore };
    }
    case 'loadFailed':
      return { ...state, status: 'error' };
    case 'olderStarted':
      return { ...state, loadingOlder: true };
    case 'olderFailed':
      return { ...state, loadingOlder: false };
    case 'olderLoaded': {
      const known = new Set(state.messages.map((m) => m.id));
      return { ...state, loadingOlder: false, hasMore: action.hasMore, messages: [...action.messages.filter((m) => !known.has(m.id)), ...state.messages] };
    }
    case 'incoming': {
      const m = action.message;
      return { ...state, messages: upsert(state.messages, m), typing: m.direction === 'outbound' ? null : state.typing };
    }
    case 'optimistic':
      return { ...state, messages: [...state.messages, action.message] };
    case 'failed':
      return { ...state, messages: state.messages.map((m) => (m.clientMessageId === action.clientMessageId && isLocal(m) ? { ...m, status: 'failed' } : m)) };
    case 'retrying':
      return { ...state, messages: state.messages.map((m) => (m.clientMessageId === action.clientMessageId && isLocal(m) ? { ...m, status: 'sending' } : m)) };
    case 'typing':
      return { ...state, typing: action.sender };
    case 'connection':
      return { ...state, connection: action.value };
  }
}

export function lastSeq(messages: ChatMessage[]): number {
  let max = 0;
  for (const m of messages) if (m.seq > max) max = m.seq;
  return max;
}
