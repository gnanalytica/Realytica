import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { buildProjectGraph, extractProjectSubgraph, findProjectNodes, type DdProject, type ProjectGraphEdge, type ProjectGraphNode } from '@realytica/shared';
import { Badge, cn } from '../../../components/ui/kit';
import { computeFit, zoomAbout, MAX_ZOOM, MIN_ZOOM } from '../../../components/canvas/Canvas';
import type { Transform } from '../../../components/canvas/Canvas';
import { useMeasure } from '../../../components/charts/primitives';

const KIND_ORDER: ProjectGraphNode['kind'][] = [
  'project',
  // The property itself, left of the workflow that examines it — the land,
  // the people, the paper and the permissions come before the checks.
  'parcel',
  'party',
  'instrument',
  'encumbrance',
  'approval',
  'authority',
  'asset',
  'assessment',
  'scope',
  'check',
  'evidence',
  // Beside evidence, because that is what they are: a visit is where evidence
  // came from, a sheet is one placed on the ground.
  'site_visit',
  'sheet',
  'contradiction',
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
  parcel: 'Land',
  party: 'People',
  instrument: 'Deeds',
  encumbrance: 'Charges',
  approval: 'Approvals',
  authority: 'Authorities',
  contradiction: 'Conflicts',
  asset: 'Assets',
  assessment: 'Due diligence',
  scope: 'Scopes',
  check: 'Checks',
  evidence: 'Evidence',
  site_visit: 'Site visits',
  sheet: 'Sheets',
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
  parcel: 'var(--status-good, var(--brand))',
  party: 'var(--status-good, var(--brand))',
  instrument: 'var(--status-good, var(--brand))',
  encumbrance: 'var(--status-serious)',
  approval: 'var(--status-good, var(--brand))',
  authority: 'var(--axis)',
  contradiction: 'var(--status-critical)',
  asset: 'var(--axis)',
  assessment: 'var(--brand)',
  scope: 'var(--status-info, var(--axis))',
  check: 'var(--status-info, var(--axis))',
  evidence: 'var(--status-info, var(--axis))',
  site_visit: 'var(--status-info, var(--axis))',
  sheet: 'var(--status-info, var(--axis))',
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

/**
 * The scale below which a node card stops being a label and becomes a smudge.
 *
 * The card carries an 11.5px name over a 10px kind; at 0.7 those are 8 and 7
 * physical pixels, which is the point where you are looking at the shape of
 * text rather than reading it.
 */
const LEGIBLE_ZOOM = 0.7;

/**
 * Fit the graph, but never smaller than it can be read at.
 *
 * `computeFit` alone will shrink whatever it is given until it fits, which is
 * right for a canvas somebody is about to zoom into and wrong for the view
 * that greets them: eight lanes across a narrow pane fit at about 0.4, and
 * that was the "dense grid of tiny text cards" — the graph was drawn
 * correctly and then scaled below the point of being readable.
 *
 * Past the floor it stops scaling and starts panning. Anchored left, because
 * the lanes run left to right from the project and the left edge is where the
 * subject is; centring an over-wide layout hides both ends instead.
 */
function fitLegible(bounds: { x: number; y: number; width: number; height: number }, w: number, h: number): Transform {
  const fitted = computeFit(bounds, w, h);
  if (fitted.k >= LEGIBLE_ZOOM) return fitted;
  const k = LEGIBLE_ZOOM;
  const scaledW = bounds.width * k;
  const scaledH = bounds.height * k;
  return {
    k,
    x: scaledW <= w ? (w - scaledW) / 2 - bounds.x * k : PADDING * k - bounds.x * k,
    y: scaledH <= h ? (h - scaledH) / 2 - bounds.y * k : PADDING * k - bounds.y * k,
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
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);

  /*
   * What has been walked into, rather than everything there is.
   *
   * This canvas used to lay out all of it — 471 nodes on this file — and rely
   * on dimming to say which mattered. At the zoom that fits 471 cards on a
   * pane, a card is a few pixels of grey and the links between them are
   * thinner than that, so the answer to "what is connected to what" was a
   * texture. Opacity cannot rescue a view whose problem is that everything is
   * too small to read.
   *
   * So the file opens at the project and one hop out, and every node that has
   * been opened contributes its own neighbours. The graph grows in the
   * direction somebody is actually asking about, and the parts nobody asked
   * about are absent rather than faint.
   *
   * `extractProjectSubgraph` is the same function the copilot retrieves
   * through, which matters more than the reuse: it refuses to drop an alarming
   * node adjacent to anything kept. A finding cannot hide behind a collapsed
   * branch, because the one thing a pruned view of a diligence file must never
   * do is prune the problems.
   */
  const [expanded, setExpanded] = useState<string[]>(() => [focusId ?? project.id]);

  /*
   * Opening a node writes `?node=<id>`, which arrives straight back here as
   * `focusId`. So this must ADD to what is open, never replace it: replacing
   * meant every click threw away the path that led to it, and the graph got
   * SMALLER as you walked into it — twenty-four nodes down to nine, which is
   * the opposite of expanding.
   *
   * Only a different project starts over.
   */
  useEffect(() => {
    setExpanded([project.id]);
    setSelectedId(null);
  }, [project.id]);

  useEffect(() => {
    if (!focusId) return;
    setExpanded((prev) => (prev.includes(focusId) ? prev : [...prev, focusId]));
    setSelectedId(focusId);
  }, [focusId]);

  const matches = useMemo(
    () => (query.trim() ? findProjectNodes(graph, query).map((n) => n.id) : []),
    [graph, query],
  );

  /* A search reaches past what has been opened — otherwise it can only find
     what is already on screen, which is not a search. */
  const visible = useMemo(
    () => extractProjectSubgraph(graph, [...expanded, ...matches], 1),
    [graph, expanded, matches],
  );

  const layout = useMemo(() => layoutGraph(visible.nodes), [visible.nodes]);
  const placedById = useMemo(() => new Map(layout.placed.map((p) => [p.node.id, p])), [layout.placed]);

  /* How many neighbours a node still has out of view, so a card can say that
     there is more behind it rather than looking like a leaf. */
  const hiddenNeighbours = useMemo(() => {
    const shown = new Set(visible.nodes.map((n) => n.id));
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      if (shown.has(edge.from) && !shown.has(edge.to)) counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
      if (shown.has(edge.to) && !shown.has(edge.from)) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
    }
    return counts;
  }, [graph.edges, visible.nodes]);

  const [boxRef, size] = useMeasure<HTMLDivElement>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const adjustedRef = useRef(false);

  /*
   * A pan or a zoom is a decision to look somewhere, and resizing the pane is
   * not a reason to overrule it — hence `adjustedRef`.
   *
   * Opening a node is different. The lanes are laid out from whatever is
   * visible, so revealing neighbours re-centres every column; keeping the old
   * transform would leave somebody looking at the space where their node used
   * to be. Expanding is a request to see more, so it re-fits.
   */
  /* The pane changed size. Re-fit only if nobody has taken the view somewhere
     themselves — a pan or a zoom is a decision, and a resize does not overrule it. */
  useEffect(() => {
    if (size.width <= 0 || adjustedRef.current) return;
    setView(fitLegible(layout.bounds, size.width, size.height));
    // `layout` is read but deliberately not a trigger — the effect below owns that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  /* The visible set changed. Lanes are laid out from whatever is visible, so
     revealing neighbours re-centres every column and the old transform would
     leave somebody looking at the space their node used to occupy. Opening a
     node is a request to see more, so this one overrules the pan. */
  useEffect(() => {
    if (size.width <= 0) return;
    adjustedRef.current = false;
    setView(fitLegible(layout.bounds, size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

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
    if (size.width > 0) setView(fitLegible(layout.bounds, size.width, size.height));
  }, [layout, size.width, size.height]);

  const zoomByCentre = useCallback(
    (factor: number) => {
      adjustedRef.current = true;
      setView((v) => zoomAbout(v, v.k * factor, size.width / 2, size.height / 2));
    },
    [size.width, size.height],
  );

  /*
   * Selecting a node is also how it is opened. Two gestures — one to look at
   * a thing, another to see what it touches — is a distinction nobody asked
   * for on a canvas whose entire purpose is what touches what.
   */
  function select(id: string | null) {
    setSelectedId(id);
    if (id) setExpanded((prev) => (prev.includes(id) ? prev : [...prev, id]));
    onSelect?.(id);
  }

  function resetToProject() {
    setExpanded([project.id]);
    setSelectedId(null);
    setQuery('');
    onSelect?.(null);
  }

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedEdges = selected
    ? graph.edges.filter((e) => e.from === selected.id || e.to === selected.id)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <p className="font-mono text-[11px] text-ink-muted">
          {visible.nodes.length} of {graph.nodes.length} nodes · {visible.edges.length} of {graph.edges.length} links ·
          {' '}click a node to open what it touches
        </p>
        {visible.nodes.length < graph.nodes.length || expanded.length > 1 ? (
          <button
            type="button"
            onClick={resetToProject}
            className="rounded-md px-2 py-1 text-[11.5px] text-ink-secondary ring-1 ring-[var(--ring)] hover:bg-sunken hover:text-ink"
          >
            Back to the project
          </button>
        ) : null}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Neighbourhood…"
          aria-label="Highlight a neighbourhood on this file"
          className="ml-auto h-8 min-w-[10rem] rounded-md bg-sunken px-2 text-[12px] text-ink ring-1 ring-[var(--ring)]"
        />
      </div>
      {/* The inspector splits off the canvas once the PANE is wide enough for
          both — `lg:` measured the window, which is not what it is dividing. */}
      <div
        className={cn(
          'grid min-h-0 min-w-0 flex-1 gap-3',
          selected ? '[@container(min-width:44rem)]:grid-cols-[minmax(0,1fr),min(260px,32%)]' : 'grid-cols-1',
        )}
      >
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
                  {/* Every edge drawn here has both ends on screen, so none of
                      them needs to be faded to say so. */}
                  {visible.edges.map((edge) => {
                    const from = placedById.get(edge.from);
                    const to = placedById.get(edge.to);
                    if (!from || !to) return null;
                    const touchesSelection = selectedId === edge.from || selectedId === edge.to;
                    return (
                      <path
                        key={edge.id}
                        d={edgePath(from, to)}
                        fill="none"
                        stroke={touchesSelection ? 'var(--brand)' : 'var(--axis)'}
                        strokeWidth={touchesSelection ? 1.8 : 1.1}
                        opacity={touchesSelection ? 0.9 : 0.5}
                      />
                    );
                  })}
                </svg>
                {layout.placed.map(({ node, x, y }) => {
                  const isSelected = node.id === selectedId;
                  const more = hiddenNeighbours.get(node.id) ?? 0;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => select(node.id)}
                      title={more ? `${node.label} — ${more} more connected` : node.label}
                      className={cn(
                        'absolute flex items-center gap-1.5 rounded-lg bg-surface px-2 text-left shadow-sm ring-1 ring-[var(--ring)]',
                        isSelected && 'ring-2 ring-brand',
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
                      {/*
                        Where the graph continues. Without it a node with forty
                        neighbours out of view is indistinguishable from a leaf,
                        and the reader has to click everything to find out which
                        is which — the bombardment again, one card at a time.
                      */}
                      {more ? (
                        <span className="shrink-0 rounded-full bg-sunken px-1.5 py-0.5 font-mono text-[9.5px] tabular-nums text-ink-muted">
                          +{more}
                        </span>
                      ) : null}
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
