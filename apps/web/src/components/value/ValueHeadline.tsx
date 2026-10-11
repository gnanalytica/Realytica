import type { ReactNode } from 'react';
import {
  VALUATION_SIGN_OFF_LABEL,
  type ValuationMethodKey,
  type ValuationPremise,
  type ValuationRun,
  type ValuationSignOff,
  type ValueSummary,
} from '@realytica/shared';
import { Button, Card, CardBody, Select, Tooltip, cn } from '../ui/kit';
import { money, pct } from '../../lib/format';
import { useCountUp } from './useValueFill';

const PREMISE_LABEL: Record<ValuationPremise, string> = {
  as_is: 'As-is market value',
  as_completed: 'As-completed value',
  residual: 'Residual land value (site)',
  forced_sale: 'Forced sale',
};

/** The four approaches shown on the blend — always, with what each means. */
const APPROACH_CHIPS: ReadonlyArray<{
  label: string;
  methods: readonly ValuationMethodKey[];
  meaning: string;
}> = [
  {
    label: 'Comparables',
    methods: ['comparable_rate', 'land_rate'],
    meaning: 'What similar properties sold for, applied to this area.',
  },
  {
    label: 'Cost',
    methods: ['depreciated_replacement_cost'],
    meaning: 'Land plus cost to rebuild, less depreciation for age.',
  },
  {
    label: 'Income',
    methods: ['investment_income'],
    meaning: 'Rent capitalised at a yield — what an investor would pay for the income.',
  },
  {
    label: 'Residual',
    methods: ['residual_land'],
    meaning: 'Completed development value minus build cost and profit — what the land is worth to a developer.',
  },
];

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
  premise,
  busy,
  spreadBasis,
  onRecord,
  onSignOff,
}: {
  summary: ValueSummary;
  status: ValueStatus;
  run?: ValuationRun;
  /** Basis of value shown above the figure. */
  premise: ValuationPremise;
  busy: boolean;
  spreadBasis: string;
  onRecord: () => void;
  onSignOff?: (signOff: ValuationSignOff) => void;
}) {
  const shown = useCountUp(summary.fairMarket);
  const usable = summary.approaches.filter((a) => a.share > 0);
  const waitingOn = [...new Set(summary.approaches.flatMap((a) => (a.amount === null ? a.missing : [])))];

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            {summary.fairMarket !== null && shown !== null ? (
              <>
                <p
                  className={cn(
                    'font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums',
                    status === 'provisional' ? 'text-provenance-ink' : 'text-ink',
                  )}
                  title={`${PREMISE_LABEL[premise]} · ${full(summary.fairMarket)} before rounding`}
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
                {summary.outcome === 'approaches_disagree' && spreadBasis ? (
                  <p className="mt-1 max-w-[52ch] text-[12px] text-ink-secondary" title={spreadBasis}>
                    {spreadBasis.length > 120 ? `${spreadBasis.slice(0, 117)}…` : spreadBasis}
                  </p>
                ) : null}
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusChip status={status} run={run} />
            {run && onSignOff ? (
              <Select
                aria-label="Sign-off"
                value={run.signOff}
                onChange={(e) => onSignOff(e.target.value as ValuationSignOff)}
                className="h-8 w-auto max-w-[14rem] text-[12px]"
              >
                {(Object.keys(VALUATION_SIGN_OFF_LABEL) as ValuationSignOff[]).map((k) => (
                  <option key={k} value={k}>
                    {VALUATION_SIGN_OFF_LABEL[k]}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        </div>

        {summary.restsOnGuidance ? (
          <p className="rounded-lg bg-warning/10 px-3 py-1.5 text-[12px] font-medium text-[var(--status-warning-text)] ring-1 ring-inset ring-warning/30">
            Guideline only — add comparables for a market figure
          </p>
        ) : null}

        {summary.fairMarket !== null ? (
          <dl className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))]">
            <Figure label="Realisable" value={money(summary.realisable, 'INR')} note="90% of FMV" />
            <Figure label="Distress" value={money(summary.distress, 'INR')} note="75% forced sale" />
            {summary.guideline ? (
              <Figure
                label="Guideline"
                value={money(summary.guideline.value, 'INR')}
                note={summary.guideline.published}
                aside={
                  summary.vsGuideline !== null && !summary.restsOnGuidance ? (
                    <span
                      className={cn('font-mono text-mini tabular-nums', summary.vsGuideline < 0 ? 'text-[var(--status-warning-text)]' : 'text-ink-muted')}
                      title="Fair market vs guideline"
                    >
                      {summary.vsGuideline < 0 ? '\u2212' : '+'}
                      {pct(Math.abs(summary.vsGuideline) * 100, 0)}
                    </span>
                  ) : null
                }
              />
            ) : (
              <Figure label="Guideline" value="—" note="No map rate" muted />
            )}
          </dl>
        ) : null}

        {summary.approaches.length || usable.length ? (
          <div className="space-y-1.5">
            {usable.length ? (
              <div
                className="flex h-2 overflow-hidden rounded-full bg-sunken"
                role="img"
                aria-label={usable.map((a) => `${approachChipLabel(a.method)} ${Math.round(a.share * 100)}%`).join(', ')}
              >
                {usable.map((a, i) => (
                  <span
                    key={a.method}
                    className={cn('h-full transition-[width] duration-slow ease-enter', SERIES[i % SERIES.length])}
                    style={{ width: `${a.share * 100}%` }}
                    title={`${approachChipLabel(a.method)}: ${money(a.amount, 'INR')}`}
                  />
                ))}
              </div>
            ) : null}
            <ul className="flex flex-wrap items-center gap-1.5">
              {APPROACH_CHIPS.map((chip) => {
                const match = summary.approaches.find((a) => chip.methods.includes(a.method));
                const running = match && match.share > 0 && match.amount !== null;
                const color = running ? usable.findIndex((u) => u.method === match.method) : -1;
                const tip = running
                  ? `${chip.meaning} ${money(match.amount, 'INR')} · ${Math.round(match.share * 100)}% of the blend.`
                  : match?.missing.length
                    ? `${chip.meaning} Not run — needs ${match.missing.slice(0, 2).join(', ').toLowerCase()}.`
                    : `${chip.meaning} Not run yet.`;
                return (
                  <li key={chip.label}>
                    <Tooltip label={tip}>
                      <span
                        className={cn(
                          'inline-flex cursor-help items-center gap-1 rounded-md px-1.5 py-0.5 text-mini ring-1 ring-inset',
                          running ? 'bg-sunken text-ink ring-[var(--ring)]' : 'bg-transparent text-ink-muted ring-[var(--ring)]',
                        )}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            color >= 0 ? SERIES[color % SERIES.length] : 'bg-sunken ring-1 ring-inset ring-[var(--ring)]',
                          )}
                          aria-hidden
                        />
                        <span className={cn('font-medium', running ? 'text-ink' : 'text-ink-muted')}>{chip.label}</span>
                        {running ? (
                          <span className="font-mono tabular-nums text-ink-secondary">{Math.round(match.share * 100)}%</span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </span>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {status === 'unrecorded' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" onClick={onRecord} loading={busy}>
              Record valuation
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function StatusChip({ status, run }: { status: ValueStatus; run?: ValuationRun }) {
  if (status === 'provisional') return null;
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

function approachChipLabel(method: ValuationMethodKey): string {
  return APPROACH_CHIPS.find((c) => c.methods.includes(method))?.label ?? method;
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
