/**
 * Law and policy watch: the official pages a firm watches, and what a change
 * on one of them is taken to mean.
 *
 * A firm keeps a short list of official pages. Each is looked at on its own
 * interval; the page's words are kept, and when they differ from the last
 * look the difference is a change. A change is shown to the firm with the
 * lines that came and went. Where a model is set up it proposes a summary
 * and, for each project the source bears on, action items by department.
 *
 * Nothing a change says reaches a project on a model's word or on the
 * timer's. A firm admin or a department's lead confirms it by name, with the
 * summary and the actions as they leave them, and only then is an action put
 * on a project, carrying the source's link, the day the change was seen and
 * who confirmed it. A change may be dismissed instead, and then nothing is.
 *
 * This watches the listed pages only. A rule that changed somewhere else is
 * not seen, and what is seen is a page's words, not legal advice.
 *
 * Everything here is a pure function of what it is handed. Fetching, storage
 * and the model live in the API (`apps/api/src/law-watch.ts`).
 */

import type { ActionRecord, DdProject, ProjectArchetype } from './types';
import type { DepartmentKey, StageKey } from './departments';
import { DEPARTMENT_KEYS, DEPARTMENT_SHORT, STAGES, stageOf } from './departments';
import type { WorkspaceRole } from './tenancy';
import { can, reachesEveryProject } from './tenancy';
import { departmentRole, projectDepartments } from './team';
import { addAction } from './operations';

/** How often a source may be looked at: daily at the most, quarterly at the least. */
export const LAW_LOOK_DAYS = { least: 1, most: 90 } as const;
/** The words of one page that are kept, at most. A longer page is cut here and said to be. */
export const LAW_TEXT_AT_MOST = 400_000;
/** The lines of a difference that are kept on each side, and the length of each. */
export const LAW_DIFF_LINES = 60;
export const LAW_DIFF_LINE = 400;
export const LAW_SUMMARY = 1200;
export const LAW_ACTION_TITLE = 200;
export const LAW_ACTIONS_A_PROJECT = 6;
/** Changes kept on the list. The oldest decided ones go first. */
export const LAW_CHANGES_KEPT = 200;

/** A source that bears on every part of the country. */
export const LAW_EVERYWHERE = 'India';

export interface LawSource {
  id: string;
  title: string;
  /** The official page that is looked at. */
  url: string;
  /** The state it applies in, or `India` for the centre. */
  jurisdiction: string;
  /** What it governs, in a line. */
  governs: string;
  departments: DepartmentKey[];
  /** The kinds of project it bears on. Empty: every kind. */
  projectKinds: ProjectArchetype[];
  /** The stages it bears on. Empty or absent: every stage. */
  stages?: StageKey[];
  /** Looked at once in this many days. */
  everyDays: number;
  paused?: boolean;
  addedBy: string;
  addedAt: string;
  /** The last look, whether it read the page or not. */
  lastLookAt?: string;
  /** The last look that read the page. */
  lastReadAt?: string;
  /** Why the last look read nothing. Absent after a look that read the page. */
  lastError?: string;
  /** The hash of the page's words at the last look that read it. */
  hash?: string;
  lastChangeAt?: string;
}

export interface LawSourceInput {
  title: string;
  url: string;
  jurisdiction: string;
  governs: string;
  departments: DepartmentKey[];
  projectKinds?: ProjectArchetype[];
  stages?: StageKey[];
  everyDays: number;
}

/** One line that came or went. */
export interface LawDiff {
  added: string[];
  removed: string[];
  /** How many lines came and went in all, where more than are kept. */
  addedCount: number;
  removedCount: number;
}

export interface LawProposedAction {
  department: DepartmentKey;
  title: string;
}

export interface LawProposedProject {
  projectId: string;
  /** Why it may bear on this project, in a line. */
  why?: string;
  actions: LawProposedAction[];
}

/** What a model proposed for a change. Never the record: a person confirms or dismisses. */
export interface LawProposal {
  summary: string;
  /** The changed passage the summary rests on, as the page writes it. Empty where the model quoted nothing the page writes. */
  quote: string;
  projects: LawProposedProject[];
  at: string;
}

export interface LawApplied {
  projectId: string;
  projectName: string;
  actionIds: string[];
}

