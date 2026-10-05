/**
 * What a document dropped into the chat did to the file, said in the reply.
 *
 * `document-intake` decides what a read document puts in front of a person:
 * the row it answers, the check fields it can fill, the findings it raises.
 * This says the rest of what a person wants to know the moment a paper lands:
 *
 * - **where it went**: the function it was filed under, or that no function
 *   holds it yet, with the likely ones offered and none chosen for them;
 * - **where its values go**: how many it offers to checks, function by
 *   function;
 * - **what it disagrees with**: a value it states against one a check, the
 *   project record or another accepted paper already holds, each with where
 *   it came from. Nothing is overwritten. On a check the two wait side by
 *   side for a person to keep one;
 * - **what it reaches**: the functions downstream of the one it was filed
 *   under, and a certified report standing on any of them.
 *
 * Everything here is read off the project as it stands after the paper was
 * filed. Nothing is stored: the graph draws the paper from the register, and
 * these are sentences about that register.
 */

import { chatPlaceLabel, functionOfDocument, functionRank, functionSections, functionsNamed, openPlace, placeOfRecord, titleWords, type ChatPlace, type PlaceOpen } from './chat-places';
import { formatFieldValue } from './check-fields';
import type { WaitingEntry } from './cockpit';
import {
  MENU_DEPARTMENTS,
  functionKey,
  menuFunctions,
  stageDefinition,
  stageOf,
  withDepartment,
  workstreamDefinition,
  workstreamOfCheck,
  type MenuFunction,
} from './departments';
import { decidedOnACheck, differsOnCheck, statesTheSame, surveyNumbersIn } from './document-intake';
import type { DocumentFact } from './document-parse';
import { acceptedFacts, liveFacts } from './fact-review';
import { graphImpact } from './graph-impact';
import { CHECK_DEFINITIONS } from './libraries';
import { checkSchema, recordAuditEvent } from './operations';
import { buildProjectGraph } from './project-graph';
import { projectDepartments } from './team';
import type { ChatChoice, ChatProposal, DdProject, EvidenceRecord } from './types';
import { setDocumentWorkstream } from './vault';
import { plainWords, stageNamed } from './wizard';

function andList(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function everyFunction(): MenuFunction[] {
  return MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu));
}

/** A function with its department in front, the way a place is written: "Legal › Title". */
function inFull(fn: string): string {
  const def = everyFunction().find((f) => f.key === functionKey(fn));
  return def ? withDepartment(def.key, def.label) : fn;
}

/* ==================================================================== */
/* Where it went                                                         */
/* ==================================================================== */

/** The papers of one drop that one function holds, or the ones no function holds. */
export interface FiledGroup {
  /** The function they were filed under. Absent for papers no function holds. */
  fn?: string;
  /** "Legal › Title", or "Documents" for the papers no function holds. */
  label: string;
  ids: string[];
  /** What opens to see them: the function's page at its documents, or the register of every document. */
  open: PlaceOpen;
}

/**
 * Where the papers of one drop were filed, a function at a time, in the
 * menu's order, with the papers no function holds last.
 *
 * A function is the one the register already files the paper under: what the
 * document is decides it, or a person did. A function whose page has no
 * documents part (Valuation, the site record, one not built yet) still holds
 * the paper, and it is seen in the register.
 */
export function filedGroups(project: DdProject, evidenceIds: readonly string[], here: ChatPlace = {}): FiledGroup[] {
  const groups = new Map<string, FiledGroup>();
  for (const id of evidenceIds) {
    const row = project.evidence.find((e) => e.id === id);
    if (!row) continue;
    const fn = functionOfDocument(project, row);
    const key = fn ?? '';
    const held = groups.get(key);
    if (held) {
      held.ids.push(id);
      continue;
    }
    const at = placeOfRecord(project, id, here);
    // The page opens with the row lit. The paper itself is not opened over it: its values are reviewed on the desk.
    const { evidenceId: _viewer, ...extra } = at?.open.extra ?? {};
    const onPage = at && at.open.pane !== 'evidence';
    groups.set(key, { ...(fn ? { fn } : {}), label: fn ? inFull(fn) : 'Documents', ids: [id], open: onPage ? { pane: at.open.pane, extra } : { pane: 'evidence', extra: {} } });
  }
  return [...groups.values()].sort((a, b) => functionRank(a.fn) - functionRank(b.fn));
}

