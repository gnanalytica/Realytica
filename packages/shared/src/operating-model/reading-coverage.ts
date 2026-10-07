/**
 * How much of a paper was read, said in words, and kept with the paper.
 *
 * A reading knows how many pages the file has, how many some reader got words
 * from, and what a model was sent (`ReadingCoverage`). Until that reached a
 * screen and the record, a forty-page scan read for eight pages looked like a
 * paper read whole, and a model that failed on it was never asked again.
 */

import type { ChatIngestFile, DdProject, EvidenceAttachment, ReadingCoverage } from './types';

/** "page 2", "pages 1 and 2", "pages 3 to 9 and 12". */
export function pagesNamed(pages: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    let end = i;
    while (pages[end + 1] === pages[end]! + 1) end += 1;
    runs.push(end - i >= 2 ? `${pages[i]} to ${pages[end]}` : String(pages[i]));
    if (end - i >= 2) i = end;
  }
  const list = runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}` : (runs[0] ?? '');
  return `${pages.length === 1 ? 'page' : 'pages'} ${list}`;
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string): string => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/**
 * A reading as this code can use it, or nothing.
 *
 * A reading is stored with its file and travels on a card, and a card's
 * payload is something a client can send. So nothing here is taken on trust:
 * the counts have to be counts, a page list a list of whole pages of the
 * file, a sentence a string. Anything else is dropped where it can be, and
 * the whole reading where the counts themselves are not sound. What comes out
 * has every list present, so nothing that reads it can fail on a missing one.
 */
export function soundReading(value: unknown): ReadingCoverage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100_000;
  if (!count(raw.pagesInFile) || raw.pagesInFile < 1 || !count(raw.pagesRead) || raw.pagesRead > raw.pagesInFile) return undefined;
  const of = raw.pagesInFile;
  const pages = (list: unknown): number[] | undefined =>
    Array.isArray(list) ? [...new Set(list.filter((page): page is number => count(page) && page >= 1 && page <= of))].sort((a, b) => a - b) : undefined;
  const sentence = (text: unknown): string | undefined => (typeof text === 'string' && text.trim() ? text.slice(0, 400) : undefined);
  const readers = (raw.readers && typeof raw.readers === 'object' ? raw.readers : {}) as Record<string, unknown>;
  const by = (n: unknown) => (count(n) ? Math.min(n, of) : 0);
  const sent = pages(raw.modelPagesSent);
  const read = pages(raw.modelPagesRead);
  const ocr = pages(raw.ocrPages);
  const failure = sentence(raw.modelFailure);
  const why = sentence(raw.unreadWhy);
  const loose = Array.isArray(raw.unverified) ? raw.unverified.filter(looseValue).slice(0, 20) : [];
  return {
    pagesInFile: of,
    pagesRead: raw.pagesRead,
    readers: { text: by(readers.text), ocr: by(readers.ocr), model: by(readers.model) },
    ...(ocr?.length ? { ocrPages: ocr } : {}),
    modelReasons: Array.isArray(raw.modelReasons) ? raw.modelReasons.flatMap((reason) => sentence(reason) ?? []).slice(0, 12) : [],
    modelPages: pages(raw.modelPages) ?? [],
    ...(sent ? { modelPagesSent: sent } : {}),
    ...(read ? { modelPagesRead: read } : {}),
    ...(failure ? { modelFailure: failure } : {}),
    ...(raw.modelChecksCut === true ? { modelChecksCut: true } : {}),
    ...(why ? { unreadWhy: why } : {}),
    ...(loose.length ? { unverified: loose as NonNullable<ReadingCoverage['unverified']> } : {}),
  };
}

/** A value kept apart as unverified has the few fields a screen shows of it, each of its own type. */
function looseValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const text = (t: unknown) => typeof t === 'string' && t.length <= 400;
  return text(v.key) && text(v.label) && text(v.display) && text(v.quote) && ['string', 'number', 'boolean'].includes(typeof v.value) && typeof v.page === 'number';
}

/**
 * What to say of a reading that was not whole, or that sent a model something
 * other than what was asked: "8 of 40 pages read: only the first 8 scanned
 * pages of a file are read here. No model has read the rest." Empty for a
 * paper read whole with nothing to add. Never throws: a reading that is not
 * one says nothing.
 */
export function readingLine(given: ReadingCoverage | undefined): string {
  const reading = soundReading(given);
  if (!reading) return '';
  const said: string[] = [];
  const sent = reading.modelPagesSent ?? [];
  if (reading.pagesRead < reading.pagesInFile) {
    said.push(`${reading.pagesRead} of ${reading.pagesInFile} pages read${reading.unreadWhy ? `: ${reading.unreadWhy}` : ''}.`);
    if (reading.modelFailure) said.push(`No model has read the rest: ${lowerFirst(reading.modelFailure)}`);
    else if (reading.modelPagesRead === undefined) said.push(reading.modelReasons.length ? 'No model has read the rest.' : '');
    else {
      // The model answered, and for some of what it was sent nothing it gave could be found on the page.
      const empty = sent.filter((page) => !reading.modelPagesRead!.includes(page));
      if (empty.length) said.push(`A model was sent ${pagesNamed(sent)}; nothing it gave for ${pagesNamed(empty)} was found there.`);
    }
  } else if (reading.modelFailure) {
    said.push(`A model was to read ${reading.modelPages.length && reading.modelPages.length < reading.pagesInFile ? pagesNamed(reading.modelPages) : 'it'} as well and did not: ${lowerFirst(reading.modelFailure)}`);
  } else if (reading.modelReasons.length && reading.modelPagesRead === undefined) {
    // Read whole on this server, and not well enough to stand alone: a page OCR was unsure of, a script the rules do not read.
    said.push(`${reading.modelReasons.join(' ')} No model has read ${reading.modelPages.length && reading.modelPages.length < reading.pagesInFile ? pagesNamed(reading.modelPages) : 'it'}.`);
  }
  if (sent.length) {
    const asked = new Set(reading.modelPages);
    const went = new Set(sent);
    const left = reading.modelPages.filter((page) => !went.has(page));
    const more = sent.filter((page) => !asked.has(page));
    if (left.length) said.push(`Only ${pagesNamed(sent)} went to the model: the file is too heavy to send whole, and ${pagesNamed(left)} did not go.`);
    else if (more.length && asked.size) said.push(`The whole file went to the model, ${pagesNamed(sent)}, where only ${pagesNamed(reading.modelPages)} needed it: the file could not be cut.`);
  }
  if (reading.modelChecksCut) said.push('The time allowed ran out before a second model had read every value’s page.');
  const loose = reading.unverified?.length ?? 0;
  if (loose) said.push(`${loose} ${loose === 1 ? 'value a model read' : 'values a model read'} could not be verified on the page, and ${loose === 1 ? 'is' : 'are'} kept apart as unverified.`);
  return said.filter(Boolean).join(' ');
}

/** Which pages of the file left this server for the model reader, for the paper's own screen. Empty when none did. */
export function sentToModelLine(given: ReadingCoverage | undefined): string {
  const reading = soundReading(given);
  const sent = reading?.modelPagesSent ?? [];
  if (!reading || !sent.length) return '';
  return sent.length >= reading.pagesInFile ? `All ${reading.pagesInFile === 1 ? 'of its one page' : `${reading.pagesInFile} pages`} went to the model reader.` : `${capital(pagesNamed(sent))} of ${reading.pagesInFile} went to the model reader.`;
}

/**
 * Whether a paper is worth reading again: the reading said a model was needed
 * for some of it, and no model has answered; or one answered and the time
 * allowed ran out before its values' pages were read a second time, which
 * left them unverified for want of a minute. One that answered and found
 * nothing on a page is not asked the same question twice.
 */
export function needsReadingAgain(given: ReadingCoverage | undefined): boolean {
  const reading = soundReading(given);
  return Boolean(reading && reading.modelReasons.length > 0 && (reading.modelPagesRead === undefined || reading.modelChecksCut));
}

/**
 * The same line as the chat says it, which can also say what to do: a paper a
 * model has still to read is read when the filed documents are read again.
 * Not where no model is set up (`modelReader` false): asking again there
 * reads the same pages to the same end, and the line says that instead.
 */
export function readingSaid(reading: ReadingCoverage | undefined, modelReader = true): string {
  const line = readingLine(reading);
  if (!line || !needsReadingAgain(reading) || /read the filed documents/i.test(line)) return line;
  return modelReader ? `${line} Ask to read the filed documents to carry on.` : `${line} No model reader is set up here to read them.`;
}

/** The lines a drop's reply says of the papers it could not read whole, one a paper. Empty when every one was. */
export function partlyReadSentence(files: readonly ChatIngestFile[], modelReader = true): string {
  return files
    .map((file) => [file.fileName, readingSaid(file.reading, modelReader)] as const)
    .filter(([, line]) => line)
    .map(([name, line]) => `\n${name}: ${line}`)
    .join('');
}

/**
 * The papers on file with pages nobody read, or that a model was to read and
 * has not, each with what its reading says: for the reply to "read the filed
 * documents" when there is nothing it can read. Rows nobody relies on are
 * left out, and so is a paper read whole whose reading only has more to add.
 */
export function partlyReadOnFile(project: DdProject): string[] {
  const out: string[] = [];
  for (const row of project.evidence) {
    if (row.status === 'rejected' || row.status === 'superseded') continue;
    const file = row.attachments[row.attachments.length - 1];
    const reading = soundReading(file?.reading);
    if (!file || !reading) continue;
    if (reading.pagesRead < reading.pagesInFile || reading.modelFailure || needsReadingAgain(reading)) out.push(`${file.fileName}: ${readingLine(reading)}`);
  }
  return out;
}

function attachmentFor(project: DdProject, storageKey: string): EvidenceAttachment | undefined {
  for (const row of project.evidence) {
    const held = row.attachments.find((a) => a.storageKey === storageKey);
    if (held) return held;
  }
  return undefined;
}

/**
 * A file's reading, laid over the one it already carries.
 *
 * The newer reading stands, unless it got words from fewer pages of the same
 * file than the one before: a second pass cut short by its deadline, or a
 * model sent the file with nothing this server read. Then the earlier count
 * of pages stands, since those pages were read and what they state is still
 * on the row: "8 of 10 pages read" is never overwritten by "1 of 10". What
 * the newer attempt has to tell of the model is added to it: the pages it was
 * sent and the ones it gave a value for, what could not be verified, that it
 * failed, or that its checks were cut. So a model that answered is not asked
 * the same question again for a count that did not move.
 */
export function mergeReading(before: ReadingCoverage | undefined, now: ReadingCoverage): ReadingCoverage {
  const earlier = soundReading(before);
  if (!earlier || earlier.pagesInFile !== now.pagesInFile || now.pagesRead >= earlier.pagesRead) return now;
  const { modelFailure: _failed, modelChecksCut: _cut, ...kept } = earlier;
  const both = (a: readonly number[] | undefined, b: readonly number[] | undefined) => (a || b ? [...new Set([...(a ?? []), ...(b ?? [])])].sort((x, y) => x - y) : undefined);
  const sent = both(kept.modelPagesSent, now.modelPagesSent);
  const read = both(kept.modelPagesRead, now.modelPagesRead);
  return {
    ...kept,
    ...(sent ? { modelPagesSent: sent } : {}),
    ...(read ? { modelPagesRead: read, readers: { ...kept.readers, model: read.length } } : {}),
    ...(now.unverified?.length ? { unverified: now.unverified } : {}),
    ...(now.modelFailure ? { modelFailure: now.modelFailure } : {}),
    ...(now.modelChecksCut ? { modelChecksCut: true } : {}),
  };
}

/**
 * Keep each file's reading with the file: on its attachment where it is on a
 * row already, else on the card that will file it, from where
 * `attachEvidenceFile` carries it onto the row when a person approves.
 */
export function keepReadings(project: DdProject, files: readonly ChatIngestFile[]): void {
  for (const file of files) {
    if (!file.reading) continue;
    const held = attachmentFor(project, file.storageKey);
    if (held) {
      held.reading = mergeReading(held.reading, file.reading);
      continue;
    }
    const card = [...(project.chatProposals ?? [])].reverse().find((p) => p.kind === 'file_evidence' && p.status === 'proposed' && p.payload.storageKey === file.storageKey);
    if (card) card.payload.reading = file.reading;
  }
}

/**
 * The reading waiting on a file's card, for the moment the file is attached.
 * Only a sound one (`soundReading`): a card's payload is not this server's
 * word for anything until it is checked.
 */
export function readingWaitingFor(project: DdProject, storageKey: string): ReadingCoverage | undefined {
  const card = [...(project.chatProposals ?? [])].reverse().find((p) => p.kind === 'file_evidence' && p.payload.storageKey === storageKey && p.payload.reading);
  return soundReading(card?.payload.reading);
}
