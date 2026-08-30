
export interface AreaReconcileChartProps {
  /** Area computed from the supplied outline. */
  measuredSqm: number;
  /** Area the deed or khata records. */
  statedSqm: number;
  /** How to render an area in the reader's chosen unit. */
  formatArea: (sqm: number) => string;
  /** Above this, the gap is a finding rather than tracing noise. */
  materialPct?: number;
}

/**
 * Two figures for the same parcel, drawn against each other.
 *
 * Measured and on-record sat side by side as two stat tiles and a sentence
 * giving the percentage. That reads as two facts; what it is, is one
 * disagreement — and the thing a developer needs from it is not the percentage
 * but the *quantity* of land in dispute, because that is what gets paid for
 * per square foot and what carries FAR.
 *
 * So the two bars share one scale and the difference is drawn as the piece
 * that overhangs, labelled in area. Nothing is reconciled: both bars are the
 * length their own source says, which is the honest rendering of a
 * disagreement that belongs to a surveyor.
 *
 * One hue for both, because they are the same measurement from two sources
 * rather than two categories. The overhang carries a status tint only when
 * the gap is material, where the colour means something.
 */

const BAR_H = 22;
const ROW_H = 34;
const LABEL_W = 96;

export default function AreaReconcileChart({
  measuredSqm,
  statedSqm,
  formatArea,
  materialPct = 5,
}: AreaReconcileChartProps) {
  if (measuredSqm <= 0 || statedSqm <= 0) return null;

  const max = Math.max(measuredSqm, statedSqm);
  const gap = measuredSqm - statedSqm;
  const gapPct = (gap / statedSqm) * 100;
  const material = Math.abs(gapPct) >= materialPct;
  const shortfall = gap < 0;

  const rows = [
    { key: 'measured', label: 'Measured', value: measuredSqm },
    { key: 'stated', label: 'On record', value: statedSqm },
  ];

  // A plain div, not `ChartContainer`: this draws in CSS rather than SVG,
  // so there is no width to measure and no ref to give the container.
  return (
    <div className="relative w-full">
      <div
        role="img"
        aria-label={`Measured ${formatArea(measuredSqm)} against a recorded extent of ${formatArea(statedSqm)} — a difference of ${formatArea(Math.abs(gap))}`}
      >
        {rows.map((r) => {
          const isShorter = r.value === Math.min(measuredSqm, statedSqm);
          return (
            <div key={r.key} className="flex items-center" style={{ height: ROW_H }}>
              <span className="shrink-0 text-right text-mini text-ink-secondary" style={{ width: LABEL_W }}>
                {r.label}
              </span>
              <div className="ml-2 flex flex-1 items-center">
                <div
                  className="rounded-l-md"
                  style={{
                    width: `${(r.value / max) * 100}%`,
                    height: BAR_H,
                    background: 'var(--series-1)',
                    opacity: r.key === 'measured' ? 1 : 0.72,
                    borderTopRightRadius: isShorter ? 0 : 6,
                    borderBottomRightRadius: isShorter ? 0 : 6,
                  }}
                />
                {/*
                  * The difference, drawn as the piece the shorter figure is
                  * missing rather than as a separate mark below the bars. It
                  * was a floating rule and read as a rendering artifact; as
                  * an extension it reads as what it is — how much further
                  * this bar would have to run to agree with the other.
                  */}
                {isShorter ? (
                  <div
                    className="rounded-r-md"
                    style={{
                      width: `${Math.max((Math.abs(gap) / max) * 100, 0.6)}%`,
                      height: BAR_H,
                      background: material ? 'var(--warning)' : 'var(--axis)',
                      opacity: material ? 0.5 : 0.28,
                    }}
                  />
                ) : null}
              </div>
              <span className="ml-2 w-24 shrink-0 text-right font-mono text-mini tabular-nums text-ink">
                {formatArea(r.value)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="m-0 mt-1 text-mini leading-relaxed text-ink-secondary">
        <span className="font-semibold tabular-nums text-ink">{formatArea(Math.abs(gap))}</span>{' '}
        {shortfall ? 'less than the record' : 'more than the record'} — {Math.abs(gapPct).toFixed(1)}%.{' '}
        {material
          ? shortfall
            ? 'Priced per unit area, that is the overpayment; on a development site it takes the permitted area with it.'
            : 'Building on the difference is building on land the deed does not convey.'
          : 'Within what hand-tracing an outline explains.'}
      </p>
    </div>
  );
}
