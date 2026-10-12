/**
 * The report day and the kept owner packs of a project
 * (`/api/projects/:projectId/report-day`).
 *
 * GET    /                       the setting, the kept packs, what waits to be issued, and what this person may do
 * PUT    /                       set the report day, or clear it with `{ "clear": true }`
 * POST   /packs                  keep the owner pack for a period as it reads now; with `issue`, issue it in the same step
 * POST   /packs/:packId/refresh  read a waiting pack from the record again
 * POST   /packs/:packId/issue    issue it, under the caller's name
 * POST   /packs/:packId/reopen   return an issued pack to waiting
 *
 * For the firm's own people: somebody working from a grant is answered as if
 * nothing were here (`workspaceOnly`), because a pack is cost, meetings and
 * the checklist on one paper. Reading is any of theirs. Keeping a pack and
 * reading it again is for those who may edit in a department of the project;
 * issuing, reopening and setting the day are for a lead or a signer
 * (`mayIssueOwnerPack`), the Cost Report's rule for issuing and reopening.
 *
 * Nothing here sends a pack to anybody. The people a setting names are the
 * firm's own, checked when it is set and again when the timer tells them.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  REPORT_DAY_LIMITS,
  TIMED_REPORTS,
  actorOf,
  issueOwnerPack,
  keepOwnerPack,
  mayIssueOwnerPack,
  mayPrepareOwnerPack,
  ownerPackPeriod,
  ownerPacksKept,
  reachesEveryProject,
  refreshOwnerPack,
  reopenOwnerPack,
  reportsWaiting,
  setReportDay,
  type DdProject,
} from '@realytica/shared';
import { principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { firmPeopleAmong, reportDayEmailSetUp } from '../cron/report-day';
import { store } from '../store';

type Params = { projectId: string; packId?: string };

export const reportDayRouter = Router({ mergeParams: true });

// The firm's own people only, on a project of their own workspace.
reportDayRouter.use(workspaceOnly);

function projectOf(req: Request, res: Response): DdProject | undefined {
  const project = store.data.projects?.find((held) => held.id === (req.params as Params).projectId);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

function me(req: Request): { email: string; role: ReturnType<typeof principalOf>['role'] } {
  const principal = principalOf(req);
  return { email: principal.email, role: principal.role };
}

function refused(res: Response, ok: boolean, need: string): boolean {
  if (!ok) res.status(403).json({ error: `That needs ${need} in a department of this project.` });
  return !ok;
}

function fail(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Request failed';
  res.status(/^No owner pack by that id/.test(message) ? 404 : 400).json({ error: message });
}

/** The firm's own people, to choose who is told from. */
function firmPeople(project: DdProject): Array<{ email: string; name?: string }> {
  const tenantId = project.tenantId ?? store.data.tenants?.[0]?.id;
  return (store.data.memberships ?? [])
    .filter((member) => member.tenantId === tenantId && reachesEveryProject(member.role))
    .map((member) => ({ email: member.email.toLowerCase(), ...(member.name ? { name: member.name } : {}) }));
}

function shown(req: Request, project: DdProject) {
  return {
    setting: project.reportDay?.setting ?? null,
    packs: ownerPacksKept(project),
    waiting: reportsWaiting(project),
    // Without the mail service a report day still prepares the reports; the people named find them on this page.
    email: reportDayEmailSetUp(),
    people: firmPeople(project),
    mayPrepare: mayPrepareOwnerPack(project, me(req)),
    mayIssue: mayIssueOwnerPack(project, me(req)),
  };
}

async function saved(project: DdProject): Promise<void> {
  project.updatedAt = new Date().toISOString();
  await store.save();
}

reportDayRouter.get('/', (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  res.json(shown(req, project));
});

const settingSchema = z.union([
  z.object({ clear: z.literal(true) }).strict(),
  z
    .object({
      day: z.number().int().min(1).max(31),
      reports: z.array(z.enum(TIMED_REPORTS as [string, ...string[]])).min(1).max(TIMED_REPORTS.length),
      every: z.enum(['month', 'quarter']),
      quarters: z.enum(['financial', 'calendar']).optional(),
      tell: z.array(z.string().trim().email().max(200)).max(REPORT_DAY_LIMITS.tell),
    })
    .strict(),
]);

reportDayRouter.put('/', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  if (refused(res, mayIssueOwnerPack(project, me(req)), 'a lead or a signer')) return;
  const parsed = settingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give a day of the month (1 to 31), which reports, monthly or quarterly, and who is told.' });
    return;
  }
  try {
    if ('clear' in parsed.data) {
      setReportDay(project, null, actorOf(principalOf(req)));
    } else {
      const outside = parsed.data.tell.filter((email) => !firmPeopleAmong(project, [email]).length);
      if (outside.length) {
        res.status(400).json({ error: `Only the firm’s own people are told. Not one of them: ${outside.join(', ')}.` });
        return;
      }
      setReportDay(project, { ...parsed.data, reports: parsed.data.reports as Array<(typeof TIMED_REPORTS)[number]> }, actorOf(principalOf(req)));
    }
    await saved(project);
    res.json({ project, ...shown(req, project) });
  } catch (err) {
    fail(res, err);
  }
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const packSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    quarter: z.string().regex(/^(FY)?\d{4}-Q[1-4]$/).optional(),
    from: day.optional(),
    to: day.optional(),
    issue: z.boolean().optional(),
    name: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((asked) => [asked.month, asked.quarter, asked.from && asked.to].filter(Boolean).length === 1 && (!asked.from || asked.from <= asked.to!), 'one period');

reportDayRouter.post('/packs', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const parsed = packSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Name one period: a month (YYYY-MM), a quarter (FY2026-Q2 or 2026-Q3), or two days.' });
    return;
  }
  const { issue, name, ...asked } = parsed.data;
  if (refused(res, issue ? mayIssueOwnerPack(project, me(req)) : mayPrepareOwnerPack(project, me(req)), issue ? 'a lead or a signer' : 'a lead, contributor or signer')) return;
  try {
    const actor = actorOf(principalOf(req));
    let pack = keepOwnerPack(project, ownerPackPeriod(asked), actor);
    if (issue) pack = issueOwnerPack(project, pack.id, { actor, name });
    await saved(project);
    res.status(201).json({ project, pack });
  } catch (err) {
    fail(res, err);
  }
});

const signSchema = z.object({ name: z.string().trim().max(120).optional() }).strict();

for (const step of ['refresh', 'issue', 'reopen'] as const) {
  reportDayRouter.post(`/packs/:packId/${step}`, async (req, res) => {
    const project = projectOf(req, res);
    if (!project) return;
    const packId = String((req.params as Params).packId ?? '').slice(0, 80);
    const parsed = signSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Send nothing, or the name you sign with.' });
      return;
    }
    if (refused(res, step === 'refresh' ? mayPrepareOwnerPack(project, me(req)) : mayIssueOwnerPack(project, me(req)), step === 'refresh' ? 'a lead, contributor or signer' : 'a lead or a signer')) return;
    try {
      const actor = actorOf(principalOf(req));
      const pack = step === 'refresh' ? refreshOwnerPack(project, packId, actor) : step === 'issue' ? issueOwnerPack(project, packId, { actor, name: parsed.data.name }) : reopenOwnerPack(project, packId, actor);
      await saved(project);
      res.json({ project, pack });
    } catch (err) {
      fail(res, err);
    }
  });
}
