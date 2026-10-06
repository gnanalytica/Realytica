/**
 * Where the chat is, where it can take a person, and what it offers there.
 *
 * The menu is departments, functions and stages (`departments.ts`), looked at
 * one stage at a time (`stage-view.ts`). This is the same map as the chat
 * reads it, in four parts:
 *
 * - **A place.** The page a person is on and the stage it is looked at in.
 *   Every question arrives with one, and every reply that moves the page
 *   names one.
 * - **A sentence read as a place.** "Open Title", "show Legal at Land", "back
 *   to the live stage". Only a sentence that names a place and nothing else
 *   is read this way: "open the title deed" names a record, and is left to
 *   the reader of records. Two pages with one name are offered as a choice,
 *   and a page with no work at the stage asked for says so. Nothing is
 *   guessed.
 * - **A record's place.** Which function holds a document, a check, an
 *   approval or a milestone, and which part of that function's page it sits
 *   in, so a link in an answer opens the page the record is on. A record no
 *   function holds opens in the register the whole project shares.
 * - **What to ask.** A few questions for each page, each one the file answers
 *   by itself.
 *
 * Looking is free: nothing here changes the record. The stage a project is at
 * moves only by a person's own instruction, through the proposal it has always
 * gone through.
 */

import type { ProjectCockpitPane } from './cockpit';
import {
  DEPARTMENT_SHORT,
  MENU_DEPARTMENTS,
  STAGES,
  departmentDefinition,
  departmentHomeWorkstream,
  functionDepartment,
  functionKey,
  functionShows,
  menuDepartment,
  menuDepartmentsOf,
  menuFunctions,
  stageDefinition,
  stageOf,
  stageOfWord,
  withDepartment,
  workstreamDefinition,
  workstreamOfCheck,
  type DepartmentKey,
  type MenuFunction,
  type StageKey,
} from './departments';
import { APPROVAL_KINDS, approvalsRegister } from './approvals';
import { allChecks, workstreamChecks } from './engagements';
import { CHECK_DEFINITIONS } from './libraries';
import { fileIsBare, projectNextStep } from './next-step';
import { projectFrameLabels } from './project-graph';
import { questionnaireDepartment } from './questionnaire';
import { QUICK_VERDICT_LABEL, quickAssessment } from './quick-assessments';
import { fieldOnSitting, graphNodeLabels, sittingFromCitedId, type CockpitPathExtra } from './sitting';
import { menuAt, placeAtStage, stageInView } from './stage-view';
import { projectDepartments } from './team';
import { plural } from './text';
import type { ChatChoice, ChatTurnPlace, DdProject, EvidenceRecord, FindingRecord } from './types';
import { documentWorkstream, workstreamDocuments } from './vault';
import { plainWords, stageNamed } from './wizard';

/* ==================================================================== */
/* A place                                                               */
/* ==================================================================== */

/**
 * A page of a project and the stage it is looked at in.
 *
 * A department's own pages carry the menu department, a function's page its
 * function too. Overview and the places the whole project shares carry
 * neither and are told apart by the pane.
 */
export interface ChatPlace {
  pane?: ProjectCockpitPane;
  department?: DepartmentKey;
  fn?: string;
  stage?: StageKey;
}

/** Every function of the menu, in menu order. */
function everyFunction(): Array<MenuFunction & { menu: DepartmentKey }> {
  return MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu).map((fn) => ({ ...fn, menu })));
}

function functionOf(key: string | undefined): (MenuFunction & { menu: DepartmentKey }) | undefined {
  return key ? everyFunction().find((fn) => fn.key === functionKey(key)) : undefined;
}

/**
 * The department and function of a place as it was sent or stored, with any
 * word the menu does not know left out. A turn kept from before a function
 * was renamed then reads as its department, or as no place, and never as a
 * page that does not exist.
 */
export function menuPlaceOfWords(raw: ChatTurnPlace | undefined): Pick<ChatPlace, 'department' | 'fn' | 'stage'> {
  if (!raw) return {};
  const fn = functionOf(raw.fn);
  const department = fn?.menu ?? MENU_DEPARTMENTS.find((key) => key === raw.department);
  const stage = STAGES.find((s) => s.key === raw.stage)?.key;
  return { ...(department ? { department } : {}), ...(fn ? { fn: fn.key } : {}), ...(stage ? { stage } : {}) };
}

/** The pane a function's page is. Valuation and the site record are panes of their own, and Design's page is its department's. */
export function paneOfFunction(key: string): ProjectCockpitPane {
  if (key === 'finance.valuation') return 'valuation';
  if (key === 'construction.site') return 'visits';
  return key === 'design' ? 'department' : 'workstream';
}

/** What the address carries to reach a function's page. */
function extraOfFunction(key: string): CockpitPathExtra {
  return key === 'design' ? { department: 'design' } : { workstream: key };
}

/** The shared places by the word on their tab. Kept beside the menu's own words in `rail.tsx`; a test holds the two together. */
const PANE_WORD: Partial<Record<ProjectCockpitPane, string>> = {
  overview: 'Overview',
  evidence: 'Documents',
  dd: 'Checks',
  scope: 'Checks',
  findings: 'Findings',
  risks: 'Risks and actions',
  actions: 'Risks and actions',
  decisions: 'Decisions',
  assets: 'Phases and assets',
  reports: 'Reports',
  review: 'Review',
  outgoing: 'Outgoing',
  drafts: 'AI drafts',
  orchestrate: 'Auto-run',
  people: 'People',
  graph: 'Graph',
};

/** The shared places and the words on their tabs, for whatever has to hold the two lists together. */
export const SHARED_PLACE_WORDS: ReadonlyArray<[ProjectCockpitPane, string]> = Object.entries(PANE_WORD) as Array<[ProjectCockpitPane, string]>;

/**
 * A place in a word or two, as the menu writes it: "Title", "Legal",
 * "Documents". A function whose word another function shares carries its
 * department, because Legal and Commercial each have a Handover.
 */
export function chatPlaceLabel(place: ChatPlace | ChatTurnPlace | undefined): string {
  const at = menuPlaceOfWords(place);
  const fn = functionOf(at.fn);
  if (fn) return everyFunction().filter((other) => other.label === fn.label).length > 1 ? withDepartment(fn.key, fn.label) : fn.label;
  if (at.department) return DEPARTMENT_SHORT[at.department];
  // Valuation and the site record are panes of their own, and each is a function's page.
  if (place?.pane === 'valuation') return 'Valuation';
  if (place?.pane === 'visits') return 'Site';
  return PANE_WORD[place?.pane as ProjectCockpitPane] ?? 'Overview';
}

/** Whether two places are the same page. The stage is not part of it: a page is the same page at every stage it shows at. */
export function samePage(a: ChatPlace | ChatTurnPlace | undefined, b: ChatPlace | ChatTurnPlace | undefined): boolean {
  const x = menuPlaceOfWords(a);
  const y = menuPlaceOfWords(b);
  if (x.department || y.department) return x.department === y.department && x.fn === y.fn;
  return chatPlaceLabel(a) === chatPlaceLabel(b);
}