export interface LawChange {
  id: string;
  sourceId: string;
  sourceTitle: string;
  url: string;
  /** When the look that found it was made. */
  seenAt: string;
  diff: LawDiff;
  proposal?: LawProposal;
  state: 'waiting' | 'confirmed' | 'dismissed';
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  /** The summary as the person confirmed it. */
  summary?: string;
  /** Why it was dismissed, where the person said. */
  why?: string;
  /** The actions put on projects when it was confirmed. */
  applied?: LawApplied[];
}

export interface LawWatchState {
  v: 1;
  sources: LawSource[];
  changes: LawChange[];
}

/* ==================================================================== */
/* The list a firm starts with                                           */
/* ==================================================================== */

/**
 * The sources a firm starts with.
 *
 * Each address was opened on 12 October 2026 and answered as an official
 * page of the body named. The list is short because only pages that
 * answered are on it: the Karnataka and India Code pages did not answer from
 * where this was written, so they are not here, and a firm adds them itself.
 */
export const LAW_WATCH_SEED: ReadonlyArray<LawSourceInput & { id: string }> = [
  {
    id: 'moefcc-environment-protection',
    title: 'Environment (Protection) Act and Rules: notifications by subject',
    url: 'https://moef.gov.in/environment-protection',
    jurisdiction: LAW_EVERYWHERE,
    governs: 'Environmental clearance, coastal regulation zones and the rules made under the Environment (Protection) Act, 1986',
    departments: ['legal', 'design', 'construction'],
    projectKinds: [],
    stages: ['pre_development', 'design_tender', 'construction'],
    everyDays: 7,
  },
  {
    id: 'moefcc-esz-notifications',
    title: 'Eco-sensitive zone notifications',
    url: 'https://moef.gov.in/esz-notifications',
    jurisdiction: LAW_EVERYWHERE,
    governs: 'Eco-sensitive zones notified around protected areas, and what may be built inside them',
    departments: ['legal', 'design'],
    projectKinds: [],
    stages: ['pre_development', 'design_tender'],
    everyDays: 7,
  },
  {
    id: 'ibbi-circulars',
    title: 'Insolvency and Bankruptcy Board of India: circulars',
    url: 'https://ibbi.gov.in/legal-framework/circulars',
    jurisdiction: LAW_EVERYWHERE,
    governs: 'Circulars to registered valuers and insolvency professionals',
    departments: ['finance'],
    projectKinds: [],
    everyDays: 7,
  },
];

/** The list as a firm that has kept none of its own is shown it. */
export function seededLawWatch(now: string): LawWatchState {
  return {
    v: 1,
    sources: LAW_WATCH_SEED.map((seed) => ({ ...seed, projectKinds: [...(seed.projectKinds ?? [])], departments: [...seed.departments], ...(seed.stages ? { stages: [...seed.stages] } : {}), addedBy: 'Realytica', addedAt: now })),
    changes: [],
  };
}

/** What was kept, as a list this build can use. Anything that is not a list is no list. */
export function lawWatchHeld(kept: unknown): LawWatchState | undefined {
  const held = kept as Partial<LawWatchState> | null;
  if (!held || typeof held !== 'object' || !Array.isArray(held.sources)) return undefined;
  return {
    v: 1,
    sources: held.sources.filter((source) => Boolean(source && typeof source.id === 'string' && typeof source.url === 'string')),
    changes: Array.isArray(held.changes) ? held.changes.filter((change) => Boolean(change && typeof change.id === 'string' && change.diff)) : [],
  };
}

/* ==================================================================== */
/* The list                                                              */
/* ==================================================================== */

const clean = (text: string, most: number): string => text.replace(/\s+/g, ' ').trim().slice(0, most);

