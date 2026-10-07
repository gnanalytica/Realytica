/**
 * How well Realytica reads a scanned paper, as numbers that can be compared
 * from one run to the next.
 *
 *   pnpm eval:reading
 *   pnpm eval:reading -- --only sale-deed,khata --rendering poor,turned --script en
 *   pnpm eval:reading -- --with-model
 *
 * It writes each invented paper (`papers.ts`) as six files (`render.ts`),
 * hands every file to the reader the product runs on an upload, with no model
 * and no network (`readIngestLocally`: text layer, then OCR, then the rules),
 * and scores what comes back against what the page states (`score.ts`).
 *
 * `--with-model` goes on as an upload does when a model is configured: the
 * files the reader's own router picks (`needsModelReading`) are read by the
 * model reader too, and the two readings merged. It spends money, a little:
 * see `MODEL` below for what is loaded, what is sent and where it stops.
 *
 * A sixth row, "as typed", gives the rules the paper's own words with no file
 * in between. It is the ceiling: a field missed there is missed by the rules,
 * and no better reading of a scan will find it.
 *
 * This measures; it does not judge. It exits 0 whatever the scores, and only
 * fails when the eval itself is broken, because a broken fixture scored as a
 * reading is the one number here that would be worse than none.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { enrichIngestWithDocumentIntelligence } from '@realytica/agents';
import { createProject, parseDocumentText, STANDARD_FACT_KEYS, type ChatIngestFile } from '@realytica/shared';
import { mergeModelReading, needsModelReading, readIngestLocally } from '../../apps/api/src/documents/intake';
import { releaseOcr } from '../../apps/api/src/documents/read-text';
import { conditionsPage, LONG_SCAN_PAGES_BETWEEN, PAPERS, type Paper, type Script, type Value } from './papers';
import { CHARACTERS, loadFonts, render, RENDERINGS, SCAN_DPI, typed, type Rendering } from './render';
import { scoreFields, wordsRead, type FieldScore, type Share } from './score';

const RESULTS = 'evals/reading/results.json';
/** A run with the model is kept apart: it costs money to repeat, and it is compared with the run without. */
const RESULTS_WITH_MODEL = 'evals/reading/results.with-model.json';
/** Where the files and what was read from them are kept, so the page behind a score can be opened. Ignored by git with node_modules. */
const FILES = 'node_modules/.cache/reading-eval';
/** One of the rules' own keys: a value under one of these that the page does not state is a wrong value, not a find. */
const standardKey = (key: string): boolean => key in STANDARD_FACT_KEYS;
/**
 * The name every file is read under. The reader takes a hint from a file's
 * name about what the paper is, and a name is not something read off a page.
 */
const FILE_NAME = 'document.pdf';

type Row = 'typed' | Rendering;
const ROWS: Row[] = ['typed', ...RENDERINGS];
const ROW_NAME: Record<Row, string> = { typed: 'as typed', text: 'text PDF', clean: 'clean scan', ruled: 'ruled scan', poor: 'poor scan', turned: 'turned 90', long: 'long scan' };
const SCRIPT_NAME: Record<Script, string> = { en: 'English', kn: 'Kannada' };

interface Case {
  paper: string;
  script: Script;
  rendering: Row;
  kind: string;
  /** What the reader took the paper for; `nothing` when no text came back. */
  readAs: string;
  /** The reader's own sentence for why it read nothing. */
  failure?: string;
  method?: string;
  ocrConfidence?: number;
  pagesInFile: number;
  /** Pages that came back with any text. */
  pagesRead: number;
  pagesSentToOcr: number;
  seconds: number;
  fields: FieldScore[];
  words: { latin: Share; kannada: Share };
  /** Why the reader's router would send the file to the model reader. Empty: it would not. */
  modelReasons?: string[];
  /** The pages the model reader was sent, and those it gave a value for that was found on the page, in a run with the model. */
  modelPagesSent?: number[];
  modelPagesRead?: number[];
  /** Why the model reader gave nothing, when it was asked and did. */
  modelFailure?: string;
  /** How many values the model reader gave that nothing stands behind: a second reading differed or could not be made, or the value was not in its own quote. They are in no score: none is a fact. */
  unverified?: number;
  /** What became of the model reader's values when each was looked for on its page, as the reader itself reports it. Kept under the name the first run wrote it by. */
  modelQuotes?: string;
}

/* -------------------------------------------------------------------- */
/* The model reader, when asked for                                      */
/* -------------------------------------------------------------------- */

