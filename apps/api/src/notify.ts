/**
 * Telling people about alerts: by email and on their phones.
 *
 * In-app alerts need nothing here; they live on the project. This is the part
 * that leaves the system, so it goes only to the people an alert is for — the
 * department's lead and its signer — and only for alerts worth interrupting
 * someone over. An approval that is simply not on file yet stays in the app.
 * An alert that names a person, as one about an action past its date does,
 * goes to that person too, when they are a member here (`alertNamed`).
 *
 * Nobody is sent what they could not read in the app (`mayHear`): the firm's
 * own people are told of any alert, and somebody working from a grant only of
 * one their own copy of the project holds. A name on an alert is matched
 * among those people and nobody else.
 *
 * Email goes through Resend when `REALYTICA_RESEND_API_KEY` is set; push
 * through Expo's push service to the phones those people paired. Neither is
 * required: with nothing configured, alerts stay in the app and on the phone's
 * next sync. A failure to send is logged and never fails the save behind it.
 */

import { readEnv } from '@realytica/agents';
import { departmentRole, projectView, reachesEveryProject, sameEmail, type DdProject, type DepartmentKey, type ProjectAlert } from '@realytica/shared';
import { liveGrant } from './auth/access';
import { store } from './store';

const SEND_TIMEOUT_MS = 6_000;

/** Interrupting someone is for these; the rest wait in the app. */
export function worthSending(alert: ProjectAlert): boolean {
  if (alert.key.startsWith('approval:') && alert.key.endsWith(':missing')) return false;
  return alert.severity === 'critical' || alert.severity === 'warning';
}

/** Who an alert is for: the department's lead and signer, as the project and the workspace say. */
export function alertRecipients(project: DdProject, department: DepartmentKey): string[] {
  const tenantId = project.tenantId ?? store.data.tenants?.[0]?.id;
  const members = (store.data.memberships ?? []).filter((m) => m.tenantId === tenantId);
  const emails = new Set<string>();
  for (const m of members) {
    const role = departmentRole(project, { email: m.email, workspaceRole: m.role }, department);
    if (role === 'lead' || role === 'signer') emails.add(m.email.toLowerCase());
  }
  for (const t of project.team ?? []) {
    const role = t.departments[department];
    if (role === 'lead' || role === 'signer') emails.add(t.email.toLowerCase());
  }
  return [...emails];
}

/**
 * Whether somebody may be told of an alert by mail or on their phone: what
 * they could read of it in the app, and no more. The firm's own people may be
 * told of any alert. Somebody working from a grant, on the project's team or
 * not, only of one their own copy of the project holds (`projectView`), so
 * an action, a paper or a meeting withheld from them does not reach them
 * this way either. Anybody else, of none.
 */
export function mayHear(project: DdProject, alert: ProjectAlert, email: string): boolean {
  const tenantId = project.tenantId ?? store.data.tenants?.[0]?.id;
  const member = (store.data.memberships ?? []).find((held) => held.tenantId === tenantId && sameEmail(held.email, email));
  if (member && reachesEveryProject(member.role)) return true;
  const grant = tenantId ? liveGrant(tenantId, project.id, email) : undefined;
  if (!grant) return false;
  return (projectView(project, { kind: 'granted', grant, email }).project.alerts ?? []).some((held) => held.key === alert.key);
}

/**
 * The people an alert names, as addresses to send to. An alert about an
 * action past its date names who the action is on, in the words the record
 * has: an address, or a name. Either is a person here only among those who
 * may be told of the alert (`mayHear`): the firm's own people, and somebody
 * outside only when their grant reaches what it is about. A name is a person
 * only when exactly one of them goes by it, in full or by first name. Where
 * two do, nobody is sent it by name, and the department's lead still is.
 * Nobody is guessed at, and nothing is sent to an address the workspace does
 * not know.
 */
