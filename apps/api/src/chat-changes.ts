/**
 * What a chat message changed, kept with it, and undoing it.
 *
 * A message that changes the record is compared with the record as it stood
 * before it (`changesBetween` in the shared package). The lines a person
 * reads go on the reply (`changed`). What it takes to put the changes back
 * goes in a small file of its own beside the project, named by the reply's
 * id: what stood before in each field, and a fingerprint of each record the
 * message added. It is a few lines of data and never a copy of the project,
 * so it is kept for every message that changed something, and stays for as
 * long as the chat does.
 *
 * `undoTurn` puts one message's changes back, later, whatever has happened
 * since. Each thing goes back only while it still stands as that message
 * left it, and what does not is said with why (`undoChanges`). A file the
 * message added to storage, a dropped paper or the words of a pasted
 * meeting, is removed once the record that pointed at it is gone and
 * nothing else points at it. Until then it stays where it is.
 *
 * An undo is told to memory as the trail tells everything: one event, with
 * the records it put something back on. A message is undone once. Nothing
 * here undoes what a person did on a page.
 *
 * A message keeps only what its own request wrote. Other work goes on while
 * a message runs: a colleague on a page, the same person on another, a plan
 * reading papers for minutes. The comparison sees all of it. So a message's
 * request is carried out with a mark of its own in scope (`asMessage`), and
 * while it is, every line it adds to the trail is stamped with that mark,
 * every card it raises is noted, and every move of the project's clock is
 * counted as its own or somebody else's. When the message is done and
 * nothing else wrote to the project while it ran, all that changed is its
 * own. Where something else did write, a thing is the message's own only
 * where a line with its mark tells of it and no other line the trail gained
 * meanwhile does, and a card only where the message raised it. The rest is
 * listed apart on the reply, as having changed while the message ran, and no
 * undo is kept for it. So an undo never puts back what another request did,
 * and never removes a record or a file another request added.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  changesBetween,
  listedIds,
  ownChanges,
  recordAsItStands,
  recordAuditEvent,
  refreshProjectDerived,
  turnChanged,
  undoChanges,
  undoSaid,
  type AuditEvent,
  type ChatProposal,
  type DdProject,
  type KeptGroup,
  type ProjectChatTurn,
  type RecordBase,
} from '@realytica/shared';
import { forgetPageTexts } from './documents/page-text';
import { storageAdapter } from './storage';
import { store } from './store';

/** What is kept of one message's changes, beside the project. */
interface KeptChanges {
  v: 1;
  turnId: string;
  at: string;
  groups: KeptGroup[];
  /** The things that changed while the message ran and were not its own, by their keys: nothing made for one of them is put back. */
  staying?: string[];
}

/* ==================================================================== */
/* Whose a write is                                                       */
/* ==================================================================== */

/** One chat message's request, while it is being carried out. */
interface Message {
  /** Its mark: on every line of the trail it writes. */
  req: string;
  /** The cards it raised, by their ids. */
  raised: Set<string>;
  /** How many times it has moved each project's clock. */
  moved: WeakMap<DdProject, number>;
  /** How many times the project it was sent to had had its clock moved, by anything, when it began. */
  began: WeakMap<DdProject, number>;
}

/**
 * The message in hand, readable from anywhere below the request that is
 * carrying it out. It follows the request across every wait, and into work
 * that goes on after the reply, so whatever is running when something is
 * written is the request that wrote it.
 */
const inHand = new AsyncLocalStorage<Message>();

/**
 * How many times a watched project's clock (`updatedAt`) has been moved, by
 * anything at all. Every write to a project moves its clock, with a line on
 * the trail or without one: the store saves only what moved. So a message
 * during which the clock was moved by nothing but its own request had the
 * project to itself.
 */
const moves = new WeakMap<DdProject, number>();

const count = (counts: WeakMap<DdProject, number>, project: DdProject): number => counts.get(project) ?? 0;

