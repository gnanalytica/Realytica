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
 * sanction, survey sketch, OC — the approvals a project's file is built on —
 * the RERA registration, the environmental clearance, the utility, aviation
 * and fire NOCs — and the promoter's certificate of incorporation, in the
 * phrasing registries, boards and authorities actually use. It does not guess: a value it cannot find is absent, never a
 * default. A model, where one is configured, reads more; this is the floor
 * that works on every deployment, including one with no credentials.
 *
 * What it produces is a proposal, not a record. Facts reach a check only
 * through a card a person approves.
 */

import type { DocumentKind } from '../types';
import { normalizeDigits } from '../script';
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
  | 'rera_registration'
  | 'environmental_clearance'
  | 'utility_noc'
  | 'aviation_noc'
  | 'fire_noc'
  | 'company_incorporation'
  | 'legal_opinion'
  | 'tds_certificate'
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
  /**
   * Read by the rules off a paper this server had a reason to send to a model:
   * a page in another script, one OCR was unsure of, pages unread, a paper not
   * recognised (the file's `reading.modelReasons`). Such a value waits for a
   * person as a model's does, and acts on nothing until then (`stands`).
   */
  unsure?: true;
  /** For a model's fact, how its page was verified. */
  pageCheck?: import('../types').PageCheck;
  /**
   * What stands behind a model's value, for a screen to say and for
   * acceptance to weigh: its words, the value's own among them, are in the
   * words this server read from the page (`page_text`); a second model,
   * shown the page alone and asked for the value by its name, read the same
   * value (`second_reader`), which is two models agreeing and weaker than
   * the page's text; or neither (`unverified`). Absent on a value the rules
   * read, whose words are the page's own. An unverified value is never among
   * a paper's facts: it is kept apart, on the reading
   * (`ReadingCoverage.unverified`).
   */
  proof?: FactProof;
  /**
   * Where the quote, and the value inside it, sit on `page` — found by
   * matching the quote back to the words the page was read from, so a person
   * can see the words themselves rather than take the quote's word for it.
   * Absent where the match failed, and on facts read before positions were
   * kept.
   */
  marks?: FactMarks;
  /**
   * Where a person stands on it. A document filed from an upload carries what
   * it states as `proposed` until somebody accepts each value where it sits,
   * or sets it aside. Absent means accepted: a fact on file before values
   * were reviewed one by one was accepted with its whole card.
   */
  review?: FactReview;
  decidedBy?: string;
  decidedAt?: string;
  /** The person corrected the value before accepting it; the quote is still the page's. */
  edited?: boolean;
  /** What the page was read as before the correction, so reopening the value puts it back. */
  readAs?: { value: string | number | boolean; display: string };
  /** The value this one replaced when accepted — kept so the decision can be undone. */
  replaced?: DocumentFact;
  /**
   * What the other reader read for the same thing, where the two differ and
   * each found its words on a page: the rules read 73/4, a model 73/1. Both
   * wait, side by side, for a person to keep one; neither is taken for them.
   * The fact itself stays this server's own reading, so everything that reads
   * a paper's facts by key sees one value a key, as it always did.
   */
  otherReading?: Omit<DocumentFact, 'otherReading'>;
}

export type FactReview = 'proposed' | 'accepted' | 'rejected';

export type FactProof = 'page_text' | 'second_reader' | 'unverified';

