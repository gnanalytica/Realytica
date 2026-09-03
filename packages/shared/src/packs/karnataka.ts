/**
 * Karnataka State / Municipality Pack.
 *
 * Fills the tier the architecture always had a slot for (Global Core + Country
 * Pack + State/Municipality Pack — see `docs/SOURCE_SPEC.md`) but Phase 1 left
 * empty. Everything India's `CountryPack` cannot answer uniformly — the
 * property-register instrument, transaction taxes, the statutory-value basis,
 * and the state's own title/planning checks — lives here instead, calibrated
 * specifically to Karnataka and, for anything municipal, to Bengaluru (BBMP).
 *
 * PROVENANCE DISCIPLINE — read this before editing a number below.
 * Karnataka's guidance values, stamp-duty slabs, cess/surcharge rates and
 * rajakaluve/lake buffer distances are set and revised by circular,
 * notification, NGT order and RMP revision — not by statute alone — and this
 * file is written from general knowledge, not a live check of a current
 * circular. Every such figure is therefore wrapped in `StatutoryRule<T>` with
 * an honest `asOf`, the instrument it is attributed to, and a `verifyNote`
 * telling the user to confirm it before acting on it. Where confidence is
 * genuinely low, `verifyNote` says so explicitly rather than the value being
 * quietly rounded to look more certain than it is.
 */

import type {
  DevelopmentControl,
  AreaBasis,
  BufferRule,
  DutySlab,
  KarnatakaJurisdiction,
  KhataType,
  LandConversionStatus,
  SiteConstraintKey,
  SiteConstraintRule,
  StatePack,
  StatutoryRule,
} from '../types';

/* ------------------------------------------------------------------ */
/* Karnataka enum labels                                               */
/* ------------------------------------------------------------------ */

export const KHATA_TYPE_LABEL: Record<KhataType, string> = {
  a_khata: 'A-Khata (fully compliant)',
  b_khata: 'B-Khata (recorded, not fully compliant)',
  e_khata: 'E-Khata (digitised record issued)',
  gram_panchayat_form_9_11: 'Gram Panchayat (Form 9 & 11) — no BBMP khata',
  none: 'No khata on record',
  unknown: 'Unknown / not yet confirmed',
};

export const JURISDICTION_LABEL: Record<KarnatakaJurisdiction, string> = {
  BBMP: 'BBMP — Bruhat Bengaluru Mahanagara Palike',
  BDA: 'BDA — Bangalore Development Authority',
  BMRDA: 'BMRDA — Bangalore Metropolitan Region Development Authority',
  BIAAPA: 'BIAAPA — Bengaluru International Airport Area Planning Authority',
  gram_panchayat: 'Gram Panchayat',
  unknown: 'Unknown / not yet confirmed',
};

export const LAND_CONVERSION_LABEL: Record<LandConversionStatus, string> = {
  converted: 'Converted to non-agricultural use (DC conversion order on file)',
  agricultural: 'Still agricultural — not converted',
  not_applicable: 'Not applicable (e.g. never agricultural revenue land)',
  unknown: 'Unknown / not yet confirmed',
};

export const AREA_BASIS_LABEL: Record<AreaBasis, string> = {
  carpet: 'Carpet area',
  built_up: 'Built-up area',
  super_built_up: 'Super built-up area',
  unknown: 'Unknown / not stated on the listing or agreement',
};

/* ------------------------------------------------------------------ */
/* BBMP property-tax zones                                             */
/* ------------------------------------------------------------------ */

export interface BbmpTaxZoneInfo {
  zone: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  description: string;
}

/**
 * BBMP's six property-tax zones (A highest unit-area-value, F lowest) are
 * redrawn periodically as wards are added or reclassified — the letter a
 * specific street sits in is a BBMP notification fact, not a fixed geography.
 * The illustrative localities named below match the ones this pack actually
 * carries in `reference.ts`; verify a specific address's zone on the BBMP
 * property-tax portal rather than assuming it from the locality name alone.
 */
export const BBMP_TAX_ZONES: BbmpTaxZoneInfo[] = [
  { zone: 'A', description: 'Core central business district frontage — e.g. MG Road, Vittal Mallya Road, Cunningham Road.' },
  { zone: 'B', description: 'Premium established layouts — e.g. Indiranagar, Koramangala, Jayanagar.' },
  { zone: 'C', description: 'Upscale mid-tier layouts — e.g. HSR Layout, JP Nagar, Malleshwaram.' },
  { zone: 'D', description: 'Established growth corridors — e.g. Whitefield, Hebbal, Thanisandra/Hennur, inner Sarjapur Road.' },
  { zone: 'E', description: 'Outer / IT-led peripheral corridors — e.g. Electronic City, Kanakapura Road, outer Sarjapur Road.' },
  { zone: 'F', description: 'Newly added or far-periphery BBMP wards with the lowest notified unit area value.' },
];

