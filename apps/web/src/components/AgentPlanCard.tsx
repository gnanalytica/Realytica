import { useMemo } from 'react';
import { CircleSlash2, ClipboardList, MinusCircle, ShieldCheck } from 'lucide-react';
import type { AgentKind, AgentPlan, PlannedTask, TaskDepth } from '@valytica/shared';
import { formatUsd } from './AgentRunTimeline';
import { Badge, Card, CardBody, CardHeader, EmptyState, Stat, cn } from './ui/kit';

/**
 * What the planner decided a case needs, and — with equal visual weight —
 * what it deliberately chose not to do. A planner that skips market research
 * on a case with no asking price has made a good call; hiding that reasoning
 * behind a collapsed "advanced" section would make it read like an omission
 * instead of a judgement, so `deliberateOmissions` gets its own card here,
 * not a footnote under the task list.
 */

const AGENT_LABEL: Record<AgentKind, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  critic: 'Critic',
  explorer: 'Explorer',
  document_intelligence: 'Document Intelligence',
  proof_pathways: 'Proof Pathways',
  analyst_copilot: 'Analyst Copilot',
  market_research: 'Market Research',
  diligence_planner: 'Diligence Planner',
  title_graph: 'Title Graph',
  intake_concierge: 'Intake concierge',
};

const DEPTH_LABEL: Record<TaskDepth, string> = { skip: 'Skipped', light: 'Light', standard: 'Standard', deep: 'Deep' };
const DEPTH_LEVEL: Record<TaskDepth, number> = { skip: 0, light: 1, standard: 2, deep: 3 };

function DepthBadge({ depth }: { depth: TaskDepth }) {
  if (depth === 'skip') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-[var(--ring)]">
        <MinusCircle size={11} aria-hidden="true" />
        {DEPTH_LABEL.skip}
      </span>
    );
  }
  const level = DEPTH_LEVEL[depth];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand ring-1 ring-inset ring-brand/25"
      title={`${DEPTH_LABEL[depth]} pass`}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i <= level ? 'bg-brand' : 'bg-brand/20')} />
        ))}
      </span>
      {DEPTH_LABEL[depth]}
    </span>
  );
}

function TaskRow({ task, runsConcurrentlyWith }: { task: PlannedTask; runsConcurrentlyWith: number }) {
  return (
    <li className={cn('rounded-lg p-3', task.depth === 'skip' ? 'bg-sunken/60' : 'bg-sunken')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('text-[13px] font-semibold', task.depth === 'skip' ? 'text-ink-secondary' : 'text-ink')}>
          {AGENT_LABEL[task.agent]}
        </span>
        <DepthBadge depth={task.depth} />
        <span className="ml-auto shrink-0 text-[11px] text-ink-muted">
          Step {task.order}
          {runsConcurrentlyWith > 0 ? ` · concurrent with ${runsConcurrentlyWith}` : ''}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{task.rationale}</p>
      {task.focus.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {task.focus.map((f, i) => (
            <li key={i} className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
              {f}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AgentPlanCard({ plan, actualSpendUsd }: { plan: AgentPlan | undefined; actualSpendUsd: number }) {
  const sortedTasks = useMemo(() => [...(plan?.tasks ?? [])].sort((a, b) => a.order - b.order), [plan]);
  const orderCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const t of sortedTasks) counts.set(t.order, (counts.get(t.order) ?? 0) + 1);
    return counts;
  }, [sortedTasks]);

  return (
    <Card>
      <CardHeader
        title="Agent plan"
        subtitle="What the planner decided this case needs — and what it chose not to do"
        icon={<ClipboardList size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        {!plan ? (
          <EmptyState
            icon={<ClipboardList size={24} />}
            title="No plan yet"
            description="Run the agents to see the planner's read of this case — which agents it scheduled, at what depth, why, and what it deliberately left out."
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <p className="max-w-2xl text-[13px] leading-relaxed text-ink">{plan.caseAssessment}</p>
              <div className="grid shrink-0 grid-cols-2 gap-4">
                <Stat label="Estimated cost" value={formatUsd(plan.estimatedCostUsd)} />
                <Stat
                  label="Actual so far"
                  value={formatUsd(actualSpendUsd)}
                  tone={actualSpendUsd > plan.estimatedCostUsd * 1.25 ? 'warning' : 'neutral'}
                />
              </div>
            </div>

            {sortedTasks.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  Scheduled tasks ({sortedTasks.length})
                </p>
                <ul className="flex flex-col gap-2">
                  {sortedTasks.map((task, i) => (
                    <TaskRow key={`${task.agent}-${i}`} task={task} runsConcurrentlyWith={(orderCounts.get(task.order) ?? 1) - 1} />
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-lg ring-1 ring-inset ring-[var(--ring)]">
              <div className="flex items-center gap-1.5 border-b border-hairline px-3 py-2">
                <ShieldCheck size={13} className="text-ink-muted" aria-hidden="true" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  Deliberately not done ({plan.deliberateOmissions.length})
                </p>
              </div>
              <div className="px-3 py-2.5">
                {plan.deliberateOmissions.length === 0 ? (
                  <p className="text-xs text-ink-secondary">Nothing was deliberately skipped for this case.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {plan.deliberateOmissions.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink">
                        <CircleSlash2 size={14} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
              <Badge tone="neutral">Plan produced by the planner agent</Badge>
              <span>— model judgement about this case, not a documented fact.</span>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
