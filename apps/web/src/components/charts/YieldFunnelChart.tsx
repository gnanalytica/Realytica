import { useState } from 'react';
import type { SchematicYield } from '@realytica/shared';
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

export interface YieldFunnelChartProps {
  yieldResult: SchematicYield;
  /** How to render an area in the reader's chosen unit. */
  formatArea: (sqm: number) => string;
  height?: number;
}

const ROW_H = 32;
const BAR_H = 18;
const LABEL_W = 148;

/**
 * What survives from the zoning table to the buildable area.
 *
 * The four figures were six rows of a definition list, which is a shape that
 * says "here are some facts" rather than "here is what happens to your
 * scheme". The story is a funnel: the zoning offers an envelope, the road
 * width caps it, ground coverage and setbacks take a footprint out of it, and
 * what is left is what can be built.
 *
 * Ordered stages, so the ordinal treatment applies: one hue, each step
 * lighter than the last, because these are the same quantity being reduced
 * rather than four things being compared. The binding constraint is the only
 * mark that carries a status colour, and it carries a label too — colour
 * alone never says which step cost the most.
 */
export default function YieldFunnelChart({ yieldResult: y, formatArea, height }: YieldFunnelChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // The zoning envelope before any site-specific cap, so the road-width cut
  // is visible as a loss rather than assumed into the starting figure.
  const zoningEnvelope = y.farFromZoning * (y.permittedFarAreaSqm / Math.max(y.farApplied, 0.01));

  const stages = [
    {
      key: 'zoning',
      label: `Zoning FAR ${y.farFromZoning}`,
      lossName: 'the zoning cap',
      value: zoningEnvelope,
      note: 'What the locality’s zoning offers before anything about this specific site applies.',
      binding: false,
    },
    {
      key: 'road',
      label: y.farFromRoadWidth !== undefined ? `Road width FAR ${y.farFromRoadWidth}` : 'Road width unknown',
      lossName: 'the abutting road width',
      value: y.permittedFarAreaSqm,
      note:
        y.bindingConstraint === 'road_width'
          ? 'The abutting road caps the FAR below what the zone offers. This is the single largest loss on most Bengaluru sites.'
          : y.bindingConstraint === 'unknown'
            ? 'No road width on file, so the zoning FAR is assumed to apply in full — the optimistic reading.'
            : 'The road is wide enough that the zoning is what binds.',
      binding: y.bindingConstraint === 'road_width',
    },
    {
      key: 'footprint',
      label: `${y.groundCoveragePct}% coverage, ${y.setbackAllRoundM}m setback`,
      lossName: 'ground coverage and setbacks',
      value: Math.min(y.permittedFarAreaSqm, y.footprintSqm * Math.max(y.floorsImplied, 1)),
      note: `A ${formatArea(y.footprintSqm)} footprint over ${y.floorsImplied} floors is what the coverage rule and the setbacks leave.`,
      binding: y.coverageBound,
    },
    {
      key: 'achievable',
      label: 'Achievable',
      lossName: 'the final rounding',
      value: y.achievableFarAreaSqm,
      note: 'FAR area actually buildable once every rule above has applied.',
      binding: false,
    },
  ];

  const H = height ?? stages.length * ROW_H + 26;
  const top = Math.max(...stages.map(s => s.value), 1);

  if (y.permittedFarAreaSqm <= 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No permitted envelope on this site" height={H} />
      </ChartContainer>
    );
  }
  if (size.width <= 0) return <div ref={containerRef} style={{ height: H }} />;

  const W = size.width;
  const plotX0 = LABEL_W;
  /*
   * The right gutter is measured from the widest value it has to hold, not
   * fixed. A fixed 78px fitted "18,225 sqm" and clipped "2,39,766 sq ft" —
   * and Indian digit grouping plus a "sq ft" suffix makes the long form the
   * ordinary case here, not the edge one. ~6.2px per character at 11px in
   * this face, plus the 8px offset the labels are drawn at.
   */
  const widestValue = Math.max(...stages.map(s => formatArea(s.value).length));
  const plotX1 = W - Math.max(78, widestValue * 6.2 + 16);
  const x = scaleLinear([0, top], [plotX0, plotX1]);

  // The largest drop between consecutive stages. Reported in area rather than
  // as a percentage of FAR, because a percentage of a ratio is a number nobody
  // can cost and floor area is a number every developer already prices.
  const losses = stages
    .map((stage, i) => ({ stage, lost: i > 0 ? stages[i - 1].value - stage.value : 0 }))
    .filter((l) => l.lost > 0.5);
  const worstLoss = losses.length > 0 ? losses.reduce((a, b) => (b.lost > a.lost ? b : a)) : null;

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg
        width={W}
        height={H}
        ariaLabel={`Buildable area: the zoning offers ${formatArea(zoningEnvelope)}, and ${formatArea(y.achievableFarAreaSqm)} survives coverage and setbacks`}
        title="What survives to buildable area"
        desc={stages.map(s => `${s.label} ${formatArea(s.value)}`).join('; ')}
      >
        {stages.map((stage, i) => {
          const yPos = i * ROW_H + 4;
          const x1 = x(stage.value);
          // One hue, stepping lighter down the funnel: the same quantity being
          // reduced, not four series being compared.
          const opacity = 1 - i * 0.16;
          const lost = i > 0 ? stages[i - 1].value - stage.value : 0;
          return (
            <g
              key={stage.key}
              onMouseEnter={() =>
                setTooltip({
                  x: (plotX0 + x1) / 2,
                  y: yPos + BAR_H,
                  content: (
                    <>
                      <TooltipRow swatch="var(--series-1)" label={stage.label} value={formatArea(stage.value)} />
                      {lost > 0.5 ? <TooltipRow label="lost at this step" value={formatArea(lost)} /> : null}
                      <TooltipRow label="" value={stage.note} />
                    </>
                  ),
                })
              }
              onMouseLeave={() => setTooltip(null)}
            >
              <TickText x={plotX0 - 8} y={yPos + BAR_H / 2 + 4} anchor="end">
                {stage.label}
              </TickText>
              {/* The ghost of the step above, so the loss is a visible gap. */}
              {i > 0 ? (
                <rect
                  x={plotX0}
                  y={yPos}
                  width={Math.max(2, x(stages[i - 1].value) - plotX0)}
                  height={BAR_H}
                  rx={3}
                  fill="var(--gridline)"
                  opacity={0.35}
                />
              ) : null}
              <rect
                x={plotX0}
                y={yPos}
                width={Math.max(2, x1 - plotX0)}
                height={BAR_H}
                rx={3}
                fill="var(--series-1)"
                opacity={opacity}
              />
              <text
                x={plotX1 + 8}
                y={yPos + BAR_H / 2 + 4}
                className={
                  stage.key === 'achievable'
                    ? 'fill-[var(--text-primary)] text-mini font-semibold tabular'
                    : 'fill-[var(--text-secondary)] text-mini tabular'
                }
              >
                {formatArea(stage.value)}
              </text>
            </g>
          );
        })}
      </ChartSvg>

      {/*
        * The step that cost the most, named in words and in area. The card's
        * headline badge already says which rule binds the FAR; what it cannot
        * say is how much floor area that costs, which is the number a
        * developer actually prices. Colour alone never carries either.
        */}
      <p className="mt-1 text-mini text-ink-muted">
        {worstLoss
          ? `Biggest single loss: ${formatArea(worstLoss.lost)} to ${worstLoss.stage.lossName}.`
          : 'Nothing is lost between the zoning envelope and what can be built.'}
      </p>

      <ChartTooltip state={tooltip} containerWidth={W} />
    </ChartContainer>
  );
}
