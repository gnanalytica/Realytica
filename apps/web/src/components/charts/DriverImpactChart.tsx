import { useState } from 'react';
import type { ValueDriver } from '@valytica/shared';
import { pct, titleCase } from '../../lib/format';
import {
  BaselineAxis,
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  ChartTooltip,
  DirectedBar,
  TickText,
  TooltipRow,
  niceTicks,
  scaleLinear,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface DriverImpactChartProps {
  drivers: ValueDriver[];
  height?: number;
}

const ROW_H = 30;
const BAR_H = 16;
const AXIS_H = 22;

/**
 * Diverging horizontal bars around a zero baseline: positive contribution in
 * `--series-1`, negative in `--series-8` — a polarity encoding, not a
 * categorical one, matching the "diverging = two hues + neutral midpoint" rule.
 */
export default function DriverImpactChart({ drivers, height }: DriverImpactChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const sorted = [...drivers].sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
  const H = height ?? sorted.length * ROW_H + AXIS_H + 8;

  if (sorted.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No value drivers identified" height={H} />
      </ChartContainer>
    );
  }

  if (size.width <= 0) {
    return <div ref={containerRef} style={{ height: H }} />;
  }

  const leftLabelWidth = Math.min(180, Math.max(96, size.width * 0.3));
  const plotLeft = leftLabelWidth;
  // Truncate to whatever actually fits in leftLabelWidth (minus its 10px gutter)
  // rather than a fixed character count, so a narrow chart shortens labels
  // instead of running them off the left edge of the SVG.
  const labelMaxChars = Math.max(4, Math.floor((leftLabelWidth - 10) / 6.5));
  const plotRight = size.width - 44;
  const plotTop = 6;
  const plotBottom = plotTop + sorted.length * ROW_H;

  const maxAbs = Math.max(0.5, ...sorted.map((d) => Math.abs(d.impactPct))) * 1.2;
  const x = scaleLinear([-maxAbs, maxAbs], [plotLeft, plotRight]);
  const ticks = niceTicks(-maxAbs, maxAbs, 4);

  const ariaLabel = `Value drivers ranked by impact: ${sorted
    .slice(0, 4)
    .map((d) => `${d.label} ${pct(d.impactPct, 1, true)}`)
    .join(', ')}${sorted.length > 4 ? `, and ${sorted.length - 4} more` : ''}`;

  return (
    <ChartContainer innerRef={containerRef} style={{ height: H }}>
      <ChartSvg width={size.width} height={H} ariaLabel={ariaLabel} title="Value driver impact" desc={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={plotTop} y2={plotBottom} stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges" />
            <TickText x={x(t)} y={plotBottom + 14} anchor="middle">
              {pct(t, 0, true)}
            </TickText>
          </g>
        ))}
        <BaselineAxis x1={x(0)} y1={plotTop} x2={x(0)} y2={plotBottom} />

        {sorted.map((d, i) => {
          const rowTop = plotTop + i * ROW_H;
          const rowCenter = rowTop + ROW_H / 2;
          const barY = rowCenter - BAR_H / 2;
          const positive = d.impactPct >= 0;
          const color = positive ? 'var(--series-1)' : 'var(--series-8)';
          const hovered = hoverId === d.id;
          const dataEndX = x(d.impactPct);
          const labelX = positive ? dataEndX + 6 : dataEndX - 6;
          return (
            <g key={d.id}>
              <text
                x={plotLeft - 10}
                y={rowCenter}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--text-primary)"
              >
                {d.label.length > labelMaxChars ? `${d.label.slice(0, Math.max(3, labelMaxChars - 1))}…` : d.label}
              </text>
              <DirectedBar x0={x(0)} x1={dataEndX} y={barY} height={BAR_H} fill={color} opacity={hovered ? 1 : 0.85} />
              <text
                x={labelX}
                y={rowCenter}
                textAnchor={positive ? 'start' : 'end'}
                dominantBaseline="middle"
                fontSize={10.5}
                fontWeight={600}
                fill="var(--text-primary)"
              >
                {pct(d.impactPct, 1, true)}
              </text>
              <rect
                x={plotLeft}
                y={rowTop}
                width={Math.max(0, plotRight - plotLeft)}
                height={ROW_H}
                fill="transparent"
                onMouseEnter={() => setHoverId(d.id)}
                onMouseLeave={() => {
                  setHoverId(null);
                  setTooltip(null);
                }}
                onMouseMove={(e) => {
                  const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  const px = box ? e.clientX - box.left : dataEndX;
                  setTooltip({
                    x: px,
                    y: rowTop,
                    content: (
                      <div className="flex max-w-[13rem] flex-col gap-1">
                        <TooltipRow swatch={color} label={titleCase(d.category)} value={pct(d.impactPct, 1, true)} />
                        <div className="opacity-90">{d.explanation}</div>
                      </div>
                    ),
                  });
                }}
              />
            </g>
          );
        })}
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={size.width} />
    </ChartContainer>
  );
}