/** A source as it is kept: its words trimmed, its departments, kinds and stages only ones the product has. Throws where it cannot be watched. */
export function lawSourceFrom(input: LawSourceInput): Omit<LawSource, 'id' | 'addedBy' | 'addedAt'> {
  const title = clean(input.title, 160);
  if (!title) throw new Error('A source needs a title.');
  // The address as typed, held to a plain https address of a named host: no sign-in in it, no port, nothing but a host and a path.
  const url = input.url.trim();
  if (/\s/.test(url) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) throw new Error('That is not a web address.');
  if (!/^https:\/\//i.test(url)) throw new Error('A source is an https address.');
  const host = url.slice(8).split(/[/?#]/)[0] ?? '';
  if (host.includes('@')) throw new Error('A source’s address carries no sign-in.');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)) throw new Error('That is not a web address.');
  const departments = DEPARTMENT_KEYS.filter((key) => input.departments.includes(key));
  if (!departments.length) throw new Error('Say which departments it bears on.');
  const everyDays = Math.round(input.everyDays);
  if (!(everyDays >= LAW_LOOK_DAYS.least && everyDays <= LAW_LOOK_DAYS.most)) throw new Error(`Look once in ${LAW_LOOK_DAYS.least} to ${LAW_LOOK_DAYS.most} days.`);
  const stages = STAGES.map((stage) => stage.key).filter((key) => (input.stages ?? []).includes(key));
  return {
    title,
    url,
    jurisdiction: clean(input.jurisdiction, 60) || LAW_EVERYWHERE,
    governs: clean(input.governs, 240),
    departments,
    projectKinds: [...new Set(input.projectKinds ?? [])],
    ...(stages.length ? { stages } : {}),
    everyDays,
  };
}

export function addLawSource(state: LawWatchState, input: LawSourceInput, id: string, actor: string, now: string): LawSource {
  const fields = lawSourceFrom(input);
  if (state.sources.some((held) => held.url === fields.url)) throw new Error('That address is on the list already.');
  const source: LawSource = { id, ...fields, addedBy: actor, addedAt: now };
  state.sources.push(source);
  return source;
}

/** A person's change to a source. A new address is a new page: what was read of the old one is let go. */
export function editLawSource(state: LawWatchState, id: string, input: LawSourceInput & { paused?: boolean }): LawSource {
  const source = state.sources.find((held) => held.id === id);
  if (!source) throw new Error('No source by that id.');
  const fields = lawSourceFrom(input);
  if (state.sources.some((held) => held.id !== id && held.url === fields.url)) throw new Error('That address is on the list already.');
  if (fields.url !== source.url) {
    delete source.hash;
    delete source.lastReadAt;
    delete source.lastError;
    delete source.lastLookAt;
  }
  delete source.stages;
  Object.assign(source, fields);
  if (input.paused) source.paused = true;
  else delete source.paused;
  return source;
}

/** Take a source off the list. Its changes that still wait go with it; what was decided stays. */
export function removeLawSource(state: LawWatchState, id: string): void {
  if (!state.sources.some((held) => held.id === id)) throw new Error('No source by that id.');
  state.sources = state.sources.filter((held) => held.id !== id);
  state.changes = state.changes.filter((change) => change.sourceId !== id || change.state !== 'waiting');
}

/** Whether a source is to be looked at now. A look made a little early in the day still counts for the day. */
export function lawSourceDue(source: LawSource, now: Date): boolean {
  if (source.paused) return false;
  if (!source.lastLookAt) return true;
  const since = now.getTime() - Date.parse(source.lastLookAt);
  return !(since < source.everyDays * 86_400_000 - 2 * 3_600_000);
}

/* ==================================================================== */
/* A page's words                                                        */
/* ==================================================================== */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', raquo: '»', laquo: '«', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

function decoded(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A line that changes whenever a page is served, and so says nothing about the law: a visitor count, a clock, the day the site was last touched. */
const SERVED_WORDS = /last (?:updated|reviewed|modified)(?: on)?|updated on|page last|visitors?(?: count)?|hits|total visits|अंतिम अद्यतन|अद्यतन|आगंतुक/giu;
/** Whether a line is only such words and figures: it then states nothing a reader would act on. */
const served = (line: string): boolean => /^[\d\s:.,/|–-]*$/u.test(line.replace(SERVED_WORDS, ''));

/**
 * A page as lines of plain words, the same for the same page however it was
 * served: markup, scripts and styles gone, space collapsed, and the lines a
 * site changes on every visit left out.
 */
export function lawPageText(raw: string, kind: 'html' | 'text'): string {
  let text = raw;
  if (kind === 'html') {
    text = text
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol|\/td|\/th)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
    text = decoded(text);
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[\s ​-‍﻿]+/g, ' ').trim())
    .filter((line) => line && !served(line));
  return lines.join('\n').slice(0, LAW_TEXT_AT_MOST);
}

