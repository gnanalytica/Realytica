/**
 * Running a flow.
 *
 * ## Why the engine is here and not in the agents package
 *
 * Because it is a graph walk over data, and everything that actually reaches
 * outside — a model, a portal, an MCP server, an HTTP endpoint — arrives as an
 * injected handler. That split is what makes a flow testable: the tests below
 * run every branch, loop and filter in this file without a key, a network or a
 * clock, because the only thing they have to fake is one function.
 *
 * It is the same reason the memory store takes a persistence port rather than
 * importing one.
 *
 * ## What the walk guarantees
 *
 * - **It ends.** Every node has a step budget, loops have a clamped ceiling,
 *   and the whole run has a cap. An operator can draw a flow that is wasteful;
 *   they cannot draw one that never stops.
 * - **It records.** Every node that ran is on the trace with what it was given
 *   and what it produced, whether it succeeded or not, so "why did it do that"
 *   is answered by reading rather than by re-running.
 * - **It refuses to guess.** A handler that throws stops the path it is on and
 *   says so. Carrying on with an empty result would put a node's absence into
 *   the payload as if it were an answer, which is the failure this whole
 *   product is built to avoid.
 */

import { portsOf } from './catalogue';
import { asText, evaluateGroup, fillTemplate, readPath, writePath, type Payload } from './payload';
import {
  BRANCH_DEFAULT_PORT,
  DEFAULT_OUT_PORT,
  FILTER_PASS_PORT,
  LOOP_BODY_PORT,
  LOOP_DONE_PORT,
  type Flow,
  type FlowNode,
} from './types';

/* ==================================================================== */
/* What the engine asks the world for                                    */
/* ==================================================================== */

/**
 * One node's work, done by the host.
 *
 * The engine hands over the node and what has flowed into it; the host
 * returns what comes out. Everything provider-shaped — which model, which
 * credential, which HTTP client — is the host's business and deliberately
 * invisible here.
 */
export interface NodeHandlerInput {
  node: FlowNode;
  payload: Payload;
  /** True on a rehearsal: reach nothing, spend nothing, return a shape. */
  dryRun: boolean;
  /** Fired when a node wants to say something mid-work. */
  note: (message: string) => void;
}

export type NodeHandler = (input: NodeHandlerInput) => Promise<Payload>;

export interface FlowRunOptions {
  /** Handles the kinds the engine does not do itself. */
  handler: NodeHandler;
  /** What the trigger puts on the payload. */
  input?: Payload;
  dryRun?: boolean;
  /** Total node executions before the run is cut off. */
  maxSteps?: number;
  /** Injected, because a trace nobody can date is a trace nobody can line up against a bill. */
  now?: () => string;
  /** Called as each step finishes, for a live view. */
  onStep?: (step: FlowRunStep) => void;
}

/* ==================================================================== */
/* What a run leaves behind                                              */
/* ==================================================================== */

export type FlowStepStatus = 'ok' | 'skipped' | 'failed';

export interface FlowRunStep {
  nodeId: string;
  kind: FlowNode['kind'];
  label: string;
  status: FlowStepStatus;
  at: string;
  durationMs: number;
  /** Which way out was taken. A branch's case, a filter's verdict. */
  tookPort?: string;
  /** Why it was skipped, or why it failed. Always a sentence, never a code. */
  detail?: string;
  /** What the node produced, for the inspector. Bounded — see `trim`. */
  produced?: Payload;
}

export interface FlowRunResult {
  flowId: string;
  flowVersion: number;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'failed' | 'cut_short';
  steps: FlowRunStep[];
  /** The payload as it stood at the end. */
  payload: Payload;
  /** Drafts the output nodes proposed. Nothing is committed by a run. */
  proposals: FlowProposal[];
  /** Set when the run stopped for a reason worth reporting. */
  stoppedBecause?: string;
}

export interface FlowProposal {
  nodeId: string;
  draft: 'finding' | 'action' | 'evidence_request' | 'note';
  title: string;
  body?: string;
}

/** The default ceiling. High enough for a real pipeline, low enough to end. */
export const DEFAULT_MAX_STEPS = 200;
/** No loop runs more times than this, whatever the node says. */
export const MAX_LOOP_ITERATIONS = 50;

/**
 * Keep a produced payload small enough to store.
 *
 * A trace is read by a person, and a node that returned four thousand rows
 * would make the run record larger than the project. The count survives, which
 * is the part somebody is usually looking for.
 */
