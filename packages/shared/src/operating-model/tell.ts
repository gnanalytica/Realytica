/**
 * Telling the people a change concerns.
 *
 * Alerts (`alerts.ts`) are conditions of the file: an approval lapsing, a
 * milestone late. This is the other half: something a person just did. A
 * paper was filed, a value was accepted, a value was changed from what
 * stood, a checklist line was answered, a request was answered. Each is read
 * off the trail, which already says who did what to which record, so nothing
 * that files or decides has to remember to tell anybody. A paper tells
 * whichever way it came: dropped by a person, brought by a connected folder,
 * or sent back by an outside party in reply to a request. A reply tells
 * whoever raised the request, with or without a paper on it.
 *
 * Three things are worked out here, with no model anywhere:
 *
 * - who a change concerns, and why (`concernedBy`): the lead and signer of
 *   the department that holds the paper; whoever is named on an open action,
 *   request or checklist line the paper answers or touches; and the leads
 *   and signers of another department whose record the new value contradicts
 *   or feeds, by the links the project already draws (`links.ts`);
 * - what each of them is told (`tellSaid`): what arrived, what it states
 *   that differs from what stood, with its page, and one thing to do;
 * - which of it is due to leave the app, a person and a project at a time
 *   (`tellDue`, `tellMessage`), so ten papers dropped together are one
 *   message.
 *
 * Two rules hold throughout. Nobody is told of what they could not read in
 * the app: somebody working from a grant is handed their own copy of the
 * project, and a record that is not on it concerns them in no way here. And
 * a value a reader read that no person has accepted is never said: it is
 * counted, as waiting for somebody to check.
 */

import type { AuditEvent, DdProject, EvidenceRecord } from './types';
import type { DepartmentKey } from './departments';
import { DEPARTMENT_SHORT, FUNCTION_SHORT, functionKey, withDepartment, workstreamDefinition, workstreamOfCheck } from './departments';
import type { WorkspaceRole } from './tenancy';
import { checklistSheet, type ChecklistLine } from './checklist';
import { allChecks } from './engagements';
import { acceptedFacts, factReview, standingFacts, waitingReadings } from './fact-review';
import { projectLinks } from './links';
import { ownedBy } from './my-work';
import { departmentOfPaper } from './review';
import { departmentRole, projectDepartments } from './team';
import { documentWorkstream } from './vault';

/* ==================================================================== */
/* The record                                                            */
/* ==================================================================== */

export type TellEventKind = 'paper_filed' | 'value_accepted' | 'value_changed' | 'line_answered' | 'request_answered' | 'request_replied';

/** One thing a person did that others should hear of, as the trail wrote it. */
export interface TellEvent {
  /** The trail line it was read off: what makes telling it twice impossible. */
  id: string;
  kind: TellEventKind;
  at: string;
  /** Who did it, in the trail's words. They are not told of their own work. */
  actor: string;
  evidenceId?: string;
  factKey?: string;
  checklistItemId?: string;
  requestId?: string;
  /** On a value: what it is now, and what stood before, each as "Label: value". */
  now?: string;
  was?: string;
}

/** Why a change concerns somebody. Kept as the records it names, never as words: the words are the reader's own copy's. */
export type TellWhy =
  /** They lead or sign for the department that holds it. No department: nothing holds the paper yet. */
  | { because: 'decides'; department?: DepartmentKey }
  /** They are named on a record the paper answers, is offered for, or touches. */
  | { because: 'named'; record: 'action' | 'request' | 'checklist' | 'check' | 'paper'; id: string; how: 'answers' | 'offered' | 'touches' }
  /** They lead or sign for a department whose check holds another value for the same thing. */
  | { because: 'contradicts'; department: DepartmentKey; checkId: string }
  /** They lead or sign for a department this function feeds or gates, or one whose check rests on the paper. */
  | { because: 'feeds'; department: DepartmentKey; workstream?: string; checkId?: string };

/** One change, for one person. */
export interface TellNotice {
  id: string;
  /** Who it is for, by address. */
  to: string;
  at: string;
  kind: TellEventKind;
  by: string;
  why: TellWhy[];
  evidenceId?: string;
  factKey?: string;
  checklistItemId?: string;
  requestId?: string;
  /** The function that held the paper when this was written, off the whole project: a copy cannot say. */
  workstream?: string;
  now?: string;
  was?: string;
  /** The page the value is on. */
  page?: number;
  readAt?: string;
  /** When it was put in a message to leave the app, or passed over because the person had quieted the project. */
  batchedAt?: string;
  /** Passed over: the person had quieted the project. */
  quieted?: true;
  /** A message holding it could not be sent: when, and how often. It is tried again a message's worth later, `TELL_TRIES` times in all. */
  unsent?: { at: string; n: number };
}

