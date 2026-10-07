import en from './messages/en.json';
import vi from './messages/vi.json';
import ko from './messages/ko.json';
import zh from './messages/zh.json';
import ja from './messages/ja.json';
import th from './messages/th.json';
import fr from './messages/fr.json';
import ru from './messages/ru.json';
import type { MessageKey } from './catalog';

/** Server-only: every catalog at once (for `meta` and settings validation). */
export const ALL_CATALOGS: Record<string, Record<string, string>> = { en, vi, ko, zh, ja, th, fr, ru };

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}
