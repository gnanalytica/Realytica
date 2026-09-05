/**
 * What has to be spent, and when.
 *
 * The one table a buyer reads a technical DD report for, and the reason it is
 * worth a chart rather than four numbers: the shape of the spend is the answer.
 * INR 40L falling before completion and INR 40L falling in years 5–10 are the
 * same total and a completely different negotiation, and a list of totals
 * makes the reader do that comparison in their head.
 *
 * **The design problem here is not the bars, it is the gap.** A cost summary is
 * built from actions somebody has priced, and on a live file most of them are
 * not priced yet. A chart that plots only the priced ones looks complete — it
 * has bars, it has a total, nothing about it says "and sixteen more we have no
 * figure for". That is the single most load-bearing number in the report and
 * the easiest one to read as final.
 *
 * So the unpriced count is drawn ON the band it belongs to, in warning colour,
 * and never as width. Width would be a fabricated magnitude; a count is the
 * true statement — we know how many, we do not know how much. A band with
 * nothing priced still draws its row, because an empty row that says "3 actions,
 * none priced" is information and a missing row is not.
 *
 * Bands run in time order, top to bottom, rather than by size. The order is the
 * message: immediate first, because that is the money that changes the price.
 */

import { plural, type RemedialCostSummary } from '@realytica/shared';
import { ChartContainer, ChartEmpty, ChartSvg, DirectedBar, STATUS_FILL, compactAxisNumber, scaleLinear, useMeasure, type StatusKey } from './primitives';

export interface RemedialCostChartProps {
  summary: RemedialCostSummary;
  /** Opens the actions in a band. A chart you can walk back into the register from. */
  onSelect?: (actionIds: string[]) => void;
}

const ROW_H = 34;
const LABEL_W = 168;
/* `right` has to clear the longest label the widest bar can carry — the money
 * AND the unpriced suffix, e.g. "INR 7.4M · 1 unpriced". At 108 the suffix was
 * clipped on exactly the row that had one, which is the row somebody opened
 * this for. */
const PAD = { top: 18, right: 150, bottom: 26, left: 8 };

/* Nearer money is the more urgent money, and the colour says so before the
 * label is read. Not a severity — these are bands of time, and the ramp is
 * only ever used in this order. */
const BAND_STATUS: StatusKey[] = ['critical', 'serious', 'warning', 'info'];

export default function RemedialCostChart({ summary, onSelect }: RemedialCostChartProps) {
  const [ref, { width }] = useMeasure();

  const rows = summary.rows.filter((r) => r.count > 0);
  const height = PAD.top + PAD.bottom + Math.max(1, rows.length) * ROW_H;

  if (rows.length === 0) {
    return (
      <ChartEmpty
        label={
          summary.unbanded
            ? `${plural(summary.unbanded, 'open action')}, none of them banded yet.`
            : 'No open action on this file carries a remedial cost band.'
        }
        height={120}
      />
    );
  }

  if (width === 0) {
    return <ChartContainer innerRef={ref} style={{ height }}>{null}</ChartContainer>;
  }

  const plotX = LABEL_W + PAD.left;
  const plotW = Math.max(80, width - plotX - PAD.right);
  const max = Math.max(...rows.map((r) => r.total), 1);
  const x = scaleLinear([0, max], [plotX, plotX + plotW]);
  const money = (n: number) => `${summary.currency} ${compactAxisNumber(n)}`;

  return (
    <ChartContainer innerRef={ref} style={{ height }}>
      <ChartSvg
        width={width}
        height={height}
        ariaLabel="Remedial cost by band, in time order"
        title="Remedial cost by band"
        desc={`${money(summary.total)} priced across ${rows.length} band(s). ${summary.uncosted} banded action(s) and ${summary.unbanded} unbanded one(s) carry no figure and are not in that total.`}
      >
        {rows.map((row, i) => {
          const y = PAD.top + i * ROW_H;
          const mid = y + ROW_H / 2;
          const status = BAND_STATUS[summary.rows.findIndex((r) => r.band === row.band)] ?? 'info';
          const unpriced = row.count - row.costed;

          return (
            <g
              key={row.band}
              className={onSelect ? 'cursor-pointer' : undefined}
              onClick={onSelect ? () => onSelect(row.actionIds) : undefined}
            >
              <title>{`${row.label}: ${summary.currency} ${Math.round(row.total).toLocaleString('en-IN')} across ${row.count} action(s)${unpriced ? `, ${unpriced} of them unpriced` : ''}.`}</title>
              <rect x={0} y={y} width={width} height={ROW_H} fill="transparent" />

              <text x={0} y={mid - 2} className="fill-ink" style={{ fontSize: 11.5 }}>
                {row.label.split(' — ')[0]}
              </text>
              <text x={0} y={mid + 10} className="fill-ink-muted" style={{ fontSize: 10 }}>
                {row.count} action{row.count === 1 ? '' : 's'}
              </text>

              {row.costed > 0 ? (
                <DirectedBar x0={plotX} x1={x(row.total)} y={mid - 7} height={14} fill={STATUS_FILL[status]} opacity={0.85} />
              ) : (
                // No bar and no zero. A zero-length bar labelled "INR 0" says
                // this band is free, which is the opposite of what an unpriced
                // band means — and it is the reading a buyer would act on.
                <line x1={plotX} y1={mid} x2={plotX + 40} y2={mid} stroke={STATUS_FILL.warning} strokeWidth={2} strokeDasharray="3 3" opacity={0.7} />
              )}

              {/* Both figures in ONE label, past the end of the bar. The first
                  version drew the unpriced count inside the bar, where warning
                  text on a warning fill was unreadable on exactly the row that
                  needed reading. Count, never width: we know how many are
                  unpriced, and drawing a magnitude for them would invent the
                  number the reader came here for. */}
              <text
                x={row.costed > 0 ? Math.min(x(row.total) + 8, plotX + plotW + 8) : plotX + 48}
                y={mid + 3.5}
                className="fill-ink-secondary"
                style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}
              >
                {row.costed > 0 ? money(row.total) : null}
                {unpriced ? (
                  <tspan fill={STATUS_FILL.warning}>{row.costed > 0 ? ` · ${unpriced} unpriced` : `${unpriced} unpriced`}</tspan>
                ) : null}
              </text>
            </g>
          );
        })}

        <text x={0} y={height - 8} className="fill-ink-muted" style={{ fontSize: 10 }}>
          {/* A total of zero is not a cheap file, it is an unpriced one. */}
          {summary.total > 0 ? `${money(summary.total)} priced` : 'Nothing priced yet'}
          {summary.unbanded ? ` · ${plural(summary.unbanded, 'open action')} with no band, not in it` : ''}
        </text>
      </ChartSvg>
    </ChartContainer>
  );
}