/**
 * Where a drop's papers went, in one sentence: the functions, and the stage
 * the project was at when they were filed. Papers no function holds are said
 * to be in Documents, not yet given to one.
 */
export function filedSentence(project: DdProject, groups: readonly FiledGroup[], unread = false): string {
  const stage = stageDefinition(stageOf(project.currentStage)).label;
  const held = groups.filter((g) => g.fn);
  const loose = groups.find((g) => !g.fn);
  const read = unread ? ', unread' : '';
  const parts: string[] = [];
  if (held.length === 1) parts.push(`Filed under ${held[0]!.label}, at the ${stage} stage${read}.`);
  else if (held.length > 1) parts.push(`Filed at the ${stage} stage${read}: ${andList(held.map((g) => `${g.ids.length} under ${g.label}`))}.`);
  if (loose) {
    parts.push(held.length ? `${loose.ids.length} kept in Documents, not yet given to a function.` : `Kept in Documents${read}, not yet given to a function.`);
  }
  return parts.join(' ');
}

/**
 * The functions a paper no function holds might belong to, likeliest first.
 *
 * Read from what the paper was linked to as it was filed: the scopes it
 * answers name a discipline, and a discipline's checks sit in a function.
 * With nothing to go on, the built functions of the departments this project
 * runs. Offered as a choice. The paper stays in Documents until a person
 * picks one.
 */
export function likelyFunctions(project: DdProject, evidence: EvidenceRecord, limit = 3): MenuFunction[] {
  const enabled = projectDepartments(project);
  const open = everyFunction().filter((fn) => enabled.includes(fn.department) && fn.key !== 'design');
  const scopes = new Set(
    project.assessments.flatMap((a) => a.scopes.filter((s) => evidence.scopeInstanceIds.includes(s.id) || s.checks.some((c) => evidence.checkIds.includes(c.id))).map((s) => s.scopeKey as string)),
  );
  const counts = new Map<string, number>();
  for (const def of CHECK_DEFINITIONS) {
    if (!scopes.has(def.id.split('.')[0]!)) continue;
    const fn = functionKey(workstreamOfCheck(def.id));
    counts.set(fn, (counts.get(fn) ?? 0) + 1);
  }
  const byScope = open.filter((fn) => counts.has(fn.key)).sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
  const built = open.filter((fn) => fn.built && !byScope.includes(fn));
  return [...byScope, ...built].slice(0, limit);
}

/**
 * One way to file a paper under a function: the sentence a person would type,
 * and the paper itself. The paper travels with the pick, so pressing it files
 * that paper whatever else shares its title.
 */
function fileChoice(evidence: EvidenceRecord, place: string, id: string, said?: { label: string; detail: string }): ChatChoice {
  // The sentence quotes the title, so a quote mark inside the title is left out of it. The paper is found by its words either way.
  const title = evidence.title.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id,
    label: said?.label ?? place,
    detail: said?.detail ?? `File “${title}” under it`,
    send: `File “${title}” under ${place}`,
    kind: 'action',
    sitting: { evidenceId: evidence.id },
  };
}

/** The choices for a paper no function holds: each files it under one function, by the sentence the chat reads. */
export function filingChoices(project: DdProject, evidence: EvidenceRecord): ChatChoice[] {
  return likelyFunctions(project, evidence).map((fn, i) => fileChoice(evidence, withDepartment(fn.key, fn.label), `file_${i}`));
}

