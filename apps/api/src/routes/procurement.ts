/**
 * Procurement › Tenders: each work package from tender papers to a signed
 * contract.
 *
 * On a project (`/api/projects/:projectId/procurement`):
 *
 * GET    /                                        the tenders, each with its standing and its bids compared, and what waits on Finance
 * POST   /tenders                                 start the tender for a work package
 * PATCH  /tenders/:tenderId                       set or clear the pre-tender estimate
 * DELETE /tenders/:tenderId                       take it off, while it has no letter of acceptance
 * PUT    /tenders/:tenderId/stages/:stage         a stage's date, who it is with, the day it was done, or that it is not needed
 * POST   /tenders/:tenderId/bidders               add a bidder
 * PATCH  /tenders/:tenderId/bidders/:bidderId     what they quoted, revised, qualified and left out, and their priced items
 * DELETE /tenders/:tenderId/bidders/:bidderId
 * PUT    /tenders/:tenderId/recommendation        a person's recommendation, under their name
 * POST   /tenders/:tenderId/letter-of-acceptance  record the letter: it offers the awarded value to Finance as PO issued
 * DELETE /tenders/:tenderId/letter-of-acceptance  take the letter back, while Finance has not accepted
 * POST   /tenders/:tenderId/offer/accept          Finance accepts: PO issued is written on the draft Cost Report
 * POST   /tenders/:tenderId/offer/decline         Finance declines, with the reason
 * POST   /tenders/:tenderId/offer/again           offer a declined value again
 * POST   /variations/:variationId/offer/accept    Finance takes an approved variation onto the draft Cost Report
 * POST   /variations/:variationId/offer/decline   Finance declines it, with the reason
 *
 * Who may. Bidders and what they quoted are commercially sensitive, so the
 * whole path answers 404 to somebody working from a grant that does not name
 * Procurement, as it does to somebody outside the workspace. Past that:
 * stages, bidders and the estimate take a lead, contributor or signer in
 * Procurement. The recommendation, the letter of acceptance, taking either
 * back and removing a tender take a lead or signer in Procurement. Accepting
 * or declining the offer takes a lead or signer in Finance: Procurement
 * offers a figure to the Cost Report and does not write it.
 *
 * Every answer that carries the project carries the caller's own copy of it
 * (`redactResponses`).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  DEPARTMENT_SHORT,
  TENDER_BID_FLAG_PERCENT,
  TENDER_LIMITS,
  TENDER_LINE_FLAG_PERCENT,
  TENDER_STAGES,
  acceptTenderOffer,
  acceptVariationOffer,
  actorOf,
  addTenderBidder,
  declineTenderOffer,
  declineVariationOffer,
  departmentRole,
  grantNamesProcurement,
  recommendTender,
  recordLetterOfAcceptance,
  removeTender,
  removeTenderBidder,
  reofferTender,
  roleCanDecide,
  roleCanEdit,
  setTenderEstimate,
  setTenderStage,
  startTender,
  tenderComparison,
  tenderOffersWaiting,
  variationOffersWaiting,
  tenderPackageName,
  tenderStanding,
  tendersOf,
  updateTenderBidder,
  withdrawLetterOfAcceptance,
  type DdProject,
  type DepartmentKey,
  type TenderStageKey,
} from '@realytica/shared';
import { accessTo, projectFor } from '../auth/access';
import { needs, principalOf } from '../auth/middleware';
import { gateWrites, redactResponses } from '../auth/project-guard';
import { store } from '../store';

type Params = { projectId: string; tenderId?: string; bidderId?: string; stage?: string };

export const procurementRouter = Router({ mergeParams: true });

function findProject(req: Request): DdProject | undefined {
  return store.data.projects?.find((held) => held.id === (req.params as Params).projectId);
}

/*
 * Mounted beside the project routes, not under them, so the gates they
 * inherit are stood here, in the same order: the workspace and the grant,
 * the method, then the copy handed back and the ids a write may name.
 */
procurementRouter.use((req: Request, res: Response, next: NextFunction) => {
  const project = findProject(req);
  const resolved = project ? accessTo(req, project) : undefined;
  if (!project || !resolved?.ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // A grant that does not name Procurement is answered as if nothing were here: that there are tenders is itself what is withheld.
  if (resolved.access.kind === 'granted' && !grantNamesProcurement(resolved.access.grant)) {
    res.status(404).json({ error: 'Not found on this project' });
    return;
  }
  next();
});
procurementRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  needs('write')(req, res, next);
});
procurementRouter.use(redactResponses);
procurementRouter.use(gateWrites);