/* ------------------------------------------------------------------ */
/* Namma Metro lines                                                   */
/* ------------------------------------------------------------------ */

export type MetroLineStatus = 'operational' | 'under_construction' | 'recently_commissioned_verify';

export interface MetroLineInfo {
  line: string;
  corridor: string;
  status: MetroLineStatus;
  note: string;
}

/**
 * Named lines used by the locality `infrastructureNote` fields in
 * `reference.ts`. Status is deliberately conservative: a line whose full
 * commissioning date is not something this pack can confirm live is marked
 * `recently_commissioned_verify` rather than asserted as fully operational —
 * see the brief's instruction not to overstate delivered infrastructure.
 */
export const BENGALURU_METRO_LINES: MetroLineInfo[] = [
  {
    line: 'Purple Line',
    corridor: 'Challaghatta — Whitefield (Kadugodi)',
    status: 'operational',
    note: 'Fully operational east-west corridor; the Whitefield (Kadugodi) extension is the reference line for ITPL-area infrastructure notes.',
  },
  {
    line: 'Green Line',
    corridor: 'Madavara — Silk Institute (via Yelachenahalli, Jayanagar, JP Nagar)',
    status: 'operational',
    note: 'North-south corridor through the CBD; the original Nagasandra–Yelachenahalli stretch (with Jayanagar and JP Nagar stations) has been operational since 2021, with a southern extension toward Anjanapura/Silk Institute along Kanakapura Road added later.',
  },
  {
    line: 'Yellow Line',
    corridor: 'RV Road — Bommasandra (Electronics City corridor)',
    status: 'recently_commissioned_verify',
    note: 'Commissioning was phased through 2024–2025; confirm current operational status for a specific stretch before treating it as delivered infrastructure in an Electronic City note.',
  },
  {
    line: 'Pink Line',
    corridor: 'Kalena Agrahara — Nagawara',
    status: 'under_construction',
    note: 'Under construction with no confirmed opening date at time of writing — treat any completion date quoted elsewhere as unverified.',
  },
  {
    line: 'Blue Line',
    corridor: 'Central Silk Board — KR Puram — Hebbal — Yelahanka — Kempegowda International Airport (via Outer Ring Road)',
    status: 'under_construction',
    note: 'Under construction; this is the line most ORR, Hebbal, Yelahanka and airport-corridor notes reference as an upside catalyst, not a present-day amenity.',
  },
];

/* ------------------------------------------------------------------ */
/* Stamp duty, cess, surcharge and registration fee                    */
/* ------------------------------------------------------------------ */

// Karnataka introduced concessional stamp-duty slabs for lower-value
// residential units (2% up to ₹20L, 3% for ₹20–45L) on top of the long-standing
// 5% band above that. This pack models the structure; the exact thresholds and
// any eligibility conditions (e.g. property category, first-registration-only
// rules) are the part most likely to have moved since `asOf` and must be
// re-checked on the Kaveri portal duty calculator before being quoted to a user.
const STAMP_DUTY_SLABS: StatutoryRule<DutySlab[]> = {
  value: [
    // The two lower bands are concessional, not general. `requires` is what
    // stops them being handed to a resale flat or a bare plot: the engine
    // withholds a band whose conditions the file does not establish, quotes
    // the general rate, and says which condition would reduce it.
    { upTo: 2_000_000, pct: 2, requires: ['residential_unit', 'first_registration'] },
    { upTo: 4_500_000, pct: 3, requires: ['residential_unit', 'first_registration'] },
    { upTo: null, pct: 5 },
  ],
  asOf: '2023-01-01',
  source: 'Karnataka Stamp Act 1957, Article 20, as amended by the Karnataka Stamp (Amendment) Act 2022',
  verifyNote:
    'Working from general knowledge of the post-2022 concessional slabs, not a live read of the current notification. The two lower bands are modelled as CONCESSIONAL and are withheld unless the file establishes their conditions, so a figure here is an over-estimate rather than an under-estimate where the conditions are simply unrecorded. Confirm the exact thresholds, and the precise eligibility conditions, on the Kaveri Online Services duty calculator before relying on this for a transaction budget.',
};

// Cess and surcharge are each a percentage OF the stamp duty itself (not of the
// property value), and — this is the part most often mis-modelled — they differ
// by the type of local body the property sits in: gram panchayat areas carry
// cess only, while corporation/BBMP limits add both. The 5% (top slab) + 10%
// cess-of-duty + 2% surcharge-of-duty combination below reconciles with the
// 5.6% headline this codebase's India Country Pack already uses for Karnataka,
// which is itself only correct within BBMP/corporation limits.
const STAMP_DUTY_CESS_PCT: StatutoryRule<number> = {
  value: 10,
  asOf: '2023-01-01',
  source: 'Karnataka Stamp Act 1957, s.3-B (cess within municipal corporation limits)',
  verifyNote:
    'This is the corporation/BBMP-limit cess rate applied on the duty amount, not on the property value. Gram panchayat areas typically carry a different (often lower) combined cess/surcharge with no surcharge at all — do not apply this figure outside BBMP/corporation limits without checking the Kaveri calculator.',
};

