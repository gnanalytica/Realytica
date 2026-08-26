import type { EvalRanking, EvalRunResult } from '@realytica/shared';
import { formatRoute } from '../routing';

/**
 * Turning runs into a ranking that can settle a tier assignment.
 *
 * The number this exists to produce is `scorePerUsd`, not `meanScore`. "Which
 * model is better" is unanswerable and, worse, is usually answered with the
 * most expensive one; "which model reads a khata extract accurately enough
 * for what this step costs" is answerable, and it is the question that decides
 * whether the extraction tier can run on a model a fifth of the price. A route
 * scoring 0.94 at a fifth of the cost of one scoring 0.97 is the right choice
 * for mechanical work and the wrong one where a mistake is expensive, and the
 * only way to see that trade is to put both numbers in the same row.
 *
 * --- The fabrication rule ----------------------------------------------
 *
 * **Any route with one or more fabrications ranks below every route with
 * none, whatever it costs and whatever it scores.** Fabrications are a gate,
 * not a weight.
 *
 * A weight was the obvious design and it is wrong. Any penalty subtracted from
 * a score can be outrun by a large enough price advantage — that is what a
 * ratio does — so a model that invents a survey number on one case in twenty
 * would still top the table at a tenth of the price, and the table is what
 * someone reads before assigning the extraction tier. The trade that ranking
 * would be making is: accept some rate of confidently-asserted survey numbers,
 * fees and form codes that do not exist, in exchange for money. This product
 * cannot make that trade, because a fabricated field is not caught downstream
 * the way a wrong one is. A misread khata number contradicts the next document
 * in the bundle; an invented one is consistent with everything, reads as
 * authoritative, and is repeated by the buyer at a counter.
 *
 * So the ordering is: clean routes first, ordered by score per dollar; then
 * fabricating routes, ordered by how much they fabricate. Within either group
 * the tie-breaks are deterministic all the way down to the route name, so two
 * runs of the same comparison produce the same table.
 *
 * One consequence, stated because it looks odd and is intended: a route whose
 * every call failed has no fabrications and therefore ranks above one that
 * scored well while inventing things. That is the right order — a failure is
 * visible and retryable, a fabrication is neither — but it means first place
 * is not on its own an endorsement. Read `meanScore` in the same row.
 */

/**
 * A ceiling for `scorePerUsd`.
 *
 * A free local model divides by zero, and `Infinity` is not a number a UI can
 * render, a store can serialise (JSON turns it into `null`) or a sort can be
 * trusted with. The ratio has also stopped meaning anything well before a
 * million points per dollar. Capping keeps the column finite, sortable and
 * comparable, and free routes still order correctly among themselves because
 * the cap is multiplied by their score.
 */
export const MAX_SCORE_PER_USD = 1_000_000;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Group runs by route and compute the row for each.
 *
 * Failed runs are in `results` and are counted for cost and duration but not
 * for score — see the note in `run.ts`. That asymmetry is deliberate: a
 * failure says nothing about accuracy and everything about what the attempt
 * cost and how long the user waited for it.
 */
export function rankEvalResults(results: EvalRunResult[]): EvalRanking[] {
  const groups = new Map<string, EvalRunResult[]>();
  for (const result of results) {
    const key = formatRoute(result.provider, result.model);
    const existing = groups.get(key);
    if (existing) existing.push(result);
    else groups.set(key, [result]);
  }

  const rankings: EvalRanking[] = [];

  for (const [, runs] of groups) {
    const scored = runs.filter(run => run.score !== undefined);

    const meanScore = scored.length === 0 ? 0 : scored.reduce((total, run) => total + (run.score?.score ?? 0), 0) / scored.length;
    const fabrications = scored.reduce((total, run) => total + (run.score?.fabrications ?? 0), 0);

    // Summed directly rather than through `sumUsage`, which rounds to four
    // decimal places at every step. Forty cases at $0.00004 each would total
    // zero under that rounding, and a route reported as free is exactly the
    // one this ranking would then put first.
    const totalCostUsd = runs.reduce((total, run) => total + run.usage.estimatedCostUsd, 0);
    const meanDurationMs = runs.length === 0 ? 0 : runs.reduce((total, run) => total + run.durationMs, 0) / runs.length;

    const scorePerUsd =
      totalCostUsd > 0
        ? Math.min(meanScore / totalCostUsd, MAX_SCORE_PER_USD)
        : meanScore * MAX_SCORE_PER_USD;

    rankings.push({
      provider: runs[0].provider,
      model: runs[0].model,
      meanScore: roundTo(meanScore, 4),
      fabrications,
      // Six decimals, not the four the pricing helper uses: a per-case cost
      // can legitimately be a fraction of a cent, and the total is what the
      // whole ratio is divided by.
      totalCostUsd: roundTo(totalCostUsd, 6),
      meanDurationMs: Math.round(meanDurationMs),
      scorePerUsd: roundTo(scorePerUsd, 2),
    });
  }

  return rankings.sort(compareRankings);
}

/**
 * The ordering rule, in one place.
 *
 * Exported so a caller re-sorting a stored ranking cannot accidentally sort it
 * by score and undo the fabrication gate.
 */
export function compareRankings(a: EvalRanking, b: EvalRanking): number {
  const aClean = a.fabrications === 0;
  const bClean = b.fabrications === 0;

  // The gate. Nothing below this line can promote a fabricating route past a
  // clean one.
  if (aClean !== bClean) return aClean ? -1 : 1;

  // Among routes that fabricate, fewer inventions first — the choice between
  // them is a choice between degrees of the same failure, and it should not be
  // made on price.
  if (!aClean && a.fabrications !== b.fabrications) return a.fabrications - b.fabrications;

  // The number that settles the tier assignment.
  if (b.scorePerUsd !== a.scorePerUsd) return b.scorePerUsd - a.scorePerUsd;
  // Then raw accuracy, then cheapness, then the route name so the sort is
  // total and two identical runs produce identical tables.
  if (b.meanScore !== a.meanScore) return b.meanScore - a.meanScore;
  if (a.totalCostUsd !== b.totalCostUsd) return a.totalCostUsd - b.totalCostUsd;
  return formatRoute(a.provider, a.model).localeCompare(formatRoute(b.provider, b.model));
}

/**
 * The ranking as lines a person can read.
 *
 * Written so the accuracy-versus-cost trade is legible without the reader
 * reconstructing the rule from the ordering: a fabricating route says so on
 * its own row, and every row carries the score and the spend that produced its
 * ratio.
 */
export function summariseRanking(rankings: EvalRanking[]): string[] {
  return rankings.map((row, index) => {
    const route = formatRoute(row.provider, row.model);
    const ratio = row.totalCostUsd > 0 ? `${row.scorePerUsd.toFixed(2)} score/$` : 'free route (no measured spend)';
    const verdict =
      row.fabrications > 0
        ? ` — ${row.fabrications} fabrication${row.fabrications === 1 ? '' : 's'}: ranked below every clean route regardless of price`
        : '';
    return `${index + 1}. ${route} — score ${row.meanScore.toFixed(3)}, $${row.totalCostUsd.toFixed(4)} total, ${row.meanDurationMs} ms mean, ${ratio}${verdict}`;
  });
}
