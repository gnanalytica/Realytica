import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import {
  runState,
  describeRun,
  CHECK_DEFINITIONS,
  DD_TYPE_DEFINITIONS,
  LIFECYCLE_STAGES,
  PROJECT_ARCHETYPES,
  SCOPE_DEFINITIONS,
  addAction,
  addAsset,
  addDecision,
  addEvidence,
  addFinding,
  addRisk,
  attachEvidenceFile,
  buildProjectGraph,
  changeStage,
  changesSincePrevious,
  commitAiDraft,
  createAssessment,
  createProject,
  createValuationRun,
  generateReport,
  linkFindingAcross,
  patchProject,
  patchRecordStatus,
  proposeAiDrafts,
  recordCheckResult,
  refreshProjectDerived,
  reviewAiDraft,
  runProjectOrchestrator,
  setAssessmentStatus,
  setValuationSignOff,
  snapshotCapabilities,
  toDashboard,
  toProjectSummary,
  updateEvidenceStatus,
  applyProjectChat,
  applyProjectAgentTurn,
  clearProjectConversation,
  extractReadableExcerpt,
  projectRegisterBriefing,
  projectToIdentity,
  renderProjectGuide,
  screenProject,
  wantsDeterministicProjectChat,
  noteProjectEdit,
  CHECK_RESULT_LABEL,
  clampGraphHops,
  projectGraphOf,
  retrieveProjectNeighbourhood,
  traceProjectNode,
  type ChatIngestFile,
  type DdProject,
  type ProjectChatResult,
  type SittingRef,
  type AgentStep,
} from '@realytica/shared';
import {
  agentCapability,
  describeError,
  enrichIngestWithDocumentIntelligence,
  extractFactsFromProject,
  recallForProject,
  renderMemoryForPrompt,
  resolveRoute,
  runProjectCopilot,
  runProjectOrchestratorAgent,
  textOf,
} from '@realytica/agents';
import { memoryStore } from '../memory';
import { gatherChatSides } from '../project-chat-sides';
import { ensureIdentitySiteContext } from '../site-context';
import { beginRun, listRuns } from '../runs/journal';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { UPLOAD_LIMITS } from './documents';
import { projectSiteContextRouter } from './site-context';
import { projectGisOverlayRouter } from './gis-overlay';
import { graphAdapter } from '../graph';
import { ingestOpenReferences, lookupShelf, shelfStatus } from '../reference/shelf-cache';
import {
  changeStageBodySchema,
  createActionBodySchema,
  createAssessmentBodySchema,
  createAssetBodySchema,
  createDecisionBodySchema,
  createEvidenceBodySchema,
  createFindingBodySchema,
  createProjectBodySchema,
  createRiskBodySchema,
  generateReportBodySchema,
  linkFindingBodySchema,
  patchEvidenceBodySchema,
  patchProjectBodySchema,
  patchStatusBodySchema,
  patchValuationBodySchema,
  projectChatBodySchema,
  projectChatProposalBodySchema,
  projectOrchestrateBodySchema,
  proposeDraftsBodySchema,
  recordCheckBodySchema,
  reviewDraftBodySchema,
} from '../project-schemas';

function projects(): DdProject[] {
  if (!store.data.projects) store.data.projects = [];
  return store.data.projects;
}

export function findProject(id: string): DdProject | undefined {
  return projects().find((p) => p.id === id);
}

function actorOf(body: { actor?: string } | undefined): string {
  return body?.actor?.trim() || 'operator';
}

function fail(res: { status: (n: number) => { json: (b: unknown) => void } }, err: unknown, fallback = 'Request failed') {
  const message = err instanceof Error ? err.message : fallback;
  const notFound = /not found/i.test(message);
  res.status(notFound ? 404 : 400).json({ error: message });
}

export const librariesRouter = Router();

librariesRouter.get('/', (_req, res) => {
  res.json({
    projectArchetypes: PROJECT_ARCHETYPES,
    lifecycleStages: LIFECYCLE_STAGES,
    scopes: SCOPE_DEFINITIONS,
    ddTypes: DD_TYPE_DEFINITIONS,
    checks: CHECK_DEFINITIONS,
  });
});

