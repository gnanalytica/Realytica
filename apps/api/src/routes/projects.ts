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
  CAPTURE_PURPOSE_LABEL,
  captureConcerns,
  patchSiteVisit,
  recordPhotoObservation,
  unreadPhotographs,
  readSheetFit,
  sheetPlacements,
  visitCoverage,
  removeSheet,
  setActionCost,
  setValuationValuer,
  valuationRule8,
  setAttachmentCapture,
  setSheetControlPoints,
  type CaptureFacts,
  type CapturePurpose,
  addAsset,
  addDecision,
  addEvidence,
  addFinding,
  addSheet,
  addSiteVisit,
  classifyFinding,
  CAPTURE_PURPOSES,
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
  checkFieldReading,
  findCheck,
  recordCheckFields,
  detachReportBlock,
  editReportBlock,
  insertReportBlock,
  issueReport,
  moveReportBlock,
  reattachReportBlock,
  removeReportBlock,
  reportDrift,
  retuneReportBlock,
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
  validateProjectGraph,
  type ChatIngestFile,
  type DdProject,
  type ProjectChatResult,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type SittingRef,
  type AgentStep,
} from '@realytica/shared';
import {
  agentCapability,
  describeError,
  enrichIngestWithDocumentIntelligence,
  runPhotoIntelligence,
  extractFactsFromProject,
  recallForProject,
  renderMemoryForPrompt,
  resolveRoute,
  runProjectCopilot,
  runProjectOrchestratorAgent,
  textOf,
} from '@realytica/agents';
import { readExifCapture } from '../exif';

/**
 * A hard ceiling on one read request.
 *
 * A site visit produces forty photographs and each read is a vision call, so
 * an unbounded run is a bill nobody agreed to. Twelve is roughly one visit's
 * worth of the shots that matter; a caller with more asks again, which is a
 * decision they take with the first bill in front of them.
 */
const PHOTO_READ_CAP = 12;
import { memoryStore } from '../memory';
import { gatherChatSides } from '../project-chat-sides';
import { ensureIdentitySiteContext } from '../site-context';
import { beginRun, listRuns } from '../runs/journal';
import { startBackgroundRun } from '../runs/background';
import { documentDisposition, resolveServedType } from './document-file';
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
  classifyFindingBodySchema,
  createAssetBodySchema,
  createDecisionBodySchema,
  createEvidenceBodySchema,
  createFindingBodySchema,
  createSheetBodySchema,
  setValuerBodySchema,
  createSiteVisitBodySchema,
  patchSiteVisitBodySchema,
  setActionCostBodySchema,
  setCaptureBodySchema,
  setControlPointsBodySchema,
  createProjectBodySchema,
  createRiskBodySchema,
  editReportBlockBodySchema,
  generateReportBodySchema,
  recordCheckFieldsBodySchema,
  insertReportBlockBodySchema,
  moveReportBlockBodySchema,
  retuneReportBlockBodySchema,
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

projectsRouter.get('/:projectId/runs/:runId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const run = (await listRuns(project.id)).find((row) => row.id === req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  const now = new Date().toISOString();
  res.json({ ...run, state: runState(run, now), line: describeRun(run, now) });
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

/**
 * The STORED graph, which is not the same as the one a rebuild produces.
 *
 * It carries the annotations — which exist nowhere else — and `asOf` answers
 * what the file looked like at an instant, neither of which a projection from
 * the current registers can give you. `/graph` above is the projection and is
 * always current; this is the record.
 */
projectsRouter.get('/:projectId/graph/stored', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
  let stored;
  try {
    stored = await graphAdapter.readProject(project.id, asOf);
  } catch (err) {
    res.status(503).json({ error: `The graph store did not answer: ${(err as Error).message}` });
    return;
  }
  if (!stored) {
    res.status(200).json({ graph: null, reason: 'not_indexed', adapter: graphAdapter.kind });
    return;
  }
  res.json({ graph: stored, adapter: graphAdapter.kind, asOf: asOf ?? null });
});

interface AnnotationBody {
  /** The node this is about. Must already be in the stored graph. */
  nodeId?: unknown;
  text?: unknown;
  author?: unknown;
  /** Optional second node, to draw a link rather than leave a note. */
  linkedNodeId?: unknown;
}

