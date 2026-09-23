/**
 * Answering a question from what the file actually holds.
 *
 * "Who owns it?", "what's the extent?", "is there a mortgage?" — the answers
 * are on the file already: in the facts read off each filed document (with
 * their pages), in the registers, in the last screen. A model is not needed
 * to look them up, and a model that is down, rate limited or unconfigured
 * must not turn "what is the extent" into an apology. So these are answered
 * here, deterministically, in a few lines, every figure with its source.
 *
 * What is NOT answered here is judgement — "why", "should we", "what would
 * you do". Those go to the copilot when one is configured. A question this
 * module cannot ground in the file returns null and falls through, rather
 * than being answered with something nearby.
 */

import type { DocumentFact } from './document-parse';
import { factsOnFile } from './document-intake';
import { packCompleteness } from './operations';
import { plural } from './text';
import type { ChatChoice, DdProject, EvidenceRecord, FindingRecord, FindingSeverity } from './types';

export interface FileAnswer {
  text: string;
  /** Short label for the tool chip. */
  summary: string;
  citedEvidenceIds: string[];
  citedNodeIds: string[];
  /** Where the right-hand pane should go so the source is in view. */
  navigate?: { pane: 'evidence' | 'findings' | 'risks' | 'actions' | 'valuation' | 'overview' | 'reports'; evidenceId?: string; page?: string };
  choices?: ChatChoice[];
}

/* ==================================================================== */
/* Recognising a question                                                */
/* ==================================================================== */

const COMMAND = /^(?:please\s+)?(?:add|set|close|resolve|mitigate|accept|mark|record|assign|start|create|generate|make|draft|run|open|show|go\s+to|take\s+me|switch|approve|skip|reject|request|upload|file|attach|detach|issue|remove|delete|rename|change|update|log|raise)\b/i;
/** Judgement belongs to the copilot, not to a lookup. */
const JUDGEMENT = /\b(?:why|should|would\s+you|recommend|advise|advice|explain|compare|analy[sz]e|assess|opinion|think|worth\s+(?:buying|pursuing|it)|risky|safe\s+to)\b/i;

/**
 * "The biggest risk", "the worst finding" — ranking is judgement, and the
 * file offers the candidates as choices rather than picking one.
 */
const SUPERLATIVE = /\b(?:biggest|worst|largest|most\s+(?:important|serious|urgent|material)|main|primary|top|key|chief)\s+(?:\w+\s+)?(?:risks?|issues?|problems?|concerns?|findings?|red\s+flags?)\b/i;

/** Asked, not stated: a question word first, or a question mark last. */
const QUESTION_SHAPE = /^(?:(?:so|and|ok|okay|hey|please)[\s,]+)?(?:what|what's|whats|who|who's|whose|which|where|when|how|is|are|was|were|does|do|did|has|have|had|can|could|will|would|any|tell\s+me|show\s+me|list|give\s+me)\b|^(?:summar\w*|brief\s+me|overview)\b|\?\s*$/i;

interface Topic {
  key: string;
  test: RegExp;
}

