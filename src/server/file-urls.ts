import { getConfig } from './config';

/** Widget-facing URL: relative unless FILES_BASE_URL points files at their own host. */
export function fileUrl(fileId: string): string {
  const base = getConfig().filesBaseUrl ?? '';
  return `${base}/files/${fileId}`;
}

/** Webhook-facing URL: must be absolute, so it needs FILES_BASE_URL or PUBLIC_URL. */
export function absoluteFileUrl(fileId: string): string {
  const c = getConfig();
  return `${c.filesBaseUrl ?? c.publicUrl ?? ''}/files/${fileId}`;
}