/** A place with the stage it was looked at in, for a list: "Title · Land". The stage is left out where none was kept. */
export function chatPlaceWords(place: ChatPlace | ChatTurnPlace | undefined): string {
  const stage = STAGES.find((s) => s.key === place?.stage);
  return stage ? `${chatPlaceLabel(place)} · ${stage.label}` : chatPlaceLabel(place);
}

/**
 * What to write beside a question asked on another page than the one on
 * screen, or nothing when it was asked here.
 *
 * The thread stays as a person moves through the project, so an answer about
 * Title is still in view on Approvals. The page is what is said. The stage is
 * added only when it is another one too: a page is the same page at every
 * stage, and saying the stage each time would mark every turn of a person who
 * only pressed the track.
 */
export function askedOn(asked: ChatPlace | ChatTurnPlace | undefined, here: ChatPlace | ChatTurnPlace | undefined): string | undefined {
  if (!asked || !here || samePage(asked, here)) return undefined;
  return `Asked on ${asked.stage && asked.stage !== here.stage ? chatPlaceWords(asked) : chatPlaceLabel(asked)}`;
}

/**
 * Where a person is, in a line for a model: the page, the stage it is looked
 * at in and, where that is another one, the stage the project is at.
 */
export function chatPlaceLine(project: DdProject, place: ChatPlace | undefined): string | undefined {
  if (!place) return undefined;
  const own = stageOf(project.currentStage);
  const page = place.fn ? withDepartment(place.fn, functionOf(place.fn)?.label ?? place.fn) : chatPlaceLabel(place);
  const kind = place.fn ? 'function' : place.department ? 'department summary' : 'page';
  const looking = place.stage && place.stage !== own ? `, looked at in the ${stageDefinition(place.stage).label} stage (the project is at ${stageDefinition(own).label})` : '';
  return `${page} (${kind})${looking}`;
}

/* ==================================================================== */
/* The parts of a function's page                                        */
/* ==================================================================== */

/** The work that is a function's own, where its page has a part for it. */
const CENTRE_SECTION: Record<string, string> = {
  'legal.title': 'chain',
  'legal.approvals': 'approvals',
  'construction.progress': 'progress',
};

/**
 * The parts of a function's page, by the ids the page gives them, or none
 * where the page is not laid out in parts.
 *
 * A built function is one page with a rail: how it stands, the work that is
 * its own, its checks, its documents, its connections. Valuation and the site
 * record keep pages of their own, the technical due diligence is five steps,
 * and a function that is not built yet is one card. None of those has parts
 * to land on.
 */
export function functionSections(key: string): string[] {
  if (workstreamDefinition(key)?.status !== 'live') return [];
  if (paneOfFunction(key) !== 'workstream' || key === 'construction.quality') return [];
  const centre = CENTRE_SECTION[key];
  return ['standing', ...(centre ? [centre] : []), 'checks', 'documents', 'connections'];
}

/* ==================================================================== */
/* A sentence read as a place                                            */
/* ==================================================================== */

/** What a place sentence opens: the pane, and what the address carries. */
export interface PlaceOpen {
  pane: ProjectCockpitPane;
  extra: CockpitPathExtra;
}

export type PlaceReading =
  /** One place. `stageOnly` when the sentence named a stage and no page. */
  | { kind: 'go'; place: ChatPlace; open: PlaceOpen; stageOnly?: boolean; section?: string }
  /** More than one reading, put to the person. Nothing moves. */
  | { kind: 'ask'; text: string; choices: ChatChoice[]; summary: string }
  /** A place that cannot be opened, said in a line. Nothing moves. */
  | { kind: 'refuse'; text: string; summary: string };

/** A name as the chat compares it: lower case, punctuation gone, and without "and" or "the", so "Title & land records" is the same however it is typed. */
export function nameWords(text: string): string {
  return plainWords(text)
    .trim()
    .split(' ')
    .filter((w) => w && w !== 'and' && w !== 'the')
    .join(' ');
}

/**
 * A record's title as it is compared: lower case, with the letters, marks and
 * digits of every script kept, and without "and" or "the". The menu's own
 * names are English and compared as `nameWords` does. A title is whatever its
 * paper is called: one in Kannada, Telugu or Hindi is its own words, and
 * folded to Latin letters alone it was no words at all.
 */
export function titleWords(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && w !== 'and' && w !== 'the')
    .join(' ');
}

interface Target {
  pane?: ProjectCockpitPane;
  department?: DepartmentKey;
  fn?: string;
  section?: string;
  /** "Summary": the Summary of the department the person is in. */
  summary?: true;
}

/** The shared places, by the words on their tabs and the words people already use for them. */
const SHARED_NAMES: Array<[ProjectCockpitPane, string[]]> = [
  ['overview', ['overview', 'project overview', 'home', 'map', 'maps']],
  ['evidence', ['documents', 'document vault', 'vault', 'evidence', 'files', 'docs']],
  ['dd', ['registers', 'checks', 'dd', 'dds', 'due diligence', 'assessments']],
  ['findings', ['findings']],
  ['risks', ['risks', 'risks and actions']],
  ['actions', ['actions']],
  ['decisions', ['decisions']],
  ['assets', ['assets', 'phases', 'phases and assets', 'towers']],
  ['reports', ['reports', 'report']],
  ['review', ['review table', 'review tables']],
  ['outgoing', ['outgoing', 'letters', 'letters and minutes']],
  ['drafts', ['drafts', 'ai drafts']],
  ['orchestrate', ['auto run', 'orchestrator']],
  ['people', ['people', 'team']],
  ['graph', ['graph', 'knowledge graph']],
];

/** Other words a function goes by: the pane it used to be, or the name its record keeps. */
const FUNCTION_ALSO: Record<string, string[]> = {
  'finance.valuation': ['value', 'valuations'],
  'legal.title': ['land records'],
  'legal.approvals': ['nocs'],
  'construction.quality': ['technical dd', 'tdd'],
  'construction.site': ['visits', 'site visits'],
};

/** The parts every function's page has, by the words people call them. */
const SECTION_NAMES: Array<[string, string[]]> = [
  ['checks', ['checks']],
  ['documents', ['documents', 'docs', 'papers']],
  ['connections', ['connections', 'links']],
  ['standing', ['estimate', 'certified report', 'certified reports', 'estimate and certified']],
];

/** The part that is one function's own. The first words are said after the function's name, the second by themselves. */
const CENTRE_NAMES: Record<string, { after: string[]; alone: string[] }> = {
  chain: { after: ['chain'], alone: ['chain of title', 'title chain'] },
  approvals: { after: ['register'], alone: ['approvals register'] },
  progress: { after: ['milestones', 'board', 'site log'], alone: ['milestones', 'site log', 'progress board'] },
};

let VOCABULARY: Map<string, Target[]> | undefined;

/**
 * Every phrase that names a place, with the places it names.
 *
 * Built from the menu's own lists, so a function renamed there is renamed
 * here. A function is known by its one word and by its name in full, with or
 * without its department in front, and with one of its page's parts after.
 */