/** The department gate, as the other department routes ask it: a refusal names the department. */
function allowed(req: Request, res: Response, project: DdProject, department: DepartmentKey, need: 'edit' | 'decide'): boolean {
  const me = principalOf(req);
  const role = departmentRole(project, { email: me.email, workspaceRole: me.role }, department);
  const ok = need === 'edit' ? roleCanEdit(role) : roleCanDecide(role);
  if (!ok) res.status(403).json({ error: `That needs a ${need === 'edit' ? 'lead, contributor or signer' : 'lead or signer'} in ${DEPARTMENT_SHORT[department]}.` });
  return ok;
}

function fail(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Request failed';
  res.status(/^No (tender|bidder|stage|work package|approved variation) by that/.test(message) ? 404 : 400).json({ error: message });
}

/** One write: the gate, the input, the change, the save, and the caller's copy of the project back. */
async function change<T>(
  req: Request,
  res: Response,
  gate: { department: DepartmentKey; need: 'edit' | 'decide' },
  input: { schema: z.ZodType<T>; say: string },
  work: (project: DdProject, body: T, actor: string) => Record<string, unknown> | void,
  status = 200,
): Promise<void> {
  const project = findProject(req);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  if (!allowed(req, res, project, gate.department, gate.need)) return;
  const parsed = input.schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: input.say });
    return;
  }
  let out: Record<string, unknown> | void;
  try {
    out = work(project, parsed.data, actorOf(principalOf(req)));
  } catch (err) {
    fail(res, err);
    return;
  }
  project.updatedAt = new Date().toISOString();
  await store.save();
  res.status(status).json({ project, ...(out ?? {}) });
}

const procurement = (need: 'edit' | 'decide') => ({ department: 'procurement' as const, need });
const finance = { department: 'finance' as const, need: 'decide' as const };
const nothing = { schema: z.object({}).passthrough(), say: 'Nothing is sent with this.' };

const id = z.string().min(1).max(120);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().positive().max(1e13);
const note = z.string().max(TENDER_LIMITS.note);

const tenderOf = (req: Request): string => (req.params as Params).tenderId ?? '';

procurementRouter.get('/', (req, res) => {
  const project = findProject(req);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // Read off the caller's own copy: somebody who is not shown the Cost Report is not told what its row holds.
  const copy = projectFor(req, project);
  const me = principalOf(req);
  const role = (department: DepartmentKey) => departmentRole(project, { email: me.email, workspaceRole: me.role }, department);
  res.json({
    tenders: tendersOf(copy).map((tender) => ({ ...tender, packageName: tenderPackageName(copy, tender), standing: tenderStanding(tender), comparison: tenderComparison(tender) })),
    waitingOnFinance: tenderOffersWaiting(copy).map(({ tender, offer, packageName, bidderName, onto }) => ({ tenderId: tender.id, offer, packageName, bidderName, ...(onto ? { onto } : {}) })),
    // Approved variations Procurement has recorded that Finance has neither taken onto the Cost Report nor declined.
    variationsWaitingOnFinance: variationOffersWaiting(copy),
    flagPastPercent: { bid: TENDER_BID_FLAG_PERCENT, line: TENDER_LINE_FLAG_PERCENT },
    may: { edit: roleCanEdit(role('procurement')), decide: roleCanDecide(role('procurement')), acceptOffer: roleCanDecide(role('finance')) },
  });
});

procurementRouter.post('/tenders', (req, res) =>
  change(
    req,
    res,
    procurement('edit'),
    { schema: z.object({ workPackageId: id, estimate: money.optional() }), say: 'Name the work package, and the estimate if there is one.' },
    (project, body, actor) => ({ tender: startTender(project, body, actor) }),
    201,
  ),
);

procurementRouter.patch('/tenders/:tenderId', (req, res) =>
  change(req, res, procurement('edit'), { schema: z.object({ estimate: money.nullable() }), say: 'Send the estimate, or null to clear it.' }, (project, body, actor) => ({ tender: setTenderEstimate(project, tenderOf(req), body.estimate, actor) })),
);

procurementRouter.delete('/tenders/:tenderId', (req, res) => change(req, res, procurement('decide'), nothing, (project, _body, actor) => removeTender(project, tenderOf(req), actor)));

const stagePatch = z
  .object({ dueOn: day.nullable().optional(), owner: z.string().max(TENDER_LIMITS.owner).nullable().optional(), doneOn: day.nullable().optional(), notNeeded: z.boolean().optional() })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined));

procurementRouter.put('/tenders/:tenderId/stages/:stage', (req, res) => {
  const stage = (req.params as Params).stage as TenderStageKey;
  if (!TENDER_STAGES.includes(stage)) {
    res.status(404).json({ error: 'No stage by that name.' });
    return;
  }
  return change(req, res, procurement('edit'), { schema: stagePatch, say: 'Send a date (YYYY-MM-DD), who it is with, the day it was done, or that it is not needed.' }, (project, body, actor) => ({
    stage: setTenderStage(project, tenderOf(req), stage, body, actor),
  }));
});