/** "File “Survey notes” under Legal › Title": the verb, the paper named, and the words for the function. */
const FILE_QUOTED = /^(?:please\s+)?(file|put|give|move)\s+["“]([^"”]+)["”]\s+(?:under|to|in|into)\s+(.+?)[\s.!]*$/i;

/** The same with no quotes, for the one verb only ever said of a document. Read from the last "under", so a title may hold the word. */
const FILE_PLAIN = /^(?:please\s+)?file\s+(.+)\s+under\s+(.+?)[\s.!]*$/i;

/**
 * The documents a name is the title of. Compared as words, so case, an
 * ampersand and a quote mark in the title do not matter, and in whatever
 * script the title is written.
 */
function documentsCalled(project: DdProject, name: string): EvidenceRecord[] {
  const words = titleWords(name);
  return words ? project.evidence.filter((e) => titleWords(e.title) === words) : [];
}

/**
 * The paper and the function a filing sentence names, or null when the
 * sentence is not one.
 *
 * "File" always is. "Put", "give" and "move" are also said of an asset, a
 * risk and an action ("Move “Tower A” to Completed"), so they are only when
 * the name in quotes is a document on the register. Where a document and an
 * asset share the name, the sentence is the asset's when what follows is a
 * stage and no function: nothing is filed under Completed. With no quotes it
 * is a filing sentence only when the words after "under" name a function.
 */
function filingAsk(project: DdProject, text: string): { name: string; fn: string } | null {
  const said = text.trim();
  const quoted = FILE_QUOTED.exec(said);
  if (quoted) {
    const name = quoted[2]!.trim();
    const to = quoted[3]!.trim();
    if (quoted[1]!.toLowerCase() !== 'file') {
      if (!documentsCalled(project, name).length) return null;
      const anAsset = project.assets.some((a) => titleWords(a.name) === titleWords(name));
      if (anAsset && !functionsNamed(to).length && stageNamed(`to ${plainWords(to).trim()}`)) return null;
    }
    return { name, fn: to };
  }
  const plain = FILE_PLAIN.exec(said);
  return plain && functionsNamed(plain[2]!).length ? { name: plain[1]!.trim(), fn: plain[2]!.trim() } : null;
}

/** Whether a sentence asks for a named document to be filed under a function. */
export function asksToFileUnder(project: DdProject, text: string): boolean {
  return filingAsk(project, text) !== null;
}

export type FilingOutcome =
  | { kind: 'filed'; evidence: EvidenceRecord; fn: string; label: string }
  /** Two papers with that title, or two functions with that name: put to the person, and nothing moves. */
  | { kind: 'ask'; text: string; choices: ChatChoice[] }
  | { kind: 'refused'; text: string };

/**
 * File a named document under a function, on a person's own instruction.
 *
 * It runs at once, as every instruction a person gives the chat in their own
 * words does. The paper is named by its title and the function as the menu
 * names it: its one word, its name in full, or either with its department.
 * A title two papers share and a name two functions share are asked back as
 * a choice. A function that is switched off, and a name nothing has, are said
 * so. In each of those nothing moves.
 *
 * `pinned` is the paper a pressed choice carried. It is taken only when it is
 * one of the papers the sentence names, so a pick cannot be turned to another
 * paper by changing the id beside it.
 */
export function fileUnderFromText(project: DdProject, text: string, actor: string, pinned?: string): FilingOutcome | null {
  const ask = filingAsk(project, text);
  if (!ask) return null;
  const rows = documentsCalled(project, ask.name);
  if (!rows.length) return { kind: 'refused', text: `No document is called “${ask.name.replace(/["“”]/g, '')}”. Nothing moved.` };
  // A title an expected row and a filed paper share means the paper in hand.
  const inHand = rows.filter((e) => e.attachments.length > 0);
  const papers = inHand.length ? inHand : rows;
  const row = papers.find((e) => e.id === pinned) ?? (papers.length === 1 ? papers[0]! : undefined);

  const named = functionsNamed(ask.fn);
  if (!named.length) return { kind: 'refused', text: `No function is called “${ask.fn}”. Nothing moved.` };
  const enabled = projectDepartments(project);
  const on = named.filter((fn) => enabled.includes(fn.department));
  if (!on.length) return { kind: 'refused', text: `${chatPlaceLabel({ fn: named[0]!.key })} is switched off on this project. Departments are set on Overview. Nothing moved.` };

  if (!row) {
    // The function is kept as it was said, so a name two functions share is still asked about once the paper is picked.
    const place = on.length === 1 ? withDepartment(on[0]!.key, on[0]!.label) : ask.fn;
    return {
      kind: 'ask',
      text: `${papers.length === 2 ? 'Two' : papers.length} documents are called “${papers[0]!.title}”. Which one?`,
      choices: papers.map((paper, i) => {
        const held = functionOfDocument(project, paper);
        const file = paper.attachments[0];
        // Told apart by the file and the day it came in: the title is the one thing they share.
        const day = new Date(file?.uploadedAt ?? paper.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        return fileChoice(paper, place, `paper_${i}`, { label: file?.fileName ?? paper.title, detail: `${held ? `Under ${inFull(held)}` : 'In Documents'}, filed ${day}` });
      }),
    };
  }
  if (on.length > 1) {
    return {
      kind: 'ask',
      text: `${on.length === 2 ? 'Two' : on.length} functions are called ${on[0]!.label}. Which one?`,
      choices: on.map((fn, i) => fileChoice(row, withDepartment(fn.key, fn.label), `page_${i}`, { label: withDepartment(fn.key, fn.label), detail: fn.name })),
    };
  }
  const fn = on[0]!;
  // Design is four workstreams on the record and one function in the menu: a paper given to it goes to its drawings.
  const workstream = workstreamDefinition(fn.key) ? fn.key : fn.workstreams[0]!;
  const was = functionOfDocument(project, row);
  setDocumentWorkstream(project, row.id, workstream);
  recordAuditEvent(project, { actor, action: 'assign_document', entityType: 'evidence', entityId: row.id, oldValue: was ? inFull(was) : undefined, newValue: withDepartment(fn.key, fn.label) });
  return { kind: 'filed', evidence: row, fn: fn.key, label: withDepartment(fn.key, fn.label) };
}

/* ==================================================================== */
/* Where its values go                                                   */
/* ==================================================================== */

/** The values a drop offers to checks, counted by the function each check sits in. */
export function offeredByFunction(project: DdProject, cards: readonly ChatProposal[]): Array<{ fn: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  const definitions = new Map(project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => [c.id, c.definitionId] as const))));
  for (const card of cards) {
    if (card.kind !== 'record_check_fields') continue;
    const definition = definitions.get(String(card.payload.checkId));
    if (!definition) continue;
    const fn = functionKey(workstreamOfCheck(definition));
    const decided = (card.payload.decided ?? {}) as Record<string, string>;
    const waiting = Object.keys((card.payload.values ?? {}) as Record<string, unknown>).filter((key) => !decided[key]).length;
    if (waiting) counts.set(fn, (counts.get(fn) ?? 0) + waiting);
  }
  return [...counts.entries()].sort((a, b) => functionRank(a[0]) - functionRank(b[0])).map(([fn, count]) => ({ fn, label: chatPlaceLabel({ fn }), count }));
}

