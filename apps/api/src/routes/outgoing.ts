/**
 * What goes out: letters, replies, requests for information and minutes.
 *
 * On a project (`/api/projects/:projectId/outgoing`):
 *
 * GET    /                     the drafts, whether a model is set up, and whether this person may approve
 * POST   /                     make a draft: its frame and sources from the record, its body by a model where one is set up
 * PUT    /:draftId             a person's change: to whom, the subject, the body
 * POST   /:draftId/write       ask the model for a body, for a draft that has none
 * POST   /:draftId/approve     approve it for sending, by name
 * POST   /:draftId/reopen      take the approval back
 * POST   /:draftId/exported    a Word file of it is about to be handed over
 *
 * The last three carry the draft as the person was shown it (`seen`). Where
 * the draft has changed since, the answer is 409 and nothing is done: an
 * approval is of the words a person read.
 * DELETE /:draftId
 *
 * For the firm's own people: somebody working from a grant is answered as if
 * nothing were here (`workspaceOnly`). Making and changing a draft is for
 * those who may change a record. Approving one is for a lead or a signer on
 * the project (`mayApproveOutgoing`), and the approval carries their name.
 *
 * Nothing here sends anything, and nothing here changes a paper, a decision
 * or an action. A draft is kept on the project beside them.
 *
 * `outgoingAskedWritten` is the one step the chat's route takes for a draft
 * asked for in the chat: the chat's rules make the draft and open it, and
 * this writes its body and says how it stands.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  OUTGOING_BODY,
  OUTGOING_CHANGED,
  OUTGOING_DRAFT,
  OUTGOING_KINDS,
  OUTGOING_KIND_LABEL,
  actorOf,
  addPaperPassages,
  approveOutgoing,
  can,
  editOutgoing,
  mayApproveOutgoing,
  noteOutgoingExported,
  outgoingAboutSaid,
  outgoingBodyHeld,
  outgoingOf,
  outgoingPaperFile,
  outgoingSaid,
  removeOutgoing,
  reopenOutgoing,
  setOutgoingBody,
  startOutgoing,
  type DdProject,
  type OutgoingDraft,
  type ProjectChatResult,
} from '@realytica/shared';
import { outgoingModelSetUp, writeOutgoingBodyByModel } from '@realytica/agents';
import { needs, principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { loadPageTexts } from '../documents/page-text';
import { store } from '../store';

/** A kind as a model is told it. */
const KIND_TOLD: Record<OutgoingDraft['kind'], string> = { letter: 'a letter', reply: 'a reply to a paper the office received', rfi: 'a request for information', minutes: 'minutes' };

/**
 * Fills a draft that was just made: the words of the paper it answers go
 * among its sources, and a model writes its body where one is set up, held
 * to those sources. Minutes are left as code wrote them. Says whether a
 * model is set up, and whether it was asked and wrote nothing.
 *
 * The draft is found again by its id after each wait: a model takes a
 * while, and the project may have been read afresh from storage meanwhile.
 */
export async function fillOutgoingDraft(project: DdProject, draftId: string): Promise<{ model: boolean; failed: boolean }> {
  const model = outgoingModelSetUp();
  const held = () => outgoingOf(project).find((draft) => draft.id === draftId);
  let draft = held();
  if (!draft || draft.kind === 'minutes' || draft.body.trim()) return { model, failed: false };
  const paper = outgoingPaperFile(project, draft);
  if (paper) {
    const kept = await loadPageTexts(project.id, paper.storageKey);
    const pages = (kept?.pages ?? []).filter((page) => page.text.trim()).map((page) => ({ page: page.page, text: page.text, scanned: page.reader === 'ocr' }));
    draft = held();
    if (draft && pages.length) {
      addPaperPassages(draft, paper.row, pages);
      project.updatedAt = new Date().toISOString();
    }
  }
  if (!draft || !model) return { model, failed: false };
  const said = await writeOutgoingBodyByModel({
    kind: KIND_TOLD[draft.kind],
    to: draft.to,
    subject: draft.subject,
    about: outgoingAboutSaid(project, draft.about),
    asked: draft.asked,
    // What waits on the record is never handed over: a letter cannot state it.
    sources: draft.sources.filter((source) => !source.waiting).map((source) => ({ n: source.n, from: `${source.title}${source.page ? `, page ${source.page}` : ''}`, says: source.passage ? `“${source.says}”` : source.says })),
    caseId: project.id,
  });
  draft = held();
  if (!draft) return { model, failed: false };
  const body = said ? outgoingBodyHeld(said, draft.sources) : '';
  if (!body) return { model, failed: true };
  setOutgoingBody(project, draft.id, body);
  return { model, failed: false };
}

/**
 * The chat's step for a draft its rules just made: write the body, and put
 * how the draft now stands in place of the line the rules said before any of
 * it was written. A turn that made no draft is left as it is.
 */
export async function outgoingAskedWritten(project: DdProject, result: ProjectChatResult, line: (payload: unknown) => void): Promise<void> {
  if (!result.assistantTurn.toolCalls?.some((call) => call.name === OUTGOING_DRAFT)) return;
  const draftId = result.navigations.find((go) => go.target === 'outgoing')?.item;
  const made = outgoingOf(project).find((held) => held.id === draftId);
  if (!made) return;
  if (made.kind !== 'minutes' && outgoingModelSetUp()) line({ type: 'step', step: { id: randomUUID(), at: new Date().toISOString(), kind: 'tool_call', label: 'Writing the draft from the record' } });
  const how = await fillOutgoingDraft(project, made.id);
  const draft = outgoingOf(project).find((held) => held.id === draftId);
  if (!draft) return;
  const text = outgoingSaid(project, draft, how);
  result.assistantTurn.text = text;
  const kept = project.conversation.find((turn) => turn.id === result.assistantTurn.id);
  if (kept) kept.text = text;
}

