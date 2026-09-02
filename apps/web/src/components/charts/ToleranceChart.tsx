/**
 * Every divergence on the file, against the line it was judged by.
 *
 * The chart this product was missing, and the reason it was missing is that
 * until checks recorded typed values there was nothing to plot. There still
 * is not much: two numbers per comparison. So the interesting question is not
 * how to draw two numbers — it is what axis makes twenty pairs comparable.
 *
 * **Raw percentage is the wrong axis, and it is the obvious one.** A 3%
 * budget variance and a 3% extent variance plot at the same place and read as
 * the same fact. They are not: the budget rule allows 5% and the survey rule
 * allows 1%, so one is comfortably inside its threshold and the other is
 * nearly four times past it. A chart that puts them side by side has said
 * something false with no words at all.
 *
 * So the axis is **multiples of the tolerance**. Every rule's own threshold
 * lands on the same line at 1.0, and the distance past it is directly
 * readable across checks that have nothing else in common. The raw figures
 * stay as the direct label, because normalising is what makes the picture
 * comparable and the actual numbers are what make it checkable.
 *
 * Two things this deliberately does not do:
 *
 * - It does not plot the two values as a pair of bars. That is a picture of
 *   arithmetic a reader can already do, and it buries the only thing that
 *   matters — which side of the line the difference fell on.
 * - It does not draw a comparison with a value missing. A rule waiting on one
 *   of its numbers is an unanswered question, and a mark at the origin would
 *   render it as the safest thing on the page.
 */

import { useMemo } from 'react';
import type { ProjectToleranceRow } from '@realytica/shared';
import { ChartContainer, ChartEmpty, ChartSvg, STATUS_FILL, useMeasure, type StatusKey } from './primitives';

export interface ToleranceChartProps {
  rows: ProjectToleranceRow[];
  /** Opens the check a row is about. A chart you can walk back into the file from. */
  onSelect?: (checkId: string) => void;
  maxRows?: number;
}

const ROW_H = 30;
const LABEL_W = 210;
/* `right` clears the widest label plus the off-scale arrow — "18.2% · breach"
 * with a chevron in front of it. At 64 the three worst rows had their figures
 * clipped off the edge, and the worst rows are the ones somebody opened this
 * for. */
const PAD = { top: 22, right: 104, bottom: 22, left: 8 };

const SEVERITY_STATUS: Record<string, StatusKey> = {
  critical: 'critical',
  high: 'serious',
  medium: 'warning',
  low: 'info',
};

/**
 * A soft ceiling on the axis so one breach cannot flatten everything else.
 *
 * Without it a single divergence forty times its tolerance compresses every
 * other row into the first two pixels, and the chart answers one question
 * while hiding nineteen. Anything past the cap is drawn at the cap with a
 * clipped end, which reads as "off the scale" rather than as a precise
 * position it is not.
 */
const CAP = 4;

/**
 * The tolerance line's position is DERIVED from the cap, not chosen.
 *
 * Setting both independently is how the first version put 4× at 128% of the
 * plot width and pushed the three worst rows off the right edge. One constant
 * decides the scale; the line is wherever 1.0 lands on it.
 */
const LINE_AT = 1 / CAP;

export default function ToleranceChart({ rows, onSelect, maxRows = 12 }: ToleranceChartProps) {
  const [ref, { width }] = useMeasure();

  const shown = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);
  const height = PAD.top + PAD.bottom + Math.max(1, shown.length) * ROW_H;

  if (rows.length === 0) {
    return <ChartEmpty label="No comparison on this file has both of its numbers yet." height={120} />;
  }

  if (width === 0) {
    return <ChartContainer innerRef={ref} style={{ height }}>{null}</ChartContainer>;
  }

  const plotX = LABEL_W + PAD.left;
  const plotW = Math.max(80, width - plotX - PAD.right);
  const at = (overBy: number) => plotX + (Math.min(overBy, CAP) / CAP) * plotW;
  // Fixed at a quarter of the plot on every file, so the eye learns the line
  // once and never has to re-read the axis.
  const lineX = plotX + LINE_AT * plotW;

  return (
    <ChartContainer innerRef={ref} style={{ height }}>
      <ChartSvg
        width={width}
        height={height}
        ariaLabel="Every comparison on this file, plotted as a multiple of its own tolerance"
        title="Divergence against tolerance"
        desc={`${rows.length} comparison(s). The vertical line is each rule's own threshold; marks to the right of it are past that threshold.`}
      >
        {/* The threshold. One line for every rule, because the axis is normalised. */}
        <line x1={lineX} y1={PAD.top - 8} x2={lineX} y2={height - PAD.bottom + 2} stroke="var(--axis)" strokeWidth={1.5} />
        <text x={lineX} y={PAD.top - 12} textAnchor="middle" className="fill-ink-muted" style={{ fontSize: 9.5, letterSpacing: '.08em' }}>
          ITS TOLERANCE
        </text>

        {shown.map((row, i) => {
          const y = PAD.top + i * ROW_H + ROW_H / 2;
          const status: StatusKey = row.within ? 'good' : (SEVERITY_STATUS[row.severity] ?? 'warning');
          const capped = row.overBy > CAP;
          const x = at(row.overBy);
          const label = row.within
            ? `${(row.divergence * 100).toFixed(1)}%`
            : `${(row.divergence * 100).toFixed(1)}% · ${row.overBy === Infinity ? 'breach' : `${row.overBy.toFixed(1)}×`}`;

          return (
            <g
              key={`${row.checkId}-${row.label}`}
              className={onSelect ? 'cursor-pointer' : undefined}
              onClick={onSelect ? () => onSelect(row.checkId) : undefined}
            >
              <title>{`${row.checkTitle} — ${row.label}: ${row.aLabel} against ${row.bLabel}. ${(row.divergence * 100).toFixed(1)}% apart, tolerance ${(row.tolerance * 100).toFixed(1)}%.`}</title>
              {/* A full-row target, so a 9px mark is not the hit area. */}
              <rect x={0} y={y - ROW_H / 2} width={width} height={ROW_H} fill="transparent" />

              <text x={0} y={y - 2} className="fill-ink" style={{ fontSize: 11.5 }}>
                {row.checkTitle.length > 33 ? `${row.checkTitle.slice(0, 32)}…` : row.checkTitle}
              </text>
              <text x={0} y={y + 9} className="fill-ink-muted" style={{ fontSize: 10 }}>
                {row.label.length > 40 ? `${row.label.slice(0, 39)}…` : row.label}
              </text>

              {/* The run from origin to the mark: length is the magnitude, and
                  crossing the line is the finding. */}
              <line x1={plotX} y1={y} x2={x} y2={y} stroke={STATUS_FILL[status]} strokeWidth={2} opacity={0.35} />
              <circle cx={x} cy={y} r={4.5} fill={STATUS_FILL[status]} stroke="var(--surface-2)" strokeWidth={2} />
              {capped ? (
                // Off the scale, drawn as such rather than at a position it
                // does not hold.
                <path d={`M${x + 7} ${y - 4} L${x + 12} ${y} L${x + 7} ${y + 4}`} fill="none" stroke={STATUS_FILL[status]} strokeWidth={1.5} />
              ) : null}

              <text
                x={Math.min(x + (capped ? 17 : 10), width - 4)}
                y={y + 3.5}
                className="fill-ink-secondary"
                style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </ChartSvg>
    </ChartContainer>
  );
}