/** "6 values fill checks: 4 on Title, 2 on Approvals." Empty when none does. */
export function offeredSentence(offered: ReadonlyArray<{ label: string; count: number }>): string {
  const total = offered.reduce((n, row) => n + row.count, 0);
  if (!total) return '';
  const values = `${total} value${total === 1 ? '' : 's'}`;
  if (offered.length === 1) return `${values} ${total === 1 ? 'fills a check' : 'fill checks'} on ${offered[0]!.label}.`;
  return `${values} fill checks: ${offered.map((row) => `${row.count} on ${row.label}`).join(', ')}.`;
}

/* ==================================================================== */
/* What it disagrees with                                                */
/* ==================================================================== */

/** A value a paper states that differs from one already held, with both and where each came from. */
export interface Disagreement {
  key: string;
  label: string;
  /** What this paper states, and the page it states it on. */
  stated: string;
  page: number;
  evidenceId: string;
  /** What is held: on a check, on the project record, or accepted on another paper. */
  against: 'check' | 'project' | 'document';
  held: string;
  /** The check or the other paper, by id, where there is one to open. */
  refId?: string;
  /** The paper the held value was read from, and its page, where it was read from one. */
  heldFrom?: string;
  heldPage?: number;
  /** Who recorded the held value, where no paper stands behind it. */
  heldBy?: string;
}