/* ==================================================================== */
/* The routes                                                            */
/* ==================================================================== */

type Params = { projectId: string; draftId?: string };

export const outgoingRouter = Router({ mergeParams: true });

// The firm's own people only, on a project of their own workspace.
outgoingRouter.use(workspaceOnly);

// Reading the drafts is any of them's. Making, changing and approving one is for those who may change a record.
outgoingRouter.use((req, res, next) => {
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

function fail(res: Response, err: unknown, status = 400): void {
  const message = err instanceof Error ? err.message : 'Request failed';
  // A draft that changed after the person opened it is a conflict: the page reads it again.
  res.status(/^No draft by that id/.test(message) ? 404 : message.startsWith(OUTGOING_CHANGED) ? 409 : status).json({ error: message });
}

/** The draft as the person acting was shown it (`outgoingSeen`), as their page sent it. One that sends none was shown nothing this can vouch for. */
function seenBy(req: Request): string {
  const seen = (req.body as { seen?: unknown } | undefined)?.seen;
  return typeof seen === 'string' ? seen : '';
}

/** The drafts as one person is shown them: with whether a model is set up, and what this person may do. */
function shown(req: Request, project: DdProject) {
  const me = principalOf(req);
  return { drafts: outgoingOf(project), model: outgoingModelSetUp(), mayDraft: can(me.role, 'write'), mayApprove: mayApproveOutgoing(project, { email: me.email, role: me.role }) };
}

outgoingRouter.get('/', (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  res.json(shown(req, project));
});

const about = z.object({ kind: z.enum(['paper', 'meeting', 'action']), id: z.string().min(1).max(120) });

outgoingRouter.post('/', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z
    .object({ kind: z.enum(OUTGOING_KINDS as [string, ...string[]]), about: about.optional(), to: z.string().max(200).optional(), subject: z.string().max(300).optional(), topic: z.string().max(400).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say what to draft: a letter, a reply, a request for information or minutes, and what it is about.' });
    return;
  }
  let draft: OutgoingDraft;
  try {
    draft = startOutgoing(project, { ...parsed.data, kind: parsed.data.kind as OutgoingDraft['kind'] }, actorOf(principalOf(req)));
  } catch (err) {
    fail(res, err);
    return;
  }
  // On the record before a model is asked: a draft that waits on a model is still a draft that was made.
  await store.save();
  const how = await fillOutgoingDraft(project, draft.id);
  await store.save();
  res.status(201).json({ ...shown(req, project), draftId: draft.id, ...(how.failed ? { said: 'The model did not answer, so nothing was written. The sources are laid out to write from.' } : {}) });
});

outgoingRouter.put('/:draftId', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = z.object({ to: z.string().max(200).optional(), subject: z.string().max(300).optional(), body: z.string().max(OUTGOING_BODY * 2).optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send who it is to, its subject, or its body.' });
    return;
  }
  try {
    editOutgoing(project, (req.params as Params).draftId ?? '', parsed.data, actorOf(principalOf(req)));
  } catch (err) {
    fail(res, err);
    return;
  }
  await store.save();
  res.json(shown(req, project));
});

outgoingRouter.post('/:draftId/write', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const draft = outgoingOf(project).find((held) => held.id === (req.params as Params).draftId);
  if (!draft) {
    res.status(404).json({ error: 'No draft by that id.' });
    return;
  }
  if (draft.body.trim()) {
    res.status(409).json({ error: 'This draft has a body already. A model does not write over a person’s words.' });
    return;
  }
  const how = await fillOutgoingDraft(project, draft.id);
  await store.save();
  res.json({ ...shown(req, project), ...(how.failed ? { said: 'The model did not answer, so nothing was written.' } : !how.model ? { said: 'No model is set up.' } : {}) });
});

outgoingRouter.post('/:draftId/approve', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const me = principalOf(req);
  if (!mayApproveOutgoing(project, { email: me.email, role: me.role })) {
    res.status(403).json({ error: 'A lead or a signer on this project approves what goes out.' });
    return;
  }
  try {
    approveOutgoing(project, (req.params as Params).draftId ?? '', { actor: actorOf(me), ...(me.name ? { name: me.name } : {}), seen: seenBy(req) });
  } catch (err) {
    fail(res, err, 409);
    return;
  }
  await store.save();
  res.json(shown(req, project));
});

outgoingRouter.post('/:draftId/reopen', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    reopenOutgoing(project, (req.params as Params).draftId ?? '', { actor: actorOf(principalOf(req)), seen: seenBy(req) });
  } catch (err) {
    fail(res, err);
    return;
  }
  await store.save();
  res.json(shown(req, project));
});

outgoingRouter.post('/:draftId/exported', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    const draft = noteOutgoingExported(project, (req.params as Params).draftId ?? '', { actor: actorOf(principalOf(req)), seen: seenBy(req) });
    await store.save();
    res.json({ noted: `${OUTGOING_KIND_LABEL[draft.kind]} exported` });
  } catch (err) {
    fail(res, err);
  }
});

outgoingRouter.delete('/:draftId', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  try {
    removeOutgoing(project, (req.params as Params).draftId ?? '', actorOf(principalOf(req)));
  } catch (err) {
    fail(res, err);
    return;
  }
  await store.save();
  res.json(shown(req, project));
});
