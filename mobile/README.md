# Realytica Site

The phone app for site work on Realytica projects. Construction teams use it to
keep the **daily site log** — who was on site, the work done, how far each
milestone has moved, the weather — and to take **geo-tagged photos** and report
**problems and snags**. It works with no signal: everything is saved on the
phone first and sent when a connection comes back.

It is deliberately small. Everything else about a project (due diligence,
approvals, valuation, reports) stays in the web app.

Android and iOS, built with Expo SDK 56 (React Native 0.85, React 19.2,
expo-router, TypeScript strict). A web build runs for development only.

## How a phone signs in

There is no password on the phone. Someone signed in to the web app opens
**People › Pair a phone**, which shows an 8-character code (A–Z without I and
O, digits 2–9) for 10 minutes, as text and as a QR code
(`{"server":"https://…","code":"ABCD2345"}`). The phone scans the QR code or
the person types the code; the phone gets a long-lived token of its own, kept in
the keychain / keystore. Signing out on the phone, or removing the phone on the
People page, revokes it. A `401` from the server at any point means the phone has
been unpaired: the app forgets the token and the saved project data and returns
to the pairing screen (unsent work stays on the phone — see below).

## Screens

| Screen | What it is for |
|---|---|
| Pair this phone | Scan or type the code; choose a different server for development. |
| Projects | Every project the person can see, building projects first. Pull to refresh. |
| Site home | Progress ring, "x of y milestones done", the approvals warning, late milestones, construction alerts, **Log today**, milestones (tap to update), recent entries with photos. |
| Log the day | One scrolling form: date, weather, people on site by trade, work done, milestone changes, problems, photos with captions, the phone's location. |
| Outbox | What is waiting to send, what the server refused and why, **Send now**. |
| Settings | Who is signed in, the server, notifications, sign out. |

Designed for outdoors: large type, high contrast, nothing pressable under 48pt,
plain words. Light and dark themes use Realytica's own identity, the same as the
web app's (`src/theme`): grey pages with white cards, near-black for the one
action a screen is for, teal for links and selection, rose for anything waiting
on the person's own decision, Schibsted Grotesk for words and DM Mono for
figures, codes and percentages. The fonts are bundled and loaded before the
splash screen goes.

Screens keep clear of the status bar and the home indicator with
`useSafePadding` (`src/components/ui/screen.tsx`), which pads from the insets
measured once at the root. The native `SafeAreaView` measures where its own view
sits, and in a full-screen modal that slides up it reads zero, which put the
log's header under the status bar.

### Motion and touch

Motion is feedback, not decoration, and comes from one small vocabulary
(`src/theme/motion.ts`, Reanimated 4):

- **Everything pressable gives** under the thumb — a quick spring to about 97%
  and a slight fade (`Touchable`). The main action on a screen also taps the
  hand; choices and steps tick; saved, sent and paired buzz success; a refusal
  buzzes error (`src/lib/haptics.ts`, expo-haptics).
- **Lists arrive** in reading order (35 ms apart, all in place within half a
  second), rows leave with a fade, and the rest close up behind them.
- **Figures run to their value**: progress rings and bars fill, counts tick.
- **Sheets** spring up over a fading shade and can be pulled down to close;
  **toasts** drop in and lift away on their own.
- **Waiting** is shown as the shape of the screen (skeletons) rather than a
  spinner, and anything live (sending, checking, finding a location) breathes.
- **Reduce Motion is honoured everywhere**: animations land instantly and
  nothing loops or travels.

## Offline, and how sending works

- **Saving never needs signal.** "Save entry" and milestone changes go into the
  outbox (one JSON list in AsyncStorage) and only then try to send.
- **When it sends:** as soon as something is saved, when the app comes to the
  front, when the connection comes back, and every 60 seconds while the app is
  open. One run at a time, oldest item first.
- **A site entry goes in two steps.** Its photos are uploaded first, in batches
  of at most 6 files and 3.5 MB (the API's limit is 6 files, and on Vercel the
  whole request must stay under 4 MiB). Each photo's storage key is saved the
  moment the server returns it, so a retry never uploads a photo twice. Then the
  entry is posted under the id the phone gave it (`clientId`); the server files
  an entry once per id, so posting again after a lost response is harmless.