/**
 * What two papers about one parcel should agree on, whatever kind they are:
 * the numbers the parcel goes by, and who the revenue records name as its
 * owner. Anything else two papers both state is either a check's field, and
 * compared there, or theirs alone: two deeds in one chain name different
 * parties and dates and do not disagree.
 */
const PARCEL_KEYS = new Set(['khata_number', 'pid', 'owner']);

/** The extents a paper can state, each of which is compared with the land area on the project record. */
const EXTENT_KEYS = new Set(['extent_title', 'extent_khata', 'extent_survey']);

/** The survey numbers a paper says it is about, from what it states and nobody has set aside. */
function parcelOf(evidence: EvidenceRecord, facts: readonly DocumentFact[] = liveFacts(evidence)): string[] {
  return surveyNumbersIn(facts.find((f) => f.key === 'survey_numbers')?.value ?? '');
}

/**
 * What a filed paper states that differs from what the file already holds.
 *
 * Three places a value is held. A check, where a person recorded it or
 * accepted it from another paper: asked as the card that offers the value
 * asks, so the line and the card agree on what differs. The project record:
 * the parcel and the land area. And another paper a person accepted as
 * stating it. A value held in more than one of them is one disagreement,
 * named at the first of those, which is where it can be settled.
 *
 * Which land a paper is about is settled against the project record, where
 * the record names a parcel, and against another paper only where it names
 * none. A site can be several parcels, each with a deed and a khata of its
 * own, and those do not disagree. So two papers are set against each other on
 * the khata number, the PID and the owner only when they are about the same
 * parcel, and a paper's extent is set against the land area only when the
 * paper is about the whole site: it names the parcels the project does, or
 * names none and the project is one parcel.
 */
