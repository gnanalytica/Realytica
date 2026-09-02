import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  CREDENTIAL_KINDS,
  FLOW_NODE_KINDS,
  FLOW_NODE_TYPES,
  flowCanRun,
  runFlow,
  validateFlow,
  type CredentialKind,
  type Flow,
  type FlowNodeKind,
} from '@realytica/shared';
import { allDescriptors, allRoutes } from '@realytica/agents';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';
import { projectFor } from '../auth/access';
import { promptStore } from '../prompts';
import { handlersFor } from '../flows/handlers';
import {
  deleteCredential,
  listCredentials,
  saveCredential,
  updateCredential,
} from '../flows/credentials';
import { CredentialKeyMissing } from '../flows/secret-box';

/**
 * The agentic framework as an editable thing.
 *
 * Flows are workspace data, so everything here is scoped to the caller's
 * workspace the same way projects are, and a flow in another one is a 404 for
 * the same reason. Editing is `admin`: a flow decides what the agents do and
 * what they cost, which is the workspace's business rather than any member's.
 *
 * Running is deliberately separate from saving. A run reaches models and
 * portals and spends money; a save does not, and an operator drawing something
 * should be able to save it half-finished without anything happening.
 */
export const flowsRouter = Router();

/* ==================================================================== */
/* What the palette can offer                                            */
/* ==================================================================== */

/**
 * Everything the canvas needs to draw a palette and fill an inspector's
 * dropdowns, in one call.
 *
 * One call rather than five because these are read together on every open, and
 * a canvas that renders before it knows which agents exist draws a node type
 * list that changes under the reader's hands.
 */
flowsRouter.get('/catalogue', needs('read'), async (req, res) => {
  const me = principalOf(req);
  const descriptors = await promptStore.descriptors();
  res.json({
    nodeTypes: FLOW_NODE_KINDS.map((kind) => FLOW_NODE_TYPES[kind]),
    agents: allRoutes().map((r) => ({ agent: r.agent, tier: r.tier, model: r.model })),
    /** Sources carry their own access level, so the canvas can warn before a run does. */
    connectors: allDescriptors().map((d) => ({
      id: d.id,
      label: d.label,
      authority: d.authority,
      access: d.access,
      whatItWouldHaveAnswered: d.whatItWouldHaveAnswered,
      manualRoute: d.manualRoute ?? null,
    })),
    prompts: descriptors.map((d) => ({
      key: d.key,
      label: d.label,
      versions: d.versions.map((v) => ({ id: v.id, label: v.label, builtIn: v.builtIn, active: v.id === d.activeVersionId })),
    })),
    credentials: listCredentials(me.tenantId),
    credentialKinds: CREDENTIAL_KINDS,
  });
});

/* ==================================================================== */
/* Flows                                                                 */
/* ==================================================================== */

function flows(): Flow[] {
  if (!store.data.flows) store.data.flows = [];
  return store.data.flows;
}

function mine(tenantId: string): Flow[] {
  return flows().filter((f) => f.tenantId === tenantId);
}

const positionSchema = z.object({ x: z.number(), y: z.number() });
const nodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(FLOW_NODE_KINDS as [FlowNodeKind, ...FlowNodeKind[]]),
  label: z.string().max(120).optional(),
  position: positionSchema,
  disabled: z.boolean().optional(),
  note: z.string().max(2000).optional(),
  // Node config is a discriminated union with twelve arms and a `kind` that
  // must match the node's own. Rather than restate it as a Zod union that
  // would drift from the type, the shape is checked structurally here and the
  // meaning is checked by `validateFlow`, which is the same function the
  // canvas runs and the only one that knows what a valid node means.
  config: z.record(z.unknown()),
});
const edgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  fromPort: z.string().min(1),
  to: z.string().min(1),
});
const flowBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  nodes: z.array(nodeSchema).max(300),
  edges: z.array(edgeSchema).max(600),
  enabled: z.boolean().optional(),
});

/** A saved flow, plus what is wrong with it. The canvas shows both. */
function withProblems(flow: Flow) {
  return { flow, problems: validateFlow(flow), canRun: flowCanRun(flow) };
}

flowsRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  res.json(
    mine(me.tenantId)
      .map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        enabled: f.enabled,
        nodeCount: f.nodes.length,
        updatedAt: f.updatedAt,
        updatedBy: f.updatedBy,
        version: f.version,
        canRun: flowCanRun(f),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
});

flowsRouter.get('/:flowId', needs('read'), (req, res) => {
  const me = principalOf(req);
  const flow = mine(me.tenantId).find((f) => f.id === req.params.flowId);
  if (!flow) {
    res.status(404).json({ error: 'Flow not found' });
    return;
  }
  res.json(withProblems(flow));
});

