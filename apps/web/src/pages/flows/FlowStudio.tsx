import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { History, Maximize2, Play, Redo2, Save, Undo2 } from 'lucide-react';
import {
  FLOW_NODE_GROUP_LABEL,
  FLOW_NODE_KINDS,
  FLOW_NODE_TYPES,
  type FlowNodeKind,
  type FlowRunRecord,
  type FlowRunSummary,
} from '@realytica/shared';
import { api, type FlowCatalogue } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Callout, Card, CardBody, EmptyState, Input, Select, Skeleton, Spinner, Tabs, Toggle, cn, useToast } from '../../components/ui/kit';
import { nextSpot } from './geometry';
import { FlowCanvas } from './FlowCanvas';
import { NodeInspector } from './NodeInspector';
import { useFlowEditor } from './useFlowEditor';

/**
 * The studio: palette, canvas, inspector, and what happened when it ran.
 *
 * Three columns because the three questions are asked in that order — what can
 * I add, what does this look like, what is this one node set to do — and a
 * canvas that hides the inspector behind a click makes the third question cost
 * a round trip through the second.
 *
 * Running is a rehearsal by default and the button says so. The choice is a
 * toggle rather than a second button, because two adjacent buttons where one
 * costs money and the other does not is the arrangement people mis-click.
 */