export function documentDisagreements(project: DdProject, evidence: EvidenceRecord, facts: readonly DocumentFact[] = liveFacts(evidence)): Disagreement[] {
  const out: Disagreement[] = [];
  const site = surveyNumbersIn(project.parcelId ?? '');
  const named = parcelOf(evidence, facts);
  const wholeSite = named.length ? named.length === site.length && named.every((n) => site.includes(n)) : site.length <= 1;
  const sameParcel = (other: EvidenceRecord): boolean => {
    const theirs = parcelOf(other);
    return named.length && theirs.length ? named.some((n) => theirs.includes(n)) : site.length <= 1;
  };
  for (const fact of facts) {
    // A value a person has decided for this paper is settled for this paper, wherever else the file holds another.
    // Another paper that states it is asked afresh: setting aside one khata's parcel says nothing of the next deed's.
    const settled = decidedOnACheck(project, fact.key, fact.value, evidence);
    const stated = { key: fact.key, label: fact.label, stated: fact.display, page: fact.page, evidenceId: evidence.id };
    const found: Array<{ row: Disagreement; value: unknown }> = [];
    for (const assessment of project.assessments) {
      if (assessment.status === 'archived') continue;
      for (const check of assessment.scopes.flatMap((s) => s.checks)) {
        const def = checkSchema(check).fields.find((f) => f.key === fact.key);
        const held = check.fields?.[fact.key];
        if (!def || !held || held.sourceEvidenceId === evidence.id || !differsOnCheck(project, check, def, fact)) continue;
        const from = held.sourceEvidenceId ? project.evidence.find((e) => e.id === held.sourceEvidenceId) : undefined;
        found.push({
          value: held.value,
          row: { ...stated, against: 'check', held: formatFieldValue(def, held), refId: check.id, ...(from ? { heldFrom: from.documentType ?? from.title } : { heldBy: held.by }), ...(held.page ? { heldPage: held.page } : {}) },
        });
      }
    }
    if (!settled && fact.key === 'survey_numbers' && site.length && !statesTheSame(fact.key, project.parcelId, fact.value)) {
      found.push({ value: project.parcelId, row: { ...stated, against: 'project', held: project.parcelId!.trim() } });
    }
    const area = project.landAreaSqm;
    const measured = EXTENT_KEYS.has(fact.key);
    if (!settled && measured && wholeSite && area && typeof fact.value === 'number' && (!fact.unit || fact.unit === 'sqm') && !statesTheSame(fact.key, area, fact.value, true)) {
      found.push({ value: area, row: { ...stated, against: 'project', held: `${Math.round(area).toLocaleString('en-IN')} sqm` } });
    }
    // Against another paper: which land it is where the record does not say, and what one parcel's papers share.
    const between = !settled && (fact.key === 'survey_numbers' ? site.length === 0 : PARCEL_KEYS.has(fact.key));
    for (const other of between ? project.evidence : []) {
      if (other.id === evidence.id || other.status === 'superseded' || other.status === 'rejected') continue;
      const theirs = acceptedFacts(other).find((f) => f.key === fact.key);
      if (!theirs) continue;
      // Two lists of survey numbers agree when either holds all of the other. Anything else, when the papers are about one parcel and say different things.
      const agree = fact.key === 'survey_numbers' ? statesTheSame(fact.key, theirs.value, fact.value) || statesTheSame(fact.key, fact.value, theirs.value) : !sameParcel(other) || statesTheSame(fact.key, theirs.value, fact.value);
      if (agree) continue;
      found.push({ value: theirs.value, row: { ...stated, against: 'document', held: theirs.display, refId: other.id, heldFrom: other.documentType ?? other.title, heldPage: theirs.page } });
    }
    const said: unknown[] = [];
    for (const { row, value } of found) {
      if (said.some((held) => statesTheSame(fact.key, held, value, measured) && statesTheSame(fact.key, value, held, measured))) continue;
      said.push(value);
      out.push(row);
    }
  }
  return out;
}

/** Which land a paper is about, before anything else it states: a paper about other land is the first thing to know. */
const WHICH_LAND = ['survey_numbers', 'pid', 'khata_number'];

/**
 * The disagreements of a drop, in one line: each value beside the one it
 * differs from and where that one is, with the check or the other paper as a
 * link. Two are named and the rest counted, the ones about which land it is
 * first. Several papers stating the one value against the one held are one
 * disagreement, said once with how many state it.
 */
export function disagreementSentence(rows: readonly Disagreement[]): string {
  if (!rows.length) return '';
  const groups = new Map<string, { row: Disagreement; papers: Set<string> }>();
  for (const row of rows) {
    const key = [row.key, row.stated, row.against, row.refId ?? '', row.held].join('|');
    const held = groups.get(key);
    if (held) held.papers.add(row.evidenceId);
    else groups.set(key, { row, papers: new Set([row.evidenceId]) });
  }
  const rank = (row: Disagreement) => (WHICH_LAND.includes(row.key) ? WHICH_LAND.indexOf(row.key) : WHICH_LAND.length);
  const ordered = [...groups.values()].sort((a, b) => rank(a.row) - rank(b.row));
  const said = ordered.slice(0, 2).map(({ row, papers }) => {
    const source = row.heldFrom ? `, from ${row.heldFrom}${row.heldPage ? ` p.${row.heldPage}` : ''}` : row.heldBy ? `, recorded by ${row.heldBy}` : '';
    const where = row.against === 'project' ? 'on the project record' : row.against === 'check' ? `on [${row.refId}]${source}` : `in [ev:${row.refId}]${row.heldPage ? `, p.${row.heldPage}` : ''}`;
    return `${row.label} ${row.stated} (${papers.size > 1 ? `${papers.size} documents` : `p.${row.page}`}) against ${row.held} ${where}`;
  });
  const more = ordered.length - said.length;
  return `⚑ Differs from what is on file: ${said.join('; ')}${more > 0 ? `; and ${more} more` : ''}. Nothing is overwritten.`;
}

