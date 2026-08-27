/**
 * What this parcel's own documents say it has changed hands for, over time.
 *
 * The question every owner asks — "what did this trade at before, and where
 * is it heading?" — usually gets answered from other people's transactions,
 * which in India are underreported and not lawfully shareable per-deal. This
 * module answers it from the one source that is both authentic and already
 * on the case: the registered considerations recited by the conveyances in
 * the subject's own title chain, joined to today's indicative mid.
 *
 * Two boundaries hold the honesty of it:
 *
 * - **Only dated conveyances count.** An undated deed cannot be placed in
 *   time, so its figure cannot sit on a time axis; it is left out rather
 *   than guessed at, the same judgement `reconstructChains` makes.
 *
 * - **A recital is not a price.** Indian deeds recite the dutiable value,
 *   which tracks the guidance value, so the trajectory is a *floor* on the
 *   market's movement. `understatementLikely` carries that to every
 *   renderer, and the statements say it in words — presenting the recital
 *   as a market price would be the confident wrong number this product
 *   exists to avoid.
 *
 * No forecast is computed anywhere here. The trajectory ends at today's
 * indicative mid; where it goes next is a judgement this product does not
 * manufacture.
 */

import type { CurrencyCode, IndicativeValue, PricePoint, PriceTrajectory, TitleChain } from './types';

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

/** Below this span an annualised rate is noise dressed as a percentage. */
const MIN_CAGR_SPAN_YEARS = 1;

function yearsBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_YEAR;
}

function cagrPct(fromAmount: number, toAmount: number, years: number): number | undefined {
  if (years < MIN_CAGR_SPAN_YEARS || fromAmount <= 0 || toAmount <= 0) return undefined;
  return Math.round((Math.pow(toAmount / fromAmount, 1 / years) - 1) * 1000) / 10;
}

export interface PriceTrajectoryInput {
  chains: TitleChain[];
  indicative: IndicativeValue;
  /** The screen's own timestamp — the indicative point sits at this instant. */
  generatedAt: string;
  currency: CurrencyCode;
  /** Prose formatter in the country pack's locale — see `formatCurrency`. */
  money: (value: number) => string;
}

export function buildPriceTrajectory(input: PriceTrajectoryInput): PriceTrajectory | undefined {
  const { indicative, currency, money } = input;

  const registered: PricePoint[] = input.chains
    .flatMap(chain => chain.links)
    .filter(link => link.at !== undefined && link.considerationAmount !== undefined && link.considerationAmount > 0)
    .map(link => ({
      at: link.at as string,
      amount: link.considerationAmount as number,
      kind: 'registered' as const,
      label: link.label,
      documentId: link.documentId,
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.label < b.label ? -1 : 1));

  // No dated conveyance recites a figure — there is no history to draw, and
  // an "empty trajectory" would render as a finding about a silence.
  if (registered.length === 0) return undefined;

  const points: PricePoint[] = [
    ...registered,
    {
      at: input.generatedAt,
      amount: indicative.mid,
      kind: 'indicative',
      label: 'Indicative mid (this screen)',
    },
  ];

  const earliest = registered[0];
  const latest = registered[registered.length - 1];

  const registeredCagrPct = registered.length >= 2 ? cagrPct(earliest.amount, latest.amount, yearsBetween(earliest.at, latest.at)) : undefined;
  const impliedCagrToIndicativePct = cagrPct(latest.amount, indicative.mid, yearsBetween(latest.at, input.generatedAt));

  const understatementLikely = currency === 'INR';

  const statements: string[] = [];
  if (registered.length >= 2 && registeredCagrPct !== undefined) {
    statements.push(
      `The parcel's own conveyances recite ${money(earliest.amount)} (${earliest.at.slice(0, 4)}) rising to ${money(latest.amount)} (${latest.at.slice(0, 4)}) — ${registeredCagrPct}% a year across the registered record.`,
    );
  } else {
    statements.push(`One conveyance on file recites a consideration: ${money(latest.amount)} in ${latest.at.slice(0, 4)}.`);
  }
  if (impliedCagrToIndicativePct !== undefined) {
    statements.push(
      `Against today's indicative mid of ${money(indicative.mid)}, the ${latest.at.slice(0, 4)} recital implies ${impliedCagrToIndicativePct}% a year since — read it as a floor on appreciation, not a measurement of it.`,
    );
  }
  if (understatementLikely) {
    statements.push(
      'A registered deed recites the dutiable value, which tracks the guidance value rather than the price actually paid, so the amounts here likely understate what changed hands. The dates and the direction are reliable; the levels are a floor.',
    );
  }
  statements.push('No projection is drawn from this. Where the value goes next is not something the registered record can say.');

  return {
    points,
    registeredCagrPct,
    impliedCagrToIndicativePct,
    understatementLikely,
    statements,
    currency,
  };
}
