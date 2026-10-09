import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

export interface Attachment {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}

export interface Sender {
  id?: string;
  name?: string;
  avatar?: string;
}

export interface MessageContext {
  url?: string;
  title?: string;
  referrer?: string;
}

export const channels = sqliteTable(
  'channels',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    ref: text('ref'),
    webhookUrl: text('webhook_url'),
    webhookSecret: text('webhook_secret').notNull(),
    settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    allowedOrigins: text('allowed_origins', { mode: 'json' }).$type<string[]>().notNull(),
    connectedAt: ts('connected_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('channels_owner_ref_idx').on(t.owner, t.ref)],
);

export const visitors = sqliteTable(
  'visitors',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    locale: text('locale'),
    profile: text('profile', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    userAgent: text('user_agent'),
    origin: text('origin'),
    lastSeenAt: ts('last_seen_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('visitors_token_hash_idx').on(t.tokenHash),
    index('visitors_channel_last_seen_idx').on(t.channelId, t.lastSeenAt),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    visitorId: text('visitor_id')
      .notNull()
      .references(() => visitors.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    text: text('text').notNull(),
    attachments: text('attachments', { mode: 'json' }).$type<Attachment[]>().notNull(),
    sender: text('sender', { mode: 'json' }).$type<Sender>(),
    context: text('context', { mode: 'json' }).$type<MessageContext>(),
    clientMessageId: text('client_message_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('messages_id_idx').on(t.id),
    index('messages_visitor_seq_idx').on(t.visitorId, t.seq),
    uniqueIndex('messages_visitor_client_msg_idx').on(t.visitorId, t.clientMessageId),
  ],
);

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    visitorId: text('visitor_id').references(() => visitors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('files_channel_idx').on(t.channelId)],
);

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'delivered', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull(),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull(),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [
    index('deliveries_status_next_idx').on(t.status, t.nextAttemptAt),
    index('deliveries_channel_status_idx').on(t.channelId, t.status, t.id),
  ],
);

export const studioCredentials = sqliteTable('studio_credentials', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const studioSessions = sqliteTable(
  'studio_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('studio_sessions_expires_idx').on(t.expiresAt)],
);