/** What a project keeps of telling people. */
export interface TellState {
  /** The last trail line read. */
  through?: string;
  notices?: TellNotice[];
  /** Who has quieted this project, by address: nothing about it leaves the app for them. */
  quiet?: string[];
}

/** Somebody who could be told. */
export interface TellPerson {
  email: string;
  name?: string;
  workspaceRole?: WorkspaceRole;
  /**
   * The project as they may read it, for somebody working from a grant.
   * Absent for the firm's own people, who read all of it.
   */
  copy?: DdProject;
}

export interface Concerned {
  person: TellPerson;
  why: TellWhy[];
}

/** One message's worth of waiting: a drop of papers made within it is one message. */
export const TELL_BATCH_MS = 10 * 60_000;
/** On a project never told of before, the trail is read from this long ago and no further: its history is nobody's news. */
export const TELL_FIRST_LOOK_MS = 10 * 60_000;
/** The notices a project keeps. */
export const TELL_KEEP = 300;
/** How often a message that could not be sent is tried before its notices stay in the app alone. */
export const TELL_TRIES = 3;

function fold(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ==================================================================== */
/* The events                                                            */
/* ==================================================================== */

/** How the trail names an outside party's reply, and a connected folder. */
const OUTSIDE_ACTOR = 'outside:';
const FOLDER_ACTOR = ' folder';

function eventOf(project: DdProject, line: AuditEvent): TellEvent | undefined {
  // Only what somebody did: a person under their address, an outside party in reply to a request (`outside:<address or number>`),
  // or a connected folder bringing a paper ("Google Drive folder"). The server's own work, and an example project loaded whole, are nobody's news.
  if (!line.actor.includes('@') && !line.actor.startsWith(OUTSIDE_ACTOR) && !line.actor.endsWith(FOLDER_ACTOR)) return undefined;
  const base = { id: line.id, at: line.at, actor: line.actor };
  if (line.action === 'upload' && line.entityType === 'evidence') {
    const row = project.evidence.find((held) => held.id === line.entityId);
    // A photograph from site is the site record's, and is told by its own alerts.
    if (!row || row.kind === 'photograph') return undefined;
    return { ...base, kind: 'paper_filed', evidenceId: row.id };
  }
  if ((line.action === 'accept_fact' || line.action === 'accept_fact_corrected') && line.entityType === 'evidence') {
    const changed = Boolean(line.oldValue && line.oldValue !== line.newValue);
    return { ...base, kind: changed ? 'value_changed' : 'value_accepted', evidenceId: line.entityId, ...(line.factKey ? { factKey: line.factKey } : {}), ...(line.newValue ? { now: line.newValue } : {}), ...(changed ? { was: line.oldValue } : {}) };
  }
  if (line.action === 'checklist_received') return { ...base, kind: 'line_answered', checklistItemId: line.entityId };
  if (line.action === 'request_updated' && line.newValue === 'answered' && line.oldValue !== 'answered') return { ...base, kind: 'request_answered', requestId: line.entityId };
  // What an outside party sent back, papers or words alone: it waits for a person to confirm it.
  if (line.action === 'request_replied' && line.entityType === 'request') return { ...base, kind: 'request_replied', requestId: line.entityId };
  return undefined;
}

/**
 * What has happened since the trail was last read, and the line read up to.
 *
 * A project nobody has been told of yet has its trail read from a few
 * minutes back, not from its first line. So has one whose marker is no
 * longer on its trail.
 */
export function tellEvents(project: DdProject, now = new Date()): { events: TellEvent[]; through?: string } {
  const trail = project.audit ?? [];
  const through = project.tell?.through;
  const at = through ? trail.findIndex((line) => line.id === through) : -1;
  const since = now.getTime() - TELL_FIRST_LOOK_MS;
  const fresh = at >= 0 ? trail.slice(at + 1) : trail.filter((line) => Date.parse(line.at) >= since);
  const events: TellEvent[] = [];
  const filed = new Set<string>();
  for (const line of fresh) {
    const event = eventOf(project, line);
    if (!event) continue;
    // A paper put on its row in parts is one paper.
    if (event.kind === 'paper_filed') {
      if (filed.has(event.evidenceId!)) continue;
      filed.add(event.evidenceId!);
    }
    events.push(event);
  }
  return { events, ...(trail.length ? { through: trail[trail.length - 1]!.id } : through ? { through } : {}) };
}

/* ==================================================================== */
/* Who is concerned                                                      */
/* ==================================================================== */

/** The checklist as it stands, read once for a run of events. */
function checklistLines(project: DdProject): ChecklistLine[] {
  if (!project.checklist?.length) return [];
  return checklistSheet(project).stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a);
    const y = Number(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return x === y;
  }
  return fold(String(a)) === fold(String(b));
}

