import type { z } from 'zod';
import { badRequest, payloadTooLarge } from './errors';

export const DEFAULT_JSON_LIMIT = 256 * 1024;

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
    .join('; ');
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest('VALIDATION_ERROR', describe(result.error));
  return result.data;
}

/** Reads a JSON body with a hard size limit, then validates it. */
export async function readJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  limit = DEFAULT_JSON_LIMIT,
): Promise<z.output<S>> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > limit) throw payloadTooLarge();
  const text = await req.text();
  if (text.length > limit) throw payloadTooLarge();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('INVALID_JSON', 'Body must be valid JSON');
  }
  return parse(schema, value);
}

export function readQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return parse(schema, params);
}