const TOPICS: Topic[] = [
  { key: 'help', test: /\b(?:what\s+can\s+you\s+do|what\s+do\s+you\s+do|how\s+(?:do|does)\s+(?:i|you|this)\s+(?:use|work)|how\s+to\s+use|^help\b|^\?$|getting\s+started|how\s+do\s+i\s+start)\b/i },
  { key: 'greeting', test: /^(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening)|namaste|yo)\b[\s!.,]*$/i },
  { key: 'thanks', test: /^(?:thanks|thank\s+you|thx|ty|cheers|great|perfect|nice|cool|ok(?:ay)?|got\s+it|awesome)\b[\s!.,]*(?:thanks|thank\s+you)?[\s!.,]*$/i },
  { key: 'owner', test: /\b(?:who\s+(?:owns|is\s+the\s+owner|holds\s+title|bought|sold)|owner(?:ship)?\b|vendor|purchaser|seller|buyer|title\s+holder|in\s+whose\s+name)\b/i },
  { key: 'extent', test: /\b(?:extent|land\s+area|site\s+area|plot\s+(?:size|area)|how\s+(?:big|large)|size\s+of|square\s+met|sq\.?\s?m|sqft|acres?|guntas?)\b/i },
  { key: 'parcel', test: /\b(?:survey\s+(?:no|number)s?|sy\.?\s*no|parcel|which\s+survey|khata\s+(?:no|number)|pid)\b/i },
  { key: 'encumbrance', test: /\b(?:encumbr\w*|mortgages?|charges?\s+on|loans?|liens?|\bec\b|hypothecat\w*|attach(?:ed|ment)|charged|clean\s+title)\b/i },
  { key: 'conversion', test: /\b(?:conver(?:t|ted|sion)|agricultural|non[\s-]?agri\w*|\bdc\s+order|land\s+use\s+change)\b/i },
  { key: 'zoning', test: /\b(?:zon(?:e|ing)|land\s+use|\bfar\b|floor\s+area\s+ratio|master\s+plan|\brmp\b|permissible|plan\s+in\s+force)\b/i },
  { key: 'sanction', test: /\b(?:sanction\w*|approved\s+plan|building\s+plan|plan\s+approval|built[\s-]?up|\boc\b|occupancy|refuge)\b/i },
  { key: 'tax', test: /\b(?:property\s+tax|tax\s+(?:paid|receipt|status)|\bsas\b|khata|dues)\b/i },
  { key: 'title', test: /\b(?:title\s+chain|chain\s+of\s+title|mother\s+deed|root\s+of\s+title|title\s+history|previous\s+owners?|how\s+far\s+back|sale\s+deed|registered)\b/i },
  { key: 'value', test: /\b(?:worth|value|valuation|valued|price|how\s+much|market\s+rate|consideration)\b/i },
  { key: 'findings', test: /\b(?:findings?|red\s+flags?|issues?|problems?|what'?s\s+wrong|what\s+is\s+wrong|concerns?|defects?)\b/i },
  { key: 'risks', test: /\brisks?\b/i },
  { key: 'actions', test: /\b(?:actions?|to-?dos?|tasks?|overdue|what\s+(?:do|should)\s+i\s+do\s+(?:now|today))\b/i },
  { key: 'missing', test: /\b(?:missing|gaps?|outstanding|still\s+need|what\s+(?:documents|papers|docs)\s+(?:do\s+(?:we|i)\s+need|are\s+(?:missing|needed))|pending\s+documents?)\b/i },
  { key: 'documents', test: /\b(?:what|which)\s+(?:documents|papers|docs|files)\b|\bdocuments?\s+(?:on\s+file|we\s+have|received)\b/i },
  // Last: "what is the encumbrance status" is about the EC, not the file.
  { key: 'summary', test: /\b(?:summar(?:y|i[sz]e)|overview|status|where\s+(?:do|does)\s+(?:we|it|the\s+file|this)\s+stand|brief\s+me|state\s+of\s+(?:the\s+)?file|how\s+(?:is|are)\s+(?:we|it|the\s+file)\s+(?:doing|looking))\b/i },
];

function topicsOf(question: string): string[] {
  return TOPICS.filter((t) => t.test.test(question)).map((t) => t.key);
}

/**
 * Whether this is a question the file can answer here.
 *
 * True for greetings, "what can you do", and factual questions about the
 * property or the registers. False for commands (they have their own paths)
 * and for judgement (that is the copilot's).
 */
export function looksLikeFileQuestion(question: string): boolean {
  const q = question.trim();
  if (!q || q.length > 220) return false;
  if (COMMAND.test(q) && !/\?$/.test(q)) return false;
  if (JUDGEMENT.test(q) || SUPERLATIVE.test(q)) return false;
  const topics = topicsOf(q);
  if (!topics.length) return false;
  // Greetings, thanks and "what can you do" are their own shape.
  if (topics.some((t) => t === 'help' || t === 'greeting' || t === 'thanks')) return true;
  // Everything else has to be ASKED. "Land area is 12 acres" names the
  // extent too, and it is a statement to record, not a question to answer.
  return QUESTION_SHAPE.test(q);
}

/* ==================================================================== */
/* Reading the file                                                      */
/* ==================================================================== */

type Sourced = { fact: DocumentFact; evidence: EvidenceRecord };

/** "Sale deed" reads as "sale deed" mid-sentence; "DC conversion order" keeps its acronym. */
function sourceName(evidence: EvidenceRecord): string {
  const name = evidence.documentType ?? evidence.title;
  return /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

function cite(row: Sourced): string {
  return `${sourceName(row.evidence)}, p.${row.fact.page}`;
}

function byKey(facts: Sourced[], ...keys: string[]): Sourced[] {
  return facts.filter((row) => keys.includes(row.fact.key));
}

function first(facts: Sourced[], ...keys: string[]): Sourced | undefined {
  for (const key of keys) {
    const hit = facts.find((row) => row.fact.key === key);
    if (hit) return hit;
  }
  return undefined;
}

function inr(n: number, currency = 'INR'): string {
  if (currency !== 'INR') return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

const OPEN_FINDING = new Set(['open', 'under_review', 'draft', 'monitoring', 'accepted']);
const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

function openFindings(project: DdProject): FindingRecord[] {
  return project.findings
    .filter((f) => OPEN_FINDING.has(f.status))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function gaps(project: DdProject): EvidenceRecord[] {
  return project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
}

function sourcesOf(rows: Sourced[]): { citedEvidenceIds: string[]; navigate?: FileAnswer['navigate'] } {
  const ids = [...new Set(rows.map((r) => r.evidence.id))];
  const lead = rows[0];
  return {
    citedEvidenceIds: ids,
    navigate: lead ? { pane: 'evidence', evidenceId: lead.evidence.id, page: String(lead.fact.page) } : undefined,
  };
}

function nothingYet(what: string, document: string): string {
  return `Nothing on file states ${what} yet. Drop the ${document} into the chat and I'll read it.`;
}

/* ==================================================================== */
/* Answers                                                               */
/* ==================================================================== */

function answerHelp(): FileAnswer {
  return {
    text: 'I read documents you drop in — deeds, EC, khata, scans too — and propose what to record. Ask me about the property, or tell me what to do. Nothing is written until you approve.',
    summary: 'What I can do',
    citedEvidenceIds: [],
    citedNodeIds: [],
    choices: [
      { id: 'help-samples', label: 'Use the sample documents', detail: 'A synthetic Bengaluru file, read end to end', send: 'Use the sample documents', kind: 'action' },
      { id: 'help-missing', label: 'What documents do I need?', detail: 'The priority pack', send: 'What documents do I need?', kind: 'action' },
      { id: 'help-summary', label: 'Summarise this file', detail: 'Where it stands', send: 'Summarise this file', kind: 'action' },
    ],
  };
}

function answerOwner(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const purchaser = first(facts, 'purchaser');
  const vendor = first(facts, 'vendor');
  const khataOwner = byKey(facts, 'owner');
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (purchaser) {
    const when = first(facts, 'registration_date');
    lines.push(
      `${purchaser.fact.display}${vendor ? `, who bought it from ${vendor.fact.display}` : ''}${when ? ` (registered ${when.fact.display})` : ''} — ${cite(purchaser)}.`,
    );
    used.push(purchaser);
  }
  for (const row of khataOwner) {
    const same = purchaser && row.fact.display.toLowerCase() === purchaser.fact.display.toLowerCase();
    lines.push(same ? `The ${sourceName(row.evidence)} is in the same name (p.${row.fact.page}).` : `The ${sourceName(row.evidence)} names ${row.fact.display} (p.${row.fact.page}).`);
    used.push(row);
  }
  if (!lines.length) return project.developer ? null : { text: nothingYet('who owns the property', 'sale deed or khata'), summary: 'Owner not on file', citedEvidenceIds: [], citedNodeIds: [] };
  if (purchaser && khataOwner.length && khataOwner.some((k) => k.fact.display.toLowerCase() !== purchaser.fact.display.toLowerCase())) {
    lines.push('⚑ The names differ — the khata may not have been mutated after the sale.');
  }
  return { text: lines.join('\n'), summary: 'Owner, from the documents', ...sourcesOf(used), citedNodeIds: [] };
}

function answerExtent(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const rows = byKey(facts, 'extent_title', 'extent_khata', 'extent_survey', 'sanctioned_extent');
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.fact.key) ? false : (seen.add(r.fact.key), true)));
  if (!unique.length) {
    if (project.landAreaSqm) {
      return {
        text: `The project record says ${Math.round(project.landAreaSqm).toLocaleString('en-IN')} sqm, but no document on file states an extent yet. The sale deed and khata will.`,
        summary: 'Extent from the project record',
        citedEvidenceIds: [],
        citedNodeIds: [project.id],
      };
    }
    return { text: nothingYet('the extent', 'sale deed, khata or survey sketch'), summary: 'Extent not on file', citedEvidenceIds: [], citedNodeIds: [] };
  }
  // One line of values, each with its source; the flag, if any, on the next.
  const short: Record<string, string> = { extent_title: 'Title', extent_khata: 'Khata', extent_survey: 'Survey', sanctioned_extent: 'Sanctioned layout' };
  const lines = [unique.map((r) => `${short[r.fact.key] ?? r.fact.label} ${r.fact.display} (${cite(r)})`).join(' · ') + '.'];
  const values = unique.map((r) => Number(r.fact.value)).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length > 1) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const spread = ((max - min) / max) * 100;
    if (spread >= 0.5) lines.push(`⚑ They differ by ${spread.toFixed(1)}% (${Math.round(max - min).toLocaleString('en-IN')} sqm) — reconcile before relying on either.`);
    else lines.push('They agree.');
  }
  return { text: lines.join('\n'), summary: 'Extent, from the documents', ...sourcesOf(unique), citedNodeIds: [] };
}

