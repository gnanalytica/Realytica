# Valytica — Property Intelligence

> Understand a property **before** you commit money, professional effort, financing or acquisition
> resources.

Valytica is an AI-powered property intelligence platform. This repository contains the MVP release —
**Valytica Property Screen** — as a local-first, installable `pnpm` application. It answers one
question end to end: *should I pursue this property?*

The product definition this build implements is transcribed in
[`docs/SOURCE_SPEC.md`](docs/SOURCE_SPEC.md).

---

## Quick start

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:5173**.

`pnpm dev` runs both processes:

| Process | Port | What it is |
| --- | --- | --- |
| `@valytica/web` | 5173 | Vite + React UI |
| `@valytica/api` | 5174 | Express API, JSON-file store, screening engine |

The API auto-seeds four demo cases (two Indian, two Dutch) on first boot, so the app is populated
the moment it opens. Wipe them from **About → Reset demo data**.

**Requirements:** Node 20.10+ and pnpm 10+. Nothing else — no database, no cloud account, no API key.
Everything runs on your machine and all state lives in `apps/api/data/`.

### Other commands

```bash
pnpm dev:web      # UI only (expects the API on 5174)
pnpm dev:api      # API only
pnpm build        # production build of the web app
pnpm start        # serve the production build alongside the API
pnpm typecheck    # strict typecheck across the whole workspace
pnpm clean        # remove node_modules and build output
```

---

## What Property Screen does

Create a property case, upload whatever documents you have, and run a screen. Valytica produces:

- **A property snapshot** — what this property is, in a paragraph.
- **An indicative value range** — a low/mid/high band, never a single fake-precise number, blended
  from **multiple independent anchors**: comparable sales, statutory reference (circle rate in
  India, WOZ in the Netherlands), income capitalisation, depreciated replacement cost, an adjusted
  asking price, and an index trend. Each anchor carries its own range, weight, confidence and
  written rationale, so you can see where the methods disagree.
- **Market comparables** with the adjustments applied to each one shown line by line.
- **Value drivers** — what is pushing this property above or below the locality median, and by how
  much, with the reasoning attached.
- **Material risk flags** — title, planning, structural, financial, market, tenancy, environmental
  and data risks, each with an impact and a mitigation, and a status you can move to
  *mitigated* or *accepted*.
- **Planning position** — zoning, permitted uses, FAR used against FAR allowed, and the buildable
  headroom that remains.
- **Document completeness** — what the country pack expects, what you have, and what is missing.
- **A confidence score** with the factor-by-factor arithmetic that produced it, and a statement of
  the single change that would raise it most.
- **An evidence ledger** — every figure in the app traces back to a document, an external dataset, a
  comparable, your own input, or an explicitly-labelled model inference.
- **Recommended actions** grouped into *now*, *before offer* and *before completion*.
- **A Property Screen report** — the whole thing as one print-ready document.

You can also **compare 2–4 cases** side by side.

## What it explicitly does not do

Straight from the product definition, and enforced in the UI copy: this is **not** a certified
valuation, a legal title certificate, a formal legal opinion, an engineering inspection, a lending
approval, a formal mortgage valuation, a full project feasibility, or an automated purchase
recommendation without explanation.

---

## Product principles, and where you can see them

| Principle | Where it shows up |
| --- | --- |
| **Evidence Before Assertion** | Every number carries an evidence chip that opens the ledger entry behind it |
| **Range Before False Precision** | Values are bands; the range widens visibly when confidence is low |
| **Explain the Why** | Anchors, drivers, risks and the verdict all carry written rationale |
| **Uncertainty Must Be Visible** | Confidence scores, spread percentages, low-confidence extraction flags, and a "what we could not verify" panel on the snapshot |
| **Drive Action** | Every screen ends in a prioritised, owned, checkable action list |

---

## Architecture

```
valytica/
├── apps/
│   ├── api/                 @valytica/api  — Express + JSON-file store
│   │   ├── src/routes/      cases · documents · screen · reference · demo
│   │   └── data/            your local state (gitignored)
│   └── web/                 @valytica/web  — Vite + React + Tailwind
│       └── src/
│           ├── components/  UI kit, layout, hand-written SVG charts
│           ├── lib/         API client, formatters, theme tokens
│           └── pages/       dashboard · new case · case workspace · compare · about
├── packages/
│   └── shared/              @valytica/shared — domain contract + screening engine
│       └── src/
│           ├── types.ts     the frozen domain model both apps build against
│           ├── engine.ts    classification, extraction, valuation, scoring
│           └── reference.ts country packs and locality market data
└── docs/SOURCE_SPEC.md      the transcribed product definition
```

