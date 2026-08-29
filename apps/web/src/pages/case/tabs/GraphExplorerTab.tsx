import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Camera, FileText, HelpCircle, History, Lightbulb, Maximize2, MessageSquare, Minus, Plus, Search, Waypoints, X } from 'lucide-react';
import { DD_DOMAIN_PROFILES, buildDdGraph, findNodes, trace } from '@realytica/shared';
import type { DdEdge, DdGraph, DdLayer, DdNode, DdSubgraph } from '@realytica/shared';
import { api } from '../../../lib/api';
import { Badge, Button, Callout, Input, Select, cn } from '../../../components/ui/kit';
import { computeFit, zoomAbout, MAX_ZOOM, MIN_ZOOM } from '../../../components/canvas/Canvas';
import type { Transform } from '../../../components/canvas/Canvas';
import { useMeasure } from '../../../components/charts/primitives';
import { titleCase } from '../../../lib/format';
import type { TabProps } from '../tab-props';

/**
 * The evidence graph, drawn.
 *
 * Four columns, one per layer of the DD ontology — what exists, what we
 * hold, what the evidence says, what we conclude — with every edge the
 * projection built. Selecting a node opens its derivation cone (`trace`),
 * which is the same query the copilot's trace_conclusion tool runs: the
 * picture and the model read one structure.
 *
 * The graph is built HERE, from the case the client already holds. It is a
 * deterministic projection, not a store, so fetching it from the API would
 * only round-trip data this page has — the same reason the copilot builds it
 * server-side from the same inputs.
 */

const LAYERS: DdLayer[] = ['entity', 'evidence', 'claim', 'judgement', 'deliberation'];

const LAYER_LABEL: Record<DdLayer, string> = {
  entity: 'What exists',
  evidence: 'What we hold',
  claim: 'What it says',
  judgement: 'What we conclude',
  deliberation: 'How we got here',
};

const NODE_W = 208;
const NODE_H = 46;
const ROW_GAP = 10;
const COL_GAP = 36;
const LANE_GAP = 110;
const MAX_ROWS = 16;
const PADDING = 40;
const LANE_HEADER = 30;

type Tone = 'critical' | 'serious' | 'warning' | 'brand' | 'neutral';

function nodeTone(n: DdNode): Tone {
  // Deliberation carries no severity. Tone means "how bad is this finding",
  // and painting a question amber because it mentions one would report a
  // problem the case does not have.
  if (n.layer === 'deliberation') return 'neutral';
  if (n.kind === 'contradiction') return 'critical';
  const sev = n.attributes.severity;
  const verdict = n.attributes.verdict;
  if (sev === 'critical' || verdict === 'blocker') return 'critical';
  if (sev === 'serious') return 'serious';
  if (sev === 'warning' || verdict === 'attention') return 'warning';
  if (n.layer === 'claim') return 'brand';
  return 'neutral';
}

const TONE_ACCENT: Record<Tone, string> = {
  critical: 'var(--status-critical)',
  serious: 'var(--status-serious)',
  warning: 'var(--status-warning)',
  brand: 'var(--brand)',
  neutral: 'var(--axis)',
};

interface PlacedNode {
  node: DdNode;
  x: number;
  y: number;
}

