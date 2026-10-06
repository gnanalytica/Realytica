/**
 * Reading an uploaded file on this server, before any model is asked.
 *
 * The chat's upload turn used to have two outcomes: a model read the
 * document, or the card said "unread". On a deployment with no model — and on
 * one whose model is rate limited, or down — every deed, every EC, every
 * khata arrived unread. This is the floor underneath that: the words come
 * out of the file here (its text layer, or OCR of a scan), and
 * `parseDocumentText` says what the document is and what it states.
 *
 * It also says how much of the file it read and how well, and that decides
 * whether a model reads it too (`routeReading`): a page in Kannada, a page OCR
 * was unsure of, a page nobody read. A model's reading is laid over this one.
 * It may not take it away: a local reading that succeeded is never replaced by
 * a model's failure to read the same file.
 */

import { randomUUID } from 'node:crypto';
import type { AgentStep, ChatIngestFile, DocumentFact, IngestRead, ReadingCoverage } from '@realytica/shared';
import { normalizeDigits, pagesNamed, parseDocumentText, STANDARD_FACT_KEYS, standardKeyFits, summariseReading } from '@realytica/shared';
import { locateFacts, valueWords } from './locate';
import { readDocumentText, WEAK_WORD_CONFIDENCE, type DocumentText, type PageLayout, type PageRead } from './read-text';

function step(label: string, kind: AgentStep['kind'] = 'plan'): AgentStep {
  return { id: randomUUID(), at: new Date().toISOString(), kind, label };
}

/* ==================================================================== */
/* Each page's text, to be kept beside the file                          */
/* ==================================================================== */

/** One page of a paper that some reader read. */
export interface PaperPage {
  /** 1-based. */
  page: number;
  /**
   * Whose words `text` is: the file's own text layer, OCR, or the model
   * reader. The model reader hands back no page of text, so for a page only
   * it read, `text` is the passages it quoted from that page and no more.
   */
  reader: 'text' | 'ocr' | 'model';
  text: string;
  /** OCR's confidence in the page, 0..100. */
  confidence?: number;
}

/** A paper's pages as they are kept beside its file; see `./page-text`. */
export interface PaperPages {
  /** The version of this shape. */
  v: 1;
  fileName: string;
  readAt: string;
  pagesInFile: number;
  /** Pages some reader got words from, which is how many are in `pages`. */
  pagesRead: number;
  /** The pages that were read, in order. A page that is not here was not read. */
  pages: PaperPage[];
}

/*
 * A reading's pages travel with its ingest row without being part of it. The
 * row is streamed to the page and copied onto cards; the text of forty pages
 * belongs in neither. Held weakly, so a row nobody keeps takes its pages with it.
 */
const PAGES = new WeakMap<ChatIngestFile, PaperPages>();

/** Where each word sat on its page, with OCR's confidence in it: for judging a value a later reader lays over this one. Never stored. */
const LAYOUTS = new WeakMap<ChatIngestFile, PageLayout[]>();

/** The pages read for an ingest row this process read, to be stored beside its file. */
export function pagesOf(file: ChatIngestFile): PaperPages | undefined {
  return PAGES.get(file);
}

function pagesRead(fileName: string, text: DocumentText): PaperPages {
  const pages = (text.pageReads ?? []).flatMap((read): PaperPage[] => {
    const words = text.pages[read.page - 1]?.trim();
    if (read.reader === 'none' || !words) return [];
    return [{ page: read.page, reader: read.reader, text: words, ...(read.confidence !== undefined ? { confidence: read.confidence } : {}) }];
  });
  return { v: 1, fileName, readAt: new Date().toISOString(), pagesInFile: text.totalPages, pagesRead: pages.length, pages };
}

/**
 * Why pages went unread here, in words to show beside "8 of 40 pages read".
 * Each cause is said once, with what it left out.
 */