/** The lines that came and the lines that went, in the order the pages write them. A line that only moved is neither. */
export function lawTextDiff(before: string, after: string): LawDiff {
  const count = (text: string) => {
    const seen = new Map<string, number>();
    for (const line of text.split('\n')) if (line) seen.set(line, (seen.get(line) ?? 0) + 1);
    return seen;
  };
  const only = (text: string, other: Map<string, number>): string[] => {
    const left = new Map(other);
    const out: string[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const held = left.get(line) ?? 0;
      if (held > 0) left.set(line, held - 1);
      else out.push(line);
    }
    return out;
  };
  const added = only(after, count(before));
  const removed = only(before, count(after));
  const kept = (lines: string[]) => lines.slice(0, LAW_DIFF_LINES).map((line) => (line.length > LAW_DIFF_LINE ? `${line.slice(0, LAW_DIFF_LINE - 1)}…` : line));
  return { added: kept(added), removed: kept(removed), addedCount: added.length, removedCount: removed.length };
}

/* ==================================================================== */
/* robots.txt                                                            */
/* ==================================================================== */

/**
 * Whether a site's robots.txt asks this reader to keep off a path.
 *
 * The rules that name this reader are the ones kept, else the rules for
 * everybody. Among those the longest rule that matches the path decides, and
 * an allow wins a tie. A file that is not a robots file asks nothing.
 */
export function robotsDisallows(robots: string, agent: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let open: (typeof groups)[number] | undefined;
  let inRules = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const at = line.indexOf(':');
    if (at === -1) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === 'user-agent') {
      if (!open || inRules) {
        open = { agents: [], rules: [] };
        groups.push(open);
        inRules = false;
      }
      open.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && open) {
      inRules = true;
      if (value) open.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const mine = agent.toLowerCase();
  const named = groups.filter((group) => group.agents.some((name) => name !== '*' && mine.includes(name)));
  const rules = (named.length ? named : groups.filter((group) => group.agents.includes('*'))).flatMap((group) => group.rules);
  const matches = (rule: string): boolean => {
    const anchored = rule.endsWith('$');
    const pattern = (anchored ? rule.slice(0, -1) : rule).split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
  };
  let best: { allow: boolean; length: number } | undefined;
  for (const rule of rules) {
    if (!matches(rule.path)) continue;
    if (!best || rule.path.length > best.length || (rule.path.length === best.length && rule.allow)) best = { allow: rule.allow, length: rule.path.length };
  }
  return Boolean(best && !best.allow);
}

/* ==================================================================== */
/* Which projects a source bears on                                      */
/* ==================================================================== */

/** Where a project is, in the words its record uses, lowered. */
function placeOf(project: DdProject): string {
  return [project.jurisdiction, project.city, project.location, project.siteAddress].filter(Boolean).join(' ').toLowerCase();
}

/** Cities the record names without their state. A project in one of them is in the state. */
const IN_STATE: Record<string, string[]> = {
  karnataka: ['bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubballi', 'hubli', 'dharwad', 'belagavi', 'tumakuru', 'devanahalli'],
};

/**
 * Whether a source plausibly bears on a project: by where the project is,
 * the kind it is, the stage it is at, and whether it uses a department the
 * source is for. A closed project is borne on by nothing.
 */
export function lawBearsOn(source: Pick<LawSource, 'jurisdiction' | 'projectKinds' | 'stages' | 'departments'>, project: DdProject): boolean {
  if (project.status === 'closed') return false;
  const where = source.jurisdiction.trim().toLowerCase();
  if (where && where !== LAW_EVERYWHERE.toLowerCase()) {
    const place = placeOf(project);
    if (!place.includes(where) && !(IN_STATE[where] ?? []).some((city) => place.includes(city))) return false;
  }
  if (source.projectKinds.length && !source.projectKinds.includes(project.type)) return false;
  if (source.stages?.length && !source.stages.includes(stageOf(project.currentStage))) return false;
  return lawDepartmentsOn(source, project).length > 0;
}

/** The departments of a source that a project uses. */
export function lawDepartmentsOn(source: Pick<LawSource, 'departments'>, project: DdProject): DepartmentKey[] {
  const used = projectDepartments(project);
  return source.departments.filter((key) => used.includes(key));
}

