/**
 * An empty form, filled from the record.
 *
 * On a project (`/api/projects/:projectId/templates`):
 *
 * GET    /                     the templates this person may read, whether a model is set up, and what they may do
 * POST   /                     take in a Word file or a workbook (multipart `file`, `department`, `title`): find its blanks
 * GET    /:templateId          one template: each blank as it stands, and what the record offers for each one still open
 * PUT    /:templateId/fields   decide blanks: accept what is offered, type a value, leave blank, or take a decision back
 * GET    /:templateId/file     `?kind=filled` the same file filled, `sources` the list of sources (PDF), `original` as it was sent
 * DELETE /:templateId
 *
 * For the firm's own people: somebody working from a grant is answered as if
 * nothing were here (`workspaceOnly`). A template's offers are drawn from
 * every paper on the file, each with the paper, the page and its words, as a
 * questionnaire's answers are, and a questionnaire is not shown to them
 * either. Within the firm a template belongs to one department, and that
 * department's roles govern it as they govern a questionnaire: anybody with a
 * place there reads it and takes the files out, a lead, contributor or
 * signer takes one in and decides its blanks, and a lead or signer removes
 * one.
 *
 * Nothing here writes a value into a form on a model's word. A model, where
 * one is set up, says only which of the record's values a blank asks for,
 * and only for a blank whose label the rules could not read. The value is
 * read from the record by code, with its source, and it is written into the
 * file only after a person accepts it, with their name. A blank nobody has
 * decided goes back empty.
 *
 * The templates are kept in a document of their own in the project's
 * storage, beside the file each came from, and not in the project's own
 * document: that is read on every request and rewritten whole on a save.
 * They go when the project goes.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  DEPARTMENTS,
  TEMPLATE_KEYS,
  TEMPLATE_LIMITS,
  actorOf,
  decideTemplateFields,
  departmentRole,
  keepTemplateAsks,
  newTemplate,
  noteTemplateFilled,
  noteTemplateRemoved,
  roleCanDecide,
  roleCanEdit,
  templateDepartment,
  templateFieldsToAsk,
  templateView,
  type DdProject,
  type DepartmentKey,
  type DepartmentRole,
  type FillTemplate,
  type TemplateDecision,
} from '@realytica/shared';
import { nameTemplateBlanksByModel, templateModelSetUp } from '@realytica/agents';
import { needs, principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { TEMPLATE_FILE_SAID, TEMPLATE_MIME, TemplateTooLarge, detectTemplateFields, filledTemplateFile, templateFormatOf, templateSourcesPdf } from '../documents/template-file';
import { storageAdapter } from '../storage';
import { store } from '../store';
import { withSentFileName } from '../uploads';
import { documentDisposition } from './document-file';

/* ==================================================================== */
/* Where they are kept                                                   */
/* ==================================================================== */

const INDEX_KEY = 'fill-templates.json';
const fileKeyOf = (templateId: string, format: string): string => `fill-template-${templateId}.${format}`;

/** A project's templates. A document that cannot be read is not an empty list: saying so keeps the next save from writing over it. */
export async function loadTemplates(projectId: string): Promise<FillTemplate[]> {
  const bytes = await storageAdapter.getDocument(projectId, INDEX_KEY);
  if (!bytes) return [];
  try {
    const kept = JSON.parse(bytes.toString('utf8')) as { templates?: unknown };
    return Array.isArray(kept.templates) ? (kept.templates as FillTemplate[]).filter((t) => t && typeof t.id === 'string' && Array.isArray(t.fields)) : [];
  } catch {
    throw new Error('The templates on this project could not be read.');
  }
}

async function saveTemplates(projectId: string, templates: readonly FillTemplate[]): Promise<void> {
  await storageAdapter.putDocument(projectId, INDEX_KEY, Buffer.from(JSON.stringify({ v: 1, templates })), 'application/json');
}

/* ==================================================================== */
/* The routes                                                            */
/* ==================================================================== */

type Params = { projectId: string; templateId?: string };

export const templatesRouter = Router({ mergeParams: true });

// The firm's own people only, on a project of their own workspace.
templatesRouter.use(workspaceOnly);

// Reading is any of them's with a place in the department. Anything else is for those who may change a record.
templatesRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  needs('write')(req, res, next);
});

