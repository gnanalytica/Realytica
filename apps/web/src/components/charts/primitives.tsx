import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../ui/kit';

/**
 * Shared, chart-agnostic infrastructure for every hand-written SVG chart in
 * `components/charts`. No charting dependency — this is the whole toolkit:
 * responsive measurement, linear scales, "nice" tick generation, a
 * theme-aware legend, and a floating tooltip layer with a crosshair helper.
 */

/* ------------------------------------------------------------------ */
/* Responsive measurement                                              */
/* ------------------------------------------------------------------ */

export interface Size {
  width: number;
  height: number;
}

/**
 * Measures a container element's box with ResizeObserver. Starts at {0,0} until
 * the first layout pass, so callers render a same-height placeholder first.
 *
 * The observer is attached from the ref *setter* rather than an effect, because
 * every chart here swaps its placeholder `<div>` for a different container once
 * it has a width. A plain `useEffect(..., [])` would keep observing the
 * now-detached placeholder, which reports 0x0 the moment it leaves the DOM —
 * collapsing the chart back to its placeholder for good. Re-attaching on node
 * change, and ignoring 0x0 reports from detached nodes, keeps that swap stable.
 */
export function useMeasure<T extends HTMLElement = HTMLDivElement>(): [RefObject<T>, Size] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const nodeRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback((el: T) => {
    const width = Math.round(el.clientWidth);
    const height = Math.round(el.clientHeight);
    if (width <= 0 && height <= 0) return;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const ref = useMemo(() => {
    const holder = {
      get current(): T | null {
        return nodeRef.current;
      },
      set current(el: T | null) {
        if (nodeRef.current === el) return;
        observerRef.current?.disconnect();
        observerRef.current = null;
        nodeRef.current = el;
        if (!el) return;
        measure(el);
        const ro = new ResizeObserver(() => measure(el));
        ro.observe(el);
        observerRef.current = ro;
      },
    };
    return holder as RefObject<T>;
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, size];
}

/* ------------------------------------------------------------------ */
/* Scales & ticks                                                      */
/* ------------------------------------------------------------------ */

/** A linear scale from a numeric domain to a pixel range. Clamps nothing — callers pad the domain. */
export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function niceStep(roughStep: number): number {
  if (roughStep <= 0 || !Number.isFinite(roughStep)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / pow;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * pow;
}

/** Clean, evenly-spaced tick values covering [min, max] — never more than ~`count` ticks. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) return [min];
  const step = niceStep((max - min) / Math.max(1, count));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks.length > 0 ? ticks : [min, max];
}

/** Pads a [min, max] domain by a fraction on each side; guards the degenerate min===max case. */
export function padDomain(min: number, max: number, frac = 0.08): [number, number] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const span = max - min;
  return [min - span * frac, max + span * frac];
}

/** Compact axis-tick number formatting — no currency symbol, for generic value/percent axes. */
export function compactAxisNumber(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${trimNum(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trimNum(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trimNum(abs / 1e3)}K`;
  return `${sign}${trimNum(abs)}`;
}

function trimNum(n: number): string {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(r);
}

/* ------------------------------------------------------------------ */
/* Accessible SVG shell                                                */
/* ------------------------------------------------------------------ */

/**
 * The standard SVG root: `role="img"` + `aria-label`, plus `<title>`/`<desc>`
 * inside the markup itself so the summary survives copy/paste and print.
 */
export function ChartSvg({
  width,
  height,
  ariaLabel,
  title,
  desc,
  children,
  className,
  viewBox,
}: {
  width: number;
  height: number;
  ariaLabel: string;
  title: string;
  desc: string;
  children: ReactNode;
  className?: string;
  viewBox?: string;
}) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={w}
      height={h}
      viewBox={viewBox ?? `0 0 ${w} ${h}`}
      className={className}
    >
      <title>{title}</title>
      <desc>{desc}</desc>
      {children}
    </svg>
  );
}

/** A recessive hairline gridline, drawn behind the marks. */
export function GridLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges" />;
}

/** The zero/neutral baseline for a diverging chart — one step more visible than a plain gridline. */
export function BaselineAxis({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />;
}

/** Small muted tick-label text, 10–11px, recessive by default. */
export function TickText({
  x,
  y,
  children,
  anchor = 'middle',
  baseline = 'middle',
  size = 10,
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: 'start' | 'middle' | 'end';
  baseline?: 'middle' | 'hanging' | 'auto';
  size?: 10 | 11;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline={baseline}
      fontSize={size}
      fill="var(--text-muted)"
    >
      {children}
    </text>
  );
}

/** A direct label riding a mark — always in an ink token, never the series color. */
export function MarkLabel({
  x,
  y,
  children,
  anchor = 'middle',
  baseline = 'middle',
  weight = 'medium',
  size = 11,
  tone = 'primary',
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: 'start' | 'middle' | 'end';
  baseline?: 'middle' | 'hanging' | 'auto';
  weight?: 'medium' | 'semibold';
  size?: number;
  tone?: 'primary' | 'secondary' | 'inverse';
}) {
  const fill = tone === 'inverse' ? 'var(--text-inverse)' : tone === 'secondary' ? 'var(--text-secondary)' : 'var(--text-primary)';
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline={baseline}
      fontSize={size}
      fontWeight={weight === 'semibold' ? 600 : 500}
      fill={fill}
    >
      {children}
    </text>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

export interface LegendItem {
  label: string;
  color: string;
  /** 'line' for line series, 'rect' (default) for bars/areas/dots. */
  shape?: 'rect' | 'line';
}

/** Present whenever there are >=2 series; a single series names itself via the card title instead. */
export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  if (items.length < 2) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)} role="list">
      {items.map((it) => (
        <span key={it.label} role="listitem" className="inline-flex items-center gap-1.5 text-[11px] text-ink-secondary">
          {it.shape === 'line' ? (
            <span className="inline-block h-[2px] w-3 shrink-0 rounded-full" style={{ background: it.color }} />
          ) : (
            <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hover layer: tooltip + crosshair                                    */
/* ------------------------------------------------------------------ */

export interface TooltipState {
  /** Pixel position within the measured container. */
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * The floating tooltip layer. Renders nothing when `state` is null. Position
 * is clamped so it never runs off the left/right edge of the container.
 */
export function ChartTooltip({ state, containerWidth }: { state: TooltipState | null; containerWidth: number }) {
  if (!state) return null;
  const half = 84;
  const left = Math.min(Math.max(state.x, half), Math.max(containerWidth - half, half));
  const top = Math.max(state.y, 0);
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[15rem] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md bg-[var(--text-primary)] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--text-inverse)] shadow-pop"
      style={{ left, top }}
    >
      {state.content}
    </div>
  );
}

/** Value-first, label-second tooltip row — the reader has the series, wants the number. */
export function TooltipRow({ swatch, label, value }: { swatch?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {swatch ? <span className="inline-block h-[2px] w-2.5 shrink-0 rounded-full" style={{ background: swatch }} /> : null}
      <span className="font-semibold">{value}</span>
      <span className="opacity-75">{label}</span>
    </div>
  );
}

/** A crosshair hairline tracking the pointer's snapped X on a line/area chart. */
export function Crosshair({ x, y0, y1 }: { x: number; y0: number; y1: number }) {
  return <line x1={x} x2={x} y1={y0} y2={y1} stroke="var(--axis)" strokeWidth={1} strokeDasharray="0" shapeRendering="crispEdges" />;
}

/** Finds the index of the nearest value in a sorted numeric array of pixel positions. */
export function nearestIndex(positions: number[], px: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < positions.length; i++) {
    const d = Math.abs(positions[i] - px);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Standard container for a chart: relative-positioned so the tooltip layer can float over the SVG. */
export function ChartContainer({
  innerRef,
  className,
  style,
  children,
}: {
  innerRef: RefObject<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div ref={innerRef} className={cn('relative w-full', className)} style={style}>
      {children}
    </div>
  );
}

/**
 * A bar anchored to a baseline: a 4px-radius rounded data-end, square at the
 * baseline. `x0` is the baseline pixel position, `x1` the data-end pixel
 * position — works for both a plain 0-based bar (x0 < x1 always) and a
 * diverging bar that can grow either direction from a zero baseline.
 */
export function DirectedBar({
  x0,
  x1,
  y,
  height,
  fill,
  opacity = 1,
  radius = 4,
}: {
  x0: number;
  x1: number;
  y: number;
  height: number;
  fill: string;
  opacity?: number;
  radius?: number;
}) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const w = Math.max(1, right - left);
  const r = Math.min(radius, w / 2, height / 2);
  const baselineAtLeft = x0 <= x1;
  return (
    <g>
      <rect x={left} y={y} width={w} height={height} rx={r} fill={fill} opacity={opacity} />
      {r > 0.5 && w > r ? (
        <rect x={baselineAtLeft ? left : right - r} y={y} width={r} height={height} fill={fill} opacity={opacity} />
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Status colour lookup — reserved for state, never a series colour    */
/* ------------------------------------------------------------------ */

export type StatusKey = 'info' | 'good' | 'warning' | 'serious' | 'critical';

/** The bold status fill — for meter arcs, bar fills, and other small state-bearing marks. */
export const STATUS_FILL: Record<StatusKey, string> = {
  info: 'var(--brand)',
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  serious: 'var(--status-serious)',
  critical: 'var(--status-critical)',
};

/** The text-safe status colour — mirrors the app's Tone→text mapping in ui/kit.tsx. */
export const STATUS_TEXT: Record<StatusKey, string> = {
  info: 'var(--brand)',
  good: 'var(--status-good-text)',
  warning: 'var(--text-primary)',
  serious: 'var(--text-primary)',
  critical: 'var(--status-critical)',
};

/* ------------------------------------------------------------------ */
/* Arc geometry — for the gauge/ring meters                            */
/* ------------------------------------------------------------------ */

/** A point on a circle at `angleDeg` measured clockwise from 12 o'clock (0 = top, 90 = right, 180 = bottom, 270 = left). */
export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/** An SVG arc `d` path between two clock-angles, sweeping clockwise when `endDeg > startDeg`. */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
}

/** A reusable no-plot placeholder for charts given empty data. */
export function ChartEmpty({ label, height = 120 }: { label: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-hairline text-xs text-ink-muted"
      style={{ height }}
    >
      {label}
    </div>
  );
}
