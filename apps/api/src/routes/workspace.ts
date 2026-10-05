/**
 * The departments: how a project is organised and the work inside it.
 *
 * Reads are mostly done in the browser — the stage timeline, the quick
 * assessments, the approvals register and progress are pure functions of the
 * project the web app already holds. These are the writes, the site app's
 * own read, and the questions only the graph can answer.
 *
 * PUT    /departments                     which departments this project uses
 * PUT    /team/:email                     a person's role in each department
 * DELETE /team/:email
 * POST   /workstreams/:key/checks         put a workstream's checks on the project record
 * POST   /engagements                     a piece of work a client commissioned
 * PATCH  /engagements/:engagementId
 * POST   /certified/read                  propose a certified report from a document in the vault
 * POST   /certified                       file it: the figure of record
 * POST   /certified/:reportId/acknowledge the signer has seen the revisit flag
 * POST   /milestones                      add milestones, or the usual set
 * PATCH  /milestones/:milestoneId
 * DELETE /milestones/:milestoneId
 * GET    /site                            the site app's view of the project
 * POST   /site-log                        a day's entry from site (idempotent on the phone's id)
 * POST   /site-log/photos                 photographs for an entry, before it is filed
 * GET    /site-log/:entryId/photos/:index
 * POST   /alerts/read
 * POST   /links                           a link a person draws between two records
 * DELETE /links/:linkId
 * GET    /graph/impact?node=              what a change to one record reaches
 * PUT    /evidence/:evidenceId/workstream which workstream owns a document
 * POST   /uploads                         a document too large for one request, in parts
 * PUT    /uploads/:uploadId/parts/:n
 * POST   /uploads/:uploadId/complete
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express, { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  acknowledgeRevisit,
  actorOf,
  addEvidence,
  addLink,
  addMilestones,
  attachEvidenceFile,
  buildProjectGraph,
  can,
  certifiedReadout,
  constructionGate,
  createEngagement,
  ensureWorkstreamChecks,
  createProjectGrant,
  departmentReach,
  departmentRole,
  fileCertifiedReport,
  graphImpact,
  logSiteEntry,
  markAlertsRead,
  MILESTONE_TEMPLATE,
  noteProjectEdit,
  openAlerts,
  patchProjectGrant,
  progressSummary,
  removeLink,
  removeTeamMember,
  roleCanDecide,
  roleCanEdit,
  sameEmail,
  setDocumentWorkstream,
  DEPARTMENTS,
  addObservation,
  departmentDisciplines,
  departmentsOfDiscipline,
  questionnaireDepartment,
  addQuestion,
  addQuestionnaire,
  fileSiteLogPhoto,
  setPhotoDescription,
  setPhotoInReport,
  patchObservation,
  SCOPE_KEYS,
  answerQuestion,
  confirmSuggestions,
  findQuestionnaire,
  parseQuestionnaire,
  parseQuestionnaireCsv,
  parseQuestionnaireText,
  removeQuestion,
  removeQuestionnaire,
  ANSWER_SOURCES,
  setMilestonePercent,
  setProjectDepartments,
  setTeamMember,
  stageTimeline,
  updateEngagement,
  workstreamDefinition,
  type DdProject,
  type DepartmentKey,
  type ScopeKey,
  type DepartmentRole,
} from '@realytica/shared';
import { needs, principalOf } from '../auth/middleware';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { graphAdapter } from '../graph';
import { readOntoRegister } from '../documents/register-read';
import { docxOutline } from '../documents/docx-outline';
import { departmentKeySchema, engagementPatchSchema, engagementSchema } from '../project-schemas';

type Params = { projectId: string };

export const projectWorkspaceRouter = Router({ mergeParams: true });

function findProject(id: string | undefined): DdProject | undefined {
  return id ? store.data.projects?.find((p) => p.id === id) : undefined;
}

function roleIn(req: Request, project: DdProject, department: DepartmentKey): DepartmentRole | undefined {
  const me = principalOf(req);
  return departmentRole(project, { email: me.email, workspaceRole: me.role }, department);
}

/**
 * The department gate. Edits need a lead, contributor or signer; deciding —
 * filing a certified report, removing a milestone — needs a lead or signer.
 * A refusal says which department, because "not allowed" alone sends people
 * hunting.
 */
function allowed(req: Request, res: Response, project: DdProject, department: DepartmentKey, need: 'edit' | 'decide'): boolean {
  const role = roleIn(req, project, department);
  const ok = need === 'edit' ? roleCanEdit(role) : roleCanDecide(role);
  if (!ok) res.status(403).json({ error: `That needs a ${need === 'edit' ? 'lead, contributor or signer' : 'lead or signer'} in ${department}.` });
  return ok;
}

function staffOnly(req: Request, res: Response): boolean {
  if (principalOf(req).role === 'collaborator') {
    res.status(403).json({ error: 'Only the firm’s own people can do that.' });
    return false;
  }
  return true;
}