librariesRouter.get('/references', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const found = await lookupShelf(query);
  res.json({
    standing: 'reference_not_evidence',
    query,
    hits: found.hits,
    text: found.text,
    shelf: await shelfStatus(),
  });
});

librariesRouter.post('/references/ingest', async (req, res) => {
  const force = Boolean((req.body as { force?: unknown } | undefined)?.force);
  const result = await ingestOpenReferences({ force });
  res.json({
    standing: 'reference_not_evidence',
    fetched: result.fetched,
    failed: result.failed,
    skipped: result.skipped,
    entries: result.entries.map((e) => ({
      workId: e.workId,
      ok: e.ok,
      bytes: e.bytes,
      textChars: e.textChars,
      passages: e.passages.length,
      error: e.error,
    })),
    shelf: await shelfStatus(),
  });
});

export const projectsRouter = Router();
projectsRouter.use('/:projectId/site-context', projectSiteContextRouter);
projectsRouter.use('/:projectId/gis-overlay', projectGisOverlayRouter);

projectsRouter.get('/', (_req, res) => {
  const summaries = projects().map(toProjectSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(summaries);
});

projectsRouter.post('/', async (req, res) => {
  const parsed = createProjectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const project = createProject(parsed.data, store.nextProjectReference(), actorOf(parsed.data));
  projects().push(project);
  await rememberProject(project);
  await store.save();
  res.status(201).json(project);
});

projectsRouter.get('/:projectId', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  res.json(project);
});

projectsRouter.patch('/:projectId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchProjectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  patchProject(project, parsed.data, actorOf(parsed.data));
  await persistPaneWrite(project, 'Updated project details.', { citedNodeIds: [project.id] });
  res.json(project);
});

projectsRouter.get('/:projectId/dashboard', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  res.json(toDashboard(project));
});

projectsRouter.get('/:projectId/runs', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // State is derived at read time, never stored: a crashed writer cannot
  // record that it crashed, so "interrupted" is an inference from staleness.
  const now = new Date().toISOString();
  const runs = (await listRuns(project.id)).map((run) => ({
    ...run,
    state: runState(run, now),
    line: describeRun(run, now),
  }));
  res.json({ runs });
});

projectsRouter.get('/:projectId/graph', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  const built = buildProjectGraph(project);
  res.json({ ...built, adapter: graphAdapter.kind });
});

projectsRouter.get('/:projectId/graph/neighbourhood', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  const query = typeof req.query.query === 'string' ? req.query.query : typeof req.query.q === 'string' ? req.query.q : '';
  const hops = clampGraphHops(Number(req.query.hops) || 2);
  const live = retrieveProjectNeighbourhood(project, query, hops);
  if (live.seeds.length === 0) {
    res.json({
      query,
      hops,
      seeds: [],
      nodes: [],
      edges: [],
      source: 'live',
      adapter: graphAdapter.kind,
      standing: 'this_file',
      error: query.trim() ? `Nothing in this file's graph matches "${query}".` : 'query is required.',
    });
    return;
  }
  let source: 'live' | 'journal' | 'neo4j' = 'live';
  let graph = live.graph;
  try {
    const stored = await graphAdapter.neighbourhood(
      project.id,
      live.seeds.map((s) => s.id),
      hops,
    );
    if (stored && stored.nodes.length > 0) {
      graph = stored;
      source = graphAdapter.kind;
    }
  } catch {
    source = 'live';
  }
  res.json({
    query,
    hops,
    seeds: live.seeds.map((s) => ({ id: s.id, kind: s.kind, label: s.label })),
    nodes: graph.nodes,
    edges: graph.edges,
    source,
    adapter: graphAdapter.kind,
    standing: 'this_file',
  });
});

projectsRouter.get('/:projectId/graph/trace/:nodeId', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  const cone = traceProjectNode(projectGraphOf(project), req.params.nodeId);
  if (!cone) {
    res.status(404).json({ error: `No node "${req.params.nodeId}" in this file's graph.` });
    return;
  }
  res.json({ ...cone, standing: 'this_file', adapter: graphAdapter.kind });
});

