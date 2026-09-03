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

import type { ScreenResult, ValuationRun } from '@realytica/shared';
import { Card, CardBody, Badge, cn } from './ui/kit';
import type { Tone } from './ui/kit';
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
                  {money(run.indicatedValue, run.currency)}
                </p>
                <p className="mt-1.5 font-mono text-[12.5px] tabular-nums text-ink-secondary">
                  {money(run.low, run.currency)} – {money(run.high, run.currency)}
                  {spreadPct !== null ? <span className="text-ink-muted"> · ±{spreadPct}%</span> : null}
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
            <span className="font-medium">This band is too wide to act on.</span> The low and high here differ by
            a factor of {(run.high / Math.max(run.low, 1)).toFixed(1)}, so the mid is a midpoint rather than an
            estimate.
            {screen?.confidence.biggestLever ? ` ${screen.confidence.biggestLever}` : ''}
          </p>
        ) : screen?.confidence.biggestLever ? (
          <p className="text-[12.5px] leading-relaxed text-ink-secondary">
            <span className="text-ink-muted">What would most improve this — </span>
            {screen.confidence.biggestLever}
          </p>
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
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                A further {pct(unexplained.impactPct, 1, true)} is not accounted for by any recorded driver — the
                three above explain only part of the difference from the locality median.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
