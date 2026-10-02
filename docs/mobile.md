# The site app

`mobile/` is Realytica Site, a native app for Android and iOS built with Expo (React Native). It does one job: site work. The daily log — manpower, work done, progress against milestones, weather — geo-tagged photographs, and issues and snags. It works with no signal and sends when it can.

It is its own package, outside the pnpm workspace, so its React Native toolchain never meets the web's. [mobile/README.md](../mobile/README.md) covers running and building it.

## How it signs in

A phone never sees a password or a Google sign-in.

1. In the web app, **People › The site app › Pair a phone** shows an 8-character code and the same code as a QR, valid for ten minutes and one use.
2. In the app, scan it (or type it, with the server address). The phone trades it at `POST /api/devices/claim` for a token of its own and keeps it in the secure store.
3. From then on the phone acts as the person who paired it, as the workspace knows them now, reaching only the site routes. Revoking the phone in People, or removing the person, ends it at the next call.

## Offline

Every entry goes to an outbox on the phone first, with an id the phone generates. A sync loop runs when the app comes to the front, when the connection returns and every minute while open: photographs go up first (resized to 1600 px, in batches of six), then the entry with the same id. The server files an id once, so a resend after a dropped connection never doubles the day. The projects list and each project's site view are cached and shown with when they were last updated.

## What it calls

| Call | For |
|---|---|
| `POST /devices/claim`, `GET /devices/me`, `DELETE /devices/me`, `POST /devices/push-token` | Pairing, who am I, sign out, notifications |
| `GET /projects` | The projects list |
| `GET /projects/:id/site` | One project's site view: milestones, progress, the construction gate, recent entries, construction alerts |
| `POST /projects/:id/site-log/photos`, `POST /projects/:id/site-log` | Photographs, then the day's entry |
| `PATCH /projects/:id/milestones/:milestoneId` | A milestone's progress |
| `GET /projects/:id/site-log/:entryId/photos/:index` | A photograph |
| `POST /projects/:id/alerts/read` | Marking alerts read |

## Notifications

With notifications allowed, the phone registers its Expo push token. The API pushes alerts to the phones of a department's lead and signer: a serious issue from site, work logged before it is allowed, a late milestone, an approval lapsing, a certified report to revisit. Push needs a development or store build; Expo Go cannot receive them.