projectsRouter.post('/:projectId/screen', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const actor = actorOf(req.body as { actor?: string } | undefined);
  const now = new Date().toISOString();
  const journal = await beginRun(project.id, 'screen', { actor });
  try {
    const site = await ensureIdentitySiteContext(project, projectToIdentity(project), now);
    await journal.step('site_context', site ? 'Site context resolved.' : 'No mapping provider; screening without a pin.');
    const applied = screenProject(project, actor, now, site);
    await persistPaneWrite(project, 'Ran the project screen.');
    await journal.finish(`Verdict ${applied.snapshot.verdict}.`);
    res.status(201).json({ snapshot: applied.snapshot, valuationId: applied.valuationId, project });
  } catch (err) {
    await journal.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
});

projectsRouter.post('/:projectId/valuation', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const actor = actorOf(req.body as { actor?: string } | undefined);
  const run = createValuationRun(project, actor);
  await persistPaneWrite(project, 'Created a valuation run.');
  res.status(201).json(run);
});

projectsRouter.patch('/:projectId/valuation/:runId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchValuationBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const run = setValuationSignOff(project, req.params.runId, parsed.data.signOff, actorOf(parsed.data));
    await persistPaneWrite(project, `Updated valuation sign-off to ${parsed.data.signOff}.`);
    res.json(run);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/capabilities', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const runs = snapshotCapabilities(project, actorOf(req.body as { actor?: string } | undefined));
  await persistPaneWrite(project, 'Snapshot capabilities.');
  res.json(runs);
});

projectsRouter.post('/:projectId/ai/drafts', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = proposeDraftsBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const capability = agentCapability();
  const drafts = proposeAiDrafts(project, actorOf(parsed.data), 'rule');
  await persistPaneWrite(project, `Proposed ${drafts.length} AI draft(s).`);
  res.status(201).json({ drafts, agent: { available: capability.available, reason: capability.reason } });
});

projectsRouter.patch('/:projectId/ai/drafts/:draftId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = reviewDraftBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const draft = reviewAiDraft(project, req.params.draftId, parsed.data.status, parsed.data.reviewNote, actorOf(parsed.data));
    await persistPaneWrite(project, `Reviewed draft “${draft.title}” (${parsed.data.status}).`);
    res.json(draft);
  } catch (err) {
    fail(res, err);
  }
});

function skipLlmForChat(result: ProjectChatResult): boolean {
  if (result.commands.length > 0 || result.proposals.length > 0) return true;
  const names = new Set(result.assistantTurn.toolCalls?.map((t) => t.name) ?? []);
  return (
    names.has('wizard')
    || names.has('next_step')
    || names.has('briefing')
    || names.has('ingest')
    || names.has('approve')
    || names.has('start_dd')
    || names.has('advise')
    || names.has('apply')
    || names.has('places')
    || names.has('web_search')
    || names.has('connectors')
    || names.has('locality')
    || names.has('capabilities')
    || names.has('commit_draft')
    || names.has('screen')
    || names.has('orchestrate')
    || names.has('project_copilot')
    || names.has('critic')
  );
}

function beginNdjson(res: import('express').Response): {
  line: (payload: unknown) => void;
  clientGone: () => boolean;
} {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  let gone = false;
  res.on('close', () => {
    gone = true;
  });
  return {
    clientGone: () => gone,
    line: (payload: unknown) => {
      if (gone) return;
      res.write(`${JSON.stringify(payload)}\n`);
    },
  };
}

async function rememberProject(project: DdProject): Promise<void> {
  try {
    const facts = extractFactsFromProject(project, { now: new Date().toISOString() });
    if (facts.length) await memoryStore.assertMany(facts);
  } catch {
    /* memory must not block chat */
  }
}

async function persistPaneWrite(
  project: DdProject,
  summary: string,
  extra?: { citedNodeIds?: string[]; citedEvidenceIds?: string[] },
): Promise<void> {
  noteProjectEdit(project, summary, extra);
  await rememberProject(project);
  await store.save();
}

function sittingFromBody(value: unknown): SittingRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const sitting: SittingRef = {
    ddId: typeof row.ddId === 'string' ? row.ddId : undefined,
    scopeId: typeof row.scopeId === 'string' ? row.scopeId : undefined,
    checkId: typeof row.checkId === 'string' ? row.checkId : undefined,
  };
  if (!sitting.ddId && !sitting.scopeId && !sitting.checkId) return undefined;
  return sitting;
}

