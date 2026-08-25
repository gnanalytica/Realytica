import { useState } from 'react';
import type { CurrencyCode } from '@valytica/shared';
import { money, pct } from '../../lib/format';
import {
  ChartContainer,
  ChartSvg,
  ChartTooltip,
  TickText,
  TooltipRow,
  niceTicks,
  padDomain,
  scaleLinear,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface ValueRangeAnchorRow {
  label: string;
  method: string;
  low: number;
  mid: number;
  high: number;
}

export interface ValueRangeChartProps {
  low: number;
  mid: number;
  high: number;
  currency: CurrencyCode;
  askingPrice?: number | null;
  anchors?: ValueRangeAnchorRow[];
  height?: number;
}

const PAD_LEFT_BASE = 14;
const PAD_RIGHT = 16;

/**
 * The app's signature chart: a horizontal indicative-value band with a strong
 * mid marker, the asking price as a distinct dashed reference, and — in full
 * mode — each anchor's own range as a thin supporting row so method
 * disagreement (uncertainty) is visible at a glance.
 *
 * Passing a small `height` (<100) switches to a compact "mini" mode with no
 * anchor rows and no end labels — for side-by-side use (e.g. Compare headers).
 */
export default function ValueRangeChart({ low, mid, high, currency, askingPrice, anchors, height }: ValueRangeChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const compact = typeof height === 'number' && height < 100;
  const rows = compact ? [] : anchors ?? [];
  const leftLabelWidth = rows.length > 0 ? Math.min(148, Math.max(72, size.width * 0.22)) : 0;
  const padLeft = PAD_LEFT_BASE + leftLabelWidth;
  // Truncate anchor-row labels to whatever actually fits in leftLabelWidth,
  // rather than a fixed character count — narrow charts get shorter labels
  // instead of overflowing the label column into the plotted bars.
  const labelMaxChars = Math.max(4, Math.floor((leftLabelWidth - 6) / 6.5));

  const mainRowH = compact ? Math.max(28, height ?? 56) : 68;
  const anchorRowH = 26;
  const axisH = compact ? 0 : 22;
  const askingLabelH = askingPrice != null && !compact ? 16 : 0;
  const natural = askingLabelH + mainRowH + rows.length * anchorRowH + axisH + 8;
  const H = compact ? mainRowH : height ?? natural;

  const asking = askingPrice ?? null;
  const values = [low, mid, high, ...(asking != null ? [asking] : []), ...rows.flatMap((a) => [a.low, a.mid, a.high])];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const [domainMin, domainMax] = padDomain(rawMin, rawMax, 0.1);

  if (size.width <= 0) {
    return <div ref={containerRef} style={{ height: H }} />;
  }

  const plotLeft = padLeft;
  const plotRight = size.width - PAD_RIGHT;
  const x = scaleLinear([domainMin, domainMax], [plotLeft, plotRight]);

  const askingTop = askingLabelH;
  const mainTop = askingTop;
  const mainCenterY = mainTop + mainRowH / 2;
  const bandThickness = compact ? Math.min(16, mainRowH * 0.4) : 20;

  const anchorsTop = mainTop + mainRowH;
  const axisTop = anchorsTop + rows.length * anchorRowH;
  const plotBottom = compact ? mainTop + mainRowH : axisTop;

  const ticks = compact ? [] : niceTicks(domainMin, domainMax, Math.max(2, Math.min(5, Math.floor(size.width / 90))));

  const askingVsMidPct = asking != null && mid !== 0 ? ((asking - mid) / mid) * 100 : null;

  // Approximate label widths so the "Asking ..." annotation and the mid-value
  // label never collide when the two values sit close together on the axis —
  // fall back to the bare word "Asking" (full value stays in the tooltip).
  const APPROX_CHAR_W = 5.6;
  const approxTextWidth = (s: string) => s.length * APPROX_CHAR_W + 4;
  const midText = money(mid, currency);
  const askingValueText = asking != null ? `Asking ${money(asking, currency)}` : '';
  const askingLabelCollides =
    asking != null &&
    Math.abs(x(asking) - x(mid)) < approxTextWidth(midText) / 2 + approxTextWidth(askingValueText) / 2 + 6;
  const askingLabelText = askingLabelCollides ? 'Asking' : askingValueText;

  const ariaParts = [
    `Indicative value ${money(low, currency)} to ${money(high, currency)}, mid ${money(mid, currency)}`,
    asking != null ? `asking price ${money(asking, currency)}${askingVsMidPct != null ? ` (${pct(askingVsMidPct, 1, true)} vs mid)` : ''}` : null,
    rows.length > 0 ? `${rows.length} valuation method${rows.length === 1 ? '' : 's'} contributing` : null,
  ].filter(Boolean);

  return (
    <ChartContainer innerRef={containerRef} style={{ height: H }}>
      <ChartSvg
        width={size.width}
        height={H}
        ariaLabel={ariaParts.join('. ')}
        title="Indicative value range"
        desc={ariaParts.join('. ')}
      >
        {/* axis gridlines */}
        {ticks.map((t) => {
          const tx = x(t);
          return (
            <line
              key={t}
              x1={tx}
              x2={tx}
              y1={mainTop}
              y2={plotBottom}
              stroke="var(--gridline)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          );
        })}

        {/* asking reference line */}
        {asking != null ? (
          <g>
            <line
              x1={x(asking)}
              x2={x(asking)}
              y1={askingLabelH > 0 ? askingLabelH - 2 : mainTop}
              y2={plotBottom}
              stroke="var(--text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            {!compact ? (
              <text x={x(asking)} y={askingLabelH - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-secondary)">
                {askingLabelText}
              </text>
            ) : null}
            <rect
              x={x(asking) - 10}
              y={mainTop}
              width={20}
              height={plotBottom - mainTop}
              fill="transparent"
              onMouseMove={(e) => {
                const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                const py = box ? e.clientY - box.top : mainCenterY;
                setTooltip({
                  x: x(asking),
                  y: py,
                  content: (
                    <TooltipRow
                      label={askingVsMidPct != null ? `asking · ${pct(askingVsMidPct, 1, true)} vs mid` : 'asking price'}
                      value={money(asking, currency, { compact: false })}
                    />
                  ),
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          </g>
        ) : null}

        {/* main band */}
        <g>
          <rect
            x={x(low)}
            y={mainCenterY - bandThickness / 2}
            width={Math.max(2, x(high) - x(low))}
            height={bandThickness}
            rx={bandThickness / 2}
            fill="var(--series-1)"
            opacity={0.28}
          />
          {/* mid marker */}
          <line x1={x(mid)} x2={x(mid)} y1={mainCenterY - bandThickness / 2 - 4} y2={mainCenterY + bandThickness / 2 + 4} stroke="var(--series-1)" strokeWidth={2} />
          <circle cx={x(mid)} cy={mainCenterY} r={5} fill="var(--series-1)" stroke="var(--page)" strokeWidth={2} />
          {!compact ? (
            <text x={x(mid)} y={mainCenterY - bandThickness / 2 - 10} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text-primary)">
              {money(mid, currency)}
            </text>
          ) : null}
          {!compact ? (
            <>
              <text x={x(low)} y={mainCenterY + bandThickness / 2 + 16} textAnchor="start" fontSize={10} fill="var(--text-muted)">
                {money(low, currency)}
              </text>
              <text x={x(high)} y={mainCenterY + bandThickness / 2 + 16} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                {money(high, currency)}
              </text>
            </>
          ) : null}
          <rect
            x={plotLeft}
            y={mainTop}
            width={plotRight - plotLeft}
            height={mainRowH}
            fill="transparent"
            onMouseMove={(e) => {
              const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
              const px = box ? e.clientX - box.left : x(mid);
              const py = box ? e.clientY - box.top : mainCenterY;
              setTooltip({
                x: px,
                y: py,
                content: (
                  <div className="flex flex-col gap-1">
                    <TooltipRow swatch="var(--series-1)" label="mid" value={money(mid, currency, { compact: false })} />
                    <TooltipRow label="low" value={money(low, currency, { compact: false })} />
                    <TooltipRow label="high" value={money(high, currency, { compact: false })} />
                  </div>
                ),
              });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        </g>

        {/* anchor rows */}
        {rows.map((a, i) => {
          const rowTop = anchorsTop + i * anchorRowH;
          const rowCenter = rowTop + anchorRowH / 2;
          const thin = 7;
          return (
            <g key={a.label + i}>
              <text x={PAD_LEFT_BASE} y={rowCenter} fontSize={11} fill="var(--text-secondary)" dominantBaseline="middle">
                {a.label.length > labelMaxChars ? `${a.label.slice(0, Math.max(3, labelMaxChars - 1))}…` : a.label}
              </text>
              <rect
                x={x(a.low)}
                y={rowCenter - thin / 2}
                width={Math.max(2, x(a.high) - x(a.low))}
                height={thin}
                rx={thin / 2}
                fill="var(--series-1)"
                opacity={0.45}
              />
              <circle cx={x(a.mid)} cy={rowCenter} r={3.5} fill="var(--series-1)" stroke="var(--page)" strokeWidth={1.5} />
              <rect
                x={plotLeft}
                y={rowTop}
                width={plotRight - plotLeft}
                height={anchorRowH}
                fill="transparent"
                onMouseMove={(e) => {
                  const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  const px = box ? e.clientX - box.left : x(a.mid);
                  const py = box ? e.clientY - box.top : rowCenter;
                  setTooltip({
                    x: px,
                    y: py,
                    content: (
                      <div className="flex flex-col gap-1">
                        <div className="font-semibold">{a.label}</div>
                        <TooltipRow label="low" value={money(a.low, currency, { compact: false })} />
                        <TooltipRow swatch="var(--series-1)" label="mid" value={money(a.mid, currency, { compact: false })} />
                        <TooltipRow label="high" value={money(a.high, currency, { compact: false })} />
                      </div>
                    ),
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}

        {/* x axis ticks */}
        {!compact
          ? ticks.map((t) => (
              <TickText key={t} x={x(t)} y={axisTop + 13} anchor="middle">
                {money(t, currency)}
              </TickText>
            ))
          : null}
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={size.width} />
    </ChartContainer>
  );
}
