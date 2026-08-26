import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CurrencyCode } from '@realytica/shared';
import { perSqm } from '../../lib/format';
import { formatRate, useAreaUnitForCurrency } from '../../lib/units';
import {
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  ChartTooltip,
  Crosshair,
  TickText,
  TooltipRow,
  compactAxisNumber,
  nearestIndex,
  niceTicks,
  padDomain,
  scaleLinear,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface MarketTrendPoint {
  period: string;
  medianPricePerSqm: number;
}

export interface MarketTrendChartProps {
  trend: MarketTrendPoint[];
  currency: CurrencyCode;
  height?: number;
}

const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 26;

/** A single-series line + area wash — median price/m² over time, endpoint-labelled, with a crosshair tooltip. */
export default function MarketTrendChart({ trend, currency, height = 200 }: MarketTrendChartProps) {
  // Labels only — the scale stays on the stored per-m² series.
  const areaUnit = useAreaUnitForCurrency(currency);
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (trend.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No market trend data available" height={height} />
      </ChartContainer>
    );
  }

  if (size.width <= 0) {
    return <div ref={containerRef} style={{ height }} />;
  }

  const axisH = 22;
  const plotLeft = PAD_LEFT;
  const plotRight = size.width - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = height - axisH;

  const values = trend.map((t) => t.medianPricePerSqm);
  const [dMin, dMax] = padDomain(Math.min(...values), Math.max(...values), 0.18);
  const x = scaleLinear([0, Math.max(1, trend.length - 1)], [plotLeft, plotRight]);
  const y = scaleLinear([dMin, dMax], [plotBottom, plotTop]);

  const positions = trend.map((_, i) => x(i));
  const linePath = trend.map((t, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(t.medianPricePerSqm)}`).join(' ');
  const areaPath = `${linePath} L ${x(trend.length - 1)} ${plotBottom} L ${x(0)} ${plotBottom} Z`;

  const ticks = niceTicks(dMin, dMax, 3);
  const first = trend[0];
  const last = trend[trend.length - 1];
  const firstYoy = trend.length > 1 ? ((last.medianPricePerSqm - first.medianPricePerSqm) / first.medianPricePerSqm) * 100 : 0;

  const ariaLabel = `Market trend across ${trend.length} periods, from ${formatRate(first.medianPricePerSqm, areaUnit, currency)} in ${first.period} to ${perSqm(
    last.medianPricePerSqm,
    currency,
  )} in ${last.period} (${firstYoy >= 0 ? '+' : ''}${firstYoy.toFixed(1)}% overall)`;

  function handleMove(e: ReactMouseEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const px = box ? e.clientX - box.left : 0;
    const idx = nearestIndex(positions, px);
    setHoverIdx(idx);
    const point = trend[idx];
    setTooltip({
      x: x(idx),
      y: y(point.medianPricePerSqm),
      content: <TooltipRow swatch="var(--series-1)" label={point.period} value={formatRate(point.medianPricePerSqm, areaUnit, currency)} />,
    });
  }

  function handleLeave() {
    setTooltip(null);
    setHoverIdx(null);
  }

  // Show every other x-axis label once it gets crowded, but always keep the first and last.
  const labelStride = trend.length > 6 ? Math.ceil(trend.length / 6) : 1;

  return (
    <ChartContainer innerRef={containerRef} style={{ height }}>
      <ChartSvg width={size.width} height={height} ariaLabel={ariaLabel} title="Market trend" desc={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges" />
            <TickText x={plotLeft - 6} y={y(t)} anchor="end">
              {compactAxisNumber(t)}
            </TickText>
          </g>
        ))}

        <path d={areaPath} fill="var(--series-1)" opacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hoverIdx !== null ? <Crosshair x={x(hoverIdx)} y0={plotTop} y1={plotBottom} /> : null}

        {trend.map((t, i) => {
          const isEnd = i === 0 || i === trend.length - 1;
          const isHover = hoverIdx === i;
          if (!isEnd && !isHover) return null;
          return (
            <circle
              key={t.period + i}
              cx={x(i)}
              cy={y(t.medianPricePerSqm)}
              r={isHover ? 4.5 : 4}
              fill="var(--series-1)"
              stroke="var(--page)"
              strokeWidth={2}
            />
          );
        })}

        {/* endpoint labels only */}
        <text x={x(0)} y={y(first.medianPricePerSqm) - 10} textAnchor="start" fontSize={11} fontWeight={600} fill="var(--text-primary)">
          {formatRate(first.medianPricePerSqm, areaUnit, currency)}
        </text>
        <text x={x(trend.length - 1)} y={y(last.medianPricePerSqm) - 10} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--text-primary)">
          {formatRate(last.medianPricePerSqm, areaUnit, currency)}
        </text>

        {trend.map((t, i) =>
          i % labelStride === 0 || i === trend.length - 1 ? (
            <TickText key={`x-${t.period}-${i}`} x={x(i)} y={plotBottom + 14} anchor="middle">
              {t.period}
            </TickText>
          ) : null,
        )}

        <rect
          x={plotLeft}
          y={plotTop}
          width={Math.max(0, plotRight - plotLeft)}
          height={Math.max(0, plotBottom - plotTop)}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        />
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={size.width} />
    </ChartContainer>
  );
}
