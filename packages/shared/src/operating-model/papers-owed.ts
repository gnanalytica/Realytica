/**
 * Papers owed: one list of every paper a project is waiting for.
 *
 * Three records say a paper is owed. The checks expect documents
 * (`requirement-sheet.ts`), a list somebody sent names more (`checklist.ts`),
 * and a request asks a named person for something (`project-requests.ts`).
 * They stay three records. On screen they are one list, by who owes the
 * paper, each line standing in one of four places: not asked, asked for,
 * answered and waiting for a person to confirm, or in hand.
 *
 * The list is shown a department at a time, on the Documents part of that
 * department's functions. A project has no page of its own for it: Overview
 * counts what is owed across the departments, and each count opens the
 * department that holds it (`paperPlace`).
 *
 * Nothing is stored here and nothing is changed: every line is read off the
 * project as it was handed over, so somebody working from a grant is shown
 * what their copy holds and no more.
 */
import { checklistFunction, papersOwedOpen } from './chat-places';
import { checklistLineTracked, checklistSheet, type ChecklistLine } from './checklist';
import { cockpitPath, type ProjectCockpitPane } from './cockpit';
import { DEPARTMENT_KEYS, DEPARTMENT_SHORT, workstreamDefinition, type DepartmentKey } from './departments';
import { addressKey } from './field-registry';
import { fieldsOwed } from './field-sheets';
import { checklistLinesReplied, repliesWaiting } from './outside-replies';
import { requirementSheet, type RequirementItem } from './requirement-sheet';
import type { CockpitPathExtra } from './sitting';
import type { DdProject, ProjectRequest } from './types';

export type PaperStanding = 'not_asked' | 'asked' | 'answered' | 'partial' | 'assumed' | 'in_hand';

/**
 * The places a paper stands, in the words the screens use. Four are worked
 * out: not asked, asked for, answered and in hand. Two a person sets, or a
 * list's own status column does: partly in hand with the rest still owed,
 * and to be assumed, which is a paper that will not come.
 */
export const PAPER_STANDING_LABEL: Record<PaperStanding, string> = {
  not_asked: 'Not asked',
  asked: 'Asked for',
  answered: 'To confirm',
  partial: 'Partial',
  assumed: 'To be assumed',
  in_hand: 'In hand',
};

/** The list's own name, wherever a screen or a notice says it. */
export const PAPERS_OWED = 'Papers owed';

export interface PaperLine {
  key: string;
  /** Which record says it is owed: a document the checks expect, a line of a loaded list, a request by itself, or a field of a function's sheet that another party owes. */
  from: 'checks' | 'list' | 'request' | 'fields';
  title: string;
  department?: DepartmentKey;
  /** Who owes it: the party a list names, else whoever was asked. */
  party?: string;
  standing: PaperStanding;
  /** Where it sits in its own record: the discipline, or the stage and package. */
  where?: string;
  askedOn?: string;
  dueAt?: string;
  overdue?: boolean;
  /** The open request it rides on. */
  request?: ProjectRequest;
  /** Who answered, where a reply waits. */
  repliedBy?: string;
  evidenceId?: string;
  fileName?: string;
  requirement?: RequirementItem;
  checklist?: ChecklistLine;
  /** Its number on the list it came from, and the round it was asked in. */
  ref?: string;
  round?: string;
  /** A few words on what came back. */
  remark?: string;
  /** What is still wanted, of a paper partly in hand. */
  wanted?: string;
  /** Who proceeds on an assumption, for a paper that will not come. */
  assumer?: string;
  /** A line of a list that is still owed and names nobody to owe it, or no day it is wanted by. */
  unnamed?: true;
  undated?: true;
}

export interface PaperParty {
  key: string;
  /** Absent: nobody is named for these. */
  party?: string;
  lines: PaperLine[];
  notAsked: number;
  asked: number;
  answered: number;
  partial: number;
  overdue: number;
}

export interface PapersOwed {
  /** What is not in hand, by who owes it. Whoever has a reply waiting comes first, nobody named last. */
  parties: PaperParty[];
  inHand: PaperLine[];
  /**
   * Documents the checks would expect that this project has not asked
   * anybody for. They are a list to pick from, not papers owed: nobody was
   * asked, nobody is named, and none is counted below.
   */
  expected: PaperLine[];
  /** Papers that will not come, each with who proceeds on an assumption. Owed by nobody, and not in hand. */
  assumed: PaperLine[];
  total: number;
  owed: number;
  notAsked: number;
  asked: number;
  answered: number;
  partial: number;
  overdue: number;
  /** Lines of a list still owed that name nobody to owe them, and that name no day. */
  nobodyNamed: number;
  noDate: number;
  /** The rounds the list's lines were asked in, in the order they first appear. */
  rounds: string[];
  /** Whether the list keeps what a tracked list keeps: numbers, rounds, days. Only then is a missing day said. */
  tracked: boolean;
}