function trim(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, 5).map((v) => trim(v, depth + 1));
    return value.length > 5 ? [...head, `… ${value.length - 5} more of ${value.length}`] : head;
  }
  if (value && typeof value === 'object') {
    if (depth > 3) return '…';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 24)) out[k] = trim(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 600) return `${value.slice(0, 600)}… (${value.length} chars)`;
  return value;
}

function trimPayload(payload: Payload): Payload {
  return trim(payload) as Payload;
}

/* ==================================================================== */
/* The walk                                                              */
/* ==================================================================== */

export async function runFlow(flow: Flow, options: FlowRunOptions): Promise<FlowRunResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const dryRun = options.dryRun ?? false;
  const startedAt = now();

  const steps: FlowRunStep[] = [];
  const proposals: FlowProposal[] = [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  let payload: Payload = { ...(options.input ?? {}) };
  let stoppedBecause: string | undefined;
  let status: FlowRunResult['status'] = 'ok';

  const record = (step: FlowRunStep) => {
    steps.push(step);
    options.onStep?.(step);
  };

  /**
   * Whether the run has spent its budget, said once.
   *
   * A helper rather than an inline check because the budget is reached in two
   * places — walking into a node, and going round a loop — and the loop's own
   * `break` used to leave silently. A run that stopped early and did not say so
   * is the failure this engine exists not to have: the trace reads as a
   * completed pipeline that simply did less.
   */
  const outOfBudget = (): boolean => {
    if (steps.length < maxSteps) return false;
    if (!stoppedBecause) {
      stoppedBecause = `Stopped after ${maxSteps} steps. A flow this long is usually a loop that should have a smaller ceiling.`;
      status = 'cut_short';
    }
    return true;
  };

  const nextFrom = (nodeId: string, port: string): FlowNode[] =>
    flow.edges
      .filter((e) => e.from === nodeId && e.fromPort === port)
      .map((e) => byId.get(e.to))
      .filter((n): n is FlowNode => Boolean(n));

  /**
   * Run one node and everything downstream of it.
   *
   * Depth-first rather than a topological sort, because a branch means "this
   * path, not that one" — a topological order would visit the untaken side and
   * then have to remember not to have done so.
   */
  const walk = async (node: FlowNode, into: Payload): Promise<void> => {
    if (outOfBudget()) return;

    if (node.disabled) {
      record({ nodeId: node.id, kind: node.kind, label: node.label ?? node.kind, status: 'skipped', at: now(), durationMs: 0, detail: 'Turned off.' });
      for (const next of nextFrom(node.id, DEFAULT_OUT_PORT)) await walk(next, into);
      return;
    }

    const began = Date.now();
    const notes: string[] = [];
    const step = (over: Partial<FlowRunStep>): FlowRunStep => ({
      nodeId: node.id,
      kind: node.kind,
      label: node.label ?? node.kind,
      status: 'ok',
      at: now(),
      durationMs: Date.now() - began,
      ...(notes.length > 0 ? { detail: notes.join(' ') } : {}),
      ...over,
    });

    /* ---- the kinds the engine owns itself --------------------------- */

    if (node.config.kind === 'filter') {
      const passed = evaluateGroup(node.config.where, into);
      record(step({ status: passed ? 'ok' : 'skipped', tookPort: passed ? FILTER_PASS_PORT : undefined, detail: passed ? undefined : 'Did not pass, so this path stops here.' }));
      if (passed) for (const next of nextFrom(node.id, FILTER_PASS_PORT)) await walk(next, into);
      return;
    }

    if (node.config.kind === 'branch') {
      const hit = node.config.cases.find((c) => evaluateGroup(c.where, into));
      const port = hit?.id ?? BRANCH_DEFAULT_PORT;
      record(step({ tookPort: port, detail: hit ? `Took “${hit.label}”.` : 'No case matched, so it took the default way out.' }));
      for (const next of nextFrom(node.id, port)) await walk(next, into);
      return;
    }

    if (node.config.kind === 'loop') {
      const raw = readPath(into, node.config.over);
      const items = Array.isArray(raw) ? raw : [];
      const ceiling = Math.max(0, Math.min(node.config.maxIterations ?? MAX_LOOP_ITERATIONS, MAX_LOOP_ITERATIONS));
      const run = items.slice(0, ceiling);
      if (items.length > run.length) notes.push(`Stopped at ${ceiling} of ${items.length}.`);
      record(step({ tookPort: LOOP_BODY_PORT, detail: `${run.length} item(s).${notes.length ? ` ${notes.join(' ')}` : ''}` }));

      for (const [index, item] of run.entries()) {
        const inner: Payload = { ...into, [node.config.itemName]: item, loopIndex: index };
        for (const next of nextFrom(node.id, LOOP_BODY_PORT)) await walk(next, inner);
        if (outOfBudget()) break;
      }
      for (const next of nextFrom(node.id, LOOP_DONE_PORT)) await walk(next, into);
      return;
    }

    if (node.config.kind === 'transform') {
      const out: Payload = { ...into };
      for (const rule of node.config.set) {
        const value = rule.from.includes('{{') ? fillTemplate(rule.from, into) : readPath(into, rule.from);
        writePath(out, rule.to, value);
      }
      for (const key of node.config.drop ?? []) delete out[key];
      payload = out;
      record(step({ produced: trimPayload(out) }));
      for (const next of nextFrom(node.id, DEFAULT_OUT_PORT)) await walk(next, out);
      return;
    }

    if (node.config.kind === 'output') {
      const proposal: FlowProposal = {
        nodeId: node.id,
        draft: node.config.draft,
        title: fillTemplate(node.config.title, into),
        ...(node.config.bodyTemplate ? { body: fillTemplate(node.config.bodyTemplate, into) } : {}),
      };
      proposals.push(proposal);
      record(step({ detail: `Proposed: ${proposal.title}`, produced: { proposal } }));
      return;
    }

    /* ---- everything that reaches outside ---------------------------- */

    try {
      const produced = await options.handler({ node, payload: into, dryRun, note: (m) => notes.push(m) });
      const merged: Payload = { ...into, ...produced };
      payload = merged;
      record(step({ produced: trimPayload(produced) }));
      for (const next of nextFrom(node.id, DEFAULT_OUT_PORT)) await walk(next, merged);
    } catch (err) {
      // The path stops. Carrying on would put this node's absence into the
      // payload as though it were an answer.
      status = 'failed';
      record(step({ status: 'failed', detail: err instanceof Error ? err.message : asText(err) }));
    }
  };

  const trigger = flow.nodes.find((n) => n.kind === 'trigger');
  if (!trigger) {
    return {
      flowId: flow.id,
      flowVersion: flow.version,
      startedAt,
      finishedAt: now(),
      status: 'failed',
      steps,
      payload,
      proposals,
      stoppedBecause: 'This flow has no trigger, so there is nowhere to start.',
    };
  }

  record({ nodeId: trigger.id, kind: 'trigger', label: trigger.label ?? 'Trigger', status: 'ok', at: startedAt, durationMs: 0, tookPort: DEFAULT_OUT_PORT });
  for (const next of nextFrom(trigger.id, DEFAULT_OUT_PORT)) await walk(next, payload);

  return {
    flowId: flow.id,
    flowVersion: flow.version,
    startedAt,
    finishedAt: now(),
    status,
    steps,
    payload,
    proposals,
    ...(stoppedBecause ? { stoppedBecause } : {}),
  };
}

/**
 * Which nodes a run would reach, without running it.
 *
 * For the canvas: it dims what a given payload cannot get to, so an operator
 * can see the shape of a decision before paying for it.
 */
export function pathPreview(flow: Flow, payload: Payload): Set<string> {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const reached = new Set<string>();
  const trigger = flow.nodes.find((n) => n.kind === 'trigger');
  if (!trigger) return reached;

  const visit = (node: FlowNode, depth: number): void => {
    if (depth > 60 || reached.has(node.id)) return;
    reached.add(node.id);
    let ports = portsOf(node);
    if (node.config.kind === 'filter') ports = evaluateGroup(node.config.where, payload) ? [FILTER_PASS_PORT] : [];
    if (node.config.kind === 'branch') {
      const hit = node.config.cases.find((c) => evaluateGroup(c.where, payload));
      ports = [hit?.id ?? BRANCH_DEFAULT_PORT];
    }
    for (const port of ports) {
      for (const edge of flow.edges.filter((e) => e.from === node.id && e.fromPort === port)) {
        const next = byId.get(edge.to);
        if (next) visit(next, depth + 1);
      }
    }
  };

  visit(trigger, 0);
  return reached;
}
