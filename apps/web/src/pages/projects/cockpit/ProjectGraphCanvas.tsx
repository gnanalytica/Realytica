import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { buildProjectGraph, type DdProject, type ProjectGraphEdge, type ProjectGraphNode } from '@realytica/shared';
import { Badge, cn } from '../../../components/ui/kit';
import { computeFit, zoomAbout, MAX_ZOOM, MIN_ZOOM } from '../../../components/canvas/Canvas';
import type { Transform } from '../../../components/canvas/Canvas';
import { useMeasure } from '../../../components/charts/primitives';

const KIND_ORDER: ProjectGraphNode['kind'][] = [
  'project',
  'asset',
  'assessment',
  'scope',
  'evidence',
  'finding',
  'risk',
  'action',
  'decision',
  'report',
  'question',
  'thought',
  'proposal',
];

const KIND_LABEL: Record<ProjectGraphNode['kind'], string> = {
  project: 'Project',
  asset: 'Assets',
  assessment: 'Due diligence',
  scope: 'Scopes',
  evidence: 'Evidence',
  finding: 'Findings',
  risk: 'Risks',
  action: 'Actions',
  decision: 'Decisions',
  report: 'Reports',
  question: 'Questions',
  thought: 'Thinking',
  proposal: 'Proposals',
};

const KIND_TONE: Record<ProjectGraphNode['kind'], string> = {
  project: 'var(--brand)',
  asset: 'var(--axis)',
  assessment: 'var(--brand)',
  scope: 'var(--status-info, var(--axis))',
  evidence: 'var(--status-info, var(--axis))',
  finding: 'var(--status-serious)',
  risk: 'var(--status-critical)',
  action: 'var(--status-warning)',
  decision: 'var(--brand)',
  report: 'var(--axis)',
  question: 'var(--brand)',
  thought: 'var(--status-info, var(--axis))',
  proposal: 'var(--status-warning)',
};

const NODE_W = 196;
const NODE_H = 44;
const ROW_GAP = 10;
const COL_GAP = 28;
const LANE_GAP = 72;
const MAX_ROWS = 14;
const PADDING = 36;
const LANE_HEADER = 28;

interface Placed {
  node: ProjectGraphNode;
  x: number;
  y: number;
}

function layoutGraph(nodes: ProjectGraphNode[]): { placed: Placed[]; lanes: { kind: ProjectGraphNode['kind']; x: number; width: number; count: number }[]; bounds: { x: number; y: number; width: number; height: number } } {
  const placed: Placed[] = [];
  const lanes: { kind: ProjectGraphNode['kind']; x: number; width: number; count: number }[] = [];
  const pitch = NODE_H + ROW_GAP;
  let cursorX = PADDING;
  let maxRows = 0;
  const pending: { x: number; nodes: ProjectGraphNode[] }[] = [];

  KIND_ORDER.forEach((kind, ordinal) => {
    const laneNodes = nodes
      .filter((n) => n.kind === kind)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    if (laneNodes.length === 0 && kind !== 'project') return;
    const columnCount = Math.max(1, Math.ceil(laneNodes.length / MAX_ROWS));
    const perColumn = Math.max(1, Math.ceil(laneNodes.length / columnCount));
    if (ordinal > 0 && lanes.length > 0) cursorX += LANE_GAP;
    const laneX = cursorX;
    for (let c = 0; c < columnCount; c += 1) {
      if (c > 0) cursorX += COL_GAP;
      const slice = laneNodes.slice(c * perColumn, (c + 1) * perColumn);
      pending.push({ x: cursorX, nodes: slice });
      maxRows = Math.max(maxRows, slice.length);
      cursorX += NODE_W;
    }
    lanes.push({ kind, x: laneX, width: cursorX - laneX, count: laneNodes.length });
  });

  const top = PADDING + LANE_HEADER;
  for (const column of pending) {
    const offset = Math.floor((maxRows - column.nodes.length) / 2);
    column.nodes.forEach((node, i) => {
      placed.push({ node, x: column.x, y: top + (offset + i) * pitch });
    });
  }

  return {
    placed,
    lanes,
    bounds: {
      x: 0,
      y: 0,
      width: Math.max(cursorX + PADDING, PADDING * 2),
      height: Math.max(top + maxRows * pitch - ROW_GAP + PADDING, PADDING * 2),
    },
  };
}

function edgePath(from: Placed, to: Placed): string {
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
  const x = from.x + NODE_W;
  const bow = 44 + Math.min(40, Math.abs(ty - sy) * 0.15);
  return `M ${x} ${sy} C ${x + bow} ${sy}, ${x + bow} ${ty}, ${x} ${ty}`;
}

