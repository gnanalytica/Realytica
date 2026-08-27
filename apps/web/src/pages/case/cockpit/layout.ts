import { readPref, writePref } from '../../../lib/prefs';

/**
 * The cockpit's three layouts — and why they are presets rather than
 * draggable panels.
 *
 * An editor earns panel-dragging: one profession, all day, people who enjoy
 * configuring. A valuer configures nothing, and most people keep whatever the
 * default is — so the default IS the design, and free-form panels pay for
 * that flexibility twice while turning a decision we owe the reader into a
 * question we hand back to them.
 *
 * So the layout changes with the TASK instead. `study` is entered by opening
 * a document or the graph, never by choosing it; `focus` is the one a person
 * picks. Panes still collapse and dividers still drag — that is the ninety
 * percent of "customisable" anyone actually uses.
 */
export type CockpitLayout = 'cockpit' | 'study' | 'focus';

export interface LayoutSpec {
  /** Chat column width in px. `null` means "take what is left". */
  chat: number | null;
  /** Whether the right pane is rendered at all. */
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

/** The width the reader last left the chat column at, if any. */
export function readChatWidth(): number | null {
  const raw = readPref(KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampChatWidth(n) : null;
}

export function writeChatWidth(px: number): void {
  writePref(KEY, String(clampChatWidth(px)));
}
