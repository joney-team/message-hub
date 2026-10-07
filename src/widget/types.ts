export interface Attachment {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface Sender {
  id?: string;
  name?: string;
  avatar?: string;
}

export interface ServerMessage {
  id: string;
  seq: number;
  direction: 'inbound' | 'outbound';
  text: string;
  attachments: Attachment[];
  sender: Sender | null;
  clientMessageId: string | null;
  createdAt: string;
}

/** A message as shown: stored ones plus optimistic ones that are still sending or failed. */
export interface ChatMessage extends ServerMessage {
  status?: 'sending' | 'failed';
}

export interface PageContext {
  url?: string;
  title?: string;
  referrer?: string;
}

export type Profile = Record<string, string | number>;

export interface VisitorInfo {
  id: string;
  locale: string | null;
  profile: Profile;
}