function vocabulary(): Map<string, Target[]> {
  if (VOCABULARY) return VOCABULARY;
  const names = new Map<string, Target[]>();
  const add = (phrase: string, target: Target) => {
    const key = nameWords(phrase);
    if (!key) return;
    const held = names.get(key) ?? [];
    if (!held.some((t) => t.pane === target.pane && t.department === target.department && t.fn === target.fn && t.section === target.section)) held.push(target);
    names.set(key, held);
  };
  for (const [pane, words] of SHARED_NAMES) for (const word of words) add(word, { pane });
  add('summary', { summary: true });
  for (const menu of MENU_DEPARTMENTS) {
    const short = DEPARTMENT_SHORT[menu];
    const said = [short, departmentDefinition(menu).label];
    for (const name of said) add(name, { department: menu });
    add(`${short} summary`, { department: menu });
    for (const fn of menuFunctions(menu)) {
      const stands = fn.workstreams.length > 1 ? fn.workstreams.map((key) => workstreamDefinition(key)?.label ?? '') : [];
      const called = [fn.label, fn.name, ...stands, ...(FUNCTION_ALSO[fn.key] ?? [])].filter(Boolean);
      const sections = functionSections(fn.key);
      const parts: Array<[string, string]> = [];
      for (const [section, words] of SECTION_NAMES) if (sections.includes(section)) for (const word of words) parts.push([section, word]);
      const centre = CENTRE_SECTION[fn.key];
      if (centre && sections.includes(centre)) {
        for (const word of CENTRE_NAMES[centre]!.after) parts.push([centre, word]);
        for (const word of CENTRE_NAMES[centre]!.alone) add(word, { department: menu, fn: fn.key, section: centre });
      }
      for (const name of called) {
        for (const lead of ['', ...said]) {
          add(`${lead} ${name}`, { department: menu, fn: fn.key });
          for (const [section, word] of parts) add(`${lead} ${name} ${word}`, { department: menu, fn: fn.key, section });
        }
      }
    }
  }
  VOCABULARY = names;
  return names;
}

/** Words that say what kind of thing is meant and name none: "the Title page", "the Legal department". */
const FILLER = new Set(['page', 'pages', 'tab', 'pane', 'screen', 'function', 'department', 'register', 'list', 'section', 'part', 'please', 'again', 'now']);

/** The places a phrase names, as typed and then with the words that name nothing taken out. */
function targetsOf(phrase: string): Target[] {
  const words = nameWords(phrase);
  const exact = vocabulary().get(words);
  if (exact) return exact;
  const bare = words
    .split(' ')
    .filter((w) => !FILLER.has(w))
    .join(' ');
  return (bare !== words && vocabulary().get(bare)) || [];
}

/**
 * The functions a few words name: by their one word, their name in full, or
 * either with the department in front. Each once, switched on or not, so the
 * reader can say which of the two it is when one is off.
 */
export function functionsNamed(words: string): Array<MenuFunction & { menu: DepartmentKey }> {
  const targets = targetsOf(words);
  // "Commercial & Operations" is a department. With a path sign between the words it is one of its functions.
  if (targets.some((t) => t.department && !t.fn) && !/[›>/]/.test(words)) return [];
  return [...new Set(targets.flatMap((t) => (t.fn ? [t.fn] : [])))].map((key) => functionOf(key)!);
}

/** A sentence that asks to be shown somewhere: the verb, then what is to be shown. */
const SHOW =
  /^(?:(?:please|now|ok|okay|then|and|can you|could you|would you|can i|could i|may i) )*(open(?: up)?|show(?: me)?|go(?: back)? to|switch(?: back)? to|take me(?: back)? to|bring up|pull up|jump to|back to|return to|see|view|look at|(?:have|take) a look at|let me (?:see|view|look at|have a look at)|let s (?:see|view|look at)|i (?:want|need|wish|would like|d like) to (?:see|view|look at|open)) (.+)$/;

/**
 * What a sentence asks to be shown, when it opens with a verb of showing: the
 * words after the verb, and whether the verb was one of going back.
 *
 * The one reading of "is this somebody asking to look" for the reader of
 * places here and the reader of instructions in `wizard.ts`. What one takes
 * as looking the other must never take as an instruction to move the project.
 */
export function shownWords(text: string): { rest: string; back: boolean } | undefined {
  const said = SHOW.exec(plainWords(text).trim());
  const rest = said?.[2]?.trim();
  return rest ? { rest, back: /(?:^| )back to$|^return to$/.test(said![1]!) } : undefined;
}

/** The stage the project is at, however it is said. */
const LIVE_STAGE = /^(?:the )?(?:live|current|present|project s|projects|project) stage$|^(?:the )?stage (?:we are|we re|it is|it s|the project is|the project stands) (?:at|in|on)$/;

/** "Where we are" is the stage the project is at only as somewhere to go back to. "Show me where the project is" asks for the map. */
const WHERE_IT_IS = /^where (?:we are|the project is|the project stands)$/;

