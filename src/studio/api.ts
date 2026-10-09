import { formatApiError, type ApiErrorBody } from './types';

export const STUDIO_UNAUTHORIZED_EVENT = 'message-hub:studio-unauthorized';

export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function studioApi<T>(
  path: string,
  init?: RequestInit,
  options: { notifyUnauthorized?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // The status still gives a useful error when a proxy returns a non-JSON body.
    }
    if (response.status === 401 && options.notifyUnauthorized !== false) {
      window.dispatchEvent(new Event(STUDIO_UNAUTHORIZED_EVENT));
    }
    throw new StudioApiError(response.status, formatApiError(response.status, body));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