function load(req: Request<Params>, res: Response): DdProject | undefined {
  const project = findProject(req.params.projectId);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

function touch(project: DdProject): void {
  project.updatedAt = new Date().toISOString();
}

function failed(res: Response, err: unknown, fallback: string): void {
  res.status(400).json({ error: err instanceof Error ? err.message : fallback });
}

/* ==================================================================== */
/* Departments and the team                                              */
/* ==================================================================== */

const departmentsSchema = z.object({ departments: z.array(departmentKeySchema).min(1).max(6) });

projectWorkspaceRouter.put<Params>('/departments', needs('admin'), async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = departmentsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose at least one department.' });
    return;
  }
  try {
    const departments = setProjectDepartments(project, parsed.data.departments, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project, departments });
  } catch (err) {
    failed(res, err, 'Could not change the departments');
  }
});

const roleSchema = z.enum(['lead', 'contributor', 'signer', 'viewer']);
const teamSchema = z.object({
  name: z.string().trim().max(120).optional(),
  departments: z.record(departmentKeySchema, roleSchema),
  signer: z
    .object({ profession: z.string().trim().min(2).max(80), registration: z.string().trim().max(80).optional(), firm: z.string().trim().max(120).optional() })
    .optional(),
});

/**
 * Put a person on the project with a role in each department.
 *
 * Somebody outside the firm is invited as a collaborator in the same motion,
 * and their grant — what the redaction lets them see — is written from the
 * departments they were given, so the two can never disagree.
 */
projectWorkspaceRouter.put<Params & { email: string }>('/team/:email', needs('admin'), async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = teamSchema.safeParse(req.body);
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  if (!parsed.success || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'Give an email address and a role in at least one department.' });
    return;
  }
  const me = principalOf(req);
  try {
    const member = setTeamMember(project, { email, ...parsed.data }, actorOf(me));
    const memberships = (store.data.memberships ??= []);
    let membership = memberships.find((m) => m.tenantId === me.tenantId && sameEmail(m.email, email));
    if (!membership) {
      membership = { tenantId: me.tenantId, email, role: 'collaborator', invitedBy: me.email, createdAt: new Date().toISOString(), ...(parsed.data.name ? { name: parsed.data.name } : {}) };
      memberships.push(membership);
    }
    if (membership.role === 'collaborator') {
      const reach = departmentReach(member.departments);
      const grants = (store.data.grants ??= []);
      const held = grants.find((g) => g.tenantId === me.tenantId && g.projectId === project.id && sameEmail(g.email, email));
      const professionalRole = parsed.data.signer?.profession;
      if (held) patchProjectGrant(held, { role: reach.role, allAssessments: true, allScopes: false, scopeKeys: reach.scopeKeys, areas: reach.areas, ...(professionalRole ? { professionalRole } : {}) });
      else {
        grants.push(
          createProjectGrant(
            { email, role: reach.role, allAssessments: true, allScopes: false, scopeKeys: reach.scopeKeys, areas: reach.areas, ...(professionalRole ? { professionalRole } : {}) },
            { id: `grn_${randomUUID()}`, tenantId: me.tenantId, projectId: project.id, createdBy: me.email },
          ),
        );
      }
    }
    touch(project);
    await store.save();
    res.json({ project, member });
  } catch (err) {
    failed(res, err, 'Could not put them on the project');
  }
});

projectWorkspaceRouter.delete<Params & { email: string }>('/team/:email', needs('admin'), async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const me = principalOf(req);
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  removeTeamMember(project, email, actorOf(me));
  // A collaborator's reach goes with them; their workspace membership stays,
  // because they may be on other projects.
  store.data.grants = (store.data.grants ?? []).filter((g) => !(g.tenantId === me.tenantId && g.projectId === project.id && sameEmail(g.email, email)));
  touch(project);
  await store.save();
  res.json({ project });
});

projectWorkspaceRouter.post<Params & { key: string }>('/workstreams/:key/checks', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const ws = workstreamDefinition(req.params.key);
  if (!ws) {
    res.status(404).json({ error: 'Unknown workstream.' });
    return;
  }
  if (!allowed(req, res, project, ws.department, 'edit')) return;
  const record = ensureWorkstreamChecks(project, [ws.key], actorOf(principalOf(req)));
  if (!record) {
    res.status(400).json({ error: `${ws.label} has no checks in the library yet.` });
    return;
  }
  noteProjectEdit(project, `Put the ${ws.label} checks on the project record.`, { actor: actorOf(principalOf(req)) });
  touch(project);
  await store.save();
  res.status(201).json({ project });
});

/* ==================================================================== */
/* Engagements                                                           */
/* ==================================================================== */

projectWorkspaceRouter.post<Params>('/engagements', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  const parsed = engagementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say what kind of engagement it is.', details: parsed.error.flatten() });
    return;
  }
  try {
    const engagement = createEngagement(project, parsed.data, actorOf(principalOf(req)));
    noteProjectEdit(project, `Opened an engagement: ${engagement.title}${engagement.client ? ` for ${engagement.client}` : ''}.`, { actor: actorOf(principalOf(req)) });
    touch(project);
    await store.save();
    res.status(201).json({ project, engagement });
  } catch (err) {
    failed(res, err, 'Could not open the engagement');
  }
});

projectWorkspaceRouter.patch<Params & { engagementId: string }>('/engagements/:engagementId', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  const parsed = engagementPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const engagement = updateEngagement(project, req.params.engagementId, parsed.data, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project, engagement });
  } catch (err) {
    failed(res, err, 'Could not change the engagement');
  }
});