interface ExplorerLayout {
  nodes: PlacedNode[];
  lanes: { layer: DdLayer; x: number; width: number; count: number }[];
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Four lanes, wrapped into sub-columns past MAX_ROWS, every node on a shared
 * row grid — the run-canvas layout recipe, re-derived for a graph whose lanes
 * are ontology layers rather than execution steps. Ordering inside a lane is
 * domain, then kind, then label: deterministic, and it clusters a department's
 * nodes so the eye can follow a domain down the column.
 */
function layoutDdGraph(graph: DdGraph): ExplorerLayout {
  const placed: PlacedNode[] = [];
  const lanes: ExplorerLayout['lanes'] = [];
  const pitch = NODE_H + ROW_GAP;
  let cursorX = PADDING;
  let maxRows = 0;

  const pending: { x: number; nodes: DdNode[] }[] = [];
  LAYERS.forEach((layer, ordinal) => {
    const laneNodes = graph.nodes
      .filter(n => n.layer === layer)
      .sort((a, b) =>
        (a.domain ?? '~').localeCompare(b.domain ?? '~') ||
        a.kind.localeCompare(b.kind) ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
      );
    const columnCount = Math.max(1, Math.ceil(laneNodes.length / MAX_ROWS));
    const perColumn = Math.max(1, Math.ceil(laneNodes.length / columnCount));
    if (ordinal > 0) cursorX += LANE_GAP;
    const laneX = cursorX;
    for (let c = 0; c < columnCount; c += 1) {
      if (c > 0) cursorX += COL_GAP;
      const slice = laneNodes.slice(c * perColumn, (c + 1) * perColumn);
      pending.push({ x: cursorX, nodes: slice });
      maxRows = Math.max(maxRows, slice.length);
      cursorX += NODE_W;
    }
    lanes.push({ layer, x: laneX, width: cursorX - laneX, count: laneNodes.length });
  });

  const top = PADDING + LANE_HEADER;
  for (const column of pending) {
    const offset = Math.floor((maxRows - column.nodes.length) / 2);
    column.nodes.forEach((node, i) => {
      placed.push({ node, x: column.x, y: top + (offset + i) * pitch });
    });
  }

  return {
    nodes: placed,
    lanes,
    bounds: {
      x: 0,
      y: 0,
      width: Math.max(cursorX + PADDING, PADDING * 2),
      height: Math.max(top + maxRows * pitch - ROW_GAP + PADDING, PADDING * 2),
    },
  };
}

function edgePath(from: PlacedNode, to: PlacedNode): string {
  // Leave from the side facing the target, arrive on the side facing the
  // source — with four fixed lanes most edges run between columns, and a
  // horizontal-tangent cubic keeps them out of the nodes' own text.
  const forward = to.x >= from.x + NODE_W;
  const backward = to.x + NODE_W <= from.x;
  const sy = from.y + NODE_H / 2;
  const ty = to.y + NODE_H / 2;
  if (forward || backward) {
    const sx = forward ? from.x + NODE_W : from.x;
    const tx = forward ? to.x : to.x + NODE_W;
    const bend = Math.max(24, Math.abs(tx - sx) * 0.4) * (forward ? 1 : -1);
    return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
  }
  // Same column (produces/mitigates inside the judgement lane): bow out right.
  const x = from.x + NODE_W;
  const bow = 44 + Math.min(40, Math.abs(ty - sy) * 0.15);
  return `M ${x} ${sy} C ${x + bow} ${sy}, ${x + bow} ${ty}, ${x} ${ty}`;
}

export default function GraphExplorerTab({ caseData, result }: TabProps) {
  const derived = useMemo(() => buildDdGraph(caseData, caseData.updatedAt), [caseData]);

  /*
   * Annotations come from the STORE; everything else is built here.
   *
   * The derived half is a pure projection of the case the client already
   * holds, so fetching it would be a round trip for data in memory — the
   * canvas draws immediately. Annotations cannot be derived from anything:
   * they were written into the graph and live only there, so they are fetched
   * and merged in when they arrive. A failed fetch leaves the canvas correct
   * and short of notes rather than empty.
   */
  const [authored, setAuthored] = useState<{ nodes: DdNode[]; edges: DdEdge[] }>({ nodes: [], edges: [] });
  useEffect(() => {
    let live = true;
    api
      .caseGraph(caseData.id)
      .then(({ graph: stored }) => {
        if (!live || !stored) return;
        const nodes = stored.nodes.filter(n => n.origin === 'authored');
        const ids = new Set(nodes.map(n => n.id));
        setAuthored({
          nodes,
          edges: stored.edges.filter(e => ids.has(e.fromNodeId) || ids.has(e.toNodeId)),
        });
      })
      .catch(() => {
        /* the graph store is unreachable; the derived canvas is still correct */
      });
    return () => {
      live = false;
    };
  }, [caseData.id, caseData.updatedAt]);

  /*
   * As-of: the one question only the store can answer.
   *
   * The projection above knows what the case says NOW — it is rebuilt from
   * the case on every render, so it cannot represent a past state however it
   * is filtered. The store can, because a sync closes an edge rather than
   * deleting it. So this is not a filter over the live graph: setting a date
   * REPLACES the canvas with what the store returns for that instant, and
   * clearing it goes back to the projection.
   *
   * Mixing the two would be worse than not having it. A past graph drawn
   * with today's nodes merged in is a picture of a moment that never
   * existed, and the whole reason to ask "what did we believe when we signed
   * the March report" is that the answer has to be defensible.
   */
  const [asOf, setAsOf] = useState<string>('');
  const [past, setPast] = useState<DdGraph | null>(null);
  const [pastState, setPastState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  useEffect(() => {
    if (!asOf) {
      setPast(null);
      setPastState('idle');
      return;
    }
    let live = true;
    setPastState('loading');
    // End of the chosen day: a date alone means "as things stood that day",
    // and asking at 00:00 would answer for the day before.
    api
      .caseGraph(caseData.id, `${asOf}T23:59:59.999Z`)
      .then(({ graph: stored }) => {
        if (!live) return;
        setPast(stored);
        setPastState(stored ? 'idle' : 'unavailable');
      })
      .catch(() => {
        if (!live) return;
        setPast(null);
        setPastState('unavailable');
      });
    return () => {
      live = false;
    };
  }, [caseData.id, asOf]);

  const live = useMemo(() => {
    if (authored.nodes.length === 0) return derived;
    const have = new Set(derived.nodes.map(n => n.id));
    // An edge to a node this build does not have is dropped, the same rule the
    // projection applies: a note pointing at something no longer on the case
    // is a dangling citation, and the note itself is still shown.
    const nodes = [...derived.nodes, ...authored.nodes.filter(n => !have.has(n.id))];
    const all = new Set(nodes.map(n => n.id));
    return {
      ...derived,
      nodes,
      edges: [...derived.edges, ...authored.edges.filter(e => all.has(e.fromNodeId) && all.has(e.toNodeId))],
    };
  }, [derived, authored]);
  const graph = past ?? live;
  const historic = past !== null;
  const layout = useMemo(() => layoutDdGraph(graph), [graph]);
  const placedById = useMemo(() => new Map(layout.nodes.map(p => [p.node.id, p])), [layout]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [query, setQuery] = useState('');

  /*
   * Chat can address this canvas: a cited-node chip navigates to
   * ?view=graph&node=<id>, and the explorer opens focused on that node. The
   * param is consumed once — cleared after selecting — so it deep-links a
   * moment, not a permanent selection the reader cannot shake off.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedNode = searchParams.get('node');
  useEffect(() => {
    if (!requestedNode) return;
    if (graph.nodes.some(n => n.id === requestedNode)) setSelectedId(requestedNode);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('node');
      return next;
    }, { replace: true });
  }, [requestedNode, graph, setSearchParams]);

  const selected = selectedId ? graph.nodes.find(n => n.id === selectedId) ?? null : null;
  const cone: DdSubgraph | undefined = useMemo(
    () => (selectedId ? trace(graph, selectedId) : undefined),
    [graph, selectedId],
  );
  const coneIds = useMemo(() => new Set(cone?.nodes.map(n => n.id) ?? []), [cone]);
  const coneEdgeIds = useMemo(() => new Set(cone?.edges.map(e => e.id) ?? []), [cone]);

  const matches = useMemo(() => (query.trim() ? findNodes(graph, query).slice(0, 8) : []), [graph, query]);

  /*
   * Emphasis, not filtration. A domain filter that removed other domains'
   * nodes would also remove the cross-domain edges — the exact connections
   * the explorer exists to show — so off-domain nodes dim instead of vanish.
   */
  const emphasized = useCallback(
    (n: DdNode): boolean => {
      if (selectedId) return coneIds.has(n.id);
      if (domainFilter) return n.domain === domainFilter || n.layer === 'entity';
      return true;
    },
    [selectedId, coneIds, domainFilter],
  );

  /* ---- viewport: the run-canvas transform, on a smaller surface ------- */

  const [boxRef, size] = useMeasure<HTMLDivElement>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const adjustedRef = useRef(false);

  useEffect(() => {
    if (size.width <= 0 || adjustedRef.current) return;
    setView(computeFit(layout.bounds, size.width, size.height));
  }, [layout, size.width, size.height]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const delta = Math.max(-120, Math.min(120, e.deltaY * unit));
      adjustedRef.current = true;
      setView(v => zoomAbout(v, v.k * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - rect.left, e.clientY - rect.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const dragRef = useRef<{ id: number; lastX: number; lastY: number; moved: number } | null>(null);
  const suppressClickRef = useRef(false);

  const fit = useCallback(() => {
    adjustedRef.current = false;
    if (size.width > 0) setView(computeFit(layout.bounds, size.width, size.height));
  }, [layout, size.width, size.height]);

  const zoomByCentre = useCallback(
    (factor: number) => {
      adjustedRef.current = true;
      setView(v => zoomAbout(v, v.k * factor, size.width / 2, size.height / 2));
    },
    [size.width, size.height],
  );

  const contradictions = graph.nodes.filter(n => n.kind === 'contradiction').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a node…"
            aria-label="Find a node"
            className="!h-8 w-56 pl-8"
          />
          {matches.length > 0 ? (
            <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg bg-surface p-1 shadow-card ring-1 ring-[var(--ring)]">
              {matches.map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedId(m.id);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-secondary hover:bg-sunken hover:text-ink"
                >
                  <Badge tone="neutral">{titleCase(m.kind)}</Badge>
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Select
          value={domainFilter}
          onChange={e => setDomainFilter(e.target.value)}
          aria-label="Highlight a domain"
          className="!h-8 w-44"
        >
          <option value="">All departments</option>
          {Object.values(DD_DOMAIN_PROFILES).map(p => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <History size={13} className="shrink-0" />
          <span className="whitespace-nowrap">As of</span>
          <input
            type="date"
            value={asOf}
            max={caseData.updatedAt.slice(0, 10)}
            onChange={e => setAsOf(e.target.value)}
            aria-label="Show the graph as it stood on this date"
            className="h-8 rounded-lg bg-surface px-2 text-[12px] text-ink ring-1 ring-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {asOf ? (
            <Button size="sm" variant="ghost" onClick={() => setAsOf('')}>
              Now
            </Button>
          ) : null}
        </label>
        <span className="tabular text-[11.5px] text-ink-muted">
          {graph.nodes.length} nodes · {graph.edges.length} edges
          {contradictions > 0 ? ` · ${contradictions} contradiction${contradictions === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {historic ? (
        <Callout tone="warning" title={`As things stood on ${asOf}`}>
          This is the stored graph at that instant, not the current one — edges closed after it are open here and edges
          closed before it are gone. Notes you add are always written to the present.
        </Callout>
      ) : null}
      {pastState === 'loading' ? (
        <p className="text-[11.5px] text-ink-muted">Reading the graph store…</p>
      ) : null}
      {pastState === 'unavailable' ? (
        <Callout tone="neutral" title="Nothing stored for that date">
          The graph store holds no record of this case at that instant — either it had not been indexed yet, or the
          store is unreachable. Showing the current graph.
        </Callout>
      ) : null}

      {!result ? (
        <Callout tone="neutral" title="Screened cases have more graph">
          Without a screen run this graph carries only the title entities and the files — claims and judgements come
          from the screen's own evidence ledger, checks and risks.
        </Callout>
      ) : null}

      <div className={cn('grid gap-3', selected ? 'lg:grid-cols-[1fr,340px]' : 'grid-cols-1')}>
        <div ref={boxRef} className="relative h-[34rem]">
          <div
            ref={viewportRef}
            role="group"
            aria-label="DD evidence graph"
            aria-roledescription="Pannable, zoomable graph"
            tabIndex={0}
            onPointerDown={e => {
              if (e.button !== 0 && e.button !== 1) return;
              dragRef.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0 };
              e.currentTarget.setPointerCapture(e.pointerId);
              adjustedRef.current = true;
            }}
            onPointerMove={e => {
              const drag = dragRef.current;
              if (!drag || drag.id !== e.pointerId) return;
              const dx = e.clientX - drag.lastX;
              const dy = e.clientY - drag.lastY;
              drag.lastX = e.clientX;
              drag.lastY = e.clientY;
              drag.moved += Math.abs(dx) + Math.abs(dy);
              if (drag.moved > 4) suppressClickRef.current = true;
              setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
            }}
            onPointerUp={e => {
              if (dragRef.current?.id === e.pointerId) dragRef.current = null;
            }}
            onClick={e => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.graphBackground === 'true') {
                setSelectedId(null);
              }
            }}
            style={{ touchAction: 'none' }}
            className="absolute inset-0 cursor-grab overflow-hidden rounded-xl bg-sunken active:cursor-grabbing"
          >
            <div data-graph-background="true" className="absolute inset-0" />
            {size.width > 0 ? (
              <div
                className="absolute left-0 top-0 will-change-transform"
                style={{
                  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
                  transformOrigin: '0 0',
                  width: layout.bounds.width,
                  height: layout.bounds.height,
                }}
              >
                {layout.lanes.map((lane, i) => (
                  <div
                    key={lane.layer}
                    aria-hidden="true"
                    className={cn('absolute top-0 rounded-lg', i % 2 === 1 && 'bg-surface opacity-40')}
                    style={{ left: lane.x - COL_GAP / 2, width: lane.width + COL_GAP, height: layout.bounds.height - PADDING }}
                  />
                ))}
                {layout.lanes.map(lane => (
                  <div
                    key={`cap-${lane.layer}`}
                    aria-hidden="true"
                    className="absolute truncate text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted"
                    style={{ left: lane.x, top: PADDING, width: lane.width }}
                  >
                    {LAYER_LABEL[lane.layer]}
                    <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-muted/70">{lane.count}</span>
                  </div>
                ))}

                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 overflow-visible"
                  width={layout.bounds.width}
                  height={layout.bounds.height}
                >
                  {graph.edges.map(edge => {
                    const from = placedById.get(edge.fromNodeId);
                    const to = placedById.get(edge.toNodeId);
                    if (!from || !to) return null;
                    const lit = selectedId
                      ? coneEdgeIds.has(edge.id) || edge.fromNodeId === selectedId || edge.toNodeId === selectedId
                      : !domainFilter || emphasized(from.node) || emphasized(to.node);
                    return (
                      <path
                        key={edge.id}
                        d={edgePath(from, to)}
                        fill="none"
                        stroke={edge.kind === 'contradicts' ? 'var(--status-critical)' : 'var(--axis)'}
                        strokeWidth={edge.kind === 'contradicts' ? 1.6 : 1.1}
                        strokeDasharray={edge.kind === 'contradicts' ? '5 4' : undefined}
                        opacity={lit ? 0.7 : 0.08}
                      />
                    );
                  })}
                </svg>

                {layout.nodes.map(({ node, x, y }) => {
                  const tone = nodeTone(node);
                  const lit = emphasized(node);
                  const isSelected = node.id === selectedId;
                  return (
                    <button
                      key={node.id}
                      // Without this the viewport's pointer capture claims the
                      // whole gesture and the click lands on the canvas, not
                      // the node — selection silently never happens.
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => setSelectedId(node.id)}
                      title={node.label}
                      className={cn(
                        'absolute flex items-center gap-1.5 rounded-lg px-2 text-left transition-opacity',
                        isSelected ? 'ring-2 ring-brand' : 'ring-1 ring-[var(--ring)]',
                        lit ? 'opacity-100' : 'opacity-25',
                        // Reasoning is drawn as a note rather than a record:
                        // no shadow, a dashed edge, a recessed ground. The
                        // distinction has to survive a screenshot — a
                        // reasoning step and a verified fact reaching a bank
                        // must not look alike, and colour alone would put the
                        // weight on tone, which already means severity here.
                        // Keyed on layer: whether a node happens to be stored
                        // in the graph or projected into it is not something a
                        // reader should be able to see.
                        node.layer === 'deliberation'
                          ? 'border border-dashed border-[var(--ring)] bg-sunken'
                          : 'bg-surface shadow-sm',
                      )}
                      style={{
                        left: x,
                        top: y,
                        width: NODE_W,
                        height: NODE_H,
                        borderLeft: `3px ${node.layer === 'deliberation' ? 'dashed' : 'solid'} ${TONE_ACCENT[tone]}`,
                      }}
                    >
                      <NodeIcon node={node} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium leading-tight text-ink">{node.label}</span>
                        <span className="block truncate text-[10px] text-ink-muted">
                          {titleCase(node.kind)}
                          {node.domain ? ` · ${DD_DOMAIN_PROFILES[node.domain].label}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg bg-surface p-1 shadow-card ring-1 ring-[var(--ring)]">
              <ExplorerButton label="Zoom in" onClick={() => zoomByCentre(1.25)} disabled={view.k >= MAX_ZOOM - 1e-6}>
                <Plus size={14} />
              </ExplorerButton>
              <ExplorerButton label="Zoom out" onClick={() => zoomByCentre(1 / 1.25)} disabled={view.k <= MIN_ZOOM + 1e-6}>
                <Minus size={14} />
              </ExplorerButton>
              <ExplorerButton label="Fit to view" onClick={fit}>
                <Maximize2 size={13} />
              </ExplorerButton>
            </div>
          </div>
        </div>

        {selected ? (
          <TraceInspector
            node={selected}
            cone={cone}
            caseId={caseData.id}
            historic={historic}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
            onAnnotated={(node, edges) =>
              setAuthored(prev => ({ nodes: [...prev.nodes, node], edges: [...prev.edges, ...edges] }))
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function NodeIcon({ node }: { node: DdNode }) {
  if (node.kind === 'photo') return <Camera size={13} className="shrink-0 text-ink-muted" />;
  if (node.kind === 'document') return <FileText size={13} className="shrink-0 text-ink-muted" />;
  if (node.kind === 'question' || node.kind === 'followup') return <HelpCircle size={13} className="shrink-0 text-ink-muted" />;
  if (node.kind === 'answer') return <MessageSquare size={13} className="shrink-0 text-ink-muted" />;
  if (node.kind === 'thought') return <Lightbulb size={13} className="shrink-0 text-ink-muted" />;
  if (node.kind === 'department') return <Building2 size={13} className="shrink-0 text-ink-muted" />;
  return <Waypoints size={13} className="shrink-0 text-ink-muted" />;
}

function ExplorerButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={e => e.stopPropagation()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * The selected node and its derivation cone — the same `trace` the copilot's
 * trace_conclusion tool runs, rendered as a list ordered evidence → claims →
 * judgements so the reader walks the conclusion back to its files. An empty
 * cone below a judgement is said in words: an unevidenced conclusion is
 * exactly what this product must not present quietly.
 */
function TraceInspector({
  historic,
  node,
  cone,
  caseId,
  onSelect,
  onClose,
  onAnnotated,
}: {
  historic: boolean;
  node: DdNode;
  cone: DdSubgraph | undefined;
  caseId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onAnnotated: (node: DdNode, edges: DdEdge[]) => void;
}) {
  const support = (cone?.nodes ?? []).filter(n => n.id !== node.id);
  const byLayer = (layer: DdLayer) => support.filter(n => n.layer === layer);
  const unevidenced =
    node.layer === 'judgement' && !(cone?.edges ?? []).some(e => e.toNodeId === node.id && (e.kind === 'evidences' || e.kind === 'produces'));

  const attributeRows = Object.entries(node.attributes).filter(([k]) => k !== 'mergeKey' && k !== 'domains');

  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const saveNote = async () => {
    const text = noteText.trim();
    if (!text || saving) return;
    setSaving(true);
    setNoteError(null);
    try {
      const { node: created, edges } = await api.annotateGraphNode(caseId, { nodeId: node.id, text });
      onAnnotated(created, edges);
      setNoteText('');
    } catch (err) {
      // Kept in the box on failure. This is the only copy — clearing it on a
      // 503 would discard what the analyst just wrote, and the store being
      // unreachable is exactly when that happens.
      setNoteError(err instanceof Error ? err.message : 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="flex max-h-[34rem] flex-col gap-3 overflow-y-auto rounded-xl bg-surface p-3.5 ring-1 ring-[var(--ring)]" aria-label="Node inspector">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{titleCase(node.kind)}</Badge>
            {node.domain ? <Badge tone="brand">{DD_DOMAIN_PROFILES[node.domain].label}</Badge> : null}
          </div>
          <p className="mt-1.5 text-[13px] font-medium leading-snug text-ink">{node.label}</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{node.id}</p>
        </div>
        <button onClick={onClose} aria-label="Close inspector" className="shrink-0 rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink">
          <X size={14} />
        </button>
      </div>

      {attributeRows.length > 0 ? (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11.5px]">
          {attributeRows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-muted">{titleCase(k.replace(/([A-Z])/g, ' $1'))}</dt>
              <dd className="min-w-0 truncate text-ink-secondary" title={String(v)}>
                {String(v)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {unevidenced ? (
        <Callout tone="warning" title="No evidence chain behind this conclusion">
          Nothing in the graph supports this node — that is a finding about the file, not a rendering gap.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">How we know — the derivation cone</h4>
        {support.length === 0 ? (
          <p className="text-[12px] text-ink-muted">Nothing else in the graph connects to this node.</p>
        ) : (
          (['evidence', 'claim', 'judgement', 'entity'] as DdLayer[]).map(layer => {
            const rows = byLayer(layer);
            if (rows.length === 0) return null;
            return (
              <div key={layer}>
                <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">{LAYER_LABEL[layer]}</p>
                <ul className="flex flex-col gap-1">
                  {rows.map(n => (
                    <li key={n.id}>
                      <button
                        onClick={() => onSelect(n.id)}
                        className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-sunken"
                      >
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_ACCENT[nodeTone(n)] }} />
                        <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-secondary">{n.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>

      {/*
        The one thing on this panel that WRITES, and the only thing in the
        graph that a rebuild cannot produce. Everything above is derived from
        the case and will come back on its own; a note will not, which is why
        it is stored in the graph rather than projected into it — and why a
        failed save keeps the text in the box.
      */}
      <div className="border-t border-hairline pt-2.5">
        {historic ? (
          /*
           * No writing into the past. A note is always written to the
           * present, so offering the box here would either attach it to a
           * node that may no longer exist or silently record it against a
           * date the reader is not looking at. Both are worse than the
           * control being absent and saying why.
           */
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            Notes are written to the present. Switch back to <span className="font-medium text-ink-secondary">Now</span>{' '}
            to add one.
          </p>
        ) : (
          <>
        <label htmlFor="graph-note" className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          Add a note
        </label>
        <textarea
          id="graph-note"
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          rows={2}
          placeholder="What you know about this that the documents do not say"
          className="mt-1 w-full resize-y rounded-lg bg-sunken px-2 py-1.5 text-[12px] text-ink ring-1 ring-[var(--ring)] placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveNote()}
            disabled={!noteText.trim() || saving}
            className="rounded-md bg-brand px-2.5 py-1 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
          <span className="text-[10.5px] text-ink-faint">Kept in the graph, not on the case. Survives every rebuild.</span>
        </div>
        {noteError ? <p className="mt-1 text-[11px] text-critical">{noteError}</p> : null}
          </>
        )}
      </div>

      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        This cone is the copilot's own trace_conclusion answer for this node — ask it to trace "{node.label}" in chat
        and it walks the same edges. Ask it <span className="font-medium">why</span> and it reads the recorded
        reasoning, including notes added here.
      </p>
    </aside>
  );
}
