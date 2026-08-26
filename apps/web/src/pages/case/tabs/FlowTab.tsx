import { useMemo, useState } from 'react';
import { FileWarning, Network, RefreshCw, ShieldAlert, Workflow } from 'lucide-react';
import type { AgentRun, RunGraph } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
  Stat,
  type Tone,
} from '../../../components/ui/kit';
import {
  Canvas,
  NodeInspector,
  brokenInvariants,
  isModelStep,
  layoutRunGraph,
  ms,
  splitGaps,
  usd,
} from '../../../components/canvas';

/**
 * The flow tab: the orchestration this case actually ran, as a picture.
 *
 * Every other view of the agent layer is a list — runs, calls, costs. A list
 * answers "what happened" but not "what depended on what", and the question a
 * user brings to a surprising result is almost always structural: which step
 * fed the one that got it wrong, and did anything downstream re-run because of
 * it. That is what a canvas is for, and it is the only reason this tab exists.
 *
 * It is deliberately read-only. The orchestrator decides the DAG from the plan
 * and the case's facts; a user rewiring it here would produce a picture that no
 * longer describes anything that ran. So there is no drag-to-connect, no node
 * palette, no delete — pan, zoom, select, read.
 */

export interface FlowTabProps extends TabProps {
  /**
   * The graph, supplied by the workspace's loader.
   *
   * Optional so that `<FlowTab {...tabProps} />` type-checks before the loader
   * exists, and nullable so "no run yet" and "loader has not answered yet" stay
   * distinguishable — they need different words on screen.
   */
  graph?: RunGraph | null;
  loading?: boolean;
  error?: string | null;
}

