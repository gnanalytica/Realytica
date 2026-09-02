import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_OUT_PORT,
  FLOW_NODE_TYPES,
  portsOf,
  validateFlow,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type FlowNodeKind,
} from '@realytica/shared';
import { freeSpotNear, snap, type Point } from './geometry';

/**
 * The editing model behind the canvas.
 *
 * Every change goes through one `apply`, and that is what buys undo: a history
 * bolted on afterwards is one that misses the operation somebody added last
 * week, whereas a single door means an operation cannot be written that is not
 * undoable. It also means "is this dirty" is one comparison rather than a flag
 * each handler has to remember to set — and a forgotten flag is a canvas that
 * loses work on navigation.
 *
 * Kept out of the component because it is the part with rules, and rules are
 * worth reading without stepping over JSX.
 */

const UNDO_DEPTH = 50;

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A node of this kind, configured with defaults that are valid rather than empty. */
export function makeNode(kind: FlowNodeKind, at: Point): FlowNode {
  const base = { id: newId('nd'), kind, position: { x: snap(at.x), y: snap(at.y) } };
  switch (kind) {
    case 'trigger':
      return { ...base, config: { kind: 'trigger', on: 'manual' } };
    case 'agent':
      return { ...base, config: { kind: 'agent', agent: 'analyst_copilot' } };
    case 'query':
      return { ...base, config: { kind: 'query', register: 'evidence' } };
    case 'retrieve':
      return { ...base, config: { kind: 'retrieve', from: 'graph', query: '{{project.name}}' } };
    case 'connector':
      return { ...base, config: { kind: 'connector', sourceId: '' } };
    case 'mcp':
      return { ...base, config: { kind: 'mcp', tool: '' } };
    case 'http':
      return { ...base, config: { kind: 'http', method: 'GET', url: 'https://' } };
    case 'filter':
      return { ...base, config: { kind: 'filter', where: { match: 'all', conditions: [] } } };
    case 'branch':
      // One case to start with, because a branch with none only ever takes its
      // default way out and reads as broken.
      return {
        ...base,
        config: { kind: 'branch', cases: [{ id: newId('case'), label: 'When…', where: { match: 'all', conditions: [] } }] },
      };
    case 'loop':
      return { ...base, config: { kind: 'loop', over: 'rows', itemName: 'item', maxIterations: 10 } };
    case 'transform':
      return { ...base, config: { kind: 'transform', set: [] } };
    case 'output':
      return { ...base, config: { kind: 'output', draft: 'note', title: '' } };
    default:
      return { ...base, config: { kind: 'trigger', on: 'manual' } };
  }
}

