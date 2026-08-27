# Design-partner feedback — Srikanta Prasad, 2026-08-22

First design-partner conversation for Realytica (68-minute call, recorded).
Srikanta Prasad: ~30 years in Indian commercial real estate (MetLife,
Reliance, Phoenix; ~300 cities), now Fine Line Properties — commercial and
hospital development, residential projects, predominantly **joint
development**, plus buy-side technical due diligence for large acquisitions
(consultant panel, AECOM-style requirement sheets, six-week engagements).
His live example: **37 Cunningham** (MFAR, ~2.5 lakh sq.ft non-SEZ office,
CBD Bengaluru, OC 2024, IGBC Gold, SPV sale).

## What he asked for, in his own priorities

1. **Authentic price discovery.** "We all depend on brokers." India
   under-registers (guidance value vs price, stamp duty), so market data is
   the pain. Even the valuers he knows ask *him* for comparables. He uses
   ChatGPT already; what it lacks is authenticity, traceability and
   reproducibility — which he named unprompted as the reason a bank could
   rely on this product.
2. **JD landowner compensation.** His recurring job: what is the land worth,
   and how should the landowner be compensated in the share.
3. **Site risk category.** BDA / BMRDA / municipal / revenue site — "different
   risk related sites."
4. **Karnataka data layers.** Dishank, **rajakaluve** alignments ("a big red
   flag for any land, but physically there is nothing there"), zoning /
   CDP master-plan status.
5. **Flooding.** A prime criterion for him — he dropped a ~half-million-dollar
   Chennai commercial purchase over flood risk.
6. **Price history and projection.** "What was it 5–10 years back, what is
   the expected price in five years."
7. **Commercial rent/yield.** Buildings are bought on income; buyers want ~8%.
8. **A requirement sheet.** "At some point you will have to list down the
   requirement sheet for evaluation for the commercial or residential
   building."
9. Named limitation he pre-forgave: unregistered side agreements and
   litigation that never reached a court are invisible to any records-based
   check.

## What already existed (demo these, don't rebuild)

- Rajakaluve and lake buffers as `criticalChecks` (assessment profiles).
- `WaterExposureCard` — Bengaluru valley-level flood exposure.
- Site category via the Karnataka pack (jurisdiction, khata, conversion).
- `joint_development` as a first-class assessment profile.

## Built from this conversation (2026-08-27)

- **JD split** (`packages/shared/src/jd-split.ts`): the JDA's sharing ratio
  translated into an implied land price and graded against the land-rate
  band as a share of the residual's gross realisation. Arithmetic on the
  screen's own figures; refuses rather than estimates.
- **Price trajectory** (`packages/shared/src/price-trajectory.ts`): the
  parcel's own registered considerations from the title chain, joined to
  today's indicative mid. Answers his ask #6 in the only honest form:
  the subject's own record (DPDP-safe), with the dutiable-value
  understatement stated, and **no projection** — a forecast is the
  confident wrong number the product principles exist to prevent.
- **Requirement sheet** (`RequirementSheet.tsx`): the profile's required
  documents and critical checks as a copyable checklist — his ask #8.
- **Named gaps**: unassessed water exposure now says so on the constraints
  tab and in the report; the report's scope section states the
  unregistered-agreements blind spot and the physical checks that reach it.

## Still open, ranked

1. **Live market comparables** — his #1. Valytica's
   `src/lib/comparables` stack (99acres + MagicBricks via Zyte, resolver,
   radius gates, honest empty-result classification) is the porting source.
   **Precondition: live probing with a vendor key.** That module's own
   lesson is that adapters built without probing real markup fail silently
   — a dead adapter and a quiet market look identical. Do not port blind.
2. **Rent evidence for commercial** — income capitalisation exists; it needs
   a rent-roll input and reference cap rates per micro-market before the
   income anchor means much on a real office (37 Cunningham is the test).
3. **Screenshot-fed portal checks** — Dishank / Bhoomi / master-plan answers
   extracted from an uploaded screenshot with provenance (Valytica's
   proof-status pattern). The portals block automation; do not build a
   scraper.
4. **SPV-sale awareness** — 37 Cunningham is an SPV share sale; a share
   purchase inherits the SPV's liabilities, which no property document
   shows. At minimum a named limitation; possibly a diligence-side profile.
5. **Flood coverage beyond Bengaluru** — his flooding story was Chennai; the
   valley model is Bengaluru-only and now says so, but coverage is the fix.

## Follow-ups owed

- The write-up promised on the call: what he wants from the product, for his
  review (valuation-first, compliance stripped back — since built as the
  lens/report emphasis rather than a separate product).
- His complementary questionnaire for 37 Cunningham (sent 2026-08-27) and
  the reference documents it requests — his final technical DD management
  report and the cost consultant's requirement sheet are the target output
  formats for the future Diligence product.
- Introduction to Bharat Bhaj (ex-CEO, CapitaLand Singapore) once ready.
