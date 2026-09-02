/**
 * What the palette offers, and what each node type promises.
 *
 * One declaration per kind, read by three things that must not disagree: the
 * canvas palette, the node inspector's form, and the engine's validator. When
 * those three were three separate lists, the third one was always the one that
 * had not been updated — a node the UI could draw and the engine could not
 * run, discovered at run time.
 *
 * The ports are here rather than on the node because they are a property of
 * the kind (and, for a branch, of its cases), not of the instance. Everything
 * else on a node is the operator's; this is the shape they are working inside.
 */

import {
  BRANCH_DEFAULT_PORT,
  DEFAULT_OUT_PORT,
  FILTER_PASS_PORT,
  LOOP_BODY_PORT,
  LOOP_DONE_PORT,
  type FlowNode,
  type FlowNodeKind,
} from './types';

export interface FlowNodeType {
  kind: FlowNodeKind;
  label: string;
  /** One line, shown under the name in the palette. */
  summary: string;
  /** What this costs or risks, where that is not obvious. Shown on the node. */
  caution?: string;
  /** Whether a run may reach this node from more than one path. */
  group: 'start' | 'think' | 'read' | 'route' | 'write';
  /** False for the trigger, which nothing feeds. */
  takesInput: boolean;
  /** The ports this kind always has. A branch adds one per case. */
  ports: string[];
  /** True when this node calls a model, so the canvas can mark what a run will cost. */
  spends: boolean;
}

export const FLOW_NODE_TYPES: Record<FlowNodeKind, FlowNodeType> = {
  trigger: {
    kind: 'trigger',
    label: 'Trigger',
    summary: 'Where a run starts, and what starts it.',
    group: 'start',
    takesInput: false,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  agent: {
    kind: 'agent',
    label: 'Agent',
    summary: 'A shipped agent: a model call with its prompt, tools and parser.',
    caution: 'Calls a model. Every run of this node costs money.',
    group: 'think',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: true,
  },
  query: {
    kind: 'query',
    label: 'Read a register',
    summary: 'Rows from the project itself — evidence, findings, risks, checks.',
    group: 'read',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  retrieve: {
    kind: 'retrieve',
    label: 'Retrieve',
    summary: 'The project graph, cross-project memory, or the reference shelf.',
    group: 'read',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  connector: {
    kind: 'connector',
    label: 'Connector',
    summary: 'An external source from the registry — a portal, a registry, a map service.',
    caution: 'Reaches outside this deployment.',
    group: 'read',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  mcp: {
    kind: 'mcp',
    label: 'MCP tool',
    summary: 'A tool on an MCP server.',
    caution: 'Reaches outside this deployment, and the server decides what the tool does.',
    group: 'read',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  http: {
    kind: 'http',
    label: 'HTTP request',
    summary: 'Any API, configured here.',
    caution: 'Reaches outside this deployment. Nothing validates what comes back.',
    group: 'read',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  filter: {
    kind: 'filter',
    label: 'Filter',
    summary: 'Carries on only when the run satisfies a test.',
    group: 'route',
    takesInput: true,
    ports: [FILTER_PASS_PORT],
    spends: false,
  },
  branch: {
    kind: 'branch',
    label: 'Branch',
    summary: 'Takes the first case that matches, or the default way out.',
    group: 'route',
    takesInput: true,
    ports: [BRANCH_DEFAULT_PORT],
    spends: false,
  },
  loop: {
    kind: 'loop',
    label: 'Loop',
    summary: 'Runs its body once per item, then carries on.',
    caution: 'A loop around an agent multiplies what the run costs.',
    group: 'route',
    takesInput: true,
    ports: [LOOP_BODY_PORT, LOOP_DONE_PORT],
    spends: false,
  },
  transform: {
    kind: 'transform',
    label: 'Transform',
    summary: 'Reshapes what the next node sees.',
    group: 'route',
    takesInput: true,
    ports: [DEFAULT_OUT_PORT],
    spends: false,
  },
  output: {
    kind: 'output',
    label: 'Propose a draft',
    summary: 'Puts a card in front of a person. The only way a flow reaches the file.',
    caution: 'Proposes. A person accepts it — a flow never writes a finding itself.',
    group: 'write',
    takesInput: true,
    ports: [],
    spends: false,
  },
};

export const FLOW_NODE_GROUP_LABEL: Record<FlowNodeType['group'], string> = {
  start: 'Start',
  think: 'Think',
  read: 'Read',
  route: 'Route',
  write: 'Write',
};

/**
 * Every way out of this particular node.
 *
 * A branch's cases are ports, so adding a case adds somewhere to connect —
 * which is why this takes the node rather than the kind.
 */
export function portsOf(node: FlowNode): string[] {
  const base = FLOW_NODE_TYPES[node.kind].ports;
  if (node.config.kind === 'branch') {
    return [...node.config.cases.map((c) => c.id), BRANCH_DEFAULT_PORT];
  }
  return [...base];
}

/** What to call a port on screen. */
export function portLabel(node: FlowNode, port: string): string {
  if (node.config.kind === 'branch') {
    const hit = node.config.cases.find((c) => c.id === port);
    if (hit) return hit.label;
    if (port === BRANCH_DEFAULT_PORT) return 'Otherwise';
  }
  if (port === LOOP_BODY_PORT) return 'Each item';
  if (port === LOOP_DONE_PORT) return 'After the loop';
  if (port === FILTER_PASS_PORT) return 'Passes';
  return 'Next';
}

/** The label shown on a node: what the operator named it, or the type's own. */
export function nodeLabel(node: FlowNode): string {
  return node.label?.trim() || FLOW_NODE_TYPES[node.kind].label;
}
