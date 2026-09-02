/**
 * Whether a drawn flow is one the engine can actually run.
 *
 * Checked on the canvas as it is drawn and again on the server before it is
 * saved, from this one function — a client-side "looks fine" that the server
 * does not share is how a flow gets stored in a state nothing can execute.
 *
 * Every problem names the node it is about, so the canvas can put the marker
 * where the reader is looking rather than in a list at the bottom of the page.
 * Severity is the difference between "this will not run" and "this will run
 * and probably surprise you", and both are worth saying — a flow that is
 * merely odd should still be saveable, because half-drawn is a normal state.
 */

import { FLOW_NODE_TYPES, portsOf } from './catalogue';
import type { Flow, FlowNode } from './types';

export interface FlowProblem {
  severity: 'error' | 'warning';
  /** The node this is about, where there is one. */
  nodeId?: string;
  edgeId?: string;
  message: string;
}

/** Nodes a run can actually reach from the trigger. */
export function reachableNodes(flow: Flow): Set<string> {
  const trigger = flow.nodes.find((n) => n.kind === 'trigger');
  const seen = new Set<string>();
  if (!trigger) return seen;
  const queue = [trigger.id];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of flow.edges) {
      if (edge.from === id && !seen.has(edge.to)) queue.push(edge.to);
    }
  }
  return seen;
}

/**
 * A cycle that is not a loop node's own body.
 *
 * Cycles are how an unbounded bill happens, and the loop node exists so that
 * repetition is declared with a ceiling rather than drawn by accident.
 */
export function findCycle(flow: Flow): string[] | null {
  const out = new Map<string, string[]>();
  for (const edge of flow.edges) {
    // A loop's body edge is the one place a path is meant to come back.
    const from = flow.nodes.find((n) => n.id === edge.from);
    if (from?.kind === 'loop' && edge.fromPort === 'body') continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  }

  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];

  const walk = (id: string): string[] | null => {
    const seen = state.get(id);
    if (seen === 'done') return null;
    if (seen === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const next of out.get(id) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };

  for (const node of flow.nodes) {
    const cycle = walk(node.id);
    if (cycle) return cycle;
  }
  return null;
}

function configProblems(node: FlowNode): FlowProblem[] {
  const at = (severity: FlowProblem['severity'], message: string): FlowProblem => ({ severity, nodeId: node.id, message });
  const c = node.config;

  switch (c.kind) {
    case 'agent':
      if (c.retries !== undefined && c.retries > 5) return [at('warning', 'More than five retries on a model call is a bill, not a recovery.')];
      return [];
    case 'retrieve':
      return c.query.trim() ? [] : [at('error', 'This has nothing to look up.')];
    case 'connector':
      return c.sourceId.trim() ? [] : [at('error', 'No source chosen.')];
    case 'mcp':
      if (!c.tool.trim()) return [at('error', 'No tool named.')];
      if (!c.url?.trim() && !c.credentialId) return [at('error', 'No server: give it a URL or a stored MCP credential.')];
      return [];
    case 'http':
      if (!c.url.trim()) return [at('error', 'No URL.')];
      return /^https:\/\//i.test(c.url) || c.url.includes('{{')
        ? []
        : [at('warning', 'Not https. Anything sent here, including a credential, travels in the clear.')];
    case 'filter':
      return c.where.conditions.length > 0 ? [] : [at('error', 'A filter with no test lets everything through.')];
    case 'branch':
      if (c.cases.length === 0) return [at('error', 'A branch with no cases only ever takes the default way out.')];
      return c.cases.some((k) => k.where.conditions.length === 0)
        ? [at('warning', 'A case with no test always matches, so nothing after it can be reached.')]
        : [];
    case 'loop':
      return c.over.trim() ? [] : [at('error', 'No collection to loop over.')];
    case 'transform':
      return c.set.length > 0 || (c.drop?.length ?? 0) > 0 ? [] : [at('warning', 'This changes nothing.')];
    case 'output':
      return c.title.trim() ? [] : [at('error', 'A draft with no title is a card nobody can triage.')];
    default:
      return [];
  }
}

export function validateFlow(flow: Flow): FlowProblem[] {
  const problems: FlowProblem[] = [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));

  const triggers = flow.nodes.filter((n) => n.kind === 'trigger');
  if (triggers.length === 0) problems.push({ severity: 'error', message: 'No trigger, so nothing can start this.' });
  if (triggers.length > 1) {
    for (const extra of triggers.slice(1)) {
      problems.push({ severity: 'error', nodeId: extra.id, message: 'A flow starts in one place. Remove the other trigger.' });
    }
  }

  for (const edge of flow.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      problems.push({ severity: 'error', edgeId: edge.id, message: 'A connection points at a node that is not here.' });
      continue;
    }
    if (!portsOf(from).includes(edge.fromPort)) {
      problems.push({ severity: 'error', edgeId: edge.id, nodeId: from.id, message: 'A connection leaves by a way out that no longer exists.' });
    }
    if (!FLOW_NODE_TYPES[to.kind].takesInput) {
      problems.push({ severity: 'error', edgeId: edge.id, nodeId: to.id, message: `Nothing can feed a ${FLOW_NODE_TYPES[to.kind].label.toLowerCase()}.` });
    }
  }

  const reachable = reachableNodes(flow);
  for (const node of flow.nodes) {
    if (node.kind === 'trigger') continue;
    if (!reachable.has(node.id)) {
      problems.push({ severity: 'warning', nodeId: node.id, message: 'Nothing reaches this, so it never runs.' });
    }
  }

  const cycle = findCycle(flow);
  if (cycle) {
    problems.push({
      severity: 'error',
      nodeId: cycle[0],
      message: 'These nodes feed each other in a circle. Use a loop node when something should repeat — it carries a ceiling.',
    });
  }

  for (const node of flow.nodes) {
    if (node.disabled) continue;
    problems.push(...configProblems(node));
  }

  return problems;
}

/** A flow with no errors can run. Warnings do not stop it. */
export function flowCanRun(flow: Flow): boolean {
  return !validateFlow(flow).some((p) => p.severity === 'error');
}
