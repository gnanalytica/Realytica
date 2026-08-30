import { useState } from 'react';
import type { ResidualBreakdown } from '@realytica/shared';
import { money } from '../../lib/format';
import {
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  ChartTooltip,
  TickText,
  TooltipRow,
  scaleLinear,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface ResidualWaterfallChartProps {
  residual: ResidualBreakdown;
  /**
   * Area and rate in the reader's chosen unit. The breakdown stores square
   * metres because the engine computes in them; a caption reading "22,781
   * sqm" beside a page that says "2,45,213 sq ft" everywhere else asks the
   * reader to convert in their head to check the two agree.
   */
  formatArea: (sqm: number) => string;
  formatRate: (perSqm: number) => string;
  height?: number;
}

const ROW_H = 34;
const BAR_H = 20;
const LABEL_W = 132;
/** The 2px surface gap the chart system uses between adjacent fills. */
const GAP = 2;

/**
 * What is left of the sale proceeds once the scheme is paid for.
 *
 * A residual is a subtraction chain — gross down to land value — and it was
 * being carried entirely in a sentence. The engine computed every
 * intermediate figure and kept only the last one, so the rationale had grown
 * to 969 characters: with no structure to render, the only place the working
 * could go was into prose.
 *
 * A descending waterfall makes the shape of the calculation the shape of the
 * chart. The reader sees at a glance whether construction or the margin is
 * what eats the scheme, which is the question they actually have and is
 * invisible in a paragraph listing the same numbers.
 *
 * Colour does one job: gross and result in the accent hue because they are
 * the two figures being compared, deductions in a single second hue because
 * they are not being compared with each other — they are being taken off in
 * sequence. Giving each deduction its own colour would be the categorical
 * mistake of treating an accumulation as a set of rival series.
 */
export default function ResidualWaterfallChart({ residual, formatArea, formatRate, height }: ResidualWaterfallChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { steps, currency } = residual;
  const H = height ?? steps.length * ROW_H + 34;

  if (steps.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No residual steps computed" height={H} />
      </ChartContainer>
    );
  }
  if (size.width <= 0) return <div ref={containerRef} style={{ height: H }} />;

  const gross = steps.find(s => s.kind === 'gross')?.amount ?? 0;
  const result = steps.find(s => s.kind === 'result')?.amount ?? 0;

  const W = size.width;
  const plotX0 = LABEL_W;
  const plotX1 = W - 74;
  // Domain runs from zero to gross: every bar is a span of the gross, so the
  // deductions read as fractions of what came in rather than as free-floating
  // magnitudes.
  const x = scaleLinear([0, Math.max(gross, 1)], [plotX0, plotX1]);

  /*
   * Each deduction hangs from where the previous one left off. `running` is
   * the top of the remaining pot before this step; a deduction spans from
   * `running + amount` (its new floor, since amount is negative) up to
   * `running`.
   */
  let running = 0;
  const bars = steps.map(step => {
    if (step.kind === 'gross') {
      running = step.amount;
      return { step, from: 0, to: step.amount };
    }
    if (step.kind === 'result') {
      return { step, from: 0, to: step.amount };
    }
    const from = running + step.amount;
    const bar = { step, from, to: running };
    running = from;
    return bar;
  });

  const fillFor = (kind: string) => (kind === 'gross' || kind === 'result' ? 'var(--series-1)' : 'var(--series-4)');

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg
        width={W}
        height={H}
        /*
         * Compact here, where the cost waterfall deliberately is not. There,
         * the reader's conclusion turned on telling ₹1.35 Cr from ₹1.44 Cr,
         * which compacting collapses. Here every figure is named by its step
         * and the steps are orders of magnitude apart, so "₹1,50,35,63,000"
         * read aloud is nine digits of noise where "₹150.4 Cr" is the number.
         */
        ariaLabel={`Residual: ${money(gross, currency)} of sale value less the cost of building it leaves ${money(result, currency)} of land value today`}
        title="What is left for the land"
        desc={steps.map(s => `${s.label} ${money(s.amount, currency)}`).join('; ')}
      >
        {bars.map(({ step, from, to }, i) => {
          const y = i * ROW_H + 4;
          const x0 = x(Math.min(from, to));
          const x1 = x(Math.max(from, to));
          const isResult = step.kind === 'result';
          return (
            <g
              key={step.key}
              onMouseEnter={() =>
                setTooltip({
                  x: (x0 + x1) / 2,
                  y: y + BAR_H,
                  content: (
                    <>
                      <TooltipRow swatch={fillFor(step.kind)} label={step.label} value={money(step.amount, currency)} />
                      <TooltipRow label="" value={step.note} />
                    </>
                  ),
                })
              }
              onMouseLeave={() => setTooltip(null)}
            >
              <TickText x={plotX0 - 8} y={y + BAR_H / 2 + 4} anchor="end">
                {step.label}
              </TickText>

              {/* The connector, so a subtraction reads as continuing from the last one. */}
              {i > 0 && !isResult ? (
                <line
                  x1={x1}
                  y1={y - ROW_H + BAR_H / 2}
                  x2={x1}
                  y2={y + BAR_H / 2}
                  stroke="var(--gridline)"
                  strokeWidth={1}
                />
              ) : null}

              <rect
                x={x0 + (step.kind === 'deduction' || step.kind === 'discount' ? GAP : 0)}
                y={y}
                width={Math.max(2, x1 - x0 - (step.kind === 'deduction' || step.kind === 'discount' ? GAP : 0))}
                height={BAR_H}
                rx={3}
                fill={fillFor(step.kind)}
                opacity={isResult ? 1 : step.kind === 'gross' ? 0.9 : 0.85}
              />

              <text
                x={plotX1 + 8}
                y={y + BAR_H / 2 + 4}
                className={
                  isResult
                    ? 'fill-[var(--text-primary)] text-mini font-semibold tabular'
                    : 'fill-[var(--text-secondary)] text-mini tabular'
                }
              >
                {money(step.amount, currency, { compact: true })}
              </text>
            </g>
          );
        })}

        {/*
          * A rule at the residual, carried up through the deductions.
          *
          * It is the one comparison the chart exists to make: how far the
          * land value sits below what the scheme grosses.
          */}
        <line
          x1={x(result)}
          y1={0}
          x2={x(result)}
          y2={(steps.length - 1) * ROW_H + 4}
          stroke="var(--text-primary)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.45}
        />
      </ChartSvg>

      <p className="mt-1 text-mini text-ink-muted">
        {formatArea(residual.areaSqm)} of {residual.areaBasis} at {formatRate(residual.ratePerSqm)}
      </p>

      <ChartTooltip state={tooltip} containerWidth={W} />
    </ChartContainer>
  );
}
