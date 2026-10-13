/**
 * What an engineer's report observed, offered to Engineering › Technical.
 *
 * A technical due diligence, condition or structural audit report is a list
 * of observations: what was seen of some part of the building, how serious it
 * is, and what the engineer recommends. Each is a row a person can act on, so
 * each is offered as a record of **Report observations**
 * (`construction.quality.observations`): the part of the building and the
 * risk as picks from a list, and what was seen and what is recommended as the
 * page's own words, cut short, with the page they are on.
 *
 * The rules read two ways such a list is written. With labels:
 *
 *     Observation 4: Basement retaining wall
 *     Seepage along the construction joint at grid C-4.
 *     Risk category: High
 *     Mitigation: Inject the joint with polyurethane grout.
 *
 * and as the rows of a table, which a page's words give as numbered lines,
 * the risk standing between what was seen and what is recommended:
 *
 *     4 Seepage along the construction joint at grid C-4 High Inject the joint
 *
 * Nothing is reworded: a row's words are the page's, and a part of the
 * building is picked only where the words name one. Every value waits on its
 * record for a lead or signer of Engineering to accept.
 */

import type { DdProject, FieldAddress, FieldOrigin } from './types';
import { ORIGIN_QUOTE_MOST, fieldRecords, proposeFieldValues, readSheet, type FieldProposal } from './field-sheets';

export const REPORT_OBSERVATIONS_SET = 'construction.quality.observations';
const FN = 'construction.quality';

export type ObservationRisk = 'critical' | 'high' | 'medium' | 'low';

/** The parts of a building an observation may be of, by key, each with the words that name it on a page. */
export const OBSERVED_ELEMENTS: ReadonlyArray<{ key: string; label: string; named: RegExp }> = [
  { key: 'waterproofing', label: 'Waterproofing and damp', named: /waterproof|seepage|leak|damp|efflorescence|ponding|water\s+ingress/i },
  { key: 'foundation', label: 'Foundation and basement', named: /foundation|footing|\bpiles?\b|basement|retaining\s+wall|raft|settlement|substructure/i },
  { key: 'structure', label: 'Structure', named: /\bstructur|\bbeams?\b|\bcolumns?\b|\bslabs?\b|reinforcement|rebar|honeycomb|spalling|\bcracks?\b|concrete\s+cover|corrosion|\bRCC\b/i },
  { key: 'fire', label: 'Fire and life safety', named: /\bfire\b|sprinkler|hydrant|smoke|refuge|escape|extinguisher/i },
  { key: 'electrical', label: 'Electrical', named: /electric|transformer|\bDG\b|generator|earthing|cabl(?:e|ing)|switchgear|\bpanels?\b|lightning/i },
  { key: 'plumbing', label: 'Plumbing and drainage', named: /plumb|drain|sewage|\bSTP\b|sanitary|water\s+supply|\bpipes?\b|sump|overhead\s+tank/i },
  { key: 'lifts', label: 'Lifts', named: /\blifts?\b|elevator|escalator/i },
  { key: 'hvac', label: 'Cooling and ventilation', named: /\bHVAC\b|ventilat|air[\s-]*condition|chiller|\bAHU\b|exhaust/i },
  { key: 'facade', label: 'Facade and envelope', named: /fa[cç]ade|cladding|glazing|curtain\s+wall|external\s+wall|\bwindows?\b|parapet/i },
  { key: 'roof', label: 'Roof and terrace', named: /\broof|terrace/i },
  { key: 'masonry', label: 'Masonry and plaster', named: /masonry|blockwork|brickwork|plaster/i },
  { key: 'finishes', label: 'Finishes', named: /finish|flooring|\btiles?\b|tiling|paint|false\s+ceiling|joinery|\bdoors?\b/i },
  { key: 'external', label: 'External works', named: /external\s+works?|landscap|compound\s+wall|\broads?\b|paving|storm\s*water|boundary/i },
  { key: 'statutory', label: 'Approvals and documents', named: /approval|sanction|\bNOC\b|certificate|licen[cs]e|statutory|as[\s-]built|drawings?\s+(?:not|are\s+not)|records?\s+(?:not|are\s+not)/i },
];

export const OBSERVATION_RISKS: ReadonlyArray<{ key: ObservationRisk; label: string }> = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

/** One observation as a report states it. Every string is the page's own words. */
export interface ReportObservation {
  /** Its number in the report, as written. */
  number?: string;
  /** What it is of, where the report heads it: "Basement retaining wall". */
  subject?: string;
  /** What was seen, cut short at a word. */
  seen: string;
  risk?: ObservationRisk;
  /** What the report recommends, cut short at a word. */
  action?: string;
  /** The part of the building its words name, where they name one. */
  element?: string;
  /** 1-based. */
  page: number;
  /** The start of it as the page writes it: what a person is shown to check it against. */
  quote: string;
}

const RISK_WORD = String.raw`(Critical|Very\s+High|High|Significant|Major|Medium|Moderate|Low|Minor)`;

