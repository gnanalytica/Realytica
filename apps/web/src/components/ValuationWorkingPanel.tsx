/**
 * The working, shown.
 *
 * A valuation people act on has to be arguable, and arguing with a number
 * means seeing three things: what went in, where each of those came from, and
 * the arithmetic between them. The panel this replaces showed an approach
 * label, a prose sentence and an amount — enough to read, not enough to
 * disagree with.
 *
 * Two decisions carry most of the design:
 *
 * **Provenance is per input, not per approach.** The area came off an approved
 * drawing through a check that required proof; the rate came off a locality
 * table nobody inspected. Rendering one "source" line for the approach would
 * average those into a statement that is true of neither. So each input wears
 * its own, and a borrowed rate is visibly weaker than an evidenced area on the
 * same row of the same calculation.
 *
 * **An approach that could not run is shown, not hidden.** "Why is there no
 * income approach here" is a question a reader will ask, and the answer — no
 * cap rate recorded — is more useful than the silence. Its working is empty
 * because half a calculation invites the assumption that the other half was
 * fine.
 */

import {
  INPUT_SOURCE_STRENGTH,
  VALUATION_METHOD_LABEL,
  approachIsUsable,
  type ValuationApproachRun,
  type ValuationInput,
  type ValuationWorking,
} from '@realytica/shared';
import { Badge, cn } from './ui/kit';

function money(n: number, currency: string) {
  if (currency === 'INR') return `₹${Math.round(n).toLocaleString('en-IN')}`;
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

/** Where an input came from, in the words a reader needs. */
function sourceLine(input: ValuationInput): string {
  const s = input.source;
  switch (s.kind) {
    case 'check_field':
      return s.checkTitle ? `${s.checkTitle} · ${s.fieldKey}` : s.fieldKey;
    case 'project':
      return `Project record · ${s.field}`;
    case 'locality':
      return `${s.localityLabel} · ${s.field}`;
    case 'derived':
      return `Worked out from ${s.from}`;
    case 'assumption':
      return `Assumed by ${s.statedBy}`;
  }
}

/* A borrowed rate and an evidenced area must not look alike. */
const SOURCE_TONE: Record<ValuationInput['source']['kind'], string> = {
  check_field: 'text-status-good-text',
  project: 'text-ink-muted',
  locality: 'text-status-warning',
  derived: 'text-ink-muted',
  assumption: 'text-status-warning',
};

export function ValuationWorkingPanel({
  working,
  currency,
  onOpenCheck,
}: {
  working: ValuationWorking;
  currency: string;
  onOpenCheck?: (checkId: string) => void;
}) {
  return (
    <div className="space-y-4">
      {working.runs.map((run) => (
        <ApproachCard key={run.method} run={run} currency={currency} onOpenCheck={onOpenCheck} />
      ))}

      {working.externalities.applied.length ? (
        <section className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-3">
          <h4 className="text-[12px] font-semibold text-ink">What the site is next to</h4>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Applied after the blend, so the unadjusted indication stays visible and this can be argued with on its own terms.
          </p>
          <ul className="mt-2 space-y-2">
            {working.externalities.applied.map((a) => (
              <li key={a.key} className="text-[12px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink">
                    {a.label} <span className="text-ink-muted">at {a.metres} m</span>
                  </span>
                  <span className="shrink-0 font-mono text-status-warning">{(a.pct * 100).toFixed(0)}%</span>
                </div>
                <p className="text-ink-secondary">{a.say}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  From {a.from}. <span title={a.basis}>Rate basis: {a.basis.slice(0, 110)}…</span>
                </p>
              </li>
            ))}
          </ul>
          <p className={cn('mt-2 text-[11.5px]', working.externalities.capped ? 'text-status-critical' : 'text-ink-muted')}>
            {working.externalities.say}
          </p>
          {working.unadjusted.indicated !== null ? (
            <p className="mt-2 font-mono text-[12px] text-ink">
              {money(working.unadjusted.indicated, currency)} → {money(working.reconciliation.indicated ?? 0, currency)}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="text-[11.5px] text-ink-muted">{working.externalities.say}</p>
      )}
    </div>
  );
}

function ApproachCard({
  run,
  currency,
  onOpenCheck,
}: {
  run: ValuationApproachRun;
  currency: string;
  onOpenCheck?: (checkId: string) => void;
}) {
  const usable = approachIsUsable(run);
  return (
    <section className={cn('rounded-lg border p-3', usable ? 'border-hairline' : 'border-dashed border-hairline bg-sunken/40')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-ink">{VALUATION_METHOD_LABEL[run.method]}</h4>
        {usable ? (
          <span className="font-mono text-[13px] text-ink">{money(run.amount!, currency)}</span>
        ) : (
          <Badge tone="warning">not run</Badge>
        )}
      </div>

      <p className="mt-0.5 font-mono text-[11.5px] text-ink-muted">{run.formula}</p>

      {!usable ? (
        <p className="mt-2 text-[12px] text-status-warning">
          Missing {run.missing.join(', ')}. Record {run.missing.length === 1 ? 'it' : 'them'} on the Indicative valuation scope and run again.
        </p>
      ) : null}

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10.5px] uppercase tracking-wider text-ink-muted">Inputs</p>
          <ul className="mt-1 space-y-1">
            {run.inputs.map((input) => (
              <li key={input.key} className="text-[12px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-secondary">{input.label}</span>
                  <span className={cn('shrink-0 font-mono', input.value === null ? 'text-status-warning' : 'text-ink')}>
                    {input.value === null ? 'not recorded' : `${input.value.toLocaleString('en-IN')}${input.unit ? ` ${input.unit}` : ''}`}
                  </span>
                </div>
                <p className={cn('text-[10.5px]', SOURCE_TONE[input.source.kind])}>
                  {sourceLine(input)} — {INPUT_SOURCE_STRENGTH[input.source.kind]}
                  {input.evidenceId ? ' · evidenced' : ''}
                </p>
                {input.note ? <p className="text-[10.5px] text-ink-muted">{input.note}</p> : null}
                {onOpenCheck && input.source.kind === 'check_field' && input.source.checkId ? (
                  <button type="button" className="text-[10.5px] text-brand underline" onClick={() => onOpenCheck(input.source.kind === 'check_field' ? input.source.checkId : '')}>
                    open the check
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {run.steps.length ? (
          <div>
            <p className="text-[10.5px] uppercase tracking-wider text-ink-muted">Working</p>
            <ul className="mt-1 space-y-1">
              {run.steps.map((step, i) => (
                <li key={i} className="text-[12px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-secondary">{step.label}</span>
                    <span className="shrink-0 font-mono text-ink">{Math.round(step.value).toLocaleString('en-IN')}</span>
                  </div>
                  <p className="font-mono text-[10.5px] text-ink-muted">{step.expression}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {usable ? (
        <p className="mt-2 text-[11.5px] text-ink-muted">
          Weight {(run.weight * 100).toFixed(0)}% — {run.weightBasis}
        </p>
      ) : null}
    </section>
  );
}
