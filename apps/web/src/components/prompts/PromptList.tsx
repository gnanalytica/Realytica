import { useMemo, useState } from 'react';
import { Bot, ChevronRight, ShieldAlert } from 'lucide-react';
import type { AgentKind, PromptDescriptor, PromptRole } from '@realytica/shared';
import { Badge, EmptyState, Select, cn } from '../ui/kit';
import { activeVersion, brokenChecks } from './InvariantList';

/**
 * Every prompt the agent layer uses, grouped by the agent that runs it.
 *
 * The list is the only screen guaranteed to be seen, so it carries the fact
 * that matters most: whether the version *currently in force* still keeps its
 * guardrails. A prompt whose active version dropped the anti-fabrication rule
 * is not a detail to be discovered by opening it — the row says so in words,
 * with an icon and a tinted rail, and the agent group above it says how many
 * of its prompts are in that state.
 *
 * Deliberately not a subtle amber dot. The failure this guards against is
 * someone shipping a preamble with the never-invent rule deleted and nobody
 * noticing for a week.
 */

const AGENT_LABEL: Record<AgentKind, string> = {
  property_discovery: 'Property discovery',
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  critic: 'Critic',
  explorer: 'Explorer',
  document_intelligence: 'Document intelligence',
  proof_pathways: 'Proof pathways',
  analyst_copilot: 'Analyst copilot',
  market_research: 'Market research',
  diligence_planner: 'Diligence planner',
  title_graph: 'Title graph',
  intake_concierge: 'Intake concierge',
};

/** Fixed reading order: shared plumbing first, then the agents that produce user-facing findings. */
const AGENT_ORDER: AgentKind[] = [
  'orchestrator',
  'planner',
  'document_intelligence',
  'title_graph',
  'proof_pathways',
  'critic',
  'analyst_copilot',
  'market_research',
  'diligence_planner',
  'explorer',
];

export const ROLE_LABEL: Record<PromptRole, string> = {
  grounding: 'Shared preamble',
  system: 'System',
  instruction: 'Instruction',
};

export const ROLE_HINT: Record<PromptRole, string> = {
  grounding: 'Inherited by every agent. Where the anti-fabrication rules live.',
  system: "The agent's own role definition.",
  instruction: 'A per-call instruction assembled from case data.',
};

type Filter = 'all' | 'compromised' | 'customised';

function agentRank(agent: AgentKind): number {
  const index = AGENT_ORDER.indexOf(agent);
  return index === -1 ? AGENT_ORDER.length : index;
}