function answerParcel(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const sy = first(facts, 'survey_numbers');
  const khata = first(facts, 'khata_number');
  const pid = first(facts, 'pid');
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (sy) {
    lines.push(`Survey No. ${sy.fact.value} (${cite(sy)}).`);
    used.push(sy);
  } else if (project.parcelId) {
    lines.push(`The project record gives the parcel as ${project.parcelId}.`);
  }
  if (khata) {
    lines.push(`Khata No. ${khata.fact.display}${pid ? `, PID ${pid.fact.display}` : ''} (${cite(khata)}).`);
    used.push(khata);
  } else if (pid) {
    lines.push(`PID ${pid.fact.display} (${cite(pid)}).`);
    used.push(pid);
  }
  if (!lines.length) return { text: nothingYet('the survey number', 'sale deed or RTC'), summary: 'Parcel not on file', citedEvidenceIds: [], citedNodeIds: [] };
  return { text: lines.join('\n'), summary: 'Parcel, from the documents', ...sourcesOf(used), citedNodeIds: [] };
}

function answerEncumbrance(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const from = first(facts, 'ec_from');
  const to = first(facts, 'ec_to');
  const nil = first(facts, 'ec_nil');
  if (!from && !nil) return null; // no EC on file — the portal routes answer this better
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (from && to) {
    lines.push(`The EC searches ${from.fact.display} to ${to.fact.display} (${cite(from)}).`);
    used.push(from);
  }
  const charges = openFindings(project).filter((f) => /\b(?:mortgage|charge|hypothecation|attachment|lien|encumbr)\b/i.test(f.title));
  if (nil && nil.fact.value === false) {
    lines.push(`It is NOT clean: ${first(facts, 'subsisting_charges')?.fact.display ?? 'at least one'} subsisting charge on record (${cite(nil)}).`);
    used.push(nil);
    for (const f of charges.slice(0, 2)) lines.push(`⚑ ${f.title} — ${f.severity}.`);
    if (!charges.length) lines.push('It is not on the findings register yet — approve the finding card from the EC upload, or say “add a finding”.');
  } else if (nil && nil.fact.value === true) {
    lines.push(`Nil encumbrance for that period (${cite(nil)}).`);
    used.push(nil);
  }
  return { text: lines.join('\n'), summary: 'Encumbrances, from the EC', ...sourcesOf(used), citedNodeIds: charges.slice(0, 2).map((f) => f.id) };
}