function riskOf(word: string): ObservationRisk {
  const said = word.toLowerCase().replace(/\s+/g, ' ');
  if (said === 'critical' || said === 'very high') return 'critical';
  if (said === 'high' || said === 'significant' || said === 'major') return 'high';
  if (said === 'medium' || said === 'moderate') return 'medium';
  return 'low';
}

/** Words cut to a length at a word, said to be cut. One line. */
function short(text: string, most: number): string {
  const flat = text.replace(/\s+/g, ' ').replace(/^[\s:.\-–—]+|[\s:\-–—]+$/g, '').trim();
  if (flat.length <= most) return flat;
  const cut = flat.slice(0, most - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > most * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** What a value kept on a field may run to: a line a reader that is not a person may give. */
const WORDS_MOST = 280;

function elementOf(words: string): string | undefined {
  return OBSERVED_ELEMENTS.find((element) => element.named.test(words))?.key;
}

function made(page: number, block: string, parts: { number?: string; subject?: string; seen: string; risk?: string; action?: string }): ReportObservation | null {
  const seen = short(parts.seen, WORDS_MOST);
  if (seen.length < 8) return null;
  const subject = parts.subject ? short(parts.subject, 120) : '';
  const action = parts.action ? short(parts.action, WORDS_MOST) : '';
  const element = elementOf(`${subject} ${parts.seen}`);
  return {
    ...(parts.number ? { number: parts.number } : {}),
    ...(subject ? { subject } : {}),
    seen,
    ...(parts.risk ? { risk: riskOf(parts.risk) } : {}),
    ...(action ? { action } : {}),
    ...(element ? { element } : {}),
    page,
    quote: block.replace(/\s+/g, ' ').trim().slice(0, ORIGIN_QUOTE_MOST),
  };
}

const LABELLED_START = /^(?:Observation|Finding|Issue|Item)\s*(?:No\.?\s*)?(\d{1,3})\s*[:.)\-–—]?\s*(.*)$/i;
const RISK_LABEL = new RegExp(String.raw`\bRisk(?:\s+(?:category|rating|level|classification))?\s*[:\-–—]\s*${RISK_WORD}\b`, 'i');
const ACTION_LABEL = /\b(?:Mitigation(?:\s+measures?)?|Recommendations?|Recommended\s+actions?|Action\s+required|Remedial\s+(?:actions?|measures?)|Rectification)\s*[:\-–—]\s*/i;

/** Observations written with labels, a block to each. */
function labelled(page: number, lines: string[]): ReportObservation[] {
  const out: ReportObservation[] = [];
  const starts = lines.flatMap((line, at) => (LABELLED_START.test(line) ? [at] : []));
  starts.forEach((start, n) => {
    const body = lines.slice(start, starts[n + 1] ?? lines.length);
    const head = LABELLED_START.exec(body[0]!)!;
    const rest = body.slice(1).join('\n');
    const risk = RISK_LABEL.exec(rest) ?? RISK_LABEL.exec(body[0]!);
    const action = ACTION_LABEL.exec(rest);
    if (!risk && !action) return;
    // What was seen is what stands before the first label, without a label of its own.
    const firstLabel = Math.min(...[risk && rest.includes(risk[0]) ? rest.indexOf(risk[0]) : rest.length, action ? action.index : rest.length]);
    const seen = rest.slice(0, firstLabel).replace(/^\s*(?:Observation|Description|Finding)\s*[:\-–—]\s*/i, '');
    const after = action ? rest.slice(action.index + action[0].length) : '';
    const recommended = after.split(/\n(?=\s*(?:Risk\b|Observation\b|Finding\b))/i)[0]!.replace(RISK_LABEL, '');
    const one = made(page, body.join(' '), { number: head[1], subject: seen.trim() ? head[2] : undefined, seen: seen.trim() ? seen : head[2]!, risk: risk?.[1], action: recommended });
    if (one) out.push(one);
  });
  return out;
}

const ROW_START = /^(\d{1,3})[.)]?\s+(?=\S)/;
/** A risk standing as a word of its own in a row: capitalised, as a table's cell is, and not the start of a sentence's noun ("High Court", "Low level"). */
const RISK_CELL = new RegExp(String.raw`(?<=\s)${RISK_WORD}(?:\s+[Rr]isk)?(?=\s|$)(?!\s+(?:Court|level|rise|side|tension|voltage|pressure|grade|quality|strength|density|priority)\b)`);

/** Observations written as the rows of a table: numbered lines in order, the risk between what was seen and what is recommended. */
function rows(page: number, lines: string[], from: number): { found: ReportObservation[]; next: number } {
  const strict = rowsFrom(page, lines, from, false);
  // A table set in cells puts a row's number on a line of its own where a cell beside it wraps: read again taking such a line as a row's start, and keep whichever reading finds more.
  const loose = rowsFrom(page, lines, from, true);
  return loose.found.length > strict.found.length ? loose : strict;
}

const ROW_NUMBER_ALONE = /^(\d{1,3})[.)]?$/;

