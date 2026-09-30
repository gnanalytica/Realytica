/**
 * Reading a property document without a model.
 *
 * This takes the text of a document — from its text layer, or from OCR when
 * it is a scan — and says what it is and what it states, the way a paralegal
 * would on a first read: this is a sale deed, registered on this date, for
 * this survey number and this extent, between these parties. Every statement
 * carries the page it came from and the words it came from, so nothing here
 * is a paraphrase a person has to take on trust.
 *
 * Deliberately narrow. It knows the Karnataka instruments a land diligence
 * turns on — deeds, the EC, khata, tax receipts, zoning, conversion,
 * sanction, survey sketch, OC — and the phrasing registries and the BBMP
 * actually use. It does not guess: a value it cannot find is absent, never a
 * default. A model, where one is configured, reads more; this is the floor
 * that works on every deployment, including one with no credentials.
 *
 * What it produces is a proposal, not a record. Facts reach a check only
 * through a card a person approves.
 */

import type { DocumentKind } from '../types';
import type { EvidenceKind, FindingSeverity, ScopeKey } from './types';

/* ==================================================================== */
/* Types                                                                 */
/* ==================================================================== */

export type ReadDocumentType =
  | 'sale_deed'
  | 'mother_deed'
  | 'encumbrance_certificate'
  | 'khata'
  | 'property_tax_receipt'
  | 'zoning_certificate'
  | 'conversion_order'
  | 'building_sanction'
  | 'survey_sketch'
  | 'occupancy_certificate'
  | 'commencement_certificate'
  | 'rtc'
  | 'joint_development_agreement'
  | 'sale_agreement'
  | 'lease'
  | 'other';

/** One thing a document states, with where it states it. */
export interface DocumentFact {
  /**
   * A check-field key where one exists (`extent_title`, `ec_from`…), so the
   * fact can be proposed straight onto a check; otherwise a document-level
   * key (`consideration`, `document_number`…) that is still worth quoting.
   */
  key: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
  /** How a person would say it: "12,000 sqm", "12 Mar 2019", "yes". */
  display: string;
  /** 1-based page the words are on. */
  page: number;
  /** The words themselves, clipped at a sentence. Never rewritten. */
  quote: string;
  /**
   * The value exactly as the page writes it, when the page is not in English:
   * a Kannada owner's name beside its transliteration. Never instead of
   * `value`, because two Kannada names can romanise identically and the
   * register a lawyer checks holds the original.
   */
  originalValue?: string;
  originalScript?: import('../script').DocScript;
  /** Who read it: this server's parser, or a model whose page was verified. */
  source?: 'parser' | 'model';
}

/** Something a first read should raise, with the words that raise it. */
export interface DocumentFlag {
  severity: FindingSeverity;
  title: string;
  description: string;
  page: number;
  quote: string;
}

export interface ParsedDocument {
  type: ReadDocumentType;
  /** "Sale deed", "Encumbrance certificate". */
  label: string;
  /** The nearest kind in the shared vocabulary; `other` when there is none. */
  documentKind: DocumentKind;
  evidenceKind: EvidenceKind;
  /** 0..1 — how sure the classification is. Below ~0.35 it is a guess. */
  confidence: number;
  facts: DocumentFact[];
  flags: DocumentFlag[];
  /** One line a person can read on a card. */
  summary: string;
  /** Words an expected-evidence row for this document tends to carry. */
  rowHints: string[];
  scopes: ScopeKey[];
  pages: number;
}

/* ==================================================================== */
/* What each document is                                                 */
/* ==================================================================== */

interface TypeProfile {
  label: string;
  documentKind: DocumentKind;
  evidenceKind: EvidenceKind;
  rowHints: string[];
  scopes: ScopeKey[];
  /** Phrases that name the document — weighted heavily near the top. */
  title: RegExp[];
  /** Phrases that only this kind of document tends to use. */
  body: RegExp[];
  file: RegExp[];
}

