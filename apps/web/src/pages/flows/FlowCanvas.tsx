import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FLOW_NODE_TYPES,
  nodeLabel,
  portLabel,
  portsOf,
  type Flow,
  type FlowNode,
  type FlowNodeKind,
  type FlowProblem,
} from '@realytica/shared';
import { cn } from '../../components/ui/kit';
import {
  IDENTITY,
  NODE_HEIGHT,
  NODE_WIDTH,
  fitTo,
  inputAt,
  nodeAt,
  outputAt,
  reveal,
  toCanvas,
  wirePath,
  zoomAbout,
  type Point,
  type Transform,
} from './geometry';

/**
 * The canvas.
 *
 * Pointer events throughout rather than mouse events, so a finger and a stylus
 * work without a second code path — this is a screen somebody will open on a
 * tablet on a site visit, and a canvas that only answers a mouse is a canvas
 * that is unusable exactly where it would be most useful.
 *
 * One `dragging` union holds every gesture. Separate booleans for panning,
 * moving and wiring is how two of them end up true at once and a node follows
 * the cursor while a wire is being drawn from it.
 */

type Dragging =
  | { kind: 'none' }
  | { kind: 'pan'; from: Point; origin: Transform }
  | { kind: 'node'; nodeId: string; grab: Point }
  | { kind: 'wire'; from: string; fromPort: string; at: Point };

export interface FlowCanvasProps {
  flow: Flow;
  selected: string | null;
  problems: FlowProblem[];
  /** Nodes a run touched, and how it went — drawn over the shape rather than beside it. */
  ran?: Map<string, 'ok' | 'skipped' | 'failed'>;
  /** Brought into view when it changes. What you just added must be visible. */
  reveal?: string | null;
  /** Changing this refits the whole flow on screen. A canvas without one is a canvas to get lost in. */
  fitNonce?: number;
  onSelect: (nodeId: string | null) => void;
  onMove: (nodeId: string, to: Point) => void;
  onMoveEnd: () => void;
  onConnect: (from: string, fromPort: string, to: string) => void;
  onDisconnect: (edgeId: string) => void;
  onDropKind: (kind: FlowNodeKind, at: Point) => void;
  onDelete: (nodeId: string) => void;
}

const KIND_TINT: Record<FlowNodeType_Group, string> = {
  start: 'border-brand/60 bg-brand-soft',
  think: 'border-[var(--ring)] bg-surface',
  read: 'border-[var(--ring)] bg-surface',
  route: 'border-warning/45 bg-warning/5',
  write: 'border-good/50 bg-good/5',
};
type FlowNodeType_Group = 'start' | 'think' | 'read' | 'route' | 'write';

