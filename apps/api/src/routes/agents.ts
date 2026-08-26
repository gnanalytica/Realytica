import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AgentKind, AgentRun, AgentStep, CaseDocument, CaseIntelligence, CopilotTurn, PropertyCase } from '@valytica/shared';
import { REFERENCE_DATA } from '@valytica/shared';
import { agentCapability, describeError, runCopilot, runExplorer, runOrchestration, type RunOrchestrationResult } from '@valytica/agents';
import { store, caseUploadDir } from '../store';
import { findCase } from './cases';
import { agentKindSchema, copilotBodySchema, runAgentsBodySchema } from '../schemas';

/**
 * Agent layer routes.
 *
 * Valytica runs local-first — the deterministic screen is the product's
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
 * Where an uploaded document's bytes live on disk, mirroring the convention
 * `routes/documents.ts` writes to. Demo-seeded documents carry no real file,
 * so a missing file resolves to `null` rather than a path document
 * intelligence would fail to read.
 */
function resolveDocumentPath(caseId: string, document: CaseDocument): string | null {
  const filePath = path.join(caseUploadDir(caseId), `${document.id}${path.extname(document.fileName)}`);
  return fs.existsSync(filePath) ? filePath : null;
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
    explorations: prev.explorations ?? [],
    pathways: result.intelligence.pathways ?? prev.pathways,
    research: result.intelligence.research ?? prev.research,
    insights: result.intelligence.insights ?? prev.insights,
    conversation: prev.conversation,
    lastRunAt: result.intelligence.lastRunAt ?? prev.lastRunAt,
  };
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
  res.json(agentCapability());
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
      resolveDocumentPath: (document) => resolveDocumentPath(found.id, document),
    });
    applyOrchestrationResult(found, result, now);
    store.scheduleSave();
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
  res.flushHeaders();

  let closed = false;
  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, 15000);

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
      resolveDocumentPath: (document) => resolveDocumentPath(found.id, document),
      onStep: (step: AgentStep) => send('step', step),
      onRun: (run: AgentRun) => send('run', run),
    });
    if (!closed) {
      applyOrchestrationResult(found, result, new Date().toISOString());
      store.scheduleSave();
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
    const { run, turn: assistantTurn } = await runCopilot({
      caseId: found.id,
      caseData: found,
      refData: REFERENCE_DATA,
      question: parsed.data.question,
      history,
      now,
    });
    if (!found.intelligence) found.intelligence = emptyIntelligence();
    found.intelligence.conversation = [...found.intelligence.conversation, userTurn, assistantTurn];
    found.intelligence.runs = [...found.intelligence.runs, run];
    found.updatedAt = new Date().toISOString();
    store.scheduleSave();
    res.json({ userTurn, assistantTurn });
  } catch (e) {
    res.status(502).json({ error: describeError(e) });
  }
});

caseAgentsRouter.delete<{ id: string }>('/conversation', (req, res) => {
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
  store.scheduleSave();
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
    store.scheduleSave();
    res.json(found);
  } catch (e) {
    res.status(502).json({ error: describeError(e) });
  }
});
