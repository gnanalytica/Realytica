import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  Compass,
  CornerDownRight,
  ExternalLink,
  Lock,
  Search,
} from 'lucide-react';
import type { ExplorationLead, ExplorationSession, SourceReachability } from '@realytica/shared';
import { formatUsd } from './AgentRunTimeline';
import { relativeTime } from '../lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, cn, type Tone } from './ui/kit';

/**
 * The explorer's session rendered as a followable trail rather than a report:
 * what it decided to chase and why, what it actually visited and how
 * reachable each source was, and — with real prominence, not a footnote —
 * what it could not reach at all. For Indian property the authoritative
 * registries (Kaveri, Bhoomi, BBMP) sit behind logins and captchas, so a
 * trail that only shows what it *could* reach would imply a completeness it
 * does not have.
 */

const OUTCOME_LABEL: Record<ExplorationLead['outcome'], string> = {
  answered: 'Answered',
  partial: 'Open',
  dead_end: 'Dead end',
};

const OUTCOME_TONE: Record<ExplorationLead['outcome'], Tone> = {
  answered: 'good',
  partial: 'warning',
  dead_end: 'neutral',
};

const REACHABILITY_LABEL: Record<SourceReachability, string> = {
  fetched: 'Fetched',
  blocked_auth: 'Login required',
  blocked_captcha: 'Captcha-blocked',
  not_found: 'Not found',
  rate_limited: 'Rate limited',
};

const REACHABILITY_TONE: Record<SourceReachability, Tone> = {
  fetched: 'good',
  blocked_auth: 'serious',
  blocked_captcha: 'serious',
  not_found: 'neutral',
  rate_limited: 'warning',
};

const STOPPED_LABEL: Record<ExplorationSession['stoppedBecause'], string> = {
  objective_met: 'Objective met',
  budget_exhausted: 'Budget exhausted',
  no_new_leads: 'No new leads',
  error: 'Stopped on error',
};

const STOPPED_TONE: Record<ExplorationSession['stoppedBecause'], Tone> = {
  objective_met: 'good',
  budget_exhausted: 'warning',
  no_new_leads: 'neutral',
  error: 'critical',
};

/** Leads reference each other by id via `spawnedLeadIds` — rebuilt here into a tree for display. */
function buildLeadTree(leads: ExplorationLead[]): { roots: ExplorationLead[]; childrenOf: Map<string, ExplorationLead[]> } {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const childIds = new Set<string>();
  const childrenOf = new Map<string, ExplorationLead[]>();
  for (const lead of leads) {
    for (const childId of lead.spawnedLeadIds) {
      if (childId === lead.id || !byId.has(childId) || childIds.has(childId)) continue;
      childIds.add(childId);
      const arr = childrenOf.get(lead.id) ?? [];
      arr.push(byId.get(childId) as ExplorationLead);
      childrenOf.set(lead.id, arr);
    }
  }
  return { roots: leads.filter((l) => !childIds.has(l.id)), childrenOf };
}

