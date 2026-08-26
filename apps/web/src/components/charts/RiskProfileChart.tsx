import { useState } from 'react';
import type { RiskFlag, RiskSeverity } from '@realytica/shared';
import {
  BaselineAxis,
  ChartContainer,
  ChartSvg,
  ChartTooltip,
  DirectedBar,
  STATUS_FILL,
  TickText,
  TooltipRow,
  niceTicks,
  scaleLinear,
  useMeasure,
  type StatusKey,
  type TooltipState,
} from './primitives';

export interface RiskProfileChartProps {
  risks: RiskFlag[];
  height?: number;
}

const SEVERITY_ORDER: RiskSeverity[] = ['critical', 'serious', 'warning', 'info'];
const SEVERITY_WORD: Record<RiskSeverity, string> = {
  critical: 'Critical',
  serious: 'Serious',
  warning: 'Warning',
  info: 'Info',
};

const ROW_H = 32;
const BAR_H = 18;
const AXIS_H = 20;

/**
 * Counts of material risks by severity — the legitimate status-colour case:
 * each bar is coloured by the reserved severity token and always ships with
 * its severity word as a direct label, never colour alone.
 */
export default function RiskProfileChart({ risks, height }: RiskProfileChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverSeverity, setHoverSeverity] = useState<RiskSeverity | null>(null);

  const H = height ?? SEVERITY_ORDER.length * ROW_H + AXIS_H + 8;

  if (size.width <= 0) {
    return <div ref={containerRef} style={{ height: H }} />;
  }

  const leftLabelWidth = Math.min(120, Math.max(72, size.width * 0.2));
  const plotLeft = leftLabelWidth;
  const plotRight = size.width - 40;
  const plotTop = 4;
  const plotBottom = plotTop + SEVERITY_ORDER.length * ROW_H;

  const counts = SEVERITY_ORDER.map((sev) => {
    const items = risks.filter((r) => r.severity === sev);
    return {
      severity: sev,
      total: items.length,
      open: items.filter((r) => r.status === 'open').length,
      mitigated: items.filter((r) => r.status === 'mitigated').length,
      accepted: items.filter((r) => r.status === 'accepted').length,
    };
  });

  const maxCount = Math.max(1, ...counts.map((c) => c.total));
  const x = scaleLinear([0, maxCount * 1.2], [plotLeft, plotRight]);
  const ticks = niceTicks(0, maxCount * 1.2, 4).filter((t) => Number.isInteger(t) && t >= 0);

  const ariaLabel = `Risk profile by severity: ${counts.map((c) => `${c.total} ${SEVERITY_WORD[c.severity].toLowerCase()}`).join(', ')}`;

  return (
    <ChartContainer innerRef={containerRef} style={{ height: H }}>
      <ChartSvg width={size.width} height={H} ariaLabel={ariaLabel} title="Risk profile" desc={ariaLabel}>
        {ticks.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={plotTop} y2={plotBottom} stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges" />
        ))}
        <BaselineAxis x1={x(0)} y1={plotTop} x2={x(0)} y2={plotBottom} />

        {counts.map((c, i) => {
          const rowTop = plotTop + i * ROW_H;
          const rowCenter = rowTop + ROW_H / 2;
          const barY = rowCenter - BAR_H / 2;
          const color = STATUS_FILL[c.severity as StatusKey];
          const hovered = hoverSeverity === c.severity;
          const dataEndX = x(c.total);
          return (
            <g key={c.severity}>
              <text x={plotLeft - 10} y={rowCenter} textAnchor="end" dominantBaseline="middle" fontSize={11} fontWeight={500} fill="var(--text-primary)">
                {SEVERITY_WORD[c.severity]}
              </text>
              {c.total > 0 ? (
                <DirectedBar x0={x(0)} x1={dataEndX} y={barY} height={BAR_H} fill={color} opacity={hovered ? 1 : 0.85} />
              ) : (
                <line x1={x(0)} x2={x(0) + 3} y1={rowCenter} y2={rowCenter} stroke="var(--axis)" strokeWidth={2} />
              )}
              <text x={dataEndX + 8} y={rowCenter} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="var(--text-primary)">
                {c.total}
              </text>
              <rect
                x={plotLeft}
                y={rowTop}
                width={Math.max(0, plotRight - plotLeft)}
                height={ROW_H}
                fill="transparent"
                onMouseEnter={() => setHoverSeverity(c.severity)}
                onMouseLeave={() => {
                  setHoverSeverity(null);
                  setTooltip(null);
                }}
                onMouseMove={(e) => {
                  const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  const px = box ? e.clientX - box.left : dataEndX;
                  setTooltip({
                    x: px,
                    y: rowTop,
                    content: (
                      <div className="flex flex-col gap-1">
                        <TooltipRow swatch={color} label={SEVERITY_WORD[c.severity]} value={`${c.total}`} />
                        <div className="opacity-85">
                          {c.open} open · {c.mitigated} mitigated · {c.accepted} accepted
                        </div>
                      </div>
                    ),
                  });
                }}
              />
            </g>
          );
        })}

        {ticks.map((t) => (
          <TickText key={`x-${t}`} x={x(t)} y={plotBottom + 13} anchor="middle">
            {t}
          </TickText>
        ))}
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={size.width} />
    </ChartContainer>
  );
}
