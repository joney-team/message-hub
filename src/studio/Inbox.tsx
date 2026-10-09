'use client';

import {
  ChevronDown,
  Inbox as InboxIcon,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChannelDto,
  type ConversationDto,
  type StudioMessageDto,
} from './types';
import { tokenize } from '@/widget/linkify';
import { studioApi } from './api';

function visitorName(conversation: ConversationDto): string {
  const profile = conversation.visitor.profile;
  for (const key of ['name', 'fullName', 'email', 'phone']) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return conversation.visitor.id;
}

function previewText(message: StudioMessageDto): string {
  if (message.text.trim()) return message.text.replace(/\s+/g, ' ');
  if (message.attachments.length === 1) return message.attachments[0].name;
  return `${message.attachments.length} attachments`;
}

function messageTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay ? { timeStyle: 'short' } : { month: 'short', day: 'numeric' }).format(date);
}

function MessageText({ text }: { text: string }) {
  return (
    <p>
      {tokenize(text).map((token, index) =>
        token.type === 'link' ? (
          <a
            className="studio-thread-link"
            key={index}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
          >
            {token.value}
          </a>
        ) : (
          token.value
        ),
      )}
    </p>
  );
}

export function Inbox({ channels }: { channels: ChannelDto[] }) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [messages, setMessages] = useState<StudioMessageDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reply, setReply] = useState('');
  const [senderName, setSenderName] = useState('');
  const [sending, setSending] = useState(false);
  const [deletingVisitorId, setDeletingVisitorId] = useState<string | null>(null);
  const listRequest = useRef(0);
  const historyRequest = useRef(0);
  const selectedVisitor = useRef<string | null>(null);
  const messageList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    queueMicrotask(() => setSenderName(sessionStorage.getItem('message-hub:studio-sender-name') ?? ''));
  }, []);

  const selectConversation = useCallback((visitorId: string | null) => {
    selectedVisitor.current = visitorId;
    historyRequest.current++;
    setSelectedVisitorId(visitorId);
    setMessages([]);
    setHistoryHasMore(false);
    setHistoryError(null);
    setLoadingOlder(false);
  }, []);

  const loadConversations = useCallback(
    async (quiet = false) => {
      const request = ++listRequest.current;
      if (!quiet) setLoading(true);
      setListError(null);
      try {
        const filter = channelId === 'all' ? '' : `&channelId=${encodeURIComponent(channelId)}`;
        const result = await studioApi<{ data: ConversationDto[]; hasMore: boolean }>(
          `/api/v1/conversations?limit=100${filter}`,
        );
        if (request !== listRequest.current) return;
        setConversations(result.data);
        setHasMore(result.hasMore);
        const current = selectedVisitor.current;
        const next =
          current && result.data.some((item) => item.visitor.id === current)
            ? current
            : (result.data[0]?.visitor.id ?? null);
        if (next !== current) selectConversation(next);
      } catch (error) {
        if (request === listRequest.current) {
          setListError(error instanceof Error ? error.message : 'Could not load conversations');
        }
      } finally {
        if (request === listRequest.current) setLoading(false);
      }
    },
    [channelId, selectConversation],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void loadConversations(), 0);
    const timer = window.setInterval(() => void loadConversations(true), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadConversations]);

  const loadHistory = useCallback(
    async (visitorId: string, quiet = false) => {
      const request = ++historyRequest.current;
      if (!quiet) setHistoryLoading(true);
      setHistoryError(null);
      try {
        const result = await studioApi<{ data: StudioMessageDto[]; hasMore: boolean }>(
          `/api/v1/visitors/${encodeURIComponent(visitorId)}/messages?limit=50`,
        );
        if (request !== historyRequest.current) return;
        setMessages((current) => {
          if (!quiet || !result.data.length) return result.data;
          const firstLatestSeq = result.data[0].seq;
          const older = current.filter((message) => message.seq < firstLatestSeq);
          return [...older, ...result.data];
        });
        if (!quiet) setHistoryHasMore(result.hasMore);
        if (!quiet) {
          requestAnimationFrame(() => {
            const element = messageList.current;
            if (element) element.scrollTop = element.scrollHeight;
          });
        }
      } catch (error) {
        if (request === historyRequest.current) {
          setHistoryError(error instanceof Error ? error.message : 'Could not load messages');
        }
      } finally {
        if (request === historyRequest.current) setHistoryLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedVisitorId) return;
    historyRequest.current++;
    const initial = window.setTimeout(() => void loadHistory(selectedVisitorId), 0);
    const timer = window.setInterval(() => void loadHistory(selectedVisitorId, true), 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadHistory, selectedVisitorId]);

  const selected = conversations.find((item) => item.visitor.id === selectedVisitorId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) =>
      [
        visitorName(conversation),
        conversation.visitor.id,
        conversation.channel.name,
        conversation.channel.ref ?? '',
        previewText(conversation.latestMessage),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [conversations, query]);

  const loadOlder = async () => {
    if (!selectedVisitorId || !messages[0] || loadingOlder) return;
    const visitorId = selectedVisitorId;
    const request = ++historyRequest.current;
    setLoadingOlder(true);
    setHistoryError(null);
    const element = messageList.current;
    const previousHeight = element?.scrollHeight ?? 0;
    try {
      const result = await studioApi<{ data: StudioMessageDto[]; hasMore: boolean }>(
        `/api/v1/visitors/${encodeURIComponent(visitorId)}/messages?limit=50&before=${messages[0].seq}`,
      );
      if (request !== historyRequest.current) return;
      setMessages((current) => [...result.data, ...current]);
      setHistoryHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not load older messages');
    } finally {
      if (request === historyRequest.current) setLoadingOlder(false);
    }
  };

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    const text = reply.trim();
    if (!selectedVisitorId || !text || sending) return;
    setSending(true);
    setHistoryError(null);
    try {
      const message = await studioApi<StudioMessageDto>(
        `/api/v1/visitors/${encodeURIComponent(selectedVisitorId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            ...(senderName.trim() ? { sender: { name: senderName.trim() } } : {}),
          }),
        },
      );
      historyRequest.current++;
      setMessages((current) => [...current.filter((item) => item.id !== message.id), message]);
      setReply('');
      void loadConversations(true);
      requestAnimationFrame(() => {
        const element = messageList.current;
        if (element) element.scrollTop = element.scrollHeight;
      });
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  const deleteSelectedConversation = async () => {
    if (!selected || deletingVisitorId) return;
    const visitorId = selected.visitor.id;
    const name = visitorName(selected);
    const confirmed = window.confirm(
      `Delete the conversation with "${name}"?\n\nThis permanently deletes all messages in this conversation. The visitor can start a new conversation by sending another message.`,
    );
    if (!confirmed) return;

    setDeletingVisitorId(visitorId);
    setHistoryError(null);
    try {
      await studioApi<void>(`/api/v1/visitors/${encodeURIComponent(visitorId)}/messages`, {
        method: 'DELETE',
      });
      listRequest.current++;
      historyRequest.current++;

      const deletedIndex = conversations.findIndex((conversation) => conversation.visitor.id === visitorId);
      const remaining = conversations.filter((conversation) => conversation.visitor.id !== visitorId);
      setConversations(remaining);
      if (selectedVisitor.current === visitorId) {
        const next = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)] ?? null;
        selectConversation(next?.visitor.id ?? null);
      }
      void loadConversations(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not delete conversation');
    } finally {
      setDeletingVisitorId(null);
    }
  };

  return (
    <section className="studio-inbox">
      <aside className="studio-inbox-list">
        <header className="studio-inbox-title">
          <div>
            <p className="studio-kicker">Unified inbox</p>
            <h2>Customer messages</h2>
          </div>
          <button
            className="studio-icon-button"
            type="button"
            title="Refresh conversations"
            aria-label="Refresh conversations"
            onClick={() => void loadConversations()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'studio-spin' : ''} size={17} />
          </button>
        </header>
        <div className="studio-inbox-controls">
          <label className="studio-inbox-channel-filter">
            <MessageCircle size={15} />
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              <option value="all">All channels</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="studio-inbox-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" />
          </label>
        </div>
        {listError && <p className="studio-inbox-error">{listError}</p>}
        {hasMore && <p className="studio-inbox-limit">Showing the latest 100 conversations.</p>}
        <div className="studio-conversation-list">
          {filtered.map((conversation) => (
            <button
              key={conversation.visitor.id}
              type="button"
              data-active={conversation.visitor.id === selectedVisitorId}
              onClick={() => selectConversation(conversation.visitor.id)}
            >
              <span className="studio-conversation-avatar">
                <UserRound size={16} />
              </span>
              <span className="studio-conversation-copy">
                <span>
                  <strong>{visitorName(conversation)}</strong>
                  <time dateTime={conversation.latestMessage.createdAt}>{messageTime(conversation.latestMessage.createdAt)}</time>
                </span>
                <small>{conversation.channel.name}</small>
                <p>{previewText(conversation.latestMessage)}</p>
              </span>
            </button>
          ))}
          {!loading && !filtered.length && (
            <div className="studio-inbox-empty">
              <InboxIcon size={24} />
              <strong>{conversations.length ? 'No conversations match your search' : 'No customer messages yet'}</strong>
            </div>
          )}
        </div>
      </aside>

      <section className="studio-inbox-thread">
        {selected ? (
          <>
            <header className="studio-thread-head">
              <div className="studio-thread-identity">
                <span className="studio-conversation-avatar">
                  <UserRound size={17} />
                </span>
                <div>
                  <h2>{visitorName(selected)}</h2>
                  <p>
                    {selected.channel.name}
                    {selected.visitor.locale ? ` · ${selected.visitor.locale}` : ''}
                    {selected.visitor.origin ? ` · ${selected.visitor.origin}` : ''}
                  </p>
                </div>
              </div>
              <div className="studio-thread-actions">
                <code>{selected.visitor.id}</code>
                <button
                  className="studio-icon-button"
                  data-tone="danger"
                  type="button"
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  onClick={() => void deleteSelectedConversation()}
                  disabled={deletingVisitorId !== null}
                >
                  {deletingVisitorId === selected.visitor.id ? (
                    <LoaderCircle className="studio-spin" size={17} />
                  ) : (
                    <Trash2 size={17} />
                  )}
                </button>
              </div>
            </header>
            <div className="studio-thread-messages" ref={messageList}>
              {historyHasMore && (
                <button className="studio-thread-older" type="button" onClick={() => void loadOlder()} disabled={loadingOlder}>
                  {loadingOlder ? <LoaderCircle className="studio-spin" size={14} /> : null}
                  {loadingOlder ? 'Loading' : 'Load older messages'}
                </button>
              )}
              {historyLoading && !messages.length ? (
                <div className="studio-thread-state">
                  <LoaderCircle className="studio-spin" size={22} />
                </div>
              ) : (
                <ol>
                  {messages.map((message) => {
                    const outbound = message.direction === 'outbound';
                    return (
                      <li key={message.id} data-direction={message.direction}>
                        <div className="studio-thread-message-meta">
                          <strong>{outbound ? message.sender?.name || 'Agent' : visitorName(selected)}</strong>
                          <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
                        </div>
                        <div className="studio-thread-bubble">
                          {message.text && <MessageText text={message.text} />}
                          {message.attachments.map((attachment) => (
                            <a
                              className="studio-thread-attachment"
                              key={attachment.fileId}
                              href={attachment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Paperclip size={14} />
                              <span>{attachment.name}</span>
                            </a>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <form className="studio-thread-composer" onSubmit={(event) => void sendReply(event)}>
              {historyError && <p className="studio-inbox-error">{historyError}</p>}
              <label>
                <span>Sender name</span>
                <input
                  value={senderName}
                  onChange={(event) => {
                    setSenderName(event.target.value);
                    sessionStorage.setItem('message-hub:studio-sender-name', event.target.value);
                  }}
                  disabled={deletingVisitorId !== null}
                  maxLength={100}
                  placeholder="Support agent"
                />
              </label>
              <div>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  disabled={deletingVisitorId !== null}
                  maxLength={4000}
                  rows={3}
                  placeholder="Write a reply"
                />
                <button className="studio-primary" type="submit" disabled={!reply.trim() || sending || deletingVisitorId !== null}>
                  {sending ? <LoaderCircle className="studio-spin" size={17} /> : <Send size={17} />}
                  {sending ? 'Sending' : 'Send'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="studio-thread-state">
            <InboxIcon size={30} />
            <h2>Select a conversation</h2>
            <p>Customer messages from every channel appear here.</p>
          </div>
        )}
      </section>
    </section>
  );
}
