import type { RunGraphEdge, RunGraphEdgeKind, RunGraphNode } from '@realytica/shared';

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

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */
