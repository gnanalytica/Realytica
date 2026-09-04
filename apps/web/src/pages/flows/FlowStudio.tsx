import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { History, Maximize2, Play, Redo2, Save, Undo2 } from 'lucide-react';
import {
  FLOW_NODE_GROUP_LABEL,
  FLOW_NODE_KINDS,
  FLOW_NODE_TYPES,
  type Flow,
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
import { useFlowKeys } from './useFlowKeys';

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
/**
 * How long after the last change autosave fires.
 *
 * Long enough that a drag or a typed name is one save rather than forty, short
 * enough that closing the tab a moment after a change does not lose it.
 */
const AUTOSAVE_DELAY_MS = 1200;

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

  /*
   * The editor, readable from a stable callback.
   *
   * `save` must not be rebuilt on every node move, or the autosave effect
   * would re-arm its timer on every frame of a drag and never fire. Reading
   * the editor through a ref keeps the callback stable while still saving what
   * is on screen rather than what was on screen when the callback was made.
   */
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (loaded.data?.flow) replace(loaded.data.flow);
  }, [loaded.data?.flow, replace]);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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

  /*
   * Editing something that is already running on its own.
   *
   * Worth saying out loud now that changes are kept automatically: an operator
   * who used to have to press Save had a moment to decide, and autosave takes
   * that moment away. A half-drawn flow cannot fire — every trigger is gated
   * on the flow being valid — but a *valid intermediate* one can, and being
   * told beats finding out from the run history.
   */
  const triggerNode = editor.flow.nodes.find((n) => n.kind === 'trigger');
  const startsItself =
    editor.flow.enabled && triggerNode?.config.kind === 'trigger' && triggerNode.config.on !== 'manual';

  /*
   * One save path for both the button and the debounce.
   *
   * `inFlight` rather than the `saveState` used for rendering: state updates
   * are async, so two changes a frame apart would both see 'idle' and fire two
   * PUTs at the same flow. A ref is read synchronously, which is the property
   * the guard needs.
   */
  const inFlight = useRef(false);
  /** The exact flow a save last failed on. See the retry rule in the effect. */
  const lastFailed = useRef<Flow | null>(null);
  const save = useCallback(
    async (mode: 'manual' | 'auto' = 'manual') => {
      if (inFlight.current) return;
      const snapshot = editorRef.current.flow;
      inFlight.current = true;
      setSaveState('saving');
      try {
        const next = await api.saveFlow(snapshot.id, {
          name: snapshot.name,
          description: snapshot.description,
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          enabled: snapshot.enabled,
        });
        editorRef.current.markSaved(next.flow);
        setSaveState('saved');
        // The button is a deliberate act and deserves an answer. Autosave is
        // not: a toast every few seconds while somebody drags nodes around is
        // an interruption, and the "Saved" badge already says it.
        if (mode === 'manual') toast('Saved', 'good');
      } catch (e) {
        setSaveState('error');
        // Remember exactly what failed, so the retry rule below can tell "the
        // server is down" from "they changed something, try again".
        lastFailed.current = snapshot;
        // Reported once wherever it came from. An autosave that failed silently
        // would be worse than no autosave — the operator would believe their
        // work was kept.
        toast(e instanceof Error ? e.message : 'Could not save', 'critical');
      } finally {
        inFlight.current = false;
      }
    },
    [toast],
  );

  /*
   * Autosave.
   *
   * The editor computed `dirty` and badged "Unsaved", and then navigating away
   * discarded the work without a word. A guard dialog would have been the
   * smaller change and the worse one: it asks the operator to do the
   * remembering, every time, for something the app can simply do.
   *
   * Debounced rather than per keystroke, so dragging a node writes one flow
   * rather than forty. It deliberately does *not* wait for the flow to be
   * valid: a half-drawn flow is exactly the state worth keeping, and a broken
   * one cannot be fired by anything — `flowCanRun` gates every trigger.
   */
  useEffect(() => {
    if (!editor.dirty || saveState === 'saving') return;
    /*
     * Never retry the same failure on a timer.
     *
     * Without this the loop is: save fails, state becomes 'error', the effect
     * re-runs because the state changed, and a server that is down gets a PUT
     * every 1.2 seconds until the tab is closed. The next *change* is a new
     * fact and deserves a new attempt; the same bytes failing again do not.
     * Reference equality is exact here because every edit produces a new flow
     * object.
     */
    if (lastFailed.current === editor.flow) return;
    const timer = setTimeout(() => void save('auto'), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [editor.dirty, editor.flow, saveState, save]);

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

  const isProtected = useCallback(
    // A flow cannot exist without its trigger, so Delete on it is a no-op
    // rather than a refusal the person has to read.
    (nodeId: string) => editorRef.current.flow.nodes.find((n) => n.id === nodeId)?.kind === 'trigger',
    [],
  );

  useFlowKeys({
    undo: editor.undo,
    redo: editor.redo,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    selected: editor.selected,
    onDelete: editor.removeNode,
    onDuplicate: editor.duplicateNode,
    onDeselect: () => editor.select(null),
    onSave: () => void save('manual'),
    isProtected,
  });

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
        <SaveStatus dirty={editor.dirty} state={saveState} />
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
        <Button
          size="sm"
          icon={<Save size={13} />}
          loading={saveState === 'saving'}
          disabled={!editor.dirty}
          title="Saves now. Changes are kept automatically a moment after you stop."
          onClick={() => void save('manual')}
        >
          Save
        </Button>
      </div>

      {startsItself ? (
        <Callout tone="warning" title="This flow is live" collapsible>
          It is switched on and starts itself, and your changes are kept automatically — so the next time it fires,
          it fires as it stands here. Turn “Enabled” off while you rework it if that is not what you want.
        </Callout>
      ) : null}

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

/**
 * Where the work stands, in one badge.
 *
 * Four states rather than a spinner, because the question a person has while
 * editing is not "is a request in flight" but "can I close this tab". Only
 * `error` is loud: it is the one case where the answer is no.
 */
function SaveStatus({ dirty, state }: { dirty: boolean; state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'error') return <Badge tone="critical">Not saved</Badge>;
  if (state === 'saving') return <Badge tone="neutral">Saving…</Badge>;
  if (dirty) return <Badge tone="neutral">Unsaved</Badge>;
  if (state === 'saved') return <Badge tone="good">Saved</Badge>;
  return null;
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
        description="Rehearse it against a project and the run is kept here."
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