export function alertNamed(project: DdProject, alert: ProjectAlert): string[] {
  const names = alert.to;
  if (!names?.length) return [];
  const tenantId = project.tenantId ?? store.data.tenants?.[0]?.id;
  const told = new Map<string, boolean>();
  const mayBeTold = (email: string): boolean => {
    const key = email.toLowerCase();
    if (!told.has(key)) told.set(key, mayHear(project, alert, email));
    return told.get(key)!;
  };
  const people = [
    ...(project.team ?? []).map((member) => ({ email: member.email, name: member.name })),
    ...(store.data.memberships ?? []).filter((member) => member.tenantId === tenantId).map((member) => ({ email: member.email, name: member.name })),
  ].filter((person) => mayBeTold(person.email));
  const out = new Set<string>();
  for (const raw of names) {
    const said = raw.trim().toLowerCase();
    if (!said) continue;
    const called = new Set(
      people
        .filter((person) => (said.includes('@') ? sameEmail(person.email, said) : person.name ? person.name.toLowerCase() === said || person.name.toLowerCase().split(/\s+/)[0] === said : false))
        .map((person) => person.email.toLowerCase()),
    );
    if (called.size === 1) out.add([...called][0]!);
  }
  return [...out];
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

function appUrl(project: DdProject): string {
  const base = readEnv('APP_URL')?.replace(/\/+$/, '') ?? 'https://realytica.gnanalytica.com';
  return `${base}/projects/${project.id}`;
}

async function sendEmail(project: DdProject, alert: ProjectAlert, to: string[]): Promise<boolean> {
  const key = readEnv('RESEND_API_KEY');
  if (!key || !to.length) return false;
  const from = readEnv('ALERT_FROM') ?? 'Realytica <alerts@gnanalytica.com>';
  const text = `${alert.title}\n\n${alert.detail}\n\n${project.name} (${project.reference})\n${appUrl(project)}`;
  const res = await post('https://api.resend.com/emails', { from, to, subject: `${project.name}: ${alert.title}`, text }, { authorization: `Bearer ${key}` });
  if (!res.ok) console.warn(`[notify] email for ${alert.key} was refused: ${res.status}`);
  return res.ok;
}

async function sendPush(project: DdProject, alert: ProjectAlert, to: string[]): Promise<boolean> {
  const tokens = (store.data.devices ?? [])
    .filter((d) => !d.revokedAt && d.pushToken && to.includes(d.email.toLowerCase()))
    .map((d) => d.pushToken!);
  if (!tokens.length) return false;
  const headers: Record<string, string> = {};
  const expo = readEnv('EXPO_ACCESS_TOKEN');
  if (expo) headers.authorization = `Bearer ${expo}`;
  const messages = tokens.map((token) => ({ to: token, title: alert.title, body: `${project.name} — ${alert.detail}`.slice(0, 180), data: { projectId: project.id, alertId: alert.id }, sound: 'default' }));
  const res = await post('https://exp.host/--/api/v2/push/send', messages, headers);
  if (!res.ok) console.warn(`[notify] push for ${alert.key} was refused: ${res.status}`);
  return res.ok;
}

/** Send what was just raised. Marks each alert sent; never throws. */
export async function notifyRaised(project: DdProject, raised: ProjectAlert[]): Promise<void> {
  for (const alert of raised.filter(worthSending)) {
    try {
      // A lead or a signer from outside the firm is held to the same rule as a name: only what their own copy of the project holds.
      const to = [...new Set([...alertRecipients(project, alert.department), ...alertNamed(project, alert)])].filter((email) => mayHear(project, alert, email));
      const [mailed, pushed] = await Promise.all([sendEmail(project, alert, to), sendPush(project, alert, to)]);
      if (mailed || pushed) alert.sentAt = new Date().toISOString();
    } catch (err) {
      console.warn(`[notify] could not send ${alert.key}: ${(err as Error).message}`);
    }
  }
}