function fold(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const RANK: Record<PaperStanding, number> = { answered: 0, partial: 1, asked: 2, not_asked: 3, assumed: 4, in_hand: 5 };

function replied(request: ProjectRequest | undefined): string | undefined {
  const reply = request ? repliesWaiting(request)[0] : undefined;
  return reply ? (reply.fromName ?? reply.from) : undefined;
}

/**
 * Every paper the project waits for, as one list.
 *
 * It starts from what this project has done and holds: what it asked
 * somebody for, the lines of a list it loaded, the papers it has in hand,
 * and the fields of its sheets that another party owes and that are due at
 * the step the project has reached (`owedBy`, `dueFrom`). A document a check
 * would expect that nobody has asked for is not owed by anybody yet: a new
 * project is not a hundred papers behind. Those are returned beside the
 * list as `expected`, to ask for, and counted nowhere.
 *
 * `department` narrows it to one desk, which is how a screen shows it: the
 * documents its checks expect and the list loaded there. A request tied to
 * neither belongs to no desk, so it is counted only across the whole project
 * and is worked on the firm's Requests.
 *
 * `outside` is somebody working from a grant. They are shown how a paper
 * stood before: asked for or not, in hand or not. Who answered the firm, and
 * that a reply waits, is the firm's own, as are its requests made by hand.
 */
export function papersOwed(project: DdProject, opts: { department?: DepartmentKey; now?: string; outside?: boolean } = {}): PapersOwed {
  const today = (opts.now ?? new Date().toISOString()).slice(0, 10);
  const requests = new Map((project.requests ?? []).map((request) => [request.id, request]));
  const lines: PaperLine[] = [];
  const claimed = new Set<string>();

  for (const department of opts.department ? [opts.department] : DEPARTMENT_KEYS) {
    for (const group of requirementSheet(project, { department, now: opts.now }).groups) {
      for (const item of group.items) {
        const request = item.requestId ? requests.get(item.requestId) : undefined;
        if (request) claimed.add(request.id);
        const repliedBy = opts.outside ? undefined : replied(request);
        lines.push({
          key: `c:${department}:${group.key}:${item.evidenceId ?? item.title}`,
          from: 'checks',
          title: item.title,
          department,
          standing: item.status === 'received' ? 'in_hand' : item.status === 'pending' ? 'not_asked' : repliedBy ? 'answered' : 'asked',
          where: group.label,
          requirement: item,
          ...(item.askedOf ? { party: item.askedOf } : {}),
          ...(request?.sentAt ? { askedOn: request.sentAt } : {}),
          ...(item.dueAt ? { dueAt: item.dueAt } : {}),
          ...(item.overdue && !repliedBy ? { overdue: true } : {}),
          ...(request ? { request } : {}),
          ...(repliedBy ? { repliedBy } : {}),
          ...(item.status === 'received' && item.evidenceId ? { evidenceId: item.evidenceId } : {}),
          ...(item.fileName ? { fileName: item.fileName } : {}),
        });
      }
    }
  }

  const answeredLines = checklistLinesReplied(project);
  for (const stage of checklistSheet(project, opts).stages) {
    for (const pack of stage.packages) {
      for (const line of pack.lines) {
        const request = line.requestId ? requests.get(line.requestId) : undefined;
        if (request) claimed.add(request.id);
        const reply = opts.outside ? undefined : answeredLines.get(line.item.id)?.reply;
        const party = line.item.owedBy ?? line.askedOf;
        // Under its own sections where the list has them, each with its number; else its stage and package as before.
        const sections = (line.item.headings ?? []).map((heading) => [heading.ref, heading.title].filter(Boolean).join(' '));
        const where = [line.item.stage, line.item.package, ...sections].filter(Boolean).join(' · ');
        const standing: PaperStanding =
          line.status === 'received' ? 'in_hand' : line.mark === 'assumed' ? 'assumed' : reply ? 'answered' : line.mark === 'partial' ? 'partial' : line.status === 'pending' ? 'not_asked' : 'asked';
        const open = standing !== 'in_hand' && standing !== 'assumed';
        lines.push({
          key: `l:${line.item.id}`,
          from: 'list',
          title: line.item.title,
          department: line.item.department,
          standing,
          checklist: line,
          ...(line.item.ref ? { ref: line.item.ref } : {}),
          ...(line.item.round ? { round: line.item.round } : {}),
          ...(line.item.remark ? { remark: line.item.remark.text } : {}),
          ...(line.item.partial?.wanted && standing !== 'in_hand' ? { wanted: line.item.partial.wanted } : {}),
          ...(standing === 'assumed' ? { assumer: line.item.assumed!.assumer } : {}),
          ...(open && !party ? { unnamed: true as const } : {}),
          ...(open && !line.dueAt ? { undated: true as const } : {}),
          ...(where ? { where } : {}),
          ...(party ? { party } : {}),
          ...(request?.sentAt ? { askedOn: request.sentAt } : {}),
          ...(line.dueAt ? { dueAt: line.dueAt } : {}),
          ...(line.overdue && !reply ? { overdue: true } : {}),
          ...(request ? { request } : {}),
          ...(reply ? { repliedBy: reply.fromName ?? reply.from } : {}),
          ...(line.evidenceId ? { evidenceId: line.evidenceId } : {}),
          ...(line.fileName ? { fileName: line.fileName } : {}),
        });
      }
    }
  }

  // What a function's sheets wait on from another party: each field that party owes, under that party.
  for (const { fn, department, groups } of fieldsOwed(project, opts.now ? new Date(opts.now) : new Date())) {
    if (opts.department && department !== opts.department) continue;
    for (const group of groups) {
      for (const field of group.fields) {
        lines.push({ key: `f:${addressKey(field.address)}`, from: 'fields', title: field.label, department, party: group.label, standing: 'not_asked', where: `${workstreamDefinition(fn)?.label ?? fn} · ${field.sheet}` });
      }
    }
  }

  if (!opts.department && !opts.outside) {
    // A request that covers checklist lines, or answers a document a check expects, is already a line above.
    const expected = new Set(lines.filter((line) => line.from === 'checks' && line.requirement?.evidenceId).map((line) => line.requirement!.evidenceId!));
    for (const request of project.requests ?? []) {
      if (request.status === 'cancelled' || claimed.has(request.id) || request.checklistItemIds?.length) continue;
      if (request.evidenceId && expected.has(request.evidenceId)) continue;
      const repliedBy = replied(request);
      // A paper that was answered is waiting on the firm, not on them: it is not overdue.
      const overdue = request.status === 'sent' && !repliedBy && Boolean(request.dueAt && request.dueAt.slice(0, 10) < today);
      lines.push({
        key: `r:${request.id}`,
        from: 'request',
        title: request.title,
        party: request.recipient,
        standing: request.status === 'answered' ? 'in_hand' : request.status === 'draft' ? 'not_asked' : repliedBy ? 'answered' : 'asked',
        request,
        ...(request.recipientRole ? { where: request.recipientRole } : {}),
        ...(request.sentAt ? { askedOn: request.sentAt } : {}),
        ...(request.dueAt ? { dueAt: request.dueAt } : {}),
        ...(overdue ? { overdue: true } : {}),
        ...(repliedBy ? { repliedBy } : {}),
        ...(request.answeredByEvidenceId ? { evidenceId: request.answeredByEvidenceId } : {}),
      });
    }
  }

  const unasked = (line: PaperLine): boolean => line.from === 'checks' && line.standing === 'not_asked';
  const expected = lines.filter(unasked);
  const counted = lines.filter((line) => !unasked(line));
  const parties = new Map<string, PaperParty>();
  for (const line of counted) {
    if (line.standing === 'in_hand' || line.standing === 'assumed') continue;
    const key = fold(line.party);
    const held = parties.get(key) ?? { key, party: line.party, lines: [], notAsked: 0, asked: 0, answered: 0, partial: 0, overdue: 0 };
    parties.set(key, held);
    held.lines.push(line);
    if (line.standing === 'not_asked') held.notAsked += 1;
    if (line.standing === 'asked') held.asked += 1;
    if (line.standing === 'answered') held.answered += 1;
    if (line.standing === 'partial') held.partial += 1;
    if (line.overdue) held.overdue += 1;
  }
  for (const party of parties.values()) party.lines.sort((a, b) => RANK[a.standing] - RANK[b.standing] || Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)));
  const owing = [...parties.values()].sort((a, b) => Number(!a.party) - Number(!b.party) || b.answered - a.answered || b.overdue - a.overdue || b.lines.length - a.lines.length || a.key.localeCompare(b.key));
  const owed = owing.reduce((n, party) => n + party.lines.length, 0);
  const listed = counted.filter((line) => line.from === 'list');
  const rounds: string[] = [];
  for (const line of listed) if (line.round && !rounds.some((round) => fold(round) === fold(line.round))) rounds.push(line.round);
  return {
    parties: owing,
    inHand: counted.filter((line) => line.standing === 'in_hand'),
    expected,
    assumed: counted.filter((line) => line.standing === 'assumed'),
    total: counted.length,
    owed,
    notAsked: owing.reduce((n, party) => n + party.notAsked, 0),
    asked: owing.reduce((n, party) => n + party.asked, 0),
    answered: owing.reduce((n, party) => n + party.answered, 0),
    partial: owing.reduce((n, party) => n + party.partial, 0),
    overdue: owing.reduce((n, party) => n + party.overdue, 0),
    nobodyNamed: listed.filter((line) => line.unnamed).length,
    noDate: listed.filter((line) => line.undated).length,
    rounds,
    tracked: listed.some((line) => checklistLineTracked(line.checklist!.item)),
  };
}

