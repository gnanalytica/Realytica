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
 */

import {
  changesBetween,
  recordAsItStands,
  recordAuditEvent,
  refreshProjectDerived,
  turnChanged,
  undoChanges,
  undoSaid,
  type DdProject,
  type KeptGroup,
  type ProjectChatTurn,
  type RecordBase,
} from '@realytica/shared';
import { forgetPageTexts } from './documents/page-text';
import { storageAdapter } from './storage';

/** What is kept of one message's changes, beside the project. */
interface KeptChanges {
  v: 1;
  turnId: string;
  at: string;
  groups: KeptGroup[];
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
  return recordAsItStands(project);
}

/**
 * Keep what a message changed with its reply: the lines on the reply, and
 * what puts them back beside the project. `before` is the record as it stood
 * when the message began. Does nothing for a message that changed nothing a
 * person would want back. Never throws: a reply goes out without its list
 * before it fails for one.
 */
export async function keepTurnChanges(project: DdProject, before: RecordBase | DdProject | null | undefined, turn: ProjectChatTurn | undefined): Promise<void> {
  if (!before || !turn) return;
  let groups: KeptGroup[];
  try {
    // What the record derives from the rest is worked out first, so that it is part of how the message left things.
    refreshProjectDerived(project);
    groups = changesBetween(before, project);
  } catch {
    return;
  }
  if (!groups.length) return;
  // An earlier build kept one whole copy of the file for the last instruction. It is let go the first time a message is kept this way.
  if (project.lastUndo) {
    await storageAdapter.deleteDocument(project.id, `undo-${project.lastUndo.token}.json`).catch(() => undefined);
    delete project.lastUndo;
  }
  const body = JSON.stringify({ v: 1, turnId: turn.id, at: turn.at, groups } satisfies KeptChanges);
  let kept = body.length <= KEPT_AT_MOST;
  if (kept) {
    try {
      await storageAdapter.putDocument(project.id, fileOf(turn.id), Buffer.from(body), 'application/json');
    } catch {
      kept = false;
    }
  }
  const changed = turnChanged(groups, kept);
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
  if (!turn?.changed) return { done: false, text: 'That message changed nothing on the record, so there is nothing to undo.' };
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

  const outcome = undoChanges(project, kept.groups);
  const listed = outcome.back.filter((group) => !group.quiet).length;
  const text = undoSaid(outcome);
  // Nothing went back: the message stands as it was, and can be tried again once what holds it is gone.
  if (!outcome.back.length) return { done: false, text };

  refreshProjectDerived(project);
  const at = new Date().toISOString();
  turn.changed.undone = { at, by, back: listed, of: listed + outcome.left.length };
  recordAuditEvent(project, { actor: by, action: 'undo', entityType: 'project', entityId: project.id, oldValue: turn.changed.lines[0], about: outcome.about, at });
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
