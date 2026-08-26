import { useMemo, useState } from 'react';
import type { TitleEdge, TitleGraph, TitleGraphSummary, TitleNode, TitleNodeKind } from '@realytica/shared';
import { Badge, cn } from '../ui/kit';
import { date } from '../../lib/format';

export interface TitleChainDiagramProps {
  graph: TitleGraph;
  /** The findings, so a break can be drawn on the structure it is about. */
  summary?: TitleGraphSummary;
  height?: number;
}

/*
 * Columns by role, not by time.
 *
 * The first instinct is a timeline, and it is wrong here: a third of the
 * instruments in a Bengaluru chain carry no execution date at all — that is
 * one of the findings the graph exists to surface — so time cannot be the
 * primary axis without inventing positions for the undated. Role is always
 * known. Reading left to right is then "who, through what, over what, subject
 * to what", which is the order a title opinion is written in.
 */
const COLUMNS: { kind: TitleNodeKind; label: string }[] = [
  { kind: 'party', label: 'Parties' },
  { kind: 'instrument', label: 'Instruments' },
  { kind: 'parcel', label: 'Parcels' },
  { kind: 'approval', label: 'Approvals' },
  { kind: 'encumbrance', label: 'Encumbrances' },
  { kind: 'authority', label: 'Authorities' },
];

/*
 * Sized so six columns fit a laptop without scrolling.
 *
 * At 168px wide with a 74px gap the authorities column fell off the right edge
 * of a 1600px window, and a diagram whose last column is only reachable by
 * scrolling is one most people will never know is there. 150 + 52 puts all six
 * inside ~1180px; the container still scrolls for a graph wider than that.
 */
const NODE_W = 150;
const NODE_H = 44;
const COL_GAP = 52;
const ROW_GAP = 14;
const PAD = 12;

const KIND_FILL: Record<TitleNodeKind, string> = {
  party: 'var(--series-7)',
  instrument: 'var(--series-1)',
  parcel: 'var(--series-3)',
  approval: 'var(--series-6)',
  encumbrance: 'var(--series-2)',
  authority: 'var(--series-4)',
};

/** Edges that carry the chain of title, drawn solid; everything else is context. */
const STRUCTURAL = new Set(['conveyed_to', 'conveyed_by', 'derives_from', 'supersedes']);

interface Placed {
  node: TitleNode;
  x: number;
  y: number;
}

/**
 * The chain of title, drawn.
 *
 * Eleven nodes and fifteen edges on a typical case, and until now the only
 * rendering was prose. The findings are structural — a chain with no root, an
 * instrument that cannot be placed because it carries no date, two documents
 * claiming different areas for one parcel — and structure is the thing a
 * sentence describes worst and a diagram shows at a glance.
 *
 * Deliberately not the pan-and-zoom canvas used for the run graph. That canvas
 * earns its complexity on a forty-node fan-out; a title chain is a dozen nodes
 * that should be legible without anyone touching a control, and something a
 * user is going to print into a report.
 */
