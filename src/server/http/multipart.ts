import { badRequest, payloadTooLarge } from './errors';

const OVERHEAD = 64 * 1024; // multipart boundaries and small text fields

/** Reads the request body but gives up as soon as it exceeds `limit` bytes. */
async function readBodyLimited(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > limit) throw payloadTooLarge();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface Upload {
  file: File;
  fields: Record<string, string>;
}

export async function readUpload(req: Request, maxFileBytes: number): Promise<Upload> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw badRequest('INVALID_MULTIPART', 'Expected multipart/form-data');
  const body = await readBodyLimited(req, maxFileBytes + OVERHEAD);
  let form: FormData;
  try {
    form = await new Response(Buffer.from(body), { headers: { 'content-type': type } }).formData();
  } catch {
    throw badRequest('INVALID_MULTIPART', 'Malformed multipart body');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('VALIDATION_ERROR', 'Missing "file" part');
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
  return { file, fields };
}