export default function FlowTab({ caseData, runScreen, running, graph, loading, error }: FlowTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => (graph && graph.nodes.length > 0 ? layoutRunGraph(graph) : null), [graph]);

  /*
   * Runs come from the case aggregate rather than a second fetch. A graph node
   * carries a `runId`; the steps behind it are already on `caseData` whenever
   * an agent has run, so the inspector can show them without the tab owning
   * any data loading of its own.
   */
  const runsById = useMemo(() => {
    const map = new Map<string, AgentRun>();
    for (const run of caseData.intelligence?.runs ?? []) map.set(run.id, run);
    return map;
  }, [caseData.intelligence]);

  const selected = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedId) ?? null,
    [graph, selectedId],
  );

  const summary = useMemo(() => summarise(graph), [graph]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Callout tone="critical" title="Could not load the run graph">
        {error} The runs themselves are unaffected — the Intelligence tab still lists them.
      </Callout>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Workflow size={26} />}
            title={graph ? 'The orchestration recorded no steps' : 'Nothing has been orchestrated yet'}
            description={
              graph
                ? 'A run graph was built for this case but contains no nodes. That means the orchestrator produced a plan and then took no steps — worth checking against the Intelligence tab before reading anything into it.'
                : 'This view draws the agent orchestration for a case: which step ran on which model, what it cost, what it degraded, and what it handed to the step after it. Run the screen to produce one.'
            }
            action={
              graph ? undefined : (
                <Button variant="primary" icon={<RefreshCw size={14} />} loading={running} onClick={runScreen}>
                  Run screen
                </Button>
              )
            }
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Run graph"
          subtitle={`${summary.nodeCount} step${summary.nodeCount === 1 ? '' : 's'} across ${summary.laneCount} layer${summary.laneCount === 1 ? '' : 's'} · built ${new Date(graph.builtAt).toLocaleString('en-GB')}`}
          icon={<Network size={16} />}
          action={<Badge tone={summary.headlineTone}>{summary.headline}</Badge>}
        />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Wall clock" value={ms(graph.totals.durationMs)} hint="start of the first step to the end of the last" />
          <Stat
            label="Spend"
            value={summary.costLabel}
            sub={summary.costSub}
            hint={summary.costHint}
            tone={summary.costTone}
          />
          <Stat
            label="Degraded"
            value={String(graph.totals.degradedNodes)}
            hint={summary.groundingNodes > 0 ? `${summary.groundingNodes} affect grounding` : 'cost only'}
            tone={summary.groundingNodes > 0 ? 'critical' : graph.totals.degradedNodes > 0 ? 'warning' : 'good'}
          />
          <Stat
            label="Failed"
            value={String(graph.totals.failedNodes)}
            hint={graph.totals.failedNodes === summary.nodeCount && summary.nodeCount > 0 ? 'every step' : 'of the steps drawn'}
            tone={graph.totals.failedNodes > 0 ? 'critical' : 'good'}
          />
        </CardBody>
      </Card>

      {/*
       * The two banners the model-ops page uses, kept word-for-word in spirit:
       * a weakened guardrail and a missing citation are not row-level details,
       * they change how every finding on the case should be read.
       */}
      {summary.guardrailNodes > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-critical" />
          <p className="text-xs leading-relaxed text-ink">
            <span className="font-semibold">
              {summary.guardrailNodes} step{summary.guardrailNodes === 1 ? '' : 's'} ran under a prompt version that
              dropped a guardrail.
            </span>{' '}
            Those checks are what forbid inventing a document, a statute or a figure. Output from the ringed nodes was
            produced under weakened anti-fabrication rules and should be verified against the source.
          </p>
        </div>
      )}

      {summary.groundingNodes > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40">
          <FileWarning size={15} className="mt-0.5 shrink-0 text-critical" />
          <p className="text-xs leading-relaxed text-ink">
            <span className="font-semibold">
              {summary.groundingNodes} step{summary.groundingNodes === 1 ? '' : 's'} ran without verified grounding.
            </span>{' '}
            They returned answers, and the answers may be right — but page references on the fields they produced are
            self-reported rather than checked against the document.
          </p>
        </div>
      )}

      {layout && layout.danglingEdges > 0 && (
        <Callout tone="warning" title="The picture is incomplete">
          {layout.danglingEdges} edge{layout.danglingEdges === 1 ? '' : 's'} in this graph point at a step that is not
          in it, so {layout.danglingEdges === 1 ? 'it is' : 'they are'} not drawn.
        </Callout>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1">
          {layout ? (
            <Canvas
              layout={layout}
              selectedId={selectedId}
              onSelect={setSelectedId}
              runsById={runsById}
              ariaLabel={`Run graph for ${caseData.reference}: ${summary.nodeCount} steps. Drag to pan, scroll to zoom, arrow keys to pan, plus and minus to zoom, F to fit, Escape to deselect.`}
              className="h-[68vh] min-h-[420px] max-h-[780px]"
            />
          ) : null}
          <Legend />
        </div>

        <NodeInspector
          node={selected}
          run={selected?.runId ? runsById.get(selected.runId) ?? null : null}
          totalDurationMs={graph.totals.durationMs}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-ink-secondary">
      <LegendEdge label="Ran after" colour="var(--axis)" />
      <LegendEdge label="Fed data to" colour="var(--brand)" />
      <LegendEdge label="Caused a re-run" colour="var(--status-serious)" dashed />
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-1.5 rounded-sm" style={{ background: 'var(--status-critical)' }} />
        Failed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="mx-0.5 inline-block h-3 w-3 rounded-[3px] outline outline-2 outline-offset-2 outline-critical" />
        Guardrail dropped
      </span>
    </div>
  );
}

