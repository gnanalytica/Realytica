import type { Flow, FlowNode } from '@realytica/shared';

/**
 * Where things are on the canvas.
 *
 * Pure, and separate from React on purpose: every number here — a node's box,
 * a port's centre, the curve between two ports, which node a drop landed on —
 * is exercisable without rendering anything, and the alternative (geometry
 * computed inside a component) is the version nobody can test and everybody
 * is slightly afraid to change.
 */

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 76;
/** Ports sit on the node's edges; this is how far the hit target extends past them. */
export const PORT_RADIUS = 7;
export const GRID = 16;

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1 };
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.2;

/** Screen point → canvas point. */
export function toCanvas(point: Point, t: Transform): Point {
  return { x: (point.x - t.x) / t.scale, y: (point.y - t.y) / t.scale };
}

/** Canvas point → screen point. */
export function toScreen(point: Point, t: Transform): Point {
  return { x: point.x * t.scale + t.x, y: point.y * t.scale + t.y };
}

/** Zoom about a fixed screen point, so the thing under the cursor stays under it. */
export function zoomAbout(t: Transform, at: Point, factor: number): Transform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
  const k = scale / t.scale;
  return { scale, x: at.x - (at.x - t.x) * k, y: at.y - (at.y - t.y) * k };
}

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/** Where a node's single input connects. */
export function inputAt(node: FlowNode): Point {
  return { x: node.position.x, y: node.position.y + NODE_HEIGHT / 2 };
}

/**
 * Where one of a node's outputs connects.
 *
 * Ports are spread down the right edge rather than bunched at the middle, so a
 * branch with four cases has four distinguishable places to aim at — the whole
 * reason a branch is usable with a mouse.
 */
export function outputAt(node: FlowNode, ports: string[], port: string): Point {
  const index = Math.max(0, ports.indexOf(port));
  const span = NODE_HEIGHT / (ports.length + 1);
  return { x: node.position.x + NODE_WIDTH, y: node.position.y + span * (index + 1) };
}

/**
 * The wire between two points.
 *
 * A cubic with horizontal handles, because a connection that leaves rightwards
 * and arrives leftwards reads as a direction even when the target is above or
 * behind the source. The handle length grows with the gap and is clamped, so a
 * short hop is not a loop and a long one is not a straight line through three
 * other nodes.
 */
export function wirePath(from: Point, to: Point): string {
  const dx = Math.abs(to.x - from.x);
  const handle = Math.min(Math.max(dx * 0.5, 40), 160);
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
}

/** The node under a canvas point, topmost first. */
export function nodeAt(flow: Flow, point: Point): FlowNode | undefined {
  for (let i = flow.nodes.length - 1; i >= 0; i -= 1) {
    const node = flow.nodes[i]!;
    if (
      point.x >= node.position.x &&
      point.x <= node.position.x + NODE_WIDTH &&
      point.y >= node.position.y &&
      point.y <= node.position.y + NODE_HEIGHT
    ) {
      return node;
    }
  }
  return undefined;
}

/** The box every node fits inside, for fitting the view to the work. */
export function boundsOf(flow: Flow): { x: number; y: number; width: number; height: number } {
  if (flow.nodes.length === 0) return { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
  const xs = flow.nodes.map((n) => n.position.x);
  const ys = flow.nodes.map((n) => n.position.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) + NODE_WIDTH - x,
    height: Math.max(...ys) + NODE_HEIGHT - y,
  };
}

/**
 * A transform that puts the whole flow on screen with a margin.
 *
 * Never magnifies. A fit is "show me everything", and on a flow with two nodes
 * the arithmetic happily returns 2.2× — which renders a canvas of enormous
 * boxes and reads as a bug rather than as a fit. Zooming out to reveal is
 * useful; zooming in to fill is not what anybody meant.
 */
export function fitTo(flow: Flow, viewport: { width: number; height: number }, margin = 60): Transform {
  const box = boundsOf(flow);
  const scale = Math.min(
    1,
    Math.max(MIN_SCALE, Math.min((viewport.width - margin * 2) / box.width, (viewport.height - margin * 2) / box.height)),
  );
  return {
    scale,
    x: (viewport.width - box.width * scale) / 2 - box.x * scale,
    y: (viewport.height - box.height * scale) / 2 - box.y * scale,
  };
}

/**
 * Somewhere to put a new node that is not on top of an existing one.
 *
 * Dropped nodes land where the cursor was; nodes added from the palette by
 * click have no cursor to speak of, and stacking them all at one point is the
 * behaviour that makes a palette feel broken.
 */
export function freeSpotNear(flow: Flow, near: Point): Point {
  const taken = (p: Point) =>
    flow.nodes.some((n) => Math.abs(n.position.x - p.x) < NODE_WIDTH && Math.abs(n.position.y - p.y) < NODE_HEIGHT + 8);
  let spot = { x: snap(near.x), y: snap(near.y) };
  for (let i = 0; i < 40 && taken(spot); i += 1) {
    spot = { x: spot.x, y: spot.y + NODE_HEIGHT + GRID * 2 };
  }
  return spot;
}

/**
 * Where a node added from the palette should land.
 *
 * To the right of whatever is selected, or of the rightmost node — because the
 * wires run left to right and a flow built by clicking should come out reading
 * the same way. Stacking them down a column, which is what "somewhere free"
 * produces, makes every connection a diagonal across the ones below it and
 * reads as a broken canvas rather than an unarranged one.
 */
export function nextSpot(flow: Flow, selectedId: string | null): Point {
  const anchor =
    flow.nodes.find((n) => n.id === selectedId) ??
    [...flow.nodes].sort((a, b) => b.position.x - a.position.x)[0];
  if (!anchor) return { x: 80, y: 160 };
  return freeSpotNear(flow, { x: anchor.position.x + NODE_WIDTH + 72, y: anchor.position.y });
}

/**
 * A transform that brings one node into view, moving as little as possible.
 *
 * Adding nodes to the right eventually walks them off the edge, and a node
 * that exists but cannot be seen reads as a click that did nothing. Panning
 * the minimum rather than recentring matters: recentring on every addition
 * makes the whole canvas lurch, which is worse than the problem it fixes.
 */
export function reveal(
  t: Transform,
  node: { position: Point },
  viewport: { width: number; height: number },
  margin = 48,
): Transform {
  const left = node.position.x * t.scale + t.x;
  const top = node.position.y * t.scale + t.y;
  const right = left + NODE_WIDTH * t.scale;
  const bottom = top + NODE_HEIGHT * t.scale;

  let dx = 0;
  let dy = 0;
  if (right > viewport.width - margin) dx = viewport.width - margin - right;
  if (left + dx < margin) dx = margin - left;
  if (bottom > viewport.height - margin) dy = viewport.height - margin - bottom;
  if (top + dy < margin) dy = margin - top;

  return dx === 0 && dy === 0 ? t : { ...t, x: t.x + dx, y: t.y + dy };
}