function LeadNode({ lead, childrenOf, depth }: { lead: ExplorationLead; childrenOf: Map<string, ExplorationLead[]>; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const children = childrenOf.get(lead.id) ?? [];
  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-hairline pl-3')}>
      <div className="rounded-lg bg-sunken p-3">
        <button type="button" onClick={() => setExpanded((e) => !e)} className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={expanded}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {depth > 0 ? <CornerDownRight size={12} className="shrink-0 text-ink-muted" aria-hidden="true" /> : null}
              <Badge tone={OUTCOME_TONE[lead.outcome]}>{OUTCOME_LABEL[lead.outcome]}</Badge>
              <span className="text-[13px] font-semibold text-ink">{lead.question}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
              <span className="font-medium text-ink-muted">Why: </span>
              {lead.motivation}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-mini text-ink-muted">{Math.round(lead.confidence * 100)}%</span>
            {expanded ? <ChevronDown size={13} className="text-ink-muted" /> : <ChevronRight size={13} className="text-ink-muted" />}
          </div>
        </button>

        {expanded ? (
          <div className="mt-2.5 flex flex-col gap-2.5 border-t border-hairline pt-2.5">
            {lead.finding ? <p className="text-[13px] leading-relaxed text-ink">{lead.finding}</p> : null}

            {lead.queries.length > 0 ? (
              <div>
                <p className="mb-1 flex items-center gap-1 text-mini font-semibold uppercase tracking-wide text-ink-muted">
                  <Search size={11} /> Queries run
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {lead.queries.map((q, i) => (
                    <li key={i} className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {lead.visited.length > 0 ? (
              <div>
                <p className="mb-1 text-mini font-semibold uppercase tracking-wide text-ink-muted">Sources visited</p>
                <ul className="flex flex-col gap-1">
                  {lead.visited.map((v, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone={REACHABILITY_TONE[v.reachability]}>{REACHABILITY_LABEL[v.reachability]}</Badge>
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 truncate text-brand hover:underline"
                      >
                        <span className="truncate">{v.title ?? v.url}</span>
                        <ExternalLink size={10} className="shrink-0" />
                      </a>
                      {v.note ? <span className="text-ink-muted">— {v.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs italic text-ink-muted">No source was actually fetched for this lead.</p>
            )}

            {children.length > 0 ? (
              <div className="flex flex-col gap-2">
                {children.map((child) => (
                  <LeadNode key={child.id} lead={child} childrenOf={childrenOf} depth={depth + 1} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  defaultOpen,
  requestedBudget,
}: {
  session: ExplorationSession;
  defaultOpen: boolean;
  requestedBudget?: { maxIterations: number; maxCostUsd: number };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { roots, childrenOf } = useMemo(() => buildLeadTree(session.leads), [session.leads]);
  const spentUsd = session.usage?.estimatedCostUsd ?? 0;

  return (
    <Card className="!shadow-none">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STOPPED_TONE[session.stoppedBecause]}>{STOPPED_LABEL[session.stoppedBecause]}</Badge>
            <span className="flex items-center gap-1 text-mini text-ink-muted">
              <Clock size={11} /> {relativeTime(session.startedAt)}
            </span>
          </div>
          <p className="mt-1 text-[13px] font-medium leading-snug text-ink">{session.objective}</p>
        </div>
        {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-ink-muted" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-ink-muted" />}
      </button>

      {open ? (
        <div className="flex flex-col gap-4 border-t border-hairline px-4 py-3.5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">Iterations</div>
              <div className="mt-0.5 text-[15px] font-semibold text-ink">{session.iterations}</div>
            </div>
            <div>
              <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">Leads</div>
              <div className="mt-0.5 text-[15px] font-semibold text-ink">{session.leads.length}</div>
            </div>
            <div>
              <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">Unreachable</div>
              <div className={cn('mt-0.5 text-[15px] font-semibold', session.unreachable.length > 0 ? 'text-serious' : 'text-ink')}>
                {session.unreachable.length}
              </div>
            </div>
            <div>
              <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">Spend</div>
              <div className="mt-0.5 text-[15px] font-semibold text-ink">
                {formatUsd(spentUsd)}
                {requestedBudget ? <span className="font-normal text-ink-muted"> / {formatUsd(requestedBudget.maxCostUsd)} budget</span> : null}
              </div>
            </div>
          </div>

          {/* Unreachable — deliberately placed before the leads, not after, and never muted. */}
          <div className="rounded-lg bg-serious/10 p-3 ring-1 ring-inset ring-serious/40">
            <p className="mb-1.5 flex items-center gap-1.5 text-mini font-semibold uppercase tracking-wide text-ink">
              <Lock size={12} className="text-serious" aria-hidden="true" />
              Not checked ({session.unreachable.length})
            </p>
            {session.unreachable.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-secondary">Nothing this run tried to reach came back blocked.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {session.unreachable.map((u, i) => (
                  <li key={i} className="rounded-md bg-surface p-2 ring-1 ring-inset ring-[var(--ring)]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={REACHABILITY_TONE[u.reachability]}>{REACHABILITY_LABEL[u.reachability]}</Badge>
                      <span className="text-[13px] font-medium text-ink">{u.source}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                      <span className="font-medium text-ink-muted">Would have answered: </span>
                      {u.whatItWouldHaveAnswered}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {roots.length === 0 ? (
            <p className="text-xs italic text-ink-muted">No leads were opened this run.</p>
          ) : (
            <div>
              <p className="mb-2 flex items-center gap-1 text-mini font-semibold uppercase tracking-wide text-ink-muted">
                <Compass size={12} /> Leads followed ({session.leads.length})
              </p>
              <div className="flex flex-col gap-2">
                {roots.map((lead) => (
                  <LeadNode key={lead.id} lead={lead} childrenOf={childrenOf} depth={0} />
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-sunken p-3">
            <p className="mb-1 flex items-center gap-1.5 text-mini font-semibold uppercase tracking-wide text-ink-muted">
              <CircleHelp size={12} /> Open questions ({session.openQuestions.length})
            </p>
            {session.openQuestions.length === 0 ? (
              <p className="text-xs text-ink-secondary">The explorer reported nothing still open.</p>
            ) : (
              <ul className="list-inside list-disc space-y-0.5 text-xs leading-relaxed text-ink-secondary">
                {session.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function ExplorationTrail({
  explorations,
  requestedBudgetBySessionId,
}: {
  explorations: ExplorationSession[];
  /** Budget the UI itself requested for a session it just triggered — unknown (and omitted) for sessions loaded from a prior visit. */
  requestedBudgetBySessionId?: Record<string, { maxIterations: number; maxCostUsd: number }>;
}) {
  const sorted = useMemo(() => [...explorations].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()), [explorations]);

  return (
    <Card>
      <CardHeader
        title="Exploration"
        subtitle="Open-ended web research — what it chased, what it found, and what it could not check at all"
        icon={<Compass size={16} />}
      />
      <CardBody>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Compass size={24} />}
            title="No explorations yet"
            description="Start one below with an objective and a budget — the explorer decides what to look at, follows what it finds, and reports what it could not reach."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((session, i) => (
              <SessionCard key={session.id} session={session} defaultOpen={i === 0} requestedBudget={requestedBudgetBySessionId?.[session.id]} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