/* ==================================================================== */
/* A model's proposal, held to the change                                */
/* ==================================================================== */

const squeezed = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * What a model said about a change, kept only as far as the change bears it
 * out: a quote is kept only where a line that came or went writes it, a
 * project only where it is one the source bears on, and an action only for a
 * department of the source that the project uses. Undefined where nothing
 * usable was said.
 */
export function lawProposalHeld(said: unknown, diff: LawDiff, source: Pick<LawSource, 'departments'>, projects: readonly DdProject[], now: string): LawProposal | undefined {
  const given = said as { summary?: unknown; quote?: unknown; projects?: unknown } | null;
  if (!given || typeof given !== 'object') return undefined;
  const summary = typeof given.summary === 'string' ? clean(given.summary, LAW_SUMMARY) : '';
  if (!summary) return undefined;
  const lines = [...diff.added, ...diff.removed].map(squeezed);
  const asked = typeof given.quote === 'string' ? clean(given.quote, LAW_DIFF_LINE) : '';
  const quote = asked && lines.some((line) => line.includes(squeezed(asked.replace(/…$/, '')))) ? asked : '';
  const out: LawProposedProject[] = [];
  for (const row of Array.isArray(given.projects) ? given.projects : []) {
    const one = row as { projectId?: unknown; why?: unknown; actions?: unknown } | null;
    const project = projects.find((held) => held.id === one?.projectId);
    if (!one || !project || out.some((held) => held.projectId === project.id)) continue;
    const open = lawDepartmentsOn(source, project);
    const actions: LawProposedAction[] = [];
    for (const item of Array.isArray(one.actions) ? one.actions : []) {
      const action = item as { department?: unknown; title?: unknown } | null;
      const title = typeof action?.title === 'string' ? clean(action.title, LAW_ACTION_TITLE) : '';
      const department = open.find((key) => key === action?.department);
      if (title && department && actions.length < LAW_ACTIONS_A_PROJECT) actions.push({ department, title });
    }
    if (actions.length) out.push({ projectId: project.id, ...(typeof one.why === 'string' && clean(one.why, 240) ? { why: clean(one.why, 240) } : {}), actions });
  }
  return { summary, quote, projects: out, at: now };
}

/* ==================================================================== */
/* A person's decision                                                   */
/* ==================================================================== */

export interface LawReviewer {
  email: string;
  name?: string;
  role: WorkspaceRole;
}

/** Whether this person may put an action on a project for a department: a firm admin anywhere, else that department's lead on that project. */
export function mayApplyLaw(person: LawReviewer, project: DdProject, department: DepartmentKey): boolean {
  if (!reachesEveryProject(person.role)) return false;
  if (can(person.role, 'admin')) return true;
  return departmentRole(project, { email: person.email, workspaceRole: person.role }, department) === 'lead';
}

/** Whether this person reviews changes at all: a firm admin, or one of the firm's people who leads a department on a project. */
export function mayReviewLaw(person: LawReviewer, projects: readonly DdProject[]): boolean {
  if (!reachesEveryProject(person.role)) return false;
  if (can(person.role, 'admin')) return true;
  return projects.some((project) => DEPARTMENT_KEYS.some((key) => departmentRole(project, { email: person.email, workspaceRole: person.role }, key) === 'lead'));
}

export interface LawConfirmation {
  summary: string;
  projects: Array<{ projectId: string; actions: LawProposedAction[] }>;
}

