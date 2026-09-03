import {
  asText,
  evaluateGroup,
  fillTemplate,
  type DdProject,
  type NodeHandler,
  type NodeHandlerInput,
  type Payload,
} from '@realytica/shared';
import { agentCapability, allDescriptors, resolveRoute } from '@realytica/agents';
import { graphAdapter } from '../graph';
import { memoryReadableBy, memoryStore } from '../memory';
import { noteCredentialUse, secretFor } from './credentials';
import { OutboundRefused, assertReachable, fetchOutbound } from './outbound';

/**
 * What each node kind actually does, once the engine has decided it should.
 *
 * The engine owns the shape of a run — branching, looping, budgets, the trace
 * — and knows nothing about models, portals or HTTP. This is the other half:
 * every reach outside, behind one function the engine calls.
 *
 * ## Why a dry run is a first-class path rather than a flag somebody checks
 *
 * Because the point of drawing a flow is to look at it before paying for it,
 * and a rehearsal that quietly made three model calls would be worse than
 * having none. Each handler answers a dry run with the *shape* it would have
 * produced — enough for the next node's conditions to be exercised — and
 * reaches nothing. The engine passes `dryRun` down; nothing here may ignore it.
 */

export interface HandlerContext {
  tenantId: string;
  /** The project a run is about, already redacted to whoever started it. */
  project: DdProject;
  actor: string;
}

/** A run stops rather than guessing. Every throw here is a sentence for the trace. */
class NodeFailed extends Error {}

const REGISTERS = {
  evidence: (p: DdProject) => p.evidence,
  findings: (p: DdProject) => p.findings,
  risks: (p: DdProject) => p.risks,
  actions: (p: DdProject) => p.actions,
  decisions: (p: DdProject) => p.decisions,
  assessments: (p: DdProject) => p.assessments,
  checks: (p: DdProject) => p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)),
} as const;

async function runQuery(input: NodeHandlerInput, ctx: HandlerContext): Promise<Payload> {
  if (input.node.config.kind !== 'query') return {};
  const { register, where, limit } = input.node.config;
  const all = REGISTERS[register](ctx.project) as unknown as Array<Record<string, unknown>>;
  const kept = where ? all.filter((row) => evaluateGroup(where, row as Payload)) : all;
  const rows = limit && limit > 0 ? kept.slice(0, limit) : kept;
  // Named by register rather than a generic `rows`, so a flow reading two
  // registers does not have the second silently overwrite the first.
  return { [register]: rows, rows, count: rows.length };
}

async function runRetrieve(input: NodeHandlerInput, ctx: HandlerContext): Promise<Payload> {
  if (input.node.config.kind !== 'retrieve') return {};
  const { from, query, hops, limit } = input.node.config;
  const text = fillTemplate(query, input.payload);
  if (input.dryRun) return { retrieved: [], retrievedFrom: from, retrievedQuery: text };

  if (from === 'graph') {
    const stored = await graphAdapter.neighbourhood(ctx.project.id, [text], hops ?? 2);
    const nodes = stored?.nodes ?? [];
    return { retrieved: nodes.slice(0, limit ?? 40), retrievedFrom: from, count: nodes.length };
  }
  if (from === 'memory') {
    const result = await memoryStore.query({
      subjects: [text],
      now: new Date().toISOString(),
      tenants: memoryReadableBy(ctx.tenantId),
      limit: limit ?? 20,
    });
    return { retrieved: result.facts, retrievedFrom: from, count: result.facts.length };
  }
  const { lookupShelf } = await import('../reference/shelf-cache');
  const found = await lookupShelf(text, {});
  return { retrieved: found.text, retrievedFrom: from, count: found.text ? 1 : 0 };
}