/**
 * An analyst's note on a node, and the one thing in this graph a rebuild
 * cannot reproduce.
 *
 * Everything `buildProjectGraph` emits is derived: delete the store and it
 * comes back. A note does not — somebody looked at a check and wrote down why
 * it matters, and that judgement has no other home. So it is written with
 * `origin: 'authored'`, which is what makes a sync leave it alone, and a
 * failure to write it is a 503 rather than a 500: the note was not saved and
 * the caller still has it, so reporting success would lose the only copy.
 */
projectsRouter.post('/:projectId/graph/annotations', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const body = req.body as AnnotationBody;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const author = typeof body.author === 'string' ? body.author.trim() : '';
  const linkedNodeId = typeof body.linkedNodeId === 'string' ? body.linkedNodeId.trim() : '';
  if (!nodeId || !text) {
    res.status(400).json({ error: 'nodeId and text are both required.' });
    return;
  }

  let stored;
  try {
    stored = await graphAdapter.readProject(project.id);
  } catch (err) {
    res.status(503).json({ error: `The graph store did not answer: ${(err as Error).message}` });
    return;
  }
  // Checked against the STORED graph rather than a fresh projection, because
  // an annotation may legitimately hang off another annotation and those are
  // not in a projection. A note on a node that does not exist is the same
  // fabricated connection the projection refuses.
  const present = new Map((stored?.nodes ?? []).map((n) => [n.id, n]));
  if (!present.has(nodeId)) {
    res.status(400).json({ error: `No node "${nodeId}" in this file's graph.` });
    return;
  }
  if (linkedNodeId && !present.has(linkedNodeId)) {
    res.status(400).json({ error: `No node "${linkedNodeId}" in this file's graph.` });
    return;
  }

  const id = `ryt-note-${randomUUID()}`;
  const at = new Date().toISOString();
  const node: ProjectGraphNode = {
    id,
    kind: 'thought',
    layer: 'deliberation',
    // The whole point. This is the one thing in the graph a rebuild cannot
    // produce, so a sync must never touch it.
    origin: 'authored',
    label: text.slice(0, 120),
    detail: [author || null, at.slice(0, 10)].filter(Boolean).join(' · '),
  };
  const edges: ProjectGraphEdge[] = [
    { id: `${id}:cites:${nodeId}`, rel: 'cites', from: id, to: nodeId },
    ...(linkedNodeId ? [{ id: `${id}:cites:${linkedNodeId}`, rel: 'cites' as const, from: id, to: linkedNodeId }] : []),
  ];

  // The ontology is a real gate here, not a test assertion. A person drawing a
  // link by hand is exactly the case a closed vocabulary exists to constrain,
  // and the endpoint rules are what stop a note being stored as something a
  // finding could later be walked out of.
  const problems = validateProjectGraph({
    nodes: [...(stored?.nodes ?? []), node],
    edges,
  });
  if (problems.length > 0) {
    res.status(400).json({ error: problems.map((p) => p.reason).join('; ') });
    return;
  }

  try {
    await graphAdapter.appendProject(project.id, [node], edges);
  } catch (err) {
    res.status(503).json({ error: `The graph store did not accept the note: ${(err as Error).message}` });
    return;
  }
  res.status(201).json({ node, edges });
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

  /*
   * `?background=1` starts the work and returns the run id immediately. The
   * screen geocodes, screens and writes six registers; on a slow site-context
   * lookup that is long enough to be worth walking away from.
   */
  if (req.query.background === '1' || req.query.background === 'true') {
    const started = await startBackgroundRun(project.id, 'screen', { actor }, async (journal) => {
      const site = await ensureIdentitySiteContext(project, projectToIdentity(project), now);
      await journal.step('site_context', site ? 'Site context resolved.' : 'No mapping provider; screening without a pin.');
      const applied = screenProject(project, actor, now, site);
      await persistPaneWrite(project, 'Ran the project screen.');
      return `Verdict ${applied.snapshot.verdict}.`;
    });
    res.status(202).json({ ...started, pollUrl: `/api/projects/${project.id}/runs/${started.runId}` });
    return;
  }

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

projectsRouter.patch('/:projectId/valuation/:runId/valuer', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = setValuerBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const run = setValuationValuer(project, req.params.runId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Recorded the valuer on this valuation.`, { citedNodeIds: [run.id] });
    res.json({ run, rule8: valuationRule8(run) });
  } catch (err) {
    fail(res, err);
  }
});

/** Which of the twelve Rule 8(3) items this run answers, computed fresh. */
projectsRouter.get('/:projectId/valuation/:runId/rule8', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const run = project.valuationRuns.find((r) => r.id === req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Valuation run not found' });
    return;
  }
  res.json(valuationRule8(run));
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
  const actor = actorOf(parsed.data);

  /*
   * Background mode. The model pass is the slow half — a planner call with
   * tools — and it produces cards a person reviews later anyway, so there is
   * nothing to watch while it runs.
   */
  if (req.query.background === '1' || req.query.background === 'true') {
    const started = await startBackgroundRun(project.id, 'orchestrate', { actor }, async (journal) => {
      const bgRun = runProjectOrchestrator(project, actor);
      await journal.step('rule_pass', `Rule pass proposed ${bgRun.draftIds.length} draft(s).`);
      if (agentCapability().available) {
        try {
          const extra = await runProjectOrchestratorAgent(project, actor, bgRun);
          if (extra.usedModel) {
            bgRun.source = 'model';
            bgRun.summary = extra.summary;
            const open = new Set(project.chatProposals.filter((p) => p.status === 'proposed').map((p) => p.title));
            for (const card of extra.proposals) {
              if (open.has(card.title)) continue;
              project.chatProposals.push(card);
              open.add(card.title);
            }
            await journal.step('model_pass', `Model pass queued ${extra.proposals.length} card(s).`);
          }
        } catch (err) {
          await journal.step('model_pass_failed', err instanceof Error ? err.message : String(err));
        }
      }
      await persistPaneWrite(project, `Orchestrator pass proposed ${bgRun.draftIds.length} draft(s).`);
      return `${bgRun.source === 'model' ? 'Rule + model pass' : 'Rule pass'}; ${bgRun.draftIds.length} draft(s).`;
    });
    res.status(202).json({ ...started, pollUrl: `/api/projects/${project.id}/runs/${started.runId}` });
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
  const [removed] = projects().splice(idx, 1);
  await store.save();
  // The project's own documents — its shard, its run journal, its evidence
  // files — go with it. "Deleted" has to mean deleted: these hold owner
  // names, document titles and uploaded bytes.
  if (removed) {
    try {
      await storageAdapter.deleteCaseDocuments(removed.id);
    } catch (err) {
      console.warn(`[projects] could not remove documents for ${removed.id}: ${(err as Error).message}`);
    }
  }
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

/** What this check records, what it holds, and what those numbers say. */
projectsRouter.get('/:projectId/checks/:checkId/fields', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    const { check } = findCheck(project, req.params.checkId);
    res.json({ checkId: check.id, title: check.title, ...checkFieldReading(check) });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Write values onto a check.
 *
 * All or nothing: a rejected value takes the whole write with it, and the
 * reasons come back per field so the caller can fix them rather than guess.
 * Writing values never records a result — what the numbers mean is arithmetic,
 * whether the check passes is somebody's judgement.
 */
projectsRouter.put('/:projectId/checks/:checkId/fields', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = recordCheckFieldsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const outcome = recordCheckFields(
      project,
      req.params.checkId,
      parsed.data.values,
      actorOf(parsed.data),
      parsed.data.sourceEvidenceId,
    );
    if (outcome.rejected.length) {
      res.status(400).json({ error: outcome.rejected.map((r) => r.error).join(' '), rejected: outcome.rejected });
      return;
    }
    await persistPaneWrite(project, `Recorded ${Object.keys(parsed.data.values).length} value(s) on “${outcome.check.title}”.`, {
      citedNodeIds: [outcome.check.id],
    });
    res.json({ checkId: outcome.check.id, ...outcome.reading, project });
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
  /*
   * Capture mapping, sent as plain multipart fields beside the files.
   *
   * Applied to IMAGES only. A deed dropped into the same batch does not
   * inherit "north boundary, valuation inspection" just because the uploader
   * was standing somewhere when they picked the files — a scanned conveyance
   * has no capture facts, and giving it some would turn the moment somebody
   * dragged a file into the browser into a statement about the property.
   *
   * An unknown purpose or a visit that is not on this file is a 400 rather
   * than a silent drop: the person typed a mapping, and losing it quietly is
   * how the mapping stops happening.
   */
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawPurpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  if (rawPurpose && !(CAPTURE_PURPOSES as readonly string[]).includes(rawPurpose)) {
    res.status(400).json({ error: `Unknown capture purpose "${rawPurpose}"` });
    return;
  }
  const visitId = typeof body.visitId === 'string' && body.visitId.trim() ? body.visitId.trim() : undefined;
  if (visitId && !(project.siteVisits ?? []).some((v) => v.id === visitId)) {
    res.status(400).json({ error: 'Site visit not found on this project' });
    return;
  }
  const assetId = typeof body.assetId === 'string' && body.assetId.trim() ? body.assetId.trim() : undefined;
  if (assetId && !project.assets.some((a) => a.id === assetId)) {
    res.status(400).json({ error: 'Asset not found on this project' });
    return;
  }
  const zone = typeof body.zone === 'string' ? body.zone.trim().slice(0, 120) : '';

  try {
    const attached = [];
    for (const file of files) {
      const storageKey = documentKey({ id: randomUUID(), fileName: file.originalname });
      const isImage = file.mimetype.startsWith('image/');
      // The phone already stamped where and when the shot was taken. Asking
      // somebody to retype what the file carries is how it stops being
      // recorded at all — and the source is kept so a coordinate read off the
      // file never reads like one a person vouched for.
      const exif = isImage ? readExifCapture(file.buffer) : {};
      const capture: CaptureFacts = isImage
        ? {
            ...(rawPurpose ? { purpose: rawPurpose as CapturePurpose } : {}),
            ...(visitId ? { visitId } : {}),
            ...(assetId ? { assetId } : {}),
            ...(zone ? { zone } : {}),
            ...(exif.takenAt ? { takenAt: exif.takenAt, takenAtSource: 'exif' as const } : {}),
            ...(exif.lat !== undefined && exif.lng !== undefined
              ? { lat: exif.lat, lng: exif.lng, latLngSource: 'exif' as const }
              : {}),
          }
        : {};
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
            capture,
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
  /*
   * The type is decided by the BYTES, never by `file.mimeType`.
   *
   * That field is whatever the client announced at upload — multer copies the
   * part header verbatim — so it is attacker-controlled and independent of
   * what was actually stored. This route used to echo it back and serve the
   * result `inline`, which is stored XSS: upload HTML announced as text/html,
   * send someone the `?inline=1` link, and it executes on this origin with
   * access to every project the API will answer for. `nosniff` does not help
   * when the declared type IS text/html.
   *
   * `document-file.ts` has held the correct rule and the signature sniffer
   * since before this route existed; it was reachable only from the retired
   * case path, so the defence sat on dead code while the live path shipped
   * the bug. Now they share one implementation, and only a type this app can
   * actually render is ever inlined.
   */
  const wantsInline = req.query.inline === '1' || req.query.inline === 'true';
  const { contentType, inline } = resolveServedType(bytes, file.fileName, !wantsInline);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', documentDisposition(inline, file.fileName));
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

projectsRouter.patch('/:projectId/findings/:findingId/classification', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = classifyFindingBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = classifyFinding(project, req.params.findingId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Classified finding “${record.title}”.`, { citedNodeIds: [record.id] });
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

projectsRouter.patch('/:projectId/actions/:actionId/cost', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = setActionCostBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = setActionCost(project, req.params.actionId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Priced action “${record.title}”.`, { citedNodeIds: [record.id] });
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

/* ==================================================================== */
/* Site visits, capture and sheets                                       */
/* ==================================================================== */

projectsRouter.post('/:projectId/visits', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createSiteVisitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = addSiteVisit(project, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Recorded site visit “${record.title}”.`, { citedNodeIds: [record.id] });
    res.status(201).json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.patch('/:projectId/visits/:visitId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = patchSiteVisitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = patchSiteVisit(project, req.params.visitId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Updated site visit “${record.title}”.`, { citedNodeIds: [record.id] });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.get('/:projectId/visits', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ visits: project.siteVisits ?? [], coverage: visitCoverage(project), concerns: captureConcerns(project) });
});

projectsRouter.patch('/:projectId/evidence/:evidenceId/files/:fileId/capture', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = setCaptureBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const attachment = setAttachmentCapture(project, req.params.evidenceId, req.params.fileId, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Described capture of “${attachment.fileName}”.`, { citedEvidenceIds: [req.params.evidenceId] });
    res.json(attachment);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Read the photographs on this file.
 *
 * One at a time when a `fileId` is given, otherwise every image no model has
 * looked at yet. Bounded concurrency and a hard cap, because a site visit
 * produces forty photographs and an unbounded fan-out over forty vision calls
 * is a bill nobody agreed to.
 *
 * A photographed DOCUMENT is handed straight to the extraction path rather
 * than described: a khata extract shot on a phone is worth the survey number
 * on it, not a sentence about a printed page. The photo agent's contribution
 * on that branch is the routing decision, which is exactly what it is for.
 */
projectsRouter.post('/:projectId/photographs/read', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const body = (req.body ?? {}) as { fileId?: string; evidenceId?: string; limit?: number; actor?: string };
  const actor = actorOf(body);

  const targets = body.fileId && body.evidenceId
    ? project.evidence
        .filter((e) => e.id === body.evidenceId)
        .flatMap((e) => e.attachments.filter((a) => a.id === body.fileId).map((a) => ({ evidenceId: e.id, attachment: a })))
    : unreadPhotographs(project).slice(0, Math.max(1, Math.min(PHOTO_READ_CAP, body.limit ?? PHOTO_READ_CAP)));

  if (!targets.length) {
    res.json({ read: 0, drafts: 0, documents: 0, note: 'No unread photograph on this file.' });
    return;
  }

  const identity = projectToIdentity(project);
  let drafts = 0;
  let documents = 0;
  const results: Array<{ fileName: string; subject: string; notes: number; error?: string }> = [];

  for (const target of targets) {
    const bytes = await storageAdapter.getDocument(project.id, target.attachment.storageKey);
    const capture = target.attachment.capture;
    const outcome = await runPhotoIntelligence({
      projectId: project.id,
      evidenceId: target.evidenceId,
      attachmentId: target.attachment.id,
      fileName: target.attachment.fileName,
      mimeType: target.attachment.mimeType,
      fileBytes: bytes ? Buffer.from(bytes) : null,
      identity,
      purposeLabel: capture?.purpose ? CAPTURE_PURPOSE_LABEL[capture.purpose] : undefined,
      zone: capture?.zone,
      takenAt: capture?.takenAt,
    });

    // Filed whatever the outcome. An empty observation carrying "we could not
    // read this one, here is why" is a materially different thing on a
    // diligence file from a photograph nobody has looked at yet, and a batch
    // that silently left twenty blank would erase that difference.
    const { drafts: made } = recordPhotoObservation(project, target.evidenceId, target.attachment.id, outcome.observation, actor);
    drafts += made.length;

    if (outcome.isDocument && bytes) {
      documents += 1;
      // The same bytes, through the agent that reads documents properly. Its
      // notes land on the evidence row, where an extraction's output belongs.
      const enriched = await enrichIngestWithDocumentIntelligence({
        project,
        files: [
          {
            fileName: target.attachment.fileName,
            mimeType: target.attachment.mimeType,
            sizeBytes: target.attachment.sizeBytes,
            storageKey: target.attachment.storageKey,
          },
        ],
        buffers: [Buffer.from(bytes)],
      });
      const row = project.evidence.find((e) => e.id === target.evidenceId);
      if (row && enriched[0]?.extractionNotes) row.extractionNotes = enriched[0].extractionNotes;
      if (row && enriched[0]?.quotes?.length) row.quotes = enriched[0].quotes;
    }

    results.push({
      fileName: target.attachment.fileName,
      subject: outcome.observation.subject,
      notes: outcome.observation.notes.length,
      ...(outcome.run.error ? { error: outcome.run.error } : {}),
    });
  }

  await persistPaneWrite(project, `Read ${targets.length} photograph(s) — ${drafts} proposed finding(s).`, {
    citedEvidenceIds: [...new Set(targets.map((t) => t.evidenceId))],
  });
  res.json({ read: targets.length, drafts, documents, results });
});

projectsRouter.get('/:projectId/sheets', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // The fit is worked out here rather than stored, so a sheet can never carry
  // a placement from control points that were since moved.
  res.json({ sheets: sheetPlacements(project) });
});

projectsRouter.post('/:projectId/sheets', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = createSheetBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = addSheet(project, parsed.data, actorOf(parsed.data));
    await persistPaneWrite(project, `Added sheet “${record.title}”.`, { citedEvidenceIds: [record.evidenceId] });
    res.status(201).json(record);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.put('/:projectId/sheets/:sheetId/control-points', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = setControlPointsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const sheet = setSheetControlPoints(project, req.params.sheetId, parsed.data.points, actorOf(parsed.data));
    const reading = readSheetFit(sheet.controlPoints);
    await persistPaneWrite(project, `Placed sheet “${sheet.title}” — ${reading.say}`, { citedNodeIds: [sheet.id] });
    res.json({ sheet, reading });
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.delete('/:projectId/sheets/:sheetId', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    removeSheet(project, req.params.sheetId, actorOf(req.body as { actor?: string } | undefined));
    await store.save();
    res.status(204).end();
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

/* ==================================================================== */
/* Editing a report                                                      */
/* ==================================================================== */

/**
 * One handler for every block operation.
 *
 * The operations themselves refuse what must be refused — writing into a
 * bound block, editing an issued report — by throwing with the reason a
 * person needs to read. Catching here and returning that reason as a 400
 * keeps the rule in one place: the route never re-implements a judgement the
 * operating model has already made.
 */
async function reportEdit(
  req: Parameters<Parameters<typeof projectsRouter.post>[1]>[0],
  res: Parameters<Parameters<typeof projectsRouter.post>[1]>[1],
  work: (project: DdProject, actor: string) => { note: string; cited?: string[]; body?: unknown },
): Promise<void> {
  const project = findProject(req.params.projectId as string);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const actor = actorOf((req.body ?? {}) as { actor?: string });
  let outcome: { note: string; cited?: string[]; body?: unknown };
  try {
    outcome = work(project, actor);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'That change could not be made.' });
    return;
  }
  await persistPaneWrite(project, outcome.note, { citedNodeIds: outcome.cited });
  res.json(outcome.body ?? project.reports.find((r) => r.id === req.params.reportId));
}

projectsRouter.post('/:projectId/reports/:reportId/blocks', async (req, res) => {
  const parsed = insertReportBlockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  await reportEdit(req, res, (project, actor) => {
    const block = insertReportBlock(project, req.params.reportId, parsed.data, actor);
    return { note: parsed.data.source ? 'Added a live section to the report.' : 'Added a section to the report.', cited: [block.id] };
  });
});

projectsRouter.patch('/:projectId/reports/:reportId/blocks/:blockId', async (req, res) => {
  const parsed = editReportBlockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  await reportEdit(req, res, (project, actor) => {
    editReportBlock(project, req.params.reportId, req.params.blockId, parsed.data, actor);
    return { note: 'Edited the report.', cited: [req.params.blockId] };
  });
});

projectsRouter.put('/:projectId/reports/:reportId/blocks/:blockId/source', async (req, res) => {
  const parsed = retuneReportBlockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  await reportEdit(req, res, (project, actor) => {
    retuneReportBlock(project, req.params.reportId, req.params.blockId, parsed.data.source, actor);
    return { note: 'Changed what that section reads.', cited: [req.params.blockId] };
  });
});

projectsRouter.post('/:projectId/reports/:reportId/blocks/:blockId/detach', async (req, res) => {
  await reportEdit(req, res, (project, actor) => {
    const block = detachReportBlock(project, req.params.reportId, req.params.blockId, actor);
    return { note: `“${block.heading ?? 'A section'}” is no longer reading the registers.`, cited: [block.id] };
  });
});

projectsRouter.post('/:projectId/reports/:reportId/blocks/:blockId/reattach', async (req, res) => {
  await reportEdit(req, res, (project, actor) => {
    reattachReportBlock(project, req.params.reportId, req.params.blockId, actor);
    return { note: 'That section reads the registers again.', cited: [req.params.blockId] };
  });
});

projectsRouter.post('/:projectId/reports/:reportId/blocks/:blockId/move', async (req, res) => {
  const parsed = moveReportBlockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  await reportEdit(req, res, (project, actor) => {
    moveReportBlock(project, req.params.reportId, req.params.blockId, parsed.data.toIndex, actor);
    return { note: 'Moved a section.', cited: [req.params.blockId] };
  });
});

projectsRouter.delete('/:projectId/reports/:reportId/blocks/:blockId', async (req, res) => {
  await reportEdit(req, res, (project, actor) => {
    removeReportBlock(project, req.params.reportId, req.params.blockId, actor);
    return { note: 'Removed a section from the report. Nothing in the registers changed.' };
  });
});

/**
 * Issue the report, which is the moment it stops moving.
 *
 * Irreversible on purpose: the alternative is an issued document that quietly
 * keeps updating after somebody has relied on it, and that failure is silent
 * where this one is merely inconvenient. A later version is a new report.
 */
projectsRouter.post('/:projectId/reports/:reportId/issue', async (req, res) => {
  await reportEdit(req, res, (project, actor) => {
    const report = issueReport(project, req.params.reportId, actor);
    return { note: `Issued “${report.title}”. It is frozen at what it said just now.`, cited: [report.id], body: report };
  });
});

/** What the registers have done since this report was issued. */
projectsRouter.get('/:projectId/reports/:reportId/drift', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  const report = project.reports.find((r) => r.id === req.params.reportId);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json({ reportId: report.id, status: report.status, rows: reportDrift(project, report.body.blocks) });
});
