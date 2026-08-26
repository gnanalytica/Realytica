import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentKind, AgentRun, AgentStep, CaseDocument, CaseIntelligence, CopilotTurn, PropertyCase } from '@realytica/shared';
import { REFERENCE_DATA } from '@realytica/shared';
import { agentCapability, capabilityWithRoutes, describeError, describeProviders, recallForCase, resolveRoute, runCopilot, runExplorer, runOrchestration, type RunOrchestrationResult } from '@realytica/agents';
import { memoryStore } from '../memory';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { findCase } from './cases';
import { agentKindSchema, copilotBodySchema, runAgentsBodySchema } from '../schemas';

/**
 * Agent layer routes.
 *
 * Realytica runs local-first — the deterministic screen is the product's
 * floor and works with zero credentials. Everything under `/agents` is an
 * addition on top of it, never a requirement, so every route here (besides
 * the capability probe itself) guards on `agentCapability().available` and
 * answers a clean 503 with the reason — never a 500 — when no key is
 * configured.
 */

function emptyIntelligence(): CaseIntelligence {
  return { runs: [], explorations: [], pathways: [], research: [], insights: [], conversation: [] };
}

const ALL_AGENT_KINDS: readonly AgentKind[] = agentKindSchema.options;

function isAgentKind(value: string): value is AgentKind {
  return (ALL_AGENT_KINDS as readonly string[]).includes(value);
}

/**
 * Fetches an uploaded document's bytes via the storage adapter, mirroring the
 * convention `routes/documents.ts` writes under. Demo-seeded documents carry
 * no real file, so a missing document resolves to `null` (`getDocument`'s own
 * contract) rather than bytes document intelligence would fail to read.
 */
async function resolveDocumentBytes(caseId: string, document: CaseDocument): Promise<Buffer | null> {
  return storageAdapter.getDocument(caseId, documentKey(document));
}

/**
 * Folds one `runOrchestration` result into a case: appends its runs to the
 * history, replaces pathways/research/insights with the fresh computation
 * (they describe the case's *current* gaps and findings, not a log), leaves
 * the copilot conversation and prior exploration sessions untouched
 * (orchestration never touches either), and merges any newly produced
 * evidence into the screen's own evidence ledger — without that merge, an
 * agent-cited evidence id would never resolve via `EvidenceLink`, breaking
 * Evidence Before Assertion for everything the agents surface.
 *
 * `plan` and `verification` are read straight off `result.intelligence` —
 * both are already optional on `CaseIntelligence`, so this reads correctly
 * whether or not the orchestrator populates them yet, and once it does, no
 * change is needed here. Falling back to the previous value means a plan or
 * verification summary from an earlier run survives a later run that (for
 * whatever reason) didn't produce a fresh one, rather than disappearing.
 */
function applyOrchestrationResult(found: PropertyCase, result: RunOrchestrationResult, now: string): void {
  const prev = found.intelligence ?? emptyIntelligence();
  found.intelligence = {
    runs: [...prev.runs, ...result.runs],
    plan: result.intelligence.plan ?? prev.plan,
    verification: result.intelligence.verification ?? prev.verification,
    explorations: [...(prev.explorations ?? []), ...(result.intelligence.explorations ?? [])],
    pathways: result.intelligence.pathways ?? prev.pathways,
    research: result.intelligence.research ?? prev.research,
    insights: result.intelligence.insights ?? prev.insights,
    conversation: prev.conversation,
    lastRunAt: result.intelligence.lastRunAt ?? prev.lastRunAt,
  };

  // The feedback loop only exists if its output survives the request.
  //
  // Document intelligence merges newly extracted fields onto the documents and
  // the orchestrator re-runs the deterministic screen against them. Persisting
  // the runs but not `documents`/`screenResult` would leave the case holding a
  // stale screen and unextracted documents — the loop would run, cost money,
  // and change nothing a user can see.
  if (result.documents) {
    found.documents = result.documents;
  }
  if (result.screenResult) {
    found.result = result.screenResult;
    found.status = 'screened';
  }

  if (result.evidence.length > 0 && found.result) {
    const existingIds = new Set(found.result.evidence.map((e) => e.id));
    const fresh = result.evidence.filter((e) => !existingIds.has(e.id));
    if (fresh.length > 0) found.result.evidence = [...found.result.evidence, ...fresh];
  }
  found.updatedAt = now;
}

/** Mounted at `/api/agents` — not case-scoped, so the UI can probe availability up front. */
export const agentsCapabilityRouter = Router();

agentsCapabilityRouter.get('/capability', (_req, res) => {
  // Routes come back from `capabilityWithRoutes` with `expectedGaps` empty:
  // resolving them needs a constructed provider, and the capability probe
  // must stay answerable on a deployment that has none. Filling them is this
  // layer's job, and it is worth doing here rather than in the client —
  // "no gaps" and "gaps not computed" are indistinguishable in the data, and
  // rendering the second as the first would claim a guarantee nobody checked.
  const capability = capabilityWithRoutes();
  res.json({
    ...capability,
    routes: (capability.routes ?? []).map(r => resolveRoute(r.agent).route),
    providers: describeProviders(),
  });
});

/** Mounted at `/api/cases/:id/agents`, before the generic `/api/cases` router. */
export const caseAgentsRouter = Router({ mergeParams: true });