const STAMP_DUTY_SURCHARGE_PCT: StatutoryRule<number> = {
  value: 2,
  asOf: '2023-01-01',
  source: 'Karnataka Stamp Act 1957, s.3-B (surcharge within municipal corporation limits)',
  verifyNote:
    'Also computed on the duty amount, and also BBMP/corporation-limit specific — city/town municipal council and gram panchayat areas are known to carry different surcharge treatment. Confirm against the Kaveri portal for the property\'s actual local-body classification.',
};

const REGISTRATION_FEE_PCT: StatutoryRule<number> = {
  value: 1,
  asOf: '2023-01-01',
  source: 'Registration Act 1908, Karnataka Registration Rules — Sub-Registrar fee schedule',
  verifyNote:
    'Modelled as a flat 1% of the dutiable value. Some transaction categories carry a minimum fixed fee rather than a pure percentage — verify the exact fee for this consideration band with the jurisdictional Sub-Registrar or Kaveri Online Services.',
};

/* ------------------------------------------------------------------ */
/* Rajakaluve and lake buffers                                         */
/* ------------------------------------------------------------------ */

// These distances are the single most litigated numbers in Bengaluru property
// screening: NGT orders, RMP revisions and court directions have moved them
// more than once, and — critically — the figure that actually applies depends
// on how BBMP/BDA's own drain map classifies the specific rajakaluve running
// past a given parcel (primary/valley-line vs secondary vs tertiary/minor).
// This pack cannot know that classification for any given case; it can only
// carry the commonly-cited bands and insist the classification be checked.
const BUFFERS: StatutoryRule<BufferRule[]> = {
  value: [
    {
      key: 'rajakaluve_primary',
      label: 'Primary rajakaluve (valley-line storm-water drain)',
      metres: 50,
      appliesTo: 'No-construction buffer measured from the drain edge, for drains classified as primary/valley-line in the BBMP/BDA drain map.',
    },
    {
      key: 'rajakaluve_secondary',
      label: 'Secondary rajakaluve',
      metres: 25,
      appliesTo: 'No-construction buffer for drains classified as secondary in the BBMP/BDA drain map.',
    },
    {
      key: 'rajakaluve_tertiary',
      label: 'Tertiary / minor rajakaluve',
      metres: 15,
      appliesTo: 'No-construction buffer for drains classified as tertiary/minor in the BBMP/BDA drain map.',
    },
    {
      key: 'lake_waterbody',
      label: 'Lake / waterbody buffer',
      metres: 30,
      appliesTo: "No-construction buffer measured from the lake's full tank level (FTL) or the surveyed waterbody boundary.",
    },
  ],
  asOf: '2022-01-01',
  source: 'BBMP/BDA storm-water drain (rajakaluve) buffer classification; NGT orders on Bengaluru lake and drain buffers; RMP 2015 (as revised)',
  verifyNote:
    'These distances have been revised repeatedly by NGT orders, court directions and RMP revisions, and this pack cannot confirm which are currently in force. The distance that actually applies to a given parcel depends on how that specific drain is classified (primary/secondary/tertiary) in the current BBMP/BDA drain map — treat these figures as indicative only, and confirm the drain classification and current buffer for this parcel with BBMP/BDA before relying on them for a go/no-go decision.',
};

/* ==================================================================== */
/* Statutory site constraints                                            */
/* ==================================================================== */

/**
 * The restrictions on a Bengaluru parcel that come from somewhere other than
 * its title, and that no deed will ever mention.
 *
 * --- Why none of these carries a distance ---------------------------------
 *
 * The drain buffers above carry metre figures and are hedged heavily for it,
 * because the figure that actually binds depends on how a specific drain is
 * classified. Every entry here is worse on that axis:
 *
 *   - An aerodrome height cap is computed by the authority from obstacle
 *     limitation surfaces that vary with distance, bearing from the runway
 *     and intervening terrain. There is no radius inside which a single
 *     height applies.
 *   - A transmission clearance is set by the voltage class of that specific
 *     line, and a 66kV line and a 400kV line are not the same restriction.
 *   - A highway control line depends on the road's classification and on
 *     whether a widening notification is currently in force — the second of
 *     which changes without the first changing.
 *
 * So each rule names what is restricted, who decides, and which document
 * settles it, and leaves the number to the authority that computes it. A
 * confident metre figure here would be the same mistake this pack already
 * spent a paragraph apologising for once.
 */
/**
 * Every constraint key, in the order they are checked and shown.
 *
 * Exported so the UI can iterate them without importing the whole pack, and
 * so there is one ordering rather than one per surface.
 */