function answerConversion(facts: Sourced[]): FileAnswer | null {
  const status = first(facts, 'conversion_status');
  if (!status) return { text: nothingYet('whether the land is converted', 'DC conversion order'), summary: 'Conversion not on file', citedEvidenceIds: [], citedNodeIds: [] };
  const date = first(facts, 'conversion_date');
  const order = first(facts, 'order_number');
  const use = first(facts, 'converted_use');
  const text =
    status.fact.value === 'converted'
      ? `Yes — converted to non-agricultural${use ? ` ${use.fact.display.replace(/^non-agricultural\s*/, '')}` : ''} use${date ? ` by an order dated ${date.fact.display}` : ''}${order ? ` (${order.fact.display})` : ''} — ${cite(status)}.`
      : `No — the order on file leaves it ${status.fact.display} (${cite(status)}).`;
  return { text, summary: 'Conversion, from the DC order', ...sourcesOf([status]), citedNodeIds: [] };
}

function answerZoning(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const zoning = first(facts, 'zoning');
  const far = first(facts, 'permissible_far');
  const plan = first(facts, 'plan_in_force');
  const sanctionedFar = first(facts, 'sanctioned_far');
  if (!zoning && !far) return { text: nothingYet('the zoning', 'zoning certificate'), summary: 'Zoning not on file', citedEvidenceIds: [], citedNodeIds: [] };
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (zoning) {
    lines.push(`${zoning.fact.display}${plan ? ` under the ${plan.fact.display}` : ''} (${cite(zoning)}).`);
    used.push(zoning);
  }
  if (far) {
    lines.push(`Permissible FAR ${far.fact.display}${sanctionedFar ? `; ${sanctionedFar.fact.display} was sanctioned (${cite(sanctionedFar)})` : ''}.`);
    used.push(far);
  }
  if (far && project.landAreaSqm && project.builtUpAreaSqm) {
    const proposed = project.builtUpAreaSqm / project.landAreaSqm;
    if (proposed > Number(far.fact.value) + 0.01) lines.push(`⚑ The project record's built-up works out to FAR ${proposed.toFixed(2)} — above what is permissible.`);
  }
  return { text: lines.join('\n'), summary: 'Zoning, from the certificate', ...sourcesOf(used), citedNodeIds: [] };
}