/* ==================================================================== */
/* Certified reports                                                     */
/* ==================================================================== */

const readSchema = z.object({ evidenceId: z.string().min(1).max(80) });

projectWorkspaceRouter.post<Params>('/certified/read', (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = readSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which document to read.' });
    return;
  }
  try {
    res.json({ readout: certifiedReadout(project, parsed.data.evidenceId) });
  } catch (err) {
    failed(res, err, 'Could not read the report');
  }
});

const certifiedSchema = z
  .object({
    workstream: z.string().regex(/^[a-z]+\.[a-z_]+$/),
    title: z.string().trim().min(2).max(200),
    evidenceId: z.string().min(1).max(80),
    signer: z.object({
      name: z.string().trim().min(2).max(120),
      profession: z.string().trim().min(2).max(80),
      registration: z.string().trim().max(80).optional(),
      firm: z.string().trim().max(120).optional(),
    }),
    issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    scope: z.string().trim().max(600).optional(),
    figure: z.object({ value: z.number().nonnegative(), unit: z.enum(['INR', '%']) }).optional(),
    verdict: z.enum(['clear', 'conditions', 'blockers']).optional(),
    conditions: z.array(z.string().trim().min(1).max(400)).max(20).optional(),
  })
  .refine((b) => b.figure || b.verdict, { message: 'A certified report states a figure or a conclusion.' });

projectWorkspaceRouter.post<Params>('/certified', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = certifiedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const ws = workstreamDefinition(parsed.data.workstream);
  if (!ws) {
    res.status(400).json({ error: 'Unknown workstream.' });
    return;
  }
  if (!allowed(req, res, project, ws.department, 'decide')) return;
  try {
    const report = fileCertifiedReport(project, parsed.data, actorOf(principalOf(req)));
    noteProjectEdit(project, `Filed ${report.title} by ${report.signer.name} as the figure of record for ${ws.label}.`, { citedEvidenceIds: [report.evidenceId], actor: actorOf(principalOf(req)) });
    touch(project);
    await store.save();
    res.status(201).json({ project, report });
  } catch (err) {
    failed(res, err, 'Could not file the report');
  }
});

projectWorkspaceRouter.post<Params & { reportId: string }>('/certified/:reportId/acknowledge', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const report = (project.certifiedReports ?? []).find((r) => r.id === req.params.reportId);
  const ws = report ? workstreamDefinition(report.workstream) : undefined;
  if (!report || !ws) {
    res.status(404).json({ error: 'No such certified report.' });
    return;
  }
  if (!allowed(req, res, project, ws.department, 'decide')) return;
  try {
    acknowledgeRevisit(project, report.id, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not acknowledge it');
  }
});

/* ==================================================================== */
/* Milestones and the site log                                           */
/* ==================================================================== */

const milestoneRows = z.array(
  z.object({
    name: z.string().trim().min(1).max(120),
    weight: z.number().positive().max(1000),
    assetId: z.string().max(80).optional(),
    plannedFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
);
const milestonesSchema = z.object({ template: z.boolean().optional(), rows: milestoneRows.max(60).optional() });

projectWorkspaceRouter.post<Params>('/milestones', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, 'construction', 'edit')) return;
  const parsed = milestonesSchema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.template && !parsed.data.rows?.length)) {
    res.status(400).json({ error: 'Give the milestones, or ask for the usual set.' });
    return;
  }
  const rows = parsed.data.template ? MILESTONE_TEMPLATE.map((m) => ({ ...m })) : parsed.data.rows!;
  const added = addMilestones(project, rows, actorOf(principalOf(req)));
  touch(project);
  await store.save();
  res.status(201).json({ project, milestones: added });
});

const milestonePatch = z.object({
  percent: z.number().min(0).max(100).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  weight: z.number().positive().max(1000).optional(),
  plannedFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

projectWorkspaceRouter.patch<Params & { milestoneId: string }>('/milestones/:milestoneId', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, 'construction', 'edit')) return;
  const parsed = milestonePatch.safeParse(req.body);
  const milestone = (project.milestones ?? []).find((m) => m.id === req.params.milestoneId);
  if (!parsed.success || !milestone) {
    res.status(milestone ? 400 : 404).json({ error: milestone ? 'Validation failed' : 'No such milestone.' });
    return;
  }
  try {
    const actor = actorOf(principalOf(req));
    if (parsed.data.percent !== undefined) setMilestonePercent(project, milestone.id, parsed.data.percent, actor);
    if (parsed.data.name) milestone.name = parsed.data.name;
    if (parsed.data.weight) milestone.weight = parsed.data.weight;
    if (parsed.data.plannedFinish === null) delete milestone.plannedFinish;
    else if (parsed.data.plannedFinish) milestone.plannedFinish = parsed.data.plannedFinish;
    milestone.updatedAt = new Date().toISOString();
    milestone.updatedBy = actor;
    touch(project);
    await store.save();
    res.json({ project, milestone });
  } catch (err) {
    failed(res, err, 'Could not change the milestone');
  }
});

projectWorkspaceRouter.delete<Params & { milestoneId: string }>('/milestones/:milestoneId', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, 'construction', 'decide')) return;
  const before = (project.milestones ?? []).length;
  project.milestones = (project.milestones ?? []).filter((m) => m.id !== req.params.milestoneId);
  if (project.milestones.length === before) {
    res.status(404).json({ error: 'No such milestone.' });
    return;
  }
  touch(project);
  await store.save();
  res.json({ project });
});

