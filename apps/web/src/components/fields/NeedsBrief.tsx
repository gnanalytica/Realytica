/**
 * What a function needs of a person, as five lines above its desk.
 *
 * A function with a desk of its own (the Cost Report, the progress board,
 * the tenders, the approvals register) opens on that desk. What its sheets
 * need is said above it in at most five lines, the most pressing first, with
 * one press to the sheets where each is worked. No chips, no counts of what
 * is failing or missing: those are the sheets' own, one press away.
 */

import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { NEED_LABEL, readFunctionFields, type DdProject } from '@realytica/shared';
import { Card, CardBody, CardHeader, cn } from '../ui/kit';
import { NEEDS_SHOWN, needLines, needWhere } from './needs';

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
  const lines = needLines(page.needs);
  if (!lines.length) return null;
  const more = page.counts.total - lines.length;
  return (
    <Card data-needs-brief>
      <CardHeader
        icon={<ListChecks size={15} />}
        title="Needs you"
        subtitle={more > 0 ? `The first ${NEEDS_SHOWN} of ${page.counts.total}` : undefined}
        action={
          <button type="button" onClick={onOpenSheets} className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
            {more > 0 ? `All ${page.counts.total} on the sheets` : 'Open the sheets'}
          </button>
        }
      />
      <CardBody className="pt-0">
        <ul className="divide-y divide-hairline" aria-label="What needs you">
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
        </ul>
      </CardBody>
    </Card>
  );
}
