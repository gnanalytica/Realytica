import type { RunGraph, RunGraphEdge, RunGraphEdgeKind, RunGraphNode } from '@realytica/shared';

/**
 * `RunGraph` → pixel geometry. Pure, deterministic, and deliberately free of
 * React so it can be reasoned about (and tested) on its own.
 *
 * Why a bespoke layout rather than a graph library: the orchestrator has
 * already decided the structure. `RunGraphNode.lane` *is* the execution layer —
 * nodes sharing a lane ran concurrently — so there is no ranking problem left
 * to solve. A generic layered-DAG engine (dagre, elk) would re-derive ranks it
 * was just handed, occasionally disagree with the schedule, and cost more
 * bundle than the whole canvas. Drawing the schedule literally is both smaller
 * and more truthful.
 *
 * ── Orientation: lanes are columns, left to right ────────────────────────
 * Two defensible choices; columns win here for three reasons.
 *
 *  1. A lane is a step in time. Left-to-right is how this audience already
 *     reads a pipeline, and it matches the run timeline elsewhere in the app.
 *  2. Fan-out is the common shape (one planner → many agents). Fan-out in a
 *     column stacks *vertically*, and vertical space is the cheap axis: a node
 *     card needs ~240px of width to hold "provider · model" without truncating
 *     to uselessness, but only ~108px of height. Lanes-as-rows would put the
 *     expensive axis on the growing side.
 *  3. Edges then run horizontally into the left edge of a node, which leaves
 *     the node's own text unobstructed.
 *
 * ── The row grid, and why every node snaps to it ─────────────────────────
 * Every node in the graph — whatever its lane — sits on one shared vertical
 * grid of pitch `nodeHeight + rowGap`. That is not cosmetic. It means the
 * horizontal band between any two rows is guaranteed free of nodes *across the
 * entire graph*, which turns edge routing from a collision-avoidance problem
 * into arithmetic: a lane-skipping edge is routed along one of those bands and
 * provably cannot cut through a node.
 *
 * The cost is that a short column cannot be perfectly centred against a tall
 * one — centring by half a row would break the invariant. Columns are instead
 * offset by a whole number of rows, which is near-centred and keeps the grid.
 *
 * ── Wrapping, and why a 40-node fan-out is not one 40-node column ────────
 * A lane with forty concurrent nodes drawn as a single column is 4,600px tall;
 * fit-to-view then renders it at ~0.13 scale, which is a picture of a graph
 * rather than a graph. Lanes therefore wrap into sub-columns once they exceed
 * `maxRowsPerColumn`. Sub-columns of one lane are separated by the ordinary
 * column gap and lanes by a wider gap, so the grouping still reads as one lane.
 */

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  /** Vertical space between rows. Also the height of every routing channel. */
  rowGap: number;
  /** Horizontal space between sub-columns of the same lane. */
  colGap: number;
  /** Horizontal space between lanes — wider, so the grouping is visible. */
  laneGap: number;
  /** Above this, a lane wraps into further sub-columns. */
  maxRowsPerColumn: number;
  /** Slack around the whole drawing, so edges and focus rings are never clipped. */
  padding: number;
  /** Reserved above the first row for the lane captions. */
  laneHeaderHeight: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeWidth: 244,
  nodeHeight: 108,
  rowGap: 28,
  colGap: 56,
  laneGap: 92,
  maxRowsPerColumn: 8,
  padding: 48,
  laneHeaderHeight: 28,
};

/* ------------------------------------------------------------------ */
/* Output shapes                                                       */
/* ------------------------------------------------------------------ */

export interface PositionedNode {
  id: string;
  node: RunGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Global column index, counting sub-columns. Adjacency is defined on this. */
  col: number;
  /** Global row index on the shared grid. */
  row: number;
  lane: number;
}

export interface RoutedEdge {
  id: string;
  edge: RunGraphEdge;
  kind: RunGraphEdgeKind;
  /** SVG path data, in layout coordinates. */
  path: string;
  /** Where a label, if any, should sit — the midpoint of the longest run. */
  labelX: number;
  labelY: number;
}

/** One lane's horizontal extent, for the caption and the background band. */
export interface LaneBand {
  lane: number;
  label: string;
  x: number;
  width: number;
  /** How many sub-columns the lane wrapped into. */
  columns: number;
  nodeCount: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  lanes: LaneBand[];
  /** Everything drawn fits inside this. Origin is (0, 0) by construction. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Node ids that appear on an edge but not in `nodes` — dropped, and counted. */
  danglingEdges: number;
  options: LayoutOptions;
}

/* ------------------------------------------------------------------ */
/* Path helpers                                                        */
/* ------------------------------------------------------------------ */

type Point = { x: number; y: number };

/**
 * An orthogonal polyline with rounded corners.
 *
 * Corners are quadratic curves rather than arcs: the control point is the
 * corner itself, which is exact for a 90° turn and one operator shorter. The
 * radius shrinks to fit the shorter of the two adjacent segments so a tight
 * dog-leg degrades to a sharp corner instead of overshooting into a node.
 */
