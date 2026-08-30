import type { PropertyCase, ScreenResult } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { CASE_GROUPS, NEEDS_SCREEN, findGroup } from '../groups';
import { Button, EmptyState, cn } from '../../../components/ui/kit';

/**
 * The screening analysis, inside the cockpit.
 *
 * These are the same components the case workspace rendered — Summary, Risks,
 * Range, What to offer, Title, Compliance and the rest — reached through the
 * `TabProps` contract every case view already takes, exactly as the graph
 * pane reaches `GraphExplorerTab`. Nothing was rewritten to bring them here.
 *
 * Bringing them here is what let the second shell go. The cockpit could say
 * what state the diligence was in but not what the property was worth, so a
 * reader had to leave it to answer half their questions — and the half they
 * left for was the half a case is opened to settle. Two shells over one case
 * is also how the eight departments came to exist twice, rendered by two
 * different components that could disagree.
 *
 * A group with several views keeps its own switcher rather than being flattened
 * into the rail: the rail is the case's top level and would stop being
 * readable at twenty entries, and the group's question is the thing its views
 * have in common.
 */
export function ScreeningPane({
  groupKey,
  viewKey,
  onSelectView,
  ...tab
}: TabProps & {
  groupKey: string;
  viewKey: string | null;
  onSelectView: (view: string) => void;
}) {
  const group = findGroup(groupKey) ?? CASE_GROUPS[0];
  const view = group.views.find(v => v.key === viewKey) ?? group.views[0];
  const View = view.component;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-hairline bg-surface-2 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-ink">{group.label}</h2>
        {/* The group's question, not a restatement of its name — it is what
            the views below have in common and why they sit together. */}
        <p className="mt-0.5 text-mini text-ink-muted">{group.question}</p>
        {group.views.length > 1 ? (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {group.views.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => onSelectView(v.key)}
                aria-current={v.key === view.key ? 'true' : undefined}
                className={cn(
                  'rounded-full px-2.5 py-1 text-mini',
                  v.key === view.key ? 'bg-brand text-[var(--brand-ink)] font-medium' : 'bg-surface-3 text-ink-secondary hover:text-ink',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {NEEDS_SCREEN.has(view.key) && !tab.result ? (
          <div className="flex items-center justify-center py-16">
            <EmptyState
              title="This case has not been screened yet"
              description="The screen computes the value range, the risks and the compliance position from the documents on file."
              action={
                <Button onClick={tab.runScreen} loading={tab.running}>
                  Run the screen
                </Button>
              }
            />
          </div>
        ) : (
          <View {...tab} />
        )}
      </div>
    </div>
  );
}

/**
 * The groups the cockpit's Screening section offers, in reading order — and
 * the complete set of groups its right pane can show. One list, because two
 * were one list too many.
 *
 * Documents and Report used to be missing from the first and present in the
 * second: they were `CASE_GROUPS` entries all along, setting the same `pane`
 * parameter as their neighbours, but the rail listed them separately at the
 * bottom beside Requests and the graph, on the reasoning that they are things
 * you do rather than questions you ask. The rail then had two entry points
 * into the same group system, styled differently and eleven rows apart, and
 * whichever list a future group was added to it would be missing from the
 * other. Pane resolution reads this, so a `pane=` value and an old
 * `/cases/:id/<tab>` link still resolve to the same surface.
 */
export const SCREENING_GROUPS = ['overview', 'value', 'legal', 'documents', 'report'] as const;

/**
 * The rail badge for a screening group — the same counts the workspace's tab
 * bar carried, so nothing that used to be visible at a glance stopped being.
 */
export function screeningBadge(
  groupKey: string,
  caseData: PropertyCase,
  result: ScreenResult | null,
): { count: number; blocking: boolean } | undefined {
  if (groupKey === 'overview') {
    const n = result?.risks.filter(r => r.severity === 'critical' && r.status === 'open').length ?? 0;
    return n > 0 ? { count: n, blocking: true } : undefined;
  }
  if (groupKey === 'documents') {
    const n = caseData.documents.length;
    return n > 0 ? { count: n, blocking: false } : undefined;
  }
  if (groupKey === 'legal') {
    const titleFindings = result?.titleGraph
      ? result.titleGraph.contradictions.length + result.titleGraph.chains.reduce((n, c) => n + c.breaks.length, 0)
      : 0;
    const blockers = result?.stateCompliance?.checks.filter(c => c.verdict === 'blocker').length ?? 0;
    const n = titleFindings + blockers;
    return n > 0 ? { count: n, blocking: false } : undefined;
  }
  return undefined;
}

