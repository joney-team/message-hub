import type { Attachment, PageContext, Profile, ServerMessage, VisitorInfo } from './types';

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, opts: { method?: string; token?: string | null; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? 'GET', headers, body, signal: opts.signal, cache: 'no-store' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError('NETWORK', 0, 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiClientError(typeof e?.code === 'string' ? e.code : 'INTERNAL', res.status, typeof e?.message === 'string' ? e.message : 'Request failed');
  }
  return data as T;
}

export interface SendBody {
  text: string;
  attachments: Array<{ fileId: string }>;
  clientMessageId: string;
  context?: PageContext;
}

export const api = {
  createSession: (channelId: string, input: { locale?: string; profile?: Profile; origin?: string }) =>
    request<{ visitor: VisitorInfo; token: string }>('/api/widget/sessions', { method: 'POST', body: { channelId, ...input } }),
  me: (token: string) => request<{ visitor: VisitorInfo }>('/api/widget/me', { token }),
  updateMe: (token: string, body: { locale?: string; profile?: Profile }) => request<{ visitor: VisitorInfo }>('/api/widget/me', { method: 'PATCH', token, body }),
  revoke: (token: string) => request<void>('/api/widget/me', { method: 'DELETE', token }),
  messages: (token: string, params: { before?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.before) q.set('before', String(params.before));
    if (params.limit) q.set('limit', String(params.limit));
    return request<{ data: ServerMessage[]; hasMore: boolean }>(`/api/widget/messages?${q}`, { token });
  },
  send: (token: string, body: SendBody) => request<ServerMessage>('/api/widget/messages', { method: 'POST', token, body }),
  upload: (token: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return request<Omit<Attachment, 'fileId'> & { id: string }>('/api/widget/files', { method: 'POST', token, form });
  },
};