/** The site app's whole view of a project, in one small answer. */
projectWorkspaceRouter.get<Params>('/site', (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const role = roleIn(req, project, 'construction');
  // Whether a write would actually go through: the department role, and the
  // workspace-wide write gate every project write passes first.
  const canLog = roleCanEdit(role) && can(principalOf(req).role, 'write');
  const log = [...(project.siteLog ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const timeline = stageTimeline(project);
  res.json({
    project: { id: project.id, name: project.name, reference: project.reference, location: project.location, city: project.city, stage: timeline.current, stageLabel: timeline.stages.find((s) => s.key === timeline.currentStage)?.label, siteCoordinate: project.siteCoordinate ?? null },
    role: role ?? null,
    canLog,
    milestones: project.milestones ?? [],
    progress: progressSummary(project),
    gate: constructionGate(project),
    log: log.slice(0, 30).map((e) => ({ ...e, photos: e.photos.map((p, i) => ({ index: i, fileName: p.fileName, caption: p.caption, takenAt: p.takenAt, point: p.point })) })),
    alerts: openAlerts(project).filter((a) => a.department === 'construction').slice(0, 20),
  });
});

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const siteLogSchema = z.object({
  clientId: z.string().trim().min(6).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather: z.string().trim().max(80).optional(),
  manpower: z.array(z.object({ trade: z.string().trim().min(1).max(60), count: z.number().int().min(0).max(5000) })).max(40).optional(),
  workDone: z.string().trim().max(4000).optional(),
  milestoneUpdates: z.array(z.object({ milestoneId: z.string().max(80), percent: z.number().min(0).max(100) })).max(60).optional(),
  issues: z.array(z.object({ title: z.string().trim().min(1).max(200), severity: z.enum(['low', 'medium', 'high']).optional(), note: z.string().trim().max(1000).optional() })).max(40).optional(),
  photos: z
    .array(z.object({ storageKey: z.string().max(200), fileName: z.string().max(200), mimeType: z.string().max(80), takenAt: z.string().max(40).optional(), point: point.optional(), caption: z.string().max(400).optional() }))
    .max(40)
    .optional(),
  point: point.optional(),
});

projectWorkspaceRouter.post<Params>('/site-log', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, 'construction', 'edit')) return;
  const parsed = siteLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  // A photograph has to be one this project stored: the phone cannot name another file.
  const prefix = `site_${project.id}_`;
  if ((parsed.data.photos ?? []).some((p) => !p.storageKey.startsWith(prefix))) {
    res.status(400).json({ error: 'Upload the photographs first.' });
    return;
  }
  try {
    const me = principalOf(req);
    const { entry, duplicate } = logSiteEntry(project, parsed.data, me.name ? `${me.name} (${me.email})` : me.email);
    if (!duplicate) {
      noteProjectEdit(project, `Site log for ${entry.date}: ${entry.workDone.slice(0, 120) || 'entry filed'}${entry.issues.length ? ` · ${entry.issues.length} issue${entry.issues.length === 1 ? '' : 's'}` : ''}.`, { actor: actorOf(me) });
      touch(project);
      await store.save();
    }
    res.status(duplicate ? 200 : 201).json({ entry, duplicate, progress: progressSummary(project), gate: constructionGate(project) });
  } catch (err) {
    failed(res, err, 'Could not file the entry');
  }
});

/**
 * Each photograph's ceiling. On the hosted service a whole request carries
 * 4.5 MB at most, so the phone sends its photographs resized and in batches
 * that fit — six small ones, or one large one.
 */
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/;
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 6 },
  // Everything is taken in, so a refusal can name the file rather than drop it.
});

projectWorkspaceRouter.post<Params>('/site-log/photos', photoUpload.array('photos', 6), async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, 'construction', 'edit')) return;
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) {
    res.status(400).json({ error: 'Attach the photographs as JPEG, PNG or WebP, up to 4 MB each.' });
    return;
  }
  const refused = files.filter((f) => !PHOTO_TYPES.test(f.mimetype));
  if (refused.length) {
    res.status(400).json({ error: `Not a photograph this takes (JPEG, PNG, WebP or HEIC): ${refused.map((f) => f.originalname).join(', ')}.`, refused: refused.map((f) => f.originalname) });
    return;
  }
  const photos = [];
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase() || (file.mimetype === 'image/png' ? '.png' : '.jpg');
    const storageKey = `site_${project.id}_${randomUUID()}${ext}`;
    await storageAdapter.putDocument(project.id, storageKey, file.buffer, file.mimetype);
    photos.push({ storageKey, fileName: file.originalname, mimeType: file.mimetype });
  }
  res.status(201).json({ photos });
});

projectWorkspaceRouter.get<Params & { entryId: string; index: string }>('/site-log/:entryId/photos/:index', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const entry = (project.siteLog ?? []).find((e) => e.id === req.params.entryId);
  const photo = entry?.photos[Number(req.params.index)];
  if (!photo) {
    res.status(404).json({ error: 'No such photograph.' });
    return;
  }
  const bytes = await storageAdapter.getDocument(project.id, photo.storageKey);
  if (!bytes) {
    res.status(404).json({ error: 'The photograph is missing from storage.' });
    return;
  }
  res.setHeader('Content-Type', photo.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(bytes);
});