/**
 * A run with `--with-model`.
 *
 * What it loads: from `.env.local` at the repository root, the model endpoint
 * and nothing else in that file: `REALYTICA_API_KEY`, `REALYTICA_BASE_URL`,
 * every `REALYTICA_MODEL_*` and `REALYTICA_PRICING`. A name already set in the
 * shell is left as it is. No value is printed, here or by anything this run
 * calls: what is written to the terminal passes through `hush`.
 *
 * What it sends: the pages of the invented papers that the router names, as a
 * PDF of those pages, to that endpoint; then one page at a time, where a
 * value has to be read a second time, with the names of what to read. Nothing real is in any of them.
 *
 * Where it stops: every request to the endpoint is counted where it leaves,
 * and past `cap` none does. A file whose reading is refused there keeps the
 * reading it had without the model.
 */
const MODEL = {
  on: false,
  cap: 200,
  calls: 0,
  refused: 0,
  /** What the endpoint said its answers cost, where it said; and what this app's own rates make of the tokens. */
  reported: 0,
  reportedCalls: 0,
  priced: 0,
  pricedExactly: true,
  pricedCalls: 0,
  pending: [] as Promise<void>[],
  /** The values that must not be printed, each with the name to print in its place. */
  secrets: [] as Array<[string, string]>,
};

const MODEL_SETTING = (name: string): boolean =>
  name === 'REALYTICA_API_KEY' || name === 'REALYTICA_BASE_URL' || name === 'REALYTICA_PRICING' || name.startsWith('REALYTICA_MODEL_');

/** Whatever is about to be printed, with any loaded value replaced by its name. */
function hush(text: string): string {
  return MODEL.secrets.reduce((out, [value, name]) => out.split(value).join(`<${name}>`), text);
}

function loadModelSettings(): void {
  if (!existsSync('.env.local')) throw new Error('--with-model reads the model endpoint from .env.local at the repository root, and there is none.');
  const loaded: string[] = [];
  const kept: string[] = [];
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !MODEL_SETTING(match[1]!)) continue;
    const value = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
    if (!value) continue;
    if (process.env[match[1]!]) kept.push(match[1]!);
    else {
      process.env[match[1]!] = value;
      loaded.push(match[1]!);
    }
  }
  // Longest first, so a value that holds another is replaced whole.
  MODEL.secrets = Object.entries(process.env)
    .filter(([name, value]) => MODEL_SETTING(name) && value && value.length >= 4)
    .map(([name, value]) => [value!, name] as [string, string])
    .sort((a, b) => b[0].length - a[0].length);
  for (const stream of ['log', 'info', 'warn', 'error'] as const) {
    const write = console[stream].bind(console);
    console[stream] = (...parts: unknown[]) => write(...parts.map((part) => (typeof part === 'string' ? hush(part) : part instanceof Error ? hush(part.message) : part)));
  }
  if (!process.env.REALYTICA_API_KEY && !process.env.REALYTICA_BASE_URL) throw new Error('.env.local sets neither REALYTICA_API_KEY nor REALYTICA_BASE_URL, so there is no model to ask.');
  console.log(`Model settings from .env.local, values not shown: ${loaded.join(', ') || 'none'}.${kept.length ? ` Already set in the shell and left alone: ${kept.join(', ')}.` : ''}`);
  if (!process.env.REALYTICA_MODEL_EXTRACTION) console.log('  REALYTICA_MODEL_EXTRACTION is not set: the reader runs on the build\'s default model name for that tier.');
  if (!process.env.REALYTICA_MODEL_PAGE_CHECK) console.log('  REALYTICA_MODEL_PAGE_CHECK is not set: the second reading of a page is made by the same model as the first.');
}

/**
 * Count every request to the model endpoint where it leaves, and let none
 * leave past the cap. Counted here and not in the reader, so that nothing the
 * reader does (a retry, a second reading of a page) goes uncounted.
 */
function meterModelCalls(): void {
  const send = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/\/v1\/messages(?:\?|$)/.test(url)) return send(input, init);
    if (MODEL.calls >= MODEL.cap) {
      MODEL.refused += 1;
      throw new Error(`The reading eval's cap of ${MODEL.cap} model calls was reached.`);
    }
    MODEL.calls += 1;
    const response = await send(input, init);
    // A gateway says what an answer cost in its usage; Anthropic itself does not.
    MODEL.pending.push(
      response.clone().text().then((body) => {
        const costs = [...body.matchAll(/"cost"\s*:\s*([0-9]+(?:\.[0-9]+)?(?:e-?[0-9]+)?)/gi)].map((m) => Number(m[1]));
        if (!costs.length) return;
        MODEL.reported += Math.max(...costs);
        MODEL.reportedCalls += 1;
      }).catch(() => undefined),
    );
    return response;
  };
}

