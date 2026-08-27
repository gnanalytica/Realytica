/**
 * The JDA's sharing ratio, graded against what the land is worth.
 *
 * A joint development is the one project kind where the headline number in
 * the deal is not a price but a ratio, and a ratio hides what it pays. The
 * translation practitioners do on paper — share of gross realisation equals
 * an implied land price, implied land price can be compared with the land's
 * market value — is arithmetic on figures the screen already produces: the
 * residual anchor's gross realisation and the land-rate anchor's band.
 *
 * This module adds no opinion of value. It never invents a rate, a cost or a
 * margin; when either anchor it needs is absent it returns nothing rather
 * than estimating. That boundary is what lets the verdict be shown to the
 * landowner's side and the developer's side alike.
 */

import type { CurrencyCode, JdSplitAssessment, JdSplitVerdict, ValueAnchor } from './types';

/**
 * How far outside the land-value band a ratio may sit and still read as
 * balanced, in percentage points of share. A JDA is negotiated in round
 * numbers; grading 44.7% against a 45.1% bound as developer-favoured would
 * be false precision about a band that is itself a range.
 */
const BALANCE_TOLERANCE_PCT = 2;

export interface JdSplitInput {
  /** The ratio as the JDA states it, owner first — "45:55" or "45/55". */
  offeredRatio: string;
  sourceDocumentId?: string;
  /** The residual_development anchor, carrying its breakdown. */
  residualAnchor?: ValueAnchor;
  /** The land_rate anchor — what buying the land outright would cost. */
  landRateAnchor?: ValueAnchor;
  plotAreaSqm: number;
  currency: CurrencyCode;
  /** Prose formatter in the country pack's locale — see `formatCurrency`. */
  money: (value: number) => string;
  evidenceIds?: string[];
}

/** "45:55" → 45. Returns undefined for anything that does not read as a two-part ratio. */
export function parseOwnerSharePct(ratio: string): number | undefined {
  const match = /^\s*(\d{1,2}(?:\.\d+)?)\s*[:/]\s*(\d{1,2}(?:\.\d+)?)\s*$/.exec(ratio);
  if (!match) return undefined;
  const owner = Number(match[1]);
  const developer = Number(match[2]);
  const total = owner + developer;
  // A 60:40 and a 3:2 are both ratios; only shares that plausibly sum to a
  // whole are read, so "12:30" is refused rather than silently normalised.
  if (total < 95 || total > 105) return undefined;
  if (owner <= 0 || owner >= 100) return undefined;
  return (owner / total) * 100;
}

export function assessJdSplit(input: JdSplitInput): JdSplitAssessment | undefined {
  const { residualAnchor, landRateAnchor, currency, money } = input;

  const offeredOwnerSharePct = parseOwnerSharePct(input.offeredRatio);
  if (offeredOwnerSharePct === undefined) return undefined;

  const gross = residualAnchor?.residual?.steps.find(s => s.kind === 'gross')?.amount;
  const residualLandValue = residualAnchor?.residual?.steps.find(s => s.kind === 'result')?.amount;
  if (gross === undefined || gross <= 0) return undefined;
  if (!landRateAnchor || landRateAnchor.low <= 0 || landRateAnchor.high <= 0) return undefined;

  const round1 = (n: number): number => Math.round(n * 10) / 10;

  const fairSharePctLow = round1((landRateAnchor.low / gross) * 100);
  const fairSharePctHigh = round1((landRateAnchor.high / gross) * 100);
  const offeredShareValue = Math.round((offeredOwnerSharePct / 100) * gross);
  const offeredShareValuePerSqm = input.plotAreaSqm > 0 ? Math.round(offeredShareValue / input.plotAreaSqm) : 0;

  const verdict: JdSplitVerdict =
    offeredOwnerSharePct < fairSharePctLow - BALANCE_TOLERANCE_PCT
      ? 'developer_favoured'
      : offeredOwnerSharePct > fairSharePctHigh + BALANCE_TOLERANCE_PCT
        ? 'landowner_favoured'
        : 'balanced';

  const sharePhrase = `${round1(offeredOwnerSharePct)}% to the landowner`;
  const statements: string[] = [
    `The JDA gives ${sharePhrase}. On the scheme's gross realisation of ${money(gross)}, that share is worth ${money(offeredShareValue)}${
      input.plotAreaSqm > 0 ? ` — an implied land price of ${money(offeredShareValuePerSqm)} per sqm` : ''
    }.`,
    `The land itself is worth ${money(landRateAnchor.low)}–${money(landRateAnchor.high)} bought outright, which is ${fairSharePctLow}%–${fairSharePctHigh}% of the same gross realisation. That is the share band the land value alone would justify.`,
  ];

  if (verdict === 'developer_favoured') {
    statements.push(
      `The offered share sits below that band: the developer is effectively paying less for the land than buying it would cost. The gap is the landowner's to negotiate — or to trade against the deposit, timelines and penalty terms, which this arithmetic does not price.`,
    );
  } else if (verdict === 'landowner_favoured') {
    statements.push(
      `The offered share sits above that band: the developer is effectively paying more for the land than buying it would cost, and the margin has to come out of the development profit. Either the developer sees value this screen does not, or the scheme's economics are thinner than the ratio suggests.`,
    );
  } else {
    statements.push(`The offered share sits inside that band — as a division of value, the ratio is consistent with what the land is worth.`);
  }

  if (residualLandValue !== undefined && residualLandValue > 0) {
    statements.push(
      `As a ceiling: after build cost, margin and time, the scheme itself can support paying up to ${money(residualLandValue)} for this land (${round1((residualLandValue / gross) * 100)}% of gross). A share above that is being paid out of the developer's margin.`,
    );
  }

  const caveats = [
    'An area share is read as a value share, which holds only if the landowner’s units sell at the same rate as the scheme average — corner or upper-floor allocations shift it.',
    'Refundable deposit, construction timelines and penalty clauses are not priced here, and they are where JDA disputes actually originate. A below-band ratio with a large deposit can be a fair deal; an in-band ratio with no penalties can be a bad one.',
  ];

  return {
    offeredOwnerSharePct: round1(offeredOwnerSharePct),
    sourceDocumentId: input.sourceDocumentId,
    schemeGrossValue: Math.round(gross),
    offeredShareValue,
    offeredShareValuePerSqm,
    fairSharePctLow,
    fairSharePctHigh,
    verdict,
    statements,
    caveats,
    currency,
    evidenceIds: input.evidenceIds ?? [],
  };
}