export function FlowCanvas({
  flow,
  selected,
  problems,
  ran,
  reveal: revealId,
  fitNonce,
  onSelect,
  onMove,
  onMoveEnd,
  onConnect,
  onDisconnect,
  onDropKind,
  onDelete,
}: FlowCanvasProps) {
  const surface = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [dragging, setDragging] = useState<Dragging>({ kind: 'none' });
  const [fitted, setFitted] = useState(false);

  const worstFor = useCallback(
    (nodeId: string): FlowProblem['severity'] | undefined => {
      const mine = problems.filter((p) => p.nodeId === nodeId);
      if (mine.some((p) => p.severity === 'error')) return 'error';
      return mine.length > 0 ? 'warning' : undefined;
    },
    [problems],
  );

  /** Fit once, when the flow first has a size to fit. Refitting on every edit would fight the reader. */
  useEffect(() => {
    if (fitted || !surface.current || flow.nodes.length === 0) return;
    const box = surface.current.getBoundingClientRect();
    if (box.width === 0) return;
    setTransform(fitTo(flow, { width: box.width, height: box.height }));
    setFitted(true);
  }, [flow, fitted]);

  /* Asked for explicitly: put everything back on screen. */
  useEffect(() => {
    if (fitNonce === undefined || !surface.current) return;
    const box = surface.current.getBoundingClientRect();
    if (box.width === 0 || flow.nodes.length === 0) return;
    setTransform(fitTo(flow, { width: box.width, height: box.height }));
  }, [fitNonce, flow]);

  /* What was just added has to be visible, or the click reads as a no-op. */
  useEffect(() => {
    if (!revealId || !surface.current) return;
    const node = flow.nodes.find((n) => n.id === revealId);
    const box = surface.current.getBoundingClientRect();
    if (!node || box.width === 0) return;
    setTransform((t) => reveal(t, node, { width: box.width, height: box.height }));
  }, [revealId, flow.nodes]);

  const pointOf = useCallback((e: { clientX: number; clientY: number }): Point => {
    const box = surface.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-node]') || target.closest('[data-port]')) return;
    surface.current?.setPointerCapture(e.pointerId);
    setDragging({ kind: 'pan', from: pointOf(e), origin: transform });
    onSelect(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const at = pointOf(e);
    if (dragging.kind === 'pan') {
      setTransform({ ...dragging.origin, x: dragging.origin.x + (at.x - dragging.from.x), y: dragging.origin.y + (at.y - dragging.from.y) });
      return;
    }
    if (dragging.kind === 'node') {
      const canvas = toCanvas(at, transform);
      onMove(dragging.nodeId, { x: canvas.x - dragging.grab.x, y: canvas.y - dragging.grab.y });
      return;
    }
    if (dragging.kind === 'wire') setDragging({ ...dragging, at });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragging.kind === 'wire') {
      const dropped = nodeAt(flow, toCanvas(pointOf(e), transform));
      if (dropped) onConnect(dragging.from, dragging.fromPort, dropped.id);
    }
    if (dragging.kind === 'node') onMoveEnd();
    setDragging({ kind: 'none' });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      setTransform((t) => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }));
      return;
    }
    setTransform((t) => zoomAbout(t, pointOf(e), e.deltaY < 0 ? 1.08 : 1 / 1.08));
  };

  /** Delete and backspace remove the selected node, the way every canvas does. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing = document.activeElement;
      if (editing && ['INPUT', 'TEXTAREA', 'SELECT'].includes(editing.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        onDelete(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onDelete]);

  const wireTip =
    dragging.kind === 'wire'
      ? toCanvas(dragging.at, transform)
      : null;
  const wireFrom =
    dragging.kind === 'wire'
      ? (() => {
          const node = flow.nodes.find((n) => n.id === dragging.from);
          return node ? outputAt(node, portsOf(node), dragging.fromPort) : null;
        })()
      : null;

  return (
    <div
      ref={surface}
      className={cn(
        'relative h-full w-full overflow-hidden bg-sunken',
        dragging.kind === 'pan' ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragging({ kind: 'none' })}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('application/x-flow-node') as FlowNodeKind;
        if (!kind) return;
        const at = toCanvas(pointOf(e), transform);
        onDropKind(kind, { x: at.x - NODE_WIDTH / 2, y: at.y - NODE_HEIGHT / 2 });
      }}
    >
      {/* The grid moves with the canvas, which is what makes a pan legible. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--axis) 1px, transparent 1px)',
          backgroundSize: `${16 * transform.scale}px ${16 * transform.scale}px`,
          backgroundPosition: `${transform.x}px ${transform.y}px`,
        }}
      />

      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {flow.edges.map((edge) => {
            const from = flow.nodes.find((n) => n.id === edge.from);
            const to = flow.nodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            return (
              <g key={edge.id} className="pointer-events-auto">
                <path
                  d={wirePath(outputAt(from, portsOf(from), edge.fromPort), inputAt(to))}
                  fill="none"
                  stroke="var(--axis)"
                  strokeWidth={2}
                />
                {/* A fat invisible copy, because a two-pixel line is not a click target. */}
                <path
                  d={wirePath(outputAt(from, portsOf(from), edge.fromPort), inputAt(to))}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="cursor-pointer"
                  onClick={() => onDisconnect(edge.id)}
                >
                  <title>Remove this connection</title>
                </path>
              </g>
            );
          })}
          {wireFrom && wireTip ? (
            <path d={wirePath(wireFrom, wireTip)} fill="none" stroke="var(--brand)" strokeWidth={2} strokeDasharray="5 4" />
          ) : null}
        </g>
      </svg>

      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        {flow.nodes.map((node) => {
          const type = FLOW_NODE_TYPES[node.kind];
          const ports = portsOf(node);
          const severity = worstFor(node.id);
          const outcome = ran?.get(node.id);
          return (
            <div
              key={node.id}
              data-node={node.id}
              style={{ left: node.position.x, top: node.position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              className={cn(
                'absolute select-none rounded-xl border px-3 py-2 shadow-sm',
                KIND_TINT[type.group],
                node.disabled && 'opacity-45',
                selected === node.id && 'ring-2 ring-brand',
                severity === 'error' && 'border-critical',
                outcome === 'failed' && 'ring-2 ring-critical',
                outcome === 'ok' && 'ring-2 ring-good',
              )}
              onPointerDown={(e) => {
                e.stopPropagation();
                surface.current?.setPointerCapture(e.pointerId);
                const canvas = toCanvas(pointOf(e), transform);
                setDragging({ kind: 'node', nodeId: node.id, grab: { x: canvas.x - node.position.x, y: canvas.y - node.position.y } });
                onSelect(node.id);
              }}
            >
              <p className="truncate text-[12.5px] font-semibold text-ink">{nodeLabel(node)}</p>
              <p className="truncate text-[11px] text-ink-muted">{summaryOf(node)}</p>
              <div className="mt-0.5 flex items-center gap-1">
                {type.spends ? <span className="rounded bg-warning/15 px-1 text-[10px] text-ink-secondary">costs</span> : null}
                {node.disabled ? <span className="rounded bg-sunken px-1 text-[10px] text-ink-muted">off</span> : null}
                {severity === 'error' ? <span className="rounded bg-critical/15 px-1 text-[10px] text-critical">needs fixing</span> : null}
              </div>

              {type.takesInput ? (
                <span
                  data-port="in"
                  className="absolute -left-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-[var(--axis)] bg-surface"
                />
              ) : null}

              {ports.map((port, i) => (
                <span
                  key={port}
                  data-port={port}
                  title={`Drag from “${portLabel(node, port)}” to another node`}
                  style={{ top: (NODE_HEIGHT / (ports.length + 1)) * (i + 1) }}
                  className="absolute -right-[7px] h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-brand bg-surface hover:bg-brand-soft"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    surface.current?.setPointerCapture(e.pointerId);
                    setDragging({ kind: 'wire', from: node.id, fromPort: port, at: pointOf(e) });
                  }}
                />
              ))}

              {ports.length > 1 ? (
                <div className="pointer-events-none absolute -right-1 top-0 flex h-full translate-x-full flex-col justify-evenly pl-2">
                  {ports.map((port) => (
                    <span key={port} className="whitespace-nowrap text-[10px] text-ink-muted">
                      {portLabel(node, port)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-[11px] text-ink-muted">
        Drag to pan · ⌘/ctrl + scroll to zoom · drag a right-hand dot onto another node to connect
      </div>
    </div>
  );
}

/** The one line under a node's name: what it is set to do, not what its kind is. */
function summaryOf(node: FlowNode): string {
  const c = node.config;
  switch (c.kind) {
    case 'trigger':
      return c.on === 'manual' ? 'Started by hand' : c.on.replace(/_/g, ' ');
    case 'agent':
      return c.agent.replace(/_/g, ' ');
    case 'query':
      return `Read ${c.register}`;
    case 'retrieve':
      return `From the ${c.from}`;
    case 'connector':
      return c.sourceId || 'No source chosen';
    case 'mcp':
      return c.tool || 'No tool named';
    case 'http':
      return `${c.method} ${c.url}`;
    case 'filter':
      return `${c.where.conditions.length} test(s)`;
    case 'branch':
      return `${c.cases.length} case(s)`;
    case 'loop':
      return `Each of ${c.over}`;
    case 'transform':
      return `${c.set.length} field(s)`;
    case 'output':
      return `Propose a ${c.draft.replace(/_/g, ' ')}`;
    default:
      return '';
  }
}
