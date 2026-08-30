import { ListChecks } from 'lucide-react';
import type { PropertyCase } from '@realytica/shared';
import { PlaybookPanel } from '../../../components/PlaybookPanel';
import { EmptyState } from '../../../components/ui/kit';

/**
 * The statutory procedures, traced against this case.
 *
 * These are not runs you start — `runPlaybooks` evaluates them with the
 * screen, deterministically, and their gates are enforced there: a step whose
 * prerequisite is unmet is reported `blocked` and its evaluator is never
 * called, so a procedure cannot produce a guess about a stage it has not
 * reached. What was missing was somewhere to READ them. Three Karnataka
 * procedures — the title chain, khata and area reconciliation, land use —
 * were computed on every screen and rendered at the bottom of one Compliance
 * sub-view, four clicks from the front door.
 *
 * They belong at the top level for the same reason a checklist does: "where
 * am I in the procedure, and what is holding it up" is a different question
 * from "what is wrong with this property", and it is the one a practitioner
 * asks on a Monday morning.
 */
export function ProceduresPane({ caseData }: { caseData: PropertyCase }) {
  const runs = caseData.result?.playbooks ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-hairline bg-surface-2 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Procedures</h2>
        <p className="mt-0.5 text-mini text-ink-muted">
          The sequence a practitioner follows here, with each step&rsquo;s gate enforced rather than assumed.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {runs.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={20} />}
            title={caseData.result ? 'No procedure applies to this property' : 'This case has not been screened yet'}
            description={
              caseData.result
                ? 'Procedures are state- and property-specific; the ones on file are Karnataka title chain, khata and area reconciliation, and land use.'
                : 'The procedures are traced as part of the screen.'
            }
          />
        ) : (
          <PlaybookPanel runs={runs} />
        )}
      </div>
    </div>
  );
}

/** Steps a procedure cannot get past yet — the rail badge. */
export function blockedStepCount(caseData: PropertyCase): number {
  return (caseData.result?.playbooks ?? []).reduce(
    (n, r) => n + r.steps.filter(s => s.state === 'blocked').length,
    0,
  );
}