function rowsFrom(page: number, lines: string[], from: number, alone: boolean): { found: ReportObservation[]; next: number } {
  const starts: Array<{ at: number; number: number }> = [];
  let expected = from;
  lines.forEach((line, at) => {
    const said = ROW_START.exec(line) ?? (alone ? ROW_NUMBER_ALONE.exec(line) : null);
    // A numbered heading over the table ("1. SUMMARY OF OBSERVATIONS") is no row: a row's words are a sentence, not capitals.
    const heading = /[A-Z]/.test(line) && !/[a-z]/.test(line);
    if (said && !heading && Number(said[1]) === expected) {
      starts.push({ at, number: expected });
      expected += 1;
    }
  });
  const found: ReportObservation[] = [];
  // Under the last row of a page a table's key may stand ("Risk categories: Critical, High, Medium, Low"): it is no part of the row.
  const keyAt = lines.findIndex((line, at) => at > (starts.at(-1)?.at ?? lines.length) && /^(?:Risk\s+(?:categor\w*|ratings?|levels?)|Legend|Key|Notes?)\b.*:/i.test(line));
  const end = keyAt < 0 ? lines.length : keyAt;
  starts.forEach((start, n) => {
    const block = lines.slice(start.at, starts[n + 1]?.at ?? end).join(' ').replace(ROW_START, '').replace(/^\d{1,3}[.)]?$/, '');
    const risk = RISK_CELL.exec(` ${block}`);
    if (!risk) return;
    const at = risk.index - 1;
    const one = made(page, `${start.number} ${block}`, { number: String(start.number), seen: block.slice(0, at), risk: risk[1], action: block.slice(at + risk[0].length) });
    if (one) found.push(one);
  });
  return { found, next: expected };
}

/**
 * The observations a report states, in its order, read from each page's
 * words. Empty where the pages hold no list of observations the rules know.
 */
export function reportObservations(pages: readonly string[]): ReportObservation[] {
  const text = pages.map((page) => page.replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ').split('\n').map((line) => line.trim()).filter(Boolean));
  const withLabels = text.flatMap((lines, index) => labelled(index + 1, lines));
  if (withLabels.length) return withLabels;
  const out: ReportObservation[] = [];
  let next = 1;
  text.forEach((lines, index) => {
    const read = rows(index + 1, lines, next);
    // A numbered list that runs on from the page before, or starts here.
    const fresh = read.found.length ? read : next > 1 ? rows(index + 1, lines, 1) : read;
    out.push(...fresh.found);
    if (fresh.found.length) next = fresh.next;
  });
  // Two numbered lines with a risk word in them are a paragraph; a table of observations has more.
  return out.length >= 3 ? out : [];
}

/**
 * Offers a report's observations to Technical, a record to each, every value
 * with the page it is on and the page's own words. Nothing is offered twice:
 * an observation this paper already offered, accepted or set aside, is left
 * as it stands. Returns how many records were offered now.
 */
export function offerReportObservations(project: DdProject, evidenceId: string, pages: readonly string[]): number {
  const found = reportObservations(pages);
  if (!found.length) return 0;
  // What a record of the set already holds as seen, waiting, standing or set aside: the same words are the same observation.
  const held = new Set(
    (project.fieldSheets?.[REPORT_OBSERVATIONS_SET]?.records ?? []).flatMap((record) => {
      const seen = record.values.seen;
      return [seen?.value, ...(seen?.other ?? []).map((other) => other.value), ...(seen?.declined ?? []).map((declined) => declined.value)].filter((value): value is string => typeof value === 'string');
    }),
  );
  let offered = 0;
  for (const one of found) {
    if (held.has(one.seen)) continue;
    const address = (field: string): FieldAddress => ({ fn: FN, set: REPORT_OBSERVATIONS_SET, field });
    const origin: FieldOrigin = { kind: 'paper', evidenceId, page: one.page, quote: one.quote, reader: 'parser', proof: 'page_text' };
    const values: FieldProposal[] = [
      { address: address('seen'), value: one.seen, origin },
      ...(one.number ? [{ address: address('report_no'), value: one.number, origin }] : []),
      ...(one.subject ? [{ address: address('subject'), value: one.subject, origin }] : []),
      ...(one.element ? [{ address: address('element'), value: one.element, origin }] : []),
      ...(one.risk ? [{ address: address('risk'), value: one.risk, origin }] : []),
      ...(one.action ? [{ address: address('action'), value: one.action, origin }] : []),
    ];
    if (proposeFieldValues(project, values, 'parser').some((outcome) => outcome.outcome === 'waiting')) offered += 1;
  }
  return offered;
}

/**
 * How many observations these papers offered that still wait for somebody:
 * records of the set nobody has accepted a value of, offered by one of the
 * papers. Read through the sheet, so what stands is never counted as waiting.
 */
export function observationsWaitingFrom(project: DdProject, evidenceIds: readonly string[]): number {
  if (!evidenceIds.length) return 0;
  let waiting = 0;
  for (const record of fieldRecords(project, REPORT_OBSERVATIONS_SET)) {
    const sheet = readSheet(project, REPORT_OBSERVATIONS_SET, record.id);
    if (!sheet?.pending) continue;
    if (sheet.fields.some((field) => field.held?.origin?.kind === 'paper' && evidenceIds.includes(field.held.origin.evidenceId))) waiting += 1;
  }
  return waiting;
}
