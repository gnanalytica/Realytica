/**
 * The report day, as the daily timer runs it.
 *
 * `reportDay(now)` goes through every project that has set a report day
 * (`report-day.ts` in the shared package). On the day, in India time, it
 * prepares the status report, the owner pack or both for the period just
 * ended, each waiting to be issued, writes the project, and tells the people
 * the setting names that there is something to check. It issues nothing and
 * sends nothing to an owner: the people told are the firm's own, and an
 * address that is not one of theirs any more is passed over.
 *
 * Safe to run twice. What was prepared is kept on the project by its kind
 * and period, so a second run on the day prepares nothing; who was told is
 * kept beside it, so a second run tells nobody again, and a run that wrote
 * the reports and died before telling anybody is finished by the next. The
 * email carries a key the mail service refuses a second copy of for a day.
 *
 * A project is re-read from storage first, as the alert sweep does, and one
 * project failing is counted and leaves the rest to run. It never throws.
 *
 * Email goes through Resend when `REALYTICA_RESEND_API_KEY` is set, and a
 * push to the phones those people paired. With neither, the reports are
 * prepared all the same and wait on the Reports page, and the count of
 * people told is 0.
 */

import { readEnv } from '@realytica/agents';
import { noteReportsTold, prepareReportsDue, reachesEveryProject, reportPeriodDue, reportsReadySaid, sameEmail, type DdProject, type PreparedReport } from '@realytica/shared';
import { store } from '../store';

const SEND_TIMEOUT_MS = 6_000;

/** Whether this deployment can send the email a report day tells people by. */
export function reportDayEmailSetUp(): boolean {
  return Boolean(readEnv('RESEND_API_KEY'));
}

/** What a run reads projects from, writes them to and tells people through: the store and the mail service, or stand-ins under test. */
export interface ReportDaySource {
  ids(): string[];
  /** The project as storage has it now. Throws when storage did not answer. */
  fresh(id: string): Promise<DdProject | undefined>;
  /** Write the project, resolving once it is durable. */
  save(project: DdProject): Promise<void>;
  /** Of these addresses, the firm's own people on this project's workspace as it stands now. */
  ownPeople(project: DdProject, emails: readonly string[]): string[];
  /** Tell these people the reports are ready to check. Returns the ones who were told. */
  tell(project: DdProject, lines: readonly PreparedReport[], to: readonly string[]): Promise<string[]>;
}