flowsRouter.post('/', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = flowBodySchema.partial({ nodes: true, edges: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const at = new Date().toISOString();
  const flow: Flow = {
    id: `flw_${randomUUID()}`,
    tenantId: me.tenantId,
    name: parsed.data.name,
    ...(parsed.data.description ? { description: parsed.data.description } : {}),
    // A new flow starts with its trigger already placed. An empty canvas with
    // a palette is a puzzle; one node and an obvious next step is a start.
    nodes: (parsed.data.nodes as unknown as Flow['nodes'] | undefined) ?? [
      { id: `nd_${randomUUID()}`, kind: 'trigger', position: { x: 80, y: 160 }, config: { kind: 'trigger', on: 'manual' } },
    ],
    edges: (parsed.data.edges as unknown as Flow['edges'] | undefined) ?? [],
    enabled: false,
    createdAt: at,
    createdBy: me.email,
    updatedAt: at,
    updatedBy: me.email,
    version: 1,
  };
  flows().push(flow);
  await store.save();
  res.status(201).json(withProblems(flow));
});

flowsRouter.put('/:flowId', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const flow = mine(me.tenantId).find((f) => f.id === req.params.flowId);
  if (!flow) {
    res.status(404).json({ error: 'Flow not found' });
    return;
  }
  const parsed = flowBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  flow.name = parsed.data.name;
  flow.description = parsed.data.description;
  flow.nodes = parsed.data.nodes as unknown as Flow['nodes'];
  flow.edges = parsed.data.edges as unknown as Flow['edges'];
  if (parsed.data.enabled !== undefined) flow.enabled = parsed.data.enabled;
  flow.updatedAt = new Date().toISOString();
  flow.updatedBy = me.email;
  // Bumped on every save so a run can record which shape of the flow it was,
  // which is the only way a trace from last week stays readable after an edit.
  flow.version += 1;
  await store.save();
  res.json(withProblems(flow));
});

flowsRouter.delete('/:flowId', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const before = flows().length;
  store.data.flows = flows().filter((f) => !(f.id === req.params.flowId && f.tenantId === me.tenantId));
  if (store.data.flows.length === before) {
    res.status(404).json({ error: 'Flow not found' });
    return;
  }
  await store.save();
  res.status(204).end();
});

/* ==================================================================== */
/* Running one                                                           */
/* ==================================================================== */

const runBodySchema = z.object({
  projectId: z.string().min(1),
  /** A rehearsal reaches nothing and spends nothing. The default, deliberately. */
  dryRun: z.boolean().optional(),
  input: z.record(z.unknown()).optional(),
});

flowsRouter.post('/:flowId/run', needs('write'), async (req, res) => {
  const me = principalOf(req);
  const flow = mine(me.tenantId).find((f) => f.id === req.params.flowId);
  if (!flow) {
    res.status(404).json({ error: 'Flow not found' });
    return;
  }
  const parsed = runBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (!flowCanRun(flow)) {
    res.status(400).json({ error: 'This flow has problems that stop it running.', problems: validateFlow(flow) });
    return;
  }

  const bootstrap = store.data.tenants?.[0]?.id;
  const found = (store.data.projects ?? []).find((p) => p.id === parsed.data.projectId);
  if (!found || (found.tenantId ?? bootstrap) !== me.tenantId) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // The flow sees the project as whoever started the run may see it. A
  // collaborator's run cannot read past their own grant, with no rule of its
  // own — the same projection every other read on this deployment goes through.
  const project = projectFor(req, found);

  // Rehearsal unless asked otherwise: a run started by a mis-click should cost
  // nothing, and the whole point of drawing a flow is to look before paying.
  const dryRun = parsed.data.dryRun !== false;

  const result = await runFlow(flow, {
    handler: handlersFor({ tenantId: me.tenantId, project, actor: me.email }),
    input: { project: { id: project.id, name: project.name, reference: project.reference }, ...(parsed.data.input ?? {}) },
    dryRun,
  });
  res.json({ ...result, dryRun });
});

/* ==================================================================== */
/* Credentials                                                           */
/* ==================================================================== */

const credentialSchema = z.object({
  label: z.string().trim().min(1).max(120),
  kind: z.enum(CREDENTIAL_KINDS as [CredentialKind, ...CredentialKind[]]),
  secret: z.string().min(1).max(8000),
  username: z.string().max(200).optional(),
  target: z.string().max(500).optional(),
});

flowsRouter.get('/credentials/all', needs('admin'), (req, res) => {
  res.json(listCredentials(principalOf(req).tenantId));
});

flowsRouter.post('/credentials', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    res.status(201).json(await saveCredential({ tenantId: me.tenantId, createdBy: me.email, ...parsed.data }));
  } catch (err) {
    // A deployment with no sealing key refuses the write rather than storing
    // plaintext, and the operator needs to be told which knob that is — a 500
    // here would read as "the product is broken" rather than "set this".
    if (err instanceof CredentialKeyMissing) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }
});

flowsRouter.patch('/credentials/:credentialId', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = credentialSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  let updated;
  try {
    updated = await updateCredential(me.tenantId, req.params.credentialId, parsed.data);
  } catch (err) {
    if (err instanceof CredentialKeyMissing) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (!updated) {
    res.status(404).json({ error: 'Credential not found' });
    return;
  }
  res.json(updated);
});

flowsRouter.delete('/credentials/:credentialId', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  if (!(await deleteCredential(me.tenantId, req.params.credentialId))) {
    res.status(404).json({ error: 'Credential not found' });
    return;
  }
  res.status(204).end();
});
