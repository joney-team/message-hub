export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (message = 'Missing or invalid credentials') =>
  new ApiError(401, 'UNAUTHORIZED', message, { 'WWW-Authenticate': 'Bearer' });
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const payloadTooLarge = (message = 'Payload too large') => new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new ApiError(429, 'RATE_LIMITED', 'Too many requests', { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) });

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export function errorResponse(status: number, code: string, message: string, headers?: Record<string, string>): Response {
  return json({ error: { code, message } }, { status, headers });
}

type RouteContext<P> = { params: Promise<P> };

/**
 * Wraps a route handler: ApiError → `{error:{code,message}}`, anything else → 500
 * without leaking internals.
 */
export function handle<P = Record<string, never>>(
  fn: (req: Request, params: P) => Promise<Response> | Response,
): (req: Request, ctx: RouteContext<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const params = (await ctx?.params) ?? ({} as P);
      return await fn(req, params);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message, err.headers);
      console.error('[hub] unhandled route error:', err instanceof Error ? err.message : 'unknown');
      return errorResponse(500, 'INTERNAL', 'Internal server error');
    }
  };
}