function LegendEdge({ label, colour, dashed }: { label: string; colour: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={22} height={8} aria-hidden="true">
        <line
          x1={0}
          y1={4}
          x2={22}
          y2={4}
          stroke={colour}
          strokeWidth={1.75}
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

interface FlowSummary {
  nodeCount: number;
  laneCount: number;
  groundingNodes: number;
  guardrailNodes: number;
  costLabel: string;
  costHint: string;
  /**
   * The qualification that must be *read*, not hovered.
   *
   * `Stat` renders `hint` as a `title` attribute only, which is a hover
   * tooltip and therefore nothing at all on a touch screen. A spend figure
   * that is a lower bound cannot have "lower bound" hidden behind a hover —
   * that is a total presented as exact to most of the people who will see it.
   * Set only when the figure is qualified; `Stat` shows `sub` on its own line.
   */
  costSub?: string;
  costTone: Tone;
  headline: string;
  headlineTone: Tone;
}

/**
 * The four numbers above the canvas.
 *
 * Cost is the fiddly one. `totals.costUsd` is absent whenever *any* node could
 * not be priced, which is correct of the contract and useless as a headline —
 * a reader still wants to know roughly what the run cost. So the priced nodes
 * are summed and the figure is labelled a lower bound with the shortfall named,
 * which is the same rule the model-ops page applies to its pricing coverage.
 * What is never done is presenting an unpriced route as zero.
 */
function summarise(graph: RunGraph | null | undefined): FlowSummary {
  if (!graph) {
    return {
      nodeCount: 0,
      laneCount: 0,
      groundingNodes: 0,
      guardrailNodes: 0,
      costLabel: '—',
      costHint: '',
      costSub: undefined,
      costTone: 'neutral',
      headline: 'No run',
      headlineTone: 'neutral',
    };
  }

  let groundingNodes = 0;
  let guardrailNodes = 0;
  let pricedSum = 0;
  let unpricedSteps = 0;

  for (const node of graph.nodes) {
    if (splitGaps(node.capabilityGaps).grounding.length > 0) groundingNodes += 1;
    if (brokenInvariants(node).length > 0) guardrailNodes += 1;
    if (node.costUsd !== undefined) pricedSum += node.costUsd;
    else if (isModelStep(node)) unpricedSteps += 1;
  }

  const exact = graph.totals.costUsd;
  /*
   * When nothing on the graph could be priced, the lower bound is zero — and
   * "$0" is precisely the answer this product must not give, because a reader
   * will take it as "the run was free" rather than "nobody knows". An em dash
   * with the shortfall named is the only honest rendering.
   */
  const nothingPriced = exact === undefined && pricedSum === 0;
  // The "at least" is in the figure itself, so a screenshot of this number
  // cannot be mistaken for the total even with the caption cropped off.
  const costLabel = nothingPriced
    ? '—'
    : exact !== undefined
      ? usd(exact) ?? '—'
      : `≥ ${usd(pricedSum) ?? '—'}`;
  const costHint =
    exact !== undefined
      ? 'estimated from published rates'
      : nothingPriced
        ? `no rates declared for ${unpricedSteps === 1 ? 'the one model step' : `any of the ${unpricedSteps} model steps`}`
        : unpricedSteps > 0
          ? `lower bound — ${unpricedSteps} step${unpricedSteps === 1 ? '' : 's'} unpriced`
          : 'lower bound — some steps unpriced';

  const laneCount = new Set(graph.nodes.map((n) => n.lane)).size;

  const headline =
    guardrailNodes > 0
      ? 'Guardrail dropped'
      : graph.totals.failedNodes > 0
        ? `${graph.totals.failedNodes} failed`
        : groundingNodes > 0
          ? 'Grounding degraded'
          : graph.totals.degradedNodes > 0
            ? `${graph.totals.degradedNodes} degraded`
            : 'Clean run';

  const headlineTone: Tone =
    guardrailNodes > 0 || graph.totals.failedNodes > 0 || groundingNodes > 0
      ? 'critical'
      : graph.totals.degradedNodes > 0
        ? 'warning'
        : 'good';

  return {
    nodeCount: graph.nodes.length,
    laneCount,
    groundingNodes,
    guardrailNodes,
    costLabel,
    costHint,
    costSub: exact === undefined ? costHint : undefined,
    costTone: exact === undefined ? 'warning' : 'neutral',
    headline,
    headlineTone,
  };
}