/** Have a list tell what a message in hand adds to it. It is the same list in every other way: only its `push` is its own, and is not counted among what it holds. */
function watchList<T>(list: T[], seen: (item: T, by: Message) => void): void {
  if (Object.prototype.hasOwnProperty.call(list, 'push')) return;
  Object.defineProperty(list, 'push', {
    configurable: true,
    writable: true,
    enumerable: false,
    value(this: T[], ...items: T[]): number {
      const by = inHand.getStore();
      if (by) for (const item of items) seen(item, by);
      return Array.prototype.push.apply(this, items);
    },
  });
}

/**
 * Put one of a project's own properties under watch: `put` is told what it
 * holds now, and each thing put there from now on. The property reads,
 * lists and saves as it did. Nothing is done for one that is not there, or
 * is watched already.
 */
function watchProperty(project: DdProject, key: 'audit' | 'chatProposals' | 'updatedAt', put: (held: unknown, first: boolean) => void): void {
  const holder = project as unknown as Record<string, unknown>;
  const now = Object.getOwnPropertyDescriptor(holder, key);
  if (!now || now.get) return;
  let held: unknown = now.value;
  put(held, true);
  Object.defineProperty(holder, key, {
    configurable: true,
    enumerable: true,
    get: () => held,
    set: (next: unknown) => {
      held = next;
      put(next, false);
    },
  });
}

/** The projects that are watched. A copy the store puts in a project's place is watched in its turn. */
const watched = new WeakSet<DdProject>();

/**
 * Watch what is written to a project, from here on: the lines added to its
 * trail, the cards raised on it, and every move of its clock. A line a
 * message in hand adds is stamped with that message's mark, a card it raises
 * is noted as raised by it, and a move of the clock is counted as its own.
 * What is written with no message in hand, from a page, is counted and
 * otherwise left as it is. Some code keeps a list by putting a new one in
 * its place, so the list that is there is the one watched.
 */
function watchWriters(project: DdProject): void {
  watchProperty(project, 'audit', (held) => {
    if (Array.isArray(held)) watchList<AuditEvent>(held, (line, by) => (line.req ??= by.req));
  });
  watchProperty(project, 'chatProposals', (held) => {
    if (Array.isArray(held)) watchList<ChatProposal>(held, (card, by) => by.raised.add(card.id));
  });
  watchProperty(project, 'updatedAt', (_held, first) => {
    if (first) return;
    moves.set(project, count(moves, project) + 1);
    const by = inHand.getStore();
    if (by) by.moved.set(project, count(by.moved, project) + 1);
  });
  watched.add(project);
}

// Storage's copy took the place of the one held: another instance wrote to the project. That is a move of its clock by somebody else.
store.onReplaced = (project) => {
  if (!watched.has(project)) return;
  moves.set(project, count(moves, project) + 1);
  watchWriters(project);
};

/**
 * Carry out a chat message's request with its own mark in scope, until all
 * its work is done, the work that outlives its reply included: the lines it
 * adds to the trail are stamped with the mark, the cards it raises are
 * noted, and its own moves of the project's clock are told from anybody
 * else's. A request already inside one stays in it.
 */
export function asMessage<T>(project: DdProject | undefined, run: () => T): T {
  if (project) watchWriters(project);
  if (inHand.getStore()) return run();
  const message: Message = { req: `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`, raised: new Set(), moved: new WeakMap(), began: new WeakMap() };
  if (project) message.began.set(project, count(moves, project));
  return inHand.run(message, run);
}

/** Where things stood when a message's changes began to be counted: the lines the trail held, and the moves of the project's clock, all of them and the message's own. */
interface Mark {
  had: Set<string>;
  moves: number;
  mine: number;
}

/** The mark taken with each copy of the record `recordBefore` gave. */
const marks = new WeakMap<object, Mark>();