function projectOf(req: Request, res: Response): DdProject | undefined {
  const project = store.data.projects?.find((held) => held.id === (req.params as Params).projectId);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

function roleIn(req: Request, project: DdProject, department: DepartmentKey): DepartmentRole | undefined {
  const me = principalOf(req);
  return departmentRole(project, { email: me.email, workspaceRole: me.role }, department);
}

/** The department gate, as a questionnaire's: a refusal says which department. */
function allowed(req: Request, res: Response, project: DdProject, department: DepartmentKey, need: 'read' | 'edit' | 'decide'): boolean {
  const role = roleIn(req, project, department);
  const ok = need === 'read' ? Boolean(role) : need === 'edit' ? roleCanEdit(role) : roleCanDecide(role);
  if (!ok) res.status(403).json({ error: need === 'read' ? `That needs a place in ${department}.` : `That needs a ${need === 'edit' ? 'lead, contributor or signer' : 'lead or signer'} in ${department}.` });
  return ok;
}

function fail(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : fallback;
  res.status(err instanceof TemplateTooLarge ? 413 : 400).json({ error: message });
}

/** One template of the project, or a 404 said. */
async function templateOf(req: Request, res: Response, project: DdProject): Promise<{ all: FillTemplate[]; template: FillTemplate } | undefined> {
  const all = await loadTemplates(project.id);
  const template = all.find((t) => t.id === (req.params as Params).templateId);
  if (!template) {
    res.status(404).json({ error: 'No template by that id.' });
    return undefined;
  }
  return { all, template };
}

const departmentSchema = z.enum(DEPARTMENTS.map((d) => d.key) as [DepartmentKey, ...DepartmentKey[]]);

templatesRouter.get('/', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const asked = departmentSchema.optional().safeParse(typeof req.query.department === 'string' ? req.query.department : undefined);
  if (!asked.success) {
    res.status(400).json({ error: 'No such department.' });
    return;
  }
  try {
    const mine = (await loadTemplates(project.id)).filter((t) => (!asked.data || templateDepartment(t) === asked.data) && roleIn(req, project, templateDepartment(t)));
    res.json({
      templates: mine.map((t) => {
        const { rows: _rows, ...shown } = templateView(project, t);
        return shown;
      }),
      model: templateModelSetUp(),
    });
  } catch (err) {
    fail(res, err, 'Could not read the templates');
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TEMPLATE_LIMITS.fileBytes, files: 1, fields: 4, fieldSize: 400 }, fileFilter: withSentFileName });

templatesRouter.post('/', upload.single('file'), async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const asked = departmentSchema.safeParse(req.body?.department ?? 'construction');
  if (!asked.success) {
    res.status(400).json({ error: 'No such department.' });
    return;
  }
  const department = asked.data;
  if (!allowed(req, res, project, department, 'edit')) return;
  const file = req.file as Express.Multer.File | undefined;
  const named = z.string().trim().max(160).optional().safeParse(req.body?.title);
  if (!file || !templateFormatOf(file.originalname) || !named.success) {
    res.status(400).json({ error: TEMPLATE_FILE_SAID });
    return;
  }
  try {
    const all = await loadTemplates(project.id);
    if (all.length >= TEMPLATE_LIMITS.perProject) {
      res.status(400).json({ error: `A project holds ${TEMPLATE_LIMITS.perProject} templates at most. Remove one that is done with first.` });
      return;
    }
    const { format, detected } = await detectTemplateFields(file);
    const actor = actorOf(principalOf(req));
    const title = named.data || file.originalname.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
    const template = newTemplate(project, { title, department, fileName: file.originalname.slice(0, 200), format, fileKey: '', detected }, actor);
    template.fileKey = fileKeyOf(template.id, format);
    // The file is kept as it was sent: every filled copy is made from it.
    await storageAdapter.putDocument(project.id, template.fileKey, file.buffer, TEMPLATE_MIME[format]);
    // A model, where one is set up, says what the blanks the rules could not read ask for. Never a value.
    const toAsk = templateFieldsToAsk(template);
    if (toAsk.length && templateModelSetUp()) {
      keepTemplateAsks(template, toAsk, await nameTemplateBlanksByModel({ blanks: toAsk.map((f) => ({ label: f.label, context: f.context })), keys: TEMPLATE_KEYS, caseId: project.id }));
    }
    // Read again: a model takes a while, and somebody else may have taken one in meanwhile.
    const now = await loadTemplates(project.id);
    await saveTemplates(project.id, [...now, template]);
    await store.save();
    res.status(201).json({ template: templateView(project, template), model: templateModelSetUp() });
  } catch (err) {
    fail(res, err, 'Could not read that template');
  }
});

