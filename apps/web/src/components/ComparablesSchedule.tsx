/**
 * The adjustment grid — the one table a valuer actually checks.
 *
 * The engine adjusts every comparable for time, size, road width, corner
 * position, facing, site shape, layout approval, condition and tenure, stores
 * each signed percentage on the transaction, compounds them into an adjusted
 * rate and weights that by similarity to produce the comparable anchor. All of
 * it was computed, stored and auditable — and rendered nowhere. The Comparables
 * card showed a scatter of adjusted rate against date, under an `info` string
 * that said "Adjustments are shown per transaction". They were not shown at
 * all. A reader could see that a comparable had been moved and never what had
 * moved it.
 *
 * That is the whole reason this is a table and not another chart. The question
 * is not "what is the shape of the set" — the scatter answers that, and keeps
 * its place above. It is "why is THIS transaction being treated as evidence of
 * ₹78,400 when it sold at ₹71,000", and the answer is a row of signed
 * percentages you read across. A grid is the form the profession already uses
 * for it, and it is the form that lets somebody disagree with one cell.
 *
 * ## Sign convention, stated on the page
 *
 * An adjustment brings the comparable to what it would have fetched with the
 * SUBJECT's characteristics, so every sign describes the subject, not the
 * comparable. A subject on a narrower road prices its comparables down. This
 * is the convention the engine follows and it is not self-evident from a
 * column of numbers, so the card says it rather than assuming a reader
 * reconstructs it.
 *
 * ## Two shapes, one dataset
 *
 * Up to nine adjustment columns plus five identity columns does not fit in a
 * detail pane, and shrinking the type until it does is how a table becomes
 * unreadable rather than narrow. So the grid is the wide layout, scrolling
 * horizontally inside its own box with the comparable's name pinned; under a
 * container query the same rows render stacked, each adjustment on its own
 * line. Neither is a summary of the other — both carry every figure.
 */

import type { Comparable } from '@realytica/shared';
import { Card, CardBody, CardHeader, Tooltip, cn } from './ui/kit';
import { FormulaTip } from './FormulaTip';

/**
 * Column headings, short enough to sit over a number.
 *
 * The stored labels carry their own parameter — "Road width (40ft)", "Facing
 * (north east)" — which is the right thing on a row and far too long for a
 * column head. The full label goes in the header's tooltip, so nothing is
 * lost.
 */
const SHORT: Record<string, string> = {
  time: 'Time',
  size: 'Size',
  road_width: 'Road',
  corner_site: 'Corner',
  facing: 'Facing',
  dimension_standardness: 'Shape',
  layout_approval: 'Approval',
  condition: 'Condition',
  tenure: 'Tenure',
};