/**
 * A message's changes, told apart from whatever else changed on the project
 * while it ran (`ownChanges`). Outside a message's own request, or with no
 * trail to compare with, nothing can be tied to the message: all of it is
 * given as not its own.
 */
function whose(project: DdProject, before: RecordBase | DdProject, groups: KeptGroup[]): { own: KeptGroup[]; meanwhile: KeptGroup[] } {
  if (!groups.length) return { own: [], meanwhile: [] };
  const me = inHand.getStore();
  // A whole copy of the project carries its trail. When it was taken is not known, so the clock is counted from when the request began: no later than the copy.
  const whole = (before as RecordBase).audit;
  const mark = marks.get(before) ?? (me && Array.isArray(whole) && me.began.has(project) ? { had: new Set((whole as AuditEvent[]).map((line) => line.id)), moves: count(me.began, project), mine: 0 } : undefined);
  if (!me || !mark) return { own: [], meanwhile: groups };
  const gained = project.audit.filter((line) => !mark.had.has(line.id));
  return ownChanges(groups, {
    projectId: project.id,
    touched: count(moves, project) - mark.moves > count(me.moved, project) - mark.mine,
    mine: gained.filter((line) => line.req === me.req),
    others: gained.filter((line) => line.req !== me.req),
    raised: me.raised,
    listed: listedIds(before, project),
  });
}

/** The most one message's changes may come to and still be kept. Past it the message is listed and cannot be undone. */
const KEPT_AT_MOST = 400_000;

const fileOf = (turnId: string): string => `changes-${turnId}.json`;

/**
 * The record as it stands, for a message that is about to change it. What
 * the record derives from the rest is worked out first, so that the clock
 * calling an action overdue is not taken for something the message did.
 */
export function recordBefore(project: DdProject): RecordBase {
  refreshProjectDerived(project);
  const stood = recordAsItStands(project);
  const me = inHand.getStore();
  marks.set(stood, { had: new Set(project.audit.map((line) => line.id)), moves: count(moves, project), mine: me ? count(me.moved, project) : 0 });
  return stood;
}

/**
 * Keep what a message changed with its reply: the lines on the reply, and
 * what puts them back beside the project. `before` is the record as it stood
 * when the message began: the copy `recordBefore` gave, or a whole copy of
 * the project with its trail. Only what is the message's own is kept to be
 * put back. What else changed while it ran is listed apart on the reply.
 * Does nothing for a message during which nothing changed that a person
 * would want back. Never throws: a reply goes out without its list before it
 * fails for one.
 */
export async function keepTurnChanges(project: DdProject, before: RecordBase | DdProject | null | undefined, turn: ProjectChatTurn | undefined): Promise<void> {
  if (!before || !turn) return;
  let groups: KeptGroup[];
  let meanwhile: KeptGroup[];
  try {
    // What the record derives from the rest is worked out first, so that it is part of how the message left things.
    refreshProjectDerived(project);
    const told = whose(project, before, changesBetween(before, project));
    // A message whose own changes are only cards it raised, or words it holds to ask about, changed nothing a person would want back.
    groups = told.own.some((group) => !group.quiet) ? told.own : [];
    meanwhile = told.meanwhile;
  } catch {
    return;
  }
  if (!groups.length && !meanwhile.some((group) => !group.quiet)) return;
  // An earlier build kept one whole copy of the file for the last instruction. It is let go the first time a message is kept this way.
  if (project.lastUndo) {
    await storageAdapter.deleteDocument(project.id, `undo-${project.lastUndo.token}.json`).catch(() => undefined);
    delete project.lastUndo;
  }
  const body = JSON.stringify({ v: 1, turnId: turn.id, at: turn.at, groups, ...(meanwhile.length ? { staying: meanwhile.map((group) => group.key) } : {}) } satisfies KeptChanges);
  let kept = groups.length > 0 && body.length <= KEPT_AT_MOST;
  if (kept) {
    try {
      await storageAdapter.putDocument(project.id, fileOf(turn.id), Buffer.from(body), 'application/json');
    } catch {
      kept = false;
    }
  }
  const changed = turnChanged(groups, kept, meanwhile);
  if (!changed) return;
  turn.changed = changed;
  // The reply on the thread is not always the object the caller holds.
  const stored = project.conversation.find((held) => held.id === turn.id);
  if (stored && stored !== turn) stored.changed = changed;
}