**Global Core + Country Pack**, with per-locality market data. The core engine is
country-agnostic; India and the Netherlands each supply a country pack (currency, parcel identifier,
expected documents, statutory rate basis, transaction taxes, registry names), and each locality
supplies market data (median price per m², statutory rate, yield, liquidity, zoning, FAR,
replacement cost, an eight-quarter trend).

### The Karnataka / Bengaluru State Pack

All three tiers of the specified architecture are implemented — Global Core, Country Pack and
**State / Municipality Pack**. Karnataka is the first state pack, and it is where a Bengaluru title
screen actually lives:

| What | Karnataka pack |
| --- | --- |
| Statutory value | **Guidance value** (Kaveri Online Services) — not "circle rate" |
| Property register | **Khata (BBMP)**, with the A / B / e-khata distinction as a first-class field |
| Transaction tax | Banded stamp duty, cess and surcharge computed **on the duty**, registration fee on value — charged on the **higher of consideration and guidance value** |
| Title checks | Khata classification · e-khata issuance · DC land conversion (KLR Act s.95) · PTCL Act 1978 granted land · rajakaluve and lake buffers · occupancy certificate · 30-year EC continuity · K-RERA · BDA/BMRDA acquisition · quoted area basis |
| Documents | 14 Bengaluru-specific documents, weighted so the five title-chain deal-breakers dominate completeness |

The **Compliance** tab surfaces these as pass/attention/blocker findings, each with its statute, the
commercial consequence, and the next step. Blockers — a B-khata classification, unconverted
agricultural land — render above everything and cannot be filtered out of view, because they are the
findings that should stop someone before they spend money on lawyers.

Areas display in **square feet** and rates in **₹/sq ft** for Indian cases, with a toggle. The domain
model stores square metres throughout; a Dutch case keeps m² and €/m².

### Statutory values are versioned, not asserted

Guidance values, stamp-duty slabs and buffer distances change by circular, notification and court
order. Every statutory value in a state pack is a `StatutoryRule` carrying an `asOf` date, its source
instrument, and a verify-before-relying note, all shown in the UI beside the numbers they drive.

**Treat the shipped figures as placeholders to confirm against current circulars.** The rajakaluve
and lake buffer distances especially: the applicable setback depends on how BBMP/BDA classify that
specific drain and has been revised repeatedly by NGT orders, so the app tells you to commission a
survey rather than asserting a distance.

### Coverage

| Country | Covered | Why it is bounded |
| --- | --- | --- |
| India | **Karnataka (Bengaluru)** | Stamp duty, registration fees and the property-register instrument are set at *state* level. A Khata extract is a Karnataka instrument; Telangana or Maharashtra would expect a different document entirely. |
| Netherlands | Noord-Holland, Utrecht, Zuid-Holland | Dutch conveyancing instruments (Kadaster, WOZ, energielabel) are national, so only market-data reach is limited — not the rules. |

A case entered outside a covered state still screens, but raises a material risk saying the document
checklist, statutory anchor and transaction costs are not that state's — rather than silently
measuring the property against the wrong rules.

The screening engine is **deterministic** — seeded by case id, no wall-clock or random input inside
scoring — so the same case always produces the same result and a re-run is diffable. Document
classification and field extraction are simulated locally against filename and document-kind
patterns; there is no external model call and nothing leaves your machine.

### Adding a market

Add a `CountryPack` and its `LocalityReference` entries in `packages/shared/src/reference.ts`, and a
`StatePack` under `packages/shared/src/packs/` where the state sets its own rules. The
engine, the API and every screen pick it up without further change — that is what the pack
architecture buys.

---

## Roadmap (from the product definition)

| Phase | Scope |
| --- | --- |
| 1 — MVP | India, one state/metro, one property type, professional users first |
| 2 | Second property type and geography, comparison, collaboration, deeper diligence, professional review, more data integrations |
| 3 | Netherlands Country Pack |
| 4 | Valytica Project Intelligence |
| 5 | Valytica Portfolio Intelligence |

The product family beyond Property Screen: **Diligence** (*what exactly am I getting into?*),
**Project Intelligence** (*does this opportunity make commercial sense?*) and **Portfolio
Intelligence** (*where are the risks and opportunities across our properties?*).

---

## Note on the data in this build

The reference market data, comparable transactions and document extraction in this MVP are
**realistic but synthetic** — calibrated to plausible magnitudes for each locality so the product
can be evaluated end to end, not sourced from live registries. Wiring the country packs to real
feeds (IGR/RERA/municipal rolls in India; Kadaster/BAG/CBS in the Netherlands) is Phase 2 work.
Nothing in the UI presents synthetic data as a verified fact: every figure carries its source type
in the evidence ledger.
