import { ChevronDown, Info } from 'lucide-react';
import { date as fmtDate } from '../lib/format';
import { Tooltip } from './ui/kit';

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
  if (compact) {
    // The source goes in the tooltip too — the line truncates it, and a
    // source you cannot read is not provenance.
    return (
      <Tooltip label={`${source} — ${verifyNote}`}>
        <span
          tabIndex={0}
          className="inline-flex min-w-0 cursor-help items-center gap-1 text-[11px] text-ink-muted"
        >
          <Info size={11} className="shrink-0" aria-hidden="true" />
          <span className="truncate">
            As of {fmtDate(asOf)} · {source}
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
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-ink-muted">
        <Info size={12} className="shrink-0" aria-hidden="true" />
        {/*
          * Truncated closed, whole open. The source is often longer than the
          * line — "Revised Master Plan 2015 … ground coverage, setbacks and
          * parking provision" — and expanding used to reveal only the caveat,
          * so the citation itself was unreadable in either state.
          */}
        <span className="truncate group-open:overflow-visible group-open:whitespace-normal">
          As of {fmtDate(asOf)} · {source}
        </span>
        <ChevronDown size={11} className="no-print shrink-0 self-start transition-transform duration-base group-open:rotate-180" />
      </summary>
      <p className="mt-1.5 border-l-2 border-[var(--ring)] pl-2.5 text-[11.5px] leading-relaxed text-ink-muted">
        {verifyNote}
      </p>
    </details>
  );
}