/** The day of an instant, as a reader is shown it: 12 October 2026. */
export function lawDay(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** What an action put on a project says of where it came from. */
export function lawActionSource(change: Pick<LawChange, 'sourceTitle' | 'url' | 'seenAt'>, summary: string, who: string, now: string): string {
  return [
    summary,
    `Source: ${change.sourceTitle}, ${change.url}. Change seen on ${lawDay(change.seenAt)}.`,
    `Confirmed by ${who} on ${lawDay(now)}.`,
    'From the firm’s watch of this page. Not legal advice.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Confirm a change by name, and put its actions on the projects named.
 *
 * Every project and department is checked before anything is written, so a
 * confirmation that is refused in part leaves no action behind. Throws where
 * the change is not waiting, a project is not the firm's, the source does
 * not bear on a department there, or the person may not decide for it.
 */
export function confirmLawChange(
  state: LawWatchState,
  changeId: string,
  given: LawConfirmation,
  person: LawReviewer,
  projects: readonly DdProject[],
  now: string,
): { change: LawChange; touched: DdProject[]; made: ActionRecord[] } {
  const change = state.changes.find((held) => held.id === changeId);
  if (!change) throw new Error('No change by that id.');
  if (change.state !== 'waiting') throw new Error(`This change was ${change.state} already.`);
  const summary = clean(given.summary, LAW_SUMMARY);
  if (!summary) throw new Error('Say what changed, in a line or two, before confirming.');
  const source = state.sources.find((held) => held.id === change.sourceId);
  const plan: Array<{ project: DdProject; actions: LawProposedAction[] }> = [];
  for (const row of given.projects) {
    const project = projects.find((held) => held.id === row.projectId);
    if (!project) throw new Error('No project by that id.');
    if (plan.some((held) => held.project.id === project.id)) throw new Error('A project is named twice.');
    const actions = row.actions.map((action) => ({ department: action.department, title: clean(action.title, LAW_ACTION_TITLE) })).filter((action) => action.title);
    if (actions.length > LAW_ACTIONS_A_PROJECT) throw new Error(`At most ${LAW_ACTIONS_A_PROJECT} actions a project.`);
    for (const action of actions) {
      if (!projectDepartments(project).includes(action.department) || (source && !source.departments.includes(action.department))) throw new Error(`${DEPARTMENT_SHORT[action.department] ?? 'That department'} is not one this source bears on for ${project.name}.`);
      if (!mayApplyLaw(person, project, action.department)) throw new Error(`Putting an action on ${project.name} for ${DEPARTMENT_SHORT[action.department]} needs a firm admin or that department’s lead.`);
    }
    if (actions.length) plan.push({ project, actions });
  }
  const who = person.name?.trim() ? `${person.name.trim()} (${person.email})` : person.email;
  const made: ActionRecord[] = [];
  const applied: LawApplied[] = [];
  for (const { project, actions } of plan) {
    const ids: string[] = [];
    for (const action of actions) {
      const record = addAction(project, { title: action.title, kind: 'clarification', owner: `${DEPARTMENT_SHORT[action.department]} lead`, priority: 'medium', description: lawActionSource(change, summary, who, now) }, person.email);
      ids.push(record.id);
      made.push(record);
    }
    project.updatedAt = now;
    applied.push({ projectId: project.id, projectName: project.name, actionIds: ids });
  }
  Object.assign(change, { state: 'confirmed', decidedBy: person.email, ...(person.name?.trim() ? { decidedByName: person.name.trim() } : {}), decidedAt: now, summary, applied });
  return { change, touched: plan.map((row) => row.project), made };
}

/** Dismiss a change as not relevant, by name. Nothing reaches a project. */
export function dismissLawChange(state: LawWatchState, changeId: string, person: LawReviewer, why: string | undefined, now: string): LawChange {
  const change = state.changes.find((held) => held.id === changeId);
  if (!change) throw new Error('No change by that id.');
  if (change.state !== 'waiting') throw new Error(`This change was ${change.state} already.`);
  Object.assign(change, { state: 'dismissed', decidedBy: person.email, ...(person.name?.trim() ? { decidedByName: person.name.trim() } : {}), decidedAt: now, ...(why && clean(why, 240) ? { why: clean(why, 240) } : {}) });
  return change;
}

/** Keep a new change, and let the oldest decided ones go where the list is full. */
export function keepLawChange(state: LawWatchState, change: LawChange): void {
  state.changes.unshift(change);
  while (state.changes.length > LAW_CHANGES_KEPT) {
    const last = state.changes.map((held) => held.state !== 'waiting').lastIndexOf(true);
    if (last === -1) break;
    state.changes.splice(last, 1);
  }
}

/** The changes as a reader is shown them: those waiting first, then the latest decided. */
export function lawChangesShown(state: LawWatchState, decided = 20): { waiting: LawChange[]; decided: LawChange[] } {
  return { waiting: state.changes.filter((change) => change.state === 'waiting'), decided: state.changes.filter((change) => change.state !== 'waiting').slice(0, decided) };
}