export const SITE_CONSTRAINT_KEYS: SiteConstraintKey[] = [
  'airport_height',
  'high_tension_line',
  'highway_control_line',
  'railway_boundary',
  'burial_ground',
  'quarry_lease',
];

/**
 * The constraints a person can answer, as opposed to the one the engine
 * answers for itself.
 *
 * `airport_height` is absent because it is computed from the property's
 * location — putting it in a form would invite a user to overrule a measured
 * distance with a guess, and the check already accepts a declared *absence*
 * where somebody has actually applied for the NOC and been told it does not
 * apply.
 */
export const DECLARABLE_SITE_CONSTRAINTS: SiteConstraintKey[] = SITE_CONSTRAINT_KEYS.filter(k => k !== 'airport_height');

const SITE_CONSTRAINTS: StatutoryRule<SiteConstraintRule[]> = {
  value: [
    {
      key: 'airport_height',
      label: 'Aerodrome height restriction (AAI NOC)',
      restriction:
        'Construction within an aerodrome\'s notified vicinity is capped in height by the obstacle limitation surfaces around the runway, and a No Objection Certificate from the Airports Authority of India is a precondition of building-plan sanction. The cap is computed by AAI from the site coordinates, not from a radius, and can be far below the FAR the zoning otherwise permits.',
      authority: 'Airports Authority of India, through the NOCAS application system; the sanctioning authority will not release a plan without it',
      statute: 'Aircraft Act 1934; Aircraft (Demolition of Obstructions caused by Buildings and Trees etc.) Rules 1994; GSR 751(E) Ministry of Civil Aviation height-restriction rules',
      obtain: 'Apply for an AAI height clearance NOC for the exact site coordinates through NOCAS before relying on any development or FAR assumption, and before agreeing a price that prices in the permitted envelope.',
      severityWhenPresent: 'serious',
    },
    {
      key: 'high_tension_line',
      label: 'Overhead transmission line clearance',
      restriction:
        'Statutory vertical and horizontal clearances must be maintained from the conductors of an overhead line, and the corridor beneath a high-tension line is effectively unbuildable. The clearance depends on the voltage class of the specific line. Land under or beside a corridor transacts at a substantial discount and is harder to finance and resell, and none of this appears in the title documents.',
      authority: 'KPTCL or PGCIL for the line itself; the Electrical Inspectorate for clearance confirmation',
      statute: 'Electricity Act 2003; Central Electricity Authority (Measures relating to Safety and Electric Supply) Regulations 2010',
      obtain: 'Obtain written confirmation of the line\'s voltage class and the applicable clearance from KPTCL/PGCIL, and have a licensed surveyor plot the corridor against the site boundary.',
      severityWhenPresent: 'serious',
    },
    {
      key: 'highway_control_line',
      label: 'Highway building line / control line',
      restriction:
        'Land fronting a national or state highway is subject to a building line and a control line measured from the road, inside which construction is restricted or prohibited. Where a widening notification is in force, the setback is larger than the current road edge suggests and the affected strip is liable to acquisition — so a site that measures correctly today can lose its frontage.',
      authority: 'National Highways Authority of India for a national highway; the State PWD or the relevant highway authority for a state highway',
      statute: 'Control of National Highways (Land and Traffic) Act 2002; Karnataka Highways Act 1964',
      obtain: 'Obtain the current building-line and control-line distances for this stretch from the highway authority, together with confirmation of whether a widening or land-acquisition notification is in force.',
      severityWhenPresent: 'serious',
    },
    {
      key: 'railway_boundary',
      label: 'Railway boundary setback',
      restriction:
        'Construction adjoining a railway boundary requires the zone railway\'s clearance and is set back from the boundary. Where a line is being doubled, electrified or converted, the railway\'s land requirement can extend beyond the present boundary.',
      authority: 'The zone railway (South Western Railway for Bengaluru), through its engineering department',
      statute: 'Railways Act 1989; the zone railway\'s standing instructions on construction adjoining railway land',
      obtain: 'Obtain the railway boundary alignment for this stretch and written clearance for any construction, and check whether a doubling or electrification project affects the land requirement.',
      severityWhenPresent: 'warning',
    },
    {
      key: 'burial_ground',
      label: 'Burial ground or crematorium proximity',
      restriction:
        'A notified burial ground or crematorium carries a statutory separation from residential construction, and the land itself cannot be alienated. Beyond the legal position this materially affects resale demand in the Bengaluru market, which is worth knowing before rather than after.',
      authority: 'BBMP or the relevant local body, which maintains the notified list',
      statute: 'Karnataka Municipal Corporations Act 1976; BBMP building bye-laws on separation from notified burial grounds',
      obtain: 'Check the BBMP notified burial-ground list for this ward and confirm the separation the bye-laws require for the intended use.',
      severityWhenPresent: 'warning',
    },
    {
      key: 'quarry_lease',
      label: 'Quarrying or mining lease area',
      restriction:
        'Land within or adjoining a granted quarrying lease carries restrictions on construction and a real risk of ground instability, blasting damage and dust. On the northern and eastern peripheries a granted lease can sit over land also being sold for residential development, and the two rights are irreconcilable.',
      authority: 'Department of Mines and Geology, Karnataka',
      statute: 'Karnataka Minor Mineral Concession Rules 1994; Mines and Minerals (Development and Regulation) Act 1957',
      obtain: 'Search the Department of Mines and Geology records for granted leases over and adjoining this survey number.',
      severityWhenPresent: 'serious',
    },
  ],
  asOf: '2024-01-01',
  source:
    'Aircraft (Demolition of Obstructions) Rules 1994 and AAI NOCAS procedure; CEA (Measures relating to Safety and Electric Supply) Regulations 2010; Control of National Highways Act 2002 and Karnataka Highways Act 1964; Railways Act 1989; BBMP building bye-laws; Karnataka Minor Mineral Concession Rules 1994',
  verifyNote:
    'These entries describe what each restriction is and who decides it — none of them carries a distance, because in every case the binding figure is computed by the authority from facts about the specific site (aerodrome surfaces, line voltage, road classification and any notification in force). Do not infer a clearance from this pack; obtain the named document.',
};