/* ==================================================================== */
/* Alerts, links, ownership, impact                                      */
/* ==================================================================== */

const readAlertsSchema = z.object({ ids: z.union([z.literal('all'), z.array(z.string().max(80)).max(500)]) });

projectWorkspaceRouter.post<Params>('/alerts/read', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = readAlertsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which alerts.' });
    return;
  }
  const n = markAlertsRead(project, parsed.data.ids, principalOf(req).email.toLowerCase());
  if (n) {
    touch(project);
    await store.save();
  }
  res.json({ read: n, alerts: openAlerts(project) });
});

const linkEnd = z.object({
  kind: z.enum(['workstream', 'check', 'document', 'certified', 'milestone', 'approval', 'engagement', 'finding', 'site_entry']),
  id: z.string().min(1).max(120),
});
const linkSchema = z.object({ from: linkEnd, to: linkEnd, type: z.enum(['gates', 'feeds', 'cites', 'certifies', 'draws_on', 'relates']), note: z.string().trim().max(400).optional() });

projectWorkspaceRouter.post<Params>('/links', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A link joins two records with a kind of link.' });
    return;
  }
  try {
    const link = addLink(project, parsed.data, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.status(201).json({ project, link });
  } catch (err) {
    failed(res, err, 'Could not draw the link');
  }
});

projectWorkspaceRouter.delete<Params & { linkId: string }>('/links/:linkId', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  removeLink(project, req.params.linkId, actorOf(principalOf(req)));
  touch(project);
  await store.save();
  res.json({ project });
});

const ownerSchema = z.object({ workstream: z.string().regex(/^[a-z]+\.[a-z_]+$/).nullable() });

projectWorkspaceRouter.put<Params & { evidenceId: string }>('/evidence/:evidenceId/workstream', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  const parsed = ownerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Name the workstream, or null to read it from the document.' });
    return;
  }
  try {
    setDocumentWorkstream(project, req.params.evidenceId, parsed.data.workstream);
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not move the document');
  }
});

/**
 * What a change reaches. Neo4j walks it when it is the store; if that fails
 * the same walk runs over the projection, so the answer never depends on the
 * graph store being up.
 */
projectWorkspaceRouter.get<Params>('/graph/impact', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const node = typeof req.query.node === 'string' ? req.query.node.slice(0, 200) : '';
  if (!node) {
    res.status(400).json({ error: 'Name the record: ?node=' });
    return;
  }
  let impact = null;
  let source: 'neo4j' | 'journal' | 'projection' = graphAdapter.kind;
  try {
    impact = await graphAdapter.impact(project.id, node);
  } catch (err) {
    console.warn(`[graph] impact fell back to the projection: ${(err as Error).message}`);
  }
  if (!impact) {
    impact = graphImpact(buildProjectGraph(project), node);
    source = 'projection';
  }
  if (!impact) {
    res.status(404).json({ error: 'That record is not in the graph.' });
    return;
  }
  res.json({ impact, source });
});

/* ==================================================================== */
/* Large documents, in parts                                             */
/* ==================================================================== */

/** Under the 4.5 MB a serverless request may carry, with room for headers. */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;
/** How long finishing an upload spends reading it before answering. */
const READ_BUDGET_MS = 90_000;

/** The largest single document the vault takes. A merged title bundle runs to 70 MB. */
export const UPLOAD_MAX_BYTES = 300 * 1024 * 1024;

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(3).max(120),
  size: z.number().int().positive().max(UPLOAD_MAX_BYTES),
});

interface PendingUpload {
  id: string;
  projectId: string;
  fileName: string;
  contentType: string;
  size: number;
  parts: number;
  by: string;
  startedAt: string;
}

const partKey = (uploadId: string, n: number) => `part_${uploadId}_${String(n).padStart(4, '0')}`;
const manifestKey = (uploadId: string) => `part_${uploadId}_manifest.json`;

projectWorkspaceRouter.post<Params>('/uploads', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Give the file's name, type and size; up to ${Math.round(UPLOAD_MAX_BYTES / 1048576)} MB.` });
    return;
  }
  const upload: PendingUpload = {
    id: randomUUID(),
    projectId: project.id,
    ...parsed.data,
    parts: Math.ceil(parsed.data.size / UPLOAD_PART_BYTES),
    by: actorOf(principalOf(req)),
    startedAt: new Date().toISOString(),
  };
  // The manifest rides in storage, not memory: each part may land on a different instance.
  await storageAdapter.putDocument(project.id, manifestKey(upload.id), Buffer.from(JSON.stringify(upload)), 'application/json');
  res.status(201).json({ uploadId: upload.id, partBytes: UPLOAD_PART_BYTES, parts: upload.parts });
});