const PROFILES: Record<Exclude<ReadDocumentType, 'other'>, TypeProfile> = {
  sale_deed: {
    label: 'Sale deed',
    documentKind: 'title_deed',
    evidenceKind: 'document',
    rowHints: ['sale deed', 'registered conveyance', 'title extract', 'conveyance', 'title deed'],
    scopes: ['legal', 'land_site'],
    title: [/\b(?:absolute\s+)?sale\s+deed\b/i, /\bdeed\s+of\s+(?:absolute\s+)?sale\b/i, /\bconveyance\s+deed\b/i],
    body: [/\bvendor\b/i, /\bpurchaser\b/i, /\bschedule\s+property\b/i, /\bsale\s+consideration\b/i, /\bhereby\s+(?:conveys|sells|transfers)\b/i],
    file: [/sale[\s_-]*deed/i, /conveyance/i],
  },
  mother_deed: {
    label: 'Mother deed',
    documentKind: 'mother_deed',
    evidenceKind: 'document',
    rowHints: ['mother deed', 'title chain', 'root of title', 'earlier deed'],
    scopes: ['legal'],
    title: [/\bmother\s+deed\b/i, /\bpartition\s+deed\b/i, /\bgift\s+deed\b/i, /\bsettlement\s+deed\b/i],
    body: [/\binherit(?:ed|ance)\b/i, /\bmutation\s+register\b/i, /\bM\.?R\.?\s*No\b/i, /\bancestral\b/i],
    file: [/mother/i, /partition/i, /gift[\s_-]*deed/i],
  },
  encumbrance_certificate: {
    label: 'Encumbrance certificate',
    documentKind: 'encumbrance_certificate',
    evidenceKind: 'certificate',
    rowHints: ['encumbrance certificate', 'encumbrance', 'form 15', 'form 16'],
    scopes: ['legal'],
    title: [/\bencumbrance\s+certificate\b/i, /\bform\s*(?:no\.?)?\s*1[56]\b/i],
    body: [/\bperiod\s+of\s+search\b/i, /\bacts\s+and\s+encumbrances\b/i, /\bno\s+encumbrances?\b/i, /\bnil\s+encumbrance\b/i],
    file: [/encumbrance/i, /\bEC[\s_-]/i, /form[\s_-]*1[56]/i],
  },
  khata: {
    label: 'Khata certificate and extract',
    documentKind: 'khata_extract',
    evidenceKind: 'certificate',
    rowHints: ['khata', 'khata extract', 'khata certificate'],
    scopes: ['legal', 'regulatory'],
    title: [/\bkhata\s+(?:certificate|extract)\b/i, /\b[abe]-?\s?khata\b/i],
    body: [/\bkhata\s+no\b/i, /\bform\s+a\s+register\b/i, /\bkhata\s+register\b/i, /\bassistant\s+revenue\s+officer\b/i],
    file: [/khata/i, /katha/i],
  },
  property_tax_receipt: {
    label: 'Property tax receipt',
    documentKind: 'property_tax_receipt',
    evidenceKind: 'document',
    rowHints: ['property tax', 'tax paid receipt', 'tax receipt', 'sas number'],
    scopes: ['legal', 'financial_appraisal'],
    title: [/\bproperty\s+tax\b.*\breceipt\b/i, /\btax\s+payment\s+receipt\b/i, /\bself[\s-]assessment\s+scheme\b/i],
    body: [/\bSAS\s+application\b/i, /\bassessment\s+year\b/i, /\bamount\s+paid\b/i, /\btransaction\s+reference\b/i],
    file: [/tax[\s_-]*(?:paid|receipt)/i, /\bSAS\b/i, /property[\s_-]*tax/i],
  },
  zoning_certificate: {
    label: 'Zoning certificate',
    documentKind: 'other',
    evidenceKind: 'certificate',
    rowHints: ['zoning certificate', 'zoning', 'master plan', 'land use', 'rmp'],
    scopes: ['regulatory', 'land_site'],
    title: [/\bzoning\s+certificate\b/i, /\bland\s+use\s+certificate\b/i],
    body: [/\brevised\s+master\s+plan\b/i, /\bland\s+use\b/i, /\bpermissible\s+FAR\b/i, /\bplanning\s+district\b/i, /\bplan\s+in\s+force\b/i],
    file: [/zoning/i, /master[\s_-]*plan/i, /\bRMP\b/i, /land[\s_-]*use/i],
  },
  conversion_order: {
    label: 'DC conversion order',
    documentKind: 'conversion_certificate',
    evidenceKind: 'approval',
    rowHints: ['conversion', 'dc conversion', 'land conversion', 'non-agricultural'],
    scopes: ['regulatory', 'legal'],
    title: [/\bconversion\s+(?:order|certificate)\b/i, /\bofficial\s+memorandum\b/i],
    body: [/\bnon[\s-]agricultural\b/i, /\bsection\s+95\b/i, /\bdeputy\s+commissioner\b/i, /\bconversion\s+fine\b/i, /\bpermission\s+is\s+hereby\s+granted\s+to\s+convert\b/i],
    file: [/conversion/i, /\bDC[\s_-]/i, /\bALN\b/i],
  },
  building_sanction: {
    label: 'Sanctioned building plan',
    documentKind: 'sanctioned_plan_bbmp',
    evidenceKind: 'approval',
    rowHints: ['sanctioned plan', 'building plan', 'sanctioned layout', 'plan sanction', 'sanction drawings'],
    scopes: ['regulatory', 'technical'],
    title: [/\bbuilding\s+plan\s+sanction\b/i, /\bplan\s+sanction\b/i, /\bsanctioned\s+plan\b/i, /\bbuilding\s+licen[cs]e\b/i],
    body: [/\bLP\s+No\b/i, /\bsanctioned\s+built[\s-]?up\b/i, /\bdate\s+of\s+sanction\b/i, /\bFAR\s+sanctioned\b/i, /\bground\s+coverage\b/i],
    file: [/sanction/i, /building[\s_-]*plan/i, /\bLP[\s_-]/i],
  },
  survey_sketch: {
    label: 'Survey sketch',
    documentKind: 'other',
    evidenceKind: 'gis',
    rowHints: ['survey sketch', 'survey plan', 'hissa', '11e'],
    scopes: ['land_site'],
    title: [/\bsurvey\s+sketch\b/i, /\bhissa\b/i, /\b11\s?E\b/, /\btippan\b/i],
    body: [/\blicensed\s+surveyor\b/i, /\bsurvey,?\s+settlement\s+and\s+land\s+records\b/i, /\bmeasured\s+on\s+the\s+ground\b/i],
    file: [/survey[\s_-]*sketch/i, /hissa/i, /\b11E\b/i, /tippan/i],
  },
  occupancy_certificate: {
    label: 'Occupancy certificate',
    documentKind: 'occupancy_certificate',
    evidenceKind: 'approval',
    rowHints: ['occupancy certificate', 'oc', 'cc / oc'],
    scopes: ['regulatory'],
    title: [/\boccupancy\s+certificate\b/i],
    body: [/\bfit\s+for\s+occupation\b/i, /\boccupancy\s+certificate\s+is\s+(?:hereby\s+)?(?:issued|granted)\b/i],
    file: [/occupancy/i, /\bOC[\s_-]/],
  },
  commencement_certificate: {
    label: 'Commencement certificate',
    documentKind: 'commencement_certificate',
    evidenceKind: 'approval',
    rowHints: ['commencement certificate', 'cc / oc', 'commencement'],
    scopes: ['regulatory'],
    title: [/\bcommencement\s+certificate\b/i],
    body: [/\bcommence\s+(?:the\s+)?construction\b/i],
    file: [/commencement/i, /\bCC[\s_-]/],
  },
  rtc: {
    label: 'RTC (record of rights)',
    documentKind: 'other',
    evidenceKind: 'document',
    rowHints: ['rtc', 'record of rights', 'pahani', 'title extract'],
    scopes: ['legal', 'land_site'],
    title: [/\brecord\s+of\s+rights\b/i, /\bpahani\b/i, /\bRTC\b/],
    body: [/\btenancy\s+and\s+crops\b/i, /\bcultivator\b/i],
    file: [/\bRTC\b/i, /pahani/i],
  },
  joint_development_agreement: {
    label: 'Joint development agreement',
    documentKind: 'joint_development_agreement',
    evidenceKind: 'contract',
    rowHints: ['jda', 'joint development', 'jv/jda', 'contracts'],
    scopes: ['legal', 'commercial_market'],
    title: [/\bjoint\s+development\s+agreement\b/i],
    body: [/\bowner'?s?\s+share\b/i, /\bdeveloper'?s?\s+share\b/i, /\bsharing\s+ratio\b/i],
    file: [/\bJDA\b/i, /joint[\s_-]*development/i],
  },
  sale_agreement: {
    label: 'Agreement to sell',
    documentKind: 'sale_agreement',
    evidenceKind: 'contract',
    rowHints: ['agreement to sell', 'sale agreement', 'contracts'],
    scopes: ['legal'],
    title: [/\bagreement\s+(?:to|for)\s+sale\b/i, /\bagreement\s+to\s+sell\b/i, /\bsale\s+agreement\b/i],
    body: [/\badvance\s+(?:amount|paid)\b/i, /\bbalance\s+(?:sale\s+)?consideration\b/i],
    file: [/agreement[\s_-]*(?:to[\s_-]*)?sel/i, /sale[\s_-]*agreement/i],
  },
  lease: {
    label: 'Lease deed',
    documentKind: 'lease_agreement',
    evidenceKind: 'contract',
    rowHints: ['lease', 'tenancy', 'rent roll'],
    scopes: ['legal', 'commercial_market'],
    title: [/\blease\s+(?:deed|agreement)\b/i, /\bleave\s+and\s+licen[cs]e\b/i],
    body: [/\blessor\b/i, /\blessee\b/i, /\bmonthly\s+rent\b/i],
    file: [/lease/i, /rental/i],
  },
};

