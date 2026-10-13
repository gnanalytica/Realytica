/**
 * What a function needs of a person, as one line above its desk.
 *
 * A function with a desk of its own (the Cost Report, the progress board,
 * the tenders, the approvals register) opens on that desk, and the desk is
 * what the first screen is for. What its sheets need is said above it in one
 * line, how many and of which kinds, which unfolds to the five most pressing
 * and leads to the sheets where each is worked. It never pushes the desk
 * down the page.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, ListChecks } from 'lucide-react';
import { NEED_LABEL, readFunctionFields, type DdProject } from '@realytica/shared';
import { cn } from '../ui/kit';
import { needChips, needLines, needWhere } from './needs';

/** The colour each kind of line is named in, as on the sheets' own card. */
const TONE: Record<string, string> = {
  decide: 'text-ai-ink',
  accept: 'text-ai-ink',
  failing: 'text-critical',
  due_soon: 'text-[var(--status-warning-text)]',
  missing: 'text-ink-muted',
};

export function NeedsBrief({ project, fn, onOpenSheets }: { project: DdProject; fn: string; onOpenSheets: () => void }) {
  const page = useMemo(() => readFunctionFields(project, fn, new Date()), [project, fn]);
  const [open, setOpen] = useState(false);
  const lines = needLines(page.needs);
  if (!lines.length) return null;
  const more = page.counts.total - lines.length;
  // How many of each kind, the most pressing first: "2 to accept, 1 failing, 30 missing".
  const kinds = needChips(page.needs)
    .map(({ kind, count }) => `${count} ${kind === 'accept' ? 'to accept' : kind === 'decide' ? 'to decide' : NEED_LABEL[kind].toLowerCase()}`)
    .join(', ');
  return (
    <section data-needs-brief className="rounded-xl bg-surface ring-1 ring-inset ring-[var(--ring)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((held) => !held)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-ink coarse:min-h-11">
          <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-90')} aria-hidden />
          <ListChecks size={15} className="shrink-0 text-ink-secondary" aria-hidden />
          <span className="font-semibold">Needs you</span>
          <span className="min-w-0 truncate text-ink-secondary">
            {page.counts.total} on this function’s sheets: {kinds}
          </span>
        </button>
        <button type="button" onClick={onOpenSheets} className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
          Open the sheets
        </button>
      </div>
      {open ? (
        <ul className="divide-y divide-hairline border-t border-hairline px-3" aria-label="What needs you">
          {lines.map((line) => {
            const where = needWhere(line);
            // What the line says of itself, as on the sheets' own card: a rule's sentence, a standing's words. A value waiting is read on the sheet.
            const valued = line.kind === 'proposed' || line.kind === 'disputed';
            const under = [where, valued || line.text === where || line.text === line.label ? '' : line.text].filter(Boolean).join(' · ');
            return (
              <li key={line.key} className="py-1.5 text-[13px] text-ink">
                <span className={cn('mr-2 text-[11px] font-semibold uppercase tracking-[0.06em]', TONE[line.need])}>{NEED_LABEL[line.need]}</span>
                {line.label}
                {under ? <span className="text-ink-muted"> · {under}</span> : null}
              </li>
            );
          })}
          {more > 0 ? <li className="py-1.5 text-[12px] text-ink-muted">And {more} more, on the sheets.</li> : null}
        </ul>
      ) : null}
    </section>
  );
}