projectWorkspaceRouter.put<Params & { uploadId: string; n: string }>(
  '/uploads/:uploadId/parts/:n',
  express.raw({ type: () => true, limit: UPLOAD_PART_BYTES + 1024 }),
  async (req, res) => {
    const project = load(req, res);
    if (!project || !staffOnly(req, res)) return;
    const n = Number(req.params.n);
    const uploadId = req.params.uploadId;
    if (!/^[0-9a-f-]{36}$/.test(uploadId) || !Number.isInteger(n) || n < 0 || n > 10_000 || !Buffer.isBuffer(req.body) || !req.body.length) {
      res.status(400).json({ error: 'Send the part’s bytes as the request body.' });
      return;
    }
    const manifest = await storageAdapter.getDocument(project.id, manifestKey(uploadId));
    if (!manifest) {
      res.status(404).json({ error: 'No such upload. Start it again.' });
      return;
    }
    await storageAdapter.putDocument(project.id, partKey(uploadId, n), req.body, 'application/octet-stream');
    res.json({ received: n, bytes: req.body.length });
  },
);

const completeSchema = z.object({ evidenceId: z.string().max(80).optional(), title: z.string().trim().max(200).optional() });

projectWorkspaceRouter.post<Params & { uploadId: string }>('/uploads/:uploadId/complete', async (req, res) => {
  const project = load(req, res);
  if (!project || !staffOnly(req, res)) return;
  const parsed = completeSchema.safeParse(req.body ?? {});
  const uploadId = req.params.uploadId;
  const raw = /^[0-9a-f-]{36}$/.test(uploadId) ? await storageAdapter.getDocument(project.id, manifestKey(uploadId)) : null;
  if (!parsed.success || !raw) {
    res.status(404).json({ error: 'No such upload. Start it again.' });
    return;
  }
  const upload = JSON.parse(raw.toString('utf8')) as PendingUpload;
  const chunks: Buffer[] = [];
  for (let n = 0; n < upload.parts; n += 1) {
    const part = await storageAdapter.getDocument(project.id, partKey(uploadId, n));
    if (!part) {
      res.status(409).json({ error: `Part ${n + 1} of ${upload.parts} has not arrived. Send it, then finish again.` });
      return;
    }
    chunks.push(part);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== upload.size) {
    res.status(409).json({ error: `Received ${bytes.length} bytes of ${upload.size}. Send the missing parts again.` });
    return;
  }
  const actor = actorOf(principalOf(req));
  let evidenceId = parsed.data.evidenceId;
  if (evidenceId && !project.evidence.some((e) => e.id === evidenceId)) {
    res.status(404).json({ error: 'No such document row.' });
    return;
  }
  if (!evidenceId) {
    const title = parsed.data.title || upload.fileName.replace(/\.[a-z0-9]{2,5}$/i, '');
    evidenceId = addEvidence(project, { title, kind: upload.contentType.startsWith('image/') ? 'photograph' : 'document', fileName: upload.fileName, status: 'received' }, actor).id;
  }
  const storageKey = documentKey({ id: randomUUID(), fileName: upload.fileName });
  await storageAdapter.putDocument(project.id, storageKey, bytes, upload.contentType);
  attachEvidenceFile(project, evidenceId, { fileName: upload.fileName, mimeType: upload.contentType, sizeBytes: bytes.length, storageKey, capture: {} }, actor);
  // A large scan is read for as long as a request can wait; asking the chat to
  // read the filed documents carries on from there, with a model if one is set.
  await readOntoRegister(project, [{ evidenceId, buffer: bytes, fileName: upload.fileName, mimeType: upload.contentType, sizeBytes: bytes.length, storageKey }], actor, { deadline: Date.now() + READ_BUDGET_MS }).catch(() => ({ read: 0 }));
  noteProjectEdit(project, `Filed ${upload.fileName} (${(bytes.length / 1048576).toFixed(1)} MB) in the vault.`, { citedEvidenceIds: [evidenceId], actor });
  touch(project);
  await store.save();
  // The parts and the manifest have done their job.
  await Promise.all([...Array.from({ length: upload.parts }, (_, n) => storageAdapter.deleteDocument(project.id, partKey(uploadId, n))), storageAdapter.deleteDocument(project.id, manifestKey(uploadId))].map((p) => Promise.resolve(p).catch(() => undefined)));
  res.status(201).json({ project, evidenceId });
});

/* ==================================================================== */
/* Questionnaires                                                        */
/* ==================================================================== */

/**
 * A questionnaire belongs to one department, and that department's roles
 * govern it: a contributor imports and answers, as they would file a
 * document or record a check. One with no department is Engineering's.
 */
const departmentSchema = z.enum(DEPARTMENTS.map((d) => d.key) as [DepartmentKey, ...DepartmentKey[]]);

function sheetDepartment(project: DdProject, questionnaireId: string): DepartmentKey {
  const sheet = (project.questionnaires ?? []).find((q) => q.id === questionnaireId);
  return sheet ? questionnaireDepartment(sheet) : 'construction';
}
const QUESTIONNAIRE_MAX_BYTES = 4 * 1024 * 1024;
const questionnaireUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: QUESTIONNAIRE_MAX_BYTES, files: 1 } });

const questionnaireTextSchema = z.object({ title: z.string().trim().min(1).max(160), text: z.string().min(1).max(400_000) });

