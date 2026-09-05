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
import { Badge, InfoTip, cn, Why } from './ui/kit';

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
  check_field: 'text-[var(--status-good-text)]',
  project: 'text-ink-muted',
  locality: 'text-[var(--status-warning-text)]',
  derived: 'text-ink-muted',
  assumption: 'text-[var(--status-warning-text)]',
};

/**
 * Does the provenance line already carry what this note says?
 *
 * Compared on words rather than characters so punctuation and casing do not
 * hide a repeat. Only a note whose every substantive word is already in the
 * line above counts as said — a note that adds one real clause survives whole,
 * because trimming it to the new clause would be this component rewriting a
 * sentence the engine wrote.
 */
function sourceSays(input: ValuationInput, note: string): boolean {
  const words = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const line = words(`${sourceLine(input)} ${INPUT_SOURCE_STRENGTH[input.source.kind]}`);
  const said = [...words(note)];
  return said.length > 0 && said.every((w) => line.has(w));
}

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
      <ApproachComparison working={working} currency={currency} />

      {working.runs.map((run) => (
        <ApproachCard key={run.method} run={run} currency={currency} onOpenCheck={onOpenCheck} />
      ))}

      {working.externalities.applied.length ? (
        <section className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          {/*
            Why these come after the blend is a method point, not a reading of
            this site. It belongs where somebody wonders about it rather than
            above the adjustments every time they are shown.
          */}
          <h4 className="flex items-center gap-1 text-[12px] font-semibold text-ink">
            What the site is next to
            <InfoTip label="Applied after the blend, so the unadjusted indication stays visible and this can be argued with on its own terms." />
          </h4>
          <ul className="mt-2 space-y-2">
            {working.externalities.applied.map((a) => (
              <li key={a.key} className="text-[12px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink">
                    {a.label} <span className="text-ink-muted">at {a.metres} m</span>
                  </span>
                  <span className="shrink-0 font-mono text-[var(--status-warning-text)]">{(a.pct * 100).toFixed(0)}%</span>
                </div>
                <p className="text-ink-secondary">{a.say}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  From {a.from}. <span title={a.basis}>Rate basis: {a.basis.slice(0, 110)}…</span>
                </p>
              </li>
            ))}
          </ul>
          <p className={cn('mt-2 text-[11.5px]', working.externalities.capped ? 'text-critical' : 'text-ink-muted')}>
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

/**
 * The four approaches on one set of aligned figures, above their working.
 *
 * The cards below answer "how was this one arrived at". They cannot answer
 * "which of these disagree and by how much", because that question is about
 * four numbers at once and the cards put a screen and a half of provenance
 * between each pair of them. A reader comparing approaches was scrolling and
 * remembering — which is exactly the comparison the reconciliation turns on.
 *
 * A bar rather than only figures because the figures are eleven digits with
 * Indian grouping, and "₹3,56,12,00,000 against ₹2,91,40,00,000" is a
 * character-by-character diff. Length is read at a glance. It is scaled to the
 * largest approach, not to zero-based currency — every bar here shares one
 * subject, so the useful comparison is between them.
 *
 * An approach that could not run keeps its row and states what was missing.
 * Dropping it would make the blend look like it considered three things when
 * it considered four and rejected one.
 */
function ApproachComparison({ working, currency }: { working: ValuationWorking; currency: string }) {
  const runs = working.runs;
  const amounts = runs.map((r) => (approachIsUsable(r) ? (r.amount ?? 0) : 0));
  const peak = Math.max(...amounts, 0);
  const blended = working.reconciliation.indicated;

  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-hairline px-3 py-2 [@container(min-width:34rem)]:grid-cols-[minmax(0,1fr)_5rem_4rem_auto]">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-muted">Approach</span>
        <span className="hidden text-right text-[10.5px] uppercase tracking-wider text-ink-muted [@container(min-width:34rem)]:block">
          Weight
        </span>
        <span className="hidden [@container(min-width:34rem)]:block" aria-hidden="true" />
        <span className="text-right text-[10.5px] uppercase tracking-wider text-ink-muted">Amount</span>
      </div>

      <ul className="divide-y divide-hairline">
        {runs.map((run) => {
          const usable = approachIsUsable(run);
          const amount = run.amount ?? 0;
          /* Never zero-width for a real figure — a bar you cannot see reads as
             a missing value, which is the one thing it is not. */
          const frac = usable && peak > 0 ? Math.max(0.02, amount / peak) : 0;
          return (
            <li
              key={run.method}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2 [@container(min-width:34rem)]:grid-cols-[minmax(0,1fr)_5rem_4rem_auto]"
            >
              <span className="min-w-0 text-[12.5px] text-ink">
                {VALUATION_METHOD_LABEL[run.method]}
                {usable ? null : (
                  <span className="block text-[11px] text-ink-muted">
                    Not run — {run.missing.join(', ')}
                  </span>
                )}
              </span>

              <span className="hidden text-right font-mono text-[11.5px] tabular-nums text-ink-secondary [@container(min-width:34rem)]:block">
                {usable ? `${(run.weight * 100).toFixed(0)}%` : '—'}
              </span>

              {/* One subject, one series, so one hue and no legend. */}
              <span className="hidden h-1.5 items-center [@container(min-width:34rem)]:flex" aria-hidden="true">
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${frac * 100}%`, background: 'var(--series-1)' }}
                  />
                </span>
              </span>

              <span
                className={cn(
                  'text-right font-mono text-[12.5px] tabular-nums',
                  usable ? 'text-ink' : 'text-ink-muted',
                )}
              >
                {usable ? money(amount, currency) : 'no figure'}
              </span>
            </li>
          );
        })}
      </ul>

      {blended !== null ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-hairline bg-sunken/40 px-3 py-2 [@container(min-width:34rem)]:grid-cols-[minmax(0,1fr)_5rem_4rem_auto]">
          {/* The basis is a sentence and this is a figures row. It reads on
              request; the report prints it. */}
          <span className="min-w-0 text-[12.5px] font-medium text-ink">
            Blended
            <Why label="Basis">{working.reconciliation.spreadBasis}</Why>
          </span>
          <span className="hidden [@container(min-width:34rem)]:block" aria-hidden="true" />
          <span className="hidden [@container(min-width:34rem)]:block" aria-hidden="true" />
          <span className="text-right font-mono text-[12.5px] font-semibold tabular-nums text-ink">
            {money(blended, currency)}
          </span>
        </div>
      ) : null}
    </section>
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

      {/*
        The missing inputs are named three times on this screen: the approaches
        table above says "Not run — Effective age, Expected total life", this
        sentence said it again, and the input list directly below marks each
        one "not recorded" in place, with its source. Two of those are the
        list; the third is where somebody actually looks for a value. What only
        this sentence knows is where to go and what happens next, so that is
        all it says now.
      */}
      {!usable ? (
        <p className="mt-2 text-[12px] text-[var(--status-warning-text)]">
          Record the missing inputs on the Indicative valuation scope, then run again.
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
                  <span className={cn('shrink-0 font-mono', input.value === null ? 'text-[var(--status-warning-text)]' : 'text-ink')}>
                    {input.value === null ? 'not recorded' : `${input.value.toLocaleString('en-IN')}${input.unit ? ` ${input.unit}` : ''}`}
                  </span>
                </div>
                <p className={cn('text-[10.5px]', SOURCE_TONE[input.source.kind])}>
                  {sourceLine(input)} — {INPUT_SOURCE_STRENGTH[input.source.kind]}
                  {input.evidenceId ? ' · evidenced' : ''}
                </p>
                {/*
                  The note says WHY a fallback stood in. The line above says
                  WHAT stood in, and where it came from. They drifted into
                  saying both: "a locality median — a market observation, not
                  inspected for this asset" was followed by a note ending "It
                  was not inspected for this asset", the same clause twice,
                  four lines apart, in a panel whose whole job is to be
                  checkable. A note wholly contained in the line above it is
                  dropped rather than trusted to stay distinct.
                */}
                {input.note && !sourceSays(input, input.note) ? (
                  <p className="text-[10.5px] text-ink-muted">{input.note}</p>
                ) : null}
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
          Weight {(run.weight * 100).toFixed(0)}%
          <Why label="Why this weight">{run.weightBasis}</Why>
        </p>
      ) : null}
    </section>
  );
}
