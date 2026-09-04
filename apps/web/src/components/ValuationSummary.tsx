/**
 * The answer, before the working.
 *
 * The Value tab holds everything the screen worked out — anchors, comparables,
 * drivers, the state's title checks, the transaction costs, the diligence
 * procedures, the evidence ledger. Measured, that is fourteen thousand pixels
 * in an eight-hundred-pixel pane: about eighteen screens, with "Value drivers"
 * on the tenth, behind five screens of statutory compliance. Everything on it
 * earns its place in an audit; none of it answers "what is this worth and why"
 * inside the first screen, which is the question the tab is named after.
 *
 * So this sits on top and says four things, in the order somebody asks them:
 *
 *   1. the figure, and how wide the band around it is
 *   2. how much of it to believe, and what would most improve that
 *   3. which method produced it, because two buttons here produce two
 *   4. the three largest drivers, so "why" does not need a scroll
 *
 * It is a projection, never a second opinion. Every value is read off the run
 * and the screen result that are already stored, so this cannot disagree with
 * the working below it — a summary that recomputed anything would eventually
 * contradict the page it summarises, which is worse than not having one.
 */

import { VALUATION_METHOD_LABEL, approachIsUsable, type ScreenResult, type ValuationRun } from '@realytica/shared';
import { Card, CardBody, Badge, Why, cn } from './ui/kit';
import type { Tone } from './ui/kit';
import { FormulaTip, type Derivation } from './FormulaTip';
import { pct } from '../lib/format';