function answerSanction(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const date = first(facts, 'sanction_date');
  const area = first(facts, 'sanctioned_area');
  const far = first(facts, 'sanctioned_far');
  const number = first(facts, 'sanction_number');
  const oc = first(facts, 'oc_issued');
  if (!date && !area && !oc) return { text: nothingYet('a building sanction', 'sanctioned plan'), summary: 'Sanction not on file', citedEvidenceIds: [], citedNodeIds: [] };
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (date || area) {
    const lead = (date ?? area)!;
    lines.push(`Sanctioned${date ? ` on ${date.fact.display}` : ''}${number ? ` (${number.fact.display})` : ''}${area ? ` for ${area.fact.display} built-up` : ''}${far ? `, FAR ${far.fact.display}` : ''} — ${cite(lead)}.`);
    used.push(lead);
  }
  if (area && project.builtUpAreaSqm && project.builtUpAreaSqm > Number(area.fact.value) * 1.05) {
    lines.push(`⚑ The project record's built-up (${Math.round(project.builtUpAreaSqm).toLocaleString('en-IN')} sqm) is ${Math.round((project.builtUpAreaSqm / Number(area.fact.value) - 1) * 100)}% above the sanction.`);
  }
  if (oc) {
    lines.push(`Occupancy certificate: ${oc.fact.display} (${cite(oc)}).`);
    used.push(oc);
  }
  return { text: lines.join('\n'), summary: 'Sanction, from the documents', ...sourcesOf(used), citedNodeIds: [] };
}

function answerTax(facts: Sourced[]): FileAnswer | null {
  const paid = first(facts, 'tax_paid');
  const year = first(facts, 'tax_year');
  const khataType = first(facts, 'khata_type');
  if (!paid && !khataType) return { text: nothingYet('the tax or khata position', 'property tax receipt or khata'), summary: 'Tax not on file', citedEvidenceIds: [], citedNodeIds: [] };
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (paid) {
    const on = first(facts, 'tax_paid_on');
    lines.push(`Property tax ${paid.fact.display} paid${year ? ` for ${year.fact.display}` : ''}${on ? ` on ${on.fact.display}` : ''} (${cite(paid)}).`);
    used.push(paid);
  }
  if (khataType) {
    lines.push(`${khataType.fact.display} (${cite(khataType)}).`);
    used.push(khataType);
  }
  return { text: lines.join('\n'), summary: 'Tax and khata, from the documents', ...sourcesOf(used), citedNodeIds: [] };
}