export default function TitleChainDiagram({ graph, summary, height }: TitleChainDiagramProps) {
  const [hover, setHover] = useState<string | null>(null);

  const { placed, width, svgHeight, edges } = useMemo(() => {
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const cols = COLUMNS.map(c => ({ ...c, nodes: graph.nodes.filter(n => n.kind === c.kind) })).filter(c => c.nodes.length > 0);
    const placedNodes: Placed[] = [];
    cols.forEach((col, ci) => {
      col.nodes.forEach((n, ri) => {
        placedNodes.push({ node: n, x: PAD + ci * (NODE_W + COL_GAP), y: PAD + 22 + ri * (NODE_H + ROW_GAP) });
      });
    });
    const rows = Math.max(...cols.map(c => c.nodes.length), 1);
    return {
      placed: placedNodes,
      width: PAD * 2 + cols.length * NODE_W + Math.max(0, cols.length - 1) * COL_GAP,
      svgHeight: PAD * 2 + 22 + rows * (NODE_H + ROW_GAP),
      // Self-edges and edges to a node the graph does not contain are dropped
      // rather than drawn to nowhere; `identifies` is a merge decision, not a
      // relationship anyone reading a chain wants to see. `describes_boundary`
      // is dropped for a different reason: every deed contributes four of
      // them between the same two nodes, so drawing them adds eight parallel
      // lines that say nothing about the chain. The schedule of property is
      // drawn properly, as a compass, in its own card below this one.
      edges: graph.edges.filter(
        e =>
          e.kind !== 'identifies'
          && e.kind !== 'describes_boundary'
          && e.fromNodeId !== e.toNodeId
          && byId.has(e.fromNodeId)
          && byId.has(e.toNodeId),
      ),
      cols,
    };
  }, [graph]);

  const pos = new Map(placed.map(p => [p.node.id, p]));

  /** Nodes a break or contradiction names, so the finding lands on the structure. */
  const flagged = useMemo(() => {
    const out = new Set<string>();
    for (const chain of summary?.chains ?? []) {
      if (chain.parcelNodeId) out.add(chain.parcelNodeId);
    }
    return out;
  }, [summary]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-lg bg-sunken p-3 text-xs text-ink-secondary">
        No title graph could be built for this case — no document on file asserts a party, a parcel or an instrument.
      </p>
    );
  }

  const H = height ?? svgHeight;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          aria-label={`Title graph: ${graph.nodes.length} nodes and ${edges.length} relationships across ${COLUMNS.filter(c => graph.nodes.some(n => n.kind === c.kind)).length} kinds`}
        >
          <title>Chain of title</title>
          <desc>
            {COLUMNS.filter(c => graph.nodes.some(n => n.kind === c.kind))
              .map(c => `${graph.nodes.filter(n => n.kind === c.kind).length} ${c.label.toLowerCase()}`)
              .join(', ')}
            .
          </desc>

          {COLUMNS.filter(c => graph.nodes.some(n => n.kind === c.kind)).map((c, ci) => (
            <text
              key={c.kind}
              x={PAD + ci * (NODE_W + COL_GAP)}
              y={PAD + 10}
              className="fill-[var(--text-muted)] text-[10px] font-medium uppercase tracking-wide"
            >
              {c.label}
            </text>
          ))}

          {edges.map(e => {
            const a = pos.get(e.fromNodeId);
            const b = pos.get(e.toNodeId);
            if (!a || !b) return null;
            const forward = b.x >= a.x;
            const x1 = forward ? a.x + NODE_W : a.x;
            const x2 = forward ? b.x : b.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const on = hover === e.fromNodeId || hover === e.toNodeId;
            return (
              <path
                key={e.id}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={on ? 'var(--brand-strong)' : 'var(--gridline)'}
                strokeWidth={on ? 1.6 : 1}
                strokeDasharray={STRUCTURAL.has(e.kind) ? undefined : '3 3'}
                opacity={hover && !on ? 0.25 : 1}
              >
                <title>{`${e.label}${e.validFrom ? ` (${date(e.validFrom)})` : ''}`}</title>
              </path>
            );
          })}

          {placed.map(p => {
            const on = hover === p.node.id;
            const isFlagged = flagged.has(p.node.id);
            return (
              <g
                key={p.node.id}
                data-title-node={p.node.id}
                onMouseEnter={() => setHover(p.node.id)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={p.x}
                  y={p.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  fill="var(--surface-1)"
                  stroke={isFlagged ? 'rgb(var(--status-critical-rgb))' : on ? 'var(--brand-strong)' : 'var(--ring)'}
                  strokeWidth={isFlagged ? 2 : 1}
                />
                <rect x={p.x} y={p.y} width={3} height={NODE_H} rx={1.5} fill={KIND_FILL[p.node.kind]} />
                <text x={p.x + 10} y={p.y + 18} className="fill-[var(--text-primary)] text-[11px] font-medium">
                  {p.node.label.length > 21 ? `${p.node.label.slice(0, 20)}…` : p.node.label}
                </text>
                <text x={p.x + 10} y={p.y + 32} className="fill-[var(--text-muted)] text-[10px]">
                  {p.node.assertedBy.length} source{p.node.assertedBy.length === 1 ? '' : 's'}
                </text>
                <title>{`${p.node.label} — ${p.node.kind}, asserted by ${p.node.assertedBy.length} source(s)`}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {COLUMNS.filter(c => graph.nodes.some(n => n.kind === c.kind)).map(c => (
          <span key={c.kind} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: KIND_FILL[c.kind] }} />
            {c.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" stroke="var(--gridline)" strokeWidth="1.4" strokeDasharray="3 3" />
          </svg>
          Context, not the chain itself
        </span>
      </div>
      {summary && summary.chains.some(c => c.breaks.length > 0) ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
          <Badge tone="critical">Outlined in red</Badge> — a parcel whose chain of title has a break. What the break is,
          and how to close it, is listed below.
        </p>
      ) : null}
    </div>
  );
}