function plain(value: unknown): value is string | number | boolean {
  return typeof value === 'string' ? value.trim() !== '' : typeof value === 'number' || typeof value === 'boolean';
}

/** The checks holding another value under this key, read off some other paper or typed by hand. */
function checksThatDiffer(project: DdProject, key: string, value: unknown, evidenceId: string) {
  return allChecks(project).filter((check) => {
    const held = check.fields?.[key];
    return held !== undefined && plain(held.value) && held.sourceEvidenceId !== evidenceId && !sameValue(held.value, value);
  });
}

function departmentOfCheckHere(definitionId: string): DepartmentKey | undefined {
  return workstreamDefinition(workstreamOfCheck(definitionId))?.department;
}

/** Whether a reason names only what is on this copy of the project. */
function onCopy(copy: DdProject, why: TellWhy): boolean {
  if (why.because === 'decides') return true;
  if (why.because === 'contradicts') return allChecks(copy).some((check) => check.id === why.checkId);
  if (why.because === 'feeds') return !why.checkId || allChecks(copy).some((check) => check.id === why.checkId);
  if (why.record === 'action') return copy.actions.some((held) => held.id === why.id);
  if (why.record === 'request') return (copy.requests ?? []).some((held) => held.id === why.id);
  if (why.record === 'checklist') return (copy.checklist ?? []).some((held) => held.id === why.id);
  if (why.record === 'check') return allChecks(copy).some((check) => check.id === why.id);
  return copy.evidence.some((held) => held.id === why.id);
}

/** Whether what a notice is about is on this copy of the project. */
export function tellReadable(copy: DdProject, about: Pick<TellNotice, 'evidenceId' | 'checklistItemId' | 'requestId'>): boolean {
  if (about.evidenceId && !copy.evidence.some((held) => held.id === about.evidenceId)) return false;
  if (about.checklistItemId && !(copy.checklist ?? []).some((held) => held.id === about.checklistItemId)) return false;
  if (about.requestId && !(copy.requests ?? []).some((held) => held.id === about.requestId)) return false;
  return true;
}

/**
 * Who a change concerns, and why.
 *
 * Worked out on the whole project, since only it can say which department
 * holds a paper. Then cut to what each person may read: somebody working
 * from a grant keeps only the reasons that name records on their own copy,
 * and is left out altogether where the paper, the line or the request itself
 * is not on it. Whoever did the thing is not told of it.
 */