/** A box on a page, each side a fraction of the page's width or height from its top left. */
export interface MarkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One box per line the words run across. */
export interface FactMarks {
  quote: MarkRect[];
  value?: MarkRect[];
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
  /**
   * How much a matching file name counts. Two by default: a name says what a
   * person thought the file was. More where the name is the surest thing
   * about it — an opinion on title is named as one, and its first pages list
   * every deed and order it read, which look like those documents.
   */
  fileWeight?: number;
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
    file: [/sale[\s_-]*deed/i, /conveyance/i, /title[\s_-]*doc/i],
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
    title: [/\bencumbrance\s+certificate\b/i, /\bform\s*(?:no\.?)?\s*1[56]\b/i, /ಋಣ\s*ಭಾರ/, /ಋಣಭಾರ\s*ಪ್ರಮಾಣ\s*ಪತ್ರ/],
    body: [/\bperiod\s+of\s+search\b/i, /\bacts\s+and\s+encumbrances\b/i, /\bno\s+encumbrances?\b/i, /\bnil\s+encumbrance\b/i],
    file: [/encumbrance/i, /\bECs?(?:[\s_-]|$)/i, /form[\s_-]*1[56]/i],
    fileWeight: 4,
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
    file: [/sanction/i, /building[\s_-]*plan/i, /\bLP[\s_-]/i, /(?:^|[^a-z])plans?(?:[^a-z]|$)/i],
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
  rera_registration: {
    label: 'RERA registration certificate',
    documentKind: 'rera_registration',
    evidenceKind: 'certificate',
    rowHints: ['rera registration', 'rera certificate', 'rera'],
    scopes: ['regulatory', 'legal'],
    title: [/\bReal\s+Estate\s+Regulatory\s+Authority\b/i, /\bregistration\s+certificate\s+of\s+project\b/i],
    body: [/\bPRM\/[A-Z]{2}\/RERA\//, /\bACK\/[A-Z]{2}\/RERA\//, /\bproject\s+approval\s+date\b/i, /\bpromoter\b/i],
    file: [/rera/i],
  },
  environmental_clearance: {
    label: 'Environmental clearance',
    documentKind: 'other',
    evidenceKind: 'approval',
    rowHints: ['environmental clearance', 'environment clearance', 'seiaa'],
    scopes: ['esg', 'regulatory'],
    title: [/\benvironment(?:al)?\s+clearance\b/i, /\bEnvironment\s+Impact\s+Assessment\s+Authority\b/i],
    body: [/\bSEIAA\b/, /\bE\s*\(\s*P\s*\)\s*Act\b/i, /\bEIA\s+Notification\b/i, /\bMoEF/i],
    file: [/environment/i, /seiaa/i],
  },
  utility_noc: {
    label: 'Utility NOC',
    documentKind: 'other',
    evidenceKind: 'approval',
    rowHints: ['utility nocs', 'utility noc'],
    scopes: ['regulatory'],
    title: [/\bno\s+objection\s+certificate\b/i, /\bNOC\b/],
    body: [
      /\bWater\s+Supply\s+and\s+Sewerage\s+Board\b/i,
      /\bElectricity\s+Supply\s+Company\b/i,
      /\bBharat\s+Sanchar\s+Nigam\b/i,
      /\bpower\s+supply\b/i,
      /\bwater\s+supply\b/i,
      /\bsewerage\b/i,
      /\btelecom\b/i,
    ],
    file: [/bwssb|bescom|bsnl|kptcl|utility/i],
  },
  aviation_noc: {
    label: 'Aviation height NOC',
    documentKind: 'other',
    evidenceKind: 'approval',
    rowHints: ['aai noc', 'height clearance', 'aviation noc'],
    scopes: ['regulatory', 'technical'],
    title: [/\bheight\s+clearance\b/i, /\bAirports?\s+Authority\s+of\s+India\b/i],
    body: [/\bAMSL\b/, /\bpermissible\s+top\s+elevation\b/i, /\baerodrome\b/i, /\bNOC\s*ID\b/i, /\bcivil\s+aviation\b/i],
    file: [/airport|aai/i],
  },
  fire_noc: {
    label: 'Fire NOC',
    documentKind: 'other',
    evidenceKind: 'approval',
    rowHints: ['fire noc', 'fire clearance'],
    scopes: ['regulatory', 'hse'],
    title: [/\bFire\s+(?:and|&)\s+Emergency\s+Services\b/i, /\bfire\s+(?:no\s+objection|clearance|NOC)\b/i],
    body: [/\bfire\s+safety\b/i, /\brefuge\b/i, /\bsprinklers?\b/i, /\bfire\s+(?:fighting|hydrants?)\b/i, /\bNational\s+Building\s+Code\b/i],
    file: [/fire/i],
  },
  company_incorporation: {
    label: 'Certificate of incorporation',
    documentKind: 'other',
    evidenceKind: 'certificate',
    rowHints: ['certificate of incorporation', 'memorandum of association', 'articles of association', 'moa', 'aoa'],
    scopes: ['legal'],
    title: [/\bcertificate\s+of\s+incorporation\b/i, /\bmemorandum\s+of\s+association\b/i, /\barticles\s+of\s+association\b/i],
    body: [/\bCorporate\s+Identi(?:fication|ty)\s+Number\b/i, /\bRegistrar\s+of\s+Companies\b/i, /\bCompanies\s+Act\b/i, /\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/],
    file: [/moa|aoa|incorporation|(?:^|[^a-z])coi(?:[^a-z]|$)/i],
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
  /*
   * An advocate's opinion on title: the certified report Legal's title work
   * ends in. What matters is who signed it, when, what it covers, and whether
   * it calls the title clear and marketable or clear subject to something.
   */
  legal_opinion: {
    label: 'Legal opinion on title',
    documentKind: 'other',
    evidenceKind: 'certificate',
    rowHints: ['legal opinion', 'title opinion', 'title search report', 'title clearance', 'title certificate'],
    scopes: ['legal'],
    title: [/\blegal\s+opinion\b/i, /\btitle\s+(?:opinion|search\s+report|clearance\s+certificate|certificate)\b/i, /\breport\s+on\s+title\b/i],
    body: [
      /\bmarketable\s+title\b/i,
      /\bclear(?:,)?\s+(?:valid\s+and\s+)?(?:marketable\s+)?title\b/i,
      /\b(?:we|I)\s+have\s+(?:perused|examined|scrutini[sz]ed|verified)\b/i,
      /\bdocuments?\s+(?:perused|scrutini[sz]ed|examined)\b/i,
      /\bAdvocates?\b/,
      /\bflow\s+of\s+title\b/i,
    ],
    file: [/legal[\s_-]*opinion/i, /title[\s_-]*(?:opinion|report)/i],
    fileWeight: 8,
  },
  /*
   * A certificate of tax deducted at source on a property purchase: the buyer
   * withholds part of the price and the department certifies it. Finance's
   * tax work, and evidence a sale happened at a price.
   */
  tds_certificate: {
    label: 'TDS certificate',
    documentKind: 'other',
    evidenceKind: 'certificate',
    rowHints: ['tds certificate', 'form 16b', 'form 132', 'tax deducted at source'],
    scopes: ['financial_appraisal'],
    title: [/\bcertificate\s+under\s+section\s+\d+[A-Z]?(?:\(\d+\))?\s+of\s+the\s+(?:income[\s-]*tax\s+)?act\s+for\s+tax\s+deducted\s+at\s+source\b/i, /\bform\s*(?:no\.?)?\s*(?:16B|132)\b/i],
    body: [/\btax\s+deducted\s+at\s+source\b/i, /\bdeductor\b/i, /\bdeductee\b/i, /\bTDS\b/],
    file: [/tds|form[\s_-]*(?:16b|132)/i],
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

/**
 * OCR and text layers both break words and spacing; read through that.
 *
 * Exported because a quote is cut from text in this form, and finding the
 * quote's words on the page again means putting them in the same form.
 */
export function normaliseDocumentText(text: string): string {
  return normalise(text);
}

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

/**
 * Every date a stretch of words states, each as YYYY-MM-DD, in the forms
 * `parseIndianDate` reads. For holding a date to the words quoted for it: a
 * quote that ends "31-03-2024" states that day and no other.
 */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of normalise(text).matchAll(new RegExp(DATE, 'gi'))) {
    const iso = parseIndianDate(match[0]);
    if (iso && !out.includes(iso)) out.push(iso);
  }
  return out;
}

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

/**
 * An area written out, in square metres as these rules keep one: "2,450 square
 * metres", "1 acre 22 guntas", "12 guntas". Null where the unit is not one they
 * know, so a value read elsewhere is converted exactly as one read here.
 */
function areaInSqm(written: string): number | null {
  const text = normalise(written).trim();
  const mixed = /^(\d+)\s*acres?\s*(?:and\s+)?(\d+(?:\.\d+)?)\s*gunt(?:a|ha)s?$/i.exec(text);
  if (mixed) return Math.round(Number(mixed[1]) * SQM_PER_ACRE + Number(mixed[2]) * SQM_PER_GUNTA);
  const guntas = new RegExp(`^${NUMBER}\\s*gunt(?:a|ha)s?$`, 'i').exec(text);
  if (guntas) return Math.round((parseAmount(guntas[1]!) ?? 0) * SQM_PER_GUNTA) || null;
  const plain = new RegExp(`^${NUMBER}\\s*${AREA_UNIT}$`, 'i').exec(text);
  return plain ? areaToSqm(plain[1]!, plain[2]!) : null;
}

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
    for (const re of profile.file) if (re.test(fileName)) score += profile.fileWeight ?? 2;
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

const SURVEY_NO = String.raw`\d{1,4}(?:\/[0-9A-Z]{1,4}){0,3}`;

/**
 * What stands between two survey numbers in a list: a comma, an ampersand or
 * the word. One definition, so a list a person types is split exactly as one
 * read off a page.
 */
export const SURVEY_LIST_SEPARATOR = /\s*(?:,|&|\band\b)\s*/i;

/**
 * Every survey number in a document's list, in order, once each.
 *
 * An approval names the whole property it covers — a RERA certificate the
 * phase's thirteen survey numbers, an environmental clearance the township's
 * sixty — where a deed repeats its one. `surveyNumber` finds the one; this
 * keeps the list.
 */
function surveyList(pages: string[]): (Hit & { values: string[] }) | null {
  const hit = find(
    pages,
    new RegExp(String.raw`\b(?:Sy\.?|Survey)\s*(?:No'?s?\.?|Nos\.?|Numbers?)?\s*[:.]?\s*(${SURVEY_NO}(?:\s*(?:,|&|\band\b)\s*${SURVEY_NO}){1,})`, 'i'),
  );
  if (!hit) return null;
  const values = [
    ...new Set(
      hit.match[1]!
        .split(SURVEY_LIST_SEPARATOR)
        .map((v) => v.trim().toUpperCase())
        .filter((v) => new RegExp(`^${SURVEY_NO}$`).test(v)),
    ),
  ];
  return values.length >= 2 ? { ...hit, values } : null;
}

function listDisplay(values: string[]): string {
  const shown = values.slice(0, 6).join(', ');
  return values.length > 6 ? `Sy. Nos. ${shown} and ${values.length - 6} more` : `Sy. Nos. ${shown}`;
}

/**
 * The date a letter is dated, from its letterhead.
 *
 * Only the first "Date", "Dated" or "dt" at the top of the first page, and
 * only a date right beside it. A board's letter goes on to cite the
 * requisition it answers — "Ref: letter dated 12.02.2015" — and taking that
 * when the letterhead's own date is illegible would put a wrong date on the
 * approval, which is worse than none.
 */
function letterDate(pages: string[]): (Hit & { iso: string }) | null {
  const head = (pages[0] ?? '').slice(0, 1400);
  const label = /\b(?:Date[d]?|dt)\b\.?/i.exec(head);
  if (!label) return null;
  const after = head.slice(label.index, label.index + label[0].length + 60);
  const date = new RegExp(DATE, 'i').exec(after);
  if (!date) return null;
  const iso = parseIndianDate(date[0]);
  if (!iso) return null;
  return { page: 1, match: date, quote: quoteAround(head, label.index, label[0].length + date.index + date[0].length) , iso };
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** "valid for a period of 5 years" / "seven years" — the number of years an approval states it runs. */
function validityYears(pages: string[]): (Hit & { years: number }) | null {
  const hit = find(pages, /\bvalid(?:ity)?\b[^.\n]{0,40}?\b(?:for\s+)?(?:a\s+)?(?:period\s+of\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\s*\w+\s*\)\s*)?years?\b/i);
  if (!hit) return null;
  const raw = hit.match[1]!.toLowerCase();
  const years = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
  return years ? { ...hit, years } : null;
}

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-');
  return `${Number(y) + years}-${m}-${d}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The term an approval states, as a date, and a flag when it has passed. */
function validUntil(pages: string[], facts: DocumentFact[], flags: DocumentFlag[], issued: string | undefined, what: string): void {
  const term = validityYears(pages);
  if (!term || !issued) return;
  const until = addYears(issued, term.years);
  push(facts, { key: 'valid_until', label: 'Valid until', value: until, display: displayDate(until), page: term.page, quote: term.quote });
  if (until < today()) {
    flags.push({
      severity: 'high',
      title: `${what} lapsed on ${displayDate(until)}`,
      description: `It was issued on ${displayDate(issued)} and states it is valid for ${term.years} year${term.years === 1 ? '' : 's'}. Work it covers that was not complete by then needs it renewed or issued afresh.`,
      page: term.page,
      quote: term.quote,
    });
  }
}

/** The addressee, "To, M/s. …" — or "in favour of M/s. …" when the letterhead's line is illegible. */
function addressee(pages: string[]): (Hit & { value: string }) | null {
  const company = String.raw`([A-Z][A-Za-z .&'-]{2,80}?(?:Limited|Ltd\.?|LLP|Pvt\.?\s*Ltd\.?|Private\s+Limited))`;
  const hit =
    find(pages, new RegExp(String.raw`\bTo,?\s+M\/s\.?\s*${company}`, 'i'))
    ?? find(pages, new RegExp(String.raw`\bin\s+favou?r\s+of\s+M\/?s\.?\s*${company}`, 'i'));
  if (!hit) return null;
  return { ...hit, value: hit.match[1]!.replace(/\s+/g, ' ').trim() };
}

/** "Sub: …" up to the reference line, capped. */
function subject(pages: string[]): (Hit & { value: string }) | null {
  // Up to 900 characters: a subject naming sixty survey numbers runs long
  // before the reference line, and is cut back to its own words below.
  const hit = find(pages, /\bSub(?:ject)?\s*[:.\-]+\s*([^\n]{8,900}?)(?=\s+(?:Ref|Reference)\s*[:.\-]|\s+Sir\b|\n|$)/i);
  if (!hit) return null;
  let value = hit.match[1]!.replace(/\s+/g, ' ').trim();
  // The survey list the subject goes on to name is its own fact.
  const at = value.search(/\s(?:at|on)\s+(?:property\s+bearing\s+)?(?:Sy\.?|Survey)\b|\s-\s*Issue\s+of\b/i);
  if (at > 10) value = value.slice(0, at);
  value = value.replace(/[\s,.\-]+$/, '');
  return value.length > 3 ? { ...hit, value: value.length > 160 ? `${value.slice(0, 157)}…` : value } : null;
}

/** The reference a board writes as "No. …": slash-separated, as issued. */
function reference(pages: string[], lead: RegExp): (Hit & { value: string }) | null {
  const hit = find(pages, new RegExp(String.raw`${lead.source}\s*[.:]?\s*((?:[A-Z][A-Za-z()]*(?:\s\([A-Za-z0-9]+\))?|\d+)(?:\s?\/\s?[A-Za-z0-9()\-.]+){2,14})`, 'i'));
  if (!hit) return null;
  const parts = hit.match[1]!.replace(/\s*\/\s*/g, '/').replace(/[/.\s]+$/, '').split('/');
  // OCR leaves stray marks after the reference ("…-IT/(5"): a last part with
  // an unmatched bracket is not part of what the board wrote.
  const balanced = (part: string) => (part.match(/\(/g) ?? []).length === (part.match(/\)/g) ?? []).length;
  while (parts.length > 3 && !balanced(parts[parts.length - 1]!)) parts.pop();
  const value = parts.join('/');
  return value.length > 4 ? { ...hit, value } : null;
}

const ISSUERS: Array<[RegExp, string]> = [
  [/\bAirports?\s+Authority\s+of\s+India\b/i, 'Airports Authority of India'],
  [/\bWater\s+Supply\s+and\s+Sewerage\s+Board\b/i, 'Water Supply and Sewerage Board'],
  [/\bElectricity\s+Supply\s+Company\b/i, 'Electricity Supply Company'],
  [/\bBharat\s+Sanchar\s+Nigam\b/i, 'Bharat Sanchar Nigam Ltd'],
  [/\bPower\s+Transmission\s+Corporation\b/i, 'Power Transmission Corporation'],
  [/\bFire\s+(?:and|&)\s+Emergency\s+Services\b/i, 'Fire and Emergency Services'],
  [/\bPollution\s+Control\s+Board\b/i, 'Pollution Control Board'],
];

/** Who issued a no-objection certificate, with the name it prints for itself. */
function issuer(pages: string[]): (Hit & { value: string }) | null {
  for (const [pattern, name] of ISSUERS) {
    const hit = find(pages, new RegExp(String.raw`(?:\b([A-Za-z]{4,})\s+)?${pattern.source}`, 'i'));
    if (!hit) continue;
    // "Bangalore Water Supply and Sewerage Board": keep the one word naming
    // the place, and nothing shorter — a scan's letterhead leaves "EE BE" in
    // front of the name more often than not.
    const place = hit.match[1] ?? '';
    const value = place && !/^(?:the|by|of|from|and|issued|with|this|that|limited)$/i.test(place)
      ? `${place.charAt(0).toUpperCase()}${place.slice(1).toLowerCase()} ${name}`
      : name;
    return { ...hit, value };
  }
  return null;
}

/**
 * What every no-objection certificate states: who, which reference, when, to
 * whom, for what, over which land. `what` names it in a lapse finding, from
 * its issuer, so a register holding four lapsed NOCs says whose each one is.
 */
function nocCommon(pages: string[], facts: DocumentFact[], flags: DocumentFlag[], what: (issuer?: string) => string): string | undefined {
  const by = issuer(pages);
  if (by) push(facts, { key: 'issued_by', label: 'Issued by', value: by.value, display: by.value, page: by.page, quote: by.quote });
  const ref = reference(pages, /\bNOC\s*ID\b/) ?? reference(pages, /\b(?:No|Ref(?:erence)?\s*No)\b/);
  if (ref) push(facts, { key: 'noc_reference', label: 'Reference', value: ref.value, display: ref.value, page: ref.page, quote: ref.quote });
  const on = letterDate(pages);
  if (on) push(facts, { key: 'issued_on', label: 'Issued on', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
  const to = addressee(pages);
  if (to) push(facts, { key: 'issued_to', label: 'Issued to', value: to.value, display: to.value, page: to.page, quote: to.quote });
  const sub = subject(pages);
  if (sub) push(facts, { key: 'subject', label: 'Subject', value: sub.value, display: sub.value, page: sub.page, quote: sub.quote });
  const covered = surveyList(pages);
  if (covered) push(facts, { key: 'covered_survey_numbers', label: 'Survey numbers covered', value: covered.values.join(', '), display: listDisplay(covered.values), page: covered.page, quote: covered.quote });
  validUntil(pages, facts, flags, on?.iso, what(by?.value));
  return on?.iso;
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

  /*
   * A lease reserves a rent on an area from a date — the three facts an income
   * approach is built on, and the only rent on most files. Read as the lease
   * states them: the passing rent, not a market rent anybody inferred.
   */
  lease(pages, facts) {
    commonParcel(pages, facts);
    const rent = money(pages, /\b(?:monthly\s+(?:rent|licen[cs]e\s+fee)|rent\s+of|rental\s+of)\b/);
    if (rent) push(facts, { key: 'monthly_rent', label: 'Monthly rent', value: rent.amount, unit: 'INR', display: displayInr(rent.amount), page: rent.page, quote: rent.quote });
    const area = extent(pages, /\b(?:admeasuring|measuring|leased\s+area|area\s+let|carpet\s+area|chargeable\s+area|super\s+built[\s-]?up\s+area)\b/);
    if (area) push(facts, { key: 'leased_area', label: 'Area let', value: area.sqm, unit: 'sqm', display: fmtSqm(area.sqm), page: area.page, quote: area.quote });
    const from = firstDateNear(pages, /\b(?:commenc(?:ing|ement)(?:\s+date)?|with\s+effect\s+from)\b/);
    if (from) push(facts, { key: 'lease_start', label: 'Lease starts', value: from.iso, display: displayDate(from.iso), page: from.page, quote: from.quote });
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

  /*
   * A state RERA's certificate. The Karnataka one prints its labels as part
   * of the image and only the values as text, so each value is found by its
   * own shape — the registration number by its PRM/…/RERA/ form, the term by
   * sitting just before the QR-code line — and by a label where one exists.
   */
  rera_registration(pages, facts, flags) {
    const reg = find(pages, /\b(PRM\/[A-Z]{2}\/RERA\/[0-9A-Z/]+)/);
    if (reg) {
      const value = reg.match[1]!.replace(/\/+$/, '');
      push(facts, { key: 'rera_number', label: 'RERA registration number', value, display: value, page: reg.page, quote: reg.quote });
    }
    const ack = find(pages, /\b(ACK\/[A-Z]{2}\/RERA\/[0-9A-Z/]+)/);
    if (ack) {
      const value = ack.match[1]!.replace(/\/+$/, '');
      push(facts, { key: 'rera_acknowledgement', label: 'Application acknowledgement', value, display: value, page: ack.page, quote: ack.quote });
    }
    const project =
      text(pages, /\bproject\s+name\b/, /[,;\n]/)
      ?? (() => {
        const hit = find(pages, /\bPRM\/[A-Z]{2}\/RERA\/[0-9A-Z/]+\s+([A-Z][A-Z0-9 &.'()-]{3,90}?)\s*,\s*(?:SY|SURVEY|S\.\s*NO)\b/);
        return hit ? { ...hit, value: hit.match[1]!.trim() } : null;
      })();
    if (project) push(facts, { key: 'project_name', label: 'Project', value: project.value, display: project.value, page: project.page, quote: project.quote });
    const list = surveyList(pages);
    if (list) push(facts, { key: 'survey_numbers', label: 'Survey numbers', value: list.values.join(', '), display: listDisplay(list.values), page: list.page, quote: list.quote });
    const approved = firstDateNear(pages, /\b(?:project\s+)?approval\s+date\b/) ?? firstDateNear(pages, /\bdate\s+of\s+(?:registration|approval)\b/);
    if (approved) push(facts, { key: 'rera_approved_on', label: 'Approved on', value: approved.iso, display: displayDate(approved.iso), page: approved.page, quote: approved.quote });
    const labelled = firstDateNear(pages, /\bvalid\s+(?:up\s*to|upto|till|until|to)\b/);
    const beforeQr = (() => {
      const hit = find(pages, new RegExp(`(${DATE})[\\s\\S]{0,40}?\\bPlease\\s+scan\\b`, 'i'));
      const iso = hit ? parseIndianDate(hit.match.slice(1).find((g) => g && parseIndianDate(g)) ?? '') : null;
      return hit && iso ? { ...hit, iso } : null;
    })();
    const valid = labelled ?? beforeQr;
    if (valid) {
      push(facts, { key: 'rera_valid_until', label: 'Registration valid until', value: valid.iso, display: displayDate(valid.iso), page: valid.page, quote: valid.quote });
      if (valid.iso < today()) {
        flags.push({
          severity: 'high',
          title: `RERA registration lapsed on ${displayDate(valid.iso)}`,
          description: 'The registration has run past its term. Sales and advertising need it extended with the authority.',
          page: valid.page,
          quote: valid.quote,
        });
      }
    }
    const authority = find(pages, /\b([A-Z][a-z]+)\s+Real\s+Estate\s+Regulatory\s+Authority\b/);
    if (authority) push(facts, { key: 'issued_by', label: 'Issued by', value: `${authority.match[1]} RERA`, display: `${authority.match[1]} Real Estate Regulatory Authority`, page: authority.page, quote: authority.quote });
  },

  environmental_clearance(pages, facts, flags) {
    const by = find(pages, /\bState\s+(?:Level\s+)?Environment\s+Impact\s+Assessment\s+Authority\s*[-,]?\s*([A-Z][a-z]+)?/i);
    if (by) {
      const value = `SEIAA${by.match[1] ? ` ${by.match[1]}` : ''}`;
      push(facts, { key: 'issued_by', label: 'Issued by', value, display: value, page: by.page, quote: by.quote });
    }
    const number = find(pages, /\bNo\.?\s*[:.]?\s*(SEIAA[\s\dA-Z/.()-]{2,40}?\d{4})\b/i);
    if (number) {
      const value = number.match[1]!.replace(/\s+/g, ' ').trim();
      push(facts, { key: 'clearance_number', label: 'Clearance number', value, display: value, page: number.page, quote: number.quote });
    }
    const on = letterDate(pages);
    if (on) push(facts, { key: 'issued_on', label: 'Issued on', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
    const to = addressee(pages);
    if (to) push(facts, { key: 'issued_to', label: 'Issued to', value: to.value, display: to.value, page: to.page, quote: to.quote });
    const sub = subject(pages);
    if (sub) push(facts, { key: 'subject', label: 'Subject', value: sub.value, display: sub.value, page: sub.page, quote: sub.quote });
    const covered = surveyList(pages);
    if (covered) push(facts, { key: 'covered_survey_numbers', label: 'Survey numbers covered', value: covered.values.join(', '), display: listDisplay(covered.values), page: covered.page, quote: covered.quote });
    const built = extent(pages, /\b(?:total\s+)?built[\s-]?up\s+area\b/);
    if (built) push(facts, { key: 'cleared_built_up_area', label: 'Built-up area cleared', value: built.sqm, unit: 'sqm', display: fmtSqm(built.sqm), page: built.page, quote: built.quote });
    const units = find(pages, /\b(\d[\d,]*)\s+(?:residential\s+)?(?:dwelling\s+)?(?:units|flats|apartments)\b/i);
    if (units) {
      const n = parseAmount(units.match[1]!);
      if (n) push(facts, { key: 'cleared_units', label: 'Units cleared', value: n, display: n.toLocaleString('en-IN'), page: units.page, quote: units.quote });
    }
    validUntil(pages, facts, flags, on?.iso, 'Environmental clearance');
  },

  utility_noc(pages, facts, flags) {
    nocCommon(pages, facts, flags, (by) => (by ? `The ${by} NOC` : 'The NOC'));
    const load = find(pages, /(\d[\d,]*(?:\.\d+)?)\s*kW\b(?:\s*\(\s*(\d+(?:\.\d+)?)\s*MVA\s*\))?/i);
    if (load) {
      const kw = parseAmount(load.match[1]!);
      if (kw) {
        const display = `${kw.toLocaleString('en-IN')} kW${load.match[2] ? ` (${load.match[2]} MVA)` : ''}`;
        push(facts, { key: 'power_load', label: 'Power sanctioned', value: kw, unit: 'kW', display, page: load.page, quote: load.quote });
      }
    }
  },

  /*
   * An AAI height clearance. What a diligence needs from it is the ceiling
   * and whether it still runs: the permissible top elevation above mean sea
   * level, the site's own elevation, where the site is, and the term.
   */
  aviation_noc(pages, facts, flags) {
    nocCommon(pages, facts, flags, (by) => (by ? `The ${by} height NOC` : 'The height NOC'));
    const top = find(pages, /\bpermissible\s+top\s+elevation\b[^\d\n]{0,30}(\d{2,4}(?:\.\d+)?)\s*m/i);
    if (top) push(facts, { key: 'permissible_top_elevation', label: 'Permissible top elevation', value: Number(top.match[1]), unit: 'm AMSL', display: `${top.match[1]} m AMSL`, page: top.page, quote: top.quote });
    const site = find(pages, /\bsite\s+elevation\b[^\d]{0,60}?(\d{2,4}(?:\.\d+)?)\s*m/i);
    if (site) push(facts, { key: 'site_elevation', label: 'Site elevation', value: Number(site.match[1]), unit: 'm AMSL', display: `${site.match[1]} m AMSL`, page: site.page, quote: site.quote });
    const height = find(pages, /\bpermissible\s+height\s+above\s+ground(?:\s+level)?\b[^\d]{0,60}?(\d{1,3}(?:\.\d+)?)\s*m/i);
    if (height) push(facts, { key: 'permissible_height', label: 'Permissible height above ground', value: Number(height.match[1]), unit: 'm', display: `${height.match[1]} m`, page: height.page, quote: height.quote });
    const at = find(pages, /(\d{1,2})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)\s*N\s*[-,]?\s*(\d{1,3})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)\s*E\b/);
    if (at) {
      const [d1, m1, s1, d2, m2, s2] = at.match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
      const lat = d1 + m1 / 60 + s1 / 3600;
      const lng = d2 + m2 / 60 + s2 / 3600;
      if (lat <= 90 && lng <= 180) {
        push(facts, {
          key: 'site_coordinates',
          label: 'Site coordinates',
          value: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          display: `${d1}°${m1}′${s1}″N, ${d2}°${m2}′${s2}″E`,
          page: at.page,
          quote: at.quote,
        });
      }
    }
  },

  fire_noc(pages, facts, flags) {
    nocCommon(pages, facts, flags, (by) => (by ? `The ${by} NOC` : 'The fire NOC'));
    const height = find(pages, /\bheight\s+of\s+(?:the\s+)?building\b[^\d\n]{0,30}(\d{1,3}(?:\.\d+)?)\s*m/i);
    if (height) push(facts, { key: 'building_height', label: 'Building height cleared', value: Number(height.match[1]), unit: 'm', display: `${height.match[1]} m`, page: height.page, quote: height.quote });
  },

  legal_opinion(pages, facts, flags) {
    const on = letterDate(pages);
    if (on) push(facts, { key: 'issued_on', label: 'Dated', value: on.iso, display: displayDate(on.iso), page: on.page, quote: on.quote });
    const to = addressee(pages);
    if (to) push(facts, { key: 'issued_to', label: 'Addressed to', value: to.value, display: to.value, page: to.page, quote: to.quote });
    const sub = subject(pages);
    if (sub) push(facts, { key: 'subject', label: 'Subject', value: sub.value, display: sub.value, page: sub.page, quote: sub.quote });
    const covered = surveyList(pages);
    if (covered) push(facts, { key: 'covered_survey_numbers', label: 'Survey numbers covered', value: covered.values.join(', '), display: listDisplay(covered.values), page: covered.page, quote: covered.quote });
    // The enrolment the opinion is signed under: KAR/1234/2005 and its variants.
    const enrolment = find(pages, /\b(?:Enrol(?:l)?ment|Enrl\.?|Regn\.?)\s*No\.?\s*[:.]?\s*((?:KAR|KA|MAH|MH|TN|AP|TS|D)\s*[/.-]?\s*\d{1,6}\s*[/.-]\s*\d{2,4})/i);
    if (enrolment) {
      const value = enrolment.match[1]!.replace(/\s+/g, '');
      push(facts, { key: 'enrolment_number', label: 'Enrolment number', value, display: value, page: enrolment.page, quote: enrolment.quote });
    }
    // Who signed: the name over "Advocate" at the foot of the opinion.
    const signed = find(pages, /\n\s*\(?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,4})\s*\)?\s*,?\s*\n\s*Advocates?\b/);
    if (signed) {
      const value = signed.match[1]!.trim();
      push(facts, { key: 'advocate', label: 'Advocate', value, display: value, page: signed.page, quote: signed.quote });
    }
    const clear =
      find(pages, /\b(clear(?:,)?\s+(?:(?:valid|legal|absolute|good)(?:,)?\s+)*(?:(?:and|&)\s+)?marketable)\s+title\b/i)
      ?? find(pages, /\btitle\b[^.\n]{0,80}?\bis\s+(clear(?:,?\s+(?:valid\s+)?(?:and|&)\s+marketable)?)\b/i);
    const subjectTo = find(pages, /\b(?:title|opinion)\b[^.\n]{0,120}\bsubject\s+to\b([^.\n]{4,200})/i);
    const notClear = find(pages, /\b(?:not|no)\s+(?:a\s+)?(?:clear|marketable)\s+title\b|\btitle\s+is\s+(?:defective|not\s+clear)\b/i);
    if (notClear) {
      push(facts, { key: 'title_conclusion', label: 'Opinion', value: 'not clear', display: 'Title not clear', page: notClear.page, quote: notClear.quote });
      flags.push({ severity: 'critical', title: 'The opinion does not call the title clear', description: 'The advocate’s opinion says the title is not clear or not marketable.', page: notClear.page, quote: notClear.quote });
    } else if (clear) {
      const conditioned = Boolean(subjectTo);
      push(facts, { key: 'title_conclusion', label: 'Opinion', value: conditioned ? 'clear subject to conditions' : 'clear and marketable', display: conditioned ? 'Clear and marketable, subject to conditions' : 'Clear and marketable', page: clear.page, quote: clear.quote });
      if (subjectTo) push(facts, { key: 'opinion_conditions', label: 'Subject to', value: subjectTo.match[1]!.trim(), display: subjectTo.match[1]!.trim(), page: subjectTo.page, quote: subjectTo.quote });
    }
  },

  company_incorporation(pages, facts) {
    const cin = find(pages, /\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/);
    if (cin) push(facts, { key: 'cin', label: 'Corporate identification number', value: cin.match[1]!, display: cin.match[1]!, page: cin.page, quote: cin.quote });
    // A scan breaks a name across lines ("SOBHA\nLIMITED"): the name runs to
    // "with effect" or a full stop, and its line breaks are spaces.
    const renamed = find(pages, /\bname\s+of\s+the\s+company\s+has\s+been\s+changed\s+from\s+([A-Z][A-Z0-9&.'\s-]+?)\s+to\s+([A-Z][A-Z0-9&.'\s-]+?)(?=\s+with\s+effect|\s*[,.](?:\s|$))/i);
    if (renamed) {
      const now = renamed.match[2]!.replace(/\s+/g, ' ').trim();
      const was = renamed.match[1]!.replace(/\s+/g, ' ').trim();
      push(facts, { key: 'company_name', label: 'Company', value: now, display: now, page: renamed.page, quote: renamed.quote });
      push(facts, { key: 'former_name', label: 'Formerly', value: was, display: was, page: renamed.page, quote: renamed.quote });
    } else {
      const named = find(pages, /\bhereby\s+certify\s+that\s+([A-Z][A-Za-z0-9 &.'-]{3,80}?)\s+is\s+(?:this\s+day\s+)?incorporated\b/i);
      if (named) push(facts, { key: 'company_name', label: 'Company', value: named.match[1]!.trim(), display: named.match[1]!.trim(), page: named.page, quote: named.quote });
    }
    const roc = find(pages, /\bRegistrar\s+of\s+Companies,?\s*([A-Z][a-z]+)/);
    if (roc) push(facts, { key: 'registrar', label: 'Registered with', value: `Registrar of Companies, ${roc.match[1]}`, display: `Registrar of Companies, ${roc.match[1]}`, page: roc.page, quote: roc.quote });
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
    case 'rera_registration':
      parts.push(`${label}${get('rera_number') ? ` ${get('rera_number')}` : ''}`);
      if (get('rera_approved_on')) parts.push(`approved ${get('rera_approved_on')}`);
      if (get('rera_valid_until')) parts.push(`valid until ${get('rera_valid_until')}`);
      if (get('survey_numbers')) parts.push(get('survey_numbers')!);
      break;
    case 'environmental_clearance':
      parts.push(`${label}${get('clearance_number') ? ` ${get('clearance_number')}` : ''}${get('issued_on') ? ` of ${get('issued_on')}` : ''}`);
      if (get('issued_to')) parts.push(`to ${get('issued_to')}`);
      if (get('valid_until')) parts.push(`valid until ${get('valid_until')}`);
      break;
    case 'utility_noc':
    case 'aviation_noc':
    case 'fire_noc':
      parts.push(`${label}${get('issued_by') ? ` from ${get('issued_by')}` : ''}${get('issued_on') ? `, ${get('issued_on')}` : ''}`);
      if (get('permissible_top_elevation')) parts.push(`top elevation ${get('permissible_top_elevation')}`);
      if (get('power_load')) parts.push(get('power_load')!);
      if (get('valid_until')) parts.push(`valid until ${get('valid_until')}`);
      break;
    case 'legal_opinion':
      parts.push(`${label}${get('issued_on') ? ` dated ${get('issued_on')}` : ''}`);
      if (get('advocate')) parts.push(`by ${get('advocate')}`);
      if (get('title_conclusion')) parts.push(get('title_conclusion')!);
      break;
    case 'company_incorporation':
      parts.push(label);
      if (get('company_name')) parts.push(get('company_name')!);
      if (get('cin')) parts.push(`CIN ${get('cin')}`);
      break;
    default:
      parts.push(label);
      if (get('survey_numbers')) parts.push(get('survey_numbers')!);
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * The one line for a reading whose facts have changed since the rules wrote
 * it: a value left out because its words could not be made out, or replaced
 * by one read off the page by another reader, must leave the line as well.
 */
export function summariseReading(type: ReadDocumentType, facts: DocumentFact[], flags: DocumentFlag[]): string {
  return summarise(type, (type === 'other' ? OTHER : PROFILES[type]).label, facts, flags);
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

/**
 * The shared document kind a reading's label stands for, when it has one.
 * `undefined` for a label nobody reads to, or one with no kind of its own.
 */
export function documentKindForLabel(label: string | undefined): DocumentKind | undefined {
  if (!label) return undefined;
  const profile = (Object.values(PROFILES) as TypeProfile[]).find((p) => p.label.toLowerCase() === label.toLowerCase());
  return profile && profile.documentKind !== 'other' ? profile.documentKind : undefined;
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

/* ==================================================================== */
/* The same keys, for a reader that is not these rules                   */
/* ==================================================================== */

/** The form a value under a key is kept in, whoever read it. */
export type FactForm = 'words' | 'lower' | 'identifier' | 'date' | 'rupees' | 'sqm' | 'feet' | 'number' | 'yes_no';

/** The papers a standard key can be read off, in the rules' own names for them. */
export const STANDARD_PAPERS = [
  'sale_deed',
  'mother_deed',
  'encumbrance_certificate',
  'khata',
  'property_tax_receipt',
  'zoning_certificate',
  'conversion_order',
  'building_sanction',
  'survey_sketch',
  'occupancy_certificate',
  'rtc',
  'rera_registration',
] as const satisfies readonly ReadDocumentType[];

export type StandardPaper = (typeof STANDARD_PAPERS)[number];

const ANY_LAND_PAPER: StandardPaper[] = STANDARD_PAPERS.filter((paper) => paper !== 'property_tax_receipt');

interface StandardFactKey {
  label: string;
  form: FactForm;
  /**
   * The papers that carry the key. A key is taken only on one of them: the
   * date on a khata is not a deed's registration date, and the applicant on
   * an encumbrance certificate is not the owner.
   */
  papers: readonly StandardPaper[];
  /** What the key means, as a reader is told it. */
  says: string;
  /** The only values it takes, where it takes a few. */
  choices?: string[];
}

/**
 * The keys these rules file a fact under, for a reader that is not them.
 *
 * The rules know English labels, so a Kannada deed gives them nothing and a
 * model reads it instead. A model left to name its own fields calls the same
 * registration number `registrationNumber`, `docNo` or `deedNumber`, and a
 * value under a name of its own answers no check, cannot be set beside the
 * value the rules read, and cannot be scored. So the model is told these keys
 * (`standardKeyGuide`) and its values are put in the rules' own forms
 * (`standardFact`): a date as YYYY-MM-DD, an amount in rupees, an area in
 * square metres. Only keys whose meaning fits in a line are here; anything
 * else a model reads keeps the name the model gave it.
 */
export const STANDARD_FACT_KEYS: Record<string, StandardFactKey> = {
  survey_numbers: { label: 'Survey number', form: 'identifier', papers: ANY_LAND_PAPER, says: 'the survey number the document is about, as written (73/4); never a neighbour named in its boundaries' },
  extent_title: { label: 'Extent per title', form: 'sqm', papers: ['sale_deed', 'rtc'], says: 'the extent of land a deed conveys or a record of rights records' },
  registration_date: { label: 'Registered on', form: 'date', papers: ['sale_deed'], says: 'the date the document itself was registered or executed, not the date of an earlier deed it recites' },
  document_number: { label: 'Document number', form: 'identifier', papers: ['sale_deed', 'mother_deed'], says: 'the registration number of the document itself, not of an earlier deed it recites' },
  sub_registrar: { label: 'Sub-Registrar', form: 'words', papers: ['sale_deed'], says: 'where the document itself was registered: the place of the Sub-Registrar office, the place name alone' },
  consideration: { label: 'Sale consideration', form: 'rupees', papers: ['sale_deed', 'mother_deed'], says: 'the price paid' },
  stamp_duty: { label: 'Stamp duty', form: 'rupees', papers: ['sale_deed'], says: 'the stamp duty paid' },
  vendor: { label: 'Vendor', form: 'words', papers: ['sale_deed'], says: 'the seller: the name alone, without address or description' },
  purchaser: { label: 'Purchaser', form: 'words', papers: ['sale_deed'], says: 'the buyer: the name alone, without address or description' },
  boundary_north: { label: 'North boundary', form: 'words', papers: ['sale_deed'], says: 'what lies to the north, as the schedule writes it' },
  boundary_south: { label: 'South boundary', form: 'words', papers: ['sale_deed'], says: 'what lies to the south' },
  boundary_east: { label: 'East boundary', form: 'words', papers: ['sale_deed'], says: 'what lies to the east' },
  boundary_west: { label: 'West boundary', form: 'words', papers: ['sale_deed'], says: 'what lies to the west' },
  access_type: { label: 'Access', form: 'lower', papers: ['sale_deed'], says: 'how the land is reached', choices: ['public road', 'private road', 'right of way'] },
  ec_from: { label: 'EC searched from', form: 'date', papers: ['encumbrance_certificate'], says: 'the first day of the period an encumbrance certificate searched' },
  ec_to: { label: 'EC searched to', form: 'date', papers: ['encumbrance_certificate'], says: 'the last day of that period' },
  ec_transactions: { label: 'Transactions in the period', form: 'number', papers: ['encumbrance_certificate'], says: 'how many transactions an encumbrance certificate lists' },
  ec_nil: { label: 'Nil result', form: 'yes_no', papers: ['encumbrance_certificate'], says: 'yes when an encumbrance certificate certifies nil encumbrance; no when it lists a mortgage, charge, lien or attachment that nothing in it releases' },
  subsisting_charges: { label: 'Charges still subsisting', form: 'number', papers: ['encumbrance_certificate'], says: 'how many mortgages, charges, liens or attachments it lists that nothing in it releases' },
  khata_number: { label: 'Khata number', form: 'identifier', papers: ['khata'], says: 'the khata number' },
  khata_type: { label: 'Khata type', form: 'words', papers: ['khata'], says: 'the kind of khata', choices: ['A-Khata', 'B-Khata', 'E-Khata'] },
  owner: { label: 'Owner on record', form: 'words', papers: ['khata', 'rtc'], says: 'the owner a khata or a record of rights names: the name alone' },
  pid: { label: 'PID', form: 'identifier', papers: ['khata', 'property_tax_receipt'], says: 'the property identification number (PID)' },
  extent_khata: { label: 'Extent per khata', form: 'sqm', papers: ['khata'], says: 'the site area a khata records' },
  sas_number: { label: 'SAS application number', form: 'identifier', papers: ['property_tax_receipt'], says: 'the SAS application number on a property tax receipt' },
  tax_year: { label: 'Assessment year', form: 'words', papers: ['property_tax_receipt'], says: 'the assessment year, as written (2024-25)' },
  tax_paid: { label: 'Tax paid', form: 'rupees', papers: ['property_tax_receipt'], says: 'the amount of property tax paid' },
  tax_paid_on: { label: 'Paid on', form: 'date', papers: ['property_tax_receipt'], says: 'the date it was paid' },
  zoning: { label: 'Zoning in the plan in force', form: 'words', papers: ['zoning_certificate'], says: 'the land use the plan gives the land, as written' },
  permissible_far: { label: 'FAR permissible', form: 'number', papers: ['zoning_certificate'], says: 'the FAR the plan permits' },
  plan_in_force: { label: 'Plan in force', form: 'words', papers: ['zoning_certificate'], says: 'the plan a zoning certificate reads from, as written (Revised Master Plan 2031)' },
  road_width_ft: { label: 'Abutting road width', form: 'feet', papers: ['zoning_certificate', 'survey_sketch'], says: 'the width of the road the land abuts' },
  conversion_status: { label: 'DC conversion', form: 'lower', papers: ['conversion_order'], says: 'what a conversion order decides: converted when it grants conversion to non-agricultural use, agricultural when it refuses', choices: ['converted', 'agricultural'] },
  order_number: { label: 'Order number', form: 'identifier', papers: ['conversion_order'], says: 'the number of a conversion order' },
  conversion_date: { label: 'Date of the conversion order', form: 'date', papers: ['conversion_order'], says: 'the date of that order' },
  converted_use: { label: 'Converted to', form: 'lower', papers: ['conversion_order'], says: 'the use the land is converted to, in one English word (residential, commercial, industrial)' },
  sanction_number: { label: 'Sanction number', form: 'identifier', papers: ['building_sanction'], says: 'the number of a building plan sanction (LP number)' },
  sanction_date: { label: 'Date of sanction', form: 'date', papers: ['building_sanction'], says: 'the date of that sanction' },
  sanctioned_area: { label: 'Built-up area sanctioned', form: 'sqm', papers: ['building_sanction'], says: 'the built-up area sanctioned' },
  sanctioned_far: { label: 'FAR sanctioned', form: 'number', papers: ['building_sanction'], says: 'the FAR sanctioned' },
  sanctioned_extent: { label: 'Extent per sanctioned layout', form: 'sqm', papers: ['building_sanction'], says: 'the site area a sanction is for' },
  refuge_area_provided: { label: 'Refuge area provided', form: 'sqm', papers: ['building_sanction'], says: 'the refuge area a sanctioned plan provides' },
  extent_survey: { label: 'Extent per survey sketch', form: 'sqm', papers: ['survey_sketch'], says: 'the extent a survey sketch measures' },
  survey_date: { label: 'Surveyed on', form: 'date', papers: ['survey_sketch'], says: 'the date a survey sketch was prepared or measured' },
  oc_issued: { label: 'Occupancy certificate issued', form: 'yes_no', papers: ['occupancy_certificate'], says: 'yes when the document is an occupancy certificate that was issued; no when it says one was refused or not issued' },
  oc_date: { label: 'Date of the OC', form: 'date', papers: ['occupancy_certificate'], says: 'the date of an occupancy certificate' },
  rera_number: { label: 'RERA registration number', form: 'identifier', papers: ['rera_registration'], says: 'the RERA registration number of the project' },
  rera_valid_until: { label: 'Registration valid until', form: 'date', papers: ['rera_registration'], says: 'the last day a RERA registration is valid' },
};

/** The rest of the keys the rules file a value under: a paper's own, on no list a model is told. Each with the name and the form the rules give it. */
export const RULES_FACT_KEYS: Record<string, { label: string; form: FactForm }> = {
  advocate: { label: 'Advocate', form: 'words' },
  building_height: { label: 'Building height cleared', form: 'number' },
  carpet_area: { label: 'Carpet area', form: 'sqm' },
  cin: { label: 'Corporate identification number', form: 'identifier' },
  clearance_number: { label: 'Clearance number', form: 'identifier' },
  cleared_built_up_area: { label: 'Built-up area cleared', form: 'sqm' },
  cleared_units: { label: 'Units cleared', form: 'number' },
  company_name: { label: 'Company', form: 'words' },
  covered_survey_numbers: { label: 'Survey numbers covered', form: 'identifier' },
  former_name: { label: 'Formerly', form: 'words' },
  issued_by: { label: 'Issued by', form: 'words' },
  issued_on: { label: 'Issued on', form: 'date' },
  issued_to: { label: 'Issued to', form: 'words' },
  lease_start: { label: 'Lease starts', form: 'date' },
  leased_area: { label: 'Area let', form: 'sqm' },
  monthly_rent: { label: 'Monthly rent', form: 'rupees' },
  noc_reference: { label: 'Reference', form: 'identifier' },
  oc_partial: { label: 'Partial OC only', form: 'yes_no' },
  opinion_conditions: { label: 'Subject to', form: 'words' },
  permissible_height: { label: 'Permissible height above ground', form: 'number' },
  permissible_top_elevation: { label: 'Permissible top elevation', form: 'number' },
  power_load: { label: 'Power sanctioned', form: 'number' },
  project_name: { label: 'Project', form: 'words' },
  registrar: { label: 'Registered with', form: 'words' },
  rera_acknowledgement: { label: 'Application acknowledgement', form: 'identifier' },
  rera_approved_on: { label: 'Approved on', form: 'date' },
  rera_carpet_area: { label: 'RERA carpet area', form: 'sqm' },
  root_year: { label: 'Root of title', form: 'date' },
  saleable_area: { label: 'Saleable area', form: 'sqm' },
  site_coordinates: { label: 'Site coordinates', form: 'words' },
  site_elevation: { label: 'Site elevation', form: 'number' },
  subject: { label: 'Subject', form: 'words' },
  super_built_up_area: { label: 'Super built-up area', form: 'sqm' },
  title_conclusion: { label: 'Opinion', form: 'words' },
  title_origin: { label: 'How title arose', form: 'words' },
  valid_until: { label: 'Valid until', form: 'date' },
};

/** Whether a paper of this kind carries the key. A kind that is none of the standard papers carries none of them. */
export function standardKeyFits(key: string, paper: string | null | undefined): boolean {
  return Boolean(STANDARD_FACT_KEYS[key]?.papers.includes(paper as StandardPaper));
}

/**
 * Whether a row typed as this kind of paper carries a key: whether a value
 * under the key, sitting on that row, is a reading of that paper at all.
 *
 * A standard key is carried by its papers. The rules also read a survey
 * number off the kinds they have no parcel rule for, a lease, and a paper
 * they did not recognise, so those carry that one key. A key that is not a
 * standard key is a reader's own name for something and is bound to no paper.
 *
 * `documentType` is a row's type as the register holds it ("Sale deed"). A
 * row with no type, or one the rules have no name for, is a paper of no kind.
 */
export function paperCarries(documentType: string | undefined, key: string): boolean {
  const known = STANDARD_FACT_KEYS[key];
  if (!known) return true;
  const label = documentType?.toLowerCase();
  const type = (Object.keys(PROFILES) as Array<keyof typeof PROFILES>).find((kind) => PROFILES[kind].label.toLowerCase() === label) ?? 'other';
  if (known.papers.includes(type as StandardPaper)) return true;
  return key === 'survey_numbers' && (type === 'lease' || !BUILDERS[type]);
}

/** A width with its unit written straight after the number, in English. */
const LENGTH_WRITTEN = /^\d[\d,]*(?:\.\d+)?\s*(?:ft\.?|feet|foot|m\.?|mtrs?\.?|met(?:re|er)s?)(?![\p{L}\p{N}])/iu;

/**
 * Every measure some words state under a key kept as an area or a width: each
 * number that has a unit written straight after it, in the key's own form.
 * "2,450 square feet" is 228 sqm, "1 acre 22 guntas" is 6,273, "30 metres" is
 * 98 ft. Empty where no number in the words carries a unit these rules know:
 * a bare figure, or a unit written in another script.
 */
export function measuresStated(key: string, words: string): number[] {
  const form = STANDARD_FACT_KEYS[key]?.form;
  if (form !== 'sqm' && form !== 'feet') return [];
  const text = normalise(normalizeDigits(words));
  const out: number[] = [];
  for (const match of text.matchAll(/(?<![\d.,/-])\d[\d,]*(?:\.\d+)?/g)) {
    const from = text.slice(match.index);
    if (form === 'feet') {
      const written = LENGTH_WRITTEN.exec(from)?.[0];
      const feet = written ? standardFact(key, written)?.value : undefined;
      if (typeof feet === 'number') out.push(feet);
      continue;
    }
    // The longest run of words from the number that is an area: "1 acre 22 guntas" before "1 acre".
    const run = from.split(/\s+/).slice(0, 6);
    for (let n = run.length; n >= 1; n -= 1) {
      const sqm = areaInSqm(run.slice(0, n).join(' ').replace(/[\s.,;:)\]]+$/, ''));
      if (sqm !== null) {
        out.push(sqm);
        break;
      }
    }
  }
  return out;
}

/** How a reader that is not these rules writes a value, whichever key it is under. Said to every such reader in the same words. */
export function standardValueForms(): string {
  return (
    'Dates as DD-MM-YYYY. An amount as its digits in rupees. An area or a width as the number in "value" and its unit, in English, ' +
    'in "unit" (sqm, sqft, acres, guntas, ft, m); acres and guntas together as "1 acre 22 guntas". A count as a number. Yes or no as "yes" or "no".'
  );
}

/** The standard keys as a reader is told them: how to use them and write a value, the keys each paper carries, then what each key means. */
export function standardKeyGuide(): string {
  const how =
    'Say in "paper" which of the papers below the document is, or "other". Use only that paper\'s keys, each for exactly what it says; ' +
    'anything else the document states keeps a key of your own. ' +
    standardValueForms();
  const carried = STANDARD_PAPERS.map((paper) => `  - ${paper} (${PROFILES[paper].label}): ${Object.keys(STANDARD_FACT_KEYS).filter((key) => standardKeyFits(key, paper)).join(', ')}`);
  const keys = Object.entries(STANDARD_FACT_KEYS).map(([key, k]) => `  - ${key}: ${k.says}${k.choices ? `; one of: ${k.choices.join(', ')}` : ''}`);
  return [how, '  The papers and the keys each carries:', ...carried, '  What each key means:', ...keys].join('\n');
}

/** The standard paper a document of this kind is, where the rules have that kind by name. */
export function standardPaperOfKind(kind: DocumentKind): StandardPaper | undefined {
  return kind === 'other' ? undefined : STANDARD_PAPERS.find((paper) => PROFILES[paper].documentKind === kind);
}

/** The form a value under a standard key is kept in; undefined for a key that is not one. */
export function standardKeyForm(key: string): FactForm | undefined {
  return STANDARD_FACT_KEYS[key]?.form;
}

/**
 * An identifier without the label a page prints before it: "Survey No. 73/4"
 * and "ಸರ್ವೆ ನಂಬರ್ 73/4" are both filed as 73/4, as the rules file one.
 *
 * A label in English ends in "No." or "Number". A label in another script is
 * words of that script standing before the first Latin letter or digit; a
 * page's "exact words" for a number are handed over with theirs still on.
 */
function identifierAlone(text: string): string {
  return text
    .replace(/^(?:(?!\p{Script=Latin})[\p{L}\p{M}\u200c\u200d]+[\s:.,-]*)+(?=[\p{Script=Latin}\p{N}(])/u, '')
    .replace(/^[A-Za-z.\s]*\b(?:nos?|number)\b\.?\s*[:-]?\s*(?=\S)/i, '');
}

/** Letters and digits only, lower-cased: what two spellings of one value have in common. */
function bare(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

/**
 * A value another reader read under a standard key, in the form the rules keep
 * that key in. Null when it cannot be put in that form: a date that is not a
 * date is not filed as one.
 */
export function standardFact(key: string, value: string, unit?: string | null): Pick<DocumentFact, 'label' | 'value' | 'unit' | 'display'> | null {
  const known = STANDARD_FACT_KEYS[key];
  // A page in Kannada writes its dates, amounts and areas in Kannada digits; the forms below are in Latin ones.
  const text = normalise(normalizeDigits(value)).trim();
  if (!known || !text) return null;
  const { label, form, choices } = known;
  const first = /\d[\d,]*(?:\.\d+)?/.exec(text)?.[0];
  switch (form) {
    case 'date': {
      const iso = parseIndianDate(text);
      return iso ? { label, value: iso, display: displayDate(iso) } : null;
    }
    case 'rupees': {
      const amount = first ? parseAmount(first) : null;
      if (amount === null) return null;
      // "3.18 crore" is thirty-one million, not three.
      const rupees = Math.round(amount * (/\bcrores?\b|\bcr\b/i.test(text) ? 1e7 : /\blakhs?\b|\blacs?\b/i.test(text) ? 1e5 : 1));
      return { label, value: rupees, unit: 'INR', display: displayInr(rupees) };
    }
    case 'sqm': {
      const sqm = areaInSqm(unit && /\d\s*$/.test(text) ? `${text} ${unit}` : text);
      return sqm === null ? null : { label, value: sqm, unit: 'sqm', display: fmtSqm(sqm) };
    }
    case 'feet': {
      const n = first ? parseAmount(first) : null;
      if (n === null) return null;
      const ft = /^m(?:et|\b|$)/i.test((unit ?? '').trim()) || /\d\s*m(?:et(?:re|er)s?)?\b/i.test(text) ? Math.round(n * 3.28084) : n;
      return { label, value: ft, unit: 'ft', display: `${ft} ft` };
    }
    case 'number': {
      const n = first ? Number(first.replace(/,/g, '')) : NaN;
      return Number.isFinite(n) ? { label, value: n, display: String(n) } : null;
    }
    case 'yes_no': {
      const yes = /^(?:yes|true)\b/i.test(text);
      return yes || /^(?:no|false)\b/i.test(text) ? { label, value: yes, display: yes ? 'yes' : 'no' } : null;
    }
    default: {
      if (choices) {
        const chosen = choices.find((choice) => bare(text).includes(bare(choice)));
        return chosen ? { label, value: chosen, display: chosen } : null;
      }
      const words = form === 'lower' ? text.toLowerCase() : form === 'identifier' ? identifierAlone(text) : text;
      return { label, value: words, display: words };
    }
  }
}