/** A name in quotes, as a person writes a record's title. */
const QUOTED = /["“]([^"”]+)["”]/;

/** Whether a record on the project carries a name as its title. */
function recordTitled(project: DdProject, name: string): boolean {
  const words = titleWords(name);
  if (!words) return false;
  const is = (title: string | undefined) => Boolean(title) && titleWords(title!) === words;
  return (
    project.evidence.some((e) => is(e.title))
    || allChecks(project).some((c) => is(c.title))
    || project.findings.some((f) => is(f.title))
    || project.risks.some((r) => is(r.title))
    || project.actions.some((a) => is(a.title))
    || project.decisions.some((d) => is(d.title))
    || project.reports.some((r) => is(r.title))
    || project.assets.some((a) => is(a.name))
    || project.assessments.some((a) => is(a.name))
  );
}

/**
 * The stage a few words name, when they name a stage and nothing else.
 *
 * "Land" and "Completed" are ordinary words, and the stage reader takes them
 * for a stage only after "to", "at" or "in". Here the words are already known
 * to be all that was asked for, which is the same thing said another way.
 */
function stageOfWords(project: DdProject, phrase: string): StageKey | undefined {
  const words = phrase.replace(/^the /, '').trim();
  if (LIVE_STAGE.test(phrase.trim()) || LIVE_STAGE.test(words)) return stageOf(project.currentStage);
  const bare = words.replace(/ (?:stage|step)$/, '');
  const hit = stageNamed(`to ${bare}`);
  return hit && hit.words === bare ? stageOf(hit.step) : undefined;
}

/** The words that join a page to the stage it is asked for at. */
const AT_STAGE = [' at ', ' in ', ' during ', ' for '];

/** The words that join a part of a page to the function whose page it is: "the documents for Title". */
const OF_PAGE = [' for ', ' of ', ' in ', ' on ', ' at ', ' during '];

/**
 * The pages a phrase names, with the part of a function's page said either
 * way round: "Title documents" and "the documents for Title".
 */
function pagesOf(phrase: string): Target[] {
  const direct = targetsOf(phrase);
  if (direct.length) return direct;
  for (const join of OF_PAGE) {
    const at = phrase.lastIndexOf(join);
    if (at <= 0) continue;
    const part = targetsOf(`${phrase.slice(at + join.length)} ${phrase.slice(0, at)}`).filter((t) => t.fn && t.section);
    if (part.length) return part;
  }
  return [];
}

/** "The project", "this page", "it": the page a person is already on, asked for at another stage. */
const THIS_PAGE = /^(?:this |the )?(?:project|file|page|it|this|everything)$/;

function enabledOf(project: DdProject, fn: MenuFunction): boolean {
  return projectDepartments(project).includes(fn.department);
}

/** The stages a function shows at on this project, in order. */
function stagesOfFunction(project: DdProject, fn: MenuFunction): StageKey[] {
  return STAGES.map((s) => s.key).filter((stage) => functionShows(fn, menuAt(project, stage)));
}

/** A department's functions that show at a stage and are switched on. */
function shownIn(project: DdProject, menu: DepartmentKey, stage: StageKey): MenuFunction[] {
  const enabled = projectDepartments(project);
  return menuFunctions(menu, menuAt(project, stage)).filter((fn) => enabled.includes(fn.department));
}

function stagesOfDepartment(project: DdProject, menu: DepartmentKey): StageKey[] {
  return STAGES.map((s) => s.key).filter((stage) => shownIn(project, menu, stage).length > 0);
}

/** The stage a department's Summary opens at: the one asked for when it has work there, otherwise the project's own, otherwise the first it has work in. */
function stageOfDepartment(project: DdProject, menu: DepartmentKey, asked: StageKey): StageKey {
  const has = stagesOfDepartment(project, menu);
  return [asked, stageOf(project.currentStage), ...has].find((stage) => has.includes(stage)) ?? asked;
}

function andList(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The choices for a page asked for at a stage it has no work in: the stages it has. */
function elsewhere(name: string, send: string, asked: StageKey, has: StageKey[]): PlaceReading {
  const at = stageDefinition(asked).label;
  if (!has.length) return { kind: 'refuse', text: `${name} has no work at any stage of this project.`, summary: 'No work at that stage' };
  return {
    kind: 'ask',
    text: `${name} has no work at ${at}. It has work at ${andList(has.map((stage) => stageDefinition(stage).label))}.`,
    choices: has.map((stage, i) => ({ id: `stage_${i}`, label: `${name} at ${stageDefinition(stage).label}`, send: `Open ${send} at ${stageDefinition(stage).label}`, kind: 'page' })),
    summary: 'No work at that stage',
  };
}

/**
 * A page somebody asked for by what it is, already told apart from its
 * namesakes: where it opens, or why it does not.
 *
 * `asked` is a stage the person named. With none, a function opens at the
 * stage being looked at when it shows there, otherwise at the project's own,
 * otherwise at the first it has work in: the rule every link to a function
 * follows.
 */
export function openPlace(project: DdProject, want: { pane?: ProjectCockpitPane; department?: DepartmentKey; fn?: string; section?: string }, asked: StageKey | undefined, here: ChatPlace = {}): PlaceReading {
  const looking = here.stage ?? stageOf(project.currentStage);
  const fn = functionOf(want.fn);
  if (fn) {
    const name = chatPlaceLabel({ fn: fn.key });
    if (!enabledOf(project, fn)) return { kind: 'refuse', text: `${name} is switched off on this project. Departments are set on Overview.`, summary: 'Switched off' };
    const has = stagesOfFunction(project, fn);
    if (asked && !has.includes(asked)) return elsewhere(name, withDepartment(fn.key, fn.label), asked, has);
    const stage = asked ?? stageInView(project, { carried: looking, fn: fn.key });
    const section = want.section && functionSections(fn.key).includes(want.section) ? want.section : undefined;
    return {
      kind: 'go',
      place: { pane: paneOfFunction(fn.key), department: fn.menu, fn: fn.key, stage },
      open: { pane: paneOfFunction(fn.key), extra: { ...extraOfFunction(fn.key), stage, ...(section ? { section } : {}) } },
      ...(section ? { section } : {}),
    };
  }
  if (want.department) {
    const menu = menuDepartment(want.department);
    const name = DEPARTMENT_SHORT[menu];
    if (!menuDepartmentsOf(projectDepartments(project)).includes(menu)) return { kind: 'refuse', text: `${name} is switched off on this project. Departments are set on Overview.`, summary: 'Switched off' };
    const has = stagesOfDepartment(project, menu);
    if (asked && !has.includes(asked)) return elsewhere(name, name, asked, has);
    const stage = asked ?? stageOfDepartment(project, menu, looking);
    return { kind: 'go', place: { pane: 'department', department: menu, stage }, open: { pane: 'department', extra: { department: menu, stage } } };
  }
  const pane = want.pane ?? 'overview';
  // Overview and the shared places belong to no stage: one is carried only when it was asked for.
  return { kind: 'go', place: { pane, ...(asked ? { stage: asked } : {}) }, open: { pane, extra: asked ? { stage: asked } : {} } };
}

/**
 * The project looked at in another stage, from the page a person is on.
 *
 * The page stays where it shows at the stage and gives way where it does not:
 * a function to its department's Summary, a department with nothing there to
 * Overview. That is the rule the stage track follows, so a stage asked for in
 * words lands where pressing it would. Overview and the shared places belong
 * to no stage and stay where they are.
 */
function lookAtStage(project: DdProject, stage: StageKey, here: ChatPlace): PlaceReading {
  const to = placeAtStage(project, { department: here.department, fn: here.fn }, stage);
  if (to.fn || to.department) {
    const reading = openPlace(project, to.fn ? { fn: to.fn } : { department: to.department }, stage, here);
    return reading.kind === 'go' ? { ...reading, stageOnly: true } : reading;
  }
  const pane = here.department ? 'overview' : (here.pane ?? 'overview');
  return { kind: 'go', place: { pane, stage }, open: { pane, extra: { stage } }, stageOnly: true };
}

/**
 * A place by the words a tool names it with, for a model that wants a page
 * opened: a pane, a department, a function, a stage, and a part of the
 * function's page. Each is read as loosely as a person would write it (a key,
 * the menu's word, the name in full) and checked against the menu, so the
 * answer is a page that exists, a choice, or a line saying why not.
 */
export function placeOfWords(
  project: DdProject,
  want: { pane?: ProjectCockpitPane; department?: string; fn?: string; stage?: string; section?: string },
  here: ChatPlace = {},
): PlaceReading {
  const stage = want.stage ? (STAGES.find((s) => s.key === want.stage)?.key ?? stageOfWord(want.stage) ?? stageOfWords(project, `${plainWords(want.stage).trim()} stage`)) : undefined;
  if (want.stage && !stage) return { kind: 'refuse', text: `No stage is called “${want.stage}”. The four are ${andList(STAGES.map((s) => s.label))}.`, summary: 'No stage by that name' };
  const department = want.department
    ? MENU_DEPARTMENTS.find((key) => key === menuDepartment(want.department as DepartmentKey) || [DEPARTMENT_SHORT[key], departmentDefinition(key).label].some((name) => nameWords(name) === nameWords(want.department!)))
    : undefined;
  if (want.department && !department && !want.fn) return { kind: 'refuse', text: `No department is called “${want.department}”.`, summary: 'No department by that name' };
  if (want.fn) {
    const byKey = functionOf(want.fn);
    const named = byKey ? [byKey] : targetsOf(want.fn).flatMap((t) => (t.fn ? [functionOf(t.fn)!] : []));
    const enabled = named.filter((fn) => enabledOf(project, fn));
    const within = (department ? enabled.filter((fn) => fn.menu === department) : enabled).filter((fn, i, all) => all.findIndex((other) => other.key === fn.key) === i);
    if (!named.length) return { kind: 'refuse', text: `No function is called “${want.fn}”.`, summary: 'No function by that name' };
    if (within.length > 1) {
      return {
        kind: 'ask',
        text: `${within.length === 2 ? 'Two' : within.length} pages are called ${within[0]!.label}. Which one?`,
        choices: within.map((fn, i) => ({ id: `page_${i}`, label: withDepartment(fn.key, fn.label), detail: fn.name, send: `Open ${withDepartment(fn.key, fn.label)}`, kind: 'page' })),
        summary: 'Two pages share that name',
      };
    }
    return openPlace(project, { fn: (within[0] ?? named[0])!.key, section: want.section }, stage, here);
  }
  if (department) return openPlace(project, { department }, stage, here);
  if (want.pane) return openPlace(project, { pane: want.pane }, stage, here);
  if (stage) return lookAtStage(project, stage, here);
  return { kind: 'refuse', text: 'Name a page, a department, a function or a stage.', summary: 'No place named' };
}

/**
 * The place a sentence asks to be shown, or null when it asks for none.
 *
 * Read only from a sentence that opens with a verb of showing and then names
 * a place and nothing else: a page, a page and a stage, or a stage. Anything
 * with a word left over is somebody naming a record ("open the title deed")
 * or asking a question, and is not this reader's to answer.
 *
 * `here` is where the person is. A stage named alone keeps the page they are
 * on where it shows at that stage, by the rule the stage track follows.
 */
export function placeFromText(project: DdProject, text: string, here: ChatPlace = {}): PlaceReading | null {
  const said = shownWords(text);
  if (!said) return null;
  // A name in quotes is a record's first: "Open “NOCs”" is the row of that title, and the page only when no record has it.
  const quoted = QUOTED.exec(text)?.[1];
  if (quoted && recordTitled(project, quoted)) return null;
  // "The Land stage of the project, please" is the Land stage.
  const rest = said.rest.replace(/(?: (?:please|now|again|thanks|thank you))+$/, '').replace(/ (?:of|for|on) (?:the|this) (?:project|file)$/, '');

  let asked = LIVE_STAGE.test(rest) || (said.back && WHERE_IT_IS.test(rest)) ? stageOf(project.currentStage) : undefined;
  let targets: Target[] = [];
  if (!asked) {
    // A page and the stage it is asked for at. The last joining word is tried first, so a stage is read from the end.
    for (const join of AT_STAGE) {
      const at = rest.lastIndexOf(join);
      if (at <= 0) continue;
      const tail = rest.slice(at + join.length);
      const page = rest.slice(0, at);
      /*
       * Approvals, Design, Procurement and Handover are pages, and steps only
       * on the record. "The checks for Approvals" asks for Approvals, and read
       * as a stage it changed the stage in view behind a register nobody asked
       * to see at another stage. So after a register or a part of a page,
       * words that name a page are that page, and a stage only when they say
       * so ("the checks at the Approvals stage"). After a function or a
       * department they are still the stage: "Title at Handover".
       */
      if (targetsOf(tail).length && !/\b(?:stage|step)\b/.test(tail)) {
        const head = targetsOf(page);
        if (head.length && head.every((t) => t.pane && !t.fn && !t.department)) continue;
      }
      const stage = stageOfWords(project, tail);
      // The page may itself be a part said part first: "the documents for Title at Land".
      const named = stage ? pagesOf(page) : [];
      // "Show the project at Land" names the stage and no page: it is looked at where the person is.
      if (stage && (named.length || THIS_PAGE.test(page))) {
        asked = stage;
        targets = named;
        break;
      }
    }
    // A page by itself comes before a stage by itself: Approvals, Design and Handover are functions, and steps only on the record.
    // A part of a function's page may be said part first: "the checks for Approvals" is Approvals at its checks.
    if (!asked && !targets.length) targets = pagesOf(rest);
    if (!asked && !targets.length) asked = stageOfWords(project, rest);
    if (!targets.length && !asked) return null;
  }

  if (!targets.length) return lookAtStage(project, asked!, here);

  const named = targets.map((t) => (t.summary ? (here.department ? { department: here.department } : { pane: 'overview' as const }) : t));
  // "Commercial & Operations" is a department and "Commercial › Operations" one of its functions, and with the sign
  // between them gone the two are the same words. The sign says which was meant: a path names the function.
  const path = /[›>/]/.test(text);
  const both = named.some((t) => t.department && !t.fn) && named.some((t) => t.fn);
  const resolved = both ? named.filter((t) => (path ? Boolean(t.fn) : !t.fn)) : named;
  const enabled = projectDepartments(project);
  // Two functions can share a word. Only the ones this project has switched on are a choice.
  const fns = resolved.filter((t) => t.fn);
  const live = fns.filter((t) => enabled.includes(functionOf(t.fn)!.department));
  const pool = fns.length > 1 ? (live.length ? live : fns) : resolved;
  if (pool.length > 1 && pool.every((t) => t.fn)) {
    const at = asked ? ` at ${stageDefinition(asked).label}` : '';
    const word = functionOf(pool[0]!.fn)?.label ?? rest;
    if (!live.length) return { kind: 'refuse', text: `${word} is switched off on this project. Departments are set on Overview.`, summary: 'Switched off' };
    return {
      kind: 'ask',
      text: `${pool.length === 2 ? 'Two' : pool.length} pages are called ${word}. Which one?`,
      choices: pool.map((t, i) => {
        const fn = functionOf(t.fn)!;
        const label = withDepartment(fn.key, fn.label);
        return { id: `page_${i}`, label, detail: fn.name, send: `Open ${label}${t.section ? ` ${t.section}` : ''}${at}`, kind: 'page' };
      }),
      summary: 'Two pages share that name',
    };
  }
  return openPlace(project, pool[0]!, asked, here);
}

/** The figure that matters on a function's page, as the end of a sentence. */
function functionFigure(project: DdProject, fn: MenuFunction): string {
  if (fn.key === 'construction.site') return `${plural((project.siteVisits ?? []).length, 'visit')} on record`;
  const built = fn.workstreams.filter((key) => workstreamDefinition(key)?.status === 'live');
  if (!built.length) {
    const checks = fn.workstreams.reduce((n, key) => n + workstreamChecks(project, key).length, 0);
    const papers = fn.workstreams.reduce((n, key) => n + workstreamDocuments(project, key).filter((e) => e.attachments.length).length, 0);
    return `not built yet, with ${plural(checks, 'check')} and ${plural(papers, 'document')} waiting for it`;
  }
  const qa = quickAssessment(project, built[0]!);
  if (qa.verdict === 'insufficient') return qa.gaps.length ? `it still needs ${andList(qa.gaps.slice(0, 2))}` : QUICK_VERDICT_LABEL.insufficient.toLowerCase();
  // A headline opens on a capital as a card's title does. Mid-sentence it does not, unless it opens on a figure.
  return /^[A-Z][a-z]/.test(qa.headline) ? qa.headline.charAt(0).toLowerCase() + qa.headline.slice(1) : qa.headline;
}

/** How a department stands at a stage, as the end of a sentence. */
function departmentFigure(project: DdProject, menu: DepartmentKey, stage: StageKey): string {
  const shown = shownIn(project, menu, stage);
  const built = shown.flatMap((fn) => fn.workstreams).filter((key) => workstreamDefinition(key)?.status === 'live');
  if (!built.length) return `${plural(shown.length, 'function')}, none built yet`;
  // Valuation is left out of the count: its estimate is a figure, and working it out costs more than a line is worth.
  const blocked = built.filter((key) => key !== 'finance.valuation' && quickAssessment(project, key).verdict === 'blockers').length;
  return `${plural(shown.length, 'function')}${blocked ? `, ${blocked} with blockers` : ''}`;
}

/**
 * What to say once a place has opened: where, at which stage when that is
 * worth saying, and the one figure that matters there. Null for Overview and
 * the shared places, whose line the engine already writes.
 *
 * `outside` is an outside collaborator asking. The figure is worked out from
 * the part of the file they were given, and a function's estimate is the
 * firm's own, so the line says where it went and stops.
 */
export function placeOpenedLine(project: DdProject, reading: Extract<PlaceReading, { kind: 'go' }>, here: ChatPlace = {}, outside = false): string | null {
  const { place } = reading;
  const own = stageOf(project.currentStage);
  const stage = place.stage ?? here.stage ?? own;
  const name = chatPlaceLabel(place);
  const fn = functionOf(place.fn);
  if (reading.stageOnly) {
    const on = fn || place.department ? `, on ${name}` : '';
    return stage === own ? `Back at ${stageDefinition(own).label}, the stage the project is at${on}.` : `Looking at ${stageDefinition(stage).label}${on}. The project is at ${stageDefinition(own).label}.`;
  }
  // The stage is said when it is not the one the person was already looking at: it changed under the page.
  const at = stage !== (here.stage ?? own) ? ` at ${stageDefinition(stage).label}` : '';
  if (fn) return outside ? `${name} is open${at}.` : `${name} is open${at} — ${functionFigure(project, fn)}.`;
  if (place.department) return outside ? `${name} is open${at}.` : `${name} is open${at} — ${departmentFigure(project, place.department, stage)}.`;
  return null;
}

/**
 * The stage a shared place was opened at, said when that is not the stage the
 * person was looking at. A register asked for "at Land" changes the stage in
 * view, and a reply that only counted the register left that unsaid. Empty
 * when the stage did not change.
 */
export function stageChangedLine(project: DdProject, stage: StageKey | undefined, here: ChatPlace = {}): string {
  const own = stageOf(project.currentStage);
  if (!stage || stage === (here.stage ?? own)) return '';
  return stage === own ? `Back at ${stageDefinition(own).label}, the stage the project is at.` : `Looking at ${stageDefinition(stage).label}. The project is at ${stageDefinition(own).label}.`;
}

/* ==================================================================== */
/* A record's place                                                      */
/* ==================================================================== */

export type PlacedKind =
  | 'document'
  | 'check'
  | 'scope'
  | 'assessment'
  | 'asset'
  | 'finding'
  | 'risk'
  | 'action'
  | 'decision'
  | 'report'
  | 'certified_report'
  | 'estimate'
  | 'approval'
  | 'milestone'
  | 'site_entry'
  | 'site_visit'
  | 'questionnaire'
  | 'stage'
  | 'department'
  | 'function';

/**
 * Where a record lives in the menu.
 *
 * `department` and `fn` name the function that holds it, when one does.
 * `section` is the part of that function's page it sits in, when the page has
 * such a part. `open` is what a link to it opens: the function's page at that
 * part, or the register the whole project shares when the function's page has
 * no place for it.
 */
export interface RecordPlace {
  kind: PlacedKind;
  label: string;
  department?: DepartmentKey;
  fn?: string;
  section?: string;
  stage?: StageKey;
  open: PlaceOpen;
}

/** The function most of a discipline's checks sit in: where a finding that names no check or document is counted. */
let DISCIPLINE_FUNCTION: Map<string, string> | undefined;
function functionOfDiscipline(discipline: string): string | undefined {
  if (!DISCIPLINE_FUNCTION) {
    const counts = new Map<string, Map<string, number>>();
    for (const def of CHECK_DEFINITIONS) {
      const scope = def.id.split('.')[0]!;
      const fn = functionKey(workstreamOfCheck(def.id));
      const row = counts.get(scope) ?? new Map<string, number>();
      row.set(fn, (row.get(fn) ?? 0) + 1);
      counts.set(scope, row);
    }
    DISCIPLINE_FUNCTION = new Map([...counts].map(([scope, row]) => [scope, [...row].sort((a, b) => b[1] - a[1])[0]![0]]));
  }
  return DISCIPLINE_FUNCTION.get(discipline);
}

/**
 * The function a finding belongs to: that of the check that raised it,
 * otherwise of a document it rests on, otherwise the one its discipline's
 * checks sit in. The register does not keep one, so this is a reading and is
 * used only to say what a page's findings are.
 */
export function functionOfFinding(project: DdProject, finding: FindingRecord): string | undefined {
  const check = finding.sourceCheckId ? allChecks(project).find((c) => c.id === finding.sourceCheckId) : undefined;
  if (check) return functionKey(workstreamOfCheck(check.definitionId));
  for (const id of finding.evidenceIds) {
    const row = project.evidence.find((e) => e.id === id);
    const ws = row ? documentWorkstream(project, row) : undefined;
    if (ws) return functionKey(ws);
  }
  return functionOfDiscipline(finding.discipline);
}

/** The function a document belongs to, when one does. */
export function functionOfDocument(project: DdProject, evidence: EvidenceRecord): string | undefined {
  const ws = documentWorkstream(project, evidence);
  return ws ? functionKey(ws) : undefined;
}

/** A record on a function's own page: at its part where the page has one, at the top where it has not. */
function onFunction(project: DdProject, kind: PlacedKind, label: string, fnKey: string, section: string | undefined, extra: CockpitPathExtra, here: ChatPlace): RecordPlace {
  const fn = functionOf(fnKey)!;
  const stage = stageInView(project, { carried: here.stage, fn: fn.key });
  const part = section && functionSections(fn.key).includes(section) ? section : undefined;
  return {
    kind,
    label,
    department: fn.menu,
    fn: fn.key,
    ...(part ? { section: part } : {}),
    stage,
    open: { pane: paneOfFunction(fn.key), extra: { ...extraOfFunction(fn.key), stage, ...(part ? { section: part, ...extra } : {}) } },
  };
}

/** Whether a function's page can be landed on: it is one of the menu's, and its department is switched on. */
function reachable(project: DdProject, fnKey: string | undefined): fnKey is string {
  const fn = functionOf(fnKey);
  return Boolean(fn && enabledOf(project, fn));
}

/**
 * Where a record lives, from its id, or undefined for an id the menu has no
 * place for (a parcel, a party, a deed in the chain of title: those are
 * looked at in the graph).
 *
 * A document that is on file, a check, an approval, a milestone, a site
 * entry, a certified report and an estimate open on the page of the function
 * that holds them, at the part of the page they sit in. A site visit opens on
 * the site record. A finding, a risk, an action, a decision and a report sit
 * in no function's page and open in their register, as does a document no
 * function holds, one still expected, and a document or a check whose
 * department is switched off. Anything else whose department is switched off
 * has no page, and is looked at in the graph.
 *
 * `here` gives the stage being looked at: a function's page opens at it when
 * the function shows there.
 */
export function placeOfRecord(project: DdProject, id: string, here: ChatPlace = {}): RecordPlace | undefined {
  if (!id) return undefined;
  const menuOf = (fn: string | undefined) => (reachable(project, fn) ? { department: functionOf(fn)!.menu, fn: functionOf(fn)!.key } : {});

  // The frame: a stage, a department or a function quoted by the id the graph gives it.
  const frame = /^(.+)::(stage|dept|ws)::([^:]+)$/.exec(id);
  if (frame && frame[1] === project.id) {
    const [, , kind, key] = frame;
    if (kind === 'stage') {
      const stage = STAGES.find((s) => s.key === key)?.key;
      if (!stage) return undefined;
      const to = placeAtStage(project, { department: here.department, fn: here.fn }, stage);
      const pane = to.fn ? paneOfFunction(to.fn) : to.department ? 'department' : here.department ? 'overview' : (here.pane ?? 'overview');
      const extra = to.fn ? extraOfFunction(to.fn) : to.department ? { department: to.department } : {};
      return { kind: 'stage', label: stageDefinition(stage).label, ...to, stage, open: { pane, extra: { ...extra, stage } } };
    }
    if (kind === 'ws' && !functionOf(key)) return undefined;
    const reading = kind === 'dept' ? openPlace(project, { department: key as DepartmentKey }, undefined, here) : openPlace(project, { fn: key }, undefined, here);
    if (reading.kind !== 'go') return undefined;
    const { department, fn, stage } = reading.place;
    return { kind: kind === 'dept' ? 'department' : 'function', label: chatPlaceLabel(reading.place), ...(department ? { department } : {}), ...(fn ? { fn } : {}), ...(stage ? { stage } : {}), open: reading.open };
  }

  const evidence = project.evidence.find((e) => e.id === id);
  if (evidence) {
    const fn = functionOfDocument(project, evidence);
    // The page lists the documents in hand. One still expected has no row there, so it opens where every document has one.
    if (reachable(project, fn) && evidence.attachments.length && functionSections(fn).includes('documents')) {
      return onFunction(project, 'document', evidence.title, fn, 'documents', { evidenceId: evidence.id }, here);
    }
    return { kind: 'document', label: evidence.title, ...menuOf(fn), open: { pane: 'evidence', extra: { evidenceId: evidence.id } } };
  }

  for (const assessment of project.assessments) {
    if (assessment.id === id || assessment.scopes.some((s) => s.id === id)) {
      // A due diligence or one of its scopes opens on the check to work next, as it always has.
      const scope = assessment.scopes.find((s) => s.id === id);
      const sitting = sittingFromCitedId(project, id);
      const field = sitting ? fieldOnSitting(project, sitting) : undefined;
      const extra = field ? { ddId: field.assessment.id, scopeId: field.scope.id, checkId: field.check.id } : scope ? { ddId: assessment.id, scopeId: scope.id } : { ddId: assessment.id };
      return { kind: scope ? 'scope' : 'assessment', label: sitting?.label ?? assessment.name, open: { pane: field || scope ? 'scope' : 'dd', extra } };
    }
    for (const scope of assessment.scopes) {
      const check = scope.checks.find((c) => c.id === id);
      if (!check) continue;
      const fn = functionKey(workstreamOfCheck(check.definitionId));
      const sitting = { ddId: assessment.id, scopeId: scope.id, checkId: check.id };
      if (reachable(project, fn) && assessment.status !== 'archived' && functionSections(fn).includes('checks')) {
        return onFunction(project, 'check', check.title, fn, 'checks', { item: check.id, ...sitting }, here);
      }
      return { kind: 'check', label: check.title, ...menuOf(fn), open: { pane: 'scope', extra: sitting } };
    }
  }

  const finding = project.findings.find((f) => f.id === id);
  if (finding) return { kind: 'finding', label: finding.title, ...menuOf(functionOfFinding(project, finding)), open: { pane: 'findings', extra: { findingId: finding.id } } };
  const risk = project.risks.find((r) => r.id === id);
  if (risk) return { kind: 'risk', label: risk.title, open: { pane: 'risks', extra: { riskId: risk.id } } };
  const action = project.actions.find((a) => a.id === id);
  if (action) return { kind: 'action', label: action.title, open: { pane: 'actions', extra: { actionId: action.id } } };
  const decision = project.decisions.find((d) => d.id === id);
  if (decision) return { kind: 'decision', label: decision.title, open: { pane: 'decisions', extra: { item: decision.id } } };
  const report = project.reports.find((r) => r.id === id);
  if (report) return { kind: 'report', label: report.title, open: { pane: 'reports', extra: { item: report.id } } };
  const asset = project.assets.find((a) => a.id === id);
  if (asset) return { kind: 'asset', label: asset.name, open: { pane: 'assets', extra: { assetId: asset.id } } };

  /*
   * What follows lives only on a function's own page. With that function's
   * department switched off there is no page to open, so the record has no
   * place in the menu and is looked at in the graph, as a parcel is. A
   * certified report is a paper too, and opens as one.
   */
  const certified = (project.certifiedReports ?? []).find((r) => r.id === id);
  if (certified && functionOf(certified.workstream)) {
    if (reachable(project, certified.workstream)) return onFunction(project, 'certified_report', certified.title, certified.workstream, 'standing', { item: certified.id }, here);
    return project.evidence.some((e) => e.id === certified.evidenceId) ? { kind: 'certified_report', label: certified.title, open: { pane: 'evidence', extra: { evidenceId: certified.evidenceId } } } : undefined;
  }

  const estimate = /^(.+)::qa::([^:]+)$/.exec(id);
  if (estimate && estimate[1] === project.id && workstreamDefinition(estimate[2]!)) {
    const fn = functionOf(estimate[2])!;
    return reachable(project, fn.key) ? onFunction(project, 'estimate', `${fn.label} estimate`, fn.key, 'standing', {}, here) : undefined;
  }

  const approval = /^(.+)::approval::([^:]+)$/.exec(id);
  if (approval && approval[1] === project.id) {
    if (!reachable(project, 'legal.approvals')) return undefined;
    const line = APPROVAL_KINDS.find((k) => k.key === approval[2]);
    // The graph also draws the khata and the layout sanction as approvals. They are not lines of the register, so the page opens with none marked.
    return onFunction(project, 'approval', line?.label ?? 'Approval', 'legal.approvals', 'approvals', line ? { item: line.key } : {}, here);
  }

  const milestone = (project.milestones ?? []).find((m) => m.id === id);
  if (milestone) return reachable(project, 'construction.progress') ? onFunction(project, 'milestone', milestone.name, 'construction.progress', 'progress', { item: milestone.id }, here) : undefined;
  const entry = (project.siteLog ?? []).find((e) => e.id === id);
  if (entry) return reachable(project, 'construction.progress') ? onFunction(project, 'site_entry', `Site log ${entry.date}`, 'construction.progress', 'progress', { item: entry.id }, here) : undefined;
  const visit = (project.siteVisits ?? []).find((v) => v.id === id);
  if (visit) return reachable(project, 'construction.site') ? onFunction(project, 'site_visit', visit.title, 'construction.site', undefined, {}, here) : undefined;

  const sheet = (project.questionnaires ?? []).find((q) => q.id === id);
  if (sheet) {
    // Engineering keeps its questionnaires inside the technical due diligence. Every other department keeps them on its Summary.
    const department = questionnaireDepartment(sheet);
    const home = department === 'construction' ? departmentHomeWorkstream(department) : undefined;
    if (home) return reachable(project, home) ? onFunction(project, 'questionnaire', sheet.title, home, undefined, {}, here) : undefined;
    const menu = menuDepartment(department);
    if (!menuDepartmentsOf(projectDepartments(project)).includes(menu)) return undefined;
    const stage = stageOfDepartment(project, menu, here.stage ?? stageOf(project.currentStage));
    return { kind: 'questionnaire', label: sheet.title, department: menu, stage, open: { pane: 'department', extra: { department: menu, stage } } };
  }
  return undefined;
}

/**
 * Every id a chat answer can turn into a link, with the words the link shows:
 * the records, the frame they sit in, and the kinds only the graph gives an
 * id to (an approval, an estimate). An id that is not here is printed as the
 * answer wrote it.
 */
export function chatLinkLabels(project: DdProject): Array<{ id: string; label: string }> {
  const rows = [...graphNodeLabels(project), ...projectFrameLabels(project)];
  for (const d of project.decisions) rows.push({ id: d.id, label: d.title });
  for (const r of project.reports) rows.push({ id: r.id, label: r.title });
  for (const v of project.siteVisits ?? []) rows.push({ id: v.id, label: v.title });
  for (const m of project.milestones ?? []) rows.push({ id: m.id, label: m.name });
  for (const e of project.siteLog ?? []) rows.push({ id: e.id, label: `Site log ${e.date}` });
  for (const r of project.certifiedReports ?? []) rows.push({ id: r.id, label: r.title });
  for (const q of project.questionnaires ?? []) rows.push({ id: q.id, label: q.title });
  for (const line of approvalsRegister(project)) {
    // The lines the graph draws: one with a paper behind it, or one the project should hold by now.
    if (line.held.length || (line.status !== 'if_applicable' && line.status !== 'not_yet_due')) rows.push({ id: `${project.id}::approval::${line.kind.key}`, label: line.kind.label });
  }
  for (const fn of everyFunction()) {
    if (!enabledOf(project, fn)) continue;
    for (const key of fn.workstreams) if (workstreamDefinition(key)?.status === 'live') rows.push({ id: `${project.id}::qa::${key}`, label: `${fn.label} estimate` });
  }
  return rows;
}

/* ==================================================================== */
/* What is waiting, function by function                                 */
/* ==================================================================== */

/**
 * The order a review walks the documents with values waiting: the functions
 * in menu order, then the documents no function holds. Returns a rank for a
 * function's key; lower is sooner.
 */
export function functionRank(key: string | undefined): number {
  const at = everyFunction().findIndex((fn) => fn.key === key);
  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
}

/* ==================================================================== */
/* What to ask                                                           */
/* ==================================================================== */

/**
 * The questions offered on each page, by the page's key: a function's own, a
 * department's (its Summary), or a shared place's pane.
 *
 * Each is a question the file answers by itself, with no model: a test asks
 * every one of them of the seeded projects and fails if one falls through.
 * "Here" is the page the person is on. The answer says which page it was
 * about, and offers the same question of the whole project.
 */
export const CHAT_PROMPTS: Readonly<Record<string, readonly string[]>> = {
  'legal.title': ["What's missing here?", 'How far back does the title go?', 'What is the extent?', 'Which findings are critical here?'],
  'legal.approvals': ['Which approvals are missing or lapsed?', 'Is the plan sanctioned?', 'Is the land converted?', "What's missing here?"],
  'construction.progress': ['How far along is the work?', 'Which milestones are late?', "What's missing here?"],
  'construction.quality': ['Summarise this page', "What's missing here?", 'Which findings are critical here?'],
  'construction.site': ['Summarise this page', "What's missing here?", 'Which findings are critical here?'],
  'finance.valuation': ['What is it worth?', "What's missing here?", 'Summarise this page'],
  legal: ['Summarise this department', "What's missing here?", 'Which findings are critical here?', 'Is the land converted?'],
  finance: ['Summarise this department', 'What is it worth?', "What's missing here?"],
  construction: ['Summarise this department', 'How far along is the work?', "What's missing here?", 'Which findings are critical here?'],
  commercial: ['Summarise this department', "What's missing here?", 'Which findings are critical here?'],
  procurement: ['Summarise this department', "What's missing here?", 'Which findings are critical here?'],
  evidence: ['What documents are on file?', 'What documents do I need?', "What's missing?"],
  dd: ["What's next?", "What's missing?", 'Summarise this file'],
  scope: ["What's next?", "What's missing?", 'Summarise this file'],
  findings: ['Which findings are critical?', 'Review findings without evidence', 'Generate the red flag report'],
  risks: ['What are the open risks?', 'What actions are overdue?', "What's next?"],
  actions: ['What actions are overdue?', 'What are the open risks?', "What's next?"],
  reports: ['Generate the red flag report', 'Generate the executive DD report', 'Summarise this file'],
};

/** The row of the table a place reads: its function's, its department's, its pane's, or none. */
export function chatPromptKey(place: ChatPlace | undefined): string | undefined {
  const at = menuPlaceOfWords(place);
  const key = at.fn ?? at.department ?? place?.pane;
  return key && CHAT_PROMPTS[key] ? key : undefined;
}

/**
 * The questions for a place with no row of its own, from where the file
 * stands: documents missing, findings open, a report worth generating.
 */
function standingPrompts(project: DdProject): string[] {
  const rows: string[] = [];
  const filed = project.evidence.filter((e) => (e.attachments ?? []).length).length;
  // Filed before the reader existed, or that it could not read then: the file is there, but nothing on the row says what it states.
  const unread = project.evidence.filter((e) => (e.attachments ?? []).length && !(e.facts ?? []).length && !e.modelReadAt && e.status !== 'rejected' && e.status !== 'superseded').length;
  const material = project.findings.filter((f) => (f.severity === 'critical' || f.severity === 'high') && !['closed', 'rejected', 'duplicate', 'superseded'].includes(f.status)).length;
  const drafts = (project.aiDrafts ?? []).filter((d) => d.status === 'draft' || d.status === 'accepted' || d.status === 'in_review').length;
  if (filed === 0) {
    // A file with nothing on it: the next step itself is the first thing to offer.
    if (fileIsBare(project)) rows.push(projectNextStep(project).title);
    rows.push('What can you do?', 'What documents do I need?');
  } else {
    if (unread) rows.push('Read the filed documents');
    rows.push('Summarise this file');
    if (material) rows.push('Which findings are critical?');
    rows.push("What's missing?");
    if (material && !project.reports.some((r) => r.kind === 'red_flag')) rows.push('Generate the red flag report');
  }
  if (drafts) rows.push('Review pending drafts');
  if (rows.length < 4) rows.push("What's next?");
  return [...new Set(rows)].slice(0, 4);
}

/**
 * The questions to offer where a person is: the place's own where it has a
 * row, otherwise the ones that follow from where the file stands.
 */
export function chatPrompts(project: DdProject, place: ChatPlace | undefined): string[] {
  const key = chatPromptKey(place);
  return key ? [...CHAT_PROMPTS[key]!] : standingPrompts(project);
}
