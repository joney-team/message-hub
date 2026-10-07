import { getConfig } from './config';

type LogValue = string | number | boolean | null | undefined;

/**
 * Emits structured operational diagnostics only when DEBUG_LOG=true.
 * Callers must never pass message bodies, credentials, IP addresses, or URLs.
 */
export function debug(event: string, fields: Record<string, LogValue> = {}): void {
  if (!getConfig().debugLog) return;
  console.info(`[hub] ${JSON.stringify({ ...fields, level: 'debug', event })}`);
}

/**
 * Emits safe operational failures regardless of DEBUG_LOG so production
 * operators can detect broken integrations.
 */
export function error(event: string, fields: Record<string, LogValue> = {}): void {
  console.error(`[hub] ${JSON.stringify({ ...fields, level: 'error', event })}`);
}