function whyUnread(pages: readonly PageRead[]): string | undefined {
  const left = (why: PageRead['unread']) => pages.filter((page) => page.reader === 'none' && page.unread === why).map((page) => page.page);
  const scanned = pages.filter((page) => page.reader === 'ocr').length;
  const said: string[] = [];
  if (left('past_ocr_limit').length) said.push(scanned === 1 ? 'only the first scanned page of a file is read here' : `only the first ${scanned} scanned pages of a file are read here`);
  if (left('past_page_limit').length) said.push(`only the first ${pages.length - left('past_page_limit').length} pages of a file are opened here`);
  if (left('out_of_time').length) said.push(`the reading ran out of time before ${pagesNamed(left('out_of_time'))}`);
  if (left('nothing_legible').length) said.push(`nothing legible was found on ${pagesNamed(left('nothing_legible'))}`);
  return said.length ? said.join('; ') : undefined;
}

function coverage(pages: PaperPages, route: ReadingRoute, reads: readonly PageRead[]): ReadingCoverage {
  const by = (reader: PaperPage['reader']) => pages.pages.filter((page) => page.reader === reader).map((page) => page.page);
  const ocr = by('ocr');
  const why = whyUnread(reads);
  return {
    pagesInFile: pages.pagesInFile,
    pagesRead: pages.pages.length,
    readers: { text: by('text').length, ocr: ocr.length, model: 0 },
    ...(ocr.length ? { ocrPages: ocr } : {}),
    modelReasons: route.reasons,
    modelPages: route.pages,
    ...(why ? { unreadWhy: why } : {}),
  };
}

/* ==================================================================== */
/* Which papers a model reads, and why                                   */
/* ==================================================================== */

export interface ReadingRoute {
  /** Why the paper goes to the model reader, each a plain sentence. Empty: it does not. */
  reasons: string[];
  /** The 1-based pages those reasons are about, in order: what the model reader is sent. */
  pages: number[];
}

const SCRIPTS: Array<[string, RegExp]> = [
  ['Kannada', /\p{Script=Kannada}/gu],
  ['Telugu', /\p{Script=Telugu}/gu],
  ['Devanagari', /\p{Script=Devanagari}/gu],
  ['Tamil', /\p{Script=Tamil}/gu],
  ['Malayalam', /\p{Script=Malayalam}/gu],
];

/**
 * The script a page is written in, when it is not Latin: a fifth of its
 * letters or more. A Kannada deed keeps its names and numbers in Latin, and an
 * English one may carry a Kannada seal; a fifth tells the two apart.
 */