- **What a failure means.** No answer, a timeout, 429 or 5xx: try later, same
  order. 401: the phone was unpaired. Any other 4xx (403 — no Construction role
  on the project; 404; 400): the item is kept, marked **Needs attention** with the
  server's own sentence, and skipped by automatic runs until the person taps
  **Try again** or deletes it.
- **Whose work it is.** Each item records the person and server it was saved
  under, and is only sent while that same person is paired. Signing out or being
  unpaired never deletes unsent work.
- **Reading offline.** The projects list and each project's site view are saved
  on every successful read and loaded into the query cache on launch, so screens
  open with no signal and say "Last updated …".
- **Drafts.** The log form saves itself as it is typed and picks up where it was
  left after an interruption.

The sending logic lives in `src/lib/outbox/engine.ts`, which is plain
TypeScript with every effect injected. That is how it was tested against a live
API from Node, including dropped connections before filing, lost responses
after filing, a person without permission, and a revoked phone.

### Photos

Each photo is re-encoded on the phone to JPEG, at most 1600 px on the long edge,
quality 0.7 (typically 300–700 KB), and kept in the app's documents folder (not
the cache, which the OS may clear) until it is on the server. Time and place come
from the photo's own EXIF when it has them. A camera photo without GPS in its
EXIF is tagged with where the phone is; a photo chosen from the library is never
tagged with where the phone is now, because that would be false evidence of where
it was taken.

## Run it locally

Prerequisites: Node 20+, pnpm 10, and either the **Expo Go** app on a phone, the
iOS Simulator (Xcode) or an Android emulator.

```bash
cd mobile
pnpm install          # mobile/ is its own pnpm workspace, outside the repo's root one
pnpm start            # then press  i  (iOS simulator)  a  (Android)  w  (web)
pnpm typecheck        # tsc --noEmit
```

`mobile/pnpm-workspace.yaml` (with `packages: []`) is what keeps `pnpm install`
here from installing into the repository's root workspace instead. Do not delete it.

Optional: copy `.env.example` to `.env` and set `EXPO_PUBLIC_REALYTICA_SERVER`
to change the server the pairing screen suggests (it defaults to
`https://realytica.gnanalytica.com`).

### Pairing against a local API

From the repository root, start the API (port 5174):

```bash
pnpm dev:api
```

With `REALYTICA_AUTH_MODE=off` (the local default) the pair-code endpoint needs
no sign-in, so a code can be had from the command line:

```bash
curl -X POST localhost:5174/api/devices/pair-code
# {"code":"K7MXQ4PZ","expiresAt":"…","ttlSeconds":600}
```

In the app, on the pairing screen tap **Change** next to the server and choose
**Local development** (`http://localhost:5174`), then type the code. From an
Android emulator the computer is `http://10.0.2.2:5174`; from a real phone on the
same Wi-Fi use the computer's LAN address.

With sign-in switched off the API does not look at device tokens at all: every
request acts as the local operator, and the three phone-only endpoints
(`GET`/`DELETE /devices/me`, `POST /devices/push-token`) answer 400. The app
tolerates this — it only treats 401 as "unpaired" — but to exercise real device
tokens run the API with an identity provider (`REALYTICA_AUTH_MODE=google`,
`identity_platform` or `oidc`) and take the code from the web app's People page.

## Build with EAS