async function runConnector(input: NodeHandlerInput, ctx: HandlerContext): Promise<Payload> {
  if (input.node.config.kind !== 'connector') return {};
  const { sourceId, credentialId } = input.node.config;
  const descriptor = allDescriptors().find((d) => d.id === sourceId);
  if (!descriptor) throw new NodeFailed(`No source in this build called “${sourceId}”.`);
  if (input.dryRun) return { source: descriptor.id, access: descriptor.access, records: [] };

  /*
   * A source the registry declares unreachable is not attempted.
   *
   * The registry exists because these portals mostly cannot be fetched — they
   * want a captcha, a login, or a person with a receipt — and the honest
   * answer is the manual route rather than a timeout dressed up as a failure.
   */
  if (descriptor.access !== 'open') {
    input.note(`${descriptor.label} is not machine-readable. ${descriptor.manualRoute ?? 'It has to be obtained by hand.'}`);
    return { source: descriptor.id, access: descriptor.access, records: [], manualRoute: descriptor.manualRoute ?? null };
  }
  if (credentialId) await noteCredentialUse(ctx.tenantId, credentialId, 'ok');
  return { source: descriptor.id, access: descriptor.access, records: [], note: descriptor.whatItWouldHaveAnswered };
}

/** Headers a stored credential contributes, resolved at the moment of use. */
function authHeaders(tenantId: string, credentialId: string | undefined): Record<string, string> {
  if (!credentialId) return {};
  const cred = secretFor(tenantId, credentialId);
  if (!cred) throw new NodeFailed('The credential this node uses is no longer here.');
  switch (cred.kind) {
    case 'bearer_token':
      return { authorization: `Bearer ${cred.secret}` };
    case 'api_key':
      return { [cred.target || 'x-api-key']: cred.secret };
    case 'header':
      return { [cred.target || 'authorization']: cred.secret };
    case 'basic_auth':
      return { authorization: `Basic ${Buffer.from(`${cred.username ?? ''}:${cred.secret}`).toString('base64')}` };
    default:
      return {};
  }
}

/**
 * How long an MCP server has to answer before the node gives up.
 *
 * The same ceiling `runHttp` applies to a plain request. An MCP call is not a
 * cheaper thing than an HTTP one — it *is* an HTTP one — so there was never a
 * reason for it to be able to wait forever: a scheduled tick awaits its flows
 * one after another, so one server that accepts the connection and never
 * answers stalled every later flow in every workspace behind it.
 */
const MCP_TIMEOUT_MS = 30_000;

