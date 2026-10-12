/**
 * Telling the people a change concerns: the part that knows who is in the
 * workspace and how a message leaves it.
 *
 * Who is concerned and what they are told is `tell.ts` in the shared
 * package, a pure function of a project and a list of people. Here that list
 * is drawn up: the firm's own people, who read every project, and each
 * person working from a live grant, with their own copy of the project.
 * Nobody else is on it, so a name on a record that is no member here is told
 * nothing, and somebody from outside is told only of what their copy holds.
 *
 * A save reads the trail and writes the notices with the change that caused
 * them (`tellOnSave`). They are in the app from then. What leaves the app
 * waits a message's worth, so a drop of ten papers is one message a person,
 * and goes out after the write by the channels alerts use: email through
 * Resend when `REALYTICA_RESEND_API_KEY` is set, push through Expo to the
 * phones those people paired. With neither, nothing leaves and the app says
 * so. A failure to send is logged and never fails the save behind it.
 */

import { readEnv } from '@realytica/agents';
import { gatherTell, projectView, reachesEveryProject, takeTellDue, tellEvents, tellMessage, tellSaid, type DdProject, type TellLine, type TellPerson } from '@realytica/shared';
import { liveGrant } from './auth/access';
import { store } from './store';

const SEND_TIMEOUT_MS = 6_000;

/** Everybody who could be told of something on this project, each with what they may read of it. */
export function tellPeople(project: DdProject): TellPerson[] {
  const tenantId = project.tenantId ?? store.data.tenants?.[0]?.id;
  const people: TellPerson[] = [];
  for (const member of (store.data.memberships ?? []).filter((held) => held.tenantId === tenantId)) {
    const base = { email: member.email, ...(member.name ? { name: member.name } : {}), workspaceRole: member.role };
    if (reachesEveryProject(member.role)) {
      people.push(base);
      continue;
    }
    const grant = tenantId ? liveGrant(tenantId, project.id, member.email) : undefined;
    if (grant) people.push({ ...base, copy: projectView(project, { kind: 'granted', grant, email: member.email }).project });
  }
  return people;
}

/** One person's message about one project, ready to leave. */
export interface TellOut {
  to: string;
  lines: TellLine[];
  /** What makes a second send of the same message the same send: its first notice. */
  key: string;
}

/**
 * Before a project is written: read its trail, write the notices, and take
 * what is due to leave. Returns the messages to send once the write is done.
 */
export function tellOnSave(project: DdProject, now = new Date()): TellOut[] {
  const trail = project.audit ?? [];
  const unread = trail.length > 0 && trail[trail.length - 1]!.id !== project.tell?.through;
  const waits = (project.tell?.notices ?? []).some((notice) => !notice.batchedAt && !notice.readAt);
  if (!unread && !waits) return [];
  // Most saves file and decide nothing: the marker moves on, and nobody's copy of the project is worked out.
  const news = unread && tellEvents(project, now).events.length > 0;
  if (!news && !waits) {
    gatherTell(project, [], now);
    return [];
  }
  const people = tellPeople(project);
  if (unread) gatherTell(project, news ? people : [], now);
  return tellOut(project, people, now);
}

/** Take what is due on a project and word it for each person from their own copy. */
export function tellOut(project: DdProject, people: readonly TellPerson[], now = new Date()): TellOut[] {
  const out: TellOut[] = [];
  for (const [to, notices] of takeTellDue(project, now)) {
    // Somebody who has left the workspace, or whose grant has ended, since the notice was written is sent nothing.
    const person = people.find((held) => held.email.trim().toLowerCase() === to);
    if (!person) continue;
    const lines = notices.flatMap((notice) => tellSaid(person.copy ?? project, notice) ?? []);
    if (lines.length) out.push({ to, lines, key: notices[0]!.id });
  }
  return out;
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

function appUrl(): string {
  const base = readEnv('APP_URL')?.replace(/\/+$/, '') ?? 'https://realytica.gnanalytica.com';
  return `${base}/work`;
}

/** Whether mail can leave this deployment, and whether this person has a phone to push to. */
export function tellChannels(email: string): { email: boolean; push: boolean } {
  const me = email.trim().toLowerCase();
  return {
    email: Boolean(readEnv('RESEND_API_KEY')),
    push: (store.data.devices ?? []).some((device) => !device.revokedAt && device.pushToken && device.email.toLowerCase() === me),
  };
}

/** Send what a save or the timer took. Never throws. Returns how many went by each channel. */
export async function sendTold(project: DdProject, messages: readonly TellOut[]): Promise<{ mailed: number; pushed: number }> {
  const sent = { mailed: 0, pushed: 0 };
  const key = readEnv('RESEND_API_KEY');
  const from = readEnv('ALERT_FROM') ?? 'Realytica <alerts@gnanalytica.com>';
  const expo = readEnv('EXPO_ACCESS_TOKEN');
  for (const message of messages) {
    try {
      const said = tellMessage(project, message.lines, appUrl());
      if (key) {
        // The key makes a second send of this message, from another instance or a repeated run, the first one again (Resend keeps it a day).
        const res = await post('https://api.resend.com/emails', { from, to: [message.to], subject: said.subject, text: said.text }, { authorization: `Bearer ${key}`, 'idempotency-key': `tell/${project.id}/${message.key}`.slice(0, 256) });
        if (res.ok) sent.mailed += 1;
        else console.warn(`[tell] email on ${project.id} was refused: ${res.status}`);
      }
      const tokens = (store.data.devices ?? []).filter((device) => !device.revokedAt && device.pushToken && device.email.toLowerCase() === message.to).map((device) => device.pushToken!);
      if (tokens.length) {
        const body = tokens.map((token) => ({ to: token, title: project.name, body: said.push.slice(0, 180), data: { projectId: project.id, tell: message.key }, sound: 'default' }));
        const res = await post('https://exp.host/--/api/v2/push/send', body, expo ? { authorization: `Bearer ${expo}` } : {});
        if (res.ok) sent.pushed += 1;
        else console.warn(`[tell] push on ${project.id} was refused: ${res.status}`);
      }
    } catch (err) {
      console.warn(`[tell] could not send on ${project.id}: ${(err as Error).message}`);
    }
  }
  return sent;
}