projectsRouter.post('/:projectId/chat', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = projectChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  refreshProjectDerived(project);
  const question = parsed.data.question;
  const actor = actorOf(parsed.data);
  const sitting = parsed.data.sitting;
  const capability = agentCapability();
  const deterministic = wantsDeterministicProjectChat(project, question, { sitting });
  const stream = beginNdjson(res);
  const { line, clientGone } = stream;

  if (!deterministic && capability.available) {
    /*
     * The durable ledger. Everything below lives inside this one request:
     * if the function dies mid-run there is otherwise no record the run
     * happened. `beginRun` makes the running record durable before the first
     * model token; steps are chained onto `journalTail` because the agent's
     * onStep is synchronous, and the tail is awaited before the response
     * ends so no checkpoint is left unflushed behind a sent response.
     */
    const journal = await beginRun(project.id, 'chat_model', { question, actor });
    let journalTail: Promise<void> = Promise.resolve();
    try {
      let memoryText = '';
      try {
        const recall = await recallForProject(memoryStore, project, { now: new Date().toISOString() });
        memoryText = renderMemoryForPrompt(recall);
      } catch {
        memoryText = '';
      }
      const agent = await runProjectCopilot({
        project,
        question,
        actor,
        viewContext: parsed.data.viewContext,
        history: project.conversation,
        memory: memoryText || undefined,
        sitting,
        graphRag: {
          kind: graphAdapter.kind,
          neighbourhood: (projectId, seedIds, hops) => graphAdapter.neighbourhood(projectId, seedIds, hops),
        },
        lookupShelf: async (query, extra) => {
          const { lookupShelf } = await import('../reference/shelf-cache');
          const found = await lookupShelf(query, extra);
          return found.text;
        },
        onStep: (step: AgentStep) => {
          line({ type: 'step', step });
          journalTail = journalTail.then(() => journal.step(step.kind, step.label));
        },
      });
      if (clientGone()) {
        // The model finished but nobody is listening and nothing was applied.
        // That is a failed run on the ledger — the person who reopens this
        // project should see it happened and did not land, not silence.
        journalTail = journalTail.then(() => journal.fail('The connection dropped before the answer was applied.'));
        await journalTail;
        res.end();
        return;
      }
      if (agent.text && !agent.text.startsWith('The project copilot is unavailable') && !agent.text.startsWith('No model endpoint')) {
        const result = applyProjectAgentTurn(project, question, agent);
        await store.save();
        journalTail = journalTail.then(() =>
          journal.finish(
            result.assistantTurn.unsupportedClaims?.length
              ? `Answered; ${result.assistantTurn.unsupportedClaims.length} unsupported figure(s) flagged.`
              : `Answered with ${agent.toolCalls.length} tool call(s).`,
          ),
        );
        await journalTail;
        line({ type: 'result', ...result, project });
        res.end();
        return;
      }
      journalTail = journalTail.then(() => journal.fail('The copilot returned nothing usable; the wizard answered instead.'));
      await journalTail;
    } catch (e) {
      line({ type: 'step', step: { id: randomUUID(), at: new Date().toISOString(), kind: 'error', label: describeError(e) } });
      journalTail = journalTail.then(() => journal.fail(describeError(e)));
      await journalTail;
      /* fall through to the wizard — a model failure must not block chat */
    }
  }

  let sides: Awaited<ReturnType<typeof gatherChatSides>>;
  try {
    sides = await gatherChatSides(project, question);
  } catch {
    sides = undefined;
  }
  const result = applyProjectChat(project, question, {
    actor,
    viewContext: parsed.data.viewContext,
    sides,
    sitting,
  });

  if (capability.available && !skipLlmForChat(result)) {
    try {
      const { provider, route } = resolveRoute('analyst_copilot');
      const guide = renderProjectGuide(project);
      const llm = await provider.complete({
        agent: 'analyst_copilot',
        model: route.model,
        maxTokens: 1800,
        system: [
          {
            text:
              'You are the project DD copilot. Answer only from the register briefing and today\'s next step. Name one move. If they do not support an answer, say so. Do not invent findings, values, evidence, or sign-off. Do not list the evidence library. Do not file documents or start DDs — those are person-approved cards. Keep under 280 words. Cite titles, not truncated ids.',
          },
        ],
        messages: [
          { role: 'user', content: `Register briefing:\n${projectRegisterBriefing(project, parsed.data.viewContext)}` },
          { role: 'user', content: `Today's next step:\n${guide.text}` },
          { role: 'user', content: question },
        ],
      });
      const text = textOf(llm).trim();
      if (text) {
        result.assistantTurn.text = text;
        result.assistantTurn.toolCalls = [{ name: 'analyst_copilot', summary: 'Answered from project registers' }];
        const last = project.conversation[project.conversation.length - 1];
        if (last?.id === result.assistantTurn.id) {
          last.text = text;
          last.toolCalls = result.assistantTurn.toolCalls;
        }
      }
    } catch {
      /* deterministic briefing already stored — a model failure must not block chat */
    }
  }

  if (clientGone()) {
    res.end();
    return;
  }
  if (result.commands.some((c) => /approved/i.test(c))) await rememberProject(project);
  await store.save();
  line({ type: 'result', ...result, project });
  res.end();
});

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxFileBytes, files: 10 },
});

