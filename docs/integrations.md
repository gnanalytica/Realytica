# Integrations

Another system can read a firm's projects with an API key, and be told what happens on them at an address the firm registers. Both are set up by an owner or a manager on **Integrations** in the sidebar.

This version reads and tells. A key cannot write: there is no route under `/api/v1` that changes a record.

## API keys

A key is shown once, when it is made. The server keeps its first twelve characters, so the rows can be told apart, and a salted HMAC-SHA256 of the rest. Each key has a name, the things it may read, the projects it reaches (every project of the firm, or a list), an expiry (30 days, 90 days, a year, or none), the time it was last used, and can be revoked. A list of projects names at least one: an empty list is refused, since it would be kept as every project. Revoking takes effect on the next request, and is kept in a document of its own for each key, so no later write of the keys can bring a revoked key back.

Send it as a bearer token:

```bash
curl https://your-deployment.example/api/v1/projects \
  -H "Authorization: Bearer rlk_1a2b3c4d_…"
```

A key is accepted under `/api/v1` and nowhere else. On any other route it is answered `401`, whatever it is; and a person's sign-in is not accepted under `/api/v1`.

| Route | Scope | Answers with |
|---|---|---|
| `GET /api/v1/projects` | `projects:read` | `{ projects }`: the summary of each project the key reaches |
| `GET /api/v1/projects/:id` | `projects:read` | `{ project }`: one summary: name, reference, stage, status, health, counts |
| `GET /api/v1/projects/:id/alerts` | `projects:read` | `{ alerts }`: the open alerts; `?state=all` adds the resolved ones |
| `GET /api/v1/projects/:id/reports` | `reports:read` | `{ reports }`: the reports a person has issued, with who signed and when. Not their text, and no draft |
| `GET /api/v1/projects/:id/papers-owed` | `documents:read` | `{ total, owed, parties }`: the papers the checklist still waits for, grouped by who owes them |

Each answer is built from the view of the project the app gives one of the firm's own readers, and from what people have settled: a paper a matcher only suggests is still owed, and a report is listed once it is issued.

| Status | Means |
|---|---|
| `401` | No key, or one that is unknown, revoked or expired. The answer does not say which |
| `403` | The key does not hold the scope the route needs |
| `404` | No such project for this key: not there, another firm's, or not on the key's list |
| `429` | More than 120 requests in a minute from this key (`REALYTICA_RATE_LIMIT_KEY` changes the number), or too many from one address whatever key they carry. `Retry-After` says how long to wait |

Every request a key makes is written down: when, which route, and the status it was answered with. A request turned away with `429` is the exception: it is not written down, so a key held to its limit costs nothing more. Before any key is looked up, requests are counted by the address they come from: 300 a minute, or three times one key's limit where that is more. A caller with no key, or a made-up one, is stopped there. Both counts are kept per instance, so on a deployment with several warm instances the effective limits are higher.

## Webhooks

Register an `https` address and choose the events. The signing secret is shown once.

| Event | Sent when |
|---|---|
| `paper.filed` | A paper is added to a project, or a file is put on its row |
| `value.accepted` | A person accepts a value read off a paper, or the inputs to a valuation |
| `alert.raised` | An alert is raised |
| `alert.resolved` | An alert clears |
| `report.issued` | A person issues a report or a Cost Report |
| `webhook.test` | Somebody presses **Test** |

Nothing a model proposed and nobody accepted is an event.

The body is JSON:

```json
{
  "id": "evt_aud_1a2b3c",
  "type": "value.accepted",
  "timestamp": "2026-10-12T09:14:03.120Z",
  "data": {
    "project": { "id": "prj_…", "reference": "RYT-0007", "name": "Lake Road offices" },
    "actor": "lead@yourfirm.example",
    "paper": { "id": "ev_…", "title": "Sale deed", "kind": "document" },
    "key": "sale_consideration",
    "corrected": false
  }
}
```

It carries ids and a title, enough to say what happened. Read the rest with a key.

### Checking the signature

Deliveries are signed as [Standard Webhooks](https://www.standardwebhooks.com/) signs them, so its libraries verify them as they are. Three headers come with each:

| Header | Holds |
|---|---|
| `webhook-id` | The event's id. The same on every attempt: drop one you have already handled |
| `webhook-timestamp` | When this attempt was sent, in seconds since 1970 |
| `webhook-signature` | `v1,` then the base64 HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}` |

The key is the secret with `whsec_` taken off, decoded from base64. Sign the body exactly as it arrived, before parsing it, compare in constant time, and refuse a timestamp more than five minutes from your own clock.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return headers['webhook-signature'].split(' ').some((entry) => {
    const given = Buffer.from(entry.replace(/^v1,/, ''), 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

### Delivery

- Answer with any `2xx` within five seconds. Anything else is a failure, a redirect included: redirects are not followed.
- A failed delivery is tried again by a timer, up to five attempts in all, with a longer wait after each (an hour, six hours, a day, two days). The timer runs every ten minutes where the plan allows it (`/api/cron/often` in `vercel.json`) and with the daily run in any case, so with the daily run alone each retry lands on the next day's run after it is due. Nothing retries on the next event, and nothing is retried where `CRON_SECRET` is not set.
- After the fifth failure the delivery is given up, the endpoint is marked **Failing**, the firm's owners and managers are emailed (when `REALYTICA_RESEND_API_KEY` is set), and nothing more is sent there. Events that happen while it is failing are not kept for later. A **Test** that goes through clears the mark.
- An event can arrive twice, when two instances save the same project at the same moment. The `webhook-id` is the same both times.
- Every delivery is on the Integrations page with its status, the receiver's answer and the number of attempts.

### Where a webhook may be sent

Only to a public address over `https`. An address inside the deployment's own network is refused: loopback, private ranges, link-local (where a cloud keeps its metadata endpoint), carrier NAT, and any IPv6 address that is not global unicast. A name is looked up and every answer checked when the endpoint is registered, and again by the connection that makes each delivery, so a name that later comes to point inside reaches nothing. An address carrying a user name or password is refused.

## Settings

| Variable | What it does |
|---|---|
| `REALYTICA_CREDENTIAL_KEY` | Seals webhook signing secrets at rest. Without it no endpoint can be registered, and the page says webhooks are off. API keys do not need it |
| `REALYTICA_RATE_LIMIT_KEY` | Requests a minute for one API key. 120 by default |
| `REALYTICA_RESEND_API_KEY`, `REALYTICA_ALERT_FROM`, `REALYTICA_APP_URL` | The email that says an endpoint is failing. Without them it is said on the page only |

## Where it lives

| | |
|---|---|
| `apps/api/src/routes/integrations.ts` | `/api/v1`, the refusal of a key anywhere else, and `/api/integrations` |
| `apps/api/src/integrations/keys.ts` | Making, matching and revoking keys |
| `apps/api/src/integrations/webhooks.ts` | The address check, signing, delivery and retry |
| `apps/api/src/integrations/observe.ts` | The one place events leave from: a look at each project as the store saves it |
| `apps/api/src/integrations/documents.ts` | The four documents all of this is kept in, outside the workspace document, and one small document for each revoked key |
| `apps/api/src/cron/webhook-retry.ts` | `retryWebhooks(now)`, for the ten-minute and the daily timer |
| `packages/shared/src/operating-model/integrations.ts` | Scopes, event names, and which events a saved project has had |
