import { AlertTriangle, ChevronDown, Info } from 'lucide-react';
import { statutoryAge } from '@realytica/shared';
import { date as fmtDate } from '../lib/format';
import { Tooltip, cn } from './ui/kit';

/**
 * How old this figure is, said in the units a reader thinks in.
 *
 * "As of 1 January 2023" is the same sentence on the day it is written and
 * four years later, and a reader cannot do that subtraction while scanning a
 * cost breakdown. The staleness engine has always known the answer — it just
 * had no way to reach the line beside the number.
 */
function agePhrase(days: number): string {
  if (days < 45) return `${days} days old`;
  if (days < 365) return `${Math.round(days / 30)} months old`;
  const years = days / 365;
  return years < 2 ? 'over a year old' : `over ${Math.floor(years)} years old`;
}

/**
 * The trust primitive for every statutory figure surfaced by a State Pack.
 *
 * Karnataka's guidance values, stamp-duty slabs and buffer distances change by
 * circular, notification and court order — a number here is only as good as
 * the source it was last confirmed against. This renders that provenance as a
 * small, always-visible line rather than a warning: it should read as a
 * standing caveat that belongs beside the number, not as something wrong with
 * the screen. Use it beside every statutory number in the UI — a compliance
 * score, a buffer distance, a stamp-duty figure.
 */
export function StatutoryProvenance({
  asOf,
  source,
  verifyNote,
  compact,
}: {
  asOf: string;
  source: string;
  verifyNote: string;
  compact?: boolean;
}) {
  const { ageDays, severity } = statutoryAge(asOf);
  const stale = severity !== null;
  const age = agePhrase(ageDays);

  if (compact) {
    // The source goes in the tooltip too — the line truncates it, and a
    // source you cannot read is not provenance.
    return (
      <Tooltip label={`${age}. ${source} — ${verifyNote}`}>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex min-w-0 cursor-help items-center gap-1 text-mini',
            stale ? 'text-[var(--status-warning-text)]' : 'text-ink-muted',
          )}
        >
          {stale ? (
            <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />
          ) : (
            <Info size={11} className="shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            As of {fmtDate(asOf)} · {age}
          </span>
        </span>
      </Tooltip>
    );
  }

  /*
   * The date and the source always; the caveat on request.
   *
   * `verifyNote` is where this component's honesty lives — it is the sentence
   * that says a figure is a norm and not a measurement — and it is also 500+
   * characters rendered on every card that shows a statutory number. Printed
   * inline it was the single longest block in the product and appeared a
   * dozen times a case, which taught readers to skip the whole line including
   * the date.
   *
   * Folded, the provenance stays scannable and the caveat stays one click
   * away. Print sees it whole: the `print-open` class is what the report
   * stylesheet forces open, so a document sent to a lender carries the
   * caveat in full.
   */
  return (
    <details className="print-open group">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 text-mini',
          stale ? 'text-[var(--status-warning-text)]' : 'text-ink-muted',
        )}
      >
        {stale ? (
          <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
        ) : (
          <Info size={12} className="shrink-0" aria-hidden="true" />
        )}
        {/*
          * Truncated closed, whole open. The source is often longer than the
          * line — "Revised Master Plan 2015 … ground coverage, setbacks and
          * parking provision" — and expanding used to reveal only the caveat,
          * so the citation itself was unreadable in either state.
          */}
        <span className="truncate group-open:overflow-visible group-open:whitespace-normal">
          As of {fmtDate(asOf)} · <span className="font-medium">{age}</span> · {source}
        </span>
        <ChevronDown size={11} className="no-print shrink-0 self-start transition-transform duration-base group-open:rotate-180" />
      </summary>
      <p className="mt-1.5 border-l-2 border-[var(--ring)] pl-2.5 text-mini leading-relaxed text-ink-muted">
        {/*
          Stated before the caveat, not after it. The standing verify note is
          the same words on every figure and readers learn to skip it; the one
          sentence that differs between a current figure and a superseded one
          is how long it has been since anybody checked.
        */}
        {stale ? (
          <span className="mb-1 block font-medium text-[var(--status-warning-text)]">
            This figure is {age} and past the point where it should be reconfirmed
            {severity === 'serious' ? ' — treat it as indicative only until it is' : ''}.
          </span>
        ) : null}
        {verifyNote}
      </p>
    </details>
  );
}
