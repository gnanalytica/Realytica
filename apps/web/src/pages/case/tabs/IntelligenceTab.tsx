import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  FileQuestion,
  FlaskConical,
  Globe,
  ListChecks,
  MessageCircle,
  Play,
  Route as RouteIcon,
  ScrollText,
  Settings2,
  ShieldQuestion,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type {
  AgentCapability,
  AgentInsight,
  AgentKind,
  AgentRun,
  AgentStep,
  CaseIntelligence,
  DocumentPathway,
  EvidenceItem,
  ProofRoute,
  ProofRouteKind,
  PropertyCase,
  ResearchFinding,
  ScreenResult,
  IngestionReport,
} from '@valytica/shared';
import type { TabProps } from '../tab-props';
import { api, streamAgentRun } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { money, relativeTime, titleCase } from '../../../lib/format';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { AgentRunTimeline, formatUsd } from '../../../components/AgentRunTimeline';
import { CopilotPanel } from '../../../components/CopilotPanel';
import { AgentPlanCard } from '../../../components/AgentPlanCard';
import { CostBreakdown } from '../../../components/CostBreakdown';
import { MemoryCard, SourcesCard } from '../../../components/KnowledgePanel';
import { CriticFlagBanner, VerificationPanel, findFlaggedCriticFinding } from '../../../components/VerificationPanel';
import { ExplorationTrail } from '../../../components/ExplorationTrail';
import type { VerificationSummary } from '@valytica/shared';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  Stat,
  useToast,
  cn,
  type Tone,
} from '../../../components/ui/kit';

/* ------------------------------------------------------------------ */
/* Static labels                                                       */
/* ------------------------------------------------------------------ */

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

const PROOF_ROUTE_KIND_LABEL: Record<ProofRouteKind, string> = {
  online_portal: 'Online portal',
  in_person_office: 'In-person office visit',
  authorised_intermediary: 'Authorised intermediary',
  from_seller: 'From the seller',
  from_lender: 'From the lender',
  court_or_tribunal: 'Court or tribunal',
  reconstruct_from_secondary: 'Reconstruct from secondary evidence',
};

const FEASIBILITY_TONE: Record<ProofRoute['feasibility'], Tone> = {
  straightforward: 'good',
  moderate: 'warning',
  difficult: 'serious',
  blocked: 'critical',
};

const FEASIBILITY_LABEL: Record<ProofRoute['feasibility'], string> = {
  straightforward: 'Straightforward',
  moderate: 'Moderate effort',
  difficult: 'Difficult',
  blocked: 'Blocked',
};

const TARGET_KIND_ORDER: DocumentPathway['targetKind'][] = ['missing_document', 'unresolved_check', 'weak_evidence'];

const TARGET_KIND_LABEL: Record<DocumentPathway['targetKind'], string> = {
  missing_document: 'Missing documents',
  unresolved_check: 'Unresolved checks',
  weak_evidence: 'Weak evidence',
};

const TARGET_KIND_ICON: Record<DocumentPathway['targetKind'], typeof FileQuestion> = {
  missing_document: FileQuestion,
  unresolved_check: ShieldQuestion,
  weak_evidence: FlaskConical,
};

const IMPORTANCE_RANK: Record<AgentInsight['importance'], number> = { high: 0, medium: 1, low: 2 };

const CATEGORY_ICON: Record<AgentInsight['category'], typeof Compass> = {
  valuation: Wallet,
  risk: AlertTriangle,
  compliance: ScrollText,
  market: Globe,
  process: ListChecks,
};

const CORROBORATION_TONE: Record<ResearchFinding['corroboration'], Tone> = {
  multiple_sources: 'good',
  single_source: 'warning',
  uncorroborated: 'serious',
};

const CORROBORATION_LABEL: Record<ResearchFinding['corroboration'], string> = {
  multiple_sources: 'Multiple sources',
  single_source: 'Single source',
  uncorroborated: 'Uncorroborated',
};

