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
 *
 * A save does not wait for the sending: it goes on once the reply is out
 * (`sendAfterSave`). A message leaves once by each channel however many
 * instances took it: the mail service is handed a key, and a push is claimed
 * on the project before it is made. A message that could not be sent has its
 * notices given back, so the ten-minute timer tries it again.
 */

import { readEnv } from '@realytica/agents';
import { gatherTell, projectView, reachesEveryProject, takeTellDue, tellEvents, tellMessage, tellSaid, untakeTell, type DdProject, type TellLine, type TellPerson } from '@realytica/shared';
import { liveGrant } from './auth/access';
import { storageAdapter } from './storage';
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
  /** Every notice taken for it, worded or not: what is given back when it cannot be sent. */
  ids: string[];
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
    if (lines.length) out.push({ to, lines, key: notices[0]!.id, ids: notices.map((notice) => notice.id) });
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

const PUSHED_KEY = 'tell-pushed.json';
const PUSHED_KEPT_MS = 86_400_000;

async function pushesMade(projectId: string): Promise<Record<string, number>> {
  const bytes = await storageAdapter.getDocument(projectId, PUSHED_KEY);
  return bytes ? (JSON.parse(bytes.toString('utf-8')) as Record<string, number>) : {};
}

/**
 * Take the push of one message, once: false when an instance took it before.
 * Kept a day beside the project, as the mail service keeps its key. Where
 * what is kept cannot be read, the push is made: twice is better than never.
 */
async function claimPush(projectId: string, key: string, now = Date.now()): Promise<boolean> {
  try {
    const held = await pushesMade(projectId);
    if (held[key]) return false;
    const kept = Object.entries(held).filter(([, at]) => now - at < PUSHED_KEPT_MS);
    await storageAdapter.putDocument(projectId, PUSHED_KEY, Buffer.from(JSON.stringify({ ...Object.fromEntries(kept), [key]: now })), 'application/json');
  } catch (err) {
    console.warn(`[tell] could not note the push on ${projectId}: ${(err as Error).message}`);
  }
  return true;
}

/** Give a push back, so the next try makes it: for one the push service refused. */
async function releasePush(projectId: string, key: string): Promise<void> {
  try {
    const held = await pushesMade(projectId);
    if (!held[key]) return;
    delete held[key];
    await storageAdapter.putDocument(projectId, PUSHED_KEY, Buffer.from(JSON.stringify(held)), 'application/json');
  } catch {
    /* it stays claimed: the mail, where there is any, is tried again all the same */
  }
}

/**
 * Send what a save or the timer took. Never throws. Returns how many went by
 * each channel, and the notices of every message a channel failed to carry:
 * they are to be given back (`giveBackUnsent`).
 */
export async function sendTold(project: DdProject, messages: readonly TellOut[]): Promise<{ mailed: number; pushed: number; unsent: string[] }> {
  const sent = { mailed: 0, pushed: 0, unsent: [] as string[] };
  const key = readEnv('RESEND_API_KEY');
  const from = readEnv('ALERT_FROM') ?? 'Realytica <alerts@gnanalytica.com>';
  const expo = readEnv('EXPO_ACCESS_TOKEN');
  for (const message of messages) {
    let failed = false;
    try {
      const said = tellMessage(project, message.lines, appUrl());
      if (key) {
        // The key makes a second send of this message, from another instance or a repeated run, the first one again (Resend keeps it a day).
        const res = await post('https://api.resend.com/emails', { from, to: [message.to], subject: said.subject, text: said.text }, { authorization: `Bearer ${key}`, 'idempotency-key': `tell/${project.id}/${message.key}`.slice(0, 256) });
        if (res.ok) sent.mailed += 1;
        else {
          failed = true;
          console.warn(`[tell] email on ${project.id} was refused: ${res.status}`);
        }
      }
      const tokens = (store.data.devices ?? []).filter((device) => !device.revokedAt && device.pushToken && device.email.toLowerCase() === message.to).map((device) => device.pushToken!);
      // The push service takes no key, so the push is claimed first: a second instance that took the same notices makes none.
      const claim = `${message.to}/${message.key}`;
      if (tokens.length && (await claimPush(project.id, claim))) {
        const body = tokens.map((token) => ({ to: token, title: project.name, body: said.push.slice(0, 180), data: { projectId: project.id, tell: message.key }, sound: 'default' }));
        const res = await post('https://exp.host/--/api/v2/push/send', body, expo ? { authorization: `Bearer ${expo}` } : {}).catch(async (err: unknown) => {
          await releasePush(project.id, claim);
          throw err;
        });
        if (res.ok) sent.pushed += 1;
        else {
          failed = true;
          await releasePush(project.id, claim);
          console.warn(`[tell] push on ${project.id} was refused: ${res.status}`);
        }
      }
    } catch (err) {
      failed = true;
      console.warn(`[tell] could not send on ${project.id}: ${(err as Error).message}`);
    }
    if (failed) sent.unsent.push(...message.ids);
  }
  return sent;
}

/**
 * Give back the notices of messages that could not be sent, on the project
 * as storage has it now, and write it: the ten-minute timer takes them again
 * a message's worth later. Where storage does not answer nothing is written,
 * and they stay in the app alone. Never throws.
 */
export async function giveBackUnsent(projectId: string, ids: readonly string[], now = new Date()): Promise<void> {
  if (!ids.length) return;
  try {
    await store.pullFresh(projectId);
    const project = store.data.projects?.find((held) => held.id === projectId);
    if (!project || !untakeTell(project, ids, now)) return;
    project.updatedAt = new Date().toISOString();
    await store.save();
  } catch (err) {
    console.warn(`[tell] could not give back what was not sent on ${projectId}: ${(err as Error).message}`);
  }
}

/** What a save does with what it took, once its reply is out: send it, and give back what could not be sent. Never throws. */
export async function sendAfterSave(project: DdProject, messages: readonly TellOut[]): Promise<void> {
  const sent = await sendTold(project, messages);
  await giveBackUnsent(project.id, sent.unsent);
}
