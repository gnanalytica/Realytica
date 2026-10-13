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
| `GET /projects/:id/site` | One project's site view: milestones, progress, the construction gate, recent entries, construction alerts, and the photo stations not photographed this period |
| `POST /projects/:id/site-log/photos`, `POST /projects/:id/site-log` | Photographs, then the day's entry |
| `PATCH /projects/:id/milestones/:milestoneId` | A milestone's progress |
| `GET /projects/:id/site-log/:entryId/photos/:index` | A photograph |
| `GET /projects/:id/stations/:stationId/guide` | A station's last shot before this period, to frame the next one against |
| `POST /projects/:id/alerts/read` | Marking alerts read |

## Photo stations

A station is a place the site shoots again and again from the same spot, kept in the web app under Site. The site view lists the ones with no shot this period (`stations`: label, place, standing, the period, and whether there is an earlier shot). The day's log shows them above the photos, each with its last shot drawn faintly as a guide for framing, and a camera button. A photo taken from a station's row carries that station's id in the entry (`photos[].stationId`), and the server files it there. A photo taken any other way is matched by the server: to the one station within 30 m of where it was taken, else it waits in the web app as "place not set" for a person. The list is as old as the cached site view; a station shot from another phone since then is still listed until the view is refreshed.

A station's period is the calendar's own week, month or quarter, the same one the web app keeps its periods by. A milestone whose stations are marked as needed is not marked complete from the web without their photographs; a day's log that reports it at 100 is filed as reported, and the web app then says "complete, photographs wanting" until the photographs are taken or a lead picks why not.

The station list, the guide shot and the station carried on a photograph are typechecked and have not yet been run on a device.

## Notifications

With notifications allowed, the phone registers its Expo push token. The API pushes alerts to the phones of a department's lead and signer: a serious issue from site, work logged before it is allowed, a late milestone, an approval lapsing, a certified report to revisit, and an action past its date, which also goes to the person it is on. Push needs a development or store build; Expo Go cannot receive them.