export interface PromptListProps {
  prompts: PromptDescriptor[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
}

export function PromptList({ prompts, selectedKey, onSelect, className }: PromptListProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(() => {
    const shown = prompts.filter((p) => {
      if (filter === 'compromised') return brokenChecks(activeVersion(p)).length > 0 || !activeVersion(p);
      if (filter === 'customised') return p.versions.length > 1;
      return true;
    });
    const byAgent = new Map<AgentKind, PromptDescriptor[]>();
    for (const prompt of shown) {
      const bucket = byAgent.get(prompt.agent);
      if (bucket) bucket.push(prompt);
      else byAgent.set(prompt.agent, [prompt]);
    }
    return [...byAgent.entries()]
      .sort((a, b) => agentRank(a[0]) - agentRank(b[0]))
      .map(([agent, items]) => ({
        agent,
        items: [...items].sort((a, b) => a.key.localeCompare(b.key)),
      }));
  }, [prompts, filter]);

  if (prompts.length === 0) {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="No prompts registered"
        description="The agent layer has not declared any prompts to this build, so there is nothing to version. This is not the same as every prompt being in its shipped state — nothing was reported either way."
      />
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="text-mini font-semibold uppercase tracking-[0.07em] text-ink-muted">
          {prompts.length} prompt{prompts.length === 1 ? '' : 's'}
        </span>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          aria-label="Filter prompts"
          className="ml-auto h-7 w-[11.5rem] text-xs"
        >
          <option value="all">All prompts</option>
          <option value="compromised">Guardrail dropped</option>
          <option value="customised">Customised only</option>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-secondary">
            {filter === 'compromised'
              ? 'No prompt is running on a version that dropped a guardrail. That is the outcome you want.'
              : 'Every prompt is still on its shipped text — no custom versions exist yet.'}
          </p>
        ) : (
          groups.map(({ agent, items }) => {
            const compromised = items.filter((p) => brokenChecks(activeVersion(p)).length > 0 || !activeVersion(p));
            return (
              <section key={agent}>
                <header className="sticky top-0 z-10 flex items-center gap-2 bg-sunken px-3 py-1.5">
                  <h3 className="text-mini font-semibold uppercase tracking-[0.07em] text-ink-secondary">
                    {AGENT_LABEL[agent] ?? agent}
                  </h3>
                  <span className="text-mini text-ink-muted">{items.length}</span>
                  {compromised.length > 0 ? (
                    <Badge tone="critical" className="ml-auto" icon={<ShieldAlert size={11} />}>
                      {compromised.length} unguarded
                    </Badge>
                  ) : null}
                </header>

                <ul>
                  {items.map((prompt) => {
                    const active = activeVersion(prompt);
                    const broken = brokenChecks(active);
                    const unresolved = !active;
                    const alarming = unresolved || broken.length > 0;
                    const selected = prompt.key === selectedKey;
                    return (
                      <li key={prompt.key}>
                        <button
                          type="button"
                          onClick={() => onSelect(prompt.key)}
                          aria-current={selected ? 'true' : undefined}
                          data-testid={`prompt-row-${prompt.key}`}
                          data-compromised={alarming ? 'true' : 'false'}
                          className={cn(
                            'flex w-full items-start gap-2 border-b border-l-2 border-hairline px-3 py-2.5 text-left transition-colors',
                            selected ? 'border-l-brand bg-brand-soft' : 'border-l-transparent hover:bg-sunken',
                            alarming && !selected && 'border-l-critical bg-critical/5',
                            alarming && selected && 'border-l-critical',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="text-[13px] font-medium text-ink">{prompt.label}</span>
                              <Badge tone={prompt.role === 'grounding' ? 'brand' : 'neutral'} title={ROLE_HINT[prompt.role]}>
                                {ROLE_LABEL[prompt.role]}
                              </Badge>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-micro text-ink-muted">{prompt.key}</p>

                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-mini text-ink-secondary">
                              {active ? (
                                <span>
                                  Active <span className="font-medium text-ink">v{active.version}</span> · {active.label}
                                </span>
                              ) : (
                                <span className="font-medium text-critical">Active version does not resolve</span>
                              )}
                              <span className="text-ink-muted">
                                {prompt.versions.length} version{prompt.versions.length === 1 ? '' : 's'}
                              </span>
                            </div>

                            {unresolved ? (
                              <p className="mt-1.5 flex items-start gap-1 text-mini font-medium leading-relaxed text-critical">
                                <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                                This prompt points at a version that is not in its own history. Nothing here can be
                                treated as checked.
                              </p>
                            ) : broken.length > 0 ? (
                              <p
                                className="mt-1.5 flex items-start gap-1 text-mini font-medium leading-relaxed text-critical"
                                data-testid={`prompt-broken-${prompt.key}`}
                              >
                                <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                                Guardrail dropped: {broken.map((b) => b.label).join(', ')}
                              </p>
                            ) : (
                              <p className="mt-1.5 text-mini leading-relaxed text-ink-muted">
                                All {active.invariants.length} guardrail{active.invariants.length === 1 ? '' : 's'} kept
                              </p>
                            )}
                          </div>
                          <ChevronRight size={14} className="mt-1 shrink-0 text-ink-muted" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

export default PromptList;
