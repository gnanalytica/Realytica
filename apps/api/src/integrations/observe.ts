/**
 * The one place events leave from: a look at each project as it is saved.
 *
 * A paper is filed, a value accepted and a report issued in a dozen routes
 * and in the chat, and every one of them writes a line on the project's
 * trail and then saves. So in place of a call at each of those places, the
 * store hands every project it has just written to `observeSaved`, which
 * reads the trail's last few minutes and the alerts for what happened
 * (`integrationEventsOf`). A route added later is covered without knowing
 * this exists.
 *
 * It costs a save nothing where nobody listens: which firms have an endpoint
 * is held for a few seconds, and a firm with none is not looked at. It runs
 * after the reply and never fails the save behind it.
 */

import { integrationEventsOf, type DdProject } from '@realytica/shared';
import { store } from '../store';
import { readIntegrations } from './documents';
import { sendEvents, type WebhookSend } from './webhooks';

/** How far back on the trail a save is read. A line is written by the request that saves it, seconds before. */
const LOOK_BACK_MS = 10 * 60_000;
/** How long the list of firms with an endpoint is held before it is read again. */
const LISTENING_FOR_MS = 15_000;

let listening: { at: number; tenants: Set<string> } | undefined;

/** Forget which firms listen, so the next save reads it again: after an endpoint is added, removed or marked. */
export function forgetListeners(): void {
  listening = undefined;
}

async function listeners(now: number): Promise<Set<string>> {
  if (!listening || Math.abs(now - listening.at) > LISTENING_FOR_MS) {
    const endpoints = (await readIntegrations('endpoints')).endpoints;
    listening = { at: now, tenants: new Set(endpoints.filter((e) => !e.failingSince).map((e) => e.tenantId)) };
  }
  return listening.tenants;
}

/** Send what just happened on these projects to whoever asked to be told. Answers how many deliveries it made. Never throws. */
export async function observeSaved(projects: readonly DdProject[], now = new Date(), send?: WebhookSend): Promise<number> {
  let sent = 0;
  try {
    const heard = await listeners(now.getTime());
    if (!heard.size) return 0;
    const since = new Date(now.getTime() - LOOK_BACK_MS).toISOString();
    const bootstrap = store.data.tenants?.[0]?.id;
    for (const project of projects) {
      const tenantId = project.tenantId ?? bootstrap;
      if (!tenantId || !heard.has(tenantId)) continue;
      const about = { id: project.id, reference: project.reference, name: project.name };
      const events = integrationEventsOf(project, since).map((event) => ({
        id: event.id,
        type: event.type,
        at: event.at,
        projectId: project.id,
        data: { project: about, ...(event.actor ? { actor: event.actor } : {}), ...event.data },
      }));
      sent += (await sendEvents(tenantId, events, now, send)).length;
    }
  } catch (err) {
    console.warn(`[webhooks] could not send what was saved: ${(err as Error).message}`);
  }
  return sent;
}
