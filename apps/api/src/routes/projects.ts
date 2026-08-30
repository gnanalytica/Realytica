import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import {
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
  clearProjectConversation,
  extractReadableExcerpt,
  projectRegisterBriefing,
  renderProjectGuide,
  type ChatIngestFile,
  type DdProject,
  type ProjectChatResult,
} from '@realytica/shared';
import { agentCapability, resolveRoute, textOf } from '@realytica/agents';
import { gatherChatSides } from '../project-chat-sides';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { UPLOAD_LIMITS } from './documents';
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

export const projectsRouter = Router();

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
  await store.save();
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

projectsRouter.get('/:projectId/graph', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  refreshProjectDerived(project);
  res.json(buildProjectGraph(project));
});

projectsRouter.post('/:projectId/valuation', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const actor = actorOf(req.body as { actor?: string } | undefined);
  const run = createValuationRun(project, actor);
  await store.save();
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
    await store.save();
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
  await store.save();
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
  await store.save();
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
    await store.save();
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
  );
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
  let sides: Awaited<ReturnType<typeof gatherChatSides>>;
  try {
    sides = await gatherChatSides(project, parsed.data.question);
  } catch {
    sides = undefined;
  }
  const result = applyProjectChat(project, parsed.data.question, {
    actor: actorOf(parsed.data),
    viewContext: parsed.data.viewContext,
    sides,
  });

  const capability = agentCapability();
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
              'You are the project DD copilot. Answer only from the register briefing and the wizard guide. If they do not support an answer, say so. Do not invent findings, values, evidence, or sign-off. Do not file documents or start DDs — those are person-approved cards. Keep under 280 words.',
          },
        ],
        messages: [
          { role: 'user', content: `Register briefing:\n${projectRegisterBriefing(project, parsed.data.viewContext)}` },
          { role: 'user', content: `Wizard guide:\n${guide.text}` },
          { role: 'user', content: parsed.data.question },
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

  await store.save();
  res.json({ ...result, project });
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
  const question = typeof req.body?.question === 'string' ? req.body.question : '';
  const viewContext = typeof req.body?.viewContext === 'string' ? req.body.viewContext : undefined;
  const result = applyProjectChat(project, question, {
    actor: actorOf(req.body as { actor?: string } | undefined),
    viewContext,
    ingest,
  });
  await store.save();
  res.json({ ...result, project });
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
  const result = applyProjectChat(project, `Approve "${item.title}"`, { actor: actorOf(parsed.data) });
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
  const run = runProjectOrchestrator(project, actorOf(parsed.data));
  const drafts = project.aiDrafts.filter((d) => run.draftIds.includes(d.id));
  await store.save();
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
    await store.save();
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
    await store.save();
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
    await store.save();
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
    await store.save();
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
    await store.save();
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
    await store.save();
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
  await store.save();
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
    await store.save();
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
    await store.save();
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
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
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
  await store.save();
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
    await store.save();
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
    await store.save();
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
  await store.save();
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
    await store.save();
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
  await store.save();
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
    await store.save();
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
  await store.save();
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
    await store.save();
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
  await store.save();
  res.status(201).json(report);
});