export function concernedBy(project: DdProject, event: TellEvent, people: readonly TellPerson[], lines: readonly ChecklistLine[] = checklistLines(project)): Concerned[] {
  const found = new Map<string, Concerned>();
  const add = (person: TellPerson, why: TellWhy): void => {
    const key = fold(person.email);
    const held = found.get(key) ?? { person, why: [] };
    found.set(key, held);
    if (!held.why.some((had) => JSON.stringify(had) === JSON.stringify(why))) held.why.push(why);
  };
  const deciders = (department: DepartmentKey): TellPerson[] =>
    people.filter((person) => {
      const role = departmentRole(project, { email: person.email, workspaceRole: person.workspaceRole }, department);
      return role === 'lead' || role === 'signer';
    });
  const named = (said: string | undefined): TellPerson[] => people.filter((person) => ownedBy(said, person));

  const row = event.evidenceId ? project.evidence.find((held) => held.id === event.evidenceId) : undefined;

  if (row) {
    // The department that holds the paper; while none does, any the project uses, as for deciding it.
    const home = departmentOfPaper(project, row);
    if (home) for (const person of deciders(home)) add(person, { because: 'decides', department: home });
    else for (const department of projectDepartments(project)) for (const person of deciders(department)) add(person, { because: 'decides' });

    for (const person of named(row.owner)) add(person, { because: 'named', record: 'paper', id: row.id, how: 'touches' });

    const citing = allChecks(project).filter((check) => check.evidenceIds.includes(row.id));
    for (const check of citing) {
      for (const person of named(check.owner)) add(person, { because: 'named', record: 'check', id: check.id, how: 'touches' });
    }
    const citingIds = new Set(citing.map((check) => check.id));
    for (const action of project.actions) {
      if (action.status === 'closed') continue;
      const touches = action.evidenceIds.includes(row.id) || action.closureEvidenceIds.includes(row.id) || action.checkIds.some((id) => citingIds.has(id));
      if (touches) for (const person of named(action.owner)) add(person, { because: 'named', record: 'action', id: action.id, how: 'touches' });
    }
    for (const request of project.requests ?? []) {
      const answers = request.answeredByEvidenceId === row.id || (request.evidenceId === row.id && (request.status === 'sent' || request.status === 'answered'));
      // A paper that came back in reply and nobody has confirmed: offered for the request, not yet its answer.
      const replies = row.unconfirmedReply?.requestId === request.id;
      if (!answers && !replies) continue;
      for (const person of [...named(request.createdBy), ...named(request.recipient)]) add(person, { because: 'named', record: 'request', id: request.id, how: answers ? 'answers' : 'offered' });
    }
    if (event.kind === 'paper_filed') {
      for (const line of lines) {
        const how = line.status === 'received' && line.evidenceId === row.id ? 'answers' : line.suggestion?.evidenceId === row.id ? 'offered' : undefined;
        if (!how) continue;
        const why: TellWhy = { because: 'named', record: 'checklist', id: line.item.id, how };
        for (const person of [...named(line.item.createdBy), ...named(line.item.owedBy), ...deciders(line.item.department)]) add(person, why);
      }
    }

    if (event.kind === 'value_accepted' || event.kind === 'value_changed') {
      const fact = acceptedFacts(row).find((held) => held.key === event.factKey);
      // Another department's check that holds something else for the same thing.
      if (fact) {
        for (const check of checksThatDiffer(project, fact.key, fact.value, row.id)) {
          const department = departmentOfCheckHere(check.definitionId);
          if (department && department !== home) for (const person of deciders(department)) add(person, { because: 'contradicts', department, checkId: check.id });
        }
      }
      // Another department's check that rests on this paper.
      for (const check of citing) {
        const department = departmentOfCheckHere(check.definitionId);
        if (department && department !== home) for (const person of deciders(department)) add(person, { because: 'feeds', department, checkId: check.id });
      }
      // And the functions this paper's own function feeds or gates, as the project draws them.
      const from = documentWorkstream(project, row);
      for (const link of projectLinks(project)) {
        if (link.type !== 'feeds' && link.type !== 'gates') continue;
        const starts = (link.from.kind === 'workstream' && from !== undefined && link.from.id === from) || (link.from.kind === 'document' && link.from.id === row.id);
        if (!starts || link.to.kind !== 'workstream') continue;
        const department = workstreamDefinition(link.to.id)?.department;
        if (department && department !== home) for (const person of deciders(department)) add(person, { because: 'feeds', department, workstream: link.to.id });
      }
    }
  }

  if (event.kind === 'line_answered') {
    const item = (project.checklist ?? []).find((held) => held.id === event.checklistItemId);
    if (item) {
      const why: TellWhy = { because: 'named', record: 'checklist', id: item.id, how: 'answers' };
      for (const person of [...named(item.createdBy), ...named(item.owedBy)]) add(person, why);
      for (const person of deciders(item.department)) add(person, { because: 'decides', department: item.department });
    }
  }

  if (event.kind === 'request_answered') {
    const request = (project.requests ?? []).find((held) => held.id === event.requestId);
    if (request) {
      for (const person of [...named(request.createdBy), ...named(request.recipient)]) add(person, { because: 'named', record: 'request', id: request.id, how: 'answers' });
    }
  }

  if (event.kind === 'request_replied') {
    const request = (project.requests ?? []).find((held) => held.id === event.requestId);
    // Whoever raised it: the reply is theirs to confirm or set aside.
    if (request) for (const person of named(request.createdBy)) add(person, { because: 'named', record: 'request', id: request.id, how: 'offered' });
  }

  const about = { ...event, evidenceId: row?.id ?? event.evidenceId };
  return [...found.values()].flatMap((concerned) => {
    const { person } = concerned;
    if (ownedBy(event.actor.startsWith(OUTSIDE_ACTOR) ? event.actor.slice(OUTSIDE_ACTOR.length) : event.actor, person)) return [];
    if (!person.copy) return [concerned];
    if (!tellReadable(person.copy, about)) return [];
    const why = concerned.why.filter((reason) => onCopy(person.copy!, reason));
    return why.length ? [{ person, why }] : [];
  });
}