caseAgentsRouter.post<{ id: string }>('/run', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const capability = agentCapability();
  if (!capability.available) {
    res.status(503).json({ error: 'Agents are not configured for this deployment.', details: { reason: capability.reason } });
    return;
  }
  const parsed = runAgentsBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const now = new Date().toISOString();
    const result = await runOrchestration({
      caseData: found,
      refData: REFERENCE_DATA,
      agents: parsed.data.agents,
      now,
      resolveDocumentBytes: (document) => resolveDocumentBytes(found.id, document),
    });
    applyOrchestrationResult(found, result, now);
    await store.save();
    res.json(found);
  } catch (e) {
    res.status(502).json({ error: describeError(e) });
  }
});

// Live progress over Server-Sent Events, so the UI can show what each agent is
// doing instead of a bare spinner. GET (not POST) so it can be opened as a
// plain EventSource — the optional agent subset travels as a query param.
caseAgentsRouter.get<{ id: string }>('/stream', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const capability = agentCapability();
  if (!capability.available) {
    res.status(503).json({ error: 'Agents are not configured for this deployment.', details: { reason: capability.reason } });
    return;
  }

  const rawAgents = typeof req.query.agents === 'string' ? req.query.agents : '';
  const requested = rawAgents.split(',').map((s) => s.trim()).filter(isAgentKind);
  const agents = requested.length > 0 ? requested : undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Proxies and CDNs buffer event streams unless told not to; without this the
  // client sees an open connection delivering nothing until the run ends.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, 15000);

  /*
   * Emit one event immediately, before any model call.
   *
   * This is what lets the client tell "connected and flowing" apart from
   * "connected but buffered somewhere in between". Without it, a stream held
   * by a proxy is indistinguishable from an agent that is simply thinking, and
   * the UI has no honest basis for falling back — it would either spin forever
   * or risk starting a second, expensive run.
   */
  send('step', {
    id: 'stream-open',
    at: new Date().toISOString(),
    kind: 'plan',
    label: 'Connected to the agent run.',
  });

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  try {
    const now = new Date().toISOString();
    const result = await runOrchestration({
      caseData: found,
      refData: REFERENCE_DATA,
      agents,
      now,
      resolveDocumentBytes: (document) => resolveDocumentBytes(found.id, document),
      onStep: (step: AgentStep) => send('step', step),
      onRun: (run: AgentRun) => send('run', run),
    });
    if (!closed) {
      applyOrchestrationResult(found, result, new Date().toISOString());
      await store.save();
      send('done', found);
    }
  } catch (e) {
    send('error', { error: describeError(e) });
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
});

caseAgentsRouter.post<{ id: string }>('/copilot', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const capability = agentCapability();
  if (!capability.available) {
    res.status(503).json({
      error: 'The copilot needs Anthropic credentials, which are not configured here.',
      details: { reason: capability.reason },
    });
    return;
  }
  const parsed = copilotBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const now = new Date().toISOString();
  const userTurn: CopilotTurn = {
    id: randomUUID(),
    role: 'user',
    text: parsed.data.question,
    at: now,
    citedEvidenceIds: [],
  };

  try {
    const history = found.intelligence?.conversation ?? [];
    // Resolved here, not inside the agent: persistence belongs to the app, and
    // the agents package has to stay runnable with no store at all.
    const memory = await recallForCase(memoryStore, found, { now: new Date().toISOString() });
    const { run, turn: assistantTurn } = await runCopilot({
      caseId: found.id,
      caseData: found,
      refData: REFERENCE_DATA,
      question: parsed.data.question,
      memory,
      history,
      now,
    });
    if (!found.intelligence) found.intelligence = emptyIntelligence();
    found.intelligence.conversation = [...found.intelligence.conversation, userTurn, assistantTurn];
    found.intelligence.runs = [...found.intelligence.runs, run];
    found.updatedAt = new Date().toISOString();
    await store.save();
    res.json({ userTurn, assistantTurn });
  } catch (e) {
    res.status(502).json({ error: describeError(e) });
  }
});

caseAgentsRouter.delete<{ id: string }>('/conversation', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const capability = agentCapability();
  if (!capability.available) {
    res.status(503).json({ error: 'Agents are not configured for this deployment.', details: { reason: capability.reason } });
    return;
  }
  if (found.intelligence) found.intelligence.conversation = [];
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.status(204).end();
});

const exploreBodySchema = z.object({
  objective: z.string().min(1).max(500).optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
  maxCostUsd: z.number().positive().max(50).optional(),
});

// The explorer follows its own leads across the web rather than filling a
// fixed output shape, so it is triggered from its own endpoint instead of
// being folded into `/run` — a user opts into it deliberately, with its own
// objective and budget, rather than it firing on every orchestration pass.
caseAgentsRouter.post<{ id: string }>('/explore', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const capability = agentCapability();
  if (!capability.available) {
    res.status(503).json({ error: 'Agents are not configured for this deployment.', details: { reason: capability.reason } });
    return;
  }
  const parsed = exploreBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const now = new Date().toISOString();
    const { run, session } = await runExplorer({
      caseId: found.id,
      caseData: found,
      refData: REFERENCE_DATA,
      objective: parsed.data.objective,
      maxIterations: parsed.data.maxIterations,
      maxCostUsd: parsed.data.maxCostUsd,
      now,
    });
    if (!found.intelligence) found.intelligence = emptyIntelligence();
    found.intelligence.runs = [...found.intelligence.runs, run];
    found.intelligence.explorations = [...(found.intelligence.explorations ?? []), session];
    found.updatedAt = new Date().toISOString();
    await store.save();
    res.json(found);
  } catch (e) {
    res.status(502).json({ error: describeError(e) });
  }
});
