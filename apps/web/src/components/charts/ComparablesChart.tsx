import { useState } from 'react';
import type { Comparable, CurrencyCode } from '@valytica/shared';
import { area, date, perSqm, pct } from '../../lib/format';
import { formatArea, formatRate, useAreaUnitForCurrency } from '../../lib/units';
import {
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  ChartTooltip,
  Legend,
  TickText,
  TooltipRow,
  niceTicks,
  padDomain,
  scaleLinear,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface ComparablesChartProps {
  comparables: Comparable[];
  subjectPricePerSqm?: number | null;
  currency: CurrencyCode;
  height?: number;
}

const PAD_LEFT = 82; // fits a full 'DD Mon YYYY' tick label without clipping
const PAD_RIGHT = 16;
const PAD_TOP = 14;
const AXIS_H = 26;

/**
 * A dot plot of adjusted price/m² (x) against transaction recency (y). Dot
 * radius carries similarity — a second, non-hue channel — and the subject is
 * a distinct dashed reference line, never folded into the comparable color.
 */
export default function ComparablesChart({ comparables, subjectPricePerSqm, currency, height = 240 }: ComparablesChartProps) {
  // Only the tick and tooltip labels convert; the scale is computed on the
  // stored per-m² values so no rounding reaches the plotted geometry.
  const areaUnit = useAreaUnitForCurrency(currency);
  const rateUnitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  if (comparables.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No comparables were used in this range" height={height} />
      </ChartContainer>
    );
  }

  if (size.width <= 0) {
    return <div ref={containerRef} style={{ height }} />;
  }

  const plotLeft = PAD_LEFT;
  const plotRight = size.width - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = height - AXIS_H;

  const prices = comparables.map((c) => c.adjustedPricePerSqm);
  const subject = subjectPricePerSqm ?? null;
  const priceMin = Math.min(...prices, ...(subject != null ? [subject] : []));
  const priceMax = Math.max(...prices, ...(subject != null ? [subject] : []));
  const [dMin, dMax] = padDomain(priceMin, priceMax, 0.12);
  const x = scaleLinear([dMin, dMax], [plotLeft, plotRight]);

  const timestamps = comparables.map((c) => new Date(c.transactedAt).getTime()).filter((t) => !Number.isNaN(t));
  const tMin = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
  const tMax = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  const y = scaleLinear([tMin, tMax], [plotBottom, plotTop]);

  const similarities = comparables.map((c) => c.similarity);
  const simMin = Math.min(...similarities);
  const simMax = Math.max(...similarities);
  const radius = scaleLinear([simMin, simMax], simMin === simMax ? [6, 6] : [5, 9]);

  const xTicks = niceTicks(dMin, dMax, 4);
  const yTickTs = tMin === tMax ? [tMin] : [tMin, tMin + (tMax - tMin) / 2, tMax];

  const ariaLabel = `${comparables.length} comparables plotted by adjusted price per square metre and transaction recency${
    subject != null ? `, subject at ${formatRate(subject, areaUnit, currency)}` : ''
  }`;

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg width={size.width} height={height} ariaLabel={ariaLabel} title="Market comparables" desc={ariaLabel}>
        {xTicks.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={plotTop} y2={plotBottom} stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges" />
        ))}
        {yTickTs.map((t) => (
          <g key={t}>
            <line x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges" />
            <TickText x={plotLeft - 8} y={y(t)} anchor="end">
              {date(new Date(t).toISOString())}
            </TickText>
          </g>
        ))}
        {xTicks.map((t) => (
          <TickText key={`x-${t}`} x={x(t)} y={plotBottom + 15} anchor="middle">
            {formatRate(t, areaUnit, currency)}
          </TickText>
        ))}

        {subject != null ? (
          <g>
            <line x1={x(subject)} x2={x(subject)} y1={plotTop} y2={plotBottom} stroke="var(--text-secondary)" strokeWidth={1.5} strokeDasharray="3 3" />
            <text x={x(subject)} y={plotTop - 3} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-secondary)">
              Subject
            </text>
          </g>
        ) : null}

        {comparables.map((c) => {
          const cx = x(c.adjustedPricePerSqm);
          const cy = y(new Date(c.transactedAt).getTime() || tMin);
          const r = radius(c.similarity);
          const hovered = hoverId === c.id;
          const adjSummary = c.adjustments.length > 0 ? c.adjustments.map((a) => `${a.label} ${pct(a.pct, 1, true)}`).join(', ') : 'none';
          return (
            <g key={c.id}>
              <circle cx={cx} cy={cy} r={r} fill="var(--series-1)" opacity={hovered ? 1 : 0.75} stroke="var(--page)" strokeWidth={2} />
              <circle
                cx={cx}
                cy={cy}
                r={Math.max(12, r + 6)}
                fill="transparent"
                onMouseEnter={() => setHoverId(c.id)}
                onMouseLeave={() => {
                  setHoverId(null);
                  setTooltip(null);
                }}
                onMouseMove={() =>
                  setTooltip({
                    x: cx,
                    y: cy - r,
                    content: (
                      <div className="flex max-w-[15rem] flex-col gap-1">
                        <div className="font-semibold">{c.label}</div>
                        <div className="opacity-80">{c.address}</div>
                        <TooltipRow swatch="var(--series-1)" label={`adjusted /${rateUnitLabel}`} value={formatRate(c.adjustedPricePerSqm, areaUnit, currency)} />
                        <TooltipRow label={`raw /${rateUnitLabel}`} value={formatRate(c.pricePerSqm, areaUnit, currency)} />
                        <TooltipRow label="area" value={area(c.areaSqm)} />
                        <TooltipRow label="transacted" value={date(c.transactedAt)} />
                        <TooltipRow label="distance" value={`${c.distanceKm.toFixed(1)} km`} />
                        <TooltipRow label="similarity" value={pct(c.similarity * 100, 0)} />
                        <div className="opacity-80">Adjustments: {adjSummary}</div>
                      </div>
                    ),
                  })
                }
              />
            </g>
          );
        })}
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={size.width} />
      <Legend
        className="mt-1.5 px-1"
        items={[
          { label: 'Comparable (size = similarity)', color: 'var(--series-1)' },
          ...(subject != null ? [{ label: 'Subject', color: 'var(--text-secondary)', shape: 'line' as const }] : []),
        ]}
      />
    </ChartContainer>
  );
}