async function runHttp(input: NodeHandlerInput, ctx: HandlerContext): Promise<Payload> {
  if (input.node.config.kind !== 'http') return {};
  const c = input.node.config;
  const url = fillTemplate(c.url, input.payload);
  if (input.dryRun) return { status: 0, body: null, dryRun: true, url };

  // Before anything is sent, and after the template has been filled — a URL
  // assembled from the payload is exactly the one worth checking. See
  // `./outbound.ts` for why a text field plus a stored credential is an SSRF
  // primitive rather than merely a feature.
  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [k, v] of Object.entries(c.headers ?? {})) headers[k] = fillTemplate(v, input.payload);
  Object.assign(headers, authHeaders(ctx.tenantId, c.credentialId));
  const body = c.body ? fillTemplate(c.body, input.payload) : undefined;
  if (body) headers['content-type'] ??= 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(c.timeoutMs ?? 15_000, 60_000));
  try {
    const res = await fetchOutbound(url, { method: c.method, headers, body, signal: controller.signal });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* a non-JSON body is the answer as it came */
    }
    if (c.credentialId) await noteCredentialUse(ctx.tenantId, c.credentialId, res.ok ? 'ok' : 'refused');
    if (!res.ok) throw new NodeFailed(`${url} answered ${res.status}.`);
    return { status: res.status, body: parsed };
  } catch (err) {
    if (err instanceof NodeFailed) throw err;
    // A refusal already says exactly what was wrong and what to do about it.
    // Wrapping it in "did not answer" would replace that with a lie: the
    // address answered, and was declined.
    if (err instanceof OutboundRefused) throw new NodeFailed(err.message);
    if (c.credentialId) await noteCredentialUse(ctx.tenantId, c.credentialId, 'unreachable');
    throw new NodeFailed(`${url} did not answer: ${err instanceof Error ? err.message : asText(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function runMcp(input: NodeHandlerInput, ctx: HandlerContext): Promise<Payload> {
  if (input.node.config.kind !== 'mcp') return {};
  const c = input.node.config;
  const cred = c.credentialId ? secretFor(ctx.tenantId, c.credentialId) : undefined;
  const url = c.url?.trim() || cred?.target;
  if (!url) throw new NodeFailed('This node has no MCP server to talk to.');
  if (input.dryRun) return { tool: c.tool, server: url, result: null, dryRun: true };

  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.arguments ?? {})) args[k] = fillTemplate(v, input.payload);

  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (cred?.secret) headers.authorization = `Bearer ${cred.secret}`;

  /*
   * The same ceiling `runHttp` has always had, which this node did not.
   *
   * A scheduled tick awaits its flows one after another, so a single MCP
   * server that accepts the connection and never answers stalled the whole
   * pass — every later flow, in every workspace, behind one unresponsive
   * endpoint — until the process was restarted.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const res = await fetchOutbound(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: c.tool, arguments: args } }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (c.credentialId) await noteCredentialUse(ctx.tenantId, c.credentialId, res.ok ? 'ok' : 'refused');
    if (!res.ok) throw new NodeFailed(`The MCP server answered ${res.status}.`);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* a server that does not answer JSON-RPC is reported as it replied */
    }
    const rpc = parsed as { error?: { message?: string }; result?: unknown };
    if (rpc?.error) throw new NodeFailed(`${c.tool} refused: ${rpc.error.message ?? 'no reason given'}`);
    return { tool: c.tool, result: rpc?.result ?? parsed };
  } catch (err) {
    if (err instanceof NodeFailed) throw err;
    if (err instanceof OutboundRefused) throw new NodeFailed(err.message);
    if (c.credentialId) await noteCredentialUse(ctx.tenantId, c.credentialId, 'unreachable');
    throw new NodeFailed(`The MCP server did not answer: ${err instanceof Error ? err.message : asText(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function runAgent(input: NodeHandlerInput, ctx: HandlerContext): Promise<Payload> {
  if (input.node.config.kind !== 'agent') return {};
  const c = input.node.config;
  const route = resolveRoute(c.agent).route;
  const model = c.model || route.model;

  if (input.dryRun) {
    return { agent: c.agent, model, text: '', dryRun: true };
  }

  const capability = agentCapability();
  if (!capability.available) {
    /*
     * Not a failure. A deployment with no model configured is the product's
     * documented floor, and a flow that stops dead there would make the whole
     * canvas unusable locally — so the node reports what it could not do and
     * the run carries on with that on the payload for a filter to read.
     */
    input.note(`No model is configured, so ${c.agent} did not run.`);
    return { agent: c.agent, model, text: '', unavailable: true, reason: capability.reason };
  }

  const { providerFor, textOf } = await import('@realytica/agents');
  const provider = providerFor('anthropic');
  const instruction = [
    `You are the ${c.agent.replace(/_/g, ' ')} agent, running as one node of an operator-drawn flow.`,
    'Answer only from what you are given. Say what you do not know rather than filling it in.',
    c.extraInstruction?.trim() || '',
  ]
    .filter(Boolean)
    .join(' ');

  const result = await provider.complete({
    agent: c.agent,
    model,
    maxTokens: Math.min(c.maxTokens ?? 1500, 8000),
    system: [{ text: instruction }],
    messages: [{ role: 'user', content: JSON.stringify(input.payload).slice(0, 24_000) }],
  });

  const text = textOf(result).trim();
  return { agent: c.agent, model, text, tokens: result.usage?.outputTokens ?? 0 };
}

/**
 * The handler the engine calls, bound to one run's context.
 *
 * Every kind the engine does not own itself lands here. A kind with no case is
 * a bug rather than a no-op, and it says so on the trace — a node that
 * silently did nothing is the thing that makes a flow untrustworthy.
 */
export function handlersFor(ctx: HandlerContext): NodeHandler {
  return async (input) => {
    switch (input.node.config.kind) {
      case 'agent':
        return runAgent(input, ctx);
      case 'query':
        return runQuery(input, ctx);
      case 'retrieve':
        return runRetrieve(input, ctx);
      case 'connector':
        return runConnector(input, ctx);
      case 'http':
        return runHttp(input, ctx);
      case 'mcp':
        return runMcp(input, ctx);
      default:
        throw new NodeFailed(`This build has no handler for a ${input.node.kind} node.`);
    }
  };
}