const OTHER: Omit<TypeProfile, 'title' | 'body' | 'file'> = {
  label: 'Document',
  documentKind: 'other',
  evidenceKind: 'document',
  rowHints: [],
  scopes: [],
};

/* ==================================================================== */
/* Text helpers                                                          */
/* ==================================================================== */

/** OCR and text layers both break words and spacing; read through that. */
function normalise(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n');
}

/** The sentence around a match, clipped, never paraphrased. */
function quoteAround(text: string, index: number, length: number, max = 200): string {
  const flat = text;
  let start = index;
  let end = index + length;
  while (start > 0 && !/[.\n]/.test(flat[start - 1]!) && index - start < 160) start -= 1;
  while (end < flat.length && !/[\n]/.test(flat[end]!) && !(flat[end] === '.' && /\s/.test(flat[end + 1] ?? ' ') && !/\d/.test(flat[end - 1] ?? '')) && end - index < 220) end += 1;
  if (flat[end] === '.') end += 1;
  let quote = flat.slice(start, end).replace(/\s+/g, ' ').trim();
  if (quote.length > max) {
    // Keep the match itself visible when the sentence is long.
    const rel = index - start;
    const from = Math.max(0, Math.min(rel - 60, quote.length - max));
    quote = `${from > 0 ? '…' : ''}${quote.slice(from, from + max).trim()}${from + max < quote.length ? '…' : ''}`;
  }
  return quote;
}

interface Hit {
  page: number;
  match: RegExpExecArray;
  quote: string;
}

/** First page (in order) where the pattern matches, with the quote. */
function find(pages: string[], pattern: RegExp): Hit | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  for (let i = 0; i < pages.length; i += 1) {
    const re = new RegExp(pattern.source, flags);
    const match = re.exec(pages[i]!);
    if (match) return { page: i + 1, match, quote: quoteAround(pages[i]!, match.index, match[0].length) };
  }
  return null;
}

/**
 * Last page and position where the pattern matches.
 *
 * A deed recites the instruments before it — "registered as Document No.
 * 2217/1998-99 in the office of the Sub-Registrar, Varthur" — and then, at
 * its end, its own registration. The first match is the predecessor; the
 * deed's own particulars are the last.
 */
function findLast(pages: string[], pattern: RegExp): Hit | null {
  const all = findAll(pages, pattern);
  return all.length ? all[all.length - 1]! : null;
}

function findAll(pages: string[], pattern: RegExp): Hit[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const hits: Hit[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(pages[i]!))) {
      hits.push({ page: i + 1, match, quote: quoteAround(pages[i]!, match.index, match[0].length) });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return hits;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const DATE_SOURCE =
  String.raw`(\d{1,2})(?:st|nd|rd|th)?[\s./-]+(?:day\s+of\s+)?([A-Za-z]{3,9}|\d{1,2})[\s.,/-]+(\d{4})` +
  String.raw`|(\d{4})-(\d{2})-(\d{2})`;

/** A date as written in an Indian instrument, as YYYY-MM-DD. */
export function parseIndianDate(raw: string): string | null {
  const m = new RegExp(`^(?:${DATE_SOURCE})$`, 'i').exec(raw.trim().replace(/,$/, ''));
  if (!m) return null;
  let d: number;
  let mo: number;
  let y: number;
  if (m[4]) {
    y = Number(m[4]);
    mo = Number(m[5]);
    d = Number(m[6]);
  } else {
    d = Number(m[1]);
    const month = m[2]!.toLowerCase();
    mo = /^\d+$/.test(month) ? Number(month) : MONTHS[month] ?? 0;
    y = Number(m[3]);
  }
  if (!mo || mo > 12 || !d || d > 31 || y < 1800 || y > 2200) return null;
  // Date.parse accepts 31 February and quietly means 2 March; a day that
  // does not exist in its month is refused, not rolled over.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DATE = `(?:${DATE_SOURCE})`;

function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m ?? 1) - 1];
  return `${d} ${month} ${y}`;
}