function answerTitle(facts: Sourced[]): FileAnswer | null {
  const root = first(facts, 'root_year');
  const reg = first(facts, 'registration_date');
  const origin = first(facts, 'title_origin');
  if (!root && !reg) return { text: nothingYet('the title chain', 'sale deed and mother deed'), summary: 'Title not on file', citedEvidenceIds: [], citedNodeIds: [] };
  const lines: string[] = [];
  const used: Sourced[] = [];
  if (root) {
    const years = Math.floor((Date.now() - Date.parse(String(root.fact.value))) / (365.25 * 86400000));
    lines.push(`Root of title ${root.fact.display}${origin ? `, where title arose by ${origin.fact.display}` : ''} — ${years} years of chain (${cite(root)}).`);
    used.push(root);
    if (years < 30) lines.push(`⚑ Short of the usual 30 years in Karnataka.`);
  }
  if (reg) {
    const doc = first(facts, 'document_number');
    lines.push(`Latest conveyance registered ${reg.fact.display}${doc ? ` as ${doc.fact.display}` : ''} (${cite(reg)}).`);
    used.push(reg);
  }
  return { text: lines.join('\n'), summary: 'Title chain, from the deeds', ...sourcesOf(used), citedNodeIds: [] };
}

function answerValue(project: DdProject, facts: Sourced[]): FileAnswer | null {
  const run = [...project.valuationRuns].filter((r) => r.status !== 'superseded').at(-1);
  const screen = project.lastScreen;
  const paid = first(facts, 'consideration');
  const lines: string[] = [];
  if (screen?.indicatedMid) {
    const cur = screen.currency ?? 'INR';
    lines.push(
      `Indicative ${inr(screen.indicatedMid, cur)}${screen.indicatedLow && screen.indicatedHigh ? ` (range ${inr(screen.indicatedLow, cur)}–${inr(screen.indicatedHigh, cur)})` : ''}${screen.confidenceScore !== undefined ? `, confidence ${Math.round(screen.confidenceScore * (screen.confidenceScore <= 1 ? 100 : 1))}%` : ''}.`,
    );
  } else if (run && run.indicatedValue > 0) {
    lines.push(`Indicative ${inr(run.indicatedValue, run.currency)} (range ${inr(run.low, run.currency)}–${inr(run.high, run.currency)}).`);
  }
  const hasValue = lines.length > 0;
  if (!hasValue) lines.push('No indicative value yet — say “run the property screen” and I’ll work one out from what is on file.');
  if (paid) lines.push(`It last changed hands for ${paid.fact.display} (${cite(paid)}).`);
  if (hasValue) lines.push('Indicative only — not an IBBI-registered valuation.');
  return { text: lines.join('\n'), summary: 'Value', citedEvidenceIds: paid ? [paid.evidence.id] : [], citedNodeIds: [], navigate: { pane: 'valuation' } };
}

function joinTitles(titles: string[], budget = 170): string {
  const out: string[] = [];
  let used = 0;
  for (const t of titles) {
    if (used + t.length + 2 > budget && out.length) break;
    out.push(t);
    used += t.length + 2;
  }
  const rest = titles.length - out.length;
  return `${out.join('; ')}${rest ? `; and ${rest} more` : ''}`;
}

function answerFindings(project: DdProject, question: string): FileAnswer {
  const wanted = SEVERITY_ORDER.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(question));
  const open = openFindings(project).filter((f) => !wanted.length || wanted.includes(f.severity));
  const kind = wanted.length ? `${wanted.join('/')} ` : '';
  if (!open.length) {
    return { text: `No open ${kind}findings.`, summary: 'Findings', citedEvidenceIds: [], citedNodeIds: [], navigate: { pane: 'findings' } };
  }
  const titles = open.map((f) => (wanted.length === 1 ? f.title : `${f.title} (${f.severity})`));
  return {
    text: `${plural(open.length, `open ${kind}finding`)}: ${joinTitles(titles)}.\nThe register is open on the right.`,
    summary: 'Findings',
    citedEvidenceIds: [],
    citedNodeIds: open.slice(0, 5).map((f) => f.id),
    navigate: { pane: 'findings' },
  };
}

function answerRisks(project: DdProject): FileAnswer {
  const open = project.risks.filter((r) => r.status !== 'closed');
  if (!open.length) return { text: 'No open risks on the register.', summary: 'Risks', citedEvidenceIds: [], citedNodeIds: [], navigate: { pane: 'risks' } };
  return {
    text: `${plural(open.length, 'open risk')}: ${joinTitles(open.map((r) => r.title))}.\nThe register is open on the right.`,
    summary: 'Risks',
    citedEvidenceIds: [],
    citedNodeIds: open.slice(0, 5).map((r) => r.id),
    navigate: { pane: 'risks' },
  };
}

