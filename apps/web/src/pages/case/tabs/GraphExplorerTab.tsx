import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileText, Maximize2, Minus, Plus, Search, Waypoints, X } from 'lucide-react';
import { DD_DOMAIN_PROFILES, buildDdGraph, findNodes, trace } from '@realytica/shared';
import type { DdGraph, DdLayer, DdNode, DdSubgraph } from '@realytica/shared';
import { Badge, Callout, Input, Select, cn } from '../../../components/ui/kit';
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

const LAYERS: DdLayer[] = ['entity', 'evidence', 'claim', 'judgement'];

const LAYER_LABEL: Record<DdLayer, string> = {
  entity: 'What exists',
  evidence: 'What we hold',
  claim: 'What it says',
  judgement: 'What we conclude',
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
  const graph = useMemo(() => buildDdGraph(caseData, caseData.updatedAt), [caseData]);
  const layout = useMemo(() => layoutDdGraph(graph), [graph]);
  const placedById = useMemo(() => new Map(layout.nodes.map(p => [p.node.id, p])), [layout]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [query, setQuery] = useState('');

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
        <span className="tabular text-[11.5px] text-ink-muted">
          {graph.nodes.length} nodes · {graph.edges.length} edges
          {contradictions > 0 ? ` · ${contradictions} contradiction${contradictions === 1 ? '' : 's'}` : ''}
        </span>
      </div>

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
                        'absolute flex items-center gap-1.5 rounded-lg bg-surface px-2 text-left shadow-sm ring-1 transition-opacity',
                        isSelected ? 'ring-2 ring-brand' : 'ring-[var(--ring)]',
                        lit ? 'opacity-100' : 'opacity-25',
                      )}
                      style={{ left: x, top: y, width: NODE_W, height: NODE_H, borderLeft: `3px solid ${TONE_ACCENT[tone]}` }}
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
          <TraceInspector node={selected} cone={cone} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
        ) : null}
      </div>
    </div>
  );
}

function NodeIcon({ node }: { node: DdNode }) {
  if (node.kind === 'photo') return <Camera size={13} className="shrink-0 text-ink-muted" />;
  if (node.kind === 'document') return <FileText size={13} className="shrink-0 text-ink-muted" />;
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
  node,
  cone,
  onSelect,
  onClose,
}: {
  node: DdNode;
  cone: DdSubgraph | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const support = (cone?.nodes ?? []).filter(n => n.id !== node.id);
  const byLayer = (layer: DdLayer) => support.filter(n => n.layer === layer);
  const unevidenced =
    node.layer === 'judgement' && !(cone?.edges ?? []).some(e => e.toNodeId === node.id && (e.kind === 'evidences' || e.kind === 'produces'));

  const attributeRows = Object.entries(node.attributes).filter(([k]) => k !== 'mergeKey' && k !== 'domains');

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

      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        This cone is the copilot's own trace_conclusion answer for this node — ask it to trace "{node.label}" in chat
        and it walks the same edges.
      </p>
    </aside>
  );
}