function otherScript(text: string): string | undefined {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (letters < 20 || (letters - latin) / letters < 0.2) return undefined;
  const counted = SCRIPTS.map(([name, letter]) => [name, (text.match(letter) ?? []).length] as const).sort((a, b) => b[1] - a[1]);
  return counted[0]![1] > 0 ? counted[0]![0] : 'a script other than Latin';
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Whether a paper goes to the model reader, and why.
 *
 * The one place it is decided, for every way a file arrives. The reasons are
 * about how the paper was read, not about how much the rules made of it: a
 * page in a script the rules do not know, a page OCR was unsure of, a page
 * nobody read, a text layer that was not text. Each names its pages, and
 * only those pages are sent.
 *
 * What the rules made of it comes last, as it always did: a paper they did
 * not recognise, or found little in, is read by the model whole.
 */
export function routeReading(input: {
  /** How each page of the file was read. */
  pages: readonly PageRead[];
  /** Each page's words, `[0]` being page 1. */
  texts: readonly string[];
  /** Pages a value was left out on because OCR could not make out its words. */
  withheld?: readonly number[];
  /** What the rules made of it. Absent when nothing could be read. */
  read?: Pick<IngestRead, 'type' | 'confidence'> & { facts: readonly unknown[] };
}): ReadingRoute {
  const reasons: string[] = [];
  const named = new Set<number>();
  const say = (pages: number[], sentence: (pages: string, one: boolean) => string) => {
    if (!pages.length) return;
    pages.forEach((page) => named.add(page));
    reasons.push(sentence(pagesNamed(pages), pages.length === 1));
  };

  const scripts = new Map<string, number[]>();
  for (const page of input.pages) {
    const script = page.reader === 'none' ? undefined : otherScript(input.texts[page.page - 1] ?? '');
    if (script) scripts.set(script, [...(scripts.get(script) ?? []), page.page]);
  }
  for (const [script, pages] of scripts) say(pages, (which, one) => `${capital(which)} ${one ? 'is' : 'are'} in ${script}.`);

  const withheld = new Set(input.withheld ?? []);
  say(
    input.pages.filter((page) => page.reader === 'ocr' && (page.unsure || withheld.has(page.page))).map((page) => page.page),
    (which) => `OCR was unsure of ${which}.`,
  );

  const unread = input.pages.filter((page) => page.reader === 'none').map((page) => page.page);
  say(unread, (which, one) =>
    input.pages.length === 1
      ? 'Its one page could not be read here.'
      : `${input.pages.length - unread.length} of ${input.pages.length} pages read here; ${which} ${one ? 'was' : 'were'} not.`,
  );
  say(
    input.pages.filter((page) => page.layerDiscarded).map((page) => page.page),
    (which) => `The text stored in ${which} is not readable text.`,
  );

  // Last, what the rules made of the paper. A paper they made little of is read whole.
  const read = input.read;
  const thin = !read
    ? unread.length ? '' : 'Nothing in it could be read here.'
    : read.type === 'other' ? 'It was not recognised here.'
    : read.facts.length < 3 ? `${read.facts.length ? `Only ${read.facts.length}` : 'No'} fact${read.facts.length === 1 ? ' was' : 's were'} found in it here.`
    : read.confidence < 0.5 ? 'It is not clear here what kind of paper it is.'
    : '';
  if (thin) reasons.push(thin);
  if (!read || thin) input.pages.forEach((page) => named.add(page.page));

  return { reasons, pages: [...named].sort((a, b) => a - b) };
}

/**
 * A value read from words OCR could not make out is not a reading of the
 * page, and is left out.
 *
 * Measured on a crooked, stamped photocopy of a sale deed: the purchaser came
 * back as the stamp's own wording, the stamp duty a digit short, the vendor
 * with its last word broken. OCR scored those words at 10 to 55 out of 100 and
 * every word of every value it read correctly at 89 or more. A missed value is
 * a blank a person fills in; a wrong one looks like a reading.
 *
 * Only where the value's own words can be found on the page. A value worked
 * out from the page (a count, a yes or no) has none to judge it by.
 */
export function supportedFacts(facts: DocumentFact[], layout: PageLayout[] | undefined): { facts: DocumentFact[]; withheld: number[] } {
  const withheld: number[] = [];
  const kept = facts.filter((fact) => {
    const weak = valueWords(fact, layout).some((word) => word.confidence !== undefined && word.confidence < WEAK_WORD_CONFIDENCE);
    if (weak) withheld.push(fact.page);
    return !weak;
  });
  return { facts: kept, withheld: [...new Set(withheld)] };
}

/**
 * One file, read and understood, as the ingest row the chat builds cards from.
 * Never throws: a file that cannot be read comes back with `readFailure`.
 */
export async function readIngestLocally(
  file: ChatIngestFile,
  bytes: Buffer,
  onStep?: (step: AgentStep) => void,
  opts: {
    deadline?: number;
    onPage?: (page: number, of: number) => void;
    /** The text read, page by page, for a model reading to check its quotes against. */
    onPages?: (pages: string[]) => void;
  } = {},
): Promise<ChatIngestFile> {
  onStep?.(step(`Reading ${file.fileName}`));
  let text: Awaited<ReturnType<typeof readDocumentText>>;
  try {
    text = await readDocumentText(new Uint8Array(bytes), file.mimeType, file.fileName, {
      deadline: opts.deadline,
      onProgress: (label) => onStep?.(step(label, 'tool_call')),
      onPage: opts.onPage,
    });
  } catch {
    return { ...file, readFailure: 'The file could not be read.' };
  }
  const pages = pagesRead(file.fileName, text);
  /** The row with how much of the file was read, and its pages held for whoever stores them. */
  const done = (row: ChatIngestFile, route: ReadingRoute): ChatIngestFile => {
    const out = { ...row, reading: coverage(pages, route, text.pageReads ?? []) };
    PAGES.set(out, pages);
    if (text.layout) LAYOUTS.set(out, text.layout);
    return out;
  };
  if (text.method === 'none') {
    return done(
      { ...file, readFailure: text.failure ?? 'No legible text was found in the file.' },
      routeReading({ pages: text.pageReads ?? [], texts: text.pages }),
    );
  }
  opts.onPages?.(text.pages);
  const parsed = parseDocumentText(text.pages, file.fileName);
  // With where on its page each fact's words are, so it can be shown.
  const { facts, withheld } = supportedFacts(locateFacts(parsed.facts, text.layout), text.layout);
  const joined = text.pages.map((p, i) => (text.pages.length > 1 ? `[page ${i + 1}]\n${p}` : p)).join('\n\n');
  const noun = parsed.type === 'other' ? 'document' : /^[A-Z][a-z]/.test(parsed.label) ? parsed.label.toLowerCase() : parsed.label;
  const found = `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  onStep?.(
    step(
      `${file.fileName}: ${found}${facts.length ? `, ${facts.length} fact${facts.length === 1 ? '' : 's'} read` : ''}${text.method !== 'text' ? ' (OCR)' : ''}`,
      'tool_result',
    ),
  );
  const read: IngestRead = {
    type: parsed.type,
    label: parsed.label,
    confidence: parsed.confidence,
    method: text.method,
    ocrConfidence: text.ocrConfidence,
    facts,
    flags: parsed.flags,
    // The line was written from every fact the rules found; one that was left out leaves it too.
    summary: withheld.length ? summariseReading(parsed.type, facts, parsed.flags) : parsed.summary,
    rowHints: parsed.rowHints,
    scopes: parsed.scopes,
    evidenceKind: parsed.evidenceKind,
  };
  return done(
    {
      ...file,
      // The whole text, bounded — the place extractor, the classifier and any
      // later answer read it, and a 4 KB excerpt cut a deed off mid-schedule.
      excerpt: joined.slice(0, 20_000),
      pages: text.totalPages,
      kindHint: parsed.type === 'other' ? file.kindHint : parsed.documentKind !== 'other' ? parsed.documentKind : parsed.type,
      readFailure: undefined,
      read,
    },
    routeReading({ pages: text.pageReads ?? [], texts: text.pages, withheld, read }),
  );
}

/** How many values a model read and nobody could verify are kept with one paper. */
const MAX_UNVERIFIED = 20;

/**
 * A model's reading laid over the local one.
 *
 * Where the model read the file, its notes and quotes are kept alongside the
 * local facts. Where it failed (unconfigured, rate limited, timed out) the
 * local reading stands, because the document WAS read; and the reading says
 * that a model was asked and gave nothing, so the paper is not taken for one
 * read whole and is offered again.
 */
export function mergeModelReading(local: ChatIngestFile, model: ChatIngestFile | undefined): ChatIngestFile {
  if (!model) return local;
  if (model.readFailure) {
    if (!local.reading) return local.read ? local : { ...local, readFailure: model.readFailure };
    const failed: ChatIngestFile = { ...local, reading: { ...local.reading, modelFailure: model.readFailure }, ...(local.read ? {} : { readFailure: model.readFailure }) };
    carry(local, failed);
    return failed;
  }
  // The model read what the reader could not: the reader's failure is no
  // longer the news about this document, and keeping it threw the reading away.
  const { readFailure: _localFailure, ...rest } = local;
  /** What the rules took the paper for, where they could say. Their word for it stands over a model's. */
  const paper = local.read && local.read.type !== 'other' ? local.read.type : undefined;
  model = withoutWeakReadings(local, onPaper(model, paper));
  const base = model.modelFacts?.length ? rest : local;
  const read = mergeFacts(local, model);
  const pages = withModelPages(local, model, read);
  const merged: ChatIngestFile = {
    ...base,
    extractionNotes: model.extractionNotes ?? local.extractionNotes,
    quotes: [...(model.quotes ?? []), ...(local.quotes ?? [])].slice(0, 8),
    kindHint: paper ? local.kindHint : (model.kindHint ?? local.kindHint),
    // The count this server made by opening the file, where it made one.
    pages: local.pages ?? model.pages,
    ...(model.modelRead ? { modelRead: true } : {}),
    read,
    ...(pages.reading ? { reading: pages.reading } : {}),
  };
  if (pages.kept) PAGES.set(merged, pages.kept);
  const layout = LAYOUTS.get(local);
  if (layout) LAYOUTS.set(merged, layout);
  return merged;
}

/** What travels with a row and is no field of it, taken over to the row that replaces it. */
function carry(from: ChatIngestFile, to: ChatIngestFile): void {
  const pages = PAGES.get(from);
  if (pages) PAGES.set(to, pages);
  const layout = LAYOUTS.get(from);
  if (layout) LAYOUTS.set(to, layout);
}

/**
 * The model's reading without the values it gave under a key this kind of
 * paper does not carry, where the rules said what kind of paper it is.
 *
 * The model reader drops such a value by the kind it took the paper for
 * itself. Where the rules know better (a record of rights the model called an
 * encumbrance certificate), the rules' kind decides: a nil-encumbrance answer
 * read off a record of rights is not a reading of anything on it.
 */
function onPaper(model: ChatIngestFile, paper: string | undefined): ChatIngestFile {
  if (!paper) return model;
  const fits = (fact: DocumentFact) => !(fact.key in STANDARD_FACT_KEYS) || standardKeyFits(fact.key, paper);
  if ([...(model.modelFacts ?? []), ...(model.modelUnverified ?? [])].every(fits)) return model;
  return { ...model, modelFacts: model.modelFacts?.filter(fits), modelUnverified: model.modelUnverified?.filter(fits) };
}

/**
 * The model's reading without the values it took from words OCR could not
 * make out.
 *
 * For a page in another script the model is handed this server's OCR words,
 * because it reads Kannada text far better than Kannada print. It then leans
 * on them, mistakes and all: measured on a poor Kannada RTC, OCR read an
 * owner's name short, at 54 in 100, and the model gave the short name back
 * with its quote found on the page, being the page's own words. A value like
 * that is no surer than OCR was of it, so it is held to what a value the rules
 * read is held to (`supportedFacts`), and is kept apart as unverified.
 *
 * A value that has to be exact never comes this way: its quote is looked for
 * on the page image by a second reader, not among OCR's words (see
 * `QuoteToPlace.exact`). This is for the names and the words.
 *
 * Only on those pages. On a page in Latin script the model reads the print
 * itself, and its agreeing with a word OCR was unsure of is a second reading,
 * not a copy.
 */
function withoutWeakReadings(local: ChatIngestFile, model: ChatIngestFile): ChatIngestFile {
  const layout = LAYOUTS.get(local);
  if (!layout || !model.modelFacts?.length) return model;
  const handed = new Set((PAGES.get(local)?.pages ?? []).filter((page) => page.reader === 'ocr' && otherScript(page.text)).map((page) => page.page));
  const leaned = model.modelFacts.filter((fact) => fact.pageCheck === 'text' && handed.has(fact.page));
  const weak = new Set(leaned.filter((fact) => !supportedFacts([fact], layout).facts.length));
  if (!weak.size) return model;
  return {
    ...model,
    modelFacts: model.modelFacts.filter((fact) => !weak.has(fact)),
    modelUnverified: [...(model.modelUnverified ?? []), ...[...weak].map(({ pageCheck: _how, marks: _marks, ...fact }): DocumentFact => ({ ...fact, proof: 'unverified' }))],
  };
}

/** Every value in a reading that a model read and that was found on a page: a fact of its own, or set beside the rules' one. */
function modelValues(read: ChatIngestFile['read']): DocumentFact[] {
  return (read?.facts ?? []).flatMap((fact) => [fact, ...(fact.otherReading ? [fact.otherReading] : [])]).filter((fact) => fact.source === 'model');
}

/**
 * The pages and the count of them, once the model has answered.
 *
 * A page counts as read by the model only when a value came back for it that
 * was found on that page. Being sent is not being read: a model handed thirty
 * unread pages that returns two values has read two pages, and the paper is
 * still one read in part. A page no reader here got words from, and the model
 * did, is held with the passages it quoted from it as that page's text.
 */
function withModelPages(local: ChatIngestFile, model: ChatIngestFile, read: ChatIngestFile['read']): { reading?: ReadingCoverage; kept?: PaperPages } {
  const before = PAGES.get(local);
  const answered = model.reading;
  const from = local.reading ?? answered;
  if (!from || answered?.modelPagesRead === undefined) return { reading: local.reading, kept: before };
  const values = modelValues(read);
  // Only a page that was sent: a value is read from a page the model saw, or it was not read from a page.
  const wasSent = new Set(answered.modelPagesSent ?? []);
  const readByModel = [...new Set(values.map((fact) => fact.page))].filter((page) => !answered.modelPagesSent || wasSent.has(page)).sort((a, b) => a - b);
  const have = new Set((before?.pages ?? []).map((page) => page.page));
  const quoted = (page: number) => [...new Set(values.filter((fact) => fact.page === page).map((fact) => fact.quote))].join('\n');
  const pages = [
    ...(before?.pages ?? []),
    ...readByModel.filter((page) => !have.has(page)).map((page): PaperPage => ({ page, reader: 'model', text: quoted(page) })),
  ].sort((a, b) => a.page - b.page);
  // A row this process read no pages of, with a count somebody else made: the count is left as it is, and no pages are held for it.
  const counted = Boolean(before) || !local.reading;
  const kept: PaperPages | undefined = counted
    ? { ...(before ?? { v: 1, fileName: local.fileName, readAt: new Date().toISOString(), pagesInFile: from.pagesInFile }), pagesRead: pages.length, pages }
    : undefined;
  // Not a second copy of a value that is on the paper already, whoever read it there.
  const stands = (loose: DocumentFact) => (read?.facts ?? []).some((fact) => fact.key === loose.key && (sameValue(fact.value, loose.value) || (fact.otherReading && sameValue(fact.otherReading.value, loose.value))));
  const unverified = (model.modelUnverified ?? []).filter((loose) => !stands(loose)).slice(0, MAX_UNVERIFIED);
  const { modelFailure: _earlier, modelChecksCut: _cut, unverified: _before, ...standing } = from;
  return {
    reading: {
      ...standing,
      pagesRead: counted ? pages.length : from.pagesRead,
      readers: { ...from.readers, model: readByModel.length },
      ...(answered.modelPagesSent ? { modelPagesSent: answered.modelPagesSent } : {}),
      modelPagesRead: readByModel,
      // The second reader ran out of time: said on the reading, so the paper is taken again when the filed documents are read.
      ...(answered.modelChecksCut ? { modelChecksCut: true } : {}),
      ...(unverified.length ? { unverified } : {}),
    },
    kept,
  };
}

/** Letters and digits only, lower-cased: what two readings of one value have in common. */
function bare(value: DocumentFact['value']): string {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

/** A value's runs of digits, each kept apart: 73/4 is 73 and 4, never 734. */
function digitRuns(value: DocumentFact['value']): string {
  return (normalizeDigits(String(value)).match(/\d+/g) ?? []).join('-');
}

/**
 * Whether two readers read the same value. A number is the same number
 * however it is grouped; roughly the same is not the same, and neither are
 * two identifiers with the same digits cut differently.
 */
function sameValue(a: DocumentFact['value'], b: DocumentFact['value']): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  const number = (v: string | number) => (typeof v === 'number' ? v : /^[\d,.\s]+$/.test(v) ? Number(v.replace(/[,\s]/g, '')) : NaN);
  const [x, y] = [number(a), number(b)];
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) < 0.005 : bare(a) === bare(b) && digitRuns(a) === digitRuns(b);
}

/**
 * The local reading's facts, with what the model read set beside them.
 *
 * Where both read the same key and agree, the parser's fact stands: it is
 * deterministic and its marks are on the page. Where the model also kept the
 * page's original script, the original is carried onto it, so a Kannada name
 * keeps its Kannada form.
 *
 * Where they differ, neither is taken for the other. The rules cut their
 * value from words on the page; the model's value is here only because its
 * words were found on a page too. Two readings, each with its words, are a
 * choice for a person, so the model's is set beside the rules' fact
 * (`otherReading`) and both wait. Before this the model's value replaced the
 * rules' on any page the router had sent: "Survey No. 73/1" was held to be on
 * a page that prints 73/4 and took the place of the 73/4 the rules had read
 * there.
 *
 * A value the model could place on no page changes nothing here. It is not
 * among its facts at all: it is kept on the reading, as unverified, and a
 * value the rules read from the page is never removed on its account.
 *
 * Where the file had no readable text at all, the model's facts are the reading.
 */
function mergeFacts(local: ChatIngestFile, model: ChatIngestFile): ChatIngestFile['read'] {
  // With where its words sit, where this server has the page's words to find them among.
  const extra = locateFacts(model.modelFacts ?? [], LAYOUTS.get(local));
  if (!local.read) {
    if (!extra.length) return local.read;
    return {
      type: 'other',
      label: model.kindHint ? model.kindHint.replaceAll('_', ' ') : 'Document',
      confidence: 0.5,
      method: 'ocr',
      facts: extra,
      flags: [],
      summary: `${extra.length} fact${extra.length === 1 ? '' : 's'} read by the document reader, each on a page its quote was found on.`,
      rowHints: [],
      scopes: [],
      evidenceKind: 'document',
    };
  }
  if (!extra.length) return local.read;
  const byKey = new Map(extra.map((f) => [f.key, f]));
  const facts = local.read.facts.map((fact): DocumentFact => {
    const twin = byKey.get(fact.key);
    if (!twin) return fact;
    if (sameValue(twin.value, fact.value)) return !fact.originalValue && twin.originalValue ? { ...fact, originalValue: twin.originalValue, originalScript: twin.originalScript } : fact;
    return { ...fact, otherReading: twin };
  });
  const known = new Set(facts.map((f) => f.key));
  return { ...local.read, facts: [...facts, ...extra.filter((f) => !known.has(f.key))] };
}

/**
 * Which documents to ask a model about: the ones `routeReading` gave a reason
 * for when this server read them.
 *
 * A document read here soundly, with its facts, is filed with those facts, its
 * summary and its quotes, so asking a model about it again costs a call and,
 * nine documents in, a minute of somebody waiting for their cards.
 *
 * A row that carries no reading of its own (one this server did not read this
 * turn) is judged as it used to be: a model is for a document the reader did
 * not recognise, or read little from.
 */
export function needsModelReading(file: ChatIngestFile): boolean {
  if (file.reading) return file.reading.modelReasons.length > 0;
  return !file.read || file.read.type === 'other' || file.read.facts.length < 3 || file.read.confidence < 0.5;
}