export default function FlowStudio() {
  const { flowId } = useParams<{ flowId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const loaded = useAsync(() => api.getFlow(flowId!), [flowId]);
  const cat = useAsync(() => api.flowCatalogue(), []);
  const projects = useAsync(() => api.listProjects(), []);
  const catalogue: FlowCatalogue | null = cat.data ?? null;

  const editor = useFlowEditor(
    loaded.data?.flow ?? {
      id: flowId ?? '',
      tenantId: '',
      name: '',
      nodes: [],
      edges: [],
      enabled: false,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
      version: 0,
    },
  );
  const { replace } = editor;

  useEffect(() => {
    if (loaded.data?.flow) replace(loaded.data.flow);
  }, [loaded.data?.flow, replace]);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [result, setResult] = useState<FlowRunRecord | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [panel, setPanel] = useState<'run' | 'history'>('run');
  const [history, setHistory] = useState<FlowRunSummary[] | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  /**
   * The history is fetched when the tab is first opened, not on mount.
   *
   * A flow being edited is usually a flow nobody is asking about the past of,
   * and paying for fifty summaries on every open would be a request per canvas
   * visit for a panel most visits never look at.
   */
  const refreshHistory = useCallback(async () => {
    if (!flowId) return;
    try {
      setHistory(await api.flowRuns(flowId));
    } catch {
      // A history that will not load must not break the canvas. The panel says
      // so itself; the flow is still editable and still runnable.
      setHistory([]);
    }
  }, [flowId]);

  useEffect(() => {
    if (panel === 'history' && history === null) void refreshHistory();
  }, [panel, history, refreshHistory]);

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const ran = useMemo(() => {
    const map = new Map<string, 'ok' | 'skipped' | 'failed'>();
    for (const step of result?.steps ?? []) map.set(step.nodeId, step.status);
    return map;
  }, [result]);

  const errors = editor.problems.filter((p) => p.severity === 'error');
  const selectedNode = editor.flow.nodes.find((n) => n.id === editor.selected) ?? null;

  async function save() {
    setSaving(true);
    try {
      const next = await api.saveFlow(editor.flow.id, {
        name: editor.flow.name,
        description: editor.flow.description,
        nodes: editor.flow.nodes,
        edges: editor.flow.edges,
        enabled: editor.flow.enabled,
      });
      editor.markSaved(next.flow);
      toast('Saved', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'critical');
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!projectId) {
      toast('Choose a project to run this against', 'warning');
      return;
    }
    setRunning(true);
    try {
      const out = await api.runFlow(editor.flow.id, { projectId, dryRun });
      setResult(out);
      setPanel('run');
      // The run just became part of the history, so a stale list would show
      // everything except the thing that just happened.
      if (history !== null) void refreshHistory();
      toast(out.status === 'ok' ? (out.dryRun ? 'Rehearsed' : 'Ran') : `Finished ${out.status.replace('_', ' ')}`, out.status === 'ok' ? 'good' : 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not run', 'critical');
    } finally {
      setRunning(false);
    }
  }

  /** Open a past run in the trace panel — the same view a fresh run lands in. */
  async function openRun(runId: string) {
    setLoadingRun(true);
    try {
      const run = await api.flowRun(runId);
      setResult(run);
      setPanel('run');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open that run', 'critical');
    } finally {
      setLoadingRun(false);
    }
  }

  if (loaded.error) return <Callout tone="critical" title="Could not open this flow">{loaded.error}</Callout>;
  if (loaded.loading && !loaded.data) return <Skeleton className="h-[70vh] w-full" />;

  return (
    <div className="flex h-[calc(100dvh-112px)] min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={editor.flow.name}
          aria-label="Flow name"
          className="w-64 font-medium"
          onChange={(e) => editor.rename(e.target.value)}
        />
        <Toggle checked={editor.flow.enabled} onChange={editor.setEnabled} label="Enabled" />
        {editor.dirty ? <Badge tone="warning">Unsaved</Badge> : null}
        {errors.length > 0 ? <Badge tone="critical">{errors.length} to fix</Badge> : null}

        <div className="flex-grow" />

        <Button size="sm" variant="ghost" icon={<Maximize2 size={13} />} title="Put the whole flow back on screen" onClick={() => setFitNonce((n) => n + 1)}>Fit</Button>
        <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={!editor.canUndo} onClick={editor.undo}>Undo</Button>
        <Button size="sm" variant="ghost" icon={<Redo2 size={13} />} disabled={!editor.canRedo} onClick={editor.redo}>Redo</Button>

        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Run against" className="w-52">
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.reference} · {p.name}</option>
          ))}
        </Select>
        <Toggle checked={dryRun} onChange={setDryRun} label="Rehearse" size="sm" />
        <Button
          size="sm"
          variant={dryRun ? 'secondary' : 'primary'}
          icon={<Play size={13} />}
          loading={running}
          disabled={errors.length > 0}
          title={errors.length > 0 ? 'Fix the errors first' : dryRun ? 'Reaches nothing and spends nothing' : 'This will call models and reach outside'}
          onClick={() => void run()}
        >
          {dryRun ? 'Rehearse' : 'Run for real'}
        </Button>
        <Button size="sm" icon={<Save size={13} />} loading={saving} disabled={!editor.dirty} onClick={() => void save()}>Save</Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <Palette onAdd={(kind) => editor.addNode(kind, nextSpot(editor.flow, editor.selected))} />

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-hairline">
          <FlowCanvas
            flow={editor.flow}
            selected={editor.selected}
            problems={editor.problems}
            ran={result ? ran : undefined}
            reveal={editor.selected}
            fitNonce={fitNonce}
            onSelect={editor.select}
            onMove={editor.dragNode}
            onMoveEnd={editor.endDrag}
            onConnect={editor.connect}
            onDisconnect={editor.disconnect}
            onDropKind={(kind, at) => editor.addNode(kind, at)}
            onDelete={editor.removeNode}
          />
        </div>

        <div className="hidden w-[22rem] shrink-0 overflow-hidden rounded-xl border border-hairline bg-surface lg:block">
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              catalogue={catalogue}
              problems={editor.problems}
              projects={projects.data ?? []}
              onChange={(patch) => editor.updateNode(selectedNode.id, patch)}
              onDelete={() => editor.removeNode(selectedNode.id)}
              onDuplicate={() => editor.duplicateNode(selectedNode.id)}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="px-2 pt-2">
                <Tabs
                  active={panel}
                  onChange={(key) => setPanel(key as 'run' | 'history')}
                  tabs={[
                    { key: 'run', label: result ? (result.dryRun ? 'Rehearsal' : 'Run') : 'Run' },
                    { key: 'history', label: 'History' },
                  ]}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {panel === 'history' ? (
                  <RunHistory
                    runs={history}
                    activeRunId={result?.id}
                    loading={loadingRun}
                    onOpen={(runId) => void openRun(runId)}
                  />
                ) : result ? (
                  <RunTrace result={result} onClose={() => setResult(null)} />
                ) : (
                  <div className="p-4 text-[12.5px] text-ink-muted">
                    <p className="font-medium text-ink">Nothing selected.</p>
                    <p className="mt-1">Drag a node from the left onto the canvas, or click one to set it up.</p>
                    <p className="mt-3">A rehearsal reaches nothing and spends nothing. Turn “Rehearse” off only when you mean it.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (kind: FlowNodeKind) => void }) {
  const groups = ['start', 'think', 'read', 'route', 'write'] as const;
  return (
    <div className="hidden w-52 shrink-0 overflow-y-auto rounded-xl border border-hairline bg-surface p-2 md:block">
      {groups.map((group) => {
        const kinds = FLOW_NODE_KINDS.filter((k) => FLOW_NODE_TYPES[k].group === group);
        if (kinds.length === 0) return null;
        return (
          <div key={group} className="mb-2">
            <p className="px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {FLOW_NODE_GROUP_LABEL[group]}
            </p>
            {kinds.map((kind) => {
              const type = FLOW_NODE_TYPES[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-flow-node', kind)}
                  onClick={() => onAdd(kind)}
                  title={type.summary}
                  className={cn(
                    'mb-1 w-full cursor-grab rounded-lg border border-hairline px-2 py-1.5 text-left hover:bg-sunken',
                    'active:cursor-grabbing',
                  )}
                >
                  <p className="text-[12.5px] font-medium text-ink">{type.label}</p>
                  <p className="line-clamp-2 text-[11px] text-ink-muted">{type.summary}</p>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** How a run started, said the way somebody would say it. */
const TRIGGER_LABEL: Record<FlowRunSummary['trigger'], string> = {
  manual: 'by hand',
  project_created: 'a project was created',
  evidence_uploaded: 'evidence was uploaded',
  assessment_started: 'an assessment started',
  schedule: 'on schedule',
};

function runTone(status: FlowRunSummary['status']): 'good' | 'warning' | 'critical' {
  if (status === 'failed') return 'critical';
  if (status === 'cut_short') return 'warning';
  return 'good';
}

/** A date somebody can place without doing arithmetic. */
function when(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Every run this flow has had, newest first.
 *
 * The question this answers is "when did it start failing", so the list leads
 * with outcome and time rather than with a run id nobody memorises. A
 * rehearsal is marked, because a history where a rehearsal and a real run look
 * alike would report cost that was never spent.
 */
function RunHistory({
  runs,
  activeRunId,
  loading,
  onOpen,
}: {
  runs: FlowRunSummary[] | null;
  activeRunId?: string;
  loading: boolean;
  onOpen: (runId: string) => void;
}) {
  if (runs === null) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<History size={20} />}
        title="This flow has not run yet"
        description="Rehearse it against a project and the run will be kept here — what fired it, what each node decided, and what it proposed."
      />
    );
  }

  return (
    <div className="space-y-1.5 p-3">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          disabled={loading}
          onClick={() => onOpen(run.id)}
          className={cn(
            'w-full rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-sunken disabled:opacity-60',
            run.id === activeRunId ? 'border-brand bg-brand-soft' : 'border-hairline',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[12.5px] font-medium text-ink">{when(run.startedAt)}</p>
            <div className="flex shrink-0 items-center gap-1">
              {run.dryRun ? <Badge tone="neutral">rehearsal</Badge> : null}
              <Badge tone={runTone(run.status)}>{run.status.replace('_', ' ')}</Badge>
            </div>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-ink-muted">
            {TRIGGER_LABEL[run.trigger]} · {run.startedBy} · {run.stepCount} step{run.stepCount === 1 ? '' : 's'}
            {run.failedCount > 0 ? ` · ${run.failedCount} failed` : ''}
            {run.proposalCount > 0 ? ` · ${run.proposalCount} proposed` : ''}
          </p>
        </button>
      ))}
    </div>
  );
}

function RunTrace({ result, onClose }: { result: FlowRunRecord; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-ink">{result.dryRun ? 'Rehearsal' : 'Run'}</p>
          <p className="text-[11.5px] text-ink-muted">
            {when(result.startedAt)} · {TRIGGER_LABEL[result.trigger]} · {result.steps.length} step(s) ·{' '}
            {result.status.replace('_', ' ')}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>

      {result.stoppedBecause ? (
        <div className="mt-2">
          <Callout tone="warning" title="It stopped early">{result.stoppedBecause}</Callout>
        </div>
      ) : null}

      <div className="mt-2 space-y-1.5">
        {result.steps.map((step, i) => (
          <div key={i} className="rounded-lg border border-hairline px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[12.5px] font-medium text-ink">{step.label}</p>
              <Badge tone={step.status === 'failed' ? 'critical' : step.status === 'skipped' ? 'neutral' : 'good'}>{step.status}</Badge>
            </div>
            {step.detail ? <p className="mt-0.5 text-[11.5px] text-ink-secondary">{step.detail}</p> : null}
          </div>
        ))}
      </div>

      {result.proposals.length > 0 ? (
        <Card className="mt-3">
          <CardBody className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Proposed</p>
            {result.proposals.map((p, i) => (
              <div key={i}>
                <p className="text-[12.5px] text-ink">{p.title}</p>
                <p className="text-[11px] text-ink-muted">a {p.draft.replace(/_/g, ' ')} · nobody has accepted this</p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