function answerActions(project: DdProject): FileAnswer {
  const open = project.actions.filter((a) => a.status !== 'closed');
  if (!open.length) return { text: 'No open actions.', summary: 'Actions', citedEvidenceIds: [], citedNodeIds: [], navigate: { pane: 'actions' } };
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((a) => a.status === 'overdue' || (a.dueDate && a.dueDate < today));
  const ordered = [...overdue, ...open.filter((a) => !overdue.includes(a))];
  return {
    text: `${plural(open.length, 'open action')}${overdue.length ? `, ${overdue.length} overdue` : ''}: ${joinTitles(ordered.map((a) => a.title))}.`,
    summary: 'Actions',
    citedEvidenceIds: [],
    citedNodeIds: ordered.slice(0, 5).map((a) => a.id),
    navigate: { pane: 'actions' },
  };
}

/**
 * What is still outstanding, most important first.
 *
 * A started DD seeds dozens of expected documents, and the first few of
 * ninety in register order is not an answer to "what's missing". The priority
 * pack — title, survey, sanction and the rest of the core — leads; the long
 * tail is a count, and the register on the right has every row.
 */
function answerMissing(project: DdProject): FileAnswer {
  const open = gaps(project);
  if (!open.length) return { text: 'Nothing is outstanding on the evidence register.', summary: 'Gaps', citedEvidenceIds: [], citedNodeIds: [], navigate: { pane: 'evidence' } };
  const pack = packCompleteness(project);
  const titled = pack.missingTitles.map((t) => t.replace(/\bnoc\b/gi, 'NOC').replace(/^./, (c) => c.toUpperCase()));
  const lead = pack.missing ? `${pack.missing} of ${pack.total} priority items missing: ${joinTitles(titled, 150)}.` : `${plural(open.length, 'document')} outstanding: ${joinTitles(open.map((e) => e.title), 150)}.`;
  const tail = pack.missing ? open.length - pack.missing : 0;
  return {
    text: `${lead}${tail > 0 ? `\nPlus ${tail} other expected documents.` : ''}\nDrop any into the chat and I’ll read and file it.`,
    summary: 'Evidence gaps',
    citedEvidenceIds: open.filter((e) => pack.missingTitles.includes(e.title)).slice(0, 6).map((e) => e.id),
    citedNodeIds: [],
    navigate: { pane: 'evidence' },
  };
}

function answerDocuments(project: DdProject): FileAnswer {
  const filed = project.evidence.filter((e) => e.attachments.length);
  if (!filed.length) return { text: 'No documents filed yet. Drop them into the chat — PDFs, scans or photos — or say “use the sample documents”.', summary: 'Documents', citedEvidenceIds: [], citedNodeIds: [], navigate: { pane: 'evidence' } };
  return {
    text: `${plural(filed.length, 'document')} on file: ${joinTitles(filed.map((e) => `${e.documentType ?? e.title}${e.readMethod === 'ocr' ? ' (scan)' : ''}`))}.`,
    summary: 'Documents on file',
    citedEvidenceIds: filed.slice(0, 8).map((e) => e.id),
    citedNodeIds: [],
    navigate: { pane: 'evidence' },
  };
}

function answerSummary(project: DdProject, facts: Sourced[]): FileAnswer {
  const lines: string[] = [];
  const sy = first(facts, 'survey_numbers');
  const owner = first(facts, 'purchaser', 'owner');
  const extent = first(facts, 'extent_title', 'extent_khata');
  const who = [owner?.fact.display, sy ? `Sy. No. ${sy.fact.value}` : project.parcelId, extent?.fact.display].filter(Boolean);
  lines.push(`${project.name}${who.length ? ` — ${who.join(', ')}` : ''}.`);
  const screen = project.lastScreen;
  if (screen?.indicatedMid) lines.push(`Indicative value ${inr(screen.indicatedMid, screen.currency ?? 'INR')}.`);
  const open = openFindings(project);
  const material = open.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (open.length) lines.push(`${plural(open.length, 'open finding')}${material.length ? `, ${material.length} material — worst: ${material[0]!.title}` : ''}.`);
  const outstanding = gaps(project).length;
  const filed = project.evidence.filter((e) => e.attachments.length).length;
  lines.push(`${plural(filed, 'document')} filed${outstanding ? `, ${outstanding} still outstanding` : ''}.`);
  return {
    text: lines.join('\n'),
    summary: 'Where the file stands',
    citedEvidenceIds: [],
    citedNodeIds: material.slice(0, 2).map((f) => f.id),
    navigate: { pane: 'overview' },
  };
}