function money(n: number, currency: string): string {
  if (currency === 'INR') return `₹${Math.round(n).toLocaleString('en-IN')}`;
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

/** Confidence bands, in the app's own reserved status tones. */
const BAND_TONE: Record<string, Tone> = { high: 'good', moderate: 'warning', low: 'critical' };
const BAND_WORD: Record<string, string> = { high: 'High confidence', moderate: 'Moderate confidence', low: 'Low confidence' };

export function ValuationSummary({
  run,
  screen,
  method,
}: {
  run: ValuationRun;
  screen?: ScreenResult;
  /** Which button produced `run` — the page knows, this does not. */
  method: string;
}) {
  const outcome = run.working?.reconciliation.outcome;
  const hasFigure = !run.working || outcome === 'indicated';
  const band = screen?.confidence.band;
  const completeness = screen?.completeness.score;

  /*
   * Half-width as a percentage of the mid.
   *
   * A range is the honest output and a range is also easy to skim past: the
   * cold-start file here reads ₹47.6 Cr to ₹1,06.3 Cr, which is a factor of
   * 2.2 and does not feel like it while the two numbers sit side by side.
   * Stating the spread as one number is what makes the width legible.
   */
  const spreadPct =
    hasFigure && run.indicatedValue > 0
      ? Math.round(((run.high - run.low) / 2 / run.indicatedValue) * 100)
      : null;

  /*
   * Wide enough that the figure is a conversation rather than a number.
   *
   * Not a hedge for its own sake — at ±30% the top and bottom of the band
   * support different decisions, and a reader who took the mid as "the value"
   * has been misled by the arithmetic rather than by anything anybody wrote.
   */
  const bandIsWide = spreadPct !== null && spreadPct >= 25;

  /*
   * How the headline was arrived at, on the headline.
   *
   * This is the one number on the page a reader will act on, and it was the
   * only number with no way at all to ask where it came from — the working
   * that produced it is real, stored and rendered further down, but a figure
   * set in 26px at the top of a tab is where somebody stops reading. So the
   * blend is on it: every approach that ran, what each contributed, what the
   * site's surroundings took off afterwards, and the sentence stating why the
   * weights are what they are.
   *
   * Built only from what the run stored. A run written before the working
   * model existed carries no approaches, and gets no dotted underline rather
   * than a reconstructed one.
   */
  const working = run.working;
  const usable = (working?.runs ?? []).filter(approachIsUsable);
  const weightTotal = usable.reduce((sum, r) => sum + r.weight, 0);
  const externalityPct = working ? working.externalities.factorPct * 100 : 0;

  const externalityApplies = Math.abs(externalityPct) >= 0.05;

  /*
   * A blend of one is not a blend.
   *
   * With a single usable approach the weighted-sum formula is arithmetically
   * correct and reads as nonsense: "₹50,23,20,000 × 30% = ₹50,23,20,000",
   * divided by a total weight of 0.30. Every term is true and the whole thing
   * invites the reader to conclude the page cannot multiply. What actually
   * happened is that one approach ran and carries the entire figure — which is
   * both simpler to state and the more important fact, because a valuation
   * resting on one method has no cross-check at all.
   */
  const soleApproach = usable.length === 1 ? usable[0] : undefined;

  const derivation: Derivation | undefined =
    hasFigure && usable.length > 0
      ? {
          formula: soleApproach
            ? 'one approach ran — it carries the whole figure' +
              (externalityApplies ? ', less what the site is next to' : '')
            : 'Σ(approach × weight) ÷ Σ weight' +
              (externalityApplies ? ', then what the site is next to' : ''),
          substituted: soleApproach
            ? soleApproach.formula
            : usable
                .map((r) => `${money(r.amount ?? 0, run.currency)} × ${(r.weight * 100).toFixed(0)}%`)
                .join('  +  '),
          result: money(run.indicatedValue, run.currency),
          steps: [
            ...usable.map((r) => ({
              label: VALUATION_METHOD_LABEL[r.method],
              expression: r.formula,
              value: money(r.amount ?? 0, run.currency),
            })),
            ...(externalityApplies
              ? [
                  {
                    label: 'What the site is next to',
                    expression: working!.externalities.applied.map((a) => a.label).join(', '),
                    value: `${externalityPct > 0 ? '+' : ''}${externalityPct.toFixed(1)}%`,
                  },
                ]
              : []),
          ],
          note: (
            <>
              {soleApproach ? (
                <>
                  Only <span className="font-medium">{VALUATION_METHOD_LABEL[soleApproach.method]}</span> had all of
                  its inputs, so its weight of {(soleApproach.weight * 100).toFixed(0)}% is normalised to the whole —
                  nothing is being averaged against it.{' '}
                </>
              ) : (
                <>Divided by {weightTotal.toFixed(2)}, the weights of the approaches that ran. </>
              )}
              {working?.reconciliation.spreadBasis}
              {working && working.reconciliation.skippedMethods.length > 0 ? (
                <>
                  {' '}
                  Not run:{' '}
                  {working.reconciliation.skippedMethods
                    .map((m) => `${VALUATION_METHOD_LABEL[m.method]} (${m.because})`)
                    .join('; ')}
                  .
                </>
              ) : null}
            </>
          ),
        }
      : undefined;

  const drivers = (screen?.drivers ?? [])
    .filter((d) => !d.reconciling)
    .slice()
    .sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct))
    .slice(0, 3);
  const unexplained = screen?.drivers.find((d) => d.reconciling);

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            {hasFigure ? (
              <>
                <p className="font-mono text-[26px] font-semibold leading-none tracking-tight tabular-nums text-ink">
                  {derivation ? (
                    <FormulaTip label="How this figure was reached" derivation={derivation}>
                      {money(run.indicatedValue, run.currency)}
                    </FormulaTip>
                  ) : (
                    money(run.indicatedValue, run.currency)
                  )}
                </p>
                <p className="mt-1.5 font-mono text-[12.5px] tabular-nums text-ink-secondary">
                  {money(run.low, run.currency)} – {money(run.high, run.currency)}
                  {spreadPct !== null ? (
                    <span className="text-ink-muted">
                      {' · '}
                      <FormulaTip
                        label="Band width"
                        derivation={{
                          formula: '(high − low) ÷ 2 ÷ mid',
                          substituted: `(${money(run.high, run.currency)} − ${money(run.low, run.currency)}) ÷ 2 ÷ ${money(run.indicatedValue, run.currency)}`,
                          result: `±${spreadPct}%`,
                          note:
                            usable.length > 1
                              ? 'The low and high are the least and greatest of the approaches that ran, not a statistical interval — the band is how much the methods disagree.'
                              : 'Only one approach ran, so this band is that approach’s own range rather than a comparison between methods.',
                        }}
                      >
                        ±{spreadPct}%
                      </FormulaTip>
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="text-[17px] font-semibold leading-tight text-ink">
                {outcome === 'approaches_disagree'
                  ? 'No figure — the approaches disagree'
                  : 'No figure — no approach had all of its inputs'}
              </p>
            )}
            <p className="mt-1 text-[12px] text-ink-muted">{method}</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {band ? <Badge tone={BAND_TONE[band] ?? 'neutral'}>{BAND_WORD[band] ?? band}</Badge> : null}
            {completeness !== undefined ? (
              <Badge tone={completeness >= 60 ? 'neutral' : 'warning'}>{completeness}% documented</Badge>
            ) : null}
          </div>
        </div>

        {/*
          The caveat used to lose to the figure.
          "Completeness 0; confidence low. Do not pursue until the critical
          risks are resolved" sat in prose below a number set in the largest
          type on the page, and a reader takes the number. Where the band is
          this wide, the warning gets the weight instead.
        */}
        {hasFigure && bandIsWide ? (
          <p
            className={cn(
              'rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink ring-1 ring-inset ring-warning/40',
            )}
          >
            <span className="font-medium">Band too wide to act on</span>
            <span className="text-ink-secondary"> — high is {(run.high / Math.max(run.low, 1)).toFixed(1)}× the low.</span>
            {screen?.confidence.biggestLever ? <Why label="What narrows it">{screen.confidence.biggestLever}</Why> : null}
          </p>
        ) : screen?.confidence.biggestLever ? (
          <Why label="What would most improve this">{screen.confidence.biggestLever}</Why>
        ) : null}

        {drivers.length > 0 ? (
          <div>
            <p className="text-[10.5px] uppercase tracking-wider text-ink-muted">
              Largest drivers against the locality median
            </p>
            <ul className="mt-1.5 space-y-1">
              {drivers.map((d) => (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate text-ink">{d.label}</span>
                  <span
                    className={cn(
                      'font-mono tabular-nums',
                      d.impactPct < 0 ? 'text-critical' : 'text-[var(--status-good-text)]',
                    )}
                  >
                    {pct(d.impactPct, 1, true)}
                  </span>
                </li>
              ))}
            </ul>
            {/*
              Stated here too, because a reader who never scrolls to the chart
              would otherwise take three drivers of a few percent as the whole
              explanation when most of the gap is unaccounted for.
            */}
            {unexplained && Math.abs(unexplained.impactPct) > 10 ? (
              <p className="mt-2 text-[11.5px] text-ink-muted">
                {pct(unexplained.impactPct, 1, true)} unexplained
              </p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
