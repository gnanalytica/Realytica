import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseSummary, ScreenVerdict } from '@realytica/shared';
import { money } from '../../lib/format';
import {
  BaselineAxis,
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  ChartTooltip,
  GridLine,
  TickText,
  TooltipRow,
  niceTicks,
  padDomain,
  scaleLinear,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface PortfolioScatterProps {
  cases: CaseSummary[];
  height?: number;
}

/* `right` clears the point radius: at 14 the worst case sat half off the edge,
 * and the worst case is the one someone is looking for. */
const PAD = { top: 12, right: 24, bottom: 34, left: 56 };

const VERDICT_FILL: Record<ScreenVerdict, string> = {
  pursue: 'rgb(var(--status-good-rgb))',
  pursue_with_conditions: 'rgb(var(--status-warning-rgb))',
  investigate_further: 'rgb(var(--status-serious-rgb))',
  do_not_pursue: 'rgb(var(--status-critical-rgb))',
};

/**
 * Where to spend attention, across every case at once.
 *
 * The case list answers "what do I have" and nothing answered "which of these
 * needs me". Value against open critical risk does: the expensive property
 * with three critical risks is a different morning's work from the cheap one
 * with none, and in a table sorted by date those two sit next to each other
 * looking identical.
 *
 * Only screened cases with a value can be placed, and the count of those left
 * out is stated rather than quietly dropped — a portfolio view that silently
 * omits half a portfolio is worse than no portfolio view.
 */
export default function PortfolioScatter({ cases, height }: PortfolioScatterProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const navigate = useNavigate();

  const plottable = cases.filter(c => typeof c.indicativeMid === 'number' && c.indicativeMid > 0);
  const omitted = cases.length - plottable.length;
  const H = height ?? 240;

  if (plottable.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No screened case has an indicative value yet" height={H} />
      </ChartContainer>
    );
  }
  if (size.width <= 0) return <div ref={containerRef} style={{ height: H }} />;

  const W = size.width;
  const values = plottable.map(c => c.indicativeMid as number);
  const maxRisk = Math.max(1, ...plottable.map(c => c.openCriticalRisks));
  const [vMin, vMax] = padDomain(0, Math.max(...values));
  const x = scaleLinear([0, maxRisk], [PAD.left, W - PAD.right]);
  const y = scaleLinear([vMin, vMax], [H - PAD.bottom, PAD.top]);
  const currency = plottable[0].currency;

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg
        width={W}
        height={H}
        ariaLabel={`${plottable.length} cases plotted by indicative value against open critical risks`}
        title="Value against open critical risk"
        desc={plottable
          .map(c => `${c.reference} ${money(c.indicativeMid as number, c.currency, { compact: true })} with ${c.openCriticalRisks} critical risks`)
          .join('; ')}
      >
        {niceTicks(vMin, vMax, 4).map(t => (
          <g key={t}>
            <GridLine x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)} />
            <TickText x={PAD.left - 8} y={y(t) + 4} anchor="end">
              {money(t, currency, { compact: true })}
            </TickText>
          </g>
        ))}
        <BaselineAxis x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} />
        {Array.from({ length: maxRisk + 1 }, (_, i) => i).map(r => (
          <TickText key={r} x={x(r)} y={H - PAD.bottom + 16} anchor="middle">
            {String(r)}
          </TickText>
        ))}
        <TickText x={(PAD.left + W - PAD.right) / 2} y={H - 4} anchor="middle">
          Open critical risks
        </TickText>

        {plottable.map(c => (
          <circle
            key={c.id}
            data-portfolio-point={c.reference}
            cx={x(c.openCriticalRisks)}
            cy={y(c.indicativeMid as number)}
            r={7}
            fill={c.verdict ? VERDICT_FILL[c.verdict] : 'var(--text-muted)'}
            fillOpacity={0.75}
            stroke="var(--surface-1)"
            strokeWidth={1.5}
            className="cursor-pointer"
            onClick={() => navigate(`/cases/${c.id}`)}
            onMouseEnter={() =>
              setTooltip({
                x: x(c.openCriticalRisks),
                y: y(c.indicativeMid as number),
                content: (
                  <>
                    <TooltipRow
                      swatch={c.verdict ? VERDICT_FILL[c.verdict] : undefined}
                      label={c.reference}
                      value={c.locality}
                    />
                    <TooltipRow label="indicative" value={money(c.indicativeMid as number, c.currency, { compact: true })} />
                    <TooltipRow label="critical risks" value={String(c.openCriticalRisks)} />
                  </>
                ),
              })
            }
            onMouseLeave={() => setTooltip(null)}
          >
            <title>{`${c.reference} — ${c.locality}, ${c.openCriticalRisks} critical risks`}</title>
          </circle>
        ))}
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={W} />
      {omitted > 0 ? (
        <p className="mt-1 text-[11px] text-ink-secondary">
          {omitted} case{omitted === 1 ? '' : 's'} not plotted — no indicative value until screened.
        </p>
      ) : null}
    </ChartContainer>
  );
}