/* ==================================================================== */
/* What it reaches                                                       */
/* ==================================================================== */

/**
 * What else a drop's papers reach, in one line, or nothing when they reach
 * nothing: the functions downstream of the ones they were filed under, and a
 * certified report that stands on any of those. The walk is the graph's own
 * (`graphImpact`), over the project as it stands with the papers filed.
 *
 * A certified report is named because it is the figure of record: when the
 * estimate beside it moves far enough the product marks it to revisit, and a
 * paper that changes a value underneath it is how that starts.
 */
export function reachSentence(project: DdProject, evidenceIds: readonly string[]): string {
  if (!evidenceIds.length) return '';
  const graph = buildProjectGraph(project);
  const downstream = new Map<string, { label: string; hops: number }>();
  const certified = new Map<string, string>();
  for (const id of evidenceIds) {
    const impact = graphImpact(graph, id);
    if (!impact) continue;
    for (const row of impact.downstream) {
      const held = downstream.get(row.node.id);
      if (!held || row.hops < held.hops) downstream.set(row.node.id, { label: row.node.key ? chatPlaceLabel({ fn: row.node.key }) : row.node.label, hops: row.hops });
    }
    for (const node of impact.certified) {
      const report = (project.certifiedReports ?? []).find((r) => r.id === node.id);
      if (report) certified.set(report.id, `${report.title} (${report.signer.name})`);
    }
  }
  const parts: string[] = [];
  // Nearest first, as the walk gives them. Three are named: past that the line is a list and not a warning.
  const names = [...downstream.values()].sort((a, b) => a.hops - b.hops || a.label.localeCompare(b.label)).map((row) => row.label);
  if (names.length) parts.push(`Reaches ${andList(names.slice(0, 3))}${names.length > 3 ? `, and ${names.length - 3} more downstream` : ''}.`);
  if (certified.size) parts.push(`${andList([...certified.values()])}, certified, ${certified.size === 1 ? 'rests' : 'rest'} on this and may need revisiting.`);
  return parts.join(' ');
}

/* ==================================================================== */
/* The ways on from a reply                                              */
/* ==================================================================== */

/**
 * One way on from a chat reply, drawn as a chip under it.
 *
 * A reply holds no buttons that decide anything. It says what it did in
 * words, and these are the ways to where that happened: what it left waiting,
 * a function at a time; where else its papers went; and the paper in the
 * graph. They are read off the project as it stands, so a chip for something
 * since decided is gone.
 */
export interface TurnChip {
  key: string;
  kind: 'waiting' | 'filed' | 'graph';
  /** On a waiting chip: how many decisions wait. */
  count?: number;
  /** What the chip says: "waiting on the Title documents", "Approvals documents", "In the graph". */
  words: string;
  /** On a waiting chip: the first thing waiting, for the review that walks the rest. */
  entry?: WaitingEntry;
  /** The page the chip opens. A waiting chip without one opens what waits itself. */
  open?: PlaceOpen;
  /** Records to light on the page it opens. */
  ids?: string[];
}

/** The page a function's checks are listed on, when its page has a part for them. */
function checksPart(project: DdProject, fn: string | undefined, here: ChatPlace): PlaceOpen | undefined {
  if (!fn || !functionSections(fn).includes('checks')) return undefined;
  const page = openPlace(project, { fn, section: 'checks' }, undefined, here);
  return page.kind === 'go' ? page.open : undefined;
}

