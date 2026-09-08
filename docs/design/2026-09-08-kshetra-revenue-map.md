# Kshetra on the file: the revenue map as a record

*2026-09-08 — integration branch `kshetra-integration`. Discussed first, then built.*

## What Kshetra is

`gnanalytica/kshetra` is a public, no-login app: pick a survey number in
Telangana or the Bengaluru region of Karnataka, and it fetches the parcel from
the state's own cadastre (TGRAC layers in Telangana, K-GIS in Karnataka),
reads the government layers around it — tanks, nalas, flood lines, road and
rail alignments, industrial land, master-plan zoning, the Section 22-A
prohibited register — and turns that into factors, insights and a value band
anchored on the published guidance rate (IGRS snapshot for Telangana, a dated
Kaveri capture for Karnataka).

Its engine has no React and no database. It is plain TypeScript with fetch and
about 16 MB of captured tables. That is what this branch brings in.

## Where it lands

Two repos stay two repos. The engine is vendored here as a workspace package,
`packages/site-intel`, with its seven pure suites run by `pnpm test` through
thin wrappers in `test/site-intel/`. Nothing else in Realytica imports the
engine directly: one file, `apps/api/src/gis/revenue-map.ts`, calls it and
translates the answer into `RevenueMapRead`, which `packages/shared` owns.

| Layer | What changed |
| --- | --- |
| `packages/shared` | `BoundarySource` gains `revenue_map`. `DdProject.revenueMap`. `revenue-map.ts`: the record, `applyRevenueMap`, `clearRevenueMap`. The GIS overlay gains seven `state_*` feature kinds, eight `revenue_*` hit codes, and a standing of `record`. |
| `apps/api` | `GET /projects/:id/gis-overlay/revenue/levels` (the picker, one level at a time), `POST …/revenue` (read for a survey number), `DELETE …/revenue`. The overlay GET passes the stored read through. Budgeted with `limits.expensive`. |
| `apps/web` | `RevenueMapPicker` inside the GIS overlay card: state → district → mandal/taluk → village → survey number → "Read the revenue map". The state's layers draw as a toggleable group, heavier than OSM, hatched so they never read as the parcel. |

## The three decisions

**Standing.** Everything on the overlay was `context` (OSM, OpenCity) or
`survey` (an outline a person supplied). A revenue-map read is neither. The
ring is the government's own published boundary for that survey number; the
tank is the state's water-body layer; the zone is the planning authority's
polygon. That is stronger than a volunteer's blue shape. It is still
machine-read from a server with no SLA, and the register carries its own
survey error. So it gets a standing of its own, `record`, and the rule that
nothing is evidence until a person files the extract does not move. The
overlay's `notEvidence: true` stays true. Nothing enters the evidence
register or the project graph — `test/revenue-map.test.ts` asserts both.

**The boundary.** The parcel ring becomes `surveyBoundary` only when nobody
has supplied one. A surveyor's upload outranks the register, and a fresh read
never overwrites it; instead the two are compared, and a difference of 5% or
more is a flag that keeps both figures (`revenue_extent`). A read replaces
only a boundary an earlier read supplied. Clearing the read takes its boundary
with it and leaves a person's alone.

**The number.** The engine's value band does not cross over. Realytica has a
valuation model with its own anchors and externality rules; what it wants from
the revenue map is the geometry, the distances, and the published rate. The
rate crosses as the state published it, with the engine's market multiple
divided back out, because that multiple is the engine's assumption and this
file's valuer may hold a different one. Factor percentages are carried on the
record for audit but never printed in a hit: a reader who sees "−12%" beside a
lake will treat it as the adjustment rather than as one engine's opinion of one.

## The portal policy

`portals.ts` lists `kaveri.karnataka.gov.in` as a host this product never
fetches. Kshetra's capture scripts read Kaveri's public, no-login
guidance-value endpoints. That is a different act from scraping an
encumbrance certificate behind OTP, but it is still a fetch of that host, and
it happens in Kshetra's repo, offline, on purpose, producing a dated table.
**Realytica never fetches Kaveri.** The runtime reads the table the engine
ships, which is why every anchor hit ends with "as published, read on
<date>". Whether Realytica should ever refresh that table itself is a policy
question for the owner, not something this branch decides.

The state map servers (TGRAC, K-GIS) are public ArcGIS and generic web
services with no login and no CAPTCHA. They are fetched live, from the API,
with the engine's timeouts and its on-disk snapshot for the picker when they
are down.

## What Realytica gains that it could not do before

- **The parcel without a surveyor.** The overlay drew a pin. Now it draws the
  register's boundary for the survey number on the file.
- **A check for the worst finding in this repo.** "A transliterated identifier
  names another plot" (2026-08-30) describes a well-formed but wrong survey
  number that nothing catches. The read refuses a survey number that is not
  in that village's map, and names the nearest ones that are.
- **Distances from statute, not from OSM.** The lake and drain the externality
  rules want are now measured from the state's own layers. Feeding those into
  `applyExternalities` is the obvious next step and is not on this branch.
- **Telangana**, for a file that has a Telangana survey number.

## Not on this branch

- Feeding the read into the externality rules and the guidance-value sitting.
- Prefilling the picker's district and village from the project's address.
- The Kshetra public app itself. It stays in its own repo and its own
  deployment; only the engine is here.
- A findings entry for the Kaveri policy, pending the owner's decision above.

## Running it

```bash
pnpm install
pnpm dev                    # web on 5173, api on 5174
```

Open a project, find the GIS overlay card, pick Karnataka → Bengaluru (Urban)
→ Anekal → Anekal (Kasaba), survey number 10, and read. Expect a parcel ring,
Anekal Kere as a state water feature, a residential zone from the BMRDA
sheet, and the Kaveri guidance value for Anekal Kasaba as an anchor note.

`pnpm check` runs the engine's suites alongside the rest.