projectsRouter.post('/:projectId/chat/files', chatUpload.array('files', 10), async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }
  refreshProjectDerived(project);
  const stream = beginNdjson(res);
  const { line, clientGone } = stream;
  const ingest: ChatIngestFile[] = [];
  for (const file of files) {
    const storageKey = documentKey({ id: randomUUID(), fileName: file.originalname });
    await storageAdapter.putDocument(project.id, storageKey, file.buffer, file.mimetype);
    ingest.push({
      fileName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
      storageKey,
      excerpt: extractReadableExcerpt(file.buffer, file.mimetype || '', file.originalname) || undefined,
    });
  }
  const sitting = sittingFromBody({
    ddId: req.body?.ddId,
    scopeId: req.body?.scopeId,
    checkId: req.body?.checkId,
  });
  let enriched = ingest;
  try {
    enriched = await enrichIngestWithDocumentIntelligence({
      project,
      files: ingest,
      buffers: files.map((f) => f.buffer),
      onStep: (step) => line({ type: 'step', step }),
    });
  } catch {
    enriched = ingest;
  }
  if (clientGone()) {
    res.end();
    return;
  }
  const question = typeof req.body?.question === 'string' ? req.body.question : '';
  const viewContext = typeof req.body?.viewContext === 'string' ? req.body.viewContext : undefined;
  const result = applyProjectChat(project, question, {
    actor: actorOf(req.body as { actor?: string } | undefined),
    viewContext,
    ingest: enriched,
    sitting,
  });
  await store.save();
  line({ type: 'result', ...result, project });
  res.end();
});

projectsRouter.post('/:projectId/chat/proposals/:proposalId/commit', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = projectChatProposalBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const item = project.chatProposals.find((p) => p.id === req.params.proposalId);
  if (!item) {
    res.status(404).json({ error: 'Proposal not found' });
    return;
  }
  refreshProjectDerived(project);
  if (item.kind === 'run_screen') {
    const now = new Date().toISOString();
    await ensureIdentitySiteContext(project, projectToIdentity(project), now);
  }
  const result = applyProjectChat(project, `Approve "${item.title}"`, { actor: actorOf(parsed.data) });
  await rememberProject(project);
  await store.save();
  res.json({ ...result, project });
});

projectsRouter.post('/:projectId/chat/proposals/:proposalId/reject', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = projectChatProposalBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const item = project.chatProposals.find((p) => p.id === req.params.proposalId);
  if (!item) {
    res.status(404).json({ error: 'Proposal not found' });
    return;
  }
  refreshProjectDerived(project);
  const result = applyProjectChat(project, `Skip "${item.title}"`, { actor: actorOf(parsed.data) });
  await store.save();
  res.json({ ...result, project });
});

projectsRouter.delete('/:projectId/chat', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  clearProjectConversation(project);
  await store.save();
  res.status(204).end();
});

