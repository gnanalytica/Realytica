/**
 * Matching a folder of documents to the rows that were expecting them.
 *
 * A diligence pack arrives as thirty files in one folder, and the register
 * already knows what it is waiting for. Filing them one at a time through a
 * file picker is thirty round trips to say something the filenames largely
 * already say.
 *
 * This is deterministic string matching, not a model judgement, so it may
 * execute rather than propose — but it still shows its work before anything
 * lands, because "EC_2019.pdf" belongs to whichever encumbrance certificate row
 * a person meant, and only they know which.
 *
 * Weighting is by inverse document frequency across the project's own titles.
 * On a register where thirty rows contain "plan", the word "plan" cannot
 * identify a row, and a matcher that treats it as evidence will file the site
 * plan against the layout plan. The rare word is the one that decides.
 */

import type { EvidenceRecord } from './types';

/** Below this share of a title's weight, a file is not filed at all. */
export const FILE_MATCH_FLOOR = 0.5;

/**
 * How close the runner-up may be before a person has to choose.
 *
 * Two encumbrance-certificate rows differing only by year will score almost
 * identically against `EC.pdf`, and guessing between them silently is how a
 * document ends up cited against the wrong period.
 */
export const FILE_MATCH_MARGIN = 0.12;

export interface EvidenceFileMatch {
  fileName: string;
  /** The row this file should be filed against, when one is clear. */
  evidenceId?: string;
  title?: string;
  /** Share of the title's weight the filename accounted for, 0..1. */
  score: number;
  /** Set when a second row scored within the margin; the caller must ask. */
  ambiguousWith?: { evidenceId: string; title: string };
}

/**
 * Words that appear in filenames because of how a file was produced, not
 * because of what it contains.
 */
const NOISE = new Set([
  'scan',
  'scanned',
  'copy',
  'copies',
  'final',
  'signed',
  'draft',
  'rev',
  'revised',
  'ver',
  'version',
  'page',
  'pages',
  'compressed',
  'merged',
  'combined',
  'new',
  'old',
  'latest',
  'the',
  'of',
  'and',
  'for',
  'a',
  'an',
  'is',
  'are',
  'on',
  'in',
  'to',
  'its',
  'this',
  'with',
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !NOISE.has(w));
}

/**
 * How much a word narrows the register.
 *
 * A word in one title out of a hundred identifies it; a word in half of them
 * identifies nothing.
 */
function weights(rows: EvidenceRecord[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const row of rows) {
    for (const w of new Set(words(row.title))) {
      seen.set(w, (seen.get(w) ?? 0) + 1);
    }
  }
  const total = Math.max(1, rows.length);
  const out = new Map<string, number>();
  for (const [w, n] of seen) out.set(w, Math.log(1 + total / n));
  return out;
}

/** A row still waiting for a document beats one that already has what it needs. */
function wanting(row: EvidenceRecord): boolean {
  return row.status === 'expected' || row.status === 'requested';
}

interface Fit {
  /** Share of the title's weight the filename accounted for, 0..1. */
  coverage: number;
  /** Absolute weight matched, so a longer full match beats a shorter one. */
  matched: number;
}

const NO_FIT: Fit = { coverage: 0, matched: 0 };

function scoreAgainst(fileWords: Set<string>, row: EvidenceRecord, weight: Map<string, number>): Fit {
  const titleWords = [...new Set(words(row.title))];
  if (titleWords.length === 0) return NO_FIT;

  let matched = 0;
  let all = 0;
  let bestHit = 0;
  let topWord = 0;
  for (const w of titleWords) {
    const wt = weight.get(w) ?? 1;
    all += wt;
    topWord = Math.max(topWord, wt);
    if (fileWords.has(w)) {
      matched += wt;
      bestHit = Math.max(bestHit, wt);
    }
  }
  if (all === 0) return NO_FIT;

  // The word that identifies the title has to be one of the ones that matched.
  // Otherwise "Site plan.pdf" scores against every row containing "plan", and
  // the layout plan gets filed as the site plan.
  if (bestHit < topWord) return NO_FIT;

  return { coverage: matched / all, matched };
}

/**
 * Propose a home for each file. Order follows the input, so the caller can zip
 * the result back onto its own list.
 *
 * `rows` is the register the person is actually looking at, not necessarily the
 * whole project. A pack of documents dropped onto a filtered list belongs in
 * that list, and matching against rows they cannot see is how a file ends up on
 * a different assessment's copy of the same expected title.
 */
export function matchFilesToEvidence(rows: EvidenceRecord[], fileNames: string[]): EvidenceFileMatch[] {
  const weight = weights(rows);

  return fileNames.map((fileName) => {
    const fileWords = new Set(words(fileName));
    if (fileWords.size === 0) return { fileName, score: 0 };

    const scored = rows
      .map((row) => ({ row, fit: scoreAgainst(fileWords, row, weight) }))
      .filter((s) => s.fit.coverage >= FILE_MATCH_FLOOR)
      .sort(
        (a, b) =>
          b.fit.coverage - a.fit.coverage ||
          // A fully-matched two-word title used more of the filename than a
          // fully-matched one-word title did.
          b.fit.matched - a.fit.matched ||
          // And a row still waiting for its document beats one already filed.
          Number(wanting(b.row)) - Number(wanting(a.row)),
      );

    const best = scored[0];
    if (!best) return { fileName, score: 0 };

    const runnerUp = scored.find((s) => s.row.id !== best.row.id);
    const close =
      runnerUp &&
      best.fit.coverage - runnerUp.fit.coverage < FILE_MATCH_MARGIN &&
      runnerUp.fit.matched >= best.fit.matched * 0.9;

    return {
      fileName,
      evidenceId: best.row.id,
      title: best.row.title,
      score: best.fit.coverage,
      ...(close ? { ambiguousWith: { evidenceId: runnerUp.row.id, title: runnerUp.row.title } } : {}),
    };
  });
}
