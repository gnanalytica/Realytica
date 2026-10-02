import {
  CAPABILITY_KIND_LABEL,
  recommendedDdTypes,
  type DdProject,
} from '@realytica/shared';
import { api } from '../../../lib/api';
import { Badge, Button, Callout, useToast } from '../../../components/ui/kit';
import { formatWhen } from '../shared';
import { useAsync } from '../../../lib/useAsync';
import { useBackgroundRun } from '../../../lib/useBackgroundRun';
import { ProjectGraphCanvas } from './ProjectGraphCanvas';

export type { ProjectCockpitPane } from '@realytica/shared';

/**
 * Run states in the product's own words rather than the engine's.
 *
 * `finished` is what the run loop calls it; "Completed" is what somebody
 * reading a diligence file expects to see next to a piece of work.
 */
const RUN_STATE_LABEL: Record<string, string> = {
  finished: 'Completed',
  running: 'Running',
  interrupted: 'Interrupted',
  failed: 'Failed',
};

export function GraphPane({
  project,
  focusId,
  onSelect,
  onOpen,
}: {
  project: DdProject;
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-3 sm:p-4">
      <h2 className="mb-2 shrink-0 text-[15px] font-semibold text-ink">Evidence graph</h2>
      <ProjectGraphCanvas project={project} focusId={focusId} onSelect={onSelect} onOpen={onOpen} />
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
        ? 'Finished — drafts are on the review queue'
        : state === 'interrupted'
          ? 'The run was interrupted; nothing was lost, re-run it'
          : 'The run failed — see what it has done',
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
      toast(e instanceof Error ? e.message : 'The run failed', 'critical');
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/*
            One pane in this product was named by the people who built it
            rather than the person using it: "Orchestrator", "Capabilities",
            a "finished" badge. Everywhere else the vocabulary is the one a
            valuer actually uses — findings, evidence, scopes — and a reader
            who has been fluent all the way through the file should not have
            to change register here.
          */}
          <h2 className="text-[15px] font-semibold text-ink">Auto-run plan</h2>
          <p className="mt-0.5 text-[13px] text-ink-secondary">
            Works through what this file still needs and proposes drafts. Nothing is written until you accept it.
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
          <h3 className="text-[12px] font-semibold text-ink-muted">What it has done</h3>
          <ul className="mt-2 space-y-1.5">
            {runLedger.runs.slice(0, 8).map((row) => (
              <li key={row.id} className="flex items-start gap-2 text-[13px] leading-snug">
                {/* The raw state name was rendered straight through, so the
                    list read "finished" in lower case beside sentences. */}
                <Badge tone={row.state === 'interrupted' ? 'warning' : row.state === 'failed' ? 'critical' : row.state === 'running' ? 'brand' : 'neutral'}>
                  {RUN_STATE_LABEL[row.state] ?? row.state}
                </Badge>
                <span className="min-w-0 text-ink-secondary">{row.line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {project.capabilityRuns.length ? (
        <div>
          <h3 className="text-[12px] font-semibold text-ink-muted">What it can check</h3>
          <ul className="mt-2 space-y-2">
            {project.capabilityRuns.map((run) => (
              <li key={run.kind} className="rounded-lg border border-hairline p-2.5">
                <p className="text-[13px] font-medium text-ink">{CAPABILITY_KIND_LABEL[run.kind]}</p>
                <p className="mt-0.5 text-[13px] text-ink-secondary">{run.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