/* ==================================================================== */
/* Keeping what is told                                                  */
/* ==================================================================== */

function noticeId(event: TellEvent, email: string): string {
  let hash = 5381;
  for (const ch of fold(email)) hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0;
  return `tel_${event.id}_${hash.toString(36)}`;
}

/**
 * Read the trail and write a notice for each person each change concerns.
 * Returns the notices written now.
 *
 * Safe to run twice: the trail is read from where it was last read to, and a
 * notice is held by the trail line it came from and the person it is for.
 * A paper already waiting in a message for somebody is not told to them a
 * second time when another file is put on its row.
 */
export function gatherTell(project: DdProject, people: readonly TellPerson[], now = new Date()): TellNotice[] {
  const { events, through } = tellEvents(project, now);
  const state: TellState = project.tell ?? {};
  if (!events.length) {
    if (through && through !== state.through) project.tell = { ...state, through };
    return [];
  }
  const held = state.notices ?? [];
  const quiet = new Set((state.quiet ?? []).map(fold));
  const lines = checklistLines(project);
  const written: TellNotice[] = [];
  for (const event of events) {
    const row = event.evidenceId ? project.evidence.find((paper) => paper.id === event.evidenceId) : undefined;
    // The value this line of the trail accepted, for its page: not one accepted under the same key since.
    const fact = row && event.factKey ? acceptedFacts(row).find((value) => value.key === event.factKey && `${value.label}: ${value.display}` === event.now) : undefined;
    const workstream = row ? documentWorkstream(project, row) : undefined;
    for (const { person, why } of concernedBy(project, event, people, lines)) {
      const to = fold(person.email);
      const id = noticeId(event, to);
      if (held.some((notice) => notice.id === id)) continue;
      if (event.kind === 'paper_filed' && held.some((notice) => notice.kind === 'paper_filed' && notice.to === to && notice.evidenceId === event.evidenceId && !notice.batchedAt && !notice.readAt)) continue;
      const notice: TellNotice = {
        id,
        to,
        at: event.at,
        kind: event.kind,
        by: event.actor,
        why,
        ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}),
        ...(event.factKey ? { factKey: event.factKey } : {}),
        ...(event.checklistItemId ? { checklistItemId: event.checklistItemId } : {}),
        ...(event.requestId ? { requestId: event.requestId } : {}),
        ...(workstream ? { workstream } : {}),
        ...(event.now ? { now: event.now } : {}),
        ...(event.was ? { was: event.was } : {}),
        ...(fact ? { page: fact.page } : {}),
        // Quieted: it is kept for the app and never put in a message.
        ...(quiet.has(to) ? { batchedAt: now.toISOString(), quieted: true as const } : {}),
      };
      held.push(notice);
      written.push(notice);
    }
  }
  project.tell = { ...state, ...(through ? { through } : {}), notices: keptNotices(held) };
  return written;
}

/**
 * The notices kept when there are more than `TELL_KEEP`: the oldest that are
 * read, or were put in a message already, go first. One that has not left
 * the app goes only when nothing else is left to drop.
 */
function keptNotices(held: TellNotice[]): TellNotice[] {
  let over = held.length - TELL_KEEP;
  if (over <= 0) return held;
  const kept = held.filter((notice) => !((notice.readAt || notice.batchedAt) && over-- > 0));
  return kept.slice(-TELL_KEEP);
}

/** Quiet a project for one person, or stop quieting it. What waits for them unsent is passed over. */
export function setTellQuiet(project: DdProject, email: string, quiet: boolean, now = new Date()): boolean {
  const me = fold(email);
  const state: TellState = project.tell ?? {};
  const others = (state.quiet ?? []).filter((held) => fold(held) !== me);
  if (quiet) {
    for (const notice of state.notices ?? []) {
      if (notice.to === me && !notice.batchedAt) {
        notice.batchedAt = now.toISOString();
        notice.quieted = true;
      }
    }
  }
  project.tell = { ...state, quiet: quiet ? [...others, me] : others };
  return quiet;
}

