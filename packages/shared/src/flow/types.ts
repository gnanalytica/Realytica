/**
 * A flow: the agentic pipeline as data rather than as code.
 *
 * ## The one rule that shapes everything here
 *
 * **A node type is code. A flow is data.** n8n works this way and so does
 * this: you compose shipped node types on a canvas, you do not author a new
 * node type in one. `document_intelligence` is a prompt, a tool set and a
 * parser that agrees with the prompt — a canvas cannot conjure that, and a
 * product that pretended otherwise would be offering a box that produces
 * plausible nonsense.
 *
 * What the canvas *does* own is everything around the node: which model it
 * runs on, which prompt version, whether it runs at all, what feeds it, what
 * it feeds, and the conditions on those edges. That is the part that is
 * currently spread across a TypeScript table, four environment variables and
 * one hardcoded orchestrator, and it is the part an operator actually needs to
 * change without a deploy.
 *
 * ## Why a graph rather than a list
 *
 * The existing orchestrator is a list with an `order` number, which can
 * express "these run before those" and nothing else. It cannot say "read the
 * deed, and only if it came back unreadable, read it again at a higher tier",
 * and that shape is most of what diligence actually is. Edges carry
 * conditions; a node runs when an edge into it is taken.
 *
 * ## What a run does NOT get to do
 *
 * Nothing here writes a finding, a risk or a decision. The output node
 * proposes a draft, and a person commits it — the same rule the chat has, for
 * the same reason. A flow an operator drew is not evidence, and a pipeline
 * that could sign off its own conclusions would make the audit trail a record
 * of what the machine decided rather than of what anybody agreed to.
 */

import type { AgentKind, ModelTier } from '../types';

/* ==================================================================== */
/* Nodes                                                                 */
/* ==================================================================== */

/**
 * What a node *is*. Closed, because each one is backed by a handler in the
 * engine — a kind with no handler is a node that silently does nothing.
 */
export type FlowNodeKind =
  /** Where a run starts. Exactly one per flow. */
  | 'trigger'
  /** A shipped agent: a model call with a prompt, a tool set and a parser. */
  | 'agent'
  /** A deterministic read over the project's own registers. No model. */
  | 'query'
  /** Retrieval over the project graph and cross-project memory. */
  | 'retrieve'
  /** An external data source from the connector registry. */
  | 'connector'
  /** A tool server spoken to over MCP. */
  | 'mcp'
  /** An arbitrary HTTP call the operator configured. */
  | 'http'
  /** Keeps going only when the payload satisfies a test. */
  | 'filter'
  /** Splits the path: the first matching case wins, else the default port. */
  | 'branch'
  /** Runs its body once per item of a collection on the payload. */
  | 'loop'
  /** Reshapes the payload: pick, rename, set. */
  | 'transform'
  /** Proposes a draft for a person to accept. The only way a flow reaches the file. */
  | 'output';

export const FLOW_NODE_KINDS: FlowNodeKind[] = [
  'trigger',
  'agent',
  'query',
  'retrieve',
  'connector',
  'mcp',
  'http',
  'filter',
  'branch',
  'loop',
  'transform',
  'output',
];

/** Where a node sits on the canvas. Presentation, but persisted — a layout somebody arranged is theirs. */
export interface FlowPosition {
  x: number;
  y: number;
}

/**
 * One test against the run payload.
 *
 * Deliberately a small closed set of operators over a dotted path rather than
 * an expression language. An expression box is the feature that turns a
 * configuration surface into a runtime nobody can audit, and "the flow did
 * something odd" becomes unanswerable. Every condition here can be rendered
 * back as a sentence, which is what makes a drawn flow reviewable.
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_true'
  | 'is_false';

export const CONDITION_OPERATORS: ConditionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
];

export interface FlowCondition {
  /** Dotted path into the run payload, e.g. `document.readable` or `findings.length`. */
  path: string;
  operator: ConditionOperator;
  /** Absent for the unary operators. Compared as a string unless both sides parse as numbers. */
  value?: string;
}

/** Several tests, and how they combine. */
export interface FlowConditionGroup {
  match: 'all' | 'any';
  conditions: FlowCondition[];
}

/* ---- per-kind configuration ---------------------------------------- */

export interface AgentNodeConfig {
  agent: AgentKind;
  /** Overrides the agent's tier for this node only. Absent means the shipped tier. */
  tier?: ModelTier;
  /** Overrides the tier's model. Absent means whatever the tier resolves to. */
  model?: string;
  /** Which prompt version is in force here. Absent means whatever the registry has active. */
  promptVersionId?: string;
  /** Extra instruction appended to the prompt for this node. Never replaces it. */
  extraInstruction?: string;
  maxTokens?: number;
  /** Transport retries for this node. Bounded by the engine regardless. */
  retries?: number;
}

export interface QueryNodeConfig {
  /** Which register to read. */
  register: 'evidence' | 'findings' | 'risks' | 'actions' | 'checks' | 'assessments' | 'decisions';
  /** Rows kept. Absent means all of them. */
  where?: FlowConditionGroup;
  limit?: number;
}

export interface RetrieveNodeConfig {
  /** The project's own graph, or what earlier files taught memory. */
  from: 'graph' | 'memory' | 'shelf';
  /** What to look up. Supports `{{path}}` substitution from the payload. */
  query: string;
  hops?: number;
  limit?: number;
}

export interface ConnectorNodeConfig {
  /** An id from the data-source registry. */
  sourceId: string;
  /** The credential this connector authenticates with, by id. Never the secret itself. */
  credentialId?: string;
  /** Per-source settings, kept loose because each source wants different ones. */
  settings?: Record<string, string>;
}