/** What waits, grouped by where it waits: the documents and the checks a function at a time, anything else by its register. */
function waitingChips(project: DdProject, entries: readonly WaitingEntry[], here: ChatPlace): TurnChip[] {
  const chips: TurnChip[] = [];
  const byKey = new Map<string, TurnChip>();
  for (const entry of entries) {
    const byFunction = entry.pane === 'evidence' || entry.pane === 'scope';
    const key = `${entry.pane}|${byFunction ? (entry.fn ?? '') : ''}`;
    const held = byKey.get(key);
    if (held) {
      held.count = (held.count ?? 0) + entry.count;
      continue;
    }
    const what = entry.pane === 'evidence' ? 'documents' : 'checks';
    const words = byFunction ? `waiting on the ${entry.fn ? `${chatPlaceLabel({ fn: entry.fn })} ` : ''}${what}` : `waiting under ${chatPlaceLabel({ pane: entry.pane })}`;
    const open = entry.pane === 'scope' ? checksPart(project, entry.fn, here) : undefined;
    const chip: TurnChip = { key, kind: 'waiting', count: entry.count, words, entry, ...(open ? { open } : {}) };
    byKey.set(key, chip);
    chips.push(chip);
  }
  return chips;
}

/**
 * Everything still waiting on the project, in a sentence that says where:
 * "3 more are waiting: 2 on the Approvals documents and 1 on the Approvals
 * checks." Empty when nothing waits. It is what "approve all" says when the
 * last reply has nothing left to accept and other replies do.
 */
export function waitingSentence(project: DdProject, waiting: { entries: WaitingEntry[] }, here: ChatPlace = {}): string {
  const chips = waitingChips(project, waiting.entries, here);
  const total = chips.reduce((n, chip) => n + (chip.count ?? 0), 0);
  if (!total) return '';
  return `${total === 1 ? '1 more is' : `${total} more are`} waiting: ${andList(chips.map((chip) => `${chip.count} ${chip.words.replace(/^waiting /, '')}`))}.`;
}

/**
 * The chips under one reply.
 *
 * What the reply left waiting is grouped by where it waits: the documents and
 * the checks a function at a time, anything else by its register. A chip for
 * a function's documents opens their review; one for its checks opens the
 * function's page at its checks, where each row says what waits on it. After
 * a drop, the functions its other papers went to follow (the page already
 * opened on the first), and last the first paper in the graph.
 */
export function turnChips(
  project: DdProject,
  turn: { proposalIds?: string[]; citedEvidenceIds?: string[]; toolCalls?: Array<{ name: string }> },
  waiting: { entries: WaitingEntry[] },
  here: ChatPlace = {},
): TurnChip[] {
  const cards = new Set(turn.proposalIds ?? []);
  const cited = new Set(turn.citedEvidenceIds ?? []);
  const mine = waiting.entries.filter((e) => (e.proposalId && cards.has(e.proposalId)) || (e.kind === 'facts' && e.evidenceId && cited.has(e.evidenceId)));
  const chips = waitingChips(project, mine, here);
  const byKey = new Map(chips.map((chip) => [chip.key, chip]));
  if (!(turn.toolCalls ?? []).some((call) => call.name === 'ingest')) return chips;
  const filed = (turn.citedEvidenceIds ?? []).filter((id) => project.evidence.some((e) => e.id === id && e.attachments.length > 0));
  if (!filed.length) return chips;
  for (const group of filedGroups(project, filed, here).slice(1)) {
    // A function whose documents already have a waiting chip needs no second way to them.
    if (!group.fn || byKey.has(`evidence|${group.fn}`)) continue;
    chips.push({ key: `filed|${group.fn}`, kind: 'filed', words: `${chatPlaceLabel({ fn: group.fn })} documents`, open: group.open, ids: group.ids });
  }
  chips.push({ key: 'graph', kind: 'graph', words: 'In the graph', open: { pane: 'graph', extra: { node: filed[0]! } }, ids: [filed[0]!] });
  return chips;
}