export function tellQuieted(project: DdProject, email: string): boolean {
  return (project.tell?.quiet ?? []).some((held) => fold(held) === fold(email));
}

/** Mark a person's own notices read. Nobody else's are touched, whatever ids are named. */
export function markTellRead(project: DdProject, ids: readonly string[] | 'all', email: string, now = new Date()): number {
  const me = fold(email);
  let n = 0;
  for (const notice of project.tell?.notices ?? []) {
    if (notice.to !== me || notice.readAt || !(ids === 'all' || ids.includes(notice.id))) continue;
    notice.readAt = now.toISOString();
    n += 1;
  }
  return n;
}

/**
 * What is due to leave the app, by person: everything unread and not yet in
 * a message, once the oldest of it has waited a message's worth. Taking it
 * marks it, so a second call takes nothing.
 */
export function takeTellDue(project: DdProject, now = new Date()): Map<string, TellNotice[]> {
  const waiting = new Map<string, TellNotice[]>();
  const before = now.getTime() - TELL_BATCH_MS;
  for (const notice of project.tell?.notices ?? []) {
    if (notice.batchedAt || notice.readAt) continue;
    // One whose message could not be sent waits a message's worth before it is tried again.
    if (notice.unsent && Date.parse(notice.unsent.at) > before) continue;
    waiting.set(notice.to, [...(waiting.get(notice.to) ?? []), notice]);
  }
  const due = new Map<string, TellNotice[]>();
  for (const [to, notices] of waiting) {
    if (!notices.some((notice) => Date.parse(notice.at) <= before)) continue;
    for (const notice of notices) notice.batchedAt = now.toISOString();
    due.set(to, notices);
  }
  return due;
}

/**
 * Give back notices that were taken and did not leave: they are due again.
 *
 * With `failedAt`, a send was tried and failed: each is tried again a
 * message's worth later, and after `TELL_TRIES` failures stays taken, in the
 * app alone. Without it, nothing was tried (the write behind the taking
 * failed) and they are due at once. A notice read or quieted meanwhile is
 * left as it is. Returns how many were given back.
 */
export function untakeTell(project: DdProject, ids: readonly string[], failedAt?: Date): number {
  let n = 0;
  for (const notice of project.tell?.notices ?? []) {
    if (!notice.batchedAt || notice.quieted || notice.readAt || !ids.includes(notice.id)) continue;
    if (failedAt) {
      const tries = (notice.unsent?.n ?? 0) + 1;
      notice.unsent = { at: failedAt.toISOString(), n: tries };
      if (tries >= TELL_TRIES) continue;
    }
    delete notice.batchedAt;
    n += 1;
  }
  return n;
}

/* ==================================================================== */
/* The words                                                             */
/* ==================================================================== */

/** A notice as a person reads it. */
export interface TellLine {
  id: string;
  projectId: string;
  projectName: string;
  projectReference: string;
  kind: TellEventKind;
  at: string;
  by: string;
  /** What arrived or was decided. */
  title: string;
  /** What it states that differs from what stood, with its page; else why it is theirs. */
  detail?: string;
  /** The one thing to do. */
  action: string;
  /** Values on the paper a reader read and no person has accepted: counted, never said. */
  waiting?: number;
  evidenceId?: string;
  page?: number;
  read: boolean;
}

function placeSaid(workstream: string | undefined): string | undefined {
  if (!workstream) return undefined;
  const fn = functionKey(workstream);
  return withDepartment(fn, fn === workstream ? (FUNCTION_SHORT[fn] ?? workstreamDefinition(fn)?.label ?? fn) : DEPARTMENT_SHORT.design);
}

/** What a paper states that a check holds otherwise. Only values a person accepted: what a reader read and nobody decided is counted, never said. */
function paperDiffers(project: DdProject, row: EvidenceRecord): string[] {
  const out: string[] = [];
  for (const fact of acceptedFacts(row)) {
    const check = checksThatDiffer(project, fact.key, fact.value, row.id)[0];
    if (check) out.push(`${fact.label}: ${fact.display} on p. ${fact.page}; “${check.title}” holds ${String(check.fields![fact.key]!.value)}.`);
  }
  return out;
}