function orthPath(points: Point[], radius = 10): string {
  const pts = dedupe(points);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${r2(pts[0].x)} ${r2(pts[0].y)}`;

  let d = `M ${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const rr = Math.min(radius, inLen / 2, outLen / 2);
    if (rr < 0.5) {
      d += ` L ${r2(curr.x)} ${r2(curr.y)}`;
      continue;
    }
    const a = towards(curr, prev, rr);
    const b = towards(curr, next, rr);
    d += ` L ${r2(a.x)} ${r2(a.y)} Q ${r2(curr.x)} ${r2(curr.y)} ${r2(b.x)} ${r2(b.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${r2(last.x)} ${r2(last.y)}`;
  return d;
}

function towards(from: Point, to: Point, dist: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.01 && Math.abs(prev.y - p.y) < 0.01) continue;
    out.push(p);
  }
  return out;
}

/** Two decimals is under a tenth of a pixel at maximum zoom, and keeps paths short. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Midpoint of the longest axis-aligned run in a polyline — where a label reads best. */
function longestRunMidpoint(points: Point[]): Point {
  const pts = dedupe(points);
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let best = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  let bestLen = -1;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len > bestLen) {
      bestLen = len;
      best = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lay a run graph out.
 *
 * Deterministic in the strong sense: the same `RunGraph` object always yields
 * byte-identical geometry. Ordering within a lane is the order the nodes appear
 * in `graph.nodes` — the orchestrator's own order — never a sort by id or
 * label, because re-sorting would silently reorder a schedule the caller
 * already decided.
 */
export function layoutRunGraph(graph: RunGraph, overrides?: Partial<LayoutOptions>): GraphLayout {
  const opt: LayoutOptions = { ...DEFAULT_LAYOUT, ...overrides };
  const rowPitch = opt.nodeHeight + opt.rowGap;
  const topOffset = opt.padding + opt.laneHeaderHeight;

  /*
   * Lane discovery. `graph.lanes` is the caption source, but a node may carry a
   * lane index the lanes array forgot to declare. Dropping such a node would
   * lose a step that actually ran, so an undeclared lane is synthesised with a
   * neutral caption rather than discarded.
   */
  const declared = new Map<number, string>();
  for (const lane of graph.lanes) declared.set(lane.index, lane.label);
  const laneIndices = Array.from(new Set([...declared.keys(), ...graph.nodes.map((n) => n.lane)])).sort(
    (a, b) => a - b,
  );

  const positioned: PositionedNode[] = [];
  const lanes: LaneBand[] = [];

  // First pass: assign columns and rows, and record how many rows the tallest
  // column needs. Column x positions depend only on the columns before them, so
  // they can be accumulated in the same sweep.
  let cursorX = opt.padding;
  let globalCol = 0;
  let maxRows = 0;

  interface PendingColumn {
    x: number;
    nodes: RunGraphNode[];
    col: number;
    lane: number;
  }
  const columns: PendingColumn[] = [];

  laneIndices.forEach((laneIndex, laneOrdinal) => {
    const laneNodes = graph.nodes.filter((n) => n.lane === laneIndex);
    const columnCount = Math.max(1, Math.ceil(laneNodes.length / opt.maxRowsPerColumn));
    // Spread evenly rather than filling the first column to the brim: a lane of
    // nine with a limit of eight should read as 5 + 4, not 8 + 1.
    const perColumn = Math.max(1, Math.ceil(laneNodes.length / columnCount));

    if (laneOrdinal > 0) cursorX += opt.laneGap;
    const laneX = cursorX;

    for (let c = 0; c < columnCount; c++) {
      if (c > 0) cursorX += opt.colGap;
      const slice = laneNodes.slice(c * perColumn, (c + 1) * perColumn);
      columns.push({ x: cursorX, nodes: slice, col: globalCol, lane: laneIndex });
      maxRows = Math.max(maxRows, slice.length);
      globalCol += 1;
      cursorX += opt.nodeWidth;
    }

    lanes.push({
      lane: laneIndex,
      label: declared.get(laneIndex) ?? `Layer ${laneIndex}`,
      x: laneX,
      width: cursorX - laneX,
      columns: columnCount,
      nodeCount: laneNodes.length,
    });
  });

  // Second pass: vertical placement. Each column is nudged down by a whole
  // number of rows so it sits near the vertical centre without leaving the grid.
  for (const column of columns) {
    const offsetRows = Math.floor((maxRows - column.nodes.length) / 2);
    column.nodes.forEach((node, i) => {
      const row = offsetRows + i;
      positioned.push({
        id: node.id,
        node,
        x: column.x,
        y: topOffset + row * rowPitch,
        width: opt.nodeWidth,
        height: opt.nodeHeight,
        col: column.col,
        row,
        lane: column.lane,
      });
    });
  }

  const byId = new Map(positioned.map((p) => [p.id, p]));

  /** Centre of the free horizontal band immediately below grid row `row`. */
  const channelY = (row: number) => topOffset + row * rowPitch + opt.nodeHeight + opt.rowGap / 2;

  const laneOfCol = new Map<number, number>();
  for (const c of columns) laneOfCol.set(c.col, c.lane);

  // The gutter either side of a column is the lane gap at a lane boundary, the
  // column gap inside a lane, and the outer padding at the ends of the drawing.
  const gapBefore = (p: PositionedNode) => {
    const neighbour = laneOfCol.get(p.col - 1);
    if (neighbour === undefined) return opt.padding;
    return neighbour === p.lane ? opt.colGap : opt.laneGap;
  };
  const gapAfter = (p: PositionedNode) => {
    const neighbour = laneOfCol.get(p.col + 1);
    if (neighbour === undefined) return opt.padding;
    return neighbour === p.lane ? opt.colGap : opt.laneGap;
  };

  /** Mid-gutter x immediately left of a column, and immediately right of one. */
  const gutterLeft = (p: PositionedNode) => p.x - gapBefore(p) / 2;
  const gutterRight = (p: PositionedNode) => p.x + p.width + gapAfter(p) / 2;

  const edges: RoutedEdge[] = [];
  let dangling = 0;

  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || from.id === to.id) {
      // A self-loop or an edge to a node the graph did not include is not
      // drawable. Counted so the UI can say the picture is incomplete rather
      // than quietly showing fewer edges than the data has.
      dangling += 1;
      continue;
    }

    const sy = from.y + from.height / 2;
    const ty = to.y + to.height / 2;
    let path: string;
    let anchor: Point;

    if (to.col === from.col + 1) {
      /*
       * Adjacent columns: a smooth curve. Both control points sit on the
       * horizontal through their own endpoint, so the curve's convex hull —
       * and therefore the curve — stays inside the gutter, which contains no
       * nodes. Smooth reads better than orthogonal for the common case, which
       * is the overwhelming majority of edges in a layered schedule.
       */
      const sx = from.x + from.width;
      const tx = to.x;
      const bend = Math.max(18, (tx - sx) * 0.5);
      path = `M ${r2(sx)} ${r2(sy)} C ${r2(sx + bend)} ${r2(sy)}, ${r2(tx - bend)} ${r2(ty)}, ${r2(tx)} ${r2(ty)}`;
      anchor = { x: (sx + tx) / 2, y: (sy + ty) / 2 };
    } else if (to.col > from.col) {
      /*
       * Forward but skipping at least one column. The horizontal run has to
       * cross columns that contain nodes, so it is placed in a routing channel
       * — one of the guaranteed-free bands between grid rows — chosen adjacent
       * to the *target* row, which keeps the final approach short and makes
       * parallel skipping edges fan out rather than overlap.
       */
      const sx = from.x + from.width;
      const tx = to.x;
      const channel = ty >= sy ? channelY(to.row - 1) : channelY(to.row);
      const pts: Point[] = [
        { x: sx, y: sy },
        { x: gutterRight(from), y: sy },
        { x: gutterRight(from), y: channel },
        { x: gutterLeft(to), y: channel },
        { x: gutterLeft(to), y: ty },
        { x: tx, y: ty },
      ];
      path = orthPath(pts);
      anchor = longestRunMidpoint(pts);
    } else {
      /*
       * Backward: a feedback edge, where something downstream caused an
       * upstream step to run again. Drawn leaving the *bottom* of the source
       * rather than its right edge, because a line that travels right-to-left
       * out of the usual exit point reads as a mistake; leaving from below
       * reads as a return path. Every segment still lives in a channel or a
       * gutter, so it cannot cross a node.
       */
      const channel = channelY(from.row);
      const pts: Point[] = [
        { x: from.x + from.width / 2, y: from.y + from.height },
        { x: from.x + from.width / 2, y: channel },
        { x: gutterLeft(to), y: channel },
        { x: gutterLeft(to), y: ty },
        { x: to.x, y: ty },
      ];
      path = orthPath(pts);
      anchor = longestRunMidpoint(pts);
    }

    edges.push({ id: edge.id, edge, kind: edge.kind, path, labelX: anchor.x, labelY: anchor.y });
  }

  const contentRight = columns.length > 0 ? cursorX : opt.padding;
  const contentBottom = maxRows > 0 ? topOffset + maxRows * rowPitch - opt.rowGap : topOffset;

  return {
    nodes: positioned,
    edges,
    lanes,
    bounds: {
      x: 0,
      y: 0,
      width: Math.max(contentRight + opt.padding, opt.padding * 2),
      // The trailing padding also has to clear the deepest routing channel,
      // which sits rowGap/2 below the last row.
      height: Math.max(contentBottom + opt.padding, opt.padding * 2),
    },
    danglingEdges: dangling,
    options: opt,
  };
}
