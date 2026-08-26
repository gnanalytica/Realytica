import { useState } from 'react';
import type { TransactionCostBreakdown } from '@realytica/shared';
import { money, pct } from '../../lib/format';
import {
  BaselineAxis,
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

export interface CostWaterfallChartProps {
  costs: TransactionCostBreakdown;
  /** The agreed price, when it differs from the dutiable value. */
  askingPrice?: number;
  height?: number;
}

const ROW_H = 34;
const BAR_H = 20;
const AXIS_H = 24;
const LABEL_W = 132;

/**
 * What the property actually costs, stacked from the price upward.
 *
 * The lines were a table, and a table of four numbers is a thing nobody adds
 * up: stamp duty, cess, surcharge and registration on a ₹1.35 Cr flat come to
 * ₹8.9 lakh, which is a fact about affordability rather than about
 * conveyancing. A waterfall makes the running total the shape of the chart, so
 * the answer to "what do I actually need" is read rather than computed.
 *
 * Each cost segment starts where the previous one ended. Colour separates the
 * price from what is added to it — one hue for the base, one for the statutory
 * additions — rather than giving each line its own, because the categories are
 * not being compared with each other, they are being accumulated.
 */
export default function CostWaterfallChart({ costs, askingPrice, height }: CostWaterfallChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const base = askingPrice ?? costs.dutiableValue;
  const rows = [
    { key: 'base', label: askingPrice ? 'Price' : 'Dutiable value', amount: base, running: base, isBase: true, note: '' },
    ...costs.lines.map((l, i) => {
      const running = base + costs.lines.slice(0, i + 1).reduce((s, x) => s + x.amount, 0);
      return { key: l.key, label: l.label, amount: l.amount, running, isBase: false, note: l.note };
    }),
  ];
  const total = base + costs.total;
  const H = height ?? rows.length * ROW_H + AXIS_H + 30;

  if (costs.lines.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No transaction costs computed for this property" height={H} />
      </ChartContainer>
    );
  }
  if (size.width <= 0) return <div ref={containerRef} style={{ height: H }} />;

  const W = size.width;
  const plotX0 = LABEL_W;
  const plotX1 = W - 8;
  const x = scaleLinear([0, total], [plotX0, plotX1]);
  const axisY = H - AXIS_H;

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg
        width={W}
        height={H}
        /*
         * Full figures, not compact. Compact rounds ₹1.35 Cr and ₹1.44 Cr both
         * to "₹1.4 Cr", so the spoken label read as though the ₹8.9 lakh of
         * duty were free — the whole point of the chart, rounded away.
         */
        ariaLabel={`Transaction costs: ${money(base, costs.currency, { compact: false })} plus ${money(costs.total, costs.currency, { compact: false })} in duties and fees, ${money(total, costs.currency, { compact: false })} in total`}
        title="Total cost of acquisition"
        desc={`${rows.map(r => `${r.label} ${money(r.amount, costs.currency, { compact: false })}`).join('; ')}. Total ${money(total, costs.currency, { compact: false })}.`}
      >
        {rows.map((r, i) => {
          const y = i * ROW_H + 4;
          const start = r.isBase ? 0 : r.running - r.amount;
          const x0 = x(start);
          const x1 = x(r.running);
          return (
            <g
              key={r.key}
              onMouseEnter={() =>
                setTooltip({
                  x: (x0 + x1) / 2,
                  y: y + BAR_H,
                  content: (
                    <>
                      <TooltipRow
                        swatch={r.isBase ? 'var(--series-1)' : 'var(--series-4)'}
                        label={r.label}
                        value={money(r.amount, costs.currency)}
                      />
                      <TooltipRow label="running total" value={money(r.running, costs.currency)} />
                    </>
                  ),
                })
              }
              onMouseLeave={() => setTooltip(null)}
            >
              <TickText x={plotX0 - 8} y={y + BAR_H / 2 + 4} anchor="end">
                {r.label}
              </TickText>
              {/* A connector from the previous total, so the stacking reads as accumulation. */}
              {!r.isBase ? (
                <line x1={x0} y1={y - ROW_H + BAR_H / 2} x2={x0} y2={y + BAR_H / 2} stroke="var(--gridline)" strokeWidth={1} />
              ) : null}
              <rect
                x={x0}
                y={y}
                width={Math.max(2, x1 - x0)}
                height={BAR_H}
                rx={3}
                fill={r.isBase ? 'var(--series-1)' : 'var(--series-4)'}
              />
              <text
                x={x1 + 6}
                y={y + BAR_H / 2 + 4}
                className="fill-[var(--text-secondary)] text-[11px] tabular"
              >
                {money(r.amount, costs.currency, { compact: true })}
              </text>
            </g>
          );
        })}

        {/* The total, as a rule rather than another bar — it is a position, not a quantity added. */}
        <line x1={x(total)} y1={0} x2={x(total)} y2={axisY} stroke="var(--text-primary)" strokeWidth={1} strokeDasharray="3 3" />
        <BaselineAxis x1={plotX0} y1={axisY} x2={plotX1} y2={axisY} />
        <TickText x={plotX0} y={axisY + 16} anchor="start">
          0
        </TickText>
        <TickText x={plotX1} y={axisY + 16} anchor="end">
          {`${money(total, costs.currency, { compact: false })} all in`}
        </TickText>
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={W} />
      <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">
        {money(costs.total, costs.currency)} on top of the price — {pct(costs.totalPctOfPrice, 1)} — computed on a
        dutiable value of {money(costs.dutiableValue, costs.currency)}
        {costs.dutiableBasis === 'statutory_guidance_value'
          ? ', which is the guidance value rather than the price because it is the higher of the two.'
          : '.'}
      </p>
    </ChartContainer>
  );
}
