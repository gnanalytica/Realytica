import { useId, useState } from 'react';
import type { CurrencyCode, ValueAnchor } from '@realytica/shared';
import { money, pct } from '../../lib/format';
import { seriesColor } from '../../lib/theme';
import {
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  ChartTooltip,
  Legend,
  TooltipRow,
  useMeasure,
  type TooltipState,
} from './primitives';

export interface AnchorWeightChartProps {
  anchors: ValueAnchor[];
  currency: CurrencyCode;
  height?: number;
}

const DIRECT_LABEL_THRESHOLD = 0.12;
const BAR_H = 26;
const LABEL_ROW_H = 30;
const GAP = 2;

/**
 * A single stacked bar of anchor weights. Colour is assigned by each
 * anchor's position in the given (stable) array — never by its sorted
 * rank — so an anchor keeps its identity colour however the bar is ordered.
 * Segments over ~12% get a direct label above the bar; smaller ones fall to
 * the legend, so identity is never colour-alone.
 */
export default function AnchorWeightChart({ anchors, currency, height }: AnchorWeightChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const clipId = useId();

  if (anchors.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No valuation anchors available" height={height ?? 80} />
      </ChartContainer>
    );
  }

  const totalWeight = anchors.reduce((s, a) => s + Math.max(0, a.weight), 0) || 1;
  const colored = anchors.map((a, i) => ({ anchor: a, color: seriesColor(i), frac: Math.max(0, a.weight) / totalWeight }));
  const ordered = [...colored].sort((a, b) => b.frac - a.frac);

  const H = height ?? LABEL_ROW_H + BAR_H + 10;

  if (size.width <= 0) {
    return <div ref={containerRef} style={{ height: H }} />;
  }

  const plotLeft = 8;
  const plotRight = size.width - 8;
  const barW = Math.max(1, plotRight - plotLeft);
  const barY = LABEL_ROW_H;

  let cursor = plotLeft;
  const segments = ordered.map((c) => {
    const w = c.frac * barW;
    const seg = { ...c, x: cursor, w };
    cursor += w;
    return seg;
  });

  /**
   * A direct label is only drawn when its text fits inside its own segment and
   * clears the previous label it would otherwise run into. Everything else
   * falls through to the legend below — identity is never colour-alone either
   * way, and two labels never overlap.
   */
  const APPROX_CHAR_W = 5.6;
  const SWATCH_W = 12;
  const directLabelled = segments.reduce<typeof segments>((kept, s) => {
    if (s.frac <= DIRECT_LABEL_THRESHOLD) return kept;
    const textW = `${s.anchor.label} · ${pct(s.frac * 100, 0)}`.length * APPROX_CHAR_W + SWATCH_W;
    const cx = s.x + s.w / 2;
    const left = cx - 3;
    const right = cx + 6 + textW;
    if (right > plotLeft + barW) return kept;
    const previous = kept[kept.length - 1];
    if (previous) {
      const prevCx = previous.x + previous.w / 2;
      const prevRight =
        prevCx + 6 + `${previous.anchor.label} · ${pct(previous.frac * 100, 0)}`.length * APPROX_CHAR_W + SWATCH_W;
      if (left < prevRight + 8) return kept;
    }
    return [...kept, s];
  }, []);

  const ariaLabel = `Anchor weights: ${ordered.map((c) => `${c.anchor.label} ${pct(c.frac * 100, 0)}`).join(', ')}`;

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg width={size.width} height={H} ariaLabel={ariaLabel} title="Anchor weights" desc={ariaLabel}>
        <defs>
          <clipPath id={clipId}>
            <rect x={plotLeft} y={barY} width={barW} height={BAR_H} rx={BAR_H / 2} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {segments.map((s) => (
            <rect
              key={s.anchor.id}
              x={s.x}
              y={barY}
              width={Math.max(0, s.w)}
              height={BAR_H}
              fill={s.color}
              opacity={hoverId === null || hoverId === s.anchor.id ? 1 : 0.45}
            />
          ))}
          {/* 2px surface gaps between adjacent segments */}
          {segments.slice(1).map((s) => (
            <rect key={`gap-${s.anchor.id}`} x={s.x - GAP / 2} y={barY} width={GAP} height={BAR_H} fill="var(--page)" />
          ))}
        </g>

        {/* direct labels — only where the text actually fits without colliding */}
        {directLabelled.map((s) => {
            const cx = s.x + s.w / 2;
            const text = `${s.anchor.label} · ${pct(s.frac * 100, 0)}`;
            return (
              <g key={`label-${s.anchor.id}`}>
                <line x1={cx} y1={LABEL_ROW_H - 4} x2={cx} y2={barY + 2} stroke="var(--axis)" strokeWidth={1} />
                <circle cx={cx} cy={LABEL_ROW_H - 12} r={3} fill={s.color} />
                <text x={cx + 6} y={LABEL_ROW_H - 12} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="var(--text-primary)">
                  {text}
                </text>
              </g>
            );
          })}

        {/* hover targets */}
        {segments.map((s) => (
          <rect
            key={`hit-${s.anchor.id}`}
            x={s.x}
            y={0}
            width={Math.max(0, s.w)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHoverId(s.anchor.id)}
            onMouseLeave={() => {
              setHoverId(null);
              setTooltip(null);
            }}
            onMouseMove={() =>
              setTooltip({
                x: s.x + s.w / 2,
                y: barY,
                content: (
                  <div className="flex max-w-[15rem] flex-col gap-1">
                    <TooltipRow swatch={s.color} label="weight" value={pct(s.frac * 100, 0)} />
                    <div className="font-semibold">{s.anchor.label}</div>
                    <TooltipRow label="confidence" value={pct(s.anchor.confidence * 100, 0)} />
                    <TooltipRow label="mid value" value={money(s.anchor.mid, currency)} />
                    <div className="opacity-80">{s.anchor.rationale}</div>
                  </div>
                ),
              })
            }
          />
        ))}
      </ChartSvg>
      <ChartTooltip state={tooltip} containerWidth={size.width} />
      <Legend
        className="mt-2 px-1"
        items={ordered
          .filter((s) => !directLabelled.some((d) => d.anchor.id === s.anchor.id))
          .map((s) => ({ label: `${s.anchor.label} (${pct(s.frac * 100, 0)})`, color: s.color }))}
      />
    </ChartContainer>
  );
}