projectsRouter.post('/:projectId/orchestrate', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = projectOrchestrateBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const journal = await beginRun(project.id, 'orchestrate', { actor: actorOf(parsed.data) });
  const run = runProjectOrchestrator(project, actorOf(parsed.data));
  await journal.step('rule_pass', `Rule pass proposed ${run.draftIds.length} draft(s).`);
  const capability = agentCapability();
  if (capability.available) {
    try {
      const extra = await runProjectOrchestratorAgent(project, actorOf(parsed.data), run);
      if (extra.usedModel) {
        run.source = 'model';
        run.summary = extra.summary;
        const openTitles = new Set(project.chatProposals.filter((p) => p.status === 'proposed').map((p) => p.title));
        for (const card of extra.proposals) {
          if (openTitles.has(card.title)) continue;
          project.chatProposals.push(card);
          openTitles.add(card.title);
        }
        await journal.step('model_pass', `Model pass queued ${extra.proposals.length} card(s).`);
      }
    } catch (err) {
      await journal.step('model_pass_failed', err instanceof Error ? err.message : String(err));
      /* rule run already recorded */
    }
  }
  await journal.finish(`${run.source === 'model' ? 'Rule + model pass' : 'Rule pass'}; ${run.draftIds.length} draft(s).`);
  const drafts = project.aiDrafts.filter((d) => run.draftIds.includes(d.id));
  await persistPaneWrite(project, 'Orchestrated the next DD plan.');
  res.status(201).json({ run, drafts, project });
});

projectsRouter.post('/:projectId/ai/drafts/:draftId/commit', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    const result = commitAiDraft(project, req.params.draftId, actorOf(req.body as { actor?: string } | undefined));
    await persistPaneWrite(project, `Committed draft “${result.draft.title}”.`);
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.delete('/:projectId', async (req, res) => {
  const idx = projects().findIndex((p) => p.id === req.params.projectId);
  if (idx < 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  projects().splice(idx, 1);
  await store.save();
  res.status(204).end();
});

projectsRouter.post('/:projectId/assets', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createAssetBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const asset = addAsset(project, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Added asset “${asset.name}”.`, { citedNodeIds: [asset.id] });
    res.status(201).json(asset);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/stage', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = changeStageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = changeStage(project, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Changed stage to ${parsed.data.stage}.`);
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/assessments', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createAssessmentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const assessment = createAssessment(project, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Started “${assessment.name}”.`, { citedNodeIds: [assessment.id] });
    res.status(201).json(assessment);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.patch('/:projectId/assessments/:ddId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const assessment = setAssessmentStatus(project, req.params.ddId, parsed.data.status as never, actorOf(parsed.data));
    await persistPaneWrite(project, `Updated “${assessment.name}” to ${parsed.data.status}.`, { citedNodeIds: [assessment.id] });
    res.json(assessment);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.get('/:projectId/assessments/:ddId/changes', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(changesSincePrevious(project, req.params.ddId));
});

projectsRouter.post('/:projectId/checks/:checkId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = recordCheckBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const check = recordCheckResult(project, req.params.checkId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Recorded “${check.title}” as ${CHECK_RESULT_LABEL[check.result]}.`, {
      citedNodeIds: [check.id],
    });
    res.json({ check, project });
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/evidence', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createEvidenceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const record = addEvidence(project, parsed.data, actorOf(parsed.data));
  await persistPaneWrite(project, `Added evidence “${record.title}”.`, { citedEvidenceIds: [record.id] });
  res.status(201).json(record);
});

projectsRouter.patch('/:projectId/evidence/:evidenceId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchEvidenceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = updateEvidenceStatus(
      project,
      req.params.evidenceId,
      parsed.data.status,
      {
        rejectionReason: parsed.data.rejectionReason,
        considered: parsed.data.considered,
        used: parsed.data.used,
      },
      actorOf(parsed.data),
    );
    await persistPaneWrite(project, `Updated evidence “${record.title}” to ${record.status}.`, {
      citedEvidenceIds: [record.id],
    });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxFileBytes, files: 10 },
});

