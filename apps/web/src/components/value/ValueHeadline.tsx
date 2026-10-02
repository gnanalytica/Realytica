import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { VALUATION_SIGN_OFF_LABEL, type ValuationRun, type ValueSummary } from '@realytica/shared';
import { Button, Card, CardBody, Tooltip, cn } from '../ui/kit';
import { money, pct } from '../../lib/format';
import { useCountUp } from './useValueFill';

/** Where the figure on the page stands. */
export type ValueStatus =
  /** Values the file holds wait for a person; the figure counts them. */
  | 'provisional'
  /** Every input is recorded, and no valuation has been recorded on them. */
  | 'unrecorded'
  /** The figure is the latest recorded valuation. */
  | 'recorded'
  /** Nothing to show yet. */
  | 'none';

const SERIES = ['bg-series-1', 'bg-series-2', 'bg-series-3', 'bg-series-4'];

function full(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * The figure as a report states it: to the thousand rupees. A blend of
 * approaches lands on ₹65,99,99,569, and the last three digits are arithmetic,
 * not knowledge. The exact figure stays a hover away.
 */
function rounded(n: number): string {
  return full(Math.round(n / 1000) * 1000);
}

/**
 * The summary of values, the way a panel valuation opens: fair market value,
 * then what it realises and what it fetches in distress, then the guideline
 * value the duty is charged on, beside it.
 *
 * The figure counts across as the inputs fill, so the reader sees each
 * approach move it; below it, the blend says which approaches carry it and
 * which are still waiting on an input.
 */
export function ValueHeadline({
  summary,
  status,
  run,
  waiting,
  sources,
  busy,
  spreadBasis,
  onAcceptAll,
  onRecord,
}: {
  summary: ValueSummary;
  status: ValueStatus;
  run?: ValuationRun;
  /** How many values from the file wait for a person. */
  waiting: number;
  /** Where those values came from, in words: "3 documents and the revenue map". */
  sources: string;
  busy: boolean;
  spreadBasis: string;
  onAcceptAll: () => void;
  onRecord: () => void;
}) {
  const shown = useCountUp(summary.fairMarket);
  const usable = summary.approaches.filter((a) => a.share > 0);
  const waitingOn = [...new Set(summary.approaches.flatMap((a) => (a.amount === null ? a.missing : [])))];

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-micro font-medium uppercase tracking-[0.08em] text-ink-muted">Fair market value</p>
            {summary.fairMarket !== null && shown !== null ? (
              <>
                <p
                  className={cn(
                    'mt-1 font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums',
                    status === 'provisional' ? 'text-provenance-ink' : 'text-ink',
                  )}
                  title={`${full(summary.fairMarket)} before rounding`}
                >
                  {rounded(shown)}
                </p>
                <p className="mt-2 font-mono text-[13px] tabular-nums text-ink-secondary">
                  {money(summary.low, 'INR')} – {money(summary.high, 'INR')}
                  {summary.spread !== null ? (
                    <Tooltip label={spreadBasis}>
                      <span className="cursor-help text-ink-muted"> · ±{Math.round(summary.spread * 100)}%</span>
                    </Tooltip>
                  ) : null}
                  {summary.ratePerSqm !== null && summary.area ? (
                    <span className="text-ink-muted">
                      {' · '}₹{Math.round(summary.ratePerSqm).toLocaleString('en-IN')}/sqm on {Math.round(summary.area.sqm).toLocaleString('en-IN')} sqm
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-[17px] font-semibold leading-tight text-ink">
                  {summary.outcome === 'approaches_disagree'
                    ? 'No figure — the approaches disagree'
                    : waitingOn.length
                      ? `No figure yet — waiting on ${waitingOn.slice(0, 2).join(' and ').toLowerCase()}`
                      : 'No figure yet'}
                </p>
                <p className="mt-1 max-w-[60ch] text-[12px] leading-relaxed text-ink-secondary">
                  {summary.outcome === 'approaches_disagree'
                    ? spreadBasis
                    : 'Every approach multiplies a rate by an area. “Value this property” fills what the file holds; what it does not hold waits below for a person.'}
                </p>
              </>
            )}
          </div>
          <StatusChip status={status} run={run} waiting={waiting} />
        </div>

        {summary.restsOnGuidance ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] leading-relaxed text-ink ring-1 ring-inset ring-warning/30">
            <span className="font-medium">This is the guideline value, not yet a market value.</span>{' '}
            <span className="text-ink-secondary">
              The only rate on the file is the state’s guidance rate — the floor duty is charged on. Most sites transact above it; record comparables, or a recent sale of the parcel, for a market figure.
            </span>
          </p>
        ) : null}

        {summary.fairMarket !== null ? (
          <dl className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]">
            <Figure label="Realisable" value={money(summary.realisable, 'INR')} note="90% of fair market — a sale in the ordinary course" />
            <Figure label="Distress" value={money(summary.distress, 'INR')} note="75% — a forced sale, as panels state it" />
            {summary.guideline ? (
              <Figure
                label="Guideline value"
                value={money(summary.guideline.value, 'INR')}
                note={`${summary.guideline.published} on the plot`}
                aside={
                  summary.vsGuideline !== null && !summary.restsOnGuidance ? (
                    <span
                      className={cn('font-mono text-mini tabular-nums', summary.vsGuideline < 0 ? 'text-[var(--status-warning-text)]' : 'text-ink-muted')}
                      title="The fair market value against the guideline value"
                    >
                      {summary.vsGuideline < 0 ? '\u2212' : '+'}
                      {pct(Math.abs(summary.vsGuideline) * 100, 0)}
                    </span>
                  ) : null
                }
              />
            ) : (
              <Figure label="Guideline value" value="—" note="Read the revenue map on the Overview for the state’s guidance rate" muted />
            )}
          </dl>
        ) : null}

        {summary.approaches.length ? (
          <div className="space-y-1.5">
            {usable.length ? (
              <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={usable.map((a) => `${a.label} ${Math.round(a.share * 100)}%`).join(', ')}>
                {usable.map((a, i) => (
                  <span key={a.method} className={cn('h-full transition-[width] duration-slow ease-enter', SERIES[i % SERIES.length])} style={{ width: `${a.share * 100}%` }} />
                ))}
              </div>
            ) : null}
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-mini">
              {summary.approaches.map((a) => {
                const i = usable.findIndex((u) => u.method === a.method);
                return (
                  <li key={a.method} className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', i >= 0 ? SERIES[i % SERIES.length] : 'bg-sunken ring-1 ring-inset ring-[var(--ring)]')} aria-hidden />
                    <span className={i >= 0 ? 'text-ink' : 'text-ink-muted'}>{a.label}</span>
                    {i >= 0 ? (
                      <span className="font-mono tabular-nums text-ink-secondary">
                        {money(a.amount, 'INR')} · {Math.round(a.share * 100)}%
                      </span>
                    ) : (
                      <span className="text-ink-muted">needs {a.missing.slice(0, 2).join(', ').toLowerCase()}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {status === 'provisional' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-provenance/10 px-3 py-2 ring-1 ring-inset ring-provenance/30">
            <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
              <Sparkles size={13} className="shrink-0 text-provenance-ink" aria-hidden />
              <span>
                <span className="font-medium">
                  {waiting} value{waiting === 1 ? '' : 's'} from {sources}
                </span>{' '}
                <span className="text-ink-secondary">
                  {waiting === 1 ? 'waits' : 'wait'} for you. The figure counts {waiting === 1 ? 'it' : 'them'}; nothing is recorded until you accept.
                </span>
              </span>
            </p>
            <Button variant="primary" size="sm" onClick={onAcceptAll} loading={busy}>
              Accept all and record
            </Button>
          </div>
        ) : status === 'unrecorded' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
            <p className="text-[13px] text-ink-secondary">
              {run ? 'The inputs have changed since the valuation recorded on ' + new Date(run.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '.' : 'The inputs are recorded. Record the valuation to carry it into a report.'}
            </p>
            <Button size="sm" onClick={onRecord} loading={busy}>
              Record valuation
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function StatusChip({ status, run, waiting }: { status: ValueStatus; run?: ValuationRun; waiting: number }) {
  if (status === 'provisional') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-provenance/10 px-2 py-0.5 text-mini font-medium text-provenance-ink ring-1 ring-inset ring-provenance/30">
        <Sparkles size={11} aria-hidden />
        Provisional · {waiting} to accept
      </span>
    );
  }
  if (status === 'recorded' && run) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-mini font-medium text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
        Recorded {new Date(run.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {VALUATION_SIGN_OFF_LABEL[run.signOff]}
      </span>
    );
  }
  if (status === 'unrecorded') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-warning/10 px-2 py-0.5 text-mini font-medium text-[var(--status-warning-text)] ring-1 ring-inset ring-warning/30">
        Not recorded
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-sunken px-2 py-0.5 text-mini font-medium text-ink-muted ring-1 ring-inset ring-[var(--ring)]" title="Not a certified value unless a registered valuer signs a professional report.">
      Indicative
    </span>
  );
}

function Figure({ label, value, note, aside, muted }: { label: string; value: string; note: string; aside?: ReactNode; muted?: boolean }) {
  return (
    <div className="rounded-lg bg-sunken/60 px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
      <dt className="flex items-baseline justify-between gap-2 text-mini text-ink-muted">
        <span>{label}</span>
        {aside}
      </dt>
      <dd className={cn('mt-0.5 font-mono text-[15px] font-semibold tabular-nums', muted ? 'text-ink-muted' : 'text-ink')}>{value}</dd>
      <dd className="text-micro leading-snug text-ink-muted">{note}</dd>
    </div>
  );
}
