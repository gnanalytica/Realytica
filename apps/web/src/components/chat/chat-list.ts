/**
 * The chats of a project, as the list in the chat's header shows them.
 *
 * Kept apart from the component that draws the list so the rules can be
 * asked without a browser: which chat is on screen, what each row says, and
 * what a search finds.
 */

import { PLAN_SAID, PLAN_STEP, can, chatPlaceWords, filedByReply, reachesEveryProject, type ChatSession, type ProjectChatTurn, type WaitingEntry, type WorkspaceRole } from '@realytica/shared';

export interface ChatRow {
  id: string;
  /** The name a person gave it, or the question it opened with. */
  title: string;
  /** A person named it: the row then offers its first question as the way back. */
  named: boolean;
  /** When it was last spoken in. */
  at: string;
  /** The page it began on, with the stage it was looked at in, where the chat kept one. */
  place?: string;
  /** The chat on screen. */
  current: boolean;
}

/** A chat's day as a list says it: "2 Oct", with the year once it is another one. */
export function chatDay(iso: string, now = new Date()): string {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return '';
  return day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

// Which turns are the chat on screen is asked of the same reading the chat itself uses, so the two cannot differ.
export { liveChatId, liveTurns } from '@realytica/shared';

/**
 * What is waiting that the chat on screen does not show: the cards and the
 * documents of chats other than this one. It is what "still waiting from
 * earlier" counts, so a chat that carries on an earlier one does not count
 * that chat's own cards as somewhere else.
 */
export function waitingElsewhere(entries: readonly WaitingEntry[], onScreen: readonly ProjectChatTurn[]): WaitingEntry[] {
  const cards = new Set(onScreen.flatMap((turn) => turn.proposalIds ?? []));
  // The papers a reply filed are the ones it shows as waiting. One an answer only quotes is still somewhere else.
  const papers = new Set(onScreen.flatMap((turn) => filedByReply(turn)));
  return entries.filter((entry) => (entry.proposalId ? !cards.has(entry.proposalId) : entry.evidenceId ? !papers.has(entry.evidenceId) : false));
}

/**
 * The rows of the list: the chat on screen first, once it holds something,
 * then the earlier chats with the one last spoken in at the top.
 *
 * An earlier chat is left out when everything in it is already on screen.
 * That is the note the server wrote during this sitting: it is grouped as a
 * chat of its own because it names no sitting, and listing it would offer the
 * person a way back to what they are looking at.
 */
export function chatRows(sessions: readonly ChatSession[], shown: readonly ProjectChatTurn[], liveId: string | undefined): ChatRow[] {
  const onScreen = new Set(shown.map((turn) => turn.id));
  const rows: ChatRow[] = [];
  for (const session of sessions) {
    const current = session.id === liveId;
    if (!current && session.turns.every((turn) => onScreen.has(turn.id))) continue;
    const place = session.place ? chatPlaceWords(session.place) : undefined;
    rows.push({ id: session.id, title: session.name ?? session.title, named: Boolean(session.name), at: session.lastAt, ...(place ? { place } : {}), current });
  }
  return [...rows.filter((row) => row.current), ...rows.filter((row) => !row.current)];
}

/** The rows that hold every word typed, in their name, the page they began on or their day. */
export function searchChats(rows: readonly ChatRow[], query: string, now = new Date()): ChatRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((row) => {
    const text = `${row.title} ${row.place ?? ''} ${chatDay(row.at, now)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Past this many earlier chats, the list has a search field. */
export const SEARCH_CHATS_PAST = 8;

/** One stretch of work on a project's chat: its id, when it began, and the earlier chat it carries on, when it carries one on. */
export interface Sitting {
  project: string;
  id: string;
  startedAt: string;
  continues?: string;
}

/**
 * A new sitting. Its id is the project, the moment and a few characters of
 * chance, so two people who open one project in the same millisecond do not
 * mint the same one.
 */
export function mintSitting(projectId: string, continues?: string): Sitting {
  const now = Date.now();
  return { project: projectId, id: `ses_${projectId.slice(-6)}_${now.toString(36)}${chance()}`, startedAt: new Date(now).toISOString(), ...(continues ? { continues } : {}) };
}

/**
 * Eight characters of chance. Four were too few: of two hundred ids minted in
 * one millisecond, two matched about once in eighty tries.
 */
function chance(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

/**
 * The sitting as the server kept it.
 *
 * The server keeps a person's turns under the id the page sent, unless that
 * id is already somebody else's: then it keeps them under one of this
 * person's own, made from the one sent. The page takes that id from the
 * reply, so the person goes on seeing what they said. Only an id made from
 * the one this sitting sent is taken: a reply to an older sitting, arriving
 * after a new chat was started, changes nothing.
 */
export function sittingKept<T extends { id: string }>(sitting: T, reply: { userTurn?: { sessionId?: string } }): T {
  const kept = reply.userTurn?.sessionId;
  return kept && kept !== sitting.id && kept.startsWith(`${sitting.id}~`) ? { ...sitting, id: kept } : sitting;
}

/**
 * The message a send left in the thread, when it left one.
 *
 * A send that failed, or that the person stopped, may have been kept all the
 * same: the server answers by rule in a moment, and goes on with a plan or a
 * drop of papers when the page stops listening. `had` is the turns that were
 * there before the send. What is looked for is the person's own turn that
 * was not, in this sitting: under the id the page sent, or one the server
 * made from it.
 */
export function turnKept<T extends { id: string; role: string; sessionId?: string }>(conversation: readonly T[], had: ReadonlySet<string>, sittingId: string): T | undefined {
  return conversation.find((turn) => turn.role === 'user' && !had.has(turn.id) && (turn.sessionId === sittingId || Boolean(turn.sessionId?.startsWith(`${sittingId}~`))));
}

/**
 * Whether the thread is still followed to its foot after a scroll. It is
 * while the person is at the foot, it stops when they scroll up to read, and
 * it starts again when they come back down. `fromFoot` is how far the foot
 * is below what is in view.
 */
export function followsThread(was: boolean, scroll: { top: number; lastTop: number; fromFoot: number }): boolean {
  if (scroll.fromFoot < 24) return true;
  return scroll.top < scroll.lastTop ? false : was;
}

/** Whether a reply's own words say its plan was cancelled before any of it ran. */
export function saysPlanCancelled(text: string): boolean {
  return /\bplan is cancelled\. Nothing was done\./i.test(text);
}

/**
 * The reply each plan is drawn under, by the reply's id.
 *
 * A plan is drawn once, under the last reply on screen that names it. One
 * exception: the reply that says a plan was cancelled before it ran says all
 * there is to say of it. The plan is then drawn under the reply before that
 * one, which listed its steps, so the steps do not read as still on offer.
 */
export function planDrawnUnder<T extends { id: string; role: string; text: string; planId?: string }>(turns: readonly T[]): Map<string, string> {
  const naming = new Map<string, T[]>();
  for (const turn of turns) {
    if (turn.role !== 'assistant' || !turn.planId) continue;
    naming.set(turn.planId, [...(naming.get(turn.planId) ?? []), turn]);
  }
  const under = new Map<string, string>();
  for (const [planId, replies] of naming) {
    const last = replies.at(-1)!;
    const shown = replies.length > 1 && saysPlanCancelled(last.text) ? replies.at(-2)! : last;
    under.set(shown.id, planId);
  }
  return under;
}

/**
 * The messages a plan's steps said to the chat, by id, each with the step
 * it was.
 *
 * A plan carries some steps out by saying their sentence to the chat, as a
 * person would, and the thread then holds that sentence as a message nobody
 * typed. It is known by what follows it: its reply, and straight after that
 * the line the plan ticks the step off with ("Step 2 of 5 done").
 */
export function planStepAsks<T extends { id: string; role: string; text: string; toolCalls?: { name: string }[] }>(turns: readonly T[]): Map<string, { step: number; of: number }> {
  const asks = new Map<string, { step: number; of: number }>();
  const plans = (turn: T | undefined): boolean => Boolean(turn?.toolCalls?.some((call) => call.name === PLAN_STEP || call.name === PLAN_SAID));
  turns.forEach((turn, at) => {
    const reply = turns[at + 1];
    const tick = turns[at + 2];
    if (turn.role !== 'user' || reply?.role !== 'assistant' || plans(reply) || tick?.role !== 'assistant') return;
    const ticked = tick.toolCalls?.some((call) => call.name === PLAN_STEP) ? /^Step (\d+) of (\d+) /.exec(tick.text) : null;
    if (ticked) asks.set(turn.id, { step: Number(ticked[1]), of: Number(ticked[2]) });
  });
  return asks;
}

/**
 * Whether a person may delete every chat on a project: the firm's own people
 * who can change things. It is what the route allows, asked here only so the
 * control is not shown to somebody the route would refuse.
 */
export function mayDeleteChats(role: WorkspaceRole | undefined): boolean {
  return Boolean(role && reachesEveryProject(role) && can(role, 'write'));
}
