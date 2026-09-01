import { Link } from 'react-router-dom';
import {
  ACTION_STATUS_LABEL,
  AI_DRAFT_KIND_LABEL,
  AI_DRAFT_STATUS_LABEL,
  ASSESSMENT_STATUS_LABEL,
  CAPABILITY_KIND_LABEL,
  EVIDENCE_STATUS_LABEL,
  LIFECYCLE_STAGE_LABEL,
  assessmentProgress,
  recommendedDdTypes,
  type AiDraftStatus,
  type DdProject,
} from '@realytica/shared';
import { api, evidenceFileUrl } from '../../../lib/api';
import { Badge, Button, Callout, EmptyState, useToast } from '../../../components/ui/kit';
import { formatWhen, severityTone } from '../shared';
import { useAsync } from '../../../lib/useAsync';
import { useBackgroundRun } from '../../../lib/useBackgroundRun';
import { ProjectGraphCanvas } from './ProjectGraphCanvas';
import { LiveRow } from '../LiveRow';

export type { ProjectCockpitPane } from '@realytica/shared';

function draftTone(status: AiDraftStatus) {
  if (status === 'committed') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  if (status === 'accepted' || status === 'in_review') return 'warning' as const;
  return 'neutral' as const;
}

function money(currency: string, n?: number) {
  if (n == null) return '—';
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

function area(n?: number) {
  if (n == null) return '—';
  return `${n.toLocaleString()} sqm`;
}

export function WorkPane({ project, highlightIds }: { project: DdProject; highlightIds?: string[] }) {
  const active = project.assessments.filter((a) => a.status !== 'archived');
  const material = project.findings.filter(
    (f) => (f.status === 'open' || f.status === 'under_review') && (f.severity === 'high' || f.severity === 'critical'),
  );
  const assets = project.assets.filter((a) => !a.parentId);
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">Work</h2>
        <p className="mt-1 text-[12.5px] text-ink-secondary">
          Project facts, assets, DDs and findings. Chat writes here live when you approve an update.
        </p>
      </div>

      {project.lastScreen ? (
        <LiveRow id={`${project.id}:screen`} highlightIds={highlightIds}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Property screen</p>
          <p className="mt-2 text-[13px] font-medium text-ink">{project.lastScreen.headline}</p>
          <p className="mt-1 text-[12.5px] text-ink-secondary">
            {project.lastScreen.verdict.replaceAll('_', ' ')}
            {project.lastScreen.indicatedMid != null
              ? ` · ${project.lastScreen.currency ?? project.currency} ${Math.round(project.lastScreen.indicatedMid).toLocaleString()}`
              : ''}
            {project.lastScreen.completenessScore != null ? ` · completeness ${project.lastScreen.completenessScore}` : ''}
          </p>
        </LiveRow>
      ) : null}

      <LiveRow id={project.id} highlightIds={highlightIds}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Project</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-ink-muted">Owner</dt>
          <dd className="text-ink">{project.owner || '—'}</dd>
          <dt className="text-ink-muted">Developer</dt>
          <dd className="text-ink">{project.developer || '—'}</dd>
          <dt className="text-ink-muted">Stage</dt>
          <dd className="text-ink">{LIFECYCLE_STAGE_LABEL[project.currentStage]}</dd>
          <dt className="text-ink-muted">City</dt>
          <dd className="text-ink">{project.city}</dd>
          <dt className="text-ink-muted">Land</dt>
          <dd className="tabular-nums text-ink">{area(project.landAreaSqm)}</dd>
          <dt className="text-ink-muted">Built-up</dt>
          <dd className="tabular-nums text-ink">{area(project.builtUpAreaSqm)}</dd>
          <dt className="text-ink-muted">Budget</dt>
          <dd className="tabular-nums text-ink">{money(project.currency, project.budget)}</dd>
          <dt className="text-ink-muted">Address</dt>
          <dd className="col-span-1 text-ink">{project.siteAddress || project.location || '—'}</dd>
        </dl>
      </LiveRow>

      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Assets</h3>
        {assets.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">No assets yet. Tell chat to add one, then approve.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {project.assets.map((a) => (
              <li key={a.id}>
                <LiveRow id={a.id} highlightIds={highlightIds} className="p-2.5">
                  <p className="text-[13px] font-medium text-ink">{a.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                    {a.assetType} · {LIFECYCLE_STAGE_LABEL[a.currentStage]}
                    {a.responsible ? ` · ${a.responsible}` : ''}
                  </p>
                </LiveRow>
              </li>
            ))}
          </ul>
        )}
      </div>
      {active.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Start a DD from Due diligence. The orchestrator only recommends templates."
          action={
            <Link to="../dd" className="text-[13px] text-brand">
              Open due diligence
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {active.map((a) => {
            const p = assessmentProgress(a);
            return (
              <li key={a.id}>
                <LiveRow id={a.id} highlightIds={highlightIds}>
                  <Link to={`../dd/${a.id}`} className="block hover:opacity-90">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{a.name}</p>
                      <Badge>{ASSESSMENT_STATUS_LABEL[a.status]}</Badge>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full bg-brand" style={{ width: `${p.percent}%` }} />
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">
                      {p.checkDone}/{p.checkTotal} checks · {p.percent}%
                    </p>
                  </Link>
                </LiveRow>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Material findings</h3>
        {material.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">No high or critical open findings.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {material.map((f) => (
              <li key={f.id}>
                <LiveRow id={f.id} highlightIds={highlightIds} className="flex items-start justify-between gap-2 p-2.5">
                  <span className="text-[13px] text-ink">{f.title}</span>
                  <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                </LiveRow>
              </li>
            ))}
          </ul>
        )}
      </div>
      {project.findings.some((f) => highlightIds?.includes(f.id) && !material.some((m) => m.id === f.id)) ? (
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Updated findings</h3>
          <ul className="mt-2 space-y-2">
            {project.findings
              .filter((f) => highlightIds?.includes(f.id) && !material.some((m) => m.id === f.id))
              .map((f) => (
                <li key={f.id}>
                  <LiveRow id={f.id} highlightIds={highlightIds} className="flex items-start justify-between gap-2 p-2.5">
                    <span className="text-[13px] text-ink">{f.title}</span>
                    <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                  </LiveRow>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Risks</h3>
        {project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted').length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">No open risks. Say “add risk: …” in chat.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {project.risks
              .filter((r) => r.status !== 'closed' && r.status !== 'accepted')
              .map((r) => (
                <li key={r.id}>
                  <LiveRow id={r.id} highlightIds={highlightIds} className="p-2.5">
                    <p className="text-[13px] text-ink">{r.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{r.materiality} · {r.status}</p>
                  </LiveRow>
                </li>
              ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Decisions</h3>
        {project.decisions.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">No decisions yet. Say “add decision: …” in chat.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {project.decisions.map((d) => (
              <li key={d.id}>
                <LiveRow id={d.id} highlightIds={highlightIds} className="p-2.5">
                  <p className="text-[13px] text-ink">{d.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{d.decisionType} · {d.status}</p>
                </LiveRow>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function GraphPane({
  project,
  focusId,
  onSelect,
}: {
  project: DdProject;
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-3 sm:p-4">
      <h2 className="mb-2 shrink-0 text-[15px] font-semibold text-ink">Knowledge graph</h2>
      <ProjectGraphCanvas project={project} focusId={focusId} onSelect={onSelect} />
    </div>
  );
}

export function ActionsPane({
  project,
  onChanged,
  highlightIds,
}: {
  project: DdProject;
  onChanged: () => Promise<void>;
  highlightIds?: string[];
}) {
  const toast = useToast();
  const rows = [...project.actions].sort((a, b) => {
    const ah = highlightIds?.includes(a.id) ? 0 : 1;
    const bh = highlightIds?.includes(b.id) ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return Number(a.status === 'closed') - Number(b.status === 'closed');
  });
  async function close(id: string) {
    try {
      await api.patchAction(project.id, id, 'closed');
      await onChanged();
      toast('Action closed', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not close action', 'critical');
    }
  }
  return (
    <div className="space-y-3 p-4">
      <h2 className="text-[15px] font-semibold text-ink">Actions</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No actions on this project yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <LiveRow id={a.id} highlightIds={highlightIds}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{a.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                      {ACTION_STATUS_LABEL[a.status]}
                      {a.dueDate ? ` · due ${a.dueDate}` : ''}
                      {a.owner ? ` · ${a.owner}` : ''}
                    </p>
                  </div>
                  {a.status !== 'closed' ? (
                    <Button size="sm" variant="ghost" onClick={() => void close(a.id)}>
                      Close
                    </Button>
                  ) : null}
                </div>
              </LiveRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrchestratePane({ project, onChanged }: { project: DdProject; onChanged: () => Promise<void> }) {
  const toast = useToast();
  // The durable run ledger. Its one irreplaceable row is `interrupted`: a
  // model run whose process died used to vanish without a trace, and the
  // person who asked was left telling silence apart from refusal.
  const { data: runLedger, refresh: refreshLedger } = useAsync(() => api.projectRuns(project.id), [project.id, project.updatedAt]);
  // Started, not supervised: the request returns a run id and the work goes
  // on without this tab. Closing the page no longer ends it.
  const background = useBackgroundRun(project.id, 'orchestrate', async (state) => {
    await onChanged();
    await refreshLedger();
    toast(
      state === 'finished'
        ? 'Orchestrator finished — drafts are on the review queue'
        : state === 'interrupted'
          ? 'The orchestrator run was interrupted; nothing was lost, re-run it'
          : 'The orchestrator run failed — see recent runs',
      state === 'finished' ? 'good' : 'warning',
    );
  });
  const recommended = recommendedDdTypes(project.currentStage).filter(
    (d) => !project.assessments.some((a) => a.ddType === d.key && a.status !== 'archived'),
  );
  const latest = [...(project.orchestratorRuns ?? [])].at(-1);
  async function run() {
    try {
      const result = await api.orchestrateProject(project.id);
      await onChanged();
      toast(`${result.drafts.length} draft(s) proposed — review before commit`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Orchestrator failed', 'critical');
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Orchestrator</h2>
          <p className="mt-1 max-w-[52ch] text-[12.5px] text-ink-secondary">
            Plans the next DD move from live registers, then a planner agent can add cards. It proposes; it does not write findings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void run()} disabled={background.busy}>
            Run and wait
          </Button>
          <Button onClick={() => void background.start()} loading={background.busy} disabled={background.busy}>
            {background.busy ? 'Running in background…' : 'Run in background'}
          </Button>
        </div>
      </div>
      {background.busy ? (
        <Callout tone="brand" title="Running in the background">
          {background.line ?? 'Started. You can leave this pane — the run keeps going and the result lands on the registers.'}
          {background.keptAlive === false
            ? ' This deployment does not guarantee work outliving a request, so if the instance is recycled the run will show as interrupted rather than finishing.'
            : ''}
        </Callout>
      ) : null}
      {background.error ? <Callout tone="critical" title="Background run">{background.error}</Callout> : null}
      <Callout title="Manual-first">
        Stage {LIFECYCLE_STAGE_LABEL[project.currentStage]}. AI is optional. Accepting a plan does not start a DD.
      </Callout>
      {recommended.length > 0 ? (
        <p className="text-[13px] text-ink">
          Recommended templates not yet running: {recommended.map((d) => d.label).join(', ')}.
        </p>
      ) : (
        <p className="text-[13px] text-ink-muted">All recommended templates for this stage are instantiated.</p>
      )}
      {latest ? (
        <div className="rounded-lg border border-hairline p-3">
          <p className="text-[13px] font-medium text-ink">{latest.summary}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            {formatWhen(latest.at)} · {latest.draftIds.length} drafts · {latest.evidenceGapCount} evidence gaps ·{' '}
            {latest.openFindingCount} open findings · {latest.source}
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">No orchestrator run yet. Chat “orchestrate” or press the button.</p>
      )}
      {runLedger?.runs.length ? (
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Recent runs</h3>
          <ul className="mt-2 space-y-1.5">
            {runLedger.runs.slice(0, 8).map((row) => (
              <li key={row.id} className="flex items-start gap-2 text-[12.5px] leading-snug">
                <Badge tone={row.state === 'interrupted' ? 'warning' : row.state === 'failed' ? 'critical' : row.state === 'running' ? 'brand' : 'neutral'}>
                  {row.state}
                </Badge>
                <span className="min-w-0 text-ink-secondary">{row.line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {project.capabilityRuns.length ? (
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Capabilities</h3>
          <ul className="mt-2 space-y-2">
            {project.capabilityRuns.map((run) => (
              <li key={run.kind} className="rounded-lg border border-hairline p-2.5">
                <p className="text-[13px] font-medium text-ink">{CAPABILITY_KIND_LABEL[run.kind]}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-secondary">{run.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function DraftsPane({ project, onChanged }: { project: DdProject; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const drafts = [...(project.aiDrafts ?? [])].slice().reverse();
  async function review(id: string, status: 'accepted' | 'rejected') {
    try {
      await api.reviewAiDraft(project.id, id, status);
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not review', 'critical');
    }
  }
  async function commit(id: string) {
    try {
      const result = await api.commitAiDraft(project.id, id);
      await onChanged();
      toast(result.recordId ? 'Committed into the project register' : 'Marked committed (plan / comment)', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not commit', 'critical');
    }
  }
  return (
    <div className="space-y-3 p-4">
      <h2 className="text-[15px] font-semibold text-ink">AI drafts</h2>
      <p className="text-[12.5px] text-ink-secondary">Nothing writes a finding, risk or action until a person commits.</p>
      {drafts.length === 0 ? (
        <EmptyState title="No drafts yet" description="Run the orchestrator or ask chat to propose drafts from registers." />
      ) : (
        drafts.map((d) => (
          <div key={d.id} className="rounded-lg border border-hairline p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-ink">{d.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {AI_DRAFT_KIND_LABEL[d.kind]} · {formatWhen(d.createdAt)}
                </p>
              </div>
              <Badge tone={draftTone(d.status)}>{AI_DRAFT_STATUS_LABEL[d.status]}</Badge>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-ink-secondary">{d.body}</p>
            {d.status !== 'committed' && d.status !== 'rejected' ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => void review(d.id, 'accepted')}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void review(d.id, 'rejected')}>
                  Reject
                </Button>
                <Button size="sm" onClick={() => void commit(d.id)}>
                  Commit
                </Button>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

export function EvidencePane({ project, highlightIds }: { project: DdProject; highlightIds?: string[] }) {
  const rows = [...project.evidence].sort((a, b) => {
    const ah = highlightIds?.includes(a.id) ? 0 : 1;
    const bh = highlightIds?.includes(b.id) ? 0 : 1;
    return ah - bh;
  });
  return (
    <div className="space-y-3 p-4">
      <h2 className="text-[15px] font-semibold text-ink">Evidence</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No evidence on the register yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id}>
              <LiveRow id={e.id} highlightIds={highlightIds}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium text-ink">{e.title}</p>
                  <Badge>{EVIDENCE_STATUS_LABEL[e.status]}</Badge>
                </div>
                {e.attachments.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {e.attachments.map((f) => (
                      <a
                        key={f.id}
                        href={evidenceFileUrl(project.id, e.id, f.id)}
                        className="text-[12px] text-brand underline"
                      >
                        {f.fileName}
                      </a>
                    ))}
                  </div>
                ) : null}
              </LiveRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ValuationPane({ project, onChanged }: { project: DdProject; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const latest = [...project.valuationRuns].filter((r) => r.status !== 'superseded').at(-1);
  async function run() {
    try {
      await api.runValuation(project.id);
      await onChanged();
      toast('Indicative valuation computed', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not run valuation', 'critical');
    }
  }
  async function screen() {
    try {
      await api.runProjectScreen(project.id);
      await onChanged();
      toast('Property screen wrote into registers', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not run property screen', 'critical');
    }
  }
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Valuation</h2>
          <p className="mt-1 text-[12.5px] text-ink-secondary">Indicative only. Not a certified IBBI certificate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void screen()}>
            Run property screen
          </Button>
          <Button onClick={() => void run()}>Run indicative valuation</Button>
        </div>
      </div>
      {project.lastScreen ? (
        <Callout tone="neutral" title={project.lastScreen.verdict.replaceAll('_', ' ')}>
          {project.lastScreen.headline}
        </Callout>
      ) : null}
      {latest ? (
        <div className="rounded-lg border border-hairline p-3">
          <p className="text-[18px] font-semibold tabular-nums text-ink">
            {project.currency} {Math.round(latest.indicatedValue).toLocaleString()}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-secondary">
            {latest.ibbi.premise.replaceAll('_', ' ')} · {latest.signOff.replaceAll('_', ' ')} · {formatWhen(latest.createdAt)}
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">No valuation run yet.</p>
      )}
      <Link to="../valuation" className="text-[13px] text-brand">
        Full valuation workspace
      </Link>
    </div>
  );
}