export type UndoDone =
  /** Nothing was done, and why. */
  | { done: false; text: string }
  | {
      done: true;
      /** What the chat says: what was put back, and what was left with why. */
      text: string;
      commands: string[];
      /** To be called once the project is saved: removes from storage what nothing points at any more. */
      afterSave: () => Promise<void>;
    };

/**
 * Undo one message: put back what it changed, where each thing still stands
 * as it left it. The project is changed in place and is the caller's to
 * save. A message is its author's to undo, and is undone once.
 */
export async function undoTurn(project: DdProject, turnId: string | undefined, by: string): Promise<UndoDone> {
  const turn = turnId ? project.conversation.find((held) => held.id === turnId && held.role === 'assistant') : undefined;
  if (!turn?.changed?.lines.length) return { done: false, text: 'That message changed nothing of its own on the record, so there is nothing to undo.' };
  if (turn.changed.undone) return { done: false, text: 'That message was already undone. Nothing more was changed.' };
  if (turn.actor && turn.actor !== by) return { done: false, text: 'That message is somebody else’s, and only they can undo it. Nothing was changed.' };
  let kept: KeptChanges | undefined;
  if (turn.changed.kept) {
    try {
      const raw = await storageAdapter.getDocument(project.id, fileOf(turn.id));
      const read = raw ? (JSON.parse(raw.toString('utf8')) as Partial<KeptChanges>) : undefined;
      if (read?.v === 1 && Array.isArray(read.groups)) kept = read as KeptChanges;
    } catch {
      kept = undefined;
    }
  }
  if (!kept) return { done: false, text: 'What that message changed is listed under it, but what it takes to put it back was not kept. Nothing was changed.' };

  const outcome = undoChanges(project, kept.groups, kept.staying);
  const listed = outcome.back.filter((group) => !group.quiet).length;
  const text = undoSaid(outcome);
  // Nothing went back: the message stands as it was, and can be tried again once what holds it is gone.
  if (!outcome.back.length) return { done: false, text };

  refreshProjectDerived(project);
  const at = new Date().toISOString();
  turn.changed.undone = { at, by, back: listed, of: listed + outcome.left.length };
  // The line names all it put back, the records and the project's own fields, so that another message running now can tell what of its own was touched.
  const fields = outcome.back.filter((group) => !group.quiet && group.path.length === 1).map((group) => group.path[0]!);
  recordAuditEvent(project, { actor: by, action: 'undo', entityType: 'project', entityId: project.id, oldValue: turn.changed.lines[0], about: outcome.about, ...(fields.length ? { fields } : {}), at });
  return {
    done: true,
    text,
    commands: [`Undone: ${turn.changed.lines[0] ?? 'a message'}`],
    afterSave: async () => {
      for (const file of outcome.files) {
        await storageAdapter.deleteDocument(project.id, file).catch(() => undefined);
        await forgetPageTexts(project.id, file).catch(() => undefined);
      }
      await storageAdapter.deleteDocument(project.id, fileOf(turn.id)).catch(() => undefined);
    },
  };
}

/** Let go of what was kept for some replies: when their chat is deleted, there is nothing left to undo them from. Never throws. */
export async function forgetTurnChanges(projectId: string, turns: readonly ProjectChatTurn[]): Promise<void> {
  for (const turn of turns) {
    if (turn.changed?.kept) await storageAdapter.deleteDocument(projectId, fileOf(turn.id)).catch(() => undefined);
  }
}