function listed(sentences: string[], most = 2): string {
  return sentences.length > most ? `${sentences.slice(0, most).join(' ')} And ${sentences.length - most} more.` : sentences.join(' ');
}

/**
 * A notice in words, written by rule from the reader's own copy of the
 * project: `project` is what they may read, and nothing in the words comes
 * from anywhere else. Undefined where what it is about is no longer there.
 */
export function tellSaid(project: DdProject, notice: TellNotice): TellLine | undefined {
  if (!tellReadable(project, notice)) return undefined;
  const row = notice.evidenceId ? project.evidence.find((held) => held.id === notice.evidenceId) : undefined;
  const why = notice.why.filter((reason) => onCopy(project, reason));
  const decides = why.some((reason) => reason.because === 'decides');
  const base = { id: notice.id, projectId: project.id, projectName: project.name, projectReference: project.reference, kind: notice.kind, at: notice.at, by: notice.by, read: Boolean(notice.readAt), ...(row ? { evidenceId: row.id } : {}) };
  const checkTitle = (id: string | undefined) => allChecks(project).find((check) => check.id === id)?.title;
  const reasonOf = <B extends TellWhy['because']>(because: B) => why.find((reason): reason is Extract<TellWhy, { because: B }> => reason.because === because);
  const namedOn = (record: Extract<TellWhy, { because: 'named' }>['record']) => why.find((reason): reason is Extract<TellWhy, { because: 'named' }> => reason.because === 'named' && reason.record === record);

  if (notice.kind === 'paper_filed') {
    if (!row) return undefined;
    const place = placeSaid(notice.workstream);
    // Waiting on a person: what acts on nothing until decided, and what the rules read surely that nobody has accepted either.
    const waiting = waitingReadings(row).length + standingFacts(row).filter((fact) => factReview(fact) !== 'accepted').length;
    const differs = paperDiffers(project, row);
    const line = namedOn('checklist');
    const item = line ? (project.checklist ?? []).find((held) => held.id === line.id) : undefined;
    const asked = namedOn('request');
    const request = asked ? (project.requests ?? []).find((held) => held.id === asked.id) : undefined;
    const action = namedOn('action') ? project.actions.find((held) => held.id === namedOn('action')!.id) : undefined;
    const said: string[] = [];
    if (differs.length) said.push(listed(differs));
    if (waiting) said.push(`${plural(waiting, 'value')} waiting for ${decides ? 'you' : 'a lead or signer'} to check.`);
    if (!said.length) {
      if (item && line) said.push(line.how === 'offered' ? `It may be “${item.title}” on Papers owed.` : `It answers “${item.title}” on Papers owed.`);
      else if (request) said.push(asked?.how === 'offered' ? `It came in reply to the request “${request.title}”.` : `It answers the request “${request.title}”.`);
      else if (action) said.push(`It touches your action “${action.title}”.`);
    }
    const todo =
      decides && waiting ? `Check ${plural(waiting, 'value')}.`
      : differs.length ? 'See which of the two is right.'
      : item && line?.how === 'offered' ? `Confirm it is “${item.title}”.`
      : decides && !place ? 'Say where it belongs.'
      : request && asked?.how === 'offered' ? `Confirm it answers “${request.title}”.`
      : action ? `See whether “${action.title}” can close.`
      : 'Read it.';
    return { ...base, title: `Filed: ${row.title}${place ? ` · ${place}` : ''}`, ...(said.length ? { detail: said.join(' ') } : {}), action: todo, ...(waiting ? { waiting } : {}) };
  }

  if (notice.kind === 'value_accepted' || notice.kind === 'value_changed') {
    if (!row) return undefined;
    const on = `${row.title}${notice.page ? `, p. ${notice.page}` : ''}`;
    const against = reasonOf('contradicts');
    const feeds = reasonOf('feeds');
    const said: string[] = [];
    if (notice.kind === 'value_changed' && notice.was) said.push(`${notice.was} stood before.`);
    const other = against ? allChecks(project).find((check) => check.id === against.checkId) : undefined;
    const held = other && notice.factKey ? other.fields?.[notice.factKey]?.value : undefined;
    if (other && plain(held)) said.push(`“${other.title}” in ${DEPARTMENT_SHORT[against!.department]} holds ${String(held)}.`);
    else if (feeds) {
      const rests = checkTitle(feeds.checkId);
      said.push(rests ? `“${rests}” in ${DEPARTMENT_SHORT[feeds.department]} rests on this paper.` : `It feeds ${placeSaid(feeds.workstream) ?? DEPARTMENT_SHORT[feeds.department]}.`);
    }
    const todo = other ? `See which is right on “${other.title}”.` : feeds ? `See what it changes in ${feeds.checkId ? DEPARTMENT_SHORT[feeds.department] : (placeSaid(feeds.workstream) ?? DEPARTMENT_SHORT[feeds.department])}.` : notice.kind === 'value_changed' ? 'Read the change.' : 'Read it.';
    return {
      ...base,
      title: `${notice.kind === 'value_changed' ? 'Changed' : 'Accepted'}: ${notice.now ?? 'a value'} · ${on}`,
      ...(said.length ? { detail: said.join(' ') } : {}),
      action: todo,
      ...(notice.page ? { page: notice.page } : {}),
    };
  }

  if (notice.kind === 'line_answered') {
    const item = (project.checklist ?? []).find((held) => held.id === notice.checklistItemId);
    if (!item) return undefined;
    const paper = item.received?.evidenceId ? project.evidence.find((held) => held.id === item.received!.evidenceId) : undefined;
    return { ...base, title: `In hand: ${item.title}`, ...(paper ? { detail: `Marked against ${paper.title}.`, evidenceId: paper.id } : {}), action: paper ? 'Read it.' : 'See that it is on file.' };
  }

  const request = (project.requests ?? []).find((held) => held.id === notice.requestId);
  if (!request) return undefined;
  if (notice.kind === 'request_replied') {
    // The reply this line of the trail recorded, by who sent it and when. Their words are not repeated: they wait on a person.
    const reply = (request.replies ?? []).find((held) => held.receivedAt === notice.at && `${OUTSIDE_ACTOR}${held.from}` === notice.by);
    const papers = reply?.attachments.length ?? 0;
    return { ...base, title: `Reply: ${request.title}`, detail: papers ? `${plural(papers, 'paper')} came with it, waiting to be confirmed.` : 'Words alone, with no paper.', action: 'Confirm it answers the request, or set it aside.' };
  }
  const paper = request.answeredByEvidenceId ? project.evidence.find((held) => held.id === request.answeredByEvidenceId) : undefined;
  return { ...base, title: `Answered: ${request.title}`, ...(paper ? { detail: `With ${paper.title}.`, evidenceId: paper.id } : {}), action: paper ? 'Read what came.' : 'See what came.' };
}