function shortName(key: string, label: string): string {
  return SHORT[key] ?? label.split(/[\s(]/)[0];
}

function rate(n: number, currency: string): string {
  const v = Math.round(n).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  return currency === 'INR' ? `₹${v}` : `${currency} ${v}`;
}

function signed(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** How long ago, in the unit a reader thinks in. */
function age(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const months = Math.round((Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 1) return 'this month';
  if (months < 24) return `${months} mo ago`;
  return `${(months / 12).toFixed(1)} yr ago`;
}

/**
 * The compounded effect of every adjustment on one comparable.
 *
 * Read off the stored rates rather than recomputed from the percentages: the
 * engine rounds the adjusted rate to the currency's own step, and a
 * "net adjustment" derived from the percentage chain would disagree with the
 * adjusted rate printed beside it by a fraction of a percent. Two numbers on
 * one row that do not reconcile is worse than either one alone.
 */
function netPct(comp: Comparable): number | null {
  if (!comp.pricePerSqm) return null;
  return (comp.adjustedPricePerSqm / comp.pricePerSqm - 1) * 100;
}

function toneFor(pct: number): string {
  if (pct === 0) return 'text-ink-muted';
  return pct > 0 ? 'text-[var(--status-good-text)]' : 'text-critical';
}

export function ComparablesSchedule({
  comparables,
  currency,
  /** The subject's area, when the page knows it — turns a rate into a value. */
  subjectAreaSqm,
}: {
  comparables: Comparable[];
  currency: string;
  subjectAreaSqm?: number;
}) {
  if (comparables.length === 0) return null;

  /*
   * Only the adjustments this set actually uses get a column.
   *
   * A fixed nine-column grid on a set that only ever adjusts for time and
   * size is seven columns of em-dash, and it reads as "these were considered
   * and found to be nil" rather than "these do not apply to this property
   * type". Ordered by first appearance so the engine's own order — time,
   * size, then the site attributes — survives.
   */
  const columns: { key: string; label: string }[] = [];
  for (const comp of comparables) {
    for (const adj of comp.adjustments ?? []) {
      if (!columns.some((c) => c.key === adj.key)) columns.push({ key: adj.key, label: adj.label });
    }
  }

  const weights = comparables.map((c) => c.similarity || 0.01);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedMean =
    comparables.reduce((sum, c, i) => sum + c.adjustedPricePerSqm * weights[i], 0) / totalWeight;
  const rates = comparables.map((c) => c.adjustedPricePerSqm);
  const low = Math.min(...rates);
  const high = Math.max(...rates);

  const pctOf = (comp: Comparable, key: string): number | undefined =>
    (comp.adjustments ?? []).find((a) => a.key === key)?.pct;

  return (
    <Card>
      <CardHeader
        title="Adjustment schedule"
        subtitle={`${comparables.length} transaction${comparables.length === 1 ? '' : 's'}, each brought to the subject's own characteristics.`}
        info="Every percentage describes the SUBJECT relative to that comparable — a subject on a narrower road prices its comparables down. Applied multiplicatively, in the order shown, to the transacted rate."
      />
      <CardBody className="[container-type:inline-size]">
        {/* ---------------- wide: the grid ---------------- */}
        <div className="hidden [@container(min-width:40rem)]:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-[10.5px] uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="sticky left-0 z-10 bg-surface py-1.5 pr-3 text-left font-medium">
                    Comparable
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Area m²</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Transacted</th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                      <Tooltip label={c.label}>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">
                          {shortName(c.key, c.label)}
                        </span>
                      </Tooltip>
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Net</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Adjusted</th>
                  <th scope="col" className="pl-2 py-1.5 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {comparables.map((comp, i) => {
                  const net = netPct(comp);
                  return (
                    <tr key={comp.id}>
                      {/*
                        Name and distance only. The source is sixty characters
                        of registry department, and putting it here forced the
                        pinned column wide enough that the adjustment columns
                        it exists to hold no longer fit in a detail pane. It is
                        provenance for the transacted rate, so it lives on the
                        transacted rate.
                      */}
                      <th scope="row" className="sticky left-0 z-10 max-w-[11rem] bg-surface py-2 pr-3 text-left font-normal">
                        <span className="block truncate text-[12.5px] text-ink" title={comp.label}>
                          {comp.label}
                        </span>
                        <span className="block text-[10.5px] text-ink-muted">{comp.distanceKm.toFixed(1)} km away</span>
                      </th>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-secondary">
                        {Math.round(comp.areaSqm).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right text-ink-secondary">
                        <FormulaTip
                          label="Transacted"
                          derivation={{
                            formula: 'price ÷ area',
                            substituted: `${rate(comp.price, currency)} ÷ ${Math.round(comp.areaSqm).toLocaleString()} m²`,
                            result: `${rate(comp.pricePerSqm, currency)}/m²`,
                            note: `${comp.transactedAt} · ${age(comp.transactedAt)} · ${comp.propertyType.replace(/_/g, ' ')}. Source: ${comp.source}.`,
                          }}
                        >
                          <span className="font-mono tabular-nums">{rate(comp.pricePerSqm, currency)}</span>
                        </FormulaTip>
                      </td>
                      {columns.map((col) => {
                        const pct = pctOf(comp, col.key);
                        return (
                          <td
                            key={col.key}
                            className={cn(
                              'px-2 py-2 text-right font-mono tabular-nums',
                              pct === undefined ? 'text-ink-muted' : toneFor(pct),
                            )}
                          >
                            {/* An em-dash, not 0.0%. The engine did not
                                apply a nil adjustment here — it did not
                                apply one, because inside its tolerance the
                                difference is noise. Those are different
                                claims and 0.0% asserts the wrong one. */}
                            {pct === undefined ? '—' : signed(pct)}
                          </td>
                        );
                      })}
                      <td className={cn('px-2 py-2 text-right font-mono tabular-nums', net === null ? 'text-ink-muted' : toneFor(net))}>
                        {net === null ? '—' : signed(net)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <FormulaTip
                          label="Adjusted rate"
                          derivation={{
                            formula: 'transacted × Π(1 + each adjustment)',
                            substituted: `${rate(comp.pricePerSqm, currency)} × ${(comp.adjustments ?? [])
                              .map((a) => `(1${a.pct >= 0 ? '+' : '−'}${Math.abs(a.pct).toFixed(1)}%)`)
                              .join(' × ') || '1'}`,
                            result: `${rate(comp.adjustedPricePerSqm, currency)}/m²`,
                            steps: (comp.adjustments ?? []).map((a) => ({
                              label: a.label,
                              value: signed(a.pct),
                            })),
                            note:
                              (comp.adjustments ?? []).length === 0
                                ? 'No adjustment applied — every difference from the subject fell inside the engine’s tolerance.'
                                : 'Compounded, not summed. Rounded to the currency’s own step at the end, which is why the net differs slightly from adding the column.',
                          }}
                        >
                          <span className="font-mono font-medium tabular-nums text-ink">
                            {rate(comp.adjustedPricePerSqm, currency)}
                          </span>
                        </FormulaTip>
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <FormulaTip
                          label="Weight"
                          derivation={{
                            formula: 'similarity ÷ Σ similarity',
                            substituted: `${comp.similarity.toFixed(2)} ÷ ${totalWeight.toFixed(2)}`,
                            result: `${((weights[i] / totalWeight) * 100).toFixed(0)}%`,
                            note: 'Similarity to the subject, scored on property type, area, distance and recency. It is the only thing weighting this set — a nearer, more recent, more alike transaction counts for more.',
                          }}
                        >
                          <span className="font-mono tabular-nums text-ink-secondary">
                            {((weights[i] / totalWeight) * 100).toFixed(0)}%
                          </span>
                        </FormulaTip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-hairline">
                  <th scope="row" className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left text-[12px] font-medium text-ink">
                    Weighted mean
                    <span className="block font-normal text-[10.5px] text-ink-muted">
                      the rate the comparable approach uses
                    </span>
                  </th>
                  <td colSpan={2 + columns.length} className="px-2 py-2 text-right text-[11px] text-ink-muted">
                    range {rate(low, currency)} – {rate(high, currency)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-ink-muted">
                    {/* The spread of the set, which is what decides whether
                        the mean means anything. */}
                    {weightedMean > 0 ? `±${Math.round(((high - low) / 2 / weightedMean) * 100)}%` : '—'}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <FormulaTip
                      label="Weighted mean rate"
                      derivation={{
                        formula: 'Σ(adjusted rate × similarity) ÷ Σ similarity',
                        substituted: comparables
                          .map((c) => `${Math.round(c.adjustedPricePerSqm).toLocaleString()}×${c.similarity.toFixed(2)}`)
                          .join(' + '),
                        result: `${rate(weightedMean, currency)}/m²`,
                        note: (
                          <>
                            Divided by {totalWeight.toFixed(2)}. The approach&rsquo;s low and high are the least and
                            greatest adjusted rates in the set, not a confidence interval — a wide range here means
                            the comparables disagree, not that the mean is uncertain by that much.
                            {subjectAreaSqm
                              ? ` Against the subject's ${Math.round(subjectAreaSqm).toLocaleString()} m² this is ${rate(weightedMean * subjectAreaSqm, currency)}.`
                              : ''}
                          </>
                        ),
                      }}
                    >
                      <span className="font-mono text-[12.5px] font-semibold tabular-nums text-ink">
                        {rate(weightedMean, currency)}
                      </span>
                    </FormulaTip>
                  </td>
                  <td className="py-2 pl-2 text-right font-mono text-[11px] tabular-nums text-ink-muted">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Each percentage describes the subject against that comparable, so it is the comparable that moves. Signs
            are positive where the subject is worth more.
          </p>
        </div>

        {/* ---------------- narrow: the same rows, stacked ---------------- */}
        <ul className="space-y-3 [@container(min-width:40rem)]:hidden">
          {comparables.map((comp, i) => {
            const net = netPct(comp);
            return (
              <li key={comp.id} className="rounded-lg border border-hairline p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 text-[12.5px] font-medium text-ink">{comp.label}</span>
                  <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink">
                    {rate(comp.adjustedPricePerSqm, currency)}
                  </span>
                </div>
                <p className="text-[10.5px] text-ink-muted">
                  {Math.round(comp.areaSqm).toLocaleString()} m² · {comp.distanceKm.toFixed(1)} km ·{' '}
                  {age(comp.transactedAt)} · weight {((weights[i] / totalWeight) * 100).toFixed(0)}%
                </p>
                <dl className="mt-1.5 space-y-0.5 border-t border-hairline pt-1.5 text-[11.5px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-secondary">Transacted</dt>
                    <dd className="font-mono tabular-nums text-ink-secondary">{rate(comp.pricePerSqm, currency)}</dd>
                  </div>
                  {(comp.adjustments ?? []).map((a) => (
                    <div key={a.key} className="flex items-baseline justify-between gap-3">
                      <dt className="min-w-0 text-ink-secondary">{a.label}</dt>
                      <dd className={cn('shrink-0 font-mono tabular-nums', toneFor(a.pct))}>{signed(a.pct)}</dd>
                    </div>
                  ))}
                  {(comp.adjustments ?? []).length === 0 ? (
                    <div className="text-[11px] text-ink-muted">
                      No adjustment applied — every difference fell inside tolerance.
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-0.5">
                    <dt className="font-medium text-ink">Net</dt>
                    <dd className={cn('font-mono font-medium tabular-nums', net === null ? 'text-ink-muted' : toneFor(net))}>
                      {net === null ? '—' : signed(net)}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
          <li className="rounded-lg bg-sunken p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[12px] font-medium text-ink">Weighted mean</span>
              <span className="font-mono text-[12.5px] font-semibold tabular-nums text-ink">
                {rate(weightedMean, currency)}
              </span>
            </div>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-muted">
              Σ(adjusted × similarity) ÷ {totalWeight.toFixed(2)}. Set spans {rate(low, currency)} – {rate(high, currency)}.
            </p>
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}

export default ComparablesSchedule;
