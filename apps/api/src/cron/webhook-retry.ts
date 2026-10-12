/**
 * The timer's part in webhooks: trying again what did not get through.
 *
 * `retryWebhooks(now)` tries every delivery whose next attempt has come due,
 * gives up the ones out of attempts, marks their endpoints failing and tells
 * the firm's owners and managers by email. It is meant to be called from the
 * daily timer, and is safe to call twice: what is due is read from the log,
 * and a delivery that was tried is written back with a later date or none.
 * It never throws.
 *
 * The email goes through Resend, as alert emails do, when
 * `REALYTICA_RESEND_API_KEY` is set. Without it nobody is mailed, and the
 * endpoint reads as failing on the Integrations page.
 */

import { readEnv } from '@realytica/agents';
import { can } from '@realytica/shared';
import type { EndpointRecord } from '../integrations/documents';
import { forgetListeners } from '../integrations/observe';
import { httpsSend, retryDeliveries, type RetryRun, type WebhookSend } from '../integrations/webhooks';
import { store } from '../store';

const SEND_TIMEOUT_MS = 6_000;

/** Tell the firm's admins an endpoint is failing. Answers whether anybody was told. */
async function tellAdmins(endpoint: EndpointRecord): Promise<boolean> {
  const key = readEnv('RESEND_API_KEY');
  const to = (store.data.memberships ?? [])
    .filter((member) => member.tenantId === endpoint.tenantId && can(member.role, 'admin'))
    .map((member) => member.email)
    .slice(0, 50);
  if (!key || !to.length) return false;
  const base = readEnv('APP_URL')?.replace(/\/+$/, '') ?? 'https://realytica.gnanalytica.com';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: readEnv('ALERT_FROM') ?? 'Realytica <alerts@gnanalytica.com>',
      to,
      subject: `Webhook deliveries to ${new URL(endpoint.url).host} are failing`,
      text: `Deliveries to ${endpoint.url} failed on every attempt, and nothing more is being sent there.\n\nOnce the address answers again, send it a test delivery to resume:\n${base}/integrations`,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) console.warn(`[webhooks] the email about ${endpoint.id} was refused: ${res.status}`);
  return res.ok;
}

/** Try again what is due, as of `now`. Counts what it did. */
export async function retryWebhooks(
  now: Date,
  send: WebhookSend = httpsSend,
  tell: (endpoint: EndpointRecord) => Promise<boolean> = tellAdmins,
): Promise<RetryRun> {
  try {
    const run = await retryDeliveries(now, send, tell);
    if (run.endpointsFailing) forgetListeners();
    return run;
  } catch (err) {
    console.warn(`[webhooks] the retry run stopped: ${(err as Error).message}`);
    return { due: 0, delivered: 0, failed: 0, gaveUp: 0, endpointsFailing: 0, told: 0, errors: 1 };
  }
}
