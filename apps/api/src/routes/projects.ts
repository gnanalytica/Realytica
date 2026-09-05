import { Router, type Request } from 'express';
import { needs, principalOf } from '../auth/middleware';
import { fireAndForget } from '../flows/triggers';
import {
  gateWrites,
  redactResponses,
  requireArea,
  withinReach,
  workspaceOnly,
  workspaceWrites,
} from '../auth/project-guard';
import {
  WriteRefused,
  accessTo,
  mergeConversation,
  stampActor,
  assertMayWrite,
  assertWorkspaceWork,
  liveGrant,
  projectFor,
  viewFor,
} from '../auth/access';
import { actorOf as principalActor, reachesEveryProject } from '@realytica/shared';
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
  assignOwner,
  applyProjectAgentTurn,
  clearProjectConversation,
  extractReadableExcerpt,
  projectRegisterBriefing,
  projectToIdentity,
  renderProjectGuide,
  screenProject,
  wantsDeterministicProjectChat,
  plural,
  linkRecordIds,
  unansweredReason,
  failureCause,
  noteProjectEdit,
  CHECK_RESULT_LABEL,
  clampGraphHops,
  projectGraphOf,
  retrieveProjectNeighbourhood,
  traceProjectNode,
  validateProjectGraph,
  withheldAnswer,
  withheldBriefing,
  type ChatIngestFile,
  type DdProject,
  type ProjectChatResult,
  type ProjectChatTurn,
  type ProjectView,
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
import { forgetProjects, memoryReadableBy, memoryStore } from '../memory';
import { gatherChatSides } from '../project-chat-sides';
import { ensureIdentitySiteContext } from '../site-context';
import { beginRun, listRuns } from '../runs/journal';
import { startBackgroundRun } from '../runs/background';
import { documentDisposition, resolveServedType } from './document-file';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { UPLOAD_LIMITS } from '../uploads';
import { projectSiteContextRouter } from './site-context';
import { projectPeopleRouter } from './project-people';
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
  bulkEvidenceStatusBodySchema,
  patchEvidenceBodySchema,
  patchProjectBodySchema,
  assignBodySchema,
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

/**
 * Everything this workspace can see.
 *
 * A project written before tenancy has no `tenantId`; it belongs to whichever
 * workspace was bootstrapped first, which on an existing install is the only
 * one there is. Adoption happens on first read rather than in a migration
 * script so a store restored from a backup is repaired the same way.
 */
function visible(tenantId: string): DdProject[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  return projects().filter((p) => (p.tenantId ?? bootstrap) === tenantId);
}

export function findProject(id: string): DdProject | undefined {
  return projects().find((p) => p.id === id);
}

/**
 * Who is doing this, for the audit trail.
 *
 * Reads the verified principal, never the request body. The old version took
 * `body.actor` on trust, which meant the trail recorded whatever the client
 * typed — so it could be anybody, and on a shared deployment it would have
 * been. There is no way to pass an actor in any more, and that is the point.
 */
function actorOf(req: Request): string {
  return principalActor(principalOf(req));
}

function fail(res: { status: (n: number) => { json: (b: unknown) => void } }, err: unknown, fallback = 'Request failed') {
  if (err instanceof WriteRefused) {
    res.status(err.status).json({ error: err.message });
    return;
  }
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

/**
 * Reading is any member's business; changing something is not.
 *
 * Gated by method on the router rather than per handler, because the
 * alternative is fifty-eight separate decisions and the one somebody forgets
 * is a route that silently lets a viewer write.
 */
projectsRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  needs('write')(req, res, next);
});

/**
 * The tenancy gate.
 *
 * Express runs this for every route on this router that names `:projectId`,
 * before the handler — so a route added later is scoped by construction
 * rather than by whoever writes it remembering to check. That is the whole
 * reason it is here and not repeated in forty handlers.
 *
 * A project in another workspace is a 404, not a 403. A 403 would confirm the
 * project exists, which is exactly the fact a stranger is probing for.
 */