function parseQuestionnaireFile(file: Express.Multer.File) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.docx')) return parseQuestionnaire(docxOutline(file.buffer));
  const text = file.buffer.toString('utf8');
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return parseQuestionnaireCsv(text);
  if (name.endsWith('.txt') || name.endsWith('.md')) return parseQuestionnaireText(text);
  throw new Error('A questionnaire is read from a Word file (.docx), a spreadsheet saved as .csv, or plain text. Save it as one of those, or paste the questions.');
}

projectWorkspaceRouter.post<Params>('/questionnaires', questionnaireUpload.single('file'), async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const asked = departmentSchema.safeParse(req.body?.department ?? 'construction');
  if (!asked.success) {
    res.status(400).json({ error: 'No such department.' });
    return;
  }
  const department = asked.data;
  if (!allowed(req, res, project, department, 'edit')) return;
  try {
    const file = req.file as Express.Multer.File | undefined;
    let record;
    if (file) {
      const title = typeof req.body?.title === 'string' && req.body.title.trim() ? String(req.body.title).trim().slice(0, 160) : file.originalname.replace(/\.[a-z0-9]+$/i, '');
      record = addQuestionnaire(project, { title, department, fileName: file.originalname, parsed: parseQuestionnaireFile(file) }, actorOf(principalOf(req)));
    } else {
      const parsed = questionnaireTextSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Attach a file, or send a title and the questions as text.' });
        return;
      }
      const looksCsv = /^[^\n]*\b(question|query)\b[^\n]*[,\t]/i.test(parsed.data.text);
      record = addQuestionnaire(project, { title: parsed.data.title, department, parsed: looksCsv ? parseQuestionnaireCsv(parsed.data.text) : parseQuestionnaireText(parsed.data.text) }, actorOf(principalOf(req)));
    }
    noteProjectEdit(project, `Imported the questionnaire “${record.title}”: ${record.questions.length} question(s).`, { actor: actorOf(principalOf(req)) });
    touch(project);
    await store.save();
    res.status(201).json({ project, questionnaireId: record.id });
  } catch (err) {
    failed(res, err, 'Could not read that questionnaire');
  }
});

const proofSchema = z.object({ evidenceId: z.string().min(1), page: z.number().int().min(1).max(100_000).optional(), quote: z.string().max(400).optional() });
const answerSchema = z.object({
  answer: z.string().max(4000).nullable().optional(),
  source: z.enum(ANSWER_SOURCES as unknown as [string, ...string[]]).nullable().optional(),
  proof: z.array(proofSchema).max(12).optional(),
  note: z.string().max(1000).nullable().optional(),
  text: z.string().trim().min(1).max(600).optional(),
  section: z.string().max(120).nullable().optional(),
  omitFromReport: z.boolean().optional(),
});

type QParams = Params & { questionnaireId: string };

projectWorkspaceRouter.patch<QParams & { questionId: string }>('/questionnaires/:questionnaireId/questions/:questionId', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, sheetDepartment(project, req.params.questionnaireId), 'edit')) return;
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send the answer, where it came from, and what stands behind it.' });
    return;
  }
  try {
    answerQuestion(project, req.params.questionnaireId, req.params.questionId, parsed.data as Parameters<typeof answerQuestion>[3], actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not save the answer');
  }
});

projectWorkspaceRouter.post<QParams>('/questionnaires/:questionnaireId/questions', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, sheetDepartment(project, req.params.questionnaireId), 'edit')) return;
  const parsed = z.object({ text: z.string().trim().min(1).max(600), section: z.string().max(120).optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send the question’s wording.' });
    return;
  }
  try {
    addQuestion(project, req.params.questionnaireId, parsed.data, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.status(201).json({ project });
  } catch (err) {
    failed(res, err, 'Could not add the question');
  }
});

projectWorkspaceRouter.delete<QParams & { questionId: string }>('/questionnaires/:questionnaireId/questions/:questionId', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, sheetDepartment(project, req.params.questionnaireId), 'decide')) return;
  try {
    removeQuestion(project, req.params.questionnaireId, req.params.questionId, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not remove the question');
  }
});

/** Confirm a model's suggested answers: some, or all of them. */
projectWorkspaceRouter.post<QParams>('/questionnaires/:questionnaireId/confirm', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, sheetDepartment(project, req.params.questionnaireId), 'edit')) return;
  const parsed = z.object({ questionIds: z.array(z.string()).max(500).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Send the ids of the answers to confirm, or none to confirm all.' });
    return;
  }
  try {
    const confirmed = confirmSuggestions(project, req.params.questionnaireId, parsed.data.questionIds ?? 'all', actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project, confirmed });
  } catch (err) {
    failed(res, err, 'Could not confirm those answers');
  }
});

projectWorkspaceRouter.delete<QParams>('/questionnaires/:questionnaireId', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, sheetDepartment(project, req.params.questionnaireId), 'decide')) return;
  try {
    const title = findQuestionnaire(project, req.params.questionnaireId).title;
    removeQuestionnaire(project, req.params.questionnaireId, actorOf(principalOf(req)));
    noteProjectEdit(project, `Removed the questionnaire “${title}”.`, { actor: actorOf(principalOf(req)) });
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not remove the questionnaire');
  }
});

/* ==================================================================== */
/* Observations and mitigations                                          */
/* ==================================================================== */