/** The list in a line, for a subtitle: "8 owed · 1 to confirm · 4 asked for · 3 not asked · 2 overdue". */
export function papersOwedSaid(view: Pick<PapersOwed, 'total' | 'owed' | 'notAsked' | 'asked' | 'answered' | 'overdue'> & { partial?: number; assumed?: readonly unknown[] }): string {
  if (!view.total) return 'Nothing asked for yet';
  const assumed = view.assumed?.length ?? 0;
  if (!view.owed) return assumed ? `${view.total - assumed} in hand · ${assumed} to be assumed` : `All ${view.total} in hand`;
  return [
    `${view.owed} owed`,
    view.answered ? `${view.answered} to confirm` : '',
    view.partial ? `${view.partial} partial` : '',
    view.asked ? `${view.asked} asked for` : '',
    view.notAsked ? `${view.notAsked} not asked` : '',
    assumed ? `${assumed} to be assumed` : '',
    view.overdue ? `${view.overdue} overdue` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** How one line stands, in a line under its name. */
export function paperLineSaid(line: PaperLine, day: (iso: string) => string, opts: { tracked?: boolean } = {}): string {
  if (line.standing === 'in_hand') return line.fileName ?? (line.from === 'request' ? 'Answered' : line.checklist?.item.received?.fromList ? 'Received, by the list' : 'Marked in hand');
  if (line.standing === 'assumed') return `Will not come · ${line.assumer} to assume${line.checklist?.item.assumed?.fields?.length ? '' : ' · no field named'}`;
  if (line.standing === 'answered') return `Answered by ${line.repliedBy ?? 'them'} · waiting for you to confirm`;
  const due = line.dueAt ? `due ${day(line.dueAt)}${line.overdue ? ' (overdue)' : ''}` : '';
  // The one quiet mark: who owes it and by when is said where either is missing, on a list that keeps them.
  const blank = line.from === 'list' && opts.tracked ? [line.unnamed ? 'nobody named' : '', line.undated ? 'no date' : ''].filter(Boolean).join(', ') : '';
  const asked = line.askedOn ? `Asked ${day(line.askedOn)}` : line.round ? `Asked in ${line.round}` : 'Asked';
  if (line.standing === 'partial') {
    const rest = line.checklist?.status === 'requested' ? asked : 'the rest not asked for';
    return [`Partly in hand${line.wanted ? `, still wanted: ${line.wanted}` : ''}`, rest, due, blank].filter(Boolean).join(' · ');
  }
  if (line.standing === 'asked') return [asked, due, blank].filter(Boolean).join(' · ');
  if (line.from === 'fields') return 'A sheet waits for it';
  if (line.from === 'request') return 'Drafted, not sent';
  if (line.from === 'checks') return 'A check expects it';
  if (opts.tracked) return ['On the list', due, blank].filter(Boolean).join(' · ');
  return [line.party ? 'On the list' : 'On the list, nobody named', due].filter(Boolean).join(' · ');
}

/**
 * What is owed as plain text, to paste into a message: a party, then its
 * papers, one a line. `only` keeps the lines standing one way.
 */
export function papersOwedText(view: Pick<PapersOwed, 'parties'>, day: (iso: string) => string, opts: { only?: PaperStanding } = {}): string {
  const out: string[] = [];
  for (const party of view.parties) {
    const lines = party.lines.filter((line) => !opts.only || line.standing === opts.only);
    if (!lines.length) continue;
    out.push(`${party.party ?? 'Nobody named'} (${lines.length})`);
    for (const line of lines) {
      const due = line.dueAt ? `, due ${day(line.dueAt)}${line.overdue ? ', overdue' : ''}` : '';
      const stands =
        line.standing === 'asked' ? `asked${due}` : line.standing === 'answered' ? 'answered, to confirm' : line.standing === 'partial' ? `partly in hand${line.wanted ? `, still wanted: ${line.wanted}` : ''}${due}` : `not asked${line.overdue ? due : ''}`;
      out.push(`- ${line.title} (${stands})`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function csvCell(value: string): string {
  // A cell that opens with a sign a spreadsheet reads as a formula is given as text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole list as a spreadsheet, after a byte-order mark so Excel reads Indian scripts. */
export function papersOwedCsvFile(view: PapersOwed): string {
  // A list that keeps numbers, rounds and remarks is written with them, after the columns every list has.
  const tracked = view.tracked;
  const rows = [['Owed by', 'Paper', 'Standing', 'Asked on', 'Due', 'Overdue', 'Department', 'Where', 'Document', ...(tracked ? ['Ref', 'Round', 'Remark', 'Still wanted', 'To assume'] : [])].join(',')];
  for (const line of [...view.parties.flatMap((party) => party.lines), ...view.assumed, ...view.inHand]) {
    rows.push(
      [
        line.party ?? '',
        line.title,
        PAPER_STANDING_LABEL[line.standing],
        line.askedOn?.slice(0, 10) ?? '',
        line.dueAt?.slice(0, 10) ?? '',
        line.overdue ? 'yes' : '',
        line.department ? DEPARTMENT_SHORT[line.department] : '',
        line.where ?? '',
        line.fileName ?? '',
        ...(tracked ? [line.ref ?? '', line.round ?? '', line.remark ?? '', line.wanted ?? '', line.assumer ?? ''] : []),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `﻿${rows.join('\n')}\n`;
}

/* ==================================================================== */
/* Where a paper is worked                                               */
/* ==================================================================== */

/** Where a paper owed is worked: a page of its project, or the firm's Requests. */
export type PapersPlace = { pane: ProjectCockpitPane; extra?: CockpitPathExtra } | { firm: 'requests' };

/**
 * Where one paper is worked: the Documents part of the department that holds
 * it, with `item` the line to open there.
 *
 * A request made by hand belongs to no department, and a department with no
 * function laid out in parts shows no list. What was asked of somebody there
 * is worked on the firm's Requests, which lists the replies to confirm first.
 */
export function paperPlace(line: Pick<PaperLine, 'department' | 'request'>, item?: string): PapersPlace {
  if (line.department && (checklistFunction(line.department) || !line.request)) return papersOwedOpen(line.department, item);
  return { firm: 'requests' };
}

/** The address of that place. */
export function papersPlacePath(projectId: string, place: PapersPlace): string {
  return 'firm' in place ? '/requests' : cockpitPath(projectId, place.pane, place.extra);
}

/**
 * The department a request belongs to: that of the lines of a list it
 * covers, or the first whose checks expect the document it asks for. A
 * request made by hand for neither belongs to none.
 */
export function requestDepartment(project: DdProject, request: Pick<ProjectRequest, 'checklistItemIds' | 'evidenceId'>): DepartmentKey | undefined {
  const line = request.checklistItemIds?.length ? (project.checklist ?? []).find((item) => request.checklistItemIds!.includes(item.id)) : undefined;
  if (line) return line.department;
  if (!request.evidenceId) return undefined;
  return DEPARTMENT_KEYS.find((department) => requirementSheet(project, { department }).groups.some((group) => group.items.some((item) => item.evidenceId === request.evidenceId)));
}

/** Where a request is worked: its department's Documents, or the firm's Requests when it belongs to none. */
export function requestPlace(project: DdProject, request: ProjectRequest): PapersPlace {
  return paperPlace({ department: requestDepartment(project, request), request });
}

/** The place that holds the most of some papers, or none for no papers. Held equally, a department comes before the firm's Requests, and then whichever holds the first of them. */
export function papersHeldAt(lines: readonly PaperLine[]): PapersPlace | undefined {
  const held = new Map<string, { place: PapersPlace; n: number }>();
  for (const line of lines) {
    const place = paperPlace(line);
    const key = JSON.stringify(place);
    held.set(key, { place, n: (held.get(key)?.n ?? 0) + 1 });
  }
  return [...held.values()].sort((a, b) => b.n - a.n || Number('firm' in a.place) - Number('firm' in b.place))[0]?.place;
}