/* ------------------------------------------------------------------ */
/* The pack                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Development control — what may actually be built here               */
/* ------------------------------------------------------------------ */

/**
 * The tables a schematic yield is computed against.
 *
 * Every number here is a norm from the Bengaluru planning framework, not a
 * measurement of any particular site, and the whole block carries one
 * `asOf`/`verifyNote` for the same reason the buffer rules do: the RMP and
 * the BBMP bye-laws are revised, the revisions matter, and a scheme sized
 * against a stale table looks authoritative while being wrong.
 *
 * The road-width FAR table is the one that earns its place. A developer who
 * reads a 3.25 FAR off the zone and buys accordingly, then discovers the plot
 * abuts a 9m road and is capped at 2.25, has lost a third of the scheme
 * between exchange and sanction. Nothing else in this pack changes a number
 * by that much.
 */
const DEVELOPMENT_CONTROL: StatutoryRule<DevelopmentControl> = {
  value: {
    // RMP 2015 residential FAR by abutting road width. Bands are stated
    // metric because the plan is; `PlotAttributes.roadWidthFt` is converted
    // at the point of use rather than here, so the table matches its source.
    farByRoadWidth: [
      { minRoadWidthM: 0, maxRoadWidthM: 9, far: 1.75 },
      { minRoadWidthM: 9, maxRoadWidthM: 12, far: 2.25 },
      { minRoadWidthM: 12, maxRoadWidthM: 18, far: 2.5 },
      { minRoadWidthM: 18, maxRoadWidthM: 24, far: 3.0 },
      { minRoadWidthM: 24, maxRoadWidthM: 30, far: 3.25 },
      { minRoadWidthM: 30, far: 3.35 },
    ],
    // Ground coverage falls as the plot grows — the intent is open space on
    // larger sites, and it binds a villa or row-house scheme long before FAR
    // does.
    groundCoverage: [
      { maxPlotAreaSqm: 240, coveragePct: 75 },
      { maxPlotAreaSqm: 500, coveragePct: 65 },
      { maxPlotAreaSqm: 1000, coveragePct: 60 },
      { maxPlotAreaSqm: 4000, coveragePct: 55 },
      { coveragePct: 50 },
    ],
    // All-round setback by building height. Stated as a single all-round
    // figure rather than front/rear/side, because the per-side split varies
    // with frontage and orientation and quoting four numbers would imply a
    // precision this table does not have.
    setbacks: [
      { maxHeightM: 12, allRoundM: 3 },
      { maxHeightM: 18, allRoundM: 5 },
      { maxHeightM: 24, allRoundM: 6 },
      { maxHeightM: 30, allRoundM: 7 },
      { allRoundM: 9 },
    ],
    parking: [
      {
        appliesTo: ['apartment_project', 'villa_project', 'redevelopment', 'joint_development', 'mixed_use_project'],
        sqmPerSpace: 100,
        visitorPct: 15,
        // A 2.5 x 5.0m bay is 12.5 sqm; the aisle, ramp and column grid
        // roughly double it in a basement, which is why parking eats a
        // scheme's economics rather than its FAR.
        sqmPerSpaceIncludingAisle: 28,
      },
      {
        appliesTo: ['commercial_development'],
        sqmPerSpace: 75,
        visitorPct: 20,
        sqmPerSpaceIncludingAisle: 30,
      },
      {
        appliesTo: ['industrial_development'],
        sqmPerSpace: 200,
        visitorPct: 10,
        // Surface parking and truck standing, not a basement — cheaper per
        // space in construction and far more demanding in area.
        sqmPerSpaceIncludingAisle: 45,
      },
    ],
    floorToFloorM: 3,
  },
  asOf: '2024-01-01',
  source:
    'Revised Master Plan 2015 (as revised) zoning regulations — FAR by abutting road width; BBMP Building Bye-laws — ground coverage, setbacks and parking provision',
  verifyNote:
    'These are the published Bengaluru norms, not a reading of any sanctioned plan. FAR bands, coverage and setbacks ' +
    'differ by zone, by plot size, for corner and TDR-loaded sites, and under premium-FAR provisions; parking norms ' +
    'differ for affordable and mixed-use schemes. The abutting road width that actually applies is the width in the ' +
    'BBMP/BDA road register, which is frequently wider than the carriageway on the ground because it includes a ' +
    'notified widening. Confirm every figure with the jurisdictional planning authority before sizing a scheme, and ' +
    'treat a yield computed here as a first-pass sanity check on whether a site is worth a real feasibility study.',
};