export interface McpNodeConfig {
  /** The MCP server this node talks to, by credential id — the URL lives with the secret. */
  credentialId?: string;
  /** Server URL, when it needs no credential. */
  url?: string;
  /** Which tool on that server to call. */
  tool: string;
  /** Arguments, with `{{path}}` substitution from the payload. */
  arguments?: Record<string, string>;
}

export interface HttpNodeConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Supports `{{path}}` substitution. */
  url: string;
  headers?: Record<string, string>;
  /** JSON body as text, with `{{path}}` substitution. */
  body?: string;
  credentialId?: string;
  timeoutMs?: number;
}

export interface FilterNodeConfig {
  where: FlowConditionGroup;
}

/** One labelled way out of a branch. */
export interface BranchCase {
  id: string;
  label: string;
  where: FlowConditionGroup;
}

export interface BranchNodeConfig {
  cases: BranchCase[];
}

export interface LoopNodeConfig {
  /** Dotted path to an array on the payload. */
  over: string;
  /** What each item is called inside the body. */
  itemName: string;
  /** Hard ceiling. The engine clamps this — an unbounded loop is an unbounded bill. */
  maxIterations?: number;
}

export interface TransformNodeConfig {
  /** `to` is the new key, `from` a dotted path or a `{{path}}` template. */
  set: Array<{ to: string; from: string }>;
  /** Keys dropped from the payload before it moves on. */
  drop?: string[];
}

export interface OutputNodeConfig {
  /** What kind of draft this proposes. A person accepts it; the flow never commits. */
  draft: 'finding' | 'action' | 'evidence_request' | 'note';
  /** Title template, with `{{path}}` substitution. */
  title: string;
  bodyTemplate?: string;
}

export interface TriggerNodeConfig {
  /** What starts a run. */
  on: 'manual' | 'project_created' | 'evidence_uploaded' | 'assessment_started' | 'schedule';
  /** For `schedule`: a plain interval in minutes rather than cron, because cron is a second language. */
  everyMinutes?: number;
}

export type FlowNodeConfig =
  | ({ kind: 'trigger' } & TriggerNodeConfig)
  | ({ kind: 'agent' } & AgentNodeConfig)
  | ({ kind: 'query' } & QueryNodeConfig)
  | ({ kind: 'retrieve' } & RetrieveNodeConfig)
  | ({ kind: 'connector' } & ConnectorNodeConfig)
  | ({ kind: 'mcp' } & McpNodeConfig)
  | ({ kind: 'http' } & HttpNodeConfig)
  | ({ kind: 'filter' } & FilterNodeConfig)
  | ({ kind: 'branch' } & BranchNodeConfig)
  | ({ kind: 'loop' } & LoopNodeConfig)
  | ({ kind: 'transform' } & TransformNodeConfig)
  | ({ kind: 'output' } & OutputNodeConfig);

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  /** What the operator called it. Falls back to the node type's own label. */
  label?: string;
  position: FlowPosition;
  /** Off, but kept — a node somebody disabled is a decision, not a deletion. */
  disabled?: boolean;
  /** A note the operator left on the node. */
  note?: string;
  config: FlowNodeConfig;
}

/* ==================================================================== */
/* Edges                                                                 */
/* ==================================================================== */

/**
 * A connection between two nodes.
 *
 * `fromPort` matters only for the kinds that have more than one way out: a
 * branch names its case, a loop distinguishes its body from what follows it,
 * a filter has `pass`. Everything else uses `out`.
 */
export interface FlowEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
}

/** The ports a node offers, decided by its kind and its configuration. */
export const DEFAULT_OUT_PORT = 'out';
export const LOOP_BODY_PORT = 'body';
export const LOOP_DONE_PORT = 'done';
export const FILTER_PASS_PORT = 'pass';
export const BRANCH_DEFAULT_PORT = 'default';

/* ==================================================================== */
/* The flow                                                              */
/* ==================================================================== */

export interface Flow {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Off by default. A flow nobody has enabled never runs, however it is triggered. */
  enabled: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Bumped on every save, so a run can record which shape of the flow it was. */
  version: number;
}

/* ==================================================================== */
/* Credentials                                                           */
/* ==================================================================== */

/**
 * A secret a node authenticates with.
 *
 * The value is **write-only**: it is stored, and no route ever returns it.
 * Everything a screen needs to show — that it exists, what it is for, when it
 * was last used, whether the last use worked — is on the record beside it, so
 * the UI never has a reason to ask for the secret back.
 *
 * Storing these at all is a deliberate change to this deployment's blast
 * radius, and it is written down here rather than left implicit: the store is
 * one JSON document, so a backup of it now carries credentials. `docs/auth.md`
 * says so, and `CredentialRecord.hint` exists so an operator can tell two keys
 * apart without either being displayed.
 */
export type CredentialKind = 'api_key' | 'bearer_token' | 'basic_auth' | 'header' | 'mcp_server';

export const CREDENTIAL_KINDS: CredentialKind[] = ['api_key', 'bearer_token', 'basic_auth', 'header', 'mcp_server'];

export interface CredentialRecord {
  id: string;
  tenantId: string;
  label: string;
  kind: CredentialKind;
  /** The last four characters, so two keys are tellable apart without showing either. */
  hint: string;
  /** For `header`: which header to send. For `mcp_server`: the server URL. */
  target?: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  /** What happened the last time something authenticated with this. */
  lastResult?: 'ok' | 'refused' | 'unreachable';
}

/** The stored form. Never leaves the server. */
export interface StoredCredential extends CredentialRecord {
  secret: string;
  /** For `basic_auth`. */
  username?: string;
}
