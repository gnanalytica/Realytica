import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';
import type { AgentRun } from '@realytica/shared';
import { cn } from '../ui/kit';
import { useMeasure } from '../charts/primitives';
import type { GraphLayout, PositionedNode } from './layout';
import { RunNode } from './RunNode';

/**
 * The pan/zoom viewport.
 *
 * Hand-rolled rather than pulled from a graph library, for the same reason the
 * charts in `components/charts` are hand-rolled: the whole of what a read-only
 * inspector needs is a transform, a wheel handler and a drag handler, and the
 * bundle is already past Vite's 500 kB warning. React Flow would add roughly
 * the weight of this entire feature to ship an editor whose editing half is
 * exactly what this product must not offer — the orchestrator decides the DAG,
 * not the reader.
 *
 * ── The transform ────────────────────────────────────────────────────────
 * One affine map, `screen = graph * k + t`, applied as a CSS transform on a
 * single layer. Edges (SVG) and nodes (HTML) live inside that layer, so they
 * cannot drift apart: there is one source of truth for position and it is the
 * layout, not two coordinate systems kept in sync.
 *
 * ── Cursor-anchored zoom ─────────────────────────────────────────────────
 * Zooming about the viewport centre is the single thing that makes a canvas
 * feel wrong: the reader points at the node they care about, zooms, and it
 * slides away. Anchoring inverts the map at the cursor instead. If `c` is the
 * cursor in viewport coordinates, the graph point under it is `(c - t) / k`,
 * and holding that point fixed across a scale change gives
 *
 *     t' = c - (c - t) · (k' / k)
 *
 * which is the whole trick, and is asserted numerically in the harness rather
 * than eyeballed.
 */

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
/**
 * Fit never magnifies past 1:1. A two-node graph stretched to fill a 900px
 * viewport reads as a bug rather than as a small graph.
 */