export const KARNATAKA_PACK: StatePack = {
  id: 'karnataka',
  country: 'IN',
  state: 'Karnataka',
  coveredCities: ['Bengaluru'],
  statutoryRateLabel: 'Guidance value',
  statutoryRatePortal: 'Kaveri Online Services — Dept. of Stamps & Registration, Government of Karnataka (kaverionline.karnataka.gov.in)',
  registerInstrumentLabel: 'Khata (BBMP)',
  registrationAuthority: 'Jurisdictional Sub-Registrar, booked and paid for via Kaveri Online Services',
  reraAuthority: 'Karnataka Real Estate Regulatory Authority (K-RERA)',

  // Weights are relative, not percentages — the engine normalises by the actual
  // total (currently 107 across 15 documents), so adding a document does not
  // silently rescale the others.
  //
  // The five that establish "does the seller own this, cleanly, and can it
  // legally be registered" — mother deed, sale deed, encumbrance certificate,
  // khata, latest tax receipt — carry 67 of that 107 between them, deliberately
  // dominating the remaining ten optional/conditional documents so a Bengaluru
  // case cannot score as complete on paperwork that skips the title chain.
  requiredDocuments: [
    {
      kind: 'mother_deed',
      label: 'Mother deed / title chain',
      weight: 16,
      required: true,
      note: 'Establishes the unbroken chain of ownership back to the original grant, allotment or partition that every later transfer depends on.',
    },
    {
      kind: 'title_deed',
      label: 'Sale deed (registered conveyance)',
      weight: 16,
      required: true,
      note: 'The registered instrument that actually transferred ownership to the current holder — without it there is no proof the seller owns what they are selling.',
    },
    {
      kind: 'encumbrance_certificate',
      label: 'Encumbrance certificate (Form 15/16, 30-year)',
      weight: 15,
      required: true,
      note: 'Sub-Registrar record of every registered transaction and charge over the lookback period. A clean Form 16 (nil encumbrance) means no mortgage, lien or pending litigation is recorded; a Form 15 lists what is.',
    },
    {
      kind: 'khata_extract',
      label: 'Khata extract + khata certificate',
      weight: 12,
      required: true,
      note: 'The BBMP register entry confirming the property is recorded in the seller\'s name for tax and utility purposes. Whether it is A-khata (fully compliant) or B-khata (recorded but not compliant) is the single biggest binary in a Bengaluru title screen.',
    },
    {
      kind: 'property_tax_receipt',
      label: 'BBMP property tax paid receipt (latest, with SAS number)',
      weight: 8,
      required: true,
      note: 'Confirms tax dues are current and carries the SAS (Self-Assessment Scheme) application number BBMP uses to trace the property across its systems.',
    },
    {
      kind: 'occupancy_certificate',
      label: 'Occupancy certificate',
      weight: 10,
      required: false,
      note: 'Confirms BBMP inspected the completed building and certified it fit for occupation. Its absence — common even in otherwise reputable Bengaluru developments — is one of the most frequent reasons a bank refuses a home loan on the property.',
    },
    {
      kind: 'conversion_certificate',
      label: 'DC conversion certificate (where the land was agricultural)',
      weight: 6,
      required: false,
      note: 'Required only where the underlying land was originally agricultural revenue land: the Deputy Commissioner\'s order converting it to non-agricultural use. Without it, any building on the land is irregular regardless of what the khata says.',
    },
    {
      kind: 'sanctioned_plan_bbmp',
      label: 'Sanctioned building plan (BBMP)',
      weight: 5,
      required: false,
      note: 'The BBMP-approved plan the built structure is supposed to match. Material deviation from it is what usually blocks occupancy-certificate issuance later.',
    },
    {
      kind: 'form_9_11',
      label: 'Form 9 & 11 (gram panchayat properties)',
      weight: 3,
      required: false,
      note: 'The gram-panchayat equivalent of a khata for areas BBMP has not yet absorbed: Form 9 is the property register extract, Form 11 the tax-paid certificate.',
    },
    {
      kind: 'rera_registration',
      label: 'K-RERA registration',
      weight: 3,
      required: false,
      note: 'Confirms the project is registered with Karnataka RERA, giving statutory recourse on construction delay and defects for an under-construction purchase.',
    },
    {
      kind: 'joint_development_agreement',
      label: 'Joint development agreement (JDA)',
      weight: 3,
      required: false,
      note: 'Where the property was built under a landowner–developer JDA, confirms the developer\'s and landowner\'s shares were clearly partitioned and registered — ambiguity here is a recurring source of Bengaluru title disputes.',
    },
    {
      kind: 'commencement_certificate',
      label: 'Commencement certificate',
      weight: 2,
      required: false,
      note: 'Confirms construction was formally authorised to begin under the sanctioned plan — mainly relevant when buying into a project still under construction.',
    },
    {
      kind: 'betterment_charges_receipt',
      label: 'Betterment charges receipt',
      weight: 2,
      required: false,
      note: 'Confirms development/betterment charges levied by BBMP or BDA for area infrastructure have been paid. Unpaid charges can attach to the property and block a khata transfer at registration.',
    },
    {
      kind: 'possession_certificate',
      label: 'Possession / allotment letter (BDA sites)',
      weight: 2,
      required: false,
      note: 'For a BDA-allotted site, proves the original allottee lawfully took possession from the Bangalore Development Authority before any resale began the chain.',
    },
    {
      kind: 'other',
      label: 'Layout approval plan / release or partition deed (site purchases)',
      weight: 4,
      required: false,
      note:
        'Plot-specific: the layout-approval order (BDA/BMRDA/panchayat/private) sanctioning the subdivision the site sits in, and — where the site was carved out of a larger family or joint holding rather than bought straight from a layout — the registered release or partition deed establishing that the seller\'s individual, undivided share became this specific, identifiable site. Neither has its own document type in this schema; both are filed under "other" until a dedicated plot-document taxonomy exists. A site with no traceable layout-approval order behind it is the paperwork signature of a revenue layout — see the layout approval status title check.',
    },
  ],

  stampDutySlabs: STAMP_DUTY_SLABS,
  stampDutyCessPct: STAMP_DUTY_CESS_PCT,
  stampDutySurchargePct: STAMP_DUTY_SURCHARGE_PCT,
  registrationFeePct: REGISTRATION_FEE_PCT,
  buffers: BUFFERS,
  siteConstraints: SITE_CONSTRAINTS,

  developmentControl: DEVELOPMENT_CONTROL,

  titleChecks: [
    {
      key: 'khata_classification',
      label: 'Khata classification (A vs B)',
      description:
        'Whether the property is fully compliant (A-khata) or provisionally recorded (B-khata). B-khata restricts bank lending, blocks BBMP building-plan sanction, and depresses resale liquidity.',
      statute: 'Karnataka Municipal Corporations Act 1976, s.108; BBMP khata bifurcation guidelines',
      reviewNote:
        'The playbook raises B-khata as a blocker with no route out. Karnataka has legislated routes by which B-khata properties enter the compliant record; where one applies, a permanent blocker is a worse answer than the file supports. Confirm the current regularisation route and record it as the next step rather than softening the severity.',
    },
    {
      key: 'e_khata_issuance',
      label: 'E-Khata issuance',
      description:
        'Whether the digitised e-khata has been issued. A growing number of lenders and the Sub-Registrar\'s own systems treat its absence as a registration or lending blocker even where the underlying (paper) khata is otherwise in order.',
      statute: 'BBMP e-Khata initiative, administered under the Karnataka Municipal Corporations Act 1976',
      reviewNote:
        'This check is written as a lender and systems preference — "a growing number of lenders … treat its absence as a blocker". Karnataka has been moving e-Khata toward a precondition for registration of BBMP properties, which would make this a hard gate rather than a trend, and would change both this wording and the severity the playbook assigns. Confirm the current position on the BBMP e-Khata portal and the Kaveri registration requirements before relying on the softer reading. The statute reference here names an initiative rather than a notification, and should carry the notification once confirmed.',
    },
    {
      key: 'dc_conversion',
      label: 'DC conversion status',
      description:
        'Whether agricultural land was converted to non-agricultural use before development. Unconverted land carries construction-legality and transfer risk irrespective of khata or registration status.',
      statute: 'Karnataka Land Revenue Act 1964, s.95',
    },
    {
      key: 'ptcl_restriction',
      label: 'PTCL granted-land restriction',
      description:
        'Land originally granted to a member of a Scheduled Caste or Scheduled Tribe under the PTCL Act carries transfer restrictions; a chain that includes such a grant can be voided by government order years after an otherwise clean-looking sale.',
      statute: 'Karnataka Scheduled Castes and Scheduled Tribes (Prohibition of Transfer of Certain Lands) Act, 1978',
    },
    {
      key: 'bda_bmrda_acquisition',
      label: 'BDA/BMRDA acquisition or de-notification status',
      description:
        'Whether the parcel was ever acquired for a BDA/BMRDA scheme and, if so, validly de-notified before the current sale. A live acquisition notice defeats the seller\'s title regardless of what the khata or tax receipts show.',
      statute: 'Bangalore Development Authority Act 1976; Bangalore Metropolitan Region Development Authority Act 1985',
    },
    {
      key: 'layout_approval_status',
      label: 'Layout approval status (BDA / BMRDA / panchayat / private / revenue / unapproved)',
      description:
        'Which authority, if any, approved the layout the site sits in. A BDA- or BMRDA-approved layout carries a traceable sanction; a panchayat- or private-approved layout needs that specific approval verified on its own merits. A revenue layout — sites carved directly out of agricultural revenue land and sold by sketch or GPA without any layout-plan sanction — or an outright unapproved layout is a serious, not a minor, finding: BBMP/BDA can refuse khata and building-plan sanction outright, lenders will typically decline to finance it, and the site can be exposed to demolition or resumption action even where the sale deed itself registered without issue. This is the single most consequential fact about a plot that a flat purchase never has to establish.',
      statute: 'Karnataka Town and Country Planning Act 1961, ss.17 & 32; Bangalore Development Authority Act 1976; Karnataka Land Revenue Act 1964, s.95 (conversion of the underlying revenue land)',
    },
    {
      key: 'gram_panchayat_form_limits',
      label: 'Gram panchayat Form 9/11 limits',
      description:
        'Form 9/11 properties sit outside BBMP\'s building-plan and khata regime. Confirms the panchayat\'s own record and tax-paid status, and flags whether BBMP conversion is pending for an area since annexed into city limits.',
      statute: 'Karnataka Panchayat Raj Act 1993',
    },
    {
      key: 'rajakaluve_lake_buffer',
      label: 'Rajakaluve and lake buffer encroachment',
      description:
        'Whether the parcel or structure falls inside the no-construction buffer of a storm-water drain or lake — grounds for demolition that override an otherwise clean title.',
      statute: 'Karnataka Town and Country Planning Act 1961; NGT orders on Bengaluru lake and drain buffers',
      reviewNote:
        'The distance that applies depends on how BBMP/BDA classify the specific drain, which this pack cannot know — so the output is a caveat rather than an answer. Obtaining the drain map and lake FTL boundaries as geodata would convert this check from something to go and verify into something the screen decides.',
    },
    {
      key: 'occupancy_certificate_compliance',
      label: 'Occupancy certificate compliance',
      description:
        'Whether the completed structure matches the sanctioned plan closely enough for BBMP to issue an occupancy certificate. Deviation is the most common reason a Bengaluru apartment is refused one.',
      statute: 'Karnataka Municipal Corporations Act 1976, s.310',
    },
    {
      key: 'krera_registration',
      label: 'K-RERA registration',
      description:
        'Whether a project that should be registered with K-RERA (under construction, or completed after RERA\'s applicability cutoff) actually is. An unregistered project that should be registered is itself a red flag.',
      statute: 'Real Estate (Regulation and Development) Act 2016, as administered by K-RERA',
    },
    {
      key: 'encumbrance_continuity',
      label: '30-year encumbrance continuity',
      description:
        'Whether the encumbrance certificate covers an unbroken 30-year (or since-inception) window with no unexplained gaps — a gap is exactly where an undisclosed mortgage or pending litigation hides.',
      statute: 'Registration Act 1908, s.57',
    },
  ],

  datasets: [
    'Kaveri Online Services (Dept. of Stamps & Registration, Karnataka)',
    'BBMP Sakala / property tax roll',
    'BBMP e-Khata portal',
    'K-RERA project registry',
    'Survey & Settlement and Land Records (Bhoomi)',
    'BDA/BMRDA notifications and de-notification orders',
    'RMP 2015 land-use plan (as revised)',
  ],

  notes:
    'Karnataka sets the property-register instrument (khata), stamp duty, registration fees and the guidance-value basis at state level, and Bengaluru\'s municipal rules (BBMP khata, tax zones, rajakaluve/lake buffers) further narrow what applies to any other Karnataka town. Stamp duty and registration are charged on the higher of the transacted consideration and the guidance value — never on consideration alone — so a below-guidance sale price does not reduce the transaction-cost bill. Every statutory figure in this pack (duty slabs, cess, surcharge, buffer distances) is carried with an `asOf` date and a verify note precisely because these are the numbers most likely to have moved since this pack was written; treat the pack as a structured starting point for a check, not as a substitute for confirming the current circular.',
};