projectsRouter.param('projectId', (req, res, next, projectId: string) => {
  const project = findProject(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // Adopt a project written before tenancy into the workspace now reading it.
  const bootstrap = store.data.tenants?.[0]?.id;
  if (!project.tenantId && bootstrap) project.tenantId = bootstrap;

  // Wrong workspace, or a collaborator who was never put on this project —
  // both are 404. Either way there is nothing here for them, and saying which
  // it is would answer the question they were asking.
  if (!accessTo(req, project).ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  next();
});
/*
 * What a collaborator may reach on a project they are on.
 *
 * Mounted by path rather than checked per handler, because a check per handler
 * is a decision per handler and the one somebody forgets is a leak. Order
 * matters: these run before the routes below them.
 *
 * `redactResponses` covers the common shape — a project, or a record beside
 * one. The area gates below cover the routes that answer with an area
 * directly, where there is no project in the body to redact.
 */
projectsRouter.use('/:projectId', redactResponses);
projectsRouter.use('/:projectId', gateWrites);

projectsRouter.use('/:projectId/valuation', requireArea('valuation'));
projectsRouter.use('/:projectId/screen', requireArea('valuation'));
projectsRouter.use('/:projectId/reports', requireArea('reports'));
projectsRouter.use('/:projectId/decisions', requireArea('decisions'));
projectsRouter.use('/:projectId/visits', requireArea('site_record'));
projectsRouter.use('/:projectId/sheets', requireArea('site_record'));

// The workspace thinking aloud about the whole file. No area ticks these on.
projectsRouter.use('/:projectId/ai', workspaceOnly);
projectsRouter.use('/:projectId/orchestrate', workspaceOnly);
projectsRouter.use('/:projectId/capabilities', workspaceOnly);
projectsRouter.use('/:projectId/runs', workspaceOnly);
projectsRouter.use('/:projectId/graph/stored', workspaceOnly);

// Readable by anybody on the project, changeable only by the workspace: the
// shape of the file rather than the work inside it.
projectsRouter.use('/:projectId/assets', workspaceWrites);
projectsRouter.use('/:projectId/stage', workspaceWrites);
projectsRouter.use('/:projectId/assessments', workspaceWrites);
projectsRouter.use('/:projectId/graph', workspaceWrites);

// Staffing the site. Who else is on a file, and on how much of it, is the
// workspace's business — a contractor does not get the roster.
projectsRouter.use('/:projectId/people', workspaceOnly, projectPeopleRouter);

projectsRouter.use('/:projectId/site-context', projectSiteContextRouter);
projectsRouter.use('/:projectId/gis-overlay', projectGisOverlayRouter);

projectsRouter.get('/', (req, res) => {
  const me = principalOf(req);
  // A collaborator's list is the projects they hold a live grant on, and the
  // summary is built from what they may see — otherwise a finding count would
  // report work they cannot open.
  const rows = reachesEveryProject(me.role)
    ? visible(me.tenantId).map(toProjectSummary)
    : visible(me.tenantId)
        .filter((p) => liveGrant(me.tenantId, p.id, me.email))
        .map((p) => toProjectSummary(projectFor(req, p)));
  res.json(rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

projectsRouter.post('/', async (req, res) => {
  const parsed = createProjectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const me = principalOf(req);
  const project = createProject(parsed.data, store.nextProjectReference(), actorOf(req));
  project.tenantId = me.tenantId;
  projects().push(project);
  await rememberProject(project);
  await store.save();
  // After the save, so a flow that reads the project finds it on the file.
  // Fired and forgotten: a drawn automation must never be able to fail the
  // creation of a real project.
  fireAndForget('project_created', { tenantId: me.tenantId, project, actor: actorOf(req) });
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
  try {
    // The one write on a bare `/:projectId`, so it cannot be mounted by path.
    assertWorkspaceWork(req, project, 'The details of the project');
  } catch (err) {
    fail(res, err);
    return;
  }
  patchProject(project, parsed.data, actorOf(req));
  await persistPaneWrite(req, project, 'Updated project details.', { citedNodeIds: [project.id] });
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
  // Built from the projection, not the file. The graph answers with nodes and
  // edges rather than a project, so the response redactor never sees it — and
  // a picture of the whole file is a better disclosure of it than the
  // registers are, because it shows what connects to what.
  const built = buildProjectGraph(projectFor(req, project));
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
  const seen = projectFor(req, project);
  const query = typeof req.query.query === 'string' ? req.query.query : typeof req.query.q === 'string' ? req.query.q : '';
  const hops = clampGraphHops(Number(req.query.hops) || 2);
  const live = retrieveProjectNeighbourhood(seen, query, hops);
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
      // The stored graph is the whole file's, including nodes for work this
      // reader cannot open. A k-hop walk is exactly how somebody would find
      // those, so it is cut back to what the projection contains — and the
      // live graph above is the floor, so a narrowed reader still gets an
      // answer rather than an empty one.
      const reachable = withinReach(req, project, stored);
      // The live graph, built from the projection, is the floor: a narrowed
      // reader whose stored neighbourhood was entirely withheld still gets the
      // answer their own scope supports rather than an empty one.
      if (reachable.nodes.length > 0) {
        graph = reachable;
        source = graphAdapter.kind;
      }
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
  const cone = traceProjectNode(projectGraphOf(projectFor(req, project)), req.params.nodeId);
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
  const actor = actorOf(req);
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
      await persistPaneWrite(req, project, 'Ran the project screen.');
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
    await persistPaneWrite(req, project, 'Ran the project screen.');
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
  const actor = actorOf(req);
  const run = createValuationRun(project, actor);
  await persistPaneWrite(req, project, 'Created a valuation run.');
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
    const run = setValuationSignOff(project, req.params.runId, parsed.data.signOff, actorOf(req));
    await persistPaneWrite(req, project, `Updated valuation sign-off to ${parsed.data.signOff}.`);
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
    const run = setValuationValuer(project, req.params.runId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Recorded the valuer on this valuation.`, { citedNodeIds: [run.id] });
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
  const runs = snapshotCapabilities(project, actorOf(req));
  await persistPaneWrite(req, project, 'Snapshot capabilities.');
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
  const drafts = proposeAiDrafts(project, actorOf(req), 'rule');
  await persistPaneWrite(req, project, `Proposed ${drafts.length} AI draft(s).`);
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
    const draft = reviewAiDraft(project, req.params.draftId, parsed.data.status, parsed.data.reviewNote, actorOf(req));
    await persistPaneWrite(req, project, `Reviewed draft “${draft.title}” (${parsed.data.status}).`);
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
  req: Request,
  project: DdProject,
  summary: string,
  extra?: { citedNodeIds?: string[]; citedEvidenceIds?: string[] },
): Promise<void> {
  const before = project.conversation.length;
  noteProjectEdit(project, summary, extra);
  // Every pane write leaves a turn in the thread. Naming its author here, in
  // the one place they are all written, is what lets a collaborator read back
  // their own work without reading the developer's.
  stampActor(project, before, actorOf(req));
  await rememberProject(project);
  await store.save();
}

/**
 * Say "you do not have access to that" rather than letting an empty register
 * read as a fact.
 *
 * Applied after the answer is composed, whichever path composed it, because
 * the failure it closes is not a leak — it is the opposite. A collaborator
 * asking what the site is worth, and being told there is no valuation on the
 * file when there is one, has been lied to by a system that thought it was
 * protecting something.
 */
function sayWhatIsMissing(seen: ProjectView, question: string, result: { assistantTurn: ProjectChatTurn }): void {
  const note = withheldAnswer(seen, question);
  if (!note) return;
  const text = result.assistantTurn.text.trim();
  result.assistantTurn.text = text ? `${note}\n\n${text}` : note;
}

/**
 * Mark the turns this request wrote as belonging to one sitting.
 *
 * `applyProjectChat` returns the very objects it pushed onto the thread, so
 * stamping the result stamps what is stored. A client that does not send a
 * session id leaves them unstamped, and `chatSessions` groups those by the
 * silences between them instead — nothing breaks, the grouping is just
 * coarser.
 */
function stampSession(result: { userTurn: ProjectChatTurn; assistantTurn: ProjectChatTurn }, sessionId?: string): void {
  if (!sessionId) return;
  result.userTurn.sessionId = sessionId;
  result.assistantTurn.sessionId = sessionId;
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
  const actor = actorOf(req);
  const sitting = parsed.data.sitting;
  /*
   * Everything below reads `canvas`, never `project`.
   *
   * For staff the two are the same object. For a collaborator the canvas is
   * their projection, and that is the whole safety argument for the chat: a
   * model told to withhold the valuation mentions it, and nobody finds out
   * which conversation leaked. A model handed a file with no valuation on it
   * cannot cite one however it is prompted.
   *
   * `turnsBefore` is where the thread stood, so the turns this request writes
   * can be carried back and given an author at the end.
   */
  const seen = viewFor(req, project);
  const canvas = seen.project;
  const turnsBefore = project.conversation.length;
  const unseen = withheldBriefing(seen);
  const capability = agentCapability();
  const deterministic = wantsDeterministicProjectChat(canvas, question, { sitting });
  const stream = beginNdjson(res);
  const { line, clientGone } = stream;

  /*
   * Why the question below went unanswered, when it did.
   *
   * Falling through to the standing briefing keeps chat working when the model
   * cannot be reached, and that is right. Doing it in silence is not: the
   * briefing renders in the same voice and the same place as an answer, so a
   * person who asked what a buyer would pay reads an unrelated open finding
   * and concludes the product ignored them. The run ledger already records the
   * failure; this is the half they can see.
   *
   * Only a question that WANTED the copilot can be unanswered — a command the
   * router handled itself was answered, by design.
   */
  let unanswered: string | undefined;
  if (!deterministic && !capability.available) {
    unanswered = unansweredReason(failureCause(capability.reason));
  }

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
        const recall = await recallForProject(memoryStore, canvas, {
          now: new Date().toISOString(),
          tenants: memoryReadableBy(project.tenantId),
        });
        memoryText = renderMemoryForPrompt(recall);
      } catch {
        memoryText = '';
      }
      const agent = await runProjectCopilot({
        project: canvas,
        question,
        actor,
        viewContext: parsed.data.viewContext,
        history: canvas.conversation,
        memory: [unseen, memoryText].filter(Boolean).join('\n\n') || undefined,
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
        /*
         * Ids out of the prose before anything else sees the answer.
         *
         * The prompt asks for titles rather than ids and a prompt is a
         * request, so answers arrive carrying forty-six characters of primary
         * key mid-sentence. Rewritten here rather than at render because the
         * transcript is stored, quoted and exported, and a fix applied at one
         * of those surfaces is a fix missing from the others.
         */
        agent.text = linkRecordIds(canvas, agent.text);
        const result = applyProjectAgentTurn(canvas, question, agent);
        sayWhatIsMissing(seen, question, result);
        stampSession(result, parsed.data.sessionId);
        mergeConversation(project, canvas, actor, turnsBefore);
        await store.save();
        journalTail = journalTail.then(() =>
          journal.finish(
            result.assistantTurn.unsupportedClaims?.length
              ? `Answered; ${result.assistantTurn.unsupportedClaims.length} unsupported figure(s) flagged.`
              : `Answered with ${agent.toolCalls.length} tool call(s).`,
          ),
        );
        await journalTail;
        line({ type: 'result', ...result, project: canvas });
        res.end();
        return;
      }
      unanswered = unansweredReason('malformed');
      journalTail = journalTail.then(() => journal.fail('The copilot returned nothing usable; the wizard answered instead.'));
      await journalTail;
    } catch (e) {
      const described = describeError(e);
      unanswered = unansweredReason(failureCause(described));
      line({ type: 'step', step: { id: randomUUID(), at: new Date().toISOString(), kind: 'error', label: described } });
      journalTail = journalTail.then(() => journal.fail(described));
      await journalTail;
      /* fall through to the wizard — a model failure must not block chat */
    }
  }

  let sides: Awaited<ReturnType<typeof gatherChatSides>>;
  try {
    sides = await gatherChatSides(canvas, question);
  } catch {
    sides = undefined;
  }
  const result = applyProjectChat(canvas, question, {
    actor,
    viewContext: parsed.data.viewContext,
    sides,
    sitting,
  });

  if (capability.available && !skipLlmForChat(result)) {
    try {
      const { provider, route } = resolveRoute('analyst_copilot');
      const guide = renderProjectGuide(canvas);
      const llm = await provider.complete({
        agent: 'analyst_copilot',
        model: route.model,
        maxTokens: 1800,
        system: [
          {
            text:
              'You are the project DD copilot. Answer only from the register briefing and today\'s next step. Name one move. If they do not support an answer, say so. Do not invent findings, values, evidence, or sign-off. Do not list the evidence library. Do not file documents or start DDs — those are person-approved cards. Keep under 280 words. Cite titles, not truncated ids.',
          },
          ...(unseen ? [{ text: unseen }] : []),
        ],
        messages: [
          { role: 'user', content: `Register briefing:\n${projectRegisterBriefing(canvas, parsed.data.viewContext)}` },
          { role: 'user', content: `Today's next step:\n${guide.text}` },
          { role: 'user', content: question },
        ],
      });
      const text = linkRecordIds(canvas, textOf(llm).trim());
      if (text) {
        result.assistantTurn.text = text;
        result.assistantTurn.toolCalls = [{ name: 'analyst_copilot', summary: 'Answered from project registers' }];
        const last = canvas.conversation[canvas.conversation.length - 1];
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
  sayWhatIsMissing(seen, question, result);
  stampSession(result, parsed.data.sessionId);
  if (unanswered) {
    result.assistantTurn.unanswered = unanswered;
    const last = canvas.conversation[canvas.conversation.length - 1];
    if (last?.id === result.assistantTurn.id) last.unanswered = unanswered;
  }
  mergeConversation(project, canvas, actor, turnsBefore);
  if (result.commands.some((c) => /approved/i.test(c))) await rememberProject(project);
  await store.save();
  line({ type: 'result', ...result, project: canvas });
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
  const seen = viewFor(req, project);
  const canvas = seen.project;
  const turnsBefore = project.conversation.length;
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
      project: canvas,
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
  const result = applyProjectChat(canvas, question, {
    actor: actorOf(req),
    viewContext,
    ingest: enriched,
    sitting,
  });
  sayWhatIsMissing(seen, question, result);
  stampSession(result, typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined);
  mergeConversation(project, canvas, actorOf(req), turnsBefore);
  await store.save();
  line({ type: 'result', ...result, project: canvas });
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
  const result = applyProjectChat(project, `Approve "${item.title}"`, { actor: actorOf(req) });
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
  const result = applyProjectChat(project, `Skip "${item.title}"`, { actor: actorOf(req) });
  await store.save();
  res.json({ ...result, project });
});

projectsRouter.delete('/:projectId/chat', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    // Their own view of the thread is filtered; the thread itself is not
    // theirs to empty.
    assertWorkspaceWork(req, project, 'The conversation on this project');
  } catch (err) {
    fail(res, err);
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
  const actor = actorOf(req);

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
      await persistPaneWrite(req, project, `Orchestrator pass proposed ${bgRun.draftIds.length} draft(s).`);
      return `${bgRun.source === 'model' ? 'Rule + model pass' : 'Rule pass'}; ${bgRun.draftIds.length} draft(s).`;
    });
    res.status(202).json({ ...started, pollUrl: `/api/projects/${project.id}/runs/${started.runId}` });
    return;
  }

  const journal = await beginRun(project.id, 'orchestrate', { actor: actorOf(req) });
  const run = runProjectOrchestrator(project, actorOf(req));
  await journal.step('rule_pass', `Rule pass proposed ${run.draftIds.length} draft(s).`);
  const capability = agentCapability();
  if (capability.available) {
    try {
      const extra = await runProjectOrchestratorAgent(project, actorOf(req), run);
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
  await persistPaneWrite(req, project, 'Orchestrated the next DD plan.');
  res.status(201).json({ run, drafts, project });
});

projectsRouter.post('/:projectId/ai/drafts/:draftId/commit', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    const result = commitAiDraft(project, req.params.draftId, actorOf(req));
    await persistPaneWrite(req, project, `Committed draft “${result.draft.title}”.`);
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

projectsRouter.delete('/:projectId', needs('admin'), async (req, res) => {
  const idx = projects().findIndex((p) => p.id === req.params.projectId);
  if (idx < 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const [removed] = projects().splice(idx, 1);
  // The project's own documents — its shard, its run journal, its evidence
  // files — go with it, and so do the grants written against it and what it
  // taught memory. "Deleted" has to mean deleted: all of these hold owner
  // names, document titles and uploaded bytes.
  if (removed) {
    await forgetProjects([removed.id]);
    try {
      await graphAdapter.purgeProject(removed.id);
    } catch (err) {
      console.warn(`[projects] could not purge the graph for ${removed.id}: ${(err as Error).message}`);
    }
    try {
      await storageAdapter.deleteCaseDocuments(removed.id);
    } catch (err) {
      console.warn(`[projects] could not remove documents for ${removed.id}: ${(err as Error).message}`);
    }
  }
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
    const asset = addAsset(project, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Added asset “${asset.name}”.`, { citedNodeIds: [asset.id] });
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
    const record = changeStage(project, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Changed stage to ${parsed.data.stage}.`);
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
    const assessment = createAssessment(project, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Started “${assessment.name}”.`, { citedNodeIds: [assessment.id] });
    fireAndForget('assessment_started', {
      tenantId: principalOf(req).tenantId,
      project,
      actor: actorOf(req),
      detail: { assessmentId: assessment.id, assessmentName: assessment.name },
    });
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
    const assessment = setAssessmentStatus(project, req.params.ddId, parsed.data.status as never, actorOf(req));
    await persistPaneWrite(req, project, `Updated “${assessment.name}” to ${parsed.data.status}.`, { citedNodeIds: [assessment.id] });
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
    const check = recordCheckResult(project, req.params.checkId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Recorded “${check.title}” as ${CHECK_RESULT_LABEL[check.result]}.`, {
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
      actorOf(req),
      parsed.data.sourceEvidenceId,
    );
    if (outcome.rejected.length) {
      res.status(400).json({ error: outcome.rejected.map((r) => r.error).join(' '), rejected: outcome.rejected });
      return;
    }
    const written = Object.keys(parsed.data.values).length;
    await persistPaneWrite(req, project, `Recorded ${written} value${written === 1 ? '' : 's'} on “${outcome.check.title}”.`, {
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
  const record = addEvidence(project, parsed.data, actorOf(req));
  await persistPaneWrite(req, project, `Added evidence “${record.title}”.`, { citedEvidenceIds: [record.id] });
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
      actorOf(req),
    );
    await persistPaneWrite(req, project, `Updated evidence “${record.title}” to ${record.status}.`, {
      citedEvidenceIds: [record.id],
    });
    res.json(record);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * The same status onto a set of rows.
 *
 * The single-row route writes a thread turn each time, which is right for one
 * row and wrong for twenty: marking a batch received used to leave twenty
 * near-identical lines in the conversation and bury whatever was said before
 * it. Every id is checked before anything is written, so a stale id in the
 * middle of a set cannot leave the first half applied.
 */
projectsRouter.post('/:projectId/evidence/status', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = bulkEvidenceStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const ids = [...new Set(parsed.data.ids)];
  const unknown = ids.find((id) => !project.evidence.some((e) => e.id === id));
  if (unknown) {
    res.status(404).json({ error: `Evidence not found on this project: ${unknown}` });
    return;
  }
  try {
    const actor = actorOf(req);
    for (const id of ids) {
      updateEvidenceStatus(project, id, parsed.data.status, {}, actor);
    }
    await persistPaneWrite(
      req,
      project,
      `Set ${ids.length} evidence row(s) to ${parsed.data.status}.`,
      { citedEvidenceIds: ids },
    );
    res.json({ updated: ids.length, project });
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
          actorOf(req),
        ),
      );
    }
    await persistPaneWrite(req, project, `Attached ${plural(attached.length, 'file')} to evidence.`, {
      citedEvidenceIds: [req.params.evidenceId],
    });
    fireAndForget('evidence_uploaded', {
      tenantId: principalOf(req).tenantId,
      project,
      actor: actorOf(req),
      detail: { evidenceIds: [req.params.evidenceId], fileCount: attached.length },
    });
    res.status(201).json(attached);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * A whole pack in one request.
 *
 * The per-row endpoint above writes a thread turn each time it runs, which is
 * right for one document and wrong for thirty: filing a folder used to bury the
 * conversation under sixty near-identical lines. `targets` is a JSON array of
 * evidence ids, one per file in order, so the client sends the mapping it has
 * already shown the person rather than the server guessing it again.
 */
projectsRouter.post('/:projectId/evidence/files', evidenceUpload.array('files', 40), async (req, res) => {
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

  const rawTargets = (req.body as { targets?: unknown } | undefined)?.targets;
  let targets: unknown;
  try {
    targets = typeof rawTargets === 'string' ? JSON.parse(rawTargets) : rawTargets;
  } catch {
    res.status(400).json({ error: 'targets is not valid JSON' });
    return;
  }
  if (!Array.isArray(targets) || targets.length !== files.length || targets.some((t) => typeof t !== 'string' || !t)) {
    res.status(400).json({ error: 'targets must be one evidence id per uploaded file' });
    return;
  }
  const ids = targets as string[];
  // Every target is checked before a single byte is stored, so a typo in the
  // last mapping cannot leave the first twenty documents half-filed.
  const unknown = ids.find((id) => !project.evidence.some((e) => e.id === id));
  if (unknown) {
    res.status(404).json({ error: `Evidence not found on this project: ${unknown}` });
    return;
  }
  try {
    // The targets arrive in a multipart body, parsed after the router gate
    // ran, so this route asks for itself.
    assertMayWrite(req, project, ids);
  } catch (err) {
    fail(res, err);
    return;
  }

  try {
    const attached = [];
    for (const [i, file] of files.entries()) {
      const storageKey = documentKey({ id: randomUUID(), fileName: file.originalname });
      const isImage = file.mimetype.startsWith('image/');
      const exif = isImage ? readExifCapture(file.buffer) : {};
      const capture: CaptureFacts = isImage
        ? {
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
          ids[i] as string,
          {
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
            capture,
          },
          actorOf(req),
        ),
      );
    }
    const rows = new Set(ids).size;
    await persistPaneWrite(
      req,
      project,
      `Filed ${attached.length} document(s) against ${rows} evidence row(s).`,
      { citedEvidenceIds: [...new Set(ids)] },
    );
    fireAndForget('evidence_uploaded', {
      tenantId: principalOf(req).tenantId,
      project,
      actor: actorOf(req),
      detail: { evidenceIds: [...new Set(ids)], fileCount: attached.length },
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

/**
 * Hand one record to a person.
 *
 * One route across every register rather than an `owner` on each register's
 * own patch, because assignment is one act. Splitting it is how five of them
 * come to exist and two do not — which is what this found: the model has
 * carried an `owner` on a finding, a risk and an evidence row from the start
 * and the API could only ever write the one on an action.
 *
 * The target arrives in the body, so the mounted write gate already refuses a
 * record outside a collaborator's grant with no check written here.
 */
projectsRouter.put('/:projectId/assign', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const parsed = assignBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const assigned = assignOwner(project, parsed.data.targetId, parsed.data.owner, actorOf(req));
    await persistPaneWrite(
      req,
      project,
      assigned.owner
        ? `Assigned “${assigned.title}” to ${assigned.owner}.`
        : `Cleared the owner on “${assigned.title}”.`,
      { citedNodeIds: [assigned.id] },
    );
    res.json({ assigned, project });
  } catch (err) {
    fail(res, err);
  }
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
  const record = addFinding(project, parsed.data, actorOf(req));
  if (parsed.data.linkAssessmentIds?.length) {
    linkFindingAcross(project, record.id, { assessmentIds: parsed.data.linkAssessmentIds }, actorOf(req));
  }
  await persistPaneWrite(req, project, `Logged finding “${record.title}”.`, { citedNodeIds: [record.id] });
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
    const record = linkFindingAcross(project, req.params.findingId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Linked finding “${record.title}” across DDs.`, { citedNodeIds: [record.id] });
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
    const record = patchRecordStatus(project, project.findings, req.params.findingId, parsed.data.status as never, 'finding', actorOf(req));
    await persistPaneWrite(req, project, `Updated finding “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
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
    const record = classifyFinding(project, req.params.findingId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Classified finding “${record.title}”.`, { citedNodeIds: [record.id] });
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
  const record = addRisk(project, parsed.data, actorOf(req));
  await persistPaneWrite(req, project, `Logged risk “${record.title}”.`, { citedNodeIds: [record.id] });
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
    const record = patchRecordStatus(project, project.risks, req.params.riskId, parsed.data.status as never, 'risk', actorOf(req));
    await persistPaneWrite(req, project, `Updated risk “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
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
  const record = addAction(project, parsed.data, actorOf(req));
  await persistPaneWrite(req, project, `Logged action “${record.title}”.`, { citedNodeIds: [record.id] });
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
    const record = patchRecordStatus(project, project.actions, req.params.actionId, parsed.data.status as never, 'action', actorOf(req));
    await persistPaneWrite(req, project, `Updated action “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
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
    const record = setActionCost(project, req.params.actionId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Priced action “${record.title}”.`, { citedNodeIds: [record.id] });
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
  const record = addDecision(project, parsed.data, actorOf(req));
  await persistPaneWrite(req, project, `Logged decision “${record.title}”.`, { citedNodeIds: [record.id] });
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
    const record = patchRecordStatus(project, project.decisions, req.params.decisionId, parsed.data.status as never, 'decision', actorOf(req));
    await persistPaneWrite(req, project, `Updated decision “${record.title}” to ${parsed.data.status}.`, { citedNodeIds: [record.id] });
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
    const record = addSiteVisit(project, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Recorded site visit “${record.title}”.`, { citedNodeIds: [record.id] });
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
    const record = patchSiteVisit(project, req.params.visitId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Updated site visit “${record.title}”.`, { citedNodeIds: [record.id] });
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
    const attachment = setAttachmentCapture(project, req.params.evidenceId, req.params.fileId, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Described capture of “${attachment.fileName}”.`, { citedEvidenceIds: [req.params.evidenceId] });
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
  const body = (req.body ?? {}) as { fileId?: string; evidenceId?: string; limit?: number };
  const actor = actorOf(req);

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

  await persistPaneWrite(req, project, `Read ${plural(targets.length, 'photograph')} — ${plural(drafts, 'proposed finding')}.`, {
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
    const record = addSheet(project, parsed.data, actorOf(req));
    await persistPaneWrite(req, project, `Added sheet “${record.title}”.`, { citedEvidenceIds: [record.evidenceId] });
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
    const sheet = setSheetControlPoints(project, req.params.sheetId, parsed.data.points, actorOf(req));
    const reading = readSheetFit(sheet.controlPoints);
    await persistPaneWrite(req, project, `Placed sheet “${sheet.title}” — ${reading.say}`, { citedNodeIds: [sheet.id] });
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
    removeSheet(project, req.params.sheetId, actorOf(req));
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
    { kind: parsed.data.kind, assessmentIds: parsed.data.assessmentIds, generatedBy: parsed.data.generatedBy ?? actorOf(req) },
    actorOf(req),
  );
  await persistPaneWrite(req, project, `Generated “${report.title}”.`, { citedNodeIds: [report.id] });
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
  const actor = actorOf(req);
  let outcome: { note: string; cited?: string[]; body?: unknown };
  try {
    outcome = work(project, actor);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'That change could not be made.' });
    return;
  }
  await persistPaneWrite(req, project, outcome.note, { citedNodeIds: outcome.cited });
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