The app is linked to the EAS project **@gnanalytica/realytica**
(`extra.eas.projectId` in `app.json`,
<https://expo.dev/accounts/gnanalytica/projects/realytica>). To build, sign
in to an Expo account with access to the **gnanalytica** organisation:

```bash
npm i -g eas-cli      # or use npx eas-cli
cd mobile
eas login
```

Then:

```bash
eas build -p android --profile preview      # installable APK for testing
eas build -p ios --profile preview          # ad-hoc build; register test iPhones first with `eas device:create`
eas build -p android --profile production   # Play Store bundle (.aab)
eas build -p ios --profile production       # App Store build
eas submit -p android --latest              # after a Play Console service account is set up
```

`eas.json` has three profiles: **development** (a dev client — run
`npx expo install expo-dev-client` before building it), **preview** (internal
distribution, Android APK) and **production** (store builds, build numbers
auto-incremented). Each profile reads EAS environment variables from the
matching environment, e.g.
`eas env:create --environment preview --name EXPO_PUBLIC_REALYTICA_SERVER --value https://staging.example.com`.

Identifiers: bundle id / package `com.gnanalytica.realytica`, URL scheme
`realytica` (`realytica://pair?server=…&code=…` opens the pairing screen filled in).

### Push notifications

The server sends construction alerts worth interrupting someone for (a serious
problem from site, work logged before the approvals allow it, a late milestone)
to the Expo push tokens of the project's construction lead and signer.

Push needs a **development or production build on a real phone**. It does not
work in Expo Go (remote notifications were removed from Expo Go in SDK 53), in a
simulator, or on the web; Settings says which applies. It also needs:

1. a build made after the app was linked to EAS (the Expo push token is issued for the EAS project id);
2. push credentials on EAS: Firebase Cloud Messaging (FCM v1) for Android and an
   APNs key for iOS — `eas credentials` walks through both;
3. optionally `REALYTICA_EXPO_ACCESS_TOKEN` on the API, if push security is
   enabled for the Expo account.

Then Settings › **Alerts on this phone** asks for permission and sends the token
to the server (`POST /devices/push-token`). Tapping a notification opens the
project.

## API endpoints used

All under `${server}/api`. Every call after pairing sends
`Authorization: Bearer <device token>`. Errors are `{ error: string }`, and that
sentence is what the person sees.

| Method | Path | Used for |
|---|---|---|
| POST | `/devices/claim` | Trade a pairing code for the device token (no auth). |
| GET | `/devices/me` | Who this phone is; refreshes name and role. 401 → unpaired. |
| DELETE | `/devices/me` | Sign out. |
| POST | `/devices/push-token` | Turn notifications on (`{ token }`) or off (`{ token: null }`). |
| GET | `/projects` | The projects list. |
| GET | `/projects/:id/site` | The site home: milestones, progress, approvals gate, log, alerts, role. |
| POST | `/projects/:id/site-log/photos` | Upload photos (multipart, field `photos`, ≤ 6 per request). |
| POST | `/projects/:id/site-log` | File the day's entry (idempotent on `clientId`). |
| PATCH | `/projects/:id/milestones/:milestoneId` | Change a milestone's percentage. |
| GET | `/projects/:id/site-log/:entryId/photos/:index` | A filed photo's bytes. |
| POST | `/projects/:id/alerts/read` | Mark alerts read. |
| GET | `/health` | Not called by the screens; handy for checking a server. |

## Project layout

```
src/
  app/                    expo-router routes
    _layout.tsx           providers, start-up (pairing, saved copies, outbox), sync loop
    pair.tsx  scan.tsx    pairing (typed code / QR)
    (site)/               paired-only: tabs for Projects, Outbox, Settings
      projects/           list, and [projectId] site home
    log/[projectId].tsx   the day's log form
    photo.tsx             one photo, full screen
  components/ui/          design-system primitives (Touchable, Button, Card, Chip, Stepper, PercentPicker, Sheet, Skeleton…)
  components/site/        site home pieces (tab bar, entry cards, milestones, stage track, photo thumbnails, freshness)
  components/log/         log form sections
  lib/
    http.ts api.ts        API calls and errors
    session.ts            the pairing (secure store), 401 handling, sign-out
    cache.ts queries.ts   saved copies + TanStack Query reads
    outbox/engine.ts      how the outbox is sent (pure TypeScript)
    outbox/store.ts       the outbox on disk
    outbox/sync.ts        when it is sent
    photos.ts location.ts push.ts drafts.ts haptics.ts
  theme/                  the identity's colours and typefaces, type scale, spacing; motion.ts
assets/images/            icon, adaptive icon, splash, favicon
```

## Checks

```bash
pnpm typecheck                                            # TypeScript, strict
npx expo install --check                                  # dependency versions match SDK 56
npx expo export --platform android --platform ios --output-dir /tmp/realytica-site-export
                                                          # production bundles compile (Hermes)
```

## Known limits

- The web build is for development: no QR scanning, notifications or haptics,
  and photos are kept as data URLs in localStorage, which holds only a few. Its
  animations are Reanimated's web versions, so cards arrive from a little
  further away than on a phone (see `travel()` in `src/theme/motion.ts`).
- On Android, photos chosen from the library usually arrive without GPS (the OS
  strips it unless the app holds `ACCESS_MEDIA_LOCATION`, which it does not ask
  for); camera photos are tagged from the phone's own location.
- Sending happens while the app is open. There is no background sync when the
  app is closed; opening it sends what is waiting.
- A saved entry cannot be edited from the phone; delete it from the outbox and
  log it again if it is wrong before it is sent.