export function ProjectGraphCanvas({
  project,
  focusId,
  onSelect,
}: {
  project: DdProject;
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const graph = useMemo(() => buildProjectGraph(project), [project]);
  const layout = useMemo(() => layoutGraph(graph.nodes), [graph.nodes]);
  const placedById = useMemo(() => new Map(layout.placed.map((p) => [p.node.id, p])), [layout.placed]);
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const connected = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set<string>([selectedId]);
    for (const e of graph.edges) {
      if (e.from === selectedId) ids.add(e.to);
      if (e.to === selectedId) ids.add(e.from);
    }
    return ids;
  }, [graph.edges, selectedId]);

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
      setView((v) => zoomAbout(v, v.k * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - rect.left, e.clientY - rect.top));
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
      setView((v) => zoomAbout(v, v.k * factor, size.width / 2, size.height / 2));
    },
    [size.width, size.height],
  );

  function select(id: string | null) {
    setSelectedId(id);
    onSelect?.(id);
  }

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedEdges = selected
    ? graph.edges.filter((e) => e.from === selected.id || e.to === selected.id)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p className="shrink-0 font-mono text-[11px] text-ink-muted">
        {graph.nodes.length} nodes · {graph.edges.length} links · pan, scroll to zoom
      </p>
      <div className={cn('grid min-h-0 min-w-0 flex-1 gap-3', selected ? 'lg:grid-cols-[minmax(0,1fr),min(260px,32%)]' : 'grid-cols-1')}>
        <div ref={boxRef} className="relative min-h-[12rem] min-w-0 flex-1">
          <div
            ref={viewportRef}
            role="group"
            aria-label="Project knowledge graph"
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.button !== 1) return;
              dragRef.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0 };
              e.currentTarget.setPointerCapture(e.pointerId);
              adjustedRef.current = true;
            }}
            onPointerMove={(e) => {
              const drag = dragRef.current;
              if (!drag || drag.id !== e.pointerId) return;
              const dx = e.clientX - drag.lastX;
              const dy = e.clientY - drag.lastY;
              drag.lastX = e.clientX;
              drag.lastY = e.clientY;
              drag.moved += Math.abs(dx) + Math.abs(dy);
              if (drag.moved > 4) suppressClickRef.current = true;
              setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
            }}
            onPointerUp={(e) => {
              if (dragRef.current?.id === e.pointerId) dragRef.current = null;
            }}
            onClick={(e) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.graphBackground === 'true') {
                select(null);
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
                    key={lane.kind}
                    aria-hidden="true"
                    className={cn('absolute top-0 rounded-lg', i % 2 === 1 && 'bg-surface opacity-40')}
                    style={{ left: lane.x - COL_GAP / 2, width: lane.width + COL_GAP, height: layout.bounds.height - PADDING }}
                  />
                ))}
                {layout.lanes.map((lane) => (
                  <div
                    key={`cap-${lane.kind}`}
                    aria-hidden="true"
                    className="absolute truncate text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted"
                    style={{ left: lane.x, top: PADDING, width: lane.width }}
                  >
                    {KIND_LABEL[lane.kind]}
                    <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-muted/70">{lane.count}</span>
                  </div>
                ))}
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 overflow-visible"
                  width={layout.bounds.width}
                  height={layout.bounds.height}
                >
                  {graph.edges.map((edge) => {
                    const from = placedById.get(edge.from);
                    const to = placedById.get(edge.to);
                    if (!from || !to) return null;
                    const lit = !selectedId || connected.has(edge.from) || connected.has(edge.to);
                    return (
                      <path
                        key={edge.id}
                        d={edgePath(from, to)}
                        fill="none"
                        stroke="var(--axis)"
                        strokeWidth={1.1}
                        opacity={lit ? 0.55 : 0.08}
                      />
                    );
                  })}
                </svg>
                {layout.placed.map(({ node, x, y }) => {
                  const isSelected = node.id === selectedId;
                  const lit = !selectedId || connected.has(node.id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => select(node.id)}
                      title={node.label}
                      className={cn(
                        'absolute flex items-center gap-1.5 rounded-lg bg-surface px-2 text-left shadow-sm ring-1 ring-[var(--ring)]',
                        isSelected && 'ring-2 ring-brand',
                        lit ? 'opacity-100' : 'opacity-25',
                      )}
                      style={{
                        left: x,
                        top: y,
                        width: NODE_W,
                        height: NODE_H,
                        borderLeft: `3px solid ${KIND_TONE[node.kind]}`,
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium leading-tight text-ink">{node.label}</span>
                        <span className="block truncate text-[10px] text-ink-muted">
                          {KIND_LABEL[node.kind]}
                          {node.detail ? ` · ${node.detail}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg bg-surface p-1 shadow-card ring-1 ring-[var(--ring)]">
              <button
                type="button"
                aria-label="Zoom in"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => zoomByCentre(1.25)}
                disabled={view.k >= MAX_ZOOM - 1e-6}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-sunken disabled:opacity-40 coarse:h-11 coarse:w-11"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => zoomByCentre(1 / 1.25)}
                disabled={view.k <= MIN_ZOOM + 1e-6}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-sunken disabled:opacity-40 coarse:h-11 coarse:w-11"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                aria-label="Fit to view"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={fit}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-sunken coarse:h-11 coarse:w-11"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>
        </div>
        {selected ? (
          <aside className="max-h-48 overflow-y-auto rounded-xl bg-surface p-3 ring-1 ring-[var(--ring)] lg:max-h-none">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Badge>{KIND_LABEL[selected.kind]}</Badge>
                <p className="mt-1.5 text-[13px] font-medium text-ink">{selected.label}</p>
                {selected.detail ? <p className="mt-0.5 text-[12px] text-ink-muted">{selected.detail}</p> : null}
              </div>
              <button type="button" aria-label="Close inspector" onClick={() => select(null)} className="rounded p-1 text-ink-muted hover:bg-sunken">
                <X size={14} />
              </button>
            </div>
            <ul className="mt-3 space-y-1">
              {selectedEdges.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => select(e.from === selected.id ? e.to : e.from)}
                    className="w-full rounded-md px-2 py-1 text-left text-[12px] text-ink-secondary hover:bg-sunken hover:text-ink"
                  >
                    {e.rel} → {labelOf(graph.nodes, e.from === selected.id ? e.to : e.from, e)}
                  </button>
                </li>
              ))}
              {selectedEdges.length === 0 ? <li className="text-[12px] text-ink-muted">No register links on this node.</li> : null}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function labelOf(nodes: ProjectGraphNode[], id: string, _edge: ProjectGraphEdge): string {
  return nodes.find((n) => n.id === id)?.label ?? id;
}
