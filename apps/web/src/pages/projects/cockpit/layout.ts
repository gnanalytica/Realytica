import { readPref, writePref } from '../../../lib/prefs';

/**
 * The cockpit's three layouts — presets rather than draggable panels.
 */
export type CockpitLayout = 'cockpit' | 'study' | 'focus';

export interface LayoutSpec {
  chat: number | null;
  rightPane: boolean;
}

export const LAYOUTS: Record<CockpitLayout, LayoutSpec> = {
  cockpit: { chat: 520, rightPane: true },
  study: { chat: 372, rightPane: true },
  focus: { chat: null, rightPane: false },
};

export const LAYOUT_LABEL: Record<CockpitLayout, string> = {
  cockpit: 'Cockpit',
  study: 'Study',
  focus: 'Focus',
};

const KEY = 'cockpitChatWidth';
const MIN_CHAT = 320;
const MAX_CHAT = 720;

export function clampChatWidth(px: number): number {
  return Math.max(MIN_CHAT, Math.min(MAX_CHAT, Math.round(px)));
}

export function readChatWidth(): number | null {
  const raw = readPref(KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampChatWidth(n) : null;
}

export function writeChatWidth(px: number): void {
  writePref(KEY, String(clampChatWidth(px)));
}