/** "42,00,00,000" → 420000000. Indian grouping and international both. */
function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function displayInr(n: number): string {
  if (n >= 1e7) return `Rs ${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (n >= 1e5) return `Rs ${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh`;
  return `Rs ${n.toLocaleString('en-IN')}`;
}

const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_GUNTA = 101.17141056;
const SQM_PER_SQFT = 0.09290304;

/** An area phrase to square metres, or null. Understands acres and guntas. */
function areaToSqm(value: string, unit: string): number | null {
  const n = parseAmount(value);
  if (n === null) return null;
  const u = unit.toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:square\s*met(?:re|er)s?|sq\.?\s*m(?:trs?|eters?|etres?)?\.?|sqm|m2|m²)$/.test(u)) return n;
  if (/^(?:square\s*f(?:ee|oo)t|sq\.?\s*ft\.?|sft)$/.test(u)) return Math.round(n * SQM_PER_SQFT * 100) / 100;
  if (/^acres?$/.test(u)) return Math.round(n * SQM_PER_ACRE);
  if (/^hectares?$|^ha$/.test(u)) return n * 10000;
  return null;
}

const AREA_UNIT = String.raw`(square\s*met(?:re|er)s?|sq\.?\s*m(?:trs?|eters?|etres?)?\.?|sqm|m2|m²|square\s*f(?:ee|oo)t|sq\.?\s*ft\.?|sft|acres?|hectares?)`;
const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;

function fmtSqm(n: number): string {
  return `${Math.round(n).toLocaleString('en-IN')} sqm`;
}

/* ==================================================================== */
/* Classification                                                        */
/* ==================================================================== */

function classify(pages: string[], fileName: string): { type: ReadDocumentType; confidence: number } {
  const full = pages.join('\n');
  // The top of the first page is where a document says what it is.
  const head = (pages[0] ?? '').slice(0, 500);
  const scores: Array<[ReadDocumentType, number]> = [];
  for (const [type, profile] of Object.entries(PROFILES) as Array<[Exclude<ReadDocumentType, 'other'>, TypeProfile]>) {
    let score = 0;
    for (const re of profile.title) {
      if (re.test(head)) score += 6;
      else if (re.test(full)) score += 2;
    }
    for (const re of profile.body) if (re.test(full)) score += 1.5;
    for (const re of profile.file) if (re.test(fileName)) score += 2;
    scores.push([type, score]);
  }

  // A deed that says how its vendor came to own the land — by inheritance,
  // by a mutation entry — is the root of the chain, not the conveyance the
  // file is about. The 2019 deed recites its 1998 predecessor and must not be
  // mistaken for it, so the tell has to be in how title arose, not a date.
  const deed = scores.find(([t]) => t === 'sale_deed')!;
  const mother = scores.find(([t]) => t === 'mother_deed')!;
  if (mother[1] > 0 && deed[1] > 0) mother[1] += deed[1] * 0.5;

  scores.sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = scores[0]!;
  const second = scores[1]?.[1] ?? 0;
  if (bestScore < 3) return { type: 'other', confidence: 0 };
  // Confidence rises with the score and with the margin over the runner-up.
  const confidence = Math.max(0.2, Math.min(0.97, 0.35 + bestScore / 30 + (bestScore - second) / 25));
  return { type: best, confidence: Math.round(confidence * 100) / 100 };
}

/* ==================================================================== */
/* Facts common to most instruments                                      */
/* ==================================================================== */

/**
 * The survey number the document is ABOUT.
 *
 * A deed names four or five: its own, and its neighbours in the boundary
 * schedule. The parcel is the one repeated; a neighbour is named once. Where
 * counts tie, the first one mentioned wins, which is the schedule's own.
 */
function surveyNumber(pages: string[]): Hit & { value: string } | null {
  const re = /\b(?:Sy\.?|Survey|S\.)\s*(?:No\.?|Nos\.?|Number)?\s*[:.]?\s*(\d{1,4}(?:\/[0-9A-Z]{1,4}){0,3})(?![\d/])/gi;
  const hits = findAll(pages, re);
  if (!hits.length) return null;
  const counts = new Map<string, { n: number; first: Hit }>();
  for (const hit of hits) {
    const value = hit.match[1]!.toUpperCase();
    const entry = counts.get(value);
    if (entry) entry.n += 1;
    else counts.set(value, { n: 1, first: hit });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const [value, { first }] = ranked[0]!;
  return { ...first, value };
}

function extent(pages: string[], lead: RegExp): (Hit & { sqm: number }) | null {
  const re = new RegExp(`${lead.source}[^\\d\\n]{0,40}?${NUMBER}\\s*${AREA_UNIT}`, 'i');
  const hit = find(pages, re);
  if (!hit) return null;
  const groups = hit.match.slice(1).filter((g) => g !== undefined);
  const unit = groups[groups.length - 1]!;
  const value = groups[groups.length - 2]!;
  const sqm = areaToSqm(value, unit);
  return sqm === null ? null : { ...hit, sqm };
}

function acresGuntas(pages: string[]): (Hit & { sqm: number }) | null {
  const hit = find(pages, /(\d+)\s*acres?\s*(?:and\s+)?(\d+(?:\.\d+)?)\s*guntas?/i);
  if (!hit) return null;
  const sqm = Number(hit.match[1]) * SQM_PER_ACRE + Number(hit.match[2]) * SQM_PER_GUNTA;
  return { ...hit, sqm: Math.round(sqm) };
}

function firstDateNear(pages: string[], lead: RegExp): (Hit & { iso: string }) | null {
  const hit = find(pages, new RegExp(`${lead.source}[^\\n]{0,60}?(${DATE})`, 'i'));
  if (!hit) return null;
  const raw = hit.match.find((g, i) => i > 0 && g && parseIndianDate(g));
  const iso = raw ? parseIndianDate(raw) : null;
  return iso ? { ...hit, iso } : null;
}

function money(pages: string[], lead: RegExp): (Hit & { amount: number }) | null {
  const hit = find(pages, new RegExp(`${lead.source}[^\\n]{0,40}?(?:Rs\\.?|INR|₹)\\s*${NUMBER}`, 'i'));
  if (!hit) return null;
  const amount = parseAmount(hit.match[hit.match.length - 1]!);
  return amount === null ? null : { ...hit, amount };
}

function text(pages: string[], lead: RegExp, stop = /[.\n;]/, which: 'first' | 'last' = 'first'): (Hit & { value: string }) | null {
  const pattern = new RegExp(`${lead.source}\\s*[:\\-]?\\s*([^\\n]{2,160})`, 'i');
  const hit = which === 'last' ? findLast(pages, pattern) : find(pages, pattern);
  if (!hit) return null;
  const raw = hit.match[hit.match.length - 1]!;
  const cut = raw.search(stop);
  const value = (cut > 1 ? raw.slice(0, cut) : raw).replace(/[,\s]+$/, '').trim();
  return value ? { ...hit, value } : null;
}

/* ==================================================================== */
/* Per document                                                          */
/* ==================================================================== */

type Builder = (pages: string[], facts: DocumentFact[], flags: DocumentFlag[]) => void;

function push(facts: DocumentFact[], fact: DocumentFact): void {
  if (facts.some((f) => f.key === fact.key)) return;
  facts.push({ ...fact, quote: fact.quote.slice(0, 220) });
}

function commonParcel(pages: string[], facts: DocumentFact[], extentKey?: string, extentLabel?: string): void {
  const sy = surveyNumber(pages);
  if (sy) push(facts, { key: 'survey_numbers', label: 'Survey number', value: sy.value, display: `Sy. No. ${sy.value}`, page: sy.page, quote: sy.quote });
  if (extentKey) {
    const area =
      extent(pages, /\b(?:measuring|admeasuring|site\s+area|extent|total\s+area|land\s+area)\b/)
      ?? acresGuntas(pages);
    if (area) push(facts, { key: extentKey, label: extentLabel ?? 'Extent', value: area.sqm, unit: 'sqm', display: fmtSqm(area.sqm), page: area.page, quote: area.quote });
  }
}

const BUILDERS: Partial<Record<ReadDocumentType, Builder>> = {
  sale_deed(pages, facts, flags) {
    commonParcel(pages, facts, 'extent_title', 'Extent per title');
    const registered =
      firstDateNear(pages, /\bregistered\b[^.\n]{0,120}?\bon\b/)
      ?? firstDateNear(pages, /\b(?:executed|made)\b[^.\n]{0,80}?(?:on|dated|this)\b/)
      ?? firstDateNear(pages, /\bdated\b/);
    if (registered) push(facts, { key: 'registration_date', label: 'Registered on', value: registered.iso, display: displayDate(registered.iso), page: registered.page, quote: registered.quote });
    // The deed's own registration is its last endorsement; the first
    // "Document No." in a deed is usually the predecessor it recites.
    const doc = text(pages, /\bDocument\s+No\.?/, /[,;\n]|\s(?:Book|in|dated)\b/, 'last');
    if (doc) push(facts, { key: 'document_number', label: 'Document number', value: doc.value, display: doc.value, page: doc.page, quote: doc.quote });
    const sro = text(pages, /\boffice\s+of\s+the\s+Sub-?\s?Registrar,?/, /[,.\n;]|\s(?:on|dated)\b/, 'last');
    if (sro) push(facts, { key: 'sub_registrar', label: 'Sub-Registrar', value: sro.value, display: sro.value, page: sro.page, quote: sro.quote });
    const consideration = money(pages, /\b(?:total\s+)?(?:sale\s+)?consideration\b/);
    if (consideration) push(facts, { key: 'consideration', label: 'Sale consideration', value: consideration.amount, unit: 'INR', display: displayInr(consideration.amount), page: consideration.page, quote: consideration.quote });
    const stamp = money(pages, /\bstamp\s+duty\b/);
    if (stamp) push(facts, { key: 'stamp_duty', label: 'Stamp duty', value: stamp.amount, unit: 'INR', display: displayInr(stamp.amount), page: stamp.page, quote: stamp.quote });
    const vendor = text(pages, /(?:^|\n)\s*BY\b/, /,|\bhereinafter\b/);
    if (vendor && vendor.value.length < 90) push(facts, { key: 'vendor', label: 'Vendor', value: vendor.value, display: vendor.value, page: vendor.page, quote: vendor.quote });
    const purchaser = text(pages, /\bIN\s+FAVOU?R\s+OF\b/, /,|\bhereinafter\b/);
    if (purchaser && purchaser.value.length < 90) push(facts, { key: 'purchaser', label: 'Purchaser', value: purchaser.value, display: purchaser.value, page: purchaser.page, quote: purchaser.quote });
    for (const side of ['North', 'South', 'East', 'West'] as const) {
      // A boundary sits on its own line and routinely contains "No." — so it
      // runs to the end of the line, not to the first full stop.
      const b = text(pages, new RegExp(`\\b${side}\\s*(?:by|:)`), /[\n;]/);
      if (b) {
        const value = b.value.replace(/^by\s*:?\s*/i, '').replace(/[.,]\s*$/, '').trim();
        if (value) push(facts, { key: `boundary_${side.toLowerCase()}`, label: `${side} boundary`, value, display: value, page: b.page, quote: b.quote });
      }
    }
    const access = find(pages, /\b(abutting|frontage|access)\b[^.\n]{0,80}\b(public\s+road|main\s+road|road|right\s+of\s+way|private\s+road)\b/i);
    if (access) {
      const phrase = access.match[0].toLowerCase();
      const value = /right\s+of\s+way|easement/.test(phrase) ? 'right of way' : /private\s+road/.test(phrase) ? 'private road' : 'public road';
      push(facts, { key: 'access_type', label: 'Access', value, display: value, page: access.page, quote: access.quote });
    }
    // The recital naming the vendor's own root of title dates the chain.
    // The recital runs across "Document No. 2217/…", so it cannot stop at a full stop.
    const root = find(pages, new RegExp(`\\bSale\\s+Deed\\s+dated\\s+(${DATE})[\\s\\S]{0,260}?\\broot\\s+of\\s+title`, 'i'));
    if (root) {
      const iso = parseIndianDate(root.match.slice(1).find((g) => g && parseIndianDate(g)) ?? '');
      if (iso) push(facts, { key: 'root_year', label: 'Root of title', value: iso, display: displayDate(iso), page: root.page, quote: root.quote });
    }
    const encumbered = find(pages, /\bsubject\s+to\s+(?:a\s+|the\s+)?(?:mortgage|charge|lien)\b/i);
    if (encumbered) {
      flags.push({ severity: 'high', title: 'Deed conveys subject to a charge', description: 'The deed itself records that the property passes subject to a mortgage or charge.', page: encumbered.page, quote: encumbered.quote });
    }
  },

  mother_deed(pages, facts) {
    commonParcel(pages, facts);
    const dated =
      firstDateNear(pages, /\b(?:executed|made)\b[^.\n]{0,80}?(?:on|dated)\b/)
      ?? firstDateNear(pages, /\bregistered\s+on\b/)
      ?? firstDateNear(pages, /\bdated\b/);
    if (dated) push(facts, { key: 'root_year', label: 'Root of title', value: dated.iso, display: displayDate(dated.iso), page: dated.page, quote: dated.quote });
    const doc = text(pages, /\bDocument\s+No\.?/, /[,;\n]|\s(?:Book|in|dated)\b/);
    if (doc) push(facts, { key: 'document_number', label: 'Document number', value: doc.value, display: doc.value, page: doc.page, quote: doc.quote });
    const consideration = money(pages, /\bconsideration\b/);
    if (consideration) push(facts, { key: 'consideration', label: 'Consideration', value: consideration.amount, unit: 'INR', display: displayInr(consideration.amount), page: consideration.page, quote: consideration.quote });
    const how = find(pages, /\b(inherit(?:ed|ance)|mutation\s+register|partition|gift)\b/i);
    if (how) {
      const word = how.match[1]!.toLowerCase();
      const origin = word.startsWith('inherit') ? 'inheritance' : word.startsWith('mutation') ? 'mutation entry' : word;
      push(facts, { key: 'title_origin', label: 'How title arose', value: origin, display: origin, page: how.page, quote: how.quote });
    }
  },

  encumbrance_certificate(pages, facts, flags) {
    commonParcel(pages, facts);
    const period = find(pages, new RegExp(`\\b(?:period\\s+of\\s+search|searched?)\\b[^\\n]{0,40}?\\bfrom\\s+(${DATE})\\s+to\\s+(${DATE})`, 'i'))
      ?? find(pages, new RegExp(`\\bfrom\\s+(${DATE})\\s+to\\s+(${DATE})`, 'i'));
    if (period) {
      const dates = period.match.slice(1).filter((g): g is string => Boolean(g) && parseIndianDate(g!) !== null).map((g) => parseIndianDate(g)!);
      if (dates.length >= 2) {
        push(facts, { key: 'ec_from', label: 'EC searched from', value: dates[0]!, display: displayDate(dates[0]!), page: period.page, quote: period.quote });
        push(facts, { key: 'ec_to', label: 'EC searched to', value: dates[1]!, display: displayDate(dates[1]!), page: period.page, quote: period.quote });
      }
    }
    const nil = find(pages, /\b(?:nil\s+encumbrance|no\s+encumbrances?\s+(?:were\s+|was\s+)?found|form\s*(?:no\.?)?\s*16)\b/i);
    const charges = findAll(pages, /\b(mortgage|hypothecation|charge\s+(?:by|in\s+favou?r)|attachment|lis\s+pendens|court\s+order|lien)\b[^\n]{0,260}/gi);
    const released = find(pages, /\b(?:release\s+deed|reconveyance|discharge\s+of\s+mortgage)\b(?![^\n]{0,20}\bnot\b)/i);
    const noRelease = find(pages, /\bno\s+release\s+deed\b/i);
    const subsisting = charges.filter(() => !released || Boolean(noRelease));
    if (subsisting.length) {
      push(facts, { key: 'ec_nil', label: 'Nil result', value: false, display: 'no — charges on record', page: subsisting[0]!.page, quote: subsisting[0]!.quote });
      push(facts, { key: 'subsisting_charges', label: 'Charges still subsisting', value: subsisting.length, display: String(subsisting.length), page: subsisting[0]!.page, quote: subsisting[0]!.quote });
      for (const charge of subsisting.slice(0, 3)) {
        const amount = /(?:Rs\.?|INR|₹)\s*(\d[\d,]*)/i.exec(charge.match[0]);
        const holder = /(?:claimant|in\s+favou?r\s+of|mortgagee)\s*:?\s*([A-Z][^,.\n-]{3,80})/i.exec(charge.match[0]);
        flags.push({
          severity: 'critical',
          title: `Subsisting ${charge.match[1]!.toLowerCase()} on the EC`,
          description: `The encumbrance certificate records a ${charge.match[1]!.toLowerCase()}${holder ? ` in favour of ${holder[1]!.trim()}` : ''}${amount ? ` securing Rs ${amount[1]}` : ''}${noRelease ? ', and no release is registered in the period searched' : ''}. Title does not pass clean until it is released.`,
          page: charge.page,
          quote: charge.quote,
        });
      }
    } else if (nil) {
      push(facts, { key: 'ec_nil', label: 'Nil result', value: true, display: 'yes — nil encumbrance', page: nil.page, quote: nil.quote });
    }
    const transactions = findAll(pages, /(?:^|\n)\s*\d{1,2}\.\s*(\d{1,2}[-./]\d{1,2}[-./]\d{4})\s*-\s*([A-Za-z ]{4,60}?)\s*-/g);
    if (transactions.length) {
      push(facts, { key: 'ec_transactions', label: 'Transactions in the period', value: transactions.length, display: String(transactions.length), page: transactions[0]!.page, quote: transactions[0]!.quote });
    }
  },

  khata(pages, facts) {
    commonParcel(pages, facts, 'extent_khata', 'Extent per khata');
    const type = find(pages, /\b([ABE])\s*-?\s*Khata\b/);
    if (type) push(facts, { key: 'khata_type', label: 'Khata type', value: `${type.match[1]!.toUpperCase()}-Khata`, display: `${type.match[1]!.toUpperCase()}-Khata`, page: type.page, quote: type.quote });
    const number = text(pages, /\bKhata\s+No\.?/, /[.;\n]|\s(?:PID)\b/);
    if (number) push(facts, { key: 'khata_number', label: 'Khata number', value: number.value, display: number.value, page: number.page, quote: number.quote });
    const pid = text(pages, /\bPID\s+No\.?/, /[,;\n]|\.(?:\s|$)/);
    if (pid) push(facts, { key: 'pid', label: 'PID', value: pid.value, display: pid.value, page: pid.page, quote: pid.quote });
    const owner = text(pages, /\bName\s+of\s+the\s+owner\b/);
    if (owner) push(facts, { key: 'owner', label: 'Owner on the khata', value: owner.value, display: owner.value, page: owner.page, quote: owner.quote });
  },

  property_tax_receipt(pages, facts) {
    const sas = text(pages, /\bSAS\s+Application\s+No\.?/, /[.;\n]|\s(?:Assessment)\b/);
    if (sas) push(facts, { key: 'sas_number', label: 'SAS application number', value: sas.value, display: sas.value, page: sas.page, quote: sas.quote });
    const year = find(pages, /\bassessment\s+year\s*[:\-]?\s*(\d{4}\s*-\s*\d{2,4})/i);
    if (year) push(facts, { key: 'tax_year', label: 'Assessment year', value: year.match[1]!.replace(/\s/g, ''), display: year.match[1]!.replace(/\s/g, ''), page: year.page, quote: year.quote });
    const paid = money(pages, /\b(?:total\s+)?amount\s+paid\b/);
    if (paid) push(facts, { key: 'tax_paid', label: 'Tax paid', value: paid.amount, unit: 'INR', display: displayInr(paid.amount), page: paid.page, quote: paid.quote });
    const on = firstDateNear(pages, /\bdate\s+of\s+payment\b/);
    if (on) push(facts, { key: 'tax_paid_on', label: 'Paid on', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
    const pid = text(pages, /\bPID\s+No\.?/, /[,;\n]|\.(?:\s|$)/);
    if (pid) push(facts, { key: 'pid', label: 'PID', value: pid.value, display: pid.value, page: pid.page, quote: pid.quote });
  },

  zoning_certificate(pages, facts) {
    commonParcel(pages, facts);
    const use = text(pages, /\bland\s+use\b[^:\n]{0,80}:/, /[.;\n]/);
    if (use) push(facts, { key: 'zoning', label: 'Zoning in the plan in force', value: use.value, display: use.value, page: use.page, quote: use.quote });
    const far = find(pages, /\bpermissible\s+FAR\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
    if (far) push(facts, { key: 'permissible_far', label: 'FAR permissible', value: Number(far.match[1]), display: far.match[1]!, page: far.page, quote: far.quote });
    const plan = find(pages, /\b(revised\s+master\s+plan\s*\d{4}|master\s+plan\s*\d{4}|RMP\s*-?\s*\d{4})/i);
    if (plan) push(facts, { key: 'plan_in_force', label: 'Plan in force', value: plan.match[1]!, display: plan.match[1]!, page: plan.page, quote: plan.quote });
    const road = find(pages, /\broad\s+width\b[^\d\n]{0,40}(\d+(?:\.\d+)?)\s*(?:metres|meters|m)\b(?:\s*\((\d+(?:\.\d+)?)\s*(?:feet|ft)\))?/i);
    if (road) {
      const ft = road.match[2] ? Number(road.match[2]) : Math.round(Number(road.match[1]) * 3.28084);
      push(facts, { key: 'road_width_ft', label: 'Abutting road width', value: ft, unit: 'ft', display: `${ft} ft`, page: road.page, quote: road.quote });
    }
  },

  conversion_order(pages, facts, flags) {
    commonParcel(pages, facts);
    const granted = find(pages, /\b(?:permission\s+is\s+hereby\s+granted\s+to\s+convert|converted\s+(?:from\s+agricultural\s+)?to\s+non[\s-]agricultural|conversion\s+(?:is\s+)?(?:hereby\s+)?(?:granted|allowed|sanctioned))\b/i);
    const refused = find(pages, /\b(?:conversion\s+(?:is\s+)?(?:rejected|refused)|request\s+for\s+conversion\s+is\s+rejected)\b/i);
    if (granted && !refused) {
      push(facts, { key: 'conversion_status', label: 'DC conversion', value: 'converted', display: 'converted', page: granted.page, quote: granted.quote });
    } else if (refused) {
      push(facts, { key: 'conversion_status', label: 'DC conversion', value: 'agricultural', display: 'agricultural (refused)', page: refused.page, quote: refused.quote });
      flags.push({ severity: 'critical', title: 'Conversion was refused', description: 'The order refuses conversion; the land remains agricultural.', page: refused.page, quote: refused.quote });
    }
    const order = find(pages, new RegExp(`\\bNo\\.\\s*([A-Z(][^\\n]{3,60}?),?\\s*dated\\s*(${DATE})`, 'i'));
    if (order) {
      push(facts, { key: 'order_number', label: 'Order number', value: order.match[1]!.trim(), display: order.match[1]!.trim(), page: order.page, quote: order.quote });
      const iso = parseIndianDate(order.match.slice(2).find((g) => g && parseIndianDate(g)) ?? '');
      if (iso) push(facts, { key: 'conversion_date', label: 'Date of the conversion order', value: iso, display: displayDate(iso), page: order.page, quote: order.quote });
    }
    const purpose = find(pages, /\bnon[\s-]agricultural\s+([a-z]+)\s+(?:purpose|use)\b/i);
    if (purpose) push(facts, { key: 'converted_use', label: 'Converted to', value: purpose.match[1]!.toLowerCase(), display: `non-agricultural ${purpose.match[1]!.toLowerCase()}`, page: purpose.page, quote: purpose.quote });
  },

  building_sanction(pages, facts) {
    commonParcel(pages, facts);
    const lp = text(pages, /\bLP\s+No\.?/, /\.\s|;|\n|\s(?:Date|dated)\b/);
    if (lp) push(facts, { key: 'sanction_number', label: 'Sanction number', value: lp.value.replace(/\.$/, ''), display: lp.value.replace(/\.$/, ''), page: lp.page, quote: lp.quote });
    const on = firstDateNear(pages, /\bdate\s+of\s+sanction\b/) ?? firstDateNear(pages, /\bsanctioned\s+on\b/);
    if (on) push(facts, { key: 'sanction_date', label: 'Date of sanction', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
    const area = extent(pages, /\bsanctioned\s+built[\s-]?up\s+area\b/);
    if (area) push(facts, { key: 'sanctioned_area', label: 'Built-up area sanctioned', value: area.sqm, unit: 'sqm', display: fmtSqm(area.sqm), page: area.page, quote: area.quote });
    const far = find(pages, /\b(?:FAR\s+sanctioned|sanctioned\s+FAR)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i);
    if (far) push(facts, { key: 'sanctioned_far', label: 'FAR sanctioned', value: Number(far.match[1]), display: far.match[1]!, page: far.page, quote: far.quote });
    const refuge = extent(pages, /\brefuge\s+area\s+provided\b/);
    if (refuge) push(facts, { key: 'refuge_area_provided', label: 'Refuge area provided', value: refuge.sqm, unit: 'sqm', display: fmtSqm(refuge.sqm), page: refuge.page, quote: refuge.quote });
    const site = extent(pages, /\bsite\s+area\b/);
    if (site) push(facts, { key: 'sanctioned_extent', label: 'Extent per sanctioned layout', value: site.sqm, unit: 'sqm', display: fmtSqm(site.sqm), page: site.page, quote: site.quote });
  },

  survey_sketch(pages, facts) {
    commonParcel(pages, facts, 'extent_survey', 'Extent per survey sketch');
    const road = find(pages, /\broad\s+width\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(feet|ft|metres|meters|m)\b/i);
    if (road) {
      const n = Number(road.match[1]);
      const ft = /^m/i.test(road.match[2]!) ? Math.round(n * 3.28084) : n;
      push(facts, { key: 'road_width_ft', label: 'Abutting road width', value: ft, unit: 'ft', display: `${ft} ft`, page: road.page, quote: road.quote });
    }
    const on = firstDateNear(pages, /\b(?:prepared|surveyed|measured)\s+on\b/);
    if (on) push(facts, { key: 'survey_date', label: 'Surveyed on', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
  },

  occupancy_certificate(pages, facts) {
    commonParcel(pages, facts);
    const issued = find(pages, /\boccupancy\s+certificate\b/i);
    const refused = find(pages, /\b(?:not\s+(?:yet\s+)?issued|rejected|refused)\b/i);
    if (issued) push(facts, { key: 'oc_issued', label: 'Occupancy certificate issued', value: !refused, display: refused ? 'no' : 'yes', page: (refused ?? issued).page, quote: (refused ?? issued).quote });
    const on = firstDateNear(pages, /\b(?:dated|issued\s+on|date\s+of\s+issue)\b/);
    if (on && !refused) push(facts, { key: 'oc_date', label: 'Date of the OC', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
    const partial = find(pages, /\bpartial\s+occupancy\b/i);
    if (partial) push(facts, { key: 'oc_partial', label: 'Partial OC only', value: true, display: 'yes', page: partial.page, quote: partial.quote });
  },

  rtc(pages, facts) {
    commonParcel(pages, facts, 'extent_title', 'Extent per title');
    const owner = text(pages, /\b(?:name\s+of\s+(?:the\s+)?(?:owner|khatedar|occupant))\b/);
    if (owner) push(facts, { key: 'owner', label: 'Owner on the RTC', value: owner.value, display: owner.value, page: owner.page, quote: owner.quote });
  },
};

/* ==================================================================== */
/* Entry point                                                           */
/* ==================================================================== */

function summarise(type: ReadDocumentType, label: string, facts: DocumentFact[], flags: DocumentFlag[]): string {
  const get = (key: string) => facts.find((f) => f.key === key)?.display;
  const parts: string[] = [];
  switch (type) {
    case 'sale_deed':
      parts.push(`${label}${get('registration_date') ? ` registered ${get('registration_date')}` : ''}`);
      if (get('vendor') && get('purchaser')) parts.push(`${get('vendor')} to ${get('purchaser')}`);
      if (get('survey_numbers')) parts.push(get('survey_numbers')!);
      if (get('extent_title')) parts.push(get('extent_title')!);
      if (get('consideration')) parts.push(get('consideration')!);
      break;
    case 'mother_deed':
      parts.push(`${label}${get('root_year') ? ` dated ${get('root_year')}` : ''}`);
      if (get('survey_numbers')) parts.push(get('survey_numbers')!);
      if (get('title_origin')) parts.push(`title by ${get('title_origin')}`);
      break;
    case 'encumbrance_certificate':
      parts.push(`${label}${get('ec_from') && get('ec_to') ? ` searched ${get('ec_from')} to ${get('ec_to')}` : ''}`);
      if (get('ec_transactions')) parts.push(`${get('ec_transactions')} transactions`);
      parts.push(flags.some((f) => f.severity === 'critical') ? `${flags.filter((f) => f.severity === 'critical').length} subsisting charge(s)` : get('ec_nil') ? 'nil encumbrance' : '');
      break;
    case 'khata':
      parts.push(get('khata_type') ?? label);
      if (get('owner')) parts.push(`in the name of ${get('owner')}`);
      if (get('extent_khata')) parts.push(get('extent_khata')!);
      if (get('pid')) parts.push(`PID ${get('pid')}`);
      break;
    case 'property_tax_receipt':
      parts.push(`${label}${get('tax_year') ? ` for ${get('tax_year')}` : ''}`);
      if (get('tax_paid')) parts.push(`${get('tax_paid')} paid${get('tax_paid_on') ? ` on ${get('tax_paid_on')}` : ''}`);
      break;
    case 'zoning_certificate':
      parts.push(label);
      if (get('zoning')) parts.push(get('zoning')!);
      if (get('permissible_far')) parts.push(`FAR ${get('permissible_far')}`);
      if (get('plan_in_force')) parts.push(get('plan_in_force')!);
      break;
    case 'conversion_order':
      parts.push(`${label}${get('conversion_date') ? ` dated ${get('conversion_date')}` : ''}`);
      if (get('conversion_status')) parts.push(get('conversion_status')!);
      break;
    case 'building_sanction':
      parts.push(`${label}${get('sanction_date') ? ` of ${get('sanction_date')}` : ''}`);
      if (get('sanctioned_area')) parts.push(`${get('sanctioned_area')} built-up`);
      if (get('sanctioned_far')) parts.push(`FAR ${get('sanctioned_far')}`);
      break;
    case 'survey_sketch':
      parts.push(label);
      if (get('extent_survey')) parts.push(`${get('extent_survey')} measured`);
      if (get('road_width_ft')) parts.push(`road ${get('road_width_ft')}`);
      break;
    default:
      parts.push(label);
      if (get('survey_numbers')) parts.push(get('survey_numbers')!);
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * What a document is and what it says.
 *
 * `pages` is the text of each page in order — from the text layer, or OCR.
 * An empty or unreadable document comes back as `other` with no facts, never
 * a guess dressed as a reading.
 */
export function parseDocumentText(pages: string[], fileName = ''): ParsedDocument {
  const clean = pages.map(normalise);
  const { type, confidence } = classify(clean, fileName);
  const profile = type === 'other' ? OTHER : PROFILES[type];
  const facts: DocumentFact[] = [];
  const flags: DocumentFlag[] = [];
  const build = BUILDERS[type];
  if (build) build(clean, facts, flags);
  else if (clean.some((p) => p.trim())) commonParcel(clean, facts);
  return {
    type,
    label: profile.label,
    documentKind: profile.documentKind,
    evidenceKind: profile.evidenceKind,
    confidence,
    facts,
    flags,
    summary: summarise(type, profile.label, facts, flags),
    rowHints: profile.rowHints,
    scopes: profile.scopes,
    pages: pages.length,
  };
}

/** The label a document type is shown under. */
export function readDocumentLabel(type: ReadDocumentType): string {
  return type === 'other' ? OTHER.label : PROFILES[type].label;
}

/**
 * Whether a document read as `label` is the document an expected-evidence
 * row titled `title` is waiting for.
 *
 * Phrase against phrase, never a shared single word: "Survey plan" is a
 * survey sketch, "Condition survey" is not; "Sanctioned layout" is a building
 * sanction, an electrical "Sanction letter" is not.
 */
export function documentAnswers(label: string, title: string): boolean {
  const profile = (Object.values(PROFILES) as TypeProfile[]).find((p) => p.label.toLowerCase() === label.toLowerCase());
  if (!profile) return false;
  const t = title.toLowerCase();
  return profile.rowHints.some((h) => h.length > 2 && (t.includes(h) || (h.includes(t) && t.length > 5)));
}
