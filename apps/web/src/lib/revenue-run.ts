import { unacceptedWords, type ParcelBoundary, type RevenueMapRead, type SurveyNumberLine } from '@realytica/shared';

/*
 * Reading several survey numbers off the state's map, one after another, and
 * what the picker's lines show while that goes on.
 *
 * Kept apart from the picker that draws it, as plain functions with the
 * reader handed in, so that what happens when the third number of twelve is
 * not on the map — and which lines are ticked, which are one request, and
 * what a line still says once its read is gone — can be tested without a
 * map, a server or a screen.
 */

/** What reading one survey number came to. */
export type RevenueReadResult =
  | {
      ok: true;
      read: RevenueMapRead;
      /** Set when this read gave the project its boundary. */
      boundary: ParcelBoundary | null;
      note: string;
      /** The number resolved to a parcel that was already kept; nothing was read. */
      already?: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** Present when the map does not hold the number: the numbers there that start the same way. */
      near?: string[];
      /** How many seconds the server asked to be left alone for, when it turned the request away as one too many. */
      retryAfterS?: number;
      /** The parcel was read and not kept: the project's record has no room for another. Every number after would meet the same. */
      full?: boolean;
    };

/** Where one number's line stands, while a run is going and after it. */
export type ReadState =
  | { phase: 'reading' }
  /** The server asked for a pause before the next read, and the run is waiting it out. */
  | { phase: 'waiting'; seconds: number }
  | { phase: 'read'; surveyNo: string; areaSqm: number }
  | { phase: 'absent'; near: string[] }
  /** Read from the map and not kept, for want of room on the file. */
  | { phase: 'full'; reason: string }
  | { phase: 'failed'; reason: string };

export interface ReadRun {
  /** The lines that were read, by the keys they were given under. */
  done: string[];
  /** Why the run ended before its last line, when it did not end by a person stopping it. The lines after were not asked for. */
  ended?: string;
  /** What the server said of the read that gave the project its boundary, else of the last read. */
  note?: string;
}

/** This person may not read the map here: signed out, or without the right. Every line after would be refused too. */
const REFUSED = new Set([401, 403]);

/** How many lines running the map may fail to answer before the run gives up on it. */
export const GIVE_UP_AFTER = 3;

/** What a run says when it ends because the file can keep no more parcels. The line it ended on says why. */
export const FULL = 'This project can keep no more parcels, so the numbers after that one were not asked for.';

/** The longest the run waits when the server asks for a pause, whatever it asks for. */
const LONGEST_WAIT_S = 90;
/** What it waits when the server asks for a pause and does not say how long. */
const USUAL_WAIT_S = 30;

function pause(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Read survey numbers in turn.
 *
 * One request for each and never two at once: the state's servers are slow,
 * and a request of its own is what lets each line say where it stands. A
 * number the map does not hold, and a read that fails, are that number's own
 * outcome, and the next is read all the same.
 *
 * Four things end a run early. A person stopping it. The server refusing
 * this person, which it would do for every line after. The file having no
 * room for another parcel: the line says so, and each number after it would
 * be read from a slow map only to be turned away the same. And the map
 * failing to answer three lines running: one failure is one number's, three
 * in a row is the map being down, and sixty numbers at a quarter of a minute
 * each is a long time to be told so. When the server says it has had too
 * many requests for the minute it is not a refusal: the run waits as long as
 * it was asked to, once, and reads the same line again.
 *
 * `lines` are whatever keys the caller knows its lines by — a survey number,
 * or a number and its parcel — and `readOne` reads the line a key stands for.
 */
export async function readInTurn(
  lines: readonly string[],
  readOne: (line: string) => Promise<RevenueReadResult>,
  on: {
    /** A line's state, or null to take down the one a run put up. */
    state: (line: string, state: ReadState | null) => void;
    /** Asked before each line: true ends the run there. */
    stop?: () => boolean;
    /** How a pause is sat out. Seconds; a timer unless a test hands in its own. */
    wait?: (seconds: number) => Promise<void>;
  },
): Promise<ReadRun> {
  const done: string[] = [];
  let boundaryNote: string | undefined;
  let lastNote: string | undefined;
  let unanswered = 0;
  const run = (ended?: string): ReadRun => ({ done, ...(ended ? { ended } : {}), note: boundaryNote ?? lastNote });
  const ask = async (line: string): Promise<RevenueReadResult> => {
    try {
      return await readOne(line);
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : 'The request did not reach the server.' };
    }
  };

  for (const line of lines) {
    if (on.stop?.()) return run();
    on.state(line, { phase: 'reading' });
    let result = await ask(line);
    if (!result.ok && result.status === 429) {
      const seconds = Math.min(result.retryAfterS && result.retryAfterS > 0 ? result.retryAfterS : USUAL_WAIT_S, LONGEST_WAIT_S);
      on.state(line, { phase: 'waiting', seconds });
      await (on.wait ?? pause)(seconds);
      if (on.stop?.()) {
        on.state(line, null);
        return run();
      }
      on.state(line, { phase: 'reading' });
      result = await ask(line);
    }
    if (result.ok) {
      unanswered = 0;
      done.push(line);
      if (result.boundary) boundaryNote = result.note;
      lastNote = result.note;
      on.state(line, { phase: 'read', surveyNo: result.read.surveyNo, areaSqm: result.read.areaSqm });
    } else if (REFUSED.has(result.status) || result.status === 429) {
      on.state(line, null);
      return run(result.error);
    } else if (result.full) {
      on.state(line, { phase: 'full', reason: result.error });
      return run(FULL);
    } else if (result.status === 404 && result.near) {
      unanswered = 0;
      on.state(line, { phase: 'absent', near: result.near });
    } else {
      on.state(line, { phase: 'failed', reason: result.error });
      // The map or the server did not answer at all, as against answering no.
      unanswered = result.status === 0 || result.status >= 500 ? unanswered + 1 : 0;
      if (unanswered >= GIVE_UP_AFTER) return run(`The map did not answer ${GIVE_UP_AFTER} numbers in a row, so the rest were not asked for. Read them again later.`);
    }
  }
  return run();
}