const KIND_COUNTED: Record<TellEventKind, [string, string]> = {
  paper_filed: ['paper filed', 'papers filed'],
  value_accepted: ['value accepted', 'values accepted'],
  value_changed: ['value changed', 'values changed'],
  line_answered: ['paper owed now in hand', 'papers owed now in hand'],
  request_answered: ['request answered', 'requests answered'],
  request_replied: ['reply to a request', 'replies to requests'],
};

/** How many of each kind, in a line: "10 papers filed, 2 values changed". */
export function tellCounted(lines: readonly Pick<TellLine, 'kind'>[]): string {
  return (Object.keys(KIND_COUNTED) as TellEventKind[])
    .map((kind) => [kind, lines.filter((line) => line.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => plural(n, ...KIND_COUNTED[kind]))
    .join(', ');
}

/** The most a message lists. The rest are counted, and are in the app. */
export const TELL_MESSAGE_LINES = 20;

/** One message for one person about one project: everything due to them, together. */
export function tellMessage(project: Pick<DdProject, 'name' | 'reference'>, lines: readonly TellLine[], link: string): { subject: string; text: string; push: string } {
  const counted = tellCounted(lines);
  const shown = lines.slice(0, TELL_MESSAGE_LINES);
  const body = shown.map((line) => [line.title, ...(line.detail ? [`  ${line.detail}`] : []), `  ${line.action}`].join('\n'));
  if (lines.length > shown.length) body.push(`And ${lines.length - shown.length} more in the app.`);
  return {
    subject: `${project.name}: ${counted}`,
    text: `${body.join('\n\n')}\n\n${project.name} (${project.reference})\n${link}`,
    push: lines.length === 1 ? `${lines[0]!.title}. ${lines[0]!.action}` : `${counted}. ${lines[0]!.action}`,
  };
}