templatesRouter.get('/:templateId', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    const held = await templateOf(req, res, project);
    if (!held || !allowed(req, res, project, templateDepartment(held.template), 'read')) return;
    const role = roleIn(req, project, templateDepartment(held.template));
    res.json({ template: templateView(project, held.template), model: templateModelSetUp(), mayEdit: roleCanEdit(role), mayDecide: roleCanDecide(role) });
  } catch (err) {
    fail(res, err, 'Could not read that template');
  }
});

const fieldId = z.string().min(1).max(80);
const decisionSchema = z.discriminatedUnion('decision', [
  z.object({ fieldId, decision: z.literal('accept'), value: z.string().max(TEMPLATE_LIMITS.valueChars).optional() }),
  z.object({ fieldId, decision: z.literal('type'), value: z.string().trim().min(1).max(TEMPLATE_LIMITS.valueChars) }),
  z.object({ fieldId, decision: z.literal('blank') }),
  z.object({ fieldId, decision: z.literal('reopen') }),
]);
const decisionsSchema = z.object({ decisions: z.array(decisionSchema).min(1).max(TEMPLATE_LIMITS.decisions) });

templatesRouter.put('/:templateId/fields', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = decisionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which blanks, and for each: accept, type a value, blank, or reopen.' });
    return;
  }
  try {
    const held = await templateOf(req, res, project);
    if (!held || !allowed(req, res, project, templateDepartment(held.template), 'edit')) return;
    decideTemplateFields(project, held.template, parsed.data.decisions as TemplateDecision[], actorOf(principalOf(req)));
    await saveTemplates(project.id, held.all);
    await store.save();
    res.json({ template: templateView(project, held.template) });
  } catch (err) {
    fail(res, err, 'Could not keep those decisions');
  }
});

templatesRouter.get('/:templateId/file', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const kind = z.enum(['filled', 'sources', 'original']).safeParse(req.query.kind ?? 'filled');
  if (!kind.success) {
    res.status(400).json({ error: 'Ask for the filled file, its sources, or the original.' });
    return;
  }
  try {
    const held = await templateOf(req, res, project);
    if (!held || !allowed(req, res, project, templateDepartment(held.template), 'read')) return;
    const { template } = held;
    const stem = template.fileName.replace(/\.[a-z0-9]+$/i, '');
    if (kind.data === 'sources') {
      const pdf = await templateSourcesPdf(project, template);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', documentDisposition(false, `${stem} - sources.pdf`));
      res.send(pdf);
      return;
    }
    const original = await storageAdapter.getDocument(project.id, template.fileKey);
    if (!original) {
      res.status(404).json({ error: 'The file this template came from was not kept. Upload it again.' });
      return;
    }
    const bytes = kind.data === 'original' ? original : await filledTemplateFile(template, original);
    if (kind.data === 'filled') {
      // A filled file leaving the office is on the trail: who took it out, and with how many values.
      noteTemplateFilled(project, template, actorOf(principalOf(req)));
      await store.save();
    }
    res.setHeader('Content-Type', TEMPLATE_MIME[template.format]);
    res.setHeader('Content-Disposition', documentDisposition(false, kind.data === 'original' ? template.fileName : `${stem} - filled.${template.format}`));
    res.send(bytes);
  } catch (err) {
    fail(res, err, 'Could not take that file out');
  }
});

templatesRouter.delete('/:templateId', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    const held = await templateOf(req, res, project);
    if (!held || !allowed(req, res, project, templateDepartment(held.template), 'decide')) return;
    await saveTemplates(
      project.id,
      held.all.filter((t) => t.id !== held.template.id),
    );
    await Promise.resolve(storageAdapter.deleteDocument(project.id, held.template.fileKey)).catch(() => undefined);
    noteTemplateRemoved(project, held.template, actorOf(principalOf(req)));
    await store.save();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'Could not remove the template');
  }
});