/* ------------------------------------------------------------------ */
/* The picker's lines                                                  */
/* ------------------------------------------------------------------ */

/**
 * A line's own key, which its tick and its state are held under: its number,
 * and the parcel it is read as — two villages of one site can each hold the
 * same survey number.
 */
export function lineKey(line: SurveyNumberLine): string {
  return `${line.surveyNo.toUpperCase()}|${line.read?.parcelRef ?? ''}`;
}

/**
 * A kept parcel ticked on its own line is read again by its own reference.
 * A number a person typed is read in the place picked, even when a parcel
 * under that number is kept: typing it with the other village picked is how
 * the second village's Sy. 41 is added.
 */
export function readsAgain(line: SurveyNumberLine): boolean {
  return Boolean(line.read) && !line.typed;
}

/**
 * Whether a line is ticked. A person's own tick or untick stands. A line
 * they have not touched is ticked when they typed it, or when the file
 * states it, that is accepted, and it is not yet read — unless the number
 * looks like another one misread, which waits for a person to say it is
 * wanted. A piece that is not one survey number cannot be read and is never
 * ticked.
 */
export function isTicked(line: SurveyNumberLine, choices: Readonly<Record<string, boolean>>): boolean {
  if (line.unreadable) return false;
  return choices[lineKey(line)] ?? (line.typed || (!line.read && Boolean(line.offered?.accepted) && !line.offered?.maybe));
}

/**
 * What a line says of a number that looks like another the papers state,
 * read without its stroke. Nothing once it is read: the map has then
 * answered for it.
 */
export function lineDoubt(line: SurveyNumberLine): string | null {
  const other = line.offered?.maybe;
  if (!other || line.read) return null;
  return `May be Sy. ${other} with its stroke lost in reading: the papers state that number too, and no whole survey number this long. Tick it to read it as it stands.`;
}

/** One request of a run: the line it is asked for, and the other lines the same request answers. */
export interface RunStep {
  key: string;
  line: SurveyNumberLine;
  /** Lines that are the same kept parcel, read again by the same request. */
  also: string[];
}

/**
 * What a run asks for, in the order of the lines.
 *
 * One request to a ticked line — except that 41/1 and 41/2, both read as the
 * parcel for 41 and both ticked to be read again, are one parcel and one
 * request, not the same slow read made twice.
 */
export function runPlan(lines: readonly SurveyNumberLine[], choices: Readonly<Record<string, boolean>>): RunStep[] {
  const steps: RunStep[] = [];
  for (const line of lines) {
    if (!isTicked(line, choices)) continue;
    const same = readsAgain(line) ? steps.find((s) => readsAgain(s.line) && s.line.read?.parcelRef === line.read?.parcelRef) : undefined;
    if (same) same.also.push(lineKey(line));
    else steps.push({ key: lineKey(line), line, also: [] });
  }
  return steps;
}

/**
 * The states a run left, once the file has been fetched again.
 *
 * Whether a number is read is the file's to say from then on: a line that
 * kept saying "Read" from the run would go on saying it after the read was
 * removed, cleared, or lost to another save. What the file cannot say — that
 * a number is not on the map, or why a read failed — stays.
 */
export function settled(states: Readonly<Record<string, ReadState>>): Record<string, ReadState> {
  return Object.fromEntries(Object.entries(states).filter(([, state]) => state.phase === 'absent' || state.phase === 'failed' || state.phase === 'full'));
}

/**
 * A person's ticks after a run: the lines that were read go back to being
 * unticked as read lines are, and every other tick and untick stands — a
 * number somebody unticked is not ticked again behind their back.
 */
export function ticksAfter(choices: Readonly<Record<string, boolean>>, read: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(Object.entries(choices).filter(([key]) => !read.includes(key)));
}

/**
 * Where a number came from, and where a person stands on it.
 *
 * A number off a reading nobody has accepted can still be read. Once it is
 * ticked, and for as long as it is read, the line says plainly what it is: a
 * machine's reading, not yet accepted.
 */
export function lineSource(line: SurveyNumberLine, ticked: boolean): { text: string; waiting: boolean } {
  const offered = line.offered;
  if (!offered) return { text: line.typed ? 'Typed' : '', waiting: false };
  const lead = offered.documents.find((d) => d.accepted) ?? offered.documents[0];
  const parts = [
    ...(offered.onProject ? ['On this project'] : []),
    ...(lead ? [`${lead.document}, p. ${lead.page}${offered.documents.length > 1 ? ` and ${offered.documents.length - 1} more` : ''}`] : []),
  ];
  if (offered.accepted) return { text: [...parts, ...(offered.documents.some((d) => d.accepted) ? ['accepted'] : [])].join(' · '), waiting: false };
  return { text: [...parts, ticked || line.read ? unacceptedWords(lead?.byModel ? 'model' : 'page') : 'waiting'].join(' · '), waiting: true };
}