const severitySchema = z.enum(['low', 'medium', 'high', 'critical']);
const disciplineSchema = z.enum(SCOPE_KEYS as unknown as [string, ...string[]]);
const observationSchema = z.object({
  area: z.string().max(120).optional(),
  description: z.string().trim().min(1).max(4000),
  severity: severitySchema,
  mitigation: z.string().max(4000).optional(),
  standardRef: z.string().max(240).optional(),
  discipline: disciplineSchema.optional(),
  department: departmentSchema.optional(),
  title: z.string().max(200).optional(),
  evidenceIds: z.array(z.string()).max(40).optional(),
  cost: z.number().min(0).max(1e13).nullable().optional(),
  costBand: z.enum(['immediate', 'year_1', 'years_1_5', 'years_5_10']).nullable().optional(),
});
const observationPatchSchema = z.object({
  area: z.string().max(120).nullable().optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  title: z.string().max(200).optional(),
  severity: severitySchema.optional(),
  mitigation: z.string().max(4000).nullable().optional(),
  standardRef: z.string().max(240).nullable().optional(),
  discipline: disciplineSchema.optional(),
  evidenceIds: z.array(z.string()).max(40).optional(),
  includeInReport: z.boolean().optional(),
  cost: z.number().min(0).max(1e13).nullable().optional(),
  costBand: z.enum(['immediate', 'year_1', 'years_1_5', 'years_5_10']).nullable().optional(),
});

projectWorkspaceRouter.post<Params>('/observations', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = observationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say what was observed and how much it matters.' });
    return;
  }
  // The department is the one the discipline is worked in, not one the caller names.
  const { department = 'construction', ...input } = parsed.data;
  const disciplines = departmentDisciplines(project, department);
  const discipline = (input.discipline as ScopeKey | undefined) ?? disciplines[0];
  if (!discipline || !disciplines.includes(discipline)) {
    res.status(400).json({ error: 'That discipline is not part of this department.' });
    return;
  }
  if (!allowed(req, res, project, department, 'edit')) return;
  try {
    const record = addObservation(project, { ...input, discipline } as Parameters<typeof addObservation>[1], actorOf(principalOf(req)));
    noteProjectEdit(project, `Recorded an observation: ${record.title}`, { actor: actorOf(principalOf(req)) });
    touch(project);
    await store.save();
    res.status(201).json({ project, findingId: record.id });
  } catch (err) {
    failed(res, err, 'Could not record the observation');
  }
});

projectWorkspaceRouter.patch<Params & { findingId: string }>('/observations/:findingId', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const parsed = observationPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'That change to the observation is not one this takes.' });
    return;
  }
  // Whoever may edit in a department the finding is worked in may change it, and may only move it to a discipline they also hold.
  const held = project.findings.find((f) => f.id === req.params.findingId);
  const mayEditIn = (discipline: ScopeKey) => departmentsOfDiscipline(project, discipline).some((d) => roleCanEdit(roleIn(req, project, d)));
  if (held && !(mayEditIn(held.discipline) && (!parsed.data.discipline || mayEditIn(parsed.data.discipline as ScopeKey)))) {
    res.status(403).json({ error: 'That needs a lead, contributor or signer in the department this finding belongs to.' });
    return;
  }
  try {
    patchObservation(project, req.params.findingId, parsed.data as Parameters<typeof patchObservation>[2], actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not change the observation');
  }
});

/** Put a site-log photograph on the document register, so an observation or an answer can cite it. */
projectWorkspaceRouter.post<Params & { entryId: string; index: string }>('/site-log/:entryId/photos/:index/file', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, 'construction', 'edit')) return;
  try {
    const row = fileSiteLogPhoto(project, req.params.entryId, Number(req.params.index), actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.status(201).json({ project, evidenceId: row.id });
  } catch (err) {
    failed(res, err, 'Could not file that photograph');
  }
});

/** The department a filed document or photograph sits in; one filed nowhere is Engineering's, as site photographs are. */
function evidenceDepartment(project: DdProject, evidenceId: string): DepartmentKey {
  const key = project.evidence.find((e) => e.id === evidenceId)?.workstream?.split('.')[0];
  return DEPARTMENTS.some((d) => d.key === key) ? (key as DepartmentKey) : 'construction';
}

/** Choose whether a filed photograph prints in the report on its own. */
projectWorkspaceRouter.put<Params & { evidenceId: string }>('/evidence/:evidenceId/in-report', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, evidenceDepartment(project, req.params.evidenceId), 'edit')) return;
  const parsed = z.object({ inReport: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say whether the photograph is in the report.' });
    return;
  }
  try {
    setPhotoInReport(project, req.params.evidenceId, parsed.data.inReport, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not change that photograph');
  }
});

/** Accept, correct or write what a photograph shows; `null` clears it. */
projectWorkspaceRouter.put<Params & { evidenceId: string }>('/evidence/:evidenceId/description', async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!allowed(req, res, project, evidenceDepartment(project, req.params.evidenceId), 'edit')) return;
  const parsed = z.object({ text: z.string().max(1200).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send what the photograph shows, or null to clear it.' });
    return;
  }
  try {
    setPhotoDescription(project, req.params.evidenceId, parsed.data.text, actorOf(principalOf(req)));
    touch(project);
    await store.save();
    res.json({ project });
  } catch (err) {
    failed(res, err, 'Could not save that description');
  }
});

