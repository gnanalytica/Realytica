import { Info } from 'lucide-react';
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
    return (
      <Tooltip label={verifyNote}>
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

  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted">
      <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        As of {fmtDate(asOf)} · {source}. {verifyNote}
      </span>
    </p>
  );
}