export interface FlowEditor {
  flow: Flow;
  dirty: boolean;
  problems: ReturnType<typeof validateFlow>;
  selected: string | null;
  select: (nodeId: string | null) => void;
  addNode: (kind: FlowNodeKind, at: Point) => string;
  moveNode: (nodeId: string, to: Point) => void;
  /** Live drag: moves without writing history, so a drag is one undo, not forty. */
  dragNode: (nodeId: string, to: Point) => void;
  endDrag: () => void;
  updateNode: (nodeId: string, patch: Partial<FlowNode>) => void;
  removeNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  connect: (from: string, fromPort: string, to: string) => void;
  disconnect: (edgeId: string) => void;
  rename: (name: string) => void;
  setEnabled: (enabled: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** After a save: the saved shape becomes the new clean baseline. */
  markSaved: (flow: Flow) => void;
  replace: (flow: Flow) => void;
}

export function useFlowEditor(initial: Flow): FlowEditor {
  const [flow, setFlow] = useState<Flow>(initial);
  const [saved, setSaved] = useState<Flow>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const past = useRef<Flow[]>([]);
  const future = useRef<Flow[]>([]);
  const [depth, setDepth] = useState(0);

  /** The one door. Everything that changes a flow comes through here. */
  const apply = useCallback((change: (current: Flow) => Flow, remember = true) => {
    setFlow((current) => {
      if (remember) {
        past.current = [...past.current.slice(-UNDO_DEPTH), current];
        future.current = [];
      }
      return change(current);
    });
    setDepth((d) => d + 1);
  }, []);

  const addNode = useCallback(
    (kind: FlowNodeKind, at: Point): string => {
      const node = makeNode(kind, at);
      apply((current) => ({ ...current, nodes: [...current.nodes, { ...node, position: freeSpotNear(current, at) }] }));
      setSelected(node.id);
      return node.id;
    },
    [apply],
  );

  const dragNode = useCallback(
    (nodeId: string, to: Point) => {
      // No history: a drag is one undo step, recorded when it ends.
      apply(
        (current) => ({
          ...current,
          nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x: to.x, y: to.y } } : n)),
        }),
        false,
      );
    },
    [apply],
  );

  const dragFrom = useRef<Flow | null>(null);
  const moveNode = useCallback(
    (nodeId: string, to: Point) => {
      dragFrom.current = flow;
      apply((current) => ({
        ...current,
        nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x: snap(to.x), y: snap(to.y) } } : n)),
      }));
    },
    [apply, flow],
  );

  const endDrag = useCallback(() => {
    apply((current) => ({
      ...current,
      nodes: current.nodes.map((n) => ({ ...n, position: { x: snap(n.position.x), y: snap(n.position.y) } })),
    }));
  }, [apply]);

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<FlowNode>) => {
      apply((current) => {
        const nodes = current.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
        // A branch that lost a case leaves connections pointing at a way out
        // that no longer exists. Dropping them here rather than letting the
        // validator complain keeps the canvas honest as it is edited.
        const node = nodes.find((n) => n.id === nodeId);
        const live = node ? new Set(portsOf(node)) : null;
        const edges = live
          ? current.edges.filter((e) => e.from !== nodeId || live.has(e.fromPort))
          : current.edges;
        return { ...current, nodes, edges };
      });
    },
    [apply],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      apply((current) => ({
        ...current,
        nodes: current.nodes.filter((n) => n.id !== nodeId),
        edges: current.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
      }));
      setSelected((s) => (s === nodeId ? null : s));
    },
    [apply],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      apply((current) => {
        const original = current.nodes.find((n) => n.id === nodeId);
        if (!original) return current;
        const copy: FlowNode = {
          ...original,
          id: newId('nd'),
          // Structured clone rather than a spread: a shallow copy would share
          // a branch's cases, so editing the duplicate would edit the original.
          config: JSON.parse(JSON.stringify(original.config)) as FlowNode['config'],
          position: freeSpotNear(current, { x: original.position.x + 40, y: original.position.y + 40 }),
        };
        return { ...current, nodes: [...current.nodes, copy] };
      });
    },
    [apply],
  );

  const connect = useCallback(
    (from: string, fromPort: string, to: string) => {
      apply((current) => {
        if (from === to) return current;
        const target = current.nodes.find((n) => n.id === to);
        if (!target || !FLOW_NODE_TYPES[target.kind].takesInput) return current;
        const already = current.edges.some((e) => e.from === from && e.fromPort === fromPort && e.to === to);
        if (already) return current;
        const edge: FlowEdge = { id: newId('e'), from, fromPort: fromPort || DEFAULT_OUT_PORT, to };
        return { ...current, edges: [...current.edges, edge] };
      });
    },
    [apply],
  );

  const disconnect = useCallback(
    (edgeId: string) => apply((current) => ({ ...current, edges: current.edges.filter((e) => e.id !== edgeId) })),
    [apply],
  );

  const rename = useCallback((name: string) => apply((current) => ({ ...current, name })), [apply]);
  const setEnabled = useCallback((enabled: boolean) => apply((current) => ({ ...current, enabled })), [apply]);

  const undo = useCallback(() => {
    setFlow((current) => {
      const previous = past.current.pop();
      if (!previous) return current;
      future.current = [...future.current, current];
      return previous;
    });
    setDepth((d) => d + 1);
  }, []);

  const redo = useCallback(() => {
    setFlow((current) => {
      const next = future.current.pop();
      if (!next) return current;
      past.current = [...past.current, current];
      return next;
    });
    setDepth((d) => d + 1);
  }, []);

  const markSaved = useCallback((next: Flow) => {
    setFlow(next);
    setSaved(next);
    past.current = [];
    future.current = [];
    setDepth((d) => d + 1);
  }, []);

  const replace = useCallback((next: Flow) => {
    setFlow(next);
    setSaved(next);
    past.current = [];
    future.current = [];
    setSelected(null);
    setDepth((d) => d + 1);
  }, []);

  const problems = useMemo(() => validateFlow(flow), [flow]);
  const dirty = useMemo(
    () => JSON.stringify({ ...flow, updatedAt: '', version: 0 }) !== JSON.stringify({ ...saved, updatedAt: '', version: 0 }),
    [flow, saved],
  );

  return {
    flow,
    dirty,
    problems,
    selected,
    select: setSelected,
    addNode,
    moveNode,
    dragNode,
    endDrag,
    updateNode,
    removeNode,
    duplicateNode,
    connect,
    disconnect,
    rename,
    setEnabled,
    undo,
    redo,
    canUndo: past.current.length > 0 || depth < 0,
    canRedo: future.current.length > 0,
    markSaved,
    replace,
  };
}