const bidLines = z.array(z.object({ item: z.string().trim().min(1).max(TENDER_LIMITS.name), amount: money })).max(TENDER_LIMITS.lines);
const bidder = z.object({ name: z.string().trim().min(1).max(TENDER_LIMITS.name), quoted: money.optional(), revised: money.optional(), qualifications: note.optional(), exclusions: note.optional(), lines: bidLines.optional() });
const bidderPatch = z
  .object({ name: z.string().trim().min(1).max(TENDER_LIMITS.name).optional(), quoted: money.nullable().optional(), revised: money.nullable().optional(), qualifications: note.nullable().optional(), exclusions: note.nullable().optional(), lines: bidLines.nullable().optional() })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined));
const BIDDER_SAID = 'Give the bidder’s name, and what they quoted, revised, qualified or left out. Amounts are numbers, more than nothing.';

procurementRouter.post('/tenders/:tenderId/bidders', (req, res) =>
  change(req, res, procurement('edit'), { schema: bidder, say: BIDDER_SAID }, (project, body, actor) => ({ bidder: addTenderBidder(project, tenderOf(req), body, actor) }), 201),
);

procurementRouter.patch('/tenders/:tenderId/bidders/:bidderId', (req, res) =>
  change(req, res, procurement('edit'), { schema: bidderPatch, say: BIDDER_SAID }, (project, body, actor) => ({ bidder: updateTenderBidder(project, tenderOf(req), (req.params as Params).bidderId ?? '', body, actor) })),
);

procurementRouter.delete('/tenders/:tenderId/bidders/:bidderId', (req, res) =>
  change(req, res, procurement('edit'), nothing, (project, _body, actor) => removeTenderBidder(project, tenderOf(req), (req.params as Params).bidderId ?? '', actor)),
);

procurementRouter.put('/tenders/:tenderId/recommendation', (req, res) =>
  change(req, res, procurement('decide'), { schema: z.object({ bidderId: id, text: z.string().trim().min(1).max(TENDER_LIMITS.text) }), say: 'Name the bidder recommended, and say why.' }, (project, body, actor) => ({
    recommendation: recommendTender(project, tenderOf(req), body, actor),
  })),
);

procurementRouter.post('/tenders/:tenderId/letter-of-acceptance', (req, res) =>
  change(
    req,
    res,
    procurement('decide'),
    { schema: z.object({ bidderId: id, value: money, letterOn: day, evidenceId: id.optional() }), say: 'Name the bidder, the awarded value and the day of the letter (YYYY-MM-DD).' },
    (project, body, actor) => ({ tender: recordLetterOfAcceptance(project, tenderOf(req), body, actor) }),
    201,
  ),
);

procurementRouter.delete('/tenders/:tenderId/letter-of-acceptance', (req, res) =>
  change(req, res, procurement('decide'), nothing, (project, _body, actor) => ({ tender: withdrawLetterOfAcceptance(project, tenderOf(req), actor) })),
);

procurementRouter.post('/tenders/:tenderId/offer/accept', (req, res) => change(req, res, finance, nothing, (project, _body, actor) => ({ offer: acceptTenderOffer(project, tenderOf(req), actor) })));

procurementRouter.post('/tenders/:tenderId/offer/decline', (req, res) =>
  change(req, res, finance, { schema: z.object({ reason: z.string().trim().min(1).max(TENDER_LIMITS.note) }), say: 'Say why it is declined.' }, (project, body, actor) => ({ offer: declineTenderOffer(project, tenderOf(req), body.reason, actor) })),
);

procurementRouter.post('/tenders/:tenderId/offer/again', (req, res) => change(req, res, procurement('decide'), nothing, (project, _body, actor) => ({ offer: reofferTender(project, tenderOf(req), actor) })));

/* An approved variation moves PO issued and the anticipated cost only when a lead or signer in Finance takes it: Procurement approves, and does not write the Cost Report. */
const variationOf = (req: Request): string => (req.params as Params & { variationId?: string }).variationId ?? '';

procurementRouter.post('/variations/:variationId/offer/accept', (req, res) =>
  change(req, res, finance, { schema: z.object({ forecast: z.enum(['add', 'already_in']).optional() }), say: 'Say whether the forecast carries it already, or send nothing.' }, (project, body, actor) => ({
    decision: acceptVariationOffer(project, variationOf(req), actor, body.forecast ? { forecast: body.forecast } : {}),
  })),
);

procurementRouter.post('/variations/:variationId/offer/decline', (req, res) =>
  change(req, res, finance, { schema: z.object({ reason: z.string().trim().min(1).max(TENDER_LIMITS.note) }), say: 'Say why it is declined.' }, (project, body, actor) => ({ decision: declineVariationOffer(project, variationOf(req), body.reason, actor) })),
);
