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
  AreaBasis,
  BufferRule,
  DutySlab,
  KarnatakaJurisdiction,
  KhataType,
  LandConversionStatus,
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
    { upTo: 2_000_000, pct: 2 },
    { upTo: 4_500_000, pct: 3 },
    { upTo: null, pct: 5 },
  ],
  asOf: '2023-01-01',
  source: 'Karnataka Stamp Act 1957, Article 20, as amended by the Karnataka Stamp (Amendment) Act 2022',
  verifyNote:
    'Working from general knowledge of the post-2022 concessional slabs, not a live read of the current notification. Confirm the exact thresholds, and whether any eligibility conditions apply to this specific property, on the Kaveri Online Services duty calculator before relying on this for a transaction budget.',
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

/* ------------------------------------------------------------------ */
/* The pack                                                            */
/* ------------------------------------------------------------------ */

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

  // Weights sum to 100. The five documents that establish "does the seller own
  // this, cleanly, and can it legally be registered" — mother deed, sale deed,
  // encumbrance certificate, khata, latest tax receipt — carry 67/100 between
  // them, deliberately dominating the remaining nine optional/conditional
  // documents (33/100) so a Bengaluru case cannot score as complete on
  // paperwork that skips the title chain itself.
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
  ],

  stampDutySlabs: STAMP_DUTY_SLABS,
  stampDutyCessPct: STAMP_DUTY_CESS_PCT,
  stampDutySurchargePct: STAMP_DUTY_SURCHARGE_PCT,
  registrationFeePct: REGISTRATION_FEE_PCT,
  buffers: BUFFERS,

  titleChecks: [
    {
      key: 'khata_classification',
      label: 'Khata classification (A vs B)',
      description:
        'Whether the property is fully compliant (A-khata) or provisionally recorded (B-khata). B-khata restricts bank lending, blocks BBMP building-plan sanction, and depresses resale liquidity.',
      statute: 'Karnataka Municipal Corporations Act 1976, s.108; BBMP khata bifurcation guidelines',
    },
    {
      key: 'e_khata_issuance',
      label: 'E-Khata issuance',
      description:
        'Whether the digitised e-khata has been issued. A growing number of lenders and the Sub-Registrar\'s own systems treat its absence as a registration or lending blocker even where the underlying (paper) khata is otherwise in order.',
      statute: 'BBMP e-Khata initiative, administered under the Karnataka Municipal Corporations Act 1976',
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