const MAX_FIT_ZOOM = 1;
/** Below this the secondary lines on a node are noise, so nodes drop to compact. */
const DETAIL_THRESHOLD = 0.55;
/** Keyboard pan step, in screen pixels. Shift makes it fine-grained. */
const PAN_STEP = 72;
const PAN_STEP_FINE = 16;

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface CanvasProps {
  layout: GraphLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Runs by id, when the case has them — only sharpens status wording on a node. */
  runsById?: Map<string, AgentRun>;
  /** Accessible name for the canvas region. */
  ariaLabel: string;
  className?: string;
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** The transform that centres `bounds` inside a `w` × `h` viewport. */
export function computeFit(
  bounds: GraphLayout['bounds'],
  w: number,
  h: number,
): Transform {
  if (w <= 0 || h <= 0 || bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampZoom(Math.min(w / bounds.width, h / bounds.height, MAX_FIT_ZOOM));
  return {
    k,
    x: (w - bounds.width * k) / 2 - bounds.x * k,
    y: (h - bounds.height * k) / 2 - bounds.y * k,
  };
}

/** Apply a scale change while holding the graph point under `(cx, cy)` still. */
export function zoomAbout(view: Transform, nextK: number, cx: number, cy: number): Transform {
  const k = clampZoom(nextK);
  if (k === view.k) return view;
  const ratio = k / view.k;
  return { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

/* ------------------------------------------------------------------ */
/* Edge styling                                                        */
/* ------------------------------------------------------------------ */

const EDGE_STROKE = {
  sequence: 'var(--axis)',
  data: 'var(--brand)',
  feedback: 'var(--status-serious)',
} as const;

const EDGE_DASH = {
  sequence: undefined,
  data: undefined,
  feedback: '5 4',
} as const;

const EDGE_WIDTH = {
  sequence: 1.25,
  data: 1.75,
  feedback: 1.5,
} as const;

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export default function Canvas({ layout, selectedId, onSelect, runsById, ariaLabel, className }: CanvasProps) {
  const [boxRef, size] = useMeasure<HTMLDivElement>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const markerId = useId().replace(/:/g, '');

  /*
   * Fit runs once per layout, and again on resize only while the reader has
   * not moved the canvas themselves. Refitting unconditionally would yank the
   * view out from under someone who had just zoomed into a node — a sidebar
   * collapsing is not a request to reset.
   */
  const adjustedRef = useRef(false);
  const fittedForRef = useRef<GraphLayout | null>(null);

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const isNewLayout = fittedForRef.current !== layout;
    if (isNewLayout) {
      adjustedRef.current = false;
      fittedForRef.current = layout;
    }
    if (isNewLayout || !adjustedRef.current) {
      setView(computeFit(layout.bounds, size.width, size.height));
    }
  }, [layout, size.width, size.height]);

  const markAdjusted = useCallback(() => {
    adjustedRef.current = true;
  }, []);

  const fit = useCallback(() => {
    if (size.width <= 0) return;
    adjustedRef.current = false;
    setView(computeFit(layout.bounds, size.width, size.height));
  }, [layout, size.width, size.height]);

  /** 1:1, with the drawing's top-left parked just inside the top-left of the viewport. */
  const reset = useCallback(() => {
    markAdjusted();
    setView({ x: -layout.bounds.x, y: -layout.bounds.y, k: 1 });
  }, [layout, markAdjusted]);

  const zoomByCentre = useCallback(
    (factor: number) => {
      markAdjusted();
      setView((v) => zoomAbout(v, v.k * factor, size.width / 2, size.height / 2));
    },
    [markAdjusted, size.width, size.height],
  );

  /* ---------------- wheel: zoom, cursor-anchored ------------------- */

  /*
   * Registered imperatively because React's synthetic `onWheel` is passive, so
   * `preventDefault()` inside it does nothing and the page scrolls behind the
   * canvas. Bound to the viewport element alone, which is what keeps the rule
   * "do not trap the page scroll when the pointer is outside the canvas" — a
   * wheel event anywhere else never reaches this listener.
   */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      /*
       * A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel
       * arrives as coarse notches, sometimes in lines rather than pixels. Both
       * are normalised to a per-event exponent so one notch is a consistent
       * step and a pinch stays smooth, rather than a mouse wheel jumping three
       * zoom levels per click.
       */
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const delta = Math.max(-120, Math.min(120, e.deltaY * unit));
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0022));
      adjustedRef.current = true;
      setView((v) => zoomAbout(v, v.k * factor, cx, cy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------------- drag to pan ------------------------------------ */

  const dragRef = useRef<{ id: number; lastX: number; lastY: number; moved: number } | null>(null);
  // A pan ends with a click on the background. Without this, every drag would
  // also close the inspector, which is maddening once you have selected a node
  // and want to look around it.
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Primary button on the background, or the middle button anywhere.
      if (e.button !== 0 && e.button !== 1) return;
      dragRef.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
      markAdjusted();
    },
    [markAdjusted],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 4) suppressClickRef.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  /* ---------------- keyboard --------------------------------------- */

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? PAN_STEP_FINE : PAN_STEP;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          markAdjusted();
          const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
          const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
          setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
          break;
        }
        case '+':
        case '=':
          e.preventDefault();
          zoomByCentre(1.2);
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomByCentre(1 / 1.2);
          break;
        case '0':
          e.preventDefault();
          reset();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          fit();
          break;
        case 'Escape':
          if (selectedId) {
            e.preventDefault();
            onSelect(null);
          }
          break;
        default:
          break;
      }
    },
    [fit, markAdjusted, onSelect, reset, selectedId, zoomByCentre],
  );

  /* ---------------- keep a focused node on screen ------------------- */

  /*
   * Tab order follows the layout, so a keyboard reader will reach nodes that
   * are currently off-canvas. Focusing something invisible is the classic way
   * a pannable surface fails an accessibility review, so the transform is
   * nudged the minimum distance that brings the node fully inside.
   */
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const revealNode = useCallback(
    (id: string) => {
      const placed = nodeById.get(id);
      if (!placed || size.width <= 0) return;
      const margin = 24;
      /*
       * Deliberately does NOT mark the view as user-adjusted. Revealing is the
       * canvas correcting itself, not the reader choosing a viewpoint, and
       * treating it as a choice would suppress the refit below.
       */
      setView((v) => {
        const left = placed.x * v.k + v.x;
        const top = placed.y * v.k + v.y;
        const right = left + placed.width * v.k;
        const bottom = top + placed.height * v.k;
        let dx = 0;
        let dy = 0;
        if (left < margin) dx = margin - left;
        else if (right > size.width - margin) dx = Math.max(size.width - margin - right, margin - left);
        if (top < margin) dy = margin - top;
        else if (bottom > size.height - margin) dy = Math.max(size.height - margin - bottom, margin - top);
        if (dx === 0 && dy === 0) return v;
        return { ...v, x: v.x + dx, y: v.y + dy };
      });
    },
    [nodeById, size.width, size.height],
  );

  /*
   * Opening the inspector takes 360px off the canvas, which can push the very
   * node that was just selected off-screen. Re-revealing after any resize keeps
   * the subject of the panel visible; when the view has not been touched the
   * refit above has already run, and this is a no-op.
   */
  useEffect(() => {
    if (selectedId) revealNode(selectedId);
  }, [selectedId, revealNode, size.width, size.height]);

  /* ---------------- derived ---------------------------------------- */

  const detail = view.k >= DETAIL_THRESHOLD ? 'full' : 'compact';

  /** Edges touching the selection stay lit; the rest recede so the path reads. */
  const isRelated = useCallback(
    (from: string, to: string) => !selectedId || from === selectedId || to === selectedId,
    [selectedId],
  );

  const layerStyle: CSSProperties = {
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
    transformOrigin: '0 0',
    width: layout.bounds.width,
    height: layout.bounds.height,
  };

  /*
   * The dot grid is painted on the viewport rather than drawn, so it is one
   * background-image instead of thousands of nodes, and it is free to be
   * genuinely infinite. Its period doubles as the canvas shrinks so the dots
   * never crowd into a solid tint at low zoom.
   */
  const basePeriod = 24 * view.k;
  const period = basePeriod < 11 ? basePeriod * 4 : basePeriod < 22 ? basePeriod * 2 : basePeriod;
  const gridStyle: CSSProperties = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, var(--gridline) 1px, transparent 0)',
    backgroundSize: `${period}px ${period}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <div ref={boxRef} className={cn('relative w-full', className)}>
      <div
        ref={viewportRef}
        role="group"
        aria-label={ariaLabel}
        aria-roledescription="Pannable, zoomable graph"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        // Clicking the background is the natural way to dismiss the inspector.
        // Guarded on the target so the click that ends a pan does not deselect.
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBackground === 'true') {
            onSelect(null);
          }
        }}
        style={{ ...gridStyle, touchAction: 'none' }}
        className={cn(
          'absolute inset-0 overflow-hidden rounded-xl bg-sunken',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div data-canvas-background="true" className="absolute inset-0" />

        {size.width > 0 ? (
          <div data-canvas-layer="true" className="absolute left-0 top-0 will-change-transform" style={layerStyle}>
            {/* Lane bands sit furthest back: they are context, not content. */}
            {layout.lanes.map((lane, i) => (
              <div
                key={lane.lane}
                aria-hidden="true"
                className={cn('absolute top-0 rounded-lg', i % 2 === 1 && 'bg-surface opacity-40')}
                style={{
                  left: lane.x - layout.options.colGap / 2,
                  width: lane.width + layout.options.colGap,
                  height: layout.bounds.height - layout.options.padding,
                }}
              />
            ))}
            {layout.lanes.map((lane) => (
              <div
                key={`caption-${lane.lane}`}
                aria-hidden="true"
                className="absolute truncate text-mini font-semibold uppercase tracking-[0.07em] text-ink-muted"
                style={{
                  left: lane.x,
                  top: layout.options.padding,
                  width: lane.width,
                  height: layout.options.laneHeaderHeight,
                }}
              >
                {lane.label}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-muted/70">
                  {lane.nodeCount} node{lane.nodeCount === 1 ? '' : 's'}
                </span>
              </div>
            ))}

            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={layout.bounds.width}
              height={layout.bounds.height}
            >
              <defs>
                {(['sequence', 'data', 'feedback'] as const).map((kind) => (
                  <marker
                    key={kind}
                    id={`${markerId}-arrow-${kind}`}
                    viewBox="0 0 8 8"
                    refX={7}
                    refY={4}
                    markerWidth={8}
                    markerHeight={8}
                    // Fixed size in user space: markers otherwise scale with
                    // stroke width, which would make the three edge kinds
                    // arrive with three different arrowheads.
                    markerUnits="userSpaceOnUse"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 7 4 L 0 7 z" fill={EDGE_STROKE[kind]} />
                  </marker>
                ))}
              </defs>
              {layout.edges.map((edge) => {
                const lit = isRelated(edge.edge.from, edge.edge.to);
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke={EDGE_STROKE[edge.kind]}
                    strokeWidth={EDGE_WIDTH[edge.kind]}
                    strokeDasharray={EDGE_DASH[edge.kind]}
                    strokeLinecap="round"
                    markerEnd={`url(#${markerId}-arrow-${edge.kind})`}
                    opacity={lit ? 0.85 : 0.18}
                  />
                );
              })}
              {detail === 'full'
                ? layout.edges
                    .filter((e) => Boolean(e.edge.label))
                    .map((edge) => (
                      <text
                        key={`label-${edge.id}`}
                        x={edge.labelX}
                        y={edge.labelY - 5}
                        textAnchor="middle"
                        fontSize={10}
                        fill="var(--text-muted)"
                        opacity={isRelated(edge.edge.from, edge.edge.to) ? 1 : 0.25}
                      >
                        {edge.edge.label}
                      </text>
                    ))
                : null}
            </svg>

            {layout.nodes.map((placed: PositionedNode) => (
              <RunNode
                key={placed.id}
                placed={placed}
                selected={placed.id === selectedId}
                run={placed.node.runId ? runsById?.get(placed.node.runId) ?? null : null}
                detail={detail}
                onSelect={onSelect}
                onFocus={revealNode}
              />
            ))}
          </div>
        ) : null}

        {/* Controls float over the canvas; they are chrome, not content. */}
        <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg bg-surface p-1 shadow-card ring-1 ring-[var(--ring)]">
          <CanvasButton label="Zoom in" onClick={() => zoomByCentre(1.25)} disabled={view.k >= MAX_ZOOM - 1e-6}>
            <Plus size={14} />
          </CanvasButton>
          <CanvasButton label="Zoom out" onClick={() => zoomByCentre(1 / 1.25)} disabled={view.k <= MIN_ZOOM + 1e-6}>
            <Minus size={14} />
          </CanvasButton>
          <CanvasButton label="Fit to view" onClick={fit}>
            <Maximize2 size={13} />
          </CanvasButton>
          <CanvasButton label="Reset to 100%" onClick={reset}>
            <Crosshair size={13} />
          </CanvasButton>
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-surface/90 px-1.5 py-0.5 text-micro font-medium tabular text-ink-muted ring-1 ring-[var(--ring)]">
          {Math.round(view.k * 100)}%
        </div>
      </div>
    </div>
  );
}

function CanvasButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors',
        'hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