/**
 * The answer to a factual question, from the file, or null.
 *
 * Null means "not a question this can ground" — the caller carries on down
 * its own routes (connectors, the copilot, the next step) rather than being
 * handed a near miss.
 */
/**
 * The house style: four lines at most. The detail belongs in the pane the
 * answer opens, not in a paragraph above it.
 */
function fit(answer: FileAnswer | null): FileAnswer | null {
  if (!answer) return null;
  const lines = answer.text.split('\n').filter((l) => l.trim());
  if (lines.length <= 4) return answer;
  return { ...answer, text: [...lines.slice(0, 3), lines.slice(3).join(' ')].join('\n') };
}

export function answerFromFile(project: DdProject, question: string): FileAnswer | null {
  return fit(answerFromFileUnfitted(project, question));
}

/**
 * "What is the biggest risk?" — answered only when the register settles it.
 *
 * Ranking several material items against each other is judgement, and stays
 * with the copilot or a follow-up question. But when exactly one material
 * item is open, or none is, the register's own severities already answer it,
 * and "I could not answer that" would be a failure to read the file.
 */
function answerSuperlative(project: DdProject, q: string): FileAnswer | null {
  if (!SUPERLATIVE.test(q) || JUDGEMENT.test(q)) return null;
  const findings = openFindings(project).filter((f) => f.severity === 'critical' || f.severity === 'high');
  const risks = project.risks.filter((r) => r.status !== 'closed' && r.materiality === 'high');
  const material = findings.length + risks.length;
  if (material > 1) return null;
  if (material === 0) {
    return { text: 'Nothing material is open — no critical or high finding, and no high risk.', summary: 'Most serious item', citedEvidenceIds: [], citedNodeIds: [], navigate: { pane: 'findings' } };
  }
  const f = findings[0];
  if (f) {
    return {
      text: `The ${f.severity} finding “${f.title}” — the only material item open.${f.evidenceIds.length ? '' : ' Nothing on file stands behind it yet.'}`,
      summary: 'Most serious item',
      citedEvidenceIds: f.evidenceIds.slice(0, 2),
      citedNodeIds: [f.id],
      navigate: { pane: 'findings' },
    };
  }
  const r = risks[0]!;
  return { text: `The high risk “${r.title}” — the only material item open.`, summary: 'Most serious item', citedEvidenceIds: [], citedNodeIds: [r.id], navigate: { pane: 'risks' } };
}

function answerFromFileUnfitted(project: DdProject, question: string): FileAnswer | null {
  const q = question.trim();
  const top = answerSuperlative(project, q);
  if (top) return top;
  if (!looksLikeFileQuestion(q)) return null;
  const topics = topicsOf(q);
  const facts = factsOnFile(project);
  for (const topic of topics) {
    switch (topic) {
      case 'help':
        return answerHelp();
      case 'greeting':
        return { ...answerHelp(), text: `Hello. ${answerHelp().text}`, summary: 'Hello' };
      case 'thanks':
        return { text: 'Anytime.', summary: 'Thanks', citedEvidenceIds: [], citedNodeIds: [] };
      case 'summary':
        return answerSummary(project, facts);
      case 'owner': {
        const a = answerOwner(project, facts);
        if (a) return a;
        break;
      }
      case 'extent':
        return answerExtent(project, facts);
      case 'parcel':
        return answerParcel(project, facts);
      case 'encumbrance': {
        const a = answerEncumbrance(project, facts);
        if (a) return a;
        return null;
      }
      case 'conversion':
        return answerConversion(facts);
      case 'zoning':
        return answerZoning(project, facts);
      case 'sanction':
        return answerSanction(project, facts);
      case 'tax':
        return answerTax(facts);
      case 'title':
        return answerTitle(facts);
      case 'value':
        return answerValue(project, facts);
      case 'findings':
        return answerFindings(project, q);
      case 'risks':
        return answerRisks(project);
      case 'actions':
        return answerActions(project);
      case 'missing':
        return answerMissing(project);
      case 'documents':
        return answerDocuments(project);
    }
  }
  return null;
}