projectsRouter.post('/:projectId/evidence/:evidenceId/files', evidenceUpload.array('files', 10), async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }
  try {
    const attached = [];
    for (const file of files) {
      const storageKey = documentKey({ id: randomUUID(), fileName: file.originalname });
      await storageAdapter.putDocument(project.id, storageKey, file.buffer, file.mimetype);
      attached.push(
        attachEvidenceFile(
          project,
          req.params.evidenceId,
          {
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
          },
          actorOf(req.body as { actor?: string } | undefined),
        ),
      );
    }
    await persistPaneWrite(project, `Attached ${attached.length} file(s) to evidence.`, {
      citedEvidenceIds: [req.params.evidenceId],
    });
    res.status(201).json(attached);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.get('/:projectId/evidence/:evidenceId/files/:fileId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const evidence = project.evidence.find((e) => e.id === req.params.evidenceId);
  const file = evidence?.attachments.find((a) => a.id === req.params.fileId);
  if (!evidence || !file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const bytes = await storageAdapter.getDocument(project.id, file.storageKey);
  if (!bytes) {
    res.status(404).json({ error: 'File bytes not found' });
    return;
  }
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '').slice(0, 200) || 'document';
  const inline = req.query.inline === '1' || req.query.inline === 'true';
  const type = inline && file.mimeType && file.mimeType !== 'application/octet-stream' ? file.mimeType : 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'private, max-age=900, must-revalidate');
  res.end(bytes);
});

projectsRouter.post('/:projectId/findings', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createFindingBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const record = addFinding(project, parsed.data, actorOf(parsed.data));
  if (parsed.data.linkAssessmentIds?.length) {
    linkFindingAcross(project, record.id, { assessmentIds: parsed.data.linkAssessmentIds }, actorOf(parsed.data));
  }
  await persistPaneWrite(project, `Logged finding “${record.title}”.`, { citedNodeIds: [record.id] });
  res.status(201).json(record);
});

projectsRouter.post('/:projectId/findings/:findingId/links', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = linkFindingBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = linkFindingAcross(project, req.params.findingId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Linked finding “${record.title}” across DDs.`, { citedNodeIds: [record.id] });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.patch('/:projectId/findings/:findingId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = patchRecordStatus(project, project.findings, req.params.findingId, parsed.data.status as never, 'finding', actorOf(parsed.data));
    await persistPaneWrite(project, `Updated finding “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/risks', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createRiskBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const record = addRisk(project, parsed.data, actorOf(parsed.data));
  await persistPaneWrite(project, `Logged risk “${record.title}”.`, { citedNodeIds: [record.id] });
  res.status(201).json(record);
});

projectsRouter.patch('/:projectId/risks/:riskId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = patchRecordStatus(project, project.risks, req.params.riskId, parsed.data.status as never, 'risk', actorOf(parsed.data));
    await persistPaneWrite(project, `Updated risk “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/actions', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createActionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const record = addAction(project, parsed.data, actorOf(parsed.data));
  await persistPaneWrite(project, `Logged action “${record.title}”.`, { citedNodeIds: [record.id] });
  res.status(201).json(record);
});

projectsRouter.patch('/:projectId/actions/:actionId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = patchRecordStatus(project, project.actions, req.params.actionId, parsed.data.status as never, 'action', actorOf(parsed.data));
    await persistPaneWrite(project, `Updated action “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/decisions', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createDecisionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const record = addDecision(project, parsed.data, actorOf(parsed.data));
  await persistPaneWrite(project, `Logged decision “${record.title}”.`, { citedNodeIds: [record.id] });
  res.status(201).json(record);
});

projectsRouter.patch('/:projectId/decisions/:decisionId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = patchRecordStatus(project, project.decisions, req.params.decisionId, parsed.data.status as never, 'decision', actorOf(parsed.data));
    await persistPaneWrite(project, `Updated decision “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.post('/:projectId/reports', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = generateReportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const report = generateReport(
    project,
    { kind: parsed.data.kind, assessmentIds: parsed.data.assessmentIds, generatedBy: parsed.data.generatedBy ?? actorOf(parsed.data) },
    actorOf(parsed.data),
  );
  await persistPaneWrite(project, `Generated “${report.title}”.`, { citedNodeIds: [report.id] });
  res.status(201).json(report);
});