const EMPTY_INTELLIGENCE: CaseIntelligence = { runs: [], explorations: [], pathways: [], research: [], insights: [], conversation: [] };

function capabilityReasonText(reason: string): string {
  if (reason === 'no_credentials') return 'No Anthropic credentials are configured for this deployment.';
  if (reason === 'disabled') return 'Agents are explicitly disabled for this deployment.';
  return `Agents are unavailable (${reason}).`;
}

function buildSuggestions(caseData: PropertyCase, result: ScreenResult | null, intel: CaseIntelligence): string[] {
  const out: string[] = [];
  if (result) {
    const askingVsMid = result.indicativeValue.askingVsMidPct;
    out.push(askingVsMid !== null && askingVsMid < 0 ? 'Why is this below the locality median?' : 'What is driving this valuation?');
    const openCritical = result.risks.filter((r) => r.severity === 'critical' && r.status === 'open').length;
    if (openCritical > 0) out.push('What is blocking this deal?');
    if (result.stateCompliance?.checks.some((c) => c.verdict === 'blocker')) {
      out.push('What compliance blockers need to be resolved first?');
    }
  } else {
    out.push('What should I look at first for this case?');
    out.push('What documents are most urgent to collect?');
  }
  if (intel.pathways.length > 0) out.push("What's the fastest way to close the biggest evidence gap?");
  if (intel.research.some((r) => r.contradictsEngine)) out.push('What does the research that contradicts the engine say?');
  return Array.from(new Set(out)).slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function CapabilityExplainer({ capability }: { capability: AgentCapability }) {
  return (
    <Callout tone="neutral" title="Agents are not configured">
      <div className="flex flex-col gap-2">
        <p>{capabilityReasonText(capability.reason)}</p>
        {capability.reason === 'no_credentials' ? (
          <p>
            Set <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[11px] text-ink">ANTHROPIC_API_KEY</code> (or{' '}
            <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[11px] text-ink">ANTHROPIC_AUTH_TOKEN</code>, or run{' '}
            <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[11px] text-ink">ant auth login</code>) for the API
            process and restart it.
          </p>
        ) : null}
        <p className="font-medium text-ink">
          Valytica&rsquo;s screening engine — valuation, risk, compliance, planning, every other tab — works fully without
          this. Agents are an optional addition layered on top of the deterministic screen, never a requirement for it.
        </p>
      </div>
    </Callout>
  );
}

function HeaderCard({
  capability,
  intel,
  totalCost,
  running,
  onRun,
  onOpenPicker,
}: {
  capability: AgentCapability;
  intel: CaseIntelligence;
  totalCost: number;
  running: boolean;
  onRun: () => void;
  onOpenPicker: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Agent intelligence"
        subtitle="Model-generated analysis layered on the deterministic screen — never a replacement for it"
        icon={<Sparkles size={16} />}
        action={
          capability.available ? (
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" icon={<Settings2 size={13} />} onClick={onOpenPicker} disabled={running}>
                Choose agents
              </Button>
              <Button variant="primary" size="sm" icon={<Play size={13} />} loading={running} onClick={onRun}>
                {running ? 'Running…' : intel.runs.length > 0 ? 'Re-run agents' : 'Run agents'}
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Status" value={capability.available ? 'Available' : 'Unavailable'} tone={capability.available ? 'good' : 'neutral'} />
          <Stat label="Model" value={capability.available ? capability.model : '—'} />
          <Stat label="Last run" value={intel.lastRunAt ? relativeTime(intel.lastRunAt) : 'Never'} />
          <Stat
            label="Estimated cost"
            value={formatUsd(totalCost)}
            sub={`${intel.runs.length} run${intel.runs.length === 1 ? '' : 's'} total`}
          />
        </div>
        {!capability.available ? <CapabilityExplainer capability={capability} /> : null}
      </CardBody>
    </Card>
  );
}

function AgentPickerModal({
  open,
  onClose,
  enabledAgents,
  selected,
  onChange,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  enabledAgents: AgentKind[];
  selected: AgentKind[];
  onChange: (agents: AgentKind[]) => void;
  onRun: () => void;
}) {
  const toggle = (agent: AgentKind, checked: boolean): void => {
    onChange(checked ? [...selected, agent] : selected.filter((a) => a !== agent));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose agents to run"
      width="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={selected.length === 0} onClick={onRun}>
            Run selected
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {enabledAgents.map((agent) => (
          <Checkbox key={agent} checked={selected.includes(agent)} onChange={(next) => toggle(agent, next)} label={AGENT_LABEL[agent]} />
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

function InsightsCard({
  insights,
  evidence,
  onOpenEvidence,
  verification,
}: {
  insights: AgentInsight[];
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  verification: VerificationSummary | undefined;
}) {
  const sorted = useMemo(
    () => [...insights].sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]),
    [insights],
  );
  return (
    <Card>
      <CardHeader
        title="Insights"
        subtitle="Ranked by importance — agent judgement on top of the screen, not a documented fact"
        icon={<Sparkles size={16} />}
      />
      <CardBody>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={24} />}
            title="No insights yet"
            description="Run the agents to surface ranked observations about valuation, risk, compliance and market context."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {sorted.map((insight) => {
              const Icon = CATEGORY_ICON[insight.category];
              const flagged = findFlaggedCriticFinding(verification, 'insight', insight.id);
              return (
                <li key={insight.id} className="rounded-lg bg-sunken p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" icon={<Icon size={11} />}>
                      {titleCase(insight.category)}
                    </Badge>
                    {insight.importance === 'high' ? <Badge tone="brand">High importance</Badge> : null}
                    {insight.inferred ? (
                      <Badge tone="neutral" icon={<Sparkles size={10} />} title="Reasoned beyond the documented evidence">
                        Inferred
                      </Badge>
                    ) : null}
                    <span className="ml-auto shrink-0">
                      <EvidenceLink ids={insight.evidenceIds} evidence={evidence} onOpen={onOpenEvidence} compact />
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-semibold text-ink">{insight.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{insight.body}</p>
                  {flagged ? (
                    <div className="mt-2">
                      <CriticFlagBanner finding={flagged} compact />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Document pathways — the centrepiece                                 */
/* ------------------------------------------------------------------ */

function ProofRouteRow({
  route,
  recommended,
  evidence,
  onOpenEvidence,
  verification,
}: {
  route: ProofRoute;
  recommended: boolean;
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  verification: VerificationSummary | undefined;
}) {
  const blocked = route.feasibility === 'blocked';
  const tone = FEASIBILITY_TONE[route.feasibility];
  const flagged = findFlaggedCriticFinding(verification, 'proof_route', route.id);
  return (
    <div className={cn('rounded-lg p-3', blocked ? 'bg-critical/5 ring-1 ring-inset ring-critical/30' : 'bg-sunken')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {recommended ? (
          <Badge tone="brand" icon={<Sparkles size={10} />}>
            Recommended
          </Badge>
        ) : null}
        <Badge tone={tone}>{FEASIBILITY_LABEL[route.feasibility]}</Badge>
        <span className="text-[13px] font-semibold text-ink">{route.title}</span>
        <span className="text-xs text-ink-muted">· {PROOF_ROUTE_KIND_LABEL[route.kind]}</span>
      </div>

      {flagged ? (
        <div className="mt-2">
          <CriticFlagBanner finding={flagged} />
        </div>
      ) : null}

      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-ink-muted">Authority</dt>
          <dd className="text-ink-secondary">{route.authority}</dd>
        </div>
        {route.portalOrAddress ? (
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-ink-muted">Portal / address</dt>
            <dd className="truncate text-ink-secondary">{route.portalOrAddress}</dd>
          </div>
        ) : null}
        {route.formOrReference ? (
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-ink-muted">Form / reference</dt>
            <dd className="font-mono text-ink-secondary">{route.formOrReference}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-ink-muted">Cost</dt>
          <dd className="text-ink-secondary">
            {route.typicalCost
              ? `${money(route.typicalCost.low, route.typicalCost.currency)} – ${money(route.typicalCost.high, route.typicalCost.currency)}`
              : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-ink-muted">Duration</dt>
          <dd className="text-ink-secondary">
            {route.typicalDurationDays ? `${route.typicalDurationDays.low}–${route.typicalDurationDays.high} days` : '—'}
          </dd>
        </div>
      </dl>

      {blocked ? (
        <div className="mt-2">
          <Callout tone="critical" title="This route is currently blocked">
            {route.risks.length > 0 ? route.risks[0] : 'It cannot be completed as things stand — see the risks below.'}
          </Callout>
        </div>
      ) : null}

      {route.steps.length > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {blocked ? 'Steps (not currently actionable)' : 'Steps'}
          </p>
          <ol className={cn('list-inside list-decimal space-y-0.5 text-xs', blocked ? 'text-ink-muted line-through' : 'text-ink-secondary')}>
            {route.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {route.prerequisites.length > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Prerequisites</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-secondary">
            {route.prerequisites.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!blocked && route.risks.length > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">How this can fail</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-secondary">
            {route.risks.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
        <span className="text-[11px] text-ink-muted">Confidence {Math.round(route.confidence * 100)}%</span>
        <EvidenceLink ids={route.evidenceIds} evidence={evidence} onOpen={onOpenEvidence} />
      </div>
    </div>
  );
}

function PathwayCard({
  pathway,
  evidence,
  onOpenEvidence,
  verification,
}: {
  pathway: DocumentPathway;
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  verification: VerificationSummary | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  const flagged = findFlaggedCriticFinding(verification, 'pathway', pathway.id);
  return (
    <div className="rounded-lg ring-1 ring-inset ring-[var(--ring)]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">{pathway.targetLabel}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{pathway.whyItMatters}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="neutral">
            {pathway.routes.length} route{pathway.routes.length === 1 ? '' : 's'}
          </Badge>
          {expanded ? (
            <ChevronUp size={14} className="text-ink-muted" aria-hidden="true" />
          ) : (
            <ChevronDown size={14} className="text-ink-muted" aria-hidden="true" />
          )}
        </div>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-hairline px-3.5 py-3">
          {flagged ? <CriticFlagBanner finding={flagged} /> : null}
          {pathway.routes.length === 0 ? (
            <Callout tone="serious" title="No known route">
              Nothing on file or in agent research closes this gap yet — treat it as an open unknown rather than an
              oversight.
            </Callout>
          ) : (
            pathway.routes.map((route) => (
              <ProofRouteRow
                key={route.id}
                route={route}
                recommended={route.id === pathway.recommendedRouteId}
                evidence={evidence}
                onOpenEvidence={onOpenEvidence}
                verification={verification}
              />
            ))
          )}
          {pathway.unlocks.length > 0 || pathway.wouldResolve.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {pathway.unlocks.length > 0 ? (
                <div className="rounded-lg bg-sunken p-2.5">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Unlocks</p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-secondary">
                    {pathway.unlocks.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {pathway.wouldResolve.length > 0 ? (
                <div className="rounded-lg bg-sunken p-2.5">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Would resolve</p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-secondary">
                    {pathway.wouldResolve.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PathwaysCard({
  pathways,
  evidence,
  onOpenEvidence,
  verification,
}: {
  pathways: DocumentPathway[];
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  verification: VerificationSummary | undefined;
}) {
  const groups = useMemo(
    () => TARGET_KIND_ORDER.map((kind) => ({ kind, items: pathways.filter((p) => p.targetKind === kind) })).filter((g) => g.items.length > 0),
    [pathways],
  );

  return (
    <Card>
      <CardHeader
        title="Document pathways"
        subtitle="Every known way to close a gap in the evidence — costed, sequenced and ranked"
        icon={<RouteIcon size={16} />}
      />
      <CardBody className="flex flex-col gap-5 overflow-x-auto">
        {pathways.length === 0 ? (
          <EmptyState
            icon={<RouteIcon size={24} />}
            title="No pathways surfaced"
            description="Run the agents to get concrete, costed routes for closing missing documents, unresolved checks and weak evidence."
          />
        ) : (
          groups.map((g) => {
            const Icon = TARGET_KIND_ICON[g.kind];
            return (
              <div key={g.kind} className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  <Icon size={12} aria-hidden="true" />
                  {TARGET_KIND_LABEL[g.kind]}
                  <span className="font-normal normal-case tracking-normal text-ink-muted">({g.items.length})</span>
                </div>
                <div className="flex flex-col gap-3">
                  {g.items.map((pathway) => (
                    <PathwayCard
                      key={pathway.id}
                      pathway={pathway}
                      evidence={evidence}
                      onOpenEvidence={onOpenEvidence}
                      verification={verification}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Research findings                                                   */
/* ------------------------------------------------------------------ */

function ResearchCard({ findings, verification }: { findings: ResearchFinding[]; verification: VerificationSummary | undefined }) {
  return (
    <Card>
      <CardHeader title="Research findings" subtitle="External web research — verify before relying on it" icon={<Globe size={16} />} />
      <CardBody>
        {findings.length === 0 ? (
          <EmptyState
            icon={<Globe size={24} />}
            title="No external research yet"
            description="Enable web search and run the market research agent to bring in locality trends, comparable listings and news beyond the local dataset."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {findings.map((f) => {
              const flagged = findFlaggedCriticFinding(verification, 'research_finding', f.id);
              return (
                <li key={f.id} className={cn('rounded-lg p-3', f.contradictsEngine ? 'bg-critical/5 ring-1 ring-inset ring-critical/30' : 'bg-sunken')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" icon={<Globe size={10} />}>
                      External research
                    </Badge>
                    <Badge tone={CORROBORATION_TONE[f.corroboration]}>{CORROBORATION_LABEL[f.corroboration]}</Badge>
                    {f.contradictsEngine ? (
                      <Badge tone="critical" icon={<AlertTriangle size={10} />}>
                        Contradicts the engine
                      </Badge>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{relativeTime(f.retrievedAt)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{f.claim}</p>
                  <p className="mt-1 text-xs text-ink-secondary">{f.relevance}</p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    {f.sourceUrl ? (
                      <a
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-brand hover:underline"
                      >
                        <span className="truncate">{f.sourceTitle ?? f.sourceUrl}</span> <ExternalLink size={11} className="shrink-0" />
                      </a>
                    ) : (
                      <span className="text-xs italic text-ink-muted">No source link recorded</span>
                    )}
                    <span className="shrink-0 text-[11px] text-ink-muted">Confidence {Math.round(f.confidence * 100)}%</span>
                  </div>
                  {flagged ? (
                    <div className="mt-2">
                      <CriticFlagBanner finding={flagged} compact />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Explore control                                                     */
/* ------------------------------------------------------------------ */

function ExploreControl({
  disabled,
  disabledReason,
  exploring,
  objective,
  onObjectiveChange,
  maxIterations,
  onMaxIterationsChange,
  maxCostUsd,
  onMaxCostUsdChange,
  onExplore,
  error,
}: {
  disabled: boolean;
  disabledReason?: string;
  exploring: boolean;
  objective: string;
  onObjectiveChange: (value: string) => void;
  maxIterations: number;
  onMaxIterationsChange: (value: number) => void;
  maxCostUsd: number;
  onMaxCostUsdChange: (value: number) => void;
  onExplore: () => void;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Start an exploration"
        subtitle="Give it an objective and a budget — it decides for itself what to look at from there"
        icon={<Compass size={16} />}
      />
      <CardBody className="flex flex-col gap-3">
        {disabled ? (
          <Callout tone="neutral" title="Exploration needs Anthropic credentials">
            {disabledReason} The rest of Valytica works fully without it.
          </Callout>
        ) : null}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <Field label="Objective" className="min-w-0 flex-1" hint="Leave blank for a general locality and market sweep.">
            <Input
              placeholder="e.g. Any lake, drain or land-acquisition notices near this locality?"
              value={objective}
              disabled={disabled || exploring}
              onChange={(e) => onObjectiveChange(e.target.value)}
            />
          </Field>
          <Field label="Max iterations" className="w-full sm:w-28">
            <Input
              type="number"
              min={1}
              max={20}
              value={maxIterations}
              disabled={disabled || exploring}
              onChange={(e) => onMaxIterationsChange(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </Field>
          <Field label="Budget (USD)" className="w-full sm:w-28">
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={maxCostUsd}
              disabled={disabled || exploring}
              onChange={(e) => onMaxCostUsdChange(Math.max(0.1, Number(e.target.value) || 0.1))}
            />
          </Field>
          <Button variant="primary" icon={<Compass size={14} />} loading={exploring} disabled={disabled} onClick={onExplore} className="shrink-0">
            {exploring ? 'Exploring…' : 'Explore'}
          </Button>
        </div>
        {error ? <p className="text-xs text-critical">{error}</p> : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export default function IntelligenceTab({ caseData, result, refresh }: TabProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: capability, loading: capLoading, error: capError } = useAsync(() => api.agentCapability(), []);

  const [running, setRunning] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [streamRuns, setStreamRuns] = useState<AgentRun[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<AgentKind[]>([]);
  const [asking, setAsking] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [exploreObjective, setExploreObjective] = useState('');
  const [exploreMaxIterations, setExploreMaxIterations] = useState(6);
  const [exploreMaxCostUsd, setExploreMaxCostUsd] = useState(1);
  const [requestedBudgets, setRequestedBudgets] = useState<Record<string, { maxIterations: number; maxCostUsd: number }>>({});
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (capability?.available && selectedAgents.length === 0) {
      setSelectedAgents(capability.enabledAgents);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capability]);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
    },
    [],
  );

  const intel: CaseIntelligence = caseData.intelligence ?? EMPTY_INTELLIGENCE;
  const evidence = result?.evidence ?? [];

  const allRuns = useMemo(() => [...intel.runs, ...streamRuns], [intel.runs, streamRuns]);
  const totalCost = useMemo(() => allRuns.reduce((sum, r) => sum + (r.usage?.estimatedCostUsd ?? 0), 0), [allRuns]);

  const openEvidence = useCallback(
    (ids: string[]) => {
      navigate(`/cases/${caseData.id}/evidence?evidence=${encodeURIComponent(ids.join(','))}`);
    },
    [caseData.id, navigate],
  );

  const [streamBuffered, setStreamBuffered] = useState(false);
  const lastRunAtRef = useRef<string | undefined>(undefined);

  const startRun = useCallback(
    (agents?: AgentKind[]) => {
      unsubscribeRef.current?.();
      lastRunAtRef.current = caseData.intelligence?.lastRunAt;
      setRunning(true);
      setStreamBuffered(false);
      setRunError(null);
      setLiveSteps([]);
      setStreamRuns([]);
      unsubscribeRef.current = streamAgentRun(caseData.id, agents, {
        onStep: (step) => setLiveSteps((prev) => [...prev, step]),
        onRun: (run) => {
          setStreamRuns((prev) => [...prev, run]);
          setLiveSteps([]);
        },
        onDone: () => {
          setRunning(false);
          setLiveSteps([]);
          setStreamRuns([]);
          void refresh();
          toast('Agent run complete.', 'good');
        },
        onError: (message) => {
          setRunning(false);
          setRunError(message);
          toast(message, 'critical');
        },
        onStreamUnavailable: () => {
          // The run is already under way on the server — the stream request
          // started it. Never retry here; poll for the result instead, or the
          // user pays for two orchestrations.
          setLiveSteps([]);
          setStreamRuns([]);
          setStreamBuffered(true);
          toast('Live progress is unavailable on this deployment — the run is still going.', 'warning');
          const started = Date.now();
          const poll = window.setInterval(() => {
            if (Date.now() - started > 15 * 60 * 1000) {
              window.clearInterval(poll);
              setRunning(false);
              setStreamBuffered(false);
              setRunError('The agent run did not report back in time. Reload to see whether it completed.');
              return;
            }
            void api.getCase(caseData.id).then((updated) => {
              const latest = updated.intelligence?.lastRunAt;
              if (latest && latest !== lastRunAtRef.current) {
                window.clearInterval(poll);
                setRunning(false);
                setStreamBuffered(false);
                void refresh();
                toast('Agent run complete.', 'good');
              }
            });
          }, 5000);
        },
      });
    },
    [caseData.id, caseData.intelligence?.lastRunAt, refresh, toast],
  );

  const handleAsk = useCallback(
    async (question: string) => {
      setAsking(true);
      try {
        await api.askCopilot(caseData.id, question);
        await refresh();
      } finally {
        setAsking(false);
      }
    },
    [caseData.id, refresh],
  );

  const handleClearConversation = useCallback(async () => {
    try {
      await api.clearConversation(caseData.id);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not clear the conversation.', 'critical');
    }
  }, [caseData.id, refresh, toast]);

  const handleExplore = useCallback(async () => {
    setExploring(true);
    setExploreError(null);
    const requested = { maxIterations: exploreMaxIterations, maxCostUsd: exploreMaxCostUsd };
    try {
      const priorIds = new Set((caseData.intelligence?.explorations ?? []).map((s) => s.id));
      const updated = await api.exploreCase(caseData.id, {
        objective: exploreObjective.trim() || undefined,
        maxIterations: requested.maxIterations,
        maxCostUsd: requested.maxCostUsd,
      });
      const newSession = (updated.intelligence?.explorations ?? []).find((s) => !priorIds.has(s.id));
      if (newSession) {
        setRequestedBudgets((prev) => ({ ...prev, [newSession.id]: requested }));
      }
      await refresh();
      toast('Exploration complete.', 'good');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Exploration failed.';
      setExploreError(message);
      toast(message, 'critical');
    } finally {
      setExploring(false);
    }
  }, [caseData.id, caseData.intelligence, exploreMaxCostUsd, exploreMaxIterations, exploreObjective, refresh, toast]);

  const suggestions = useMemo(() => buildSuggestions(caseData, result, intel), [caseData, result, intel]);

  if (capLoading && !capability) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (capError && !capability) {
    return (
      <Callout tone="critical" title="Could not determine agent availability">
        {capError}
      </Callout>
    );
  }

  if (!capability) return null;

  return (
    <div className="flex flex-col gap-4">
      <HeaderCard
        capability={capability}
        intel={intel}
        totalCost={totalCost}
        running={running}
        onRun={() => startRun(selectedAgents.length > 0 ? selectedAgents : undefined)}
        onOpenPicker={() => setPickerOpen(true)}
      />

      {runError ? (
        <Callout tone="critical" title="Agent run failed">
          {runError}
        </Callout>
      ) : null}

      {capability.available ? (
        <AgentPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          enabledAgents={capability.enabledAgents}
          selected={selectedAgents}
          onChange={setSelectedAgents}
          onRun={() => {
            setPickerOpen(false);
            startRun(selectedAgents.length > 0 ? selectedAgents : undefined);
          }}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Copilot"
          subtitle="Ask questions about this case — grounded in its own evidence, never in guesswork"
          icon={<MessageCircle size={16} />}
        />
        <CardBody>
          <CopilotPanel
            conversation={intel.conversation}
            evidence={evidence}
            suggestions={suggestions}
            onAsk={handleAsk}
            onClear={intel.conversation.length > 0 ? handleClearConversation : undefined}
            busy={asking}
            disabled={!capability.available}
            disabledReason={capability.available ? undefined : capabilityReasonText(capability.reason)}
            verification={intel.verification}
          />
        </CardBody>
      </Card>

      <AgentPlanCard plan={intel.plan} actualSpendUsd={totalCost} />

      {intel.cost && intel.cost.perAgent.length > 0 && <CostBreakdown cost={intel.cost} />}

      <KnowledgeSection caseId={caseData.id} ingestions={intel.ingestions ?? []} />

      <InsightsCard insights={intel.insights} evidence={evidence} onOpenEvidence={openEvidence} verification={intel.verification} />

      <PathwaysCard pathways={intel.pathways} evidence={evidence} onOpenEvidence={openEvidence} verification={intel.verification} />

      <ResearchCard findings={intel.research} verification={intel.verification} />

      <VerificationPanel verification={intel.verification} />

      <ExploreControl
        disabled={!capability.available}
        disabledReason={capability.available ? undefined : capabilityReasonText(capability.reason)}
        exploring={exploring}
        objective={exploreObjective}
        onObjectiveChange={setExploreObjective}
        maxIterations={exploreMaxIterations}
        onMaxIterationsChange={setExploreMaxIterations}
        maxCostUsd={exploreMaxCostUsd}
        onMaxCostUsdChange={setExploreMaxCostUsd}
        onExplore={() => void handleExplore()}
        error={exploreError}
      />

      <ExplorationTrail explorations={intel.explorations ?? []} requestedBudgetBySessionId={requestedBudgets} />

      <Card>
        <CardHeader title="Agent runs" subtitle="What each agent did, and what it cost" icon={<Bot size={16} />} />
        <CardBody className="space-y-3">
          {streamBuffered ? (
            <Callout tone="warning" title="Live progress unavailable on this deployment">
              The run is still going on the server — this page is checking for the result every few
              seconds and will update when it lands. Step-by-step progress is not being delivered,
              which usually means something between the browser and the server is buffering the
              event stream.
            </Callout>
          ) : null}
          <AgentRunTimeline runs={allRuns} live={running && !streamBuffered ? liveSteps : undefined} />
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * External sources and cross-case memory, fetched on demand.
 *
 * Not folded into the case payload: both are about the world outside this
 * case, both change independently of it, and loading them with every case
 * read would make the common path pay for the uncommon one.
 */
function KnowledgeSection({ caseId, ingestions }: { caseId: string; ingestions: IngestionReport[] }) {
  const toast = useToast();
  const { data: sources } = useAsync(() => api.caseSources(caseId), [caseId]);
  const { data: memory, refresh: refreshMemory } = useAsync(() => api.caseMemory(caseId), [caseId]);
  const [ingesting, setIngesting] = useState(false);

  const handleIngest = async () => {
    setIngesting(true);
    try {
      const { report, networkRequests } = await api.ingest(caseId);
      const unreachable = report.attempted.filter((a) => a.outcome === 'unreachable').length;
      toast(
        `${report.records.length} record(s) ingested; ${unreachable} source(s) unreachable; ${networkRequests} network request(s).`,
        report.records.length > 0 ? 'good' : 'warning',
      );
      await refreshMemory();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Source check failed.', 'critical');
    } finally {
      setIngesting(false);
    }
  };

  if (!sources && !memory) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sources && (
        <SourcesCard sources={sources} ingestions={ingestions} onIngest={() => void handleIngest()} ingesting={ingesting} />
      )}
      {memory && <MemoryCard recall={memory} />}
    </div>
  );
}
