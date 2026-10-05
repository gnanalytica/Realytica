/**
 * The chats of a project, as the list in the chat's header shows them.
 *
 * Kept apart from the component that draws the list so the rules can be
 * asked without a browser: which chat is on screen, what each row says, and
 * what a search finds.
 */

import { can, chatPlaceWords, reachesEveryProject, type ChatSession, type ProjectChatTurn, type WaitingEntry, type WorkspaceRole } from '@realytica/shared';

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

/**
 * The turns of the chat on screen, in the order they were said.
 *
 * It is this sitting's turns, and with them the turns of the earlier chat the
 * sitting carries on, when it carries one on. A turn the server wrote outside
 * a chat request (the note after a filed document was read) names no sitting,
 * and belongs to the chat that was open when it was written.
 */
export function liveTurns(
  spoken: readonly ProjectChatTurn[],
  sessions: readonly ChatSession[],
  sitting: { sessionId?: string; startedAt?: string; continues?: string },
): ProjectChatTurn[] {
  if (!sitting.sessionId) return [...spoken];
  const live = liveChatId(sessions, sitting);
  const chatOf = new Map<string, string>();
  for (const session of sessions) for (const turn of session.turns) chatOf.set(turn.id, session.id);
  // This sitting's own turns are on screen whatever chat they were grouped into. The chat it meant to carry on may be gone.
  return spoken.filter(
    (turn) => chatOf.get(turn.id) === live || turn.sessionId === sitting.sessionId || (!turn.sessionId && sitting.startedAt !== undefined && turn.at >= sitting.startedAt),
  );
}

/**
 * The chat on screen, by the id the list knows it by: the earlier chat this
 * sitting carries on while that chat is still there, otherwise the sitting
 * itself. An earlier chat stops being there when the thread is cleared.
 */
export function liveChatId(sessions: readonly ChatSession[], sitting: { sessionId?: string; continues?: string }): string | undefined {
  return sitting.continues && sessions.some((session) => session.id === sitting.continues) ? sitting.continues : sitting.sessionId;
}

/**
 * What is waiting that the chat on screen does not show: the cards and the
 * documents of chats other than this one. It is what "still waiting from
 * earlier" counts, so a chat that carries on an earlier one does not count
 * that chat's own cards as somewhere else.
 */
export function waitingElsewhere(entries: readonly WaitingEntry[], onScreen: readonly ProjectChatTurn[]): WaitingEntry[] {
  const cards = new Set(onScreen.flatMap((turn) => turn.proposalIds ?? []));
  const papers = new Set(onScreen.flatMap((turn) => turn.citedEvidenceIds ?? []));
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
  const chance = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return { project: projectId, id: `ses_${projectId.slice(-6)}_${now.toString(36)}${chance}`, startedAt: new Date(now).toISOString(), ...(continues ? { continues } : {}) };
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
 * Whether a person may delete every chat on a project: the firm's own people
 * who can change things. It is what the route allows, asked here only so the
 * control is not shown to somebody the route would refuse.
 */
export function mayDeleteChats(role: WorkspaceRole | undefined): boolean {
  return Boolean(role && reachesEveryProject(role) && can(role, 'write'));
}