/** The invented project the model reader is told the papers belong to. */
const PROJECT = createProject({ name: 'Reading eval', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-EVAL');

/* -------------------------------------------------------------------- */
/* Before anything is scored                                             */
/* -------------------------------------------------------------------- */

/**
 * Refuse to run on a paper the eval itself would get wrong.
 *
 * A character neither font has is drawn as an empty box; a condition that
 * reads as a fact is counted against the reader on every long scan; a file
 * name that hints at a kind of paper answers a question the page was meant
 * to. Each would look like a reading failure and be a fixture bug.
 */
function checkPapers(scripts: Script[]): void {
  const problems: string[] = [];
  if (new Set(PAPERS.map((p) => p.id)).size !== PAPERS.length) problems.push('Two papers share an id.');
  for (const paper of PAPERS) {
    for (const script of scripts) {
      const sides = paper.text[script];
      if (!sides) continue;
      for (const line of [...sides.front, ...sides.back]) {
        if (!CHARACTERS.test(line)) problems.push(`${paper.id} (${script}) uses a character outside ASCII and Kannada: "${line}"`);
        if (script === 'en' && /[^\x20-\x7E]/.test(line)) problems.push(`${paper.id} (en) has a line that is not English: "${line}"`);
      }
    }
  }
  for (const script of scripts) {
    const pages = Array.from({ length: LONG_SCAN_PAGES_BETWEEN }, (_, n) => conditionsPage(script, n).join('\n'));
    if (!pages.every((page) => page.split('\n').every((line) => CHARACTERS.test(line)))) problems.push(`The ${script} conditions use a character outside ASCII and Kannada.`);
    const parsed = parseDocumentText(pages, FILE_NAME);
    if (parsed.type !== 'other' || parsed.facts.length) problems.push(`The ${script} conditions read as a ${parsed.type} with ${parsed.facts.length} fact(s); they must state nothing.`);
  }
  if (parseDocumentText(['A page.'], FILE_NAME).type !== 'other') problems.push(`The reader takes "${FILE_NAME}" for a kind of paper by its name alone.`);
  if (problems.length) throw new Error(`The papers are not fit to score:\n  ${problems.join('\n  ')}`);
}

/* -------------------------------------------------------------------- */
/* Reading                                                               */
/* -------------------------------------------------------------------- */

/**
 * One file through the reader, exactly as an upload goes through it: read
 * here, then, in a run with the model, read by the model reader where the
 * reader's own router says so, and the two readings merged.
 */
async function readFile(file: Uint8Array, model = MODEL.on) {
  let pages: string[] = [];
  let sentToOcr = 0;
  let quotes: string | undefined;
  const started = performance.now();
  let row: ChatIngestFile = await readIngestLocally(
    { fileName: FILE_NAME, mimeType: 'application/pdf', sizeBytes: file.length, storageKey: 'reading-eval' },
    Buffer.from(file),
    (step) => {
      if (step.label.startsWith('Running OCR')) sentToOcr += 1;
    },
    { onPages: (read) => (pages = read) },
  );
  if (model && needsModelReading(row)) {
    const [read] = await enrichIngestWithDocumentIntelligence({
      project: PROJECT,
      files: [{ ...row, read: undefined }],
      buffers: [Buffer.from(file)],
      pageTexts: [pages],
      // The reader says, as a step, what became of its values: found on their pages, not read there, not in their own quotes, or not checked.
      onStep: (step) => {
        quotes = /^Checked the values against their pages: (.*)$/.exec(step.label)?.[1] ?? quotes;
      },
      onSpend: (spend) => {
        MODEL.priced += spend.usd;
        MODEL.pricedExactly = MODEL.pricedExactly && spend.exact;
        MODEL.pricedCalls += 1;
      },
    });
    row = mergeModelReading(row, read);
  }
  return { row, pages, sentToOcr, quotes, seconds: (performance.now() - started) / 1000 };
}

async function runCase(paper: Paper, script: Script, rendering: Row): Promise<Case> {
  const printed = typed(paper, script, rendering === 'typed' ? undefined : rendering);
  const base = { paper: paper.id, script, rendering, kind: paper.kind, pagesInFile: printed.length };

  if (rendering === 'typed') {
    const parsed = parseDocumentText(printed, FILE_NAME);
    return {
      ...base,
      readAs: parsed.type,
      pagesRead: printed.length,
      pagesSentToOcr: 0,
      seconds: 0,
      fields: scoreFields(paper.truth, parsed.facts, standardKey),
      words: wordsRead(printed, printed),
    };
  }

  const file = await render(paper, script, rendering);
  const name = `${paper.id}.${script}.${rendering}`;
  writeFileSync(path.join(FILES, `${name}.pdf`), file);
  const { row, pages, sentToOcr, quotes, seconds } = await readFile(file);
  writeFileSync(path.join(FILES, `${name}.read.txt`), pages.map((page, n) => `[page ${n + 1}]\n${page}`).join('\n\n'));
  return {
    ...base,
    readAs: row.read?.type ?? 'nothing',
    failure: row.readFailure,
    method: row.read?.method,
    ocrConfidence: row.read?.ocrConfidence,
    // Pages some reader got words from: this server's, or in a run with the model, the model's.
    pagesRead: row.reading?.pagesRead ?? pages.filter((page) => page.trim()).length,
    pagesSentToOcr: sentToOcr,
    seconds,
    fields: scoreFields(paper.truth, row.read?.facts ?? [], standardKey),
    words: wordsRead(printed, pages),
    ...(row.reading?.modelReasons.length ? { modelReasons: row.reading.modelReasons } : {}),
    ...(row.reading?.modelPagesSent ? { modelPagesSent: row.reading.modelPagesSent } : {}),
    ...(row.reading?.modelPagesRead ? { modelPagesRead: row.reading.modelPagesRead } : {}),
    ...(row.reading?.modelFailure ? { modelFailure: row.reading.modelFailure } : {}),
    ...(row.reading?.unverified?.length ? { unverified: row.reading.unverified.length } : {}),
    ...(quotes ? { modelQuotes: quotes } : {}),
  };
}

/* -------------------------------------------------------------------- */
/* Adding up                                                             */
/* -------------------------------------------------------------------- */

interface Tally {
  papers: number;
  fields: number;
  correct: number;
  missed: number;
  invented: number;
  /** Two readers gave different values, both are held for a person to choose between, and one is the true one. */
  contested: number;
  /**
   * Of `invented`, the values under a key of the reader's own making that the
   * answer key does not have. The rules return none; the model reader does,
   * for whatever else a page states (a ward number, a village). They are not
   * wrong values: nothing here can say whether they are right. A value under
   * one of the rules' own keys that the page does not state is not among
   * them. That one is wrong.
   */
  otherKeys: number;
  /** Papers the reader took for what they are. */
  kindRight: number;
  pagesInFile: number;
  pagesRead: number;
  /** Seconds a page: per page sent to OCR, or per page of a file that needed none. */
  secondsPerPage: number;
  wordsLatin: Share;
  wordsKannada: Share;
}

/** A value under a key the reader made up, which the answer key cannot judge. */
const unscored = (f: FieldScore): boolean => f.outcome === 'invented' && f.want === undefined && f.standardKey === false;

/** The pages a reading spent its time on: those sent to OCR, or all of them in a file that needed none. */
const pagesWorked = (c: Case): number => c.pagesSentToOcr || c.pagesInFile;

function tally(cases: Case[]): Tally {
  const count = (outcome: FieldScore['outcome']) => cases.reduce((n, c) => n + c.fields.filter((f) => f.outcome === outcome).length, 0);
  const sum = (of: (c: Case) => number) => cases.reduce((n, c) => n + of(c), 0);
  const share = (of: (c: Case) => Share): Share => ({ found: sum((c) => of(c).found), of: sum((c) => of(c).of) });
  const worked = sum(pagesWorked);
  return {
    papers: cases.length,
    // A field is one the page states. A value invented for something it does not state adds to `invented` only.
    fields: sum((c) => c.fields.filter((f) => f.want !== undefined).length),
    correct: count('correct'),
    missed: count('missed'),
    invented: count('invented'),
    contested: count('contested'),
    otherKeys: cases.reduce((n, c) => n + c.fields.filter(unscored).length, 0),
    kindRight: cases.filter((c) => c.readAs === c.kind).length,
    pagesInFile: sum((c) => c.pagesInFile),
    pagesRead: sum((c) => c.pagesRead),
    secondsPerPage: worked ? Math.round((sum((c) => c.seconds) / worked) * 100) / 100 : 0,
    wordsLatin: share((c) => c.words.latin),
    wordsKannada: share((c) => c.words.kannada),
  };
}

const percent = (found: number, of: number): string => (of ? `${((found / of) * 100).toFixed(1)}%` : '-');

function table(head: string[], rows: string[][], leftColumns: number): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((cell, i) => (i < leftColumns ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ').trimEnd();
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/* -------------------------------------------------------------------- */
/* The run                                                               */
/* -------------------------------------------------------------------- */

function option(name: string): string[] | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : (process.argv[at + 1] ?? '').split(',').filter(Boolean);
}

function chosen<T extends string>(name: string, all: T[]): T[] {
  const asked = option(name);
  if (!asked) return all;
  const unknown = asked.filter((value) => !all.includes(value as T));
  if (unknown.length || !asked.length) throw new Error(`--${name} takes ${all.join(', ')}${unknown.length ? `; not ${unknown.join(', ')}` : ''}`);
  return all.filter((value) => asked.includes(value));
}

/** A short hash of some files, to say whether two runs measured the same thing. */
function hashOf(files: string[]): string {
  const hash = createHash('sha256');
  for (const file of files) hash.update(readFileSync(file));
  return hash.digest('hex').slice(0, 12);
}

const versionOf = (dependency: string): string => (JSON.parse(readFileSync(`apps/api/node_modules/${dependency}/package.json`, 'utf8')) as { version: string }).version;

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const papers = chosen('only', PAPERS.map((p) => p.id)).map((id) => PAPERS.find((p) => p.id === id)!);
  const rows = chosen<Row>('rendering', ROWS);
  const partial = Boolean(option('only') || option('rendering') || option('script'));
  MODEL.on = process.argv.includes('--with-model');
  if (MODEL.on) {
    MODEL.cap = Number(option('max-model-calls')?.[0] ?? MODEL.cap);
    if (!Number.isInteger(MODEL.cap) || MODEL.cap < 1) throw new Error('--max-model-calls takes a whole number of calls.');
    loadModelSettings();
    meterModelCalls();
    console.log(`  At most ${MODEL.cap} model calls in this run (--max-model-calls). Only the pages the reader's router names are sent.`);
  }
  const out = option('out')?.[0] ?? (partial ? undefined : MODEL.on ? RESULTS_WITH_MODEL : RESULTS);

  const { fonts, kannada, kannadaMissing } = loadFonts();
  const scripts = chosen<Script>('script', ['en', 'kn']).filter((script) => script === 'en' || kannada);
  checkPapers(scripts);
  mkdirSync(FILES, { recursive: true });

  const todo = scripts.flatMap((script) => papers.filter((paper) => paper.text[script]).flatMap((paper) => rows.map((rendering) => ({ paper, script, rendering }))));
  console.log(`Reading eval: ${papers.length} papers, ${todo.length} readings. Scans are ${SCAN_DPI} dpi; every file is read as "${FILE_NAME}".`);
  for (const font of fonts) console.log(`  ${font.script}: ${font.family} (${font.licence}), ${font.file}`);
  if (kannadaMissing) console.log(`  Kannada papers left out: ${kannadaMissing}`);
  console.log('  Telugu and Hindi are not rendered: the eval names no font for them, and the reader has OCR data for English and Kannada only.');
  if (scripts.includes('kn')) {
    const all = PAPERS.filter((paper) => paper.text.kn).flatMap((paper) => typed(paper, 'kn')).join('');
    console.log(`  Kannada papers: ${percent((all.match(/[\u0C80-\u0CFF]/g) ?? []).length, (all.match(/[\p{L}\p{M}]/gu) ?? []).length)} of their letters are Kannada. Names, numbers and dates are in Latin, the same ones the English papers print.`);
  }

  // Starting the OCR engine is paid once per language. It is paid here, so it is not billed to whichever paper comes first.
  if (rows.some((row) => row !== 'typed' && row !== 'text')) {
    for (const script of scripts) {
      const first = papers.find((paper) => paper.text[script]);
      if (first) await readFile(await render(first, script, 'clean'), false);
    }
  }

  const cases: Case[] = [];
  /*
   * What has been read so far, written after every file. A run with the model
   * costs money and can be cut off; what it had finished is here, with what
   * it had spent, and is not lost with it.
   */
  const progress = path.join(FILES, `progress.${MODEL.on ? 'with-model' : 'no-model'}.json`);
  for (const [n, { paper, script, rendering }] of todo.entries()) {
    const done = await runCase(paper, script, rendering);
    cases.push(done);
    writeFileSync(progress, JSON.stringify({ finished: cases.length, of: todo.length, modelCalls: MODEL.calls, costReportedUsd: MODEL.reported, cases }));
    const { correct, fields, invented, otherKeys, contested } = tally([done]);
    console.log(
      `[${String(n + 1).padStart(String(todo.length).length)}/${todo.length}] ${paper.id.padEnd(24)} ${script}  ${ROW_NAME[rendering].padEnd(11)} ${String(correct).padStart(2)}/${String(fields).padEnd(2)} correct, ${invented - otherKeys} wrong${contested ? `, ${contested} two offered` : ''}${otherKeys ? `, ${otherKeys} under other keys` : ''}, ` +
        `read as ${done.readAs}${rendering === 'typed' ? '' : `, ${done.pagesRead}/${done.pagesInFile} pages, ${done.seconds.toFixed(1)}s`}` +
        `${done.modelPagesRead ? `, model sent ${done.modelPagesSent?.length ?? 0} and read ${done.modelPagesRead.length}${done.unverified ? `, ${done.unverified} unverified` : ''}${done.modelQuotes ? ` (values: ${done.modelQuotes})` : ''}` : done.modelFailure ? `, the model gave nothing: ${done.modelFailure}` : done.modelReasons ? ', for the model' : ''}`,
    );
  }
  await releaseOcr();
  await Promise.all(MODEL.pending);

  /* ---- by rendering and script ---- */
  const files = (c: Case) => c.rendering !== 'typed';
  const groups = scripts.flatMap((script) => [
    ...rows.map((rendering) => ({ rendering: rendering as Row | 'all files', script, of: cases.filter((c) => c.script === script && c.rendering === rendering) })),
    { rendering: 'all files' as const, script, of: cases.filter((c) => c.script === script && files(c)) },
  ]);
  const byRenderingAndScript = groups.filter((g) => g.of.length).map((g) => ({ rendering: g.rendering, script: g.script, ...tally(g.of) }));

  // A run with the model is set beside the latest run without it; a run without, beside the one before.
  const before = MODEL.on ? RESULTS : out;
  const previous = before && !partial && existsSync(before) ? (JSON.parse(readFileSync(before, 'utf8')) as { ranAt: string; papersHash: string; byRenderingAndScript: typeof byRenderingAndScript }) : undefined;
  const papersHash = hashOf(['papers.ts', 'render.ts', 'score.ts'].map((file) => path.join('evals/reading', file)));

  console.log('\nBy rendering and script');
  console.log(
    table(
      ['Rendering', 'Script', 'Papers', 'Fields', 'Correct', 'Missed', 'Wrong', 'Two offered', 'Other keys', 'Right', 'Kind right', 'Pages read', 's/page', 'Latin words', 'Kannada words', ...(previous ? ['Right was'] : [])],
      byRenderingAndScript.map((t) => {
        const was = previous?.byRenderingAndScript.find((p) => p.rendering === t.rendering && p.script === t.script);
        const file = t.rendering !== 'typed';
        return [
          t.rendering === 'all files' ? t.rendering : ROW_NAME[t.rendering],
          SCRIPT_NAME[t.script],
          String(t.papers),
          String(t.fields),
          String(t.correct),
          String(t.missed),
          String(t.invented - t.otherKeys),
          String(t.contested),
          String(t.otherKeys),
          percent(t.correct, t.fields),
          `${t.kindRight}/${t.papers}`,
          file ? `${t.pagesRead}/${t.pagesInFile}` : '-',
          file ? t.secondsPerPage.toFixed(2) : '-',
          file ? percent(t.wordsLatin.found, t.wordsLatin.of) : '-',
          file ? percent(t.wordsKannada.found, t.wordsKannada.of) : '-',
          ...(previous ? [was ? percent(was.correct, was.fields) : '-'] : []),
        ];
      }),
      2,
    ),
  );
  if (previous) {
    console.log(`"Right was" is the run of ${previous.ranAt}${MODEL.on ? ', without the model' : ''}.${previous.papersHash === papersHash ? '' : ' The papers or the scoring have changed since, so the two are not like for like.'}`);
  }

  /* ---- by kind of paper ---- */
  const byPaper = scripts.flatMap((script) =>
    papers
      .filter((paper) => paper.text[script])
      .map((paper) => {
        const of = cases.filter((c) => c.paper === paper.id && c.script === script);
        return { paper: paper.id, script, each: rows.map((rendering) => ({ rendering, ...tally(of.filter((c) => c.rendering === rendering)) })), files: tally(of.filter(files)) };
      }),
  );
  console.log('\nBy kind of paper: fields correct in each rendering, then all its files together');
  console.log(
    table(
      ['Paper', 'Script', ...rows.map((row) => ROW_NAME[row]), 'Fields', 'Correct', 'Missed', 'Wrong', 'Two offered', 'Other keys', 'Right'],
      byPaper.map((p) => [
        p.paper,
        SCRIPT_NAME[p.script],
        ...p.each.map((t) => `${t.correct}/${t.fields}`),
        String(p.files.fields),
        String(p.files.correct),
        String(p.files.missed),
        String(p.files.invented - p.files.otherKeys),
        String(p.files.contested),
        String(p.files.otherKeys),
        percent(p.files.correct, p.files.fields),
      ]),
      2,
    ),
  );

  /* ---- what went wrong ---- */
  const show = (value: Value | Value[] | undefined) => (value === undefined ? 'nothing of the kind' : [value].flat().map((v) => JSON.stringify(v)).join(' or '));
  /** Every wrong value, one a reading: what the results file lists, so a count can be opened. */
  const wrongValues = cases.flatMap((c) =>
    c.fields
      .filter((f) => f.outcome === 'invented' && !unscored(f))
      .map((f) => ({ paper: c.paper, script: c.script, rendering: c.rendering, key: f.key, read: f.got, ...(f.other !== undefined ? { otherReading: f.other } : {}), pageSays: f.want ?? null })),
  );
  /** Every value two readers read differently, where one of the two is the true one. */
  const contestedValues = cases.flatMap((c) =>
    c.fields.filter((f) => f.outcome === 'contested').map((f) => ({ paper: c.paper, script: c.script, rendering: c.rendering, key: f.key, read: f.got, otherReading: f.other, pageSays: f.want ?? null })),
  );
  const inventions = new Map<string, Row[]>();
  for (const wrong of wrongValues) {
    const what =
      `${wrong.paper} (${wrong.script}) ${wrong.key}: read ${show(wrong.read)}${wrong.otherReading !== undefined ? ` and ${show(wrong.otherReading)}` : ''}, ` +
      (wrong.pageSays === null ? 'and the page states no such thing' : `the page says ${show(wrong.pageSays)}`);
    inventions.set(what, [...(inventions.get(what) ?? []), wrong.rendering]);
  }
  console.log(`\nWrong values${inventions.size ? '' : ': none'}`);
  for (const [what, where] of inventions) console.log(`  ${what}  [${where.map((row) => ROW_NAME[row]).join(', ')}]`);
  if (contestedValues.length) {
    const pairs = new Map<string, Row[]>();
    for (const pair of contestedValues) {
      const what = `${pair.paper} (${pair.script}) ${pair.key}: the rules read ${show(pair.read)}, the model ${show(pair.otherReading)}; the page says ${show(pair.pageSays ?? undefined)}`;
      pairs.set(what, [...(pairs.get(what) ?? []), pair.rendering]);
    }
    console.log('\nTwo values offered for a person to choose between, one of them right');
    for (const [what, where] of pairs) console.log(`  ${what}  [${where.map((row) => ROW_NAME[row]).join(', ')}]`);
  }
  /** A value under a key of the reader's own is listed apart: it may well be on the page. */
  const others = new Map<string, Set<string>>();
  for (const c of cases) {
    for (const field of c.fields.filter(unscored)) {
      const paper = `${c.paper} (${c.script})`;
      others.set(paper, (others.get(paper) ?? new Set()).add(field.key));
    }
  }
  if (others.size) {
    console.log('\nRead under keys of the reader\'s own, which the answer key cannot judge');
    for (const [paper, keys] of others) console.log(`  ${paper}: ${[...keys].join(', ')}`);
  }

  if (rows.includes('typed')) {
    const ceiling = cases
      .filter((c) => c.rendering === 'typed')
      .map((c) => ({ c, missed: c.fields.filter((f) => f.outcome === 'missed').map((f) => f.key) }))
      .filter(({ missed }) => missed.length);
    console.log(`\nMissed as typed, so by the rules and not by the reading${ceiling.length ? '' : ': none'}`);
    for (const { c, missed } of ceiling) console.log(`  ${c.paper} (${c.script}): ${missed.length === Object.keys(PAPERS.find((p) => p.id === c.paper)!.truth).length ? `all ${missed.length} fields` : missed.join(', ')}`);
  }

  const unread = cases.filter((c) => c.readAs === 'nothing');
  console.log(`\nFiles nothing was read from${unread.length ? '' : ': none'}`);
  for (const c of unread) console.log(`  ${c.paper} (${c.script}) ${ROW_NAME[c.rendering]}: ${c.failure ?? 'no reason given'}`);

  // An average hides the one page that takes two minutes.
  const perPage = (c: Case) => c.seconds / pagesWorked(c);
  console.log('\nSlowest files');
  for (const c of cases.filter(files).sort((a, b) => perPage(b) - perPage(a)).slice(0, 3)) {
    console.log(`  ${c.paper} (${c.script}) ${ROW_NAME[c.rendering]}: ${perPage(c).toFixed(1)}s a page, ${c.seconds.toFixed(1)}s in all`);
  }

  /* ---- what the router sends to the model reader, and what a run with it spent ---- */
  const routed = cases.filter((c) => c.modelReasons);
  console.log(`\nFiles the reader's router sends to the model reader: ${routed.length} of ${cases.filter(files).length}`);
  for (const group of groups.filter((g) => g.rendering !== 'all files' && g.rendering !== 'typed' && g.of.length)) {
    const sent = group.of.filter((c) => c.modelReasons);
    // One file's reasons stand for its group: the papers of a rendering go for the same ones.
    if (sent.length) console.log(`  ${ROW_NAME[group.rendering as Row]}, ${SCRIPT_NAME[group.script]}: ${sent.length} of ${group.of.length}. For one: ${sent[0]!.modelReasons!.join(' ')}`);
  }
  const model = MODEL.on
    ? {
        calls: MODEL.calls,
        cap: MODEL.cap,
        refusedAtCap: MODEL.refused,
        filesRead: cases.filter((c) => c.modelPagesRead).length,
        filesItGaveNothingFor: cases.filter((c) => c.modelFailure).length,
        pagesSent: cases.reduce((n, c) => n + (c.modelPagesSent?.length ?? 0), 0),
        pagesRead: cases.reduce((n, c) => n + (c.modelPagesRead?.length ?? 0), 0),
        valuesUnverified: cases.reduce((n, c) => n + (c.unverified ?? 0), 0),
        // In US dollars. `reported` is what the endpoint's own answers said; `priced` is this app's rates applied to the tokens.
        ...(MODEL.reportedCalls ? { costReportedUsd: Math.round(MODEL.reported * 10000) / 10000, callsThatReportedCost: MODEL.reportedCalls } : {}),
        ...(MODEL.pricedCalls ? { costPricedUsd: Math.round(MODEL.priced * 10000) / 10000, pricedExactly: MODEL.pricedExactly, callsPriced: MODEL.pricedCalls } : {}),
      }
    : undefined;
  if (model) {
    console.log(
      `\nThe model reader: ${model.calls} calls of at most ${model.cap}. ${model.pagesSent} pages of ${model.filesRead} files were sent; it gave a value found on the page for ${model.pagesRead} of them, ` +
        `and ${model.valuesUnverified} values kept apart as unverified.${model.filesItGaveNothingFor ? ` It gave nothing for ${model.filesItGaveNothingFor} files.` : ''}` +
        `${model.refusedAtCap ? ` ${model.refusedAtCap} further calls were refused at the cap, so some files went without it.` : ''}`,
    );
    console.log(
      model.costReportedUsd !== undefined
        ? `  Cost, as the endpoint's answers reported it: $${model.costReportedUsd.toFixed(4)} over ${model.callsThatReportedCost} of the calls.`
        : '  The endpoint\'s answers carried no cost.',
    );
    if (model.costPricedUsd !== undefined) console.log(`  Cost, by this app's rates for the tokens used: $${model.costPricedUsd.toFixed(4)}${model.pricedExactly ? '' : ', which leaves out calls on a model no rate is set for'}.`);
  }

  if (out) {
    const results = {
      eval: 'reading',
      ranAt: new Date().toISOString(),
      commit: commit(),
      // Which reading code was measured. Between a before and an after, this is what should differ.
      readerHash: hashOf([
        'apps/api/src/documents/read-text.ts',
        'apps/api/src/documents/intake.ts',
        'apps/api/src/documents/locate.ts',
        'packages/shared/src/operating-model/document-parse.ts',
        ...(MODEL.on ? ['packages/agents/src/agents/document-intelligence.ts', 'packages/agents/src/agents/page-check.ts', 'packages/agents/src/project/ingest-intelligence.ts'] : []),
      ]),
      // The papers, their rendering and the scoring. Where this differs, two runs are not like for like.
      papersHash,
      machine: `${process.platform} ${process.arch}, Node ${process.version}`,
      versions: { 'tesseract.js': versionOf('tesseract.js'), 'pdfjs-dist': versionOf('pdfjs-dist') },
      scanDpi: SCAN_DPI,
      fonts,
      scriptsLeftOut: [...(kannadaMissing ? [`Kannada: ${kannadaMissing}`] : []), 'Telugu and Hindi: no font named for them, and no OCR data in the reader'],
      ...(model ? { model } : {}),
    };
    // One row to a line, so that a later run's diff of this file is the rows that moved.
    const rowsOf = (name: string, of: unknown[]) => `  "${name}": [\n${of.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`;
    const lists = [
      rowsOf('byRenderingAndScript', byRenderingAndScript),
      rowsOf('byPaper', byPaper),
      // Every wrong value and every contested one, not their counts alone.
      rowsOf('wrongValues', wrongValues),
      rowsOf('contestedValues', contestedValues),
      rowsOf('cases', cases.map((c) => ({ ...c, seconds: Math.round(c.seconds * 100) / 100 }))),
    ];
    writeFileSync(out, `${JSON.stringify(results, null, 2).slice(0, -2)},\n${lists.join(',\n')}\n}\n`);
    console.log(`\nWritten to ${out}. The files read, and the text read from each, are in ${FILES}.`);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