async function post(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Email and push, as alerts go out (`notify.ts`). Each person is told once whichever way reached them. */
export async function tellReportsReady(project: DdProject, lines: readonly PreparedReport[], to: readonly string[]): Promise<string[]> {
  if (!to.length || !lines.length) return [];
  const said = reportsReadySaid(project, lines);
  const link = `${readEnv('APP_URL')?.replace(/\/+$/, '') ?? 'https://realytica.gnanalytica.com'}/projects/${project.id}/reports`;
  const told = new Set<string>();
  const key = readEnv('RESEND_API_KEY');
  if (key) {
    try {
      const res = await post(
        'https://api.resend.com/emails',
        { from: readEnv('ALERT_FROM') ?? 'Realytica <alerts@gnanalytica.com>', to: [...to], subject: said.subject, text: `${said.text}\n\n${link}` },
        // The service keeps a key for a day and sends one email for it, so a second run cannot send a second.
        { authorization: `Bearer ${key}`, 'idempotency-key': `report-day/${project.id}/${lines.map((line) => `${line.kind}:${line.from.slice(0, 10)}`).join(',')}`.slice(0, 256) },
      );
      if (res.ok) for (const email of to) told.add(email);
      else console.warn(`[cron] report day email for ${project.id} was refused: ${res.status}`);
    } catch (err) {
      console.warn(`[cron] report day email for ${project.id} failed: ${(err as Error).message}`);
    }
  }
  const devices = (store.data.devices ?? []).filter((device) => !device.revokedAt && device.pushToken && to.some((email) => sameEmail(email, device.email)));
  if (devices.length) {
    try {
      const expo = readEnv('EXPO_ACCESS_TOKEN');
      const res = await post(
        'https://exp.host/--/api/v2/push/send',
        devices.map((device) => ({ to: device.pushToken, title: said.subject, body: 'Prepared and waiting to be issued. Nothing has been sent.', data: { projectId: project.id }, sound: 'default' })),
        expo ? { authorization: `Bearer ${expo}` } : {},
      );
      if (res.ok) for (const device of devices) told.add(device.email.toLowerCase());
      else console.warn(`[cron] report day push for ${project.id} was refused: ${res.status}`);
    } catch (err) {
      console.warn(`[cron] report day push for ${project.id} failed: ${(err as Error).message}`);
    }
  }
  return [...told];
}

/** Of some addresses, the ones that are the firm's own people on a project's workspace. Somebody working from a grant is never told. */
export function firmPeopleAmong(project: DdProject, emails: readonly string[]): string[] {
  const tenantId = project.tenantId ?? store.data.tenants?.[0]?.id;
  const own = (store.data.memberships ?? []).filter((member) => member.tenantId === tenantId && reachesEveryProject(member.role));
  return emails.filter((email) => own.some((member) => sameEmail(member.email, email)));
}

const fromStore: ReportDaySource = {
  ids: () => (store.data.projects ?? []).filter((project) => project.reportDay?.setting).map((project) => project.id),
  fresh: async (id) => {
    await store.pullFresh(id);
    return store.data.projects?.find((project) => project.id === id);
  },
  save: async (project) => {
    project.updatedAt = new Date().toISOString();
    await store.save();
  },
  ownPeople: firmPeopleAmong,
  tell: tellReportsReady,
};

/**
 * Prepare what every project's report day asks for at `now`, and tell the
 * people named. Returns counts: the projects with a report day, the reports
 * prepared in this run, the people told in this run, and the projects that
 * failed.
 */
export async function reportDay(now: Date, source: ReportDaySource = fromStore): Promise<Record<string, number>> {
  const out = { projects: 0, prepared: 0, told: 0, failed: 0 };
  let ids: string[] = [];
  try {
    ids = source.ids();
  } catch (err) {
    console.warn(`[cron] report day could not list projects: ${(err as Error).message}`);
    return { ...out, failed: 1 };
  }
  for (const id of ids) {
    try {
      const project = await source.fresh(id);
      const setting = project?.reportDay?.setting;
      if (!project || !setting) continue;
      out.projects += 1;
      const period = reportPeriodDue(setting, now);
      if (!period) continue;

      // As it was, so a write that fails leaves this copy saying what storage says, and the next run prepares the same reports.
      const before = { reports: project.reports.length, audit: project.audit.length, ownerPacks: project.ownerPacks, reportDay: project.reportDay, updatedAt: project.updatedAt };
      const fresh = prepareReportsDue(project, now);
      if (fresh.length) {
        try {
          await source.save(project);
        } catch (err) {
          project.reports.length = before.reports;
          project.audit.length = before.audit;
          project.ownerPacks = before.ownerPacks;
          project.reportDay = before.reportDay;
          project.updatedAt = before.updatedAt;
          throw err;
        }
        out.prepared += fresh.length;
      }

      // Everything prepared for this period that nobody has been told of: what this run prepared, and what a run that died left.
      const untold = (project.reportDay?.prepared ?? []).filter((line) => line.from === period.from && line.to === period.to && !line.toldAt);
      if (!untold.length) continue;
      const told = await source.tell(project, untold, source.ownPeople(project, setting.tell));
      noteReportsTold(project, untold, told, now.toISOString());
      await source.save(project);
      out.told += told.length;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] report day on ${id}: ${(err as Error).message}`);
    }
  }
  return out;
}
