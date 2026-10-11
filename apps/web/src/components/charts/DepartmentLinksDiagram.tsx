import { useMemo, useState } from 'react';
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_SHORT,
  FUNCTION_SHORT,
  LINK_TYPE_LABEL,
  departmentDefinition,
  workstreamDefinition,
  type DepartmentKey,
  type ProjectLink,
} from '@realytica/shared';

export interface DepartmentLinksDiagramProps {
  /** Cross-department links to draw. */
  links: readonly ProjectLink[];
  /** The department this summary is for — its column is marked. */
  focus?: DepartmentKey;
  height?: number;
}

const NODE_W = 148;
const NODE_H = 44;
const COL_GAP = 56;
const ROW_GAP = 14;
const PAD = 12;
const HEADER = 22;

const DEPT_FILL: Record<DepartmentKey, string> = {
  legal: 'var(--series-1)',
  finance: 'var(--series-3)',
  design: 'var(--series-6)',
  construction: 'var(--series-4)',
  procurement: 'var(--series-2)',
  commercial: 'var(--series-7)',
};

interface Placed {
  id: string;
  label: string;
  department: DepartmentKey;
  x: number;
  y: number;
}

function workstreamEnds(link: ProjectLink): { from: string; to: string } | null {
  if (link.from.kind !== 'workstream' || link.to.kind !== 'workstream') return null;
  return { from: link.from.id, to: link.to.id };
}

function shortLabel(key: string): string {
  return FUNCTION_SHORT[key] ?? workstreamDefinition(key)?.label ?? key;
}

/**
 * How this department reaches the others, drawn.
 *
 * Same idea as the title chain diagram: a few nodes and labelled edges, legible
 * without pan/zoom. Columns are departments; edges are feeds, gates and relates.
 */
export default function DepartmentLinksDiagram({ links, focus, height }: DepartmentLinksDiagramProps) {
  const [hover, setHover] = useState<string | null>(null);

  const { placed, width, svgHeight, edges, columns } = useMemo(() => {
    const keys = new Set<string>();
    const drawn: Array<{ id: string; from: string; to: string; type: ProjectLink['type']; note?: string }> = [];
    for (const link of links) {
      const ends = workstreamEnds(link);
      if (!ends) continue;
      keys.add(ends.from);
      keys.add(ends.to);
      drawn.push({ id: link.id, from: ends.from, to: ends.to, type: link.type, ...(link.note ? { note: link.note } : {}) });
    }

    const byDept = new Map<DepartmentKey, string[]>();
    for (const key of keys) {
      const dept = workstreamDefinition(key)?.department;
      if (!dept) continue;
      const list = byDept.get(dept) ?? [];
      list.push(key);
      byDept.set(dept, list);
    }

    const cols = DEPARTMENT_KEYS.filter((d) => byDept.has(d)).map((dept) => ({
      dept,
      label: DEPARTMENT_SHORT[dept] ?? departmentDefinition(dept).label,
      nodes: (byDept.get(dept) ?? []).sort((a, b) => shortLabel(a).localeCompare(shortLabel(b))),
    }));

    const placedNodes: Placed[] = [];
    cols.forEach((col, ci) => {
      col.nodes.forEach((id, ri) => {
        placedNodes.push({
          id,
          label: shortLabel(id),
          department: col.dept,
          x: PAD + ci * (NODE_W + COL_GAP),
          y: PAD + HEADER + ri * (NODE_H + ROW_GAP),
        });
      });
    });

    const rows = Math.max(...cols.map((c) => c.nodes.length), 1);
    return {
      placed: placedNodes,
      width: PAD * 2 + cols.length * NODE_W + Math.max(0, cols.length - 1) * COL_GAP,
      svgHeight: PAD * 2 + HEADER + rows * (NODE_H + ROW_GAP) - ROW_GAP,
      edges: drawn,
      columns: cols,
    };
  }, [links]);

  const pos = new Map(placed.map((p) => [p.id, p]));

  if (!placed.length) {
    return <p className="text-[13px] text-ink-secondary">No links to other departments yet.</p>;
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
          aria-label={`Between departments: ${placed.length} functions, ${edges.length} links`}
        >
          <title>Between departments</title>
          <desc>
            {columns.map((c) => `${c.nodes.length} in ${c.label}`).join(', ')}.
          </desc>

          <defs>
            <marker id="dept-link-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--gridline)" />
            </marker>
            <marker id="dept-link-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--brand-strong)" />
            </marker>
          </defs>

          {columns.map((c, ci) => (
            <text
              key={c.dept}
              x={PAD + ci * (NODE_W + COL_GAP)}
              y={PAD + 10}
              className="fill-[var(--text-muted)] text-micro font-medium uppercase tracking-wide"
            >
              {c.label}
              {focus === c.dept ? ' · here' : ''}
            </text>
          ))}

          {edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const forward = b.x >= a.x;
            const x1 = forward ? a.x + NODE_W : a.x;
            const x2 = forward ? b.x : b.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const on = hover === e.from || hover === e.to || hover === e.id;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            return (
              <g key={e.id} onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)}>
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={on ? 'var(--brand-strong)' : 'var(--gridline)'}
                  strokeWidth={on ? 1.6 : 1}
                  strokeDasharray={e.type === 'relates' ? '3 3' : undefined}
                  markerEnd={on ? 'url(#dept-link-arrow-on)' : 'url(#dept-link-arrow)'}
                  opacity={hover && !on ? 0.25 : 1}
                >
                  <title>{`${shortLabel(e.from)} ${LINK_TYPE_LABEL[e.type]} ${shortLabel(e.to)}${e.note ? ` — ${e.note}` : ''}`}</title>
                </path>
                {on ? (
                  <text
                    x={midX}
                    y={midY - 4}
                    textAnchor="middle"
                    className="fill-[var(--text-muted)] text-micro"
                  >
                    {LINK_TYPE_LABEL[e.type]}
                  </text>
                ) : null}
              </g>
            );
          })}

          {placed.map((p) => {
            const on = hover === p.id || edges.some((e) => (e.from === p.id || e.to === p.id) && hover === e.id);
            const focused = focus === p.department;
            return (
              <g
                key={p.id}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={p.x}
                  y={p.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  fill="var(--surface-1)"
                  stroke={focused ? 'var(--brand-strong)' : on ? 'var(--brand-strong)' : 'var(--ring)'}
                  strokeWidth={focused || on ? 1.5 : 1}
                />
                <rect x={p.x} y={p.y} width={3} height={NODE_H} rx={1.5} fill={DEPT_FILL[p.department]} />
                <text x={p.x + 10} y={p.y + 18} className="fill-[var(--text-primary)] text-mini font-medium">
                  {p.label.length > 20 ? `${p.label.slice(0, 19)}…` : p.label}
                </text>
                <text x={p.x + 10} y={p.y + 32} className="fill-[var(--text-muted)] text-micro">
                  {DEPARTMENT_SHORT[p.department]}
                </text>
                <title>{`${DEPARTMENT_SHORT[p.department]} › ${p.label}`}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {columns.map((c) => (
          <span key={c.dept} className="flex items-center gap-1.5 text-mini text-ink-secondary">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: DEPT_FILL[c.dept] }} />
            {c.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-mini text-ink-secondary">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" stroke="var(--gridline)" strokeWidth="1.4" strokeDasharray="3 3" />
          </svg>
          Relates
        </span>
      </div>
    </div>
  );
}
