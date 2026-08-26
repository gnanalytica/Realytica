/**
 * The data-source registry: every external source Valytica knows about, and —
 * for the ones it cannot reach — an explicit statement of what was therefore
 * not checked.
 *
 * WHY THIS IS A DECLARATION AND NOT A CRAWLER
 * -------------------------------------------
 * The authoritative Indian property registries (Kaveri for registration and
 * encumbrance, Bhoomi for revenue records, BBMP for khata and property tax)
 * sit behind logins, OTPs, CAPTCHAs and stateful multi-step forms. There is
 * no supported machine interface, automated access is not authorised, and an
 * agent that tries anyway achieves three bad things at once: it burns budget
 * rediscovering a wall that has not moved in years, it produces a failure the
 * user cannot distinguish from "nothing was registered against this title",
 * and it puts load on a public service that never invited it.
 *
 * So reachability is *declared here, once*, and the pipeline honours the
 * declaration: `runIngestion` records a declared-unreachable source as
 * `outcome: 'unreachable'` carrying `whatItWouldHaveAnswered`, and never opens
 * a socket for it. `packages/agents/src/tools/exploration-tools.ts` reaches
 * the same conclusion for the *explorer* by feeding hostnames to the server
 * tools' `blocked_domains`; this file is the ingestion-side equivalent and is
 * deliberately wider (it also covers the routes that genuinely work).
 *
 * WHAT ACTUALLY WORKS
 * -------------------
 * Two things, and this registry is honest that it is only two.
 *
 * 1. `file_upload` — the operator downloads the guidance-value table, the EC,
 *    the tax statement or the K-RERA extract themselves and supplies the file.
 *    A human passing a CAPTCHA and then handing us a CSV is not a workaround;
 *    it is the supported route, and for Karnataka it is the *only* route to
 *    real registry data. Every such source carries a `manualRoute` that names
 *    the office or portal and what to take, so the instruction is executable
 *    rather than aspirational.
 *
 * 2. `open` — a source that answers an unauthenticated HTTP request. At the
 *    time of writing the only entries that qualify are the two Dutch PDOK
 *    services, both verified live from this workspace (see `accessBasis`).
 *    **No Karnataka source is classified `open`**, because none was verified
 *    to be, and claiming otherwise would be the same lie in the other
 *    direction.
 *
 * PROVENANCE DISCIPLINE — read before editing an entry below.
 * Access classification, portal names and URLs for the Indian sources are
 * written from general knowledge of how these services work, not from a live
 * check made from this environment; government portals are periodically
 * rebranded and re-gated. Each entry therefore carries `accessVerified` and an
 * `accessBasis` sentence saying on what footing the classification stands, and
 * anything marked `general_knowledge` should be re-confirmed before a user is
 * told a source is or is not reachable. Following the same rule as the
 * Karnataka pack and the proof-route corpus, **no form number, Sakala service
 * code or fee is stated anywhere in this file** — where one would normally be
 * quoted, the step is described without it rather than invented.
 */

import type {
  CountryCode,
  DataSourceDescriptor,
  IngestedRecordType,
  PropertyIdentity,
  PropertyType,
  SourceAccess,
  SourceKind,
} from '@valytica/shared';

/* ------------------------------------------------------------------ */
/* Registry-internal extensions to the contract type                   */
/* ------------------------------------------------------------------ */

/**
 * How firmly the `access` classification stands up.
 *
 * Kept separate from `access` itself because "this is blocked" and "we checked
 * that this is blocked" are different claims, and a registry that cannot tell
 * them apart will eventually assert the first while only having evidence for
 * a stale version of the second.
 */
export type AccessVerification =
  /** Exercised from this workspace against the live service. */
  | 'live'
  /** Written from general knowledge of the service; not checked from here. */
  | 'general_knowledge';

/** Which case identities a source can say anything useful about. */
export interface SourceApplicability {
  countries: CountryCode[];
  /** Undefined means every state/province in `countries`. */
  states?: string[];
  /** Undefined means every city. Matched case-insensitively. */
  cities?: string[];
  /** Undefined means every property type. */
  propertyTypes?: PropertyType[];
  /**
   * Karnataka jurisdictions this source covers. A BBMP portal has nothing to
   * say about a gram panchayat property, and reporting it as "unreachable"
   * there would overstate what is missing — it is out of scope, not blocked.
   */
  karnatakaJurisdictions?: string[];
  /** Stated verbatim in the `skipped` note when the gate rejects a case. */
  scopeNote: string;
}

/** Column-level intake contract for an operator-supplied file. */
export interface FileIntakeSpec {
  /** What the rows in this file are. */
  recordType: IngestedRecordType;
  /** `csv` covers any single-character-delimited text; `json` covers arrays and GeoJSON. */
  formats: ('csv' | 'json')[];
  /**
   * Canonical field keys a row must resolve before it is accepted. A row that
   * cannot fill one of these is rejected with the missing key named — never
   * dropped silently.
   */
  requiredFields: string[];
  /**
   * Default unit for an area or rate column whose header does not state one.
   * Absent on purpose for the Indian sources: an unlabelled Indian area column
   * could be sqft, guntha or cent, the three differ by two orders of
   * magnitude, and guessing is how a site gets mispriced by 40x. Where this is
   * absent the row is rejected rather than assumed.
   */
  defaultAreaUnit?: string;
  /** Same reasoning, for the denominator of a rate column (`₹ per <unit>`). */
  defaultRateUnit?: string;
  /** One line telling the operator what a good file looks like. */
  expectedShape: string;
}

/**
 * A WFS 2.0 endpoint, declared rather than coded.
 *
 * Only ever populated for an `open` source. The declaration is data so that
 * `adapters/http.ts` owns all the request-building and this file stays a
 * catalogue — and so that a reader can see exactly which attributes of a case
 * leave the machine, which matters for a tool that handles private
 * transaction data.
 */
export interface WfsEndpointSpec {
  protocol: 'ogc_wfs_2_0';
  baseUrl: string;
  typeName: string;
  /** Upper bound on features requested. One request, bounded, no paging. */
  count: number;
  /**
   * WFS attribute name -> the case-derived key that fills it. Every listed
   * filter must resolve or the source reports `no_match` without a request:
   * an unfiltered GetFeature against a national register would return the
   * wrong parcel with total confidence.
   */
  filters: { attribute: string; from: CaseDerivedKey }[];
  /** Filters applied only when the case can supply them. */
  optionalFilters?: { attribute: string; from: CaseDerivedKey }[];
  recordType: IngestedRecordType;
  /** Units the service publishes in, so the normaliser need not guess. */
  defaultAreaUnit?: string;
}

/**
 * Values derivable from a `PropertyIdentity` without a network call or a
 * model. Deliberately a closed list: it is also the disclosure list for what
 * a query sends to a third party.
 */
export type CaseDerivedKey =
  /** Dutch postcode, normalised to `1073AK`. */
  | 'nl_postcode'
  /** Leading integer of the Dutch house number. */
  | 'nl_house_number'
  /** Kadastrale gemeente from `parcelId`, title-cased (`Amsterdam`). */
  | 'nl_kadastrale_gemeente'
  /** Section letter(s) from `parcelId` (`P`). */
  | 'nl_sectie'
  /** Parcel number from `parcelId` (`8765`). */
  | 'nl_perceelnummer';

/**
 * A `DataSourceDescriptor` plus the operational detail the pipeline needs.
 *
 * The contract type is what leaves this package (`toDescriptor`); the extra
 * fields stay here so `packages/shared` need not learn about WFS filters.
 */
export interface RegisteredSource extends DataSourceDescriptor {
  /** Hostnames this source lives on — the join to the explorer's block list. */
  hostnames: string[];
  accessVerified: AccessVerification;
  /** Why `access` is what it is, in one or two sentences. */
  accessBasis: string;
  /** What this source can put into a case, if it answers at all. */
  produces: IngestedRecordType[];
  /** Entries in `KARNATAKA_PACK.datasets` / `CountryPack.datasets` this corresponds to. */
  packDatasets?: string[];
  applicability: SourceApplicability;
  /** Present iff `access === 'file_upload'`. */
  fileIntake?: FileIntakeSpec;
  /** Present iff `access === 'open'`. */
  endpoint?: WfsEndpointSpec;
  /**
   * For an operator-file route: the portal id the file is obtained from. Lets
   * the report say "Kaveri EC itself is gated; the extract you supplied came
   * from it" instead of listing two apparently unrelated sources.
   */
  obtainedFrom?: string;
}

/* ------------------------------------------------------------------ */
/* Karnataka — Department of Stamps & Registration (Kaveri / IGR)      */
/* ------------------------------------------------------------------ */

const KA = 'Karnataka';

const KAVERI_HOSTS = ['kaveri.karnataka.gov.in', 'kaverionline.karnataka.gov.in', 'igr.karnataka.gov.in'];

const KAVERI_EC: RegisteredSource = {
  id: 'in.ka.kaveri.ec',
  label: 'Kaveri Online Services — encumbrance certificate search',
  authority: 'Department of Stamps and Registration, Government of Karnataka (IGR)',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'auth_required',
  url: 'https://kaverionline.karnataka.gov.in/',
  hostnames: KAVERI_HOSTS,
  accessVerified: 'general_knowledge',
  accessBasis:
    'EC search on Kaveri requires a registered citizen account with mobile/email verification, and the search form is additionally CAPTCHA-gated. There is no published machine interface. Classified auth_required rather than captcha because the account is the harder gate — passing the CAPTCHA alone gets you nothing.',
  whatItWouldHaveAnswered:
    'The registered encumbrance history for this survey number / PID over the requested period — every sale deed, gift, partition, mortgage, lis pendens and attachment recorded against the title, and the periods with no entry. This is the single most load-bearing document in a Karnataka title screen; without it the chain of title rests entirely on what the seller chose to hand over.',
  manualRoute:
    'Two routes. Online: register a citizen account on Kaveri Online Services with a mobile number and email, log in, open the encumbrance-certificate search, and search by property schedule (district, taluk, hobli, village, survey number or PID) for the period you need; the certificate downloads as a PDF. In person: apply at the jurisdictional Sub-Registrar office for the village the property sits in, on the application the counter issues, with the full property schedule, the period to be searched, and applicant photo ID. Note that computerised indices at most Bengaluru SROs start somewhere in the late 1990s to 2000s — a genuine 30-year search on an older property needs a manual register search at the SRO, and Bengaluru SRO jurisdictions have been redrawn more than once, so confirm which office holds the older volumes before filing.',
  produces: ['encumbrance', 'instrument'],
  packDatasets: ['Kaveri Online Services (Dept. of Stamps & Registration, Karnataka)'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka registrations only; a property registered in another state is indexed elsewhere.',
  },
};

const KAVERI_CERTIFIED_COPY: RegisteredSource = {
  id: 'in.ka.kaveri.certified_copy',
  label: 'Kaveri Online Services — certified copy of a registered instrument',
  authority: 'Department of Stamps and Registration, Government of Karnataka (IGR)',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'auth_required',
  url: 'https://kaverionline.karnataka.gov.in/',
  hostnames: KAVERI_HOSTS,
  accessVerified: 'general_knowledge',
  accessBasis:
    'Certified-copy issue requires a logged-in account and a paid application; the document is released to the applicant, not published. No machine interface.',
  whatItWouldHaveAnswered:
    'The registrar-certified text of a specific registered deed — the actual schedule, extent, consideration and parties as registered, rather than as reproduced in a photocopy the seller supplied. It is the only way to prove a produced deed matches the register, which is what defeats a fabricated or altered copy.',
  manualRoute:
    'Apply through the Kaveri citizen account, or at the Sub-Registrar office where the deed was originally registered, quoting the registration number and year (and the book/volume/page where the deed itself records them). Take the applicant\'s photo ID and any copy of the deed you already hold, since the counter matches the schedule against the index. Where the original SRO\'s jurisdiction has since been redrawn, the volumes may now sit with a different office — confirm before travelling.',
  produces: ['instrument'],
  packDatasets: ['Kaveri Online Services (Dept. of Stamps & Registration, Karnataka)'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka registrations only.',
  },
};

const KAVERI_GUIDANCE_VALUE: RegisteredSource = {
  id: 'in.ka.kaveri.guidance_value',
  label: 'Kaveri Online Services — guidance value ("know your property valuation") search',
  authority: 'Department of Stamps and Registration, Government of Karnataka (IGR)',
  kind: 'guidance_value',
  country: 'IN',
  state: KA,
  access: 'captcha',
  url: 'https://kaverionline.karnataka.gov.in/',
  hostnames: KAVERI_HOSTS,
  accessVerified: 'general_knowledge',
  accessBasis:
    'The guidance-value lookup is public in the sense that it needs no account, but it is a CAPTCHA-gated, stateful multi-step form (district, then taluk, then hobli, then village, then property type) with no published endpoint or bulk download. Classified captcha rather than open: no account is required, but no unauthenticated HTTP request answers it either.',
  whatItWouldHaveAnswered:
    'The notified guidance value for this property\'s village and classification, per unit area — the statutory floor for stamp duty and registration, which is charged on the higher of consideration and guidance value. Without it the transaction-cost estimate rests on the pack\'s reference table rather than on the rate actually notified for this village.',
  manualRoute:
    'Open the guidance-value search on Kaveri Online Services, pass the CAPTCHA, and step through district -> taluk -> hobli -> village -> property classification to the rate table for the property. Export or screenshot the resulting rate table and supply it to Valytica as a file (source `in.ka.igr.guidance_value.file`). The jurisdictional Sub-Registrar office also holds the current notified table and will read it out against a property schedule.',
  produces: ['guidance_value'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka guidance values only; other states notify their circle rates separately.',
  },
};

/* ------------------------------------------------------------------ */
/* Karnataka — Revenue Department (Bhoomi, survey, e-Swathu)           */
/* ------------------------------------------------------------------ */

const LAND_ORIGIN_TYPES: PropertyType[] = [
  'residential_plot',
  'residential_villa',
  'land_parcel',
  'industrial_warehouse',
];

const BHOOMI_RTC: RegisteredSource = {
  id: 'in.ka.bhoomi.rtc',
  label: 'Bhoomi — RTC / pahani (Record of Rights, Tenancy and Crops)',
  authority: 'Department of Survey, Settlement and Land Records, Revenue Department, Government of Karnataka',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'captcha',
  url: 'https://landrecords.karnataka.gov.in/',
  hostnames: ['landrecords.karnataka.gov.in', 'bhoomi.karnataka.gov.in'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'The public RTC view requires a CAPTCHA and a cascading district/taluk/hobli/village/survey-number selection; the signed digital RTC additionally requires a payment flow. No published machine interface.',
  whatItWouldHaveAnswered:
    'The currently recorded holder of the survey number, the recorded extent, the kharab (uncultivable) split, tenancy and crop entries, and the chain of mutation numbers behind the present entry. This is where granted-land, inam and tenancy restrictions surface, and it is the only record that states the revenue extent against which a deed\'s claimed extent can be reconciled.',
  manualRoute:
    'Obtain an RTC at the taluk office, a Nada Kacheri / Atalji Janasnehi Kendra counter, or a Bhoomi kiosk, quoting district, taluk, hobli, village and survey number (with hissa). Take applicant photo ID. Ask for the current RTC and the RTCs for the years spanning the transactions in the chain — a single current RTC does not show how the holding changed.',
  produces: ['parcel'],
  packDatasets: ['Survey & Settlement and Land Records (Bhoomi)'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    propertyTypes: LAND_ORIGIN_TYPES,
    scopeNote:
      'Land of revenue origin. An apartment on the seventh floor of a BBMP-khata block has no RTC of its own — the RTC belongs to the land the block stands on and is the developer\'s to produce, not the flat buyer\'s to pull.',
  },
};

const BHOOMI_MUTATION: RegisteredSource = {
  id: 'in.ka.bhoomi.mutation',
  label: 'Bhoomi — mutation register (MR) extract and pending-mutation status',
  authority: 'Department of Survey, Settlement and Land Records, Revenue Department, Government of Karnataka',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'captcha',
  url: 'https://landrecords.karnataka.gov.in/',
  hostnames: ['landrecords.karnataka.gov.in', 'bhoomi.karnataka.gov.in'],
  accessVerified: 'general_knowledge',
  accessBasis: 'Same portal and same CAPTCHA-gated cascading form as the RTC view.',
  whatItWouldHaveAnswered:
    'The mutation entries that moved this survey number from one holder to the next, each with its MR number and date, and whether any mutation is still pending. A pending mutation is the classic reason a seller who genuinely bought the land is not yet the recorded holder — a curable defect, but only if it is found before completion.',
  manualRoute:
    'Request the mutation register extract for the survey number at the taluk office alongside the RTC, quoting the MR numbers the RTC itself lists. Ask specifically whether any mutation is pending, as a pending entry does not appear on the current RTC.',
  produces: ['parcel', 'instrument'],
  packDatasets: ['Survey & Settlement and Land Records (Bhoomi)'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    propertyTypes: LAND_ORIGIN_TYPES,
    scopeNote: 'Land of revenue origin, as for the RTC.',
  },
};

const SURVEY_RECORDS: RegisteredSource = {
  id: 'in.ka.survey.records',
  label: 'Survey records — tippani, akarband, atlas and podi sketch',
  authority: 'Department of Survey, Settlement and Land Records — taluk survey office / Assistant Director of Land Records',
  kind: 'cadastral',
  country: 'IN',
  state: KA,
  access: 'offline_only',
  hostnames: [],
  accessVerified: 'general_knowledge',
  accessBasis:
    'These are drawn survey documents held by the survey office. Some are being digitised, but the issued, signed sketch that a boundary dispute or a subdivision actually turns on exists across a counter.',
  whatItWouldHaveAnswered:
    'The surveyed shape, dimensions and boundaries of the parcel as the revenue survey records them, and — after a podi (subdivision) — which sub-numbers the parent survey number was split into and with what extents. This is what a physical measurement is checked against; a deed schedule that does not match the tippani is a boundary problem waiting to become a demolition.',
  manualRoute:
    'Apply at the taluk survey office, or the office of the Assistant Director of Land Records for the district, quoting district, taluk, hobli, village and survey number with hissa. Ask for the tippani and akarband for the parent number and, where the parcel is a subdivision, the podi sketch and the resulting sub-number extents. A licensed surveyor can be engaged separately to measure the site against them.',
  produces: ['parcel'],
  packDatasets: ['Survey & Settlement and Land Records (Bhoomi)'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    propertyTypes: LAND_ORIGIN_TYPES,
    scopeNote: 'Land of revenue origin, where a surveyed boundary exists to check.',
  },
};

const ESWATHU_FORM_9_11: RegisteredSource = {
  id: 'in.ka.panchayat.form_9_11',
  label: 'e-Swathu — gram panchayat property register (Form 9 and Form 11)',
  authority: 'Rural Development and Panchayat Raj Department, Government of Karnataka',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'auth_required',
  hostnames: ['eswathu.karnataka.gov.in'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'Issue of Form 9 / Form 11 is done by the panchayat secretary through an authenticated departmental login; the citizen-facing side is a verification view for a document you already hold, not a search. Classified auth_required on that basis.',
  whatItWouldHaveAnswered:
    'Whether the panchayat holds a Form 9 (property register entry) and Form 11 (demand register / tax entry) for this property, in whose name, and for what extent — the only property record a gram panchayat property has, and the thing whose absence means the property is unrecorded rather than merely un-khata-ed.',
  manualRoute:
    'Apply to the gram panchayat office for the village, through the panchayat secretary, with the sale deed or title document, the previous Form 9/11 where one exists, and the property\'s measurement. Where the area has since been annexed into BBMP limits, ask separately whether a BBMP khata application has been filed, because the panchayat record stops being the operative one at annexation.',
  produces: ['parcel', 'approval'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    karnatakaJurisdictions: ['gram_panchayat'],
    scopeNote: 'Gram panchayat properties only — a BBMP or BDA property has a khata instead, not a Form 9/11.',
  },
};

/* ------------------------------------------------------------------ */
/* Karnataka — BBMP (Bengaluru municipal)                              */
/* ------------------------------------------------------------------ */

const BBMP_JURISDICTIONS = ['BBMP'];

const BBMP_PROPERTY_TAX: RegisteredSource = {
  id: 'in.ka.bbmp.property_tax',
  label: 'BBMP property tax portal — payment status and demand',
  authority: 'Bruhat Bengaluru Mahanagara Palike — Revenue Department',
  kind: 'tax',
  country: 'IN',
  state: KA,
  access: 'captcha',
  url: 'https://bbmptax.karnataka.gov.in/',
  hostnames: ['bbmptax.karnataka.gov.in'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'The status lookup needs no account but requires the SAS base application number or PID plus a CAPTCHA, and the receipt download is a stateful multi-step flow. No published machine interface.',
  whatItWouldHaveAnswered:
    'Whether property tax is paid up to the current year against this PID, the assessed unit area value and zone the demand is computed on, and any arrears or interest outstanding. Arrears transfer with the property in practice, and the assessed area on the tax record is an independent statement of extent to reconcile against the deed.',
  manualRoute:
    'Look the property up on the BBMP property tax portal using the SAS base application number or PID from an earlier receipt, or visit the jurisdictional BBMP ward Revenue office or a BangaloreOne centre with a previous tax receipt. Ask for the paid-status statement covering the last several years, not just the current year, and supply it to Valytica as a file (source `in.ka.bbmp.tax.file`).',
  produces: ['parcel'],
  packDatasets: ['BBMP Sakala / property tax roll'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    cities: ['Bengaluru'],
    karnatakaJurisdictions: BBMP_JURISDICTIONS,
    scopeNote: 'BBMP-jurisdiction properties in Bengaluru only.',
  },
};

const BBMP_EKHATA: RegisteredSource = {
  id: 'in.ka.bbmp.ekhata',
  label: 'BBMP e-Khata / e-Aasthi property register',
  authority: 'Bruhat Bengaluru Mahanagara Palike — Revenue Department',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'auth_required',
  url: 'https://bbmpeaasthi.karnataka.gov.in/',
  hostnames: ['bbmpeaasthi.karnataka.gov.in', 'bbmp.gov.in'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'Draft and final e-khata retrieval runs through an OTP-authenticated citizen session tied to the owner\'s mobile number. Classified auth_required. The portal has also been rebranded more than once, so confirm the current name before quoting it to a user.',
  whatItWouldHaveAnswered:
    'Whether BBMP holds an A-khata or a B-khata for this property, the khata number and the recorded owner and extent, and whether an e-khata has been issued. A/B khata classification decides whether the property is mortgageable and whether a building plan can be sanctioned on it — for a Bengaluru case it is a first-order question, not a formality.',
  manualRoute:
    'Retrieve the e-khata through the BBMP e-Aasthi citizen flow using the owner\'s registered mobile number, or apply at the jurisdictional BBMP ward Revenue office with the registered sale deed, the latest tax paid receipt, the encumbrance certificate and the previous khata where one exists. Where the property is B-khata, ask what BBMP requires to regularise it rather than accepting "it will be converted" from the seller.',
  produces: ['parcel'],
  packDatasets: ['BBMP e-Khata portal'],
  applicability: {
    countries: ['IN'],
    states: [KA],
    cities: ['Bengaluru'],
    karnatakaJurisdictions: BBMP_JURISDICTIONS,
    scopeNote: 'BBMP-jurisdiction properties in Bengaluru only.',
  },
};

/* ------------------------------------------------------------------ */
/* Karnataka — planning and RERA                                       */
/* ------------------------------------------------------------------ */

const KRERA: RegisteredSource = {
  id: 'in.ka.krera.projects',
  label: 'K-RERA registered project and agent registry',
  authority: 'Karnataka Real Estate Regulatory Authority',
  kind: 'rera',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  url: 'https://rera.karnataka.gov.in/',
  hostnames: ['rera.karnataka.gov.in'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'The project register is publicly browsable — no account is needed to look a project up — but there is no documented open endpoint or bulk download, and the certificate and quarterly progress reports come out as per-project PDFs. Classified file_upload rather than open precisely because open access was not verified: "a human can read it in a browser" is not the same claim as "an unauthenticated HTTP request returns it", and only the first is known here.',
  whatItWouldHaveAnswered:
    'Whether the project is registered with K-RERA and under what number, the promoter, the declared completion date, the sanctioned unit and block count, and the quarterly progress reports filed against it. A project that should be registered and is not is itself a serious finding, and the declared completion date is the one a buyer can hold the promoter to.',
  manualRoute:
    'Search the K-RERA project register by project name, promoter or district, open the project page, and download the registration certificate and the most recent quarterly progress report. Supply those to Valytica — the PDFs go through the document pipeline; a transcribed CSV of the registration fields can be supplied against this source directly. Where the project does not appear, record that as the finding: check with the K-RERA office rather than assuming the search simply missed it.',
  produces: ['approval'],
  packDatasets: ['K-RERA project registry'],
  fileIntake: {
    recordType: 'approval',
    formats: ['csv', 'json'],
    requiredFields: ['reference', 'issuedBy'],
    expectedShape:
      'One row per registration: reference (the K-RERA number), issuedBy, issuedOn, status, and where available projectName, promoter and declaredCompletionOn.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka projects. A project registered with another state authority is on that state\'s register.',
  },
};

const BDA_NOTIFICATIONS: RegisteredSource = {
  id: 'in.ka.bda.notifications',
  label: 'BDA / BMRDA acquisition and de-notification notifications',
  authority: 'Bangalore Development Authority / Bangalore Metropolitan Region Development Authority',
  kind: 'planning',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  url: 'https://bdabangalore.org/',
  hostnames: ['bdabangalore.org'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'Notifications are published as gazette notices and PDF lists rather than as a queryable register, and the authoritative copy is the gazette. Treated as an operator-supplied document route.',
  whatItWouldHaveAnswered:
    'Whether this survey number appears in a preliminary or final acquisition notification, and whether it was subsequently de-notified. Land under a live acquisition notification cannot be safely bought, and a de-notification that the seller asserts but cannot evidence is one of the more expensive things to discover after completion.',
  manualRoute:
    'Check the survey number against the BDA/BMRDA notification lists for the layout or scheme covering the village, and obtain the gazette copy of any preliminary notification, final notification or de-notification order that names it. The BDA record room and the jurisdictional tahsildar both hold copies; a title lawyer will normally run this search as part of the opinion. Supply the extracted entries as a file against this source.',
  produces: ['approval', 'encumbrance'],
  packDatasets: ['BDA/BMRDA notifications and de-notification orders'],
  fileIntake: {
    recordType: 'approval',
    formats: ['csv', 'json'],
    requiredFields: ['reference', 'issuedBy'],
    expectedShape:
      'One row per notification naming the parcel: reference (notification number), issuedBy, issuedOn, status (preliminary / final / de-notified), and the survey number it names.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    propertyTypes: LAND_ORIGIN_TYPES,
    scopeNote: 'Land parcels and sites, where an acquisition notification can bite.',
  },
};

const RMP_LANDUSE: RegisteredSource = {
  id: 'in.ka.rmp.landuse',
  label: 'Revised Master Plan land-use zoning (RMP 2015 as revised)',
  authority: 'Bangalore Development Authority',
  kind: 'planning',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  url: 'https://bdabangalore.org/',
  hostnames: ['bdabangalore.org'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'The plan is published as map sheets and a zoning-regulation document rather than as a per-parcel lookup; reading a specific site off a sheet is a manual act. Treated as an operator-supplied document route.',
  whatItWouldHaveAnswered:
    'The land-use zone the site falls in and the permissible uses, FAR and setbacks that follow from it, plus whether the site is touched by a proposed road widening or a public-purpose reservation. A site zoned for something other than the intended use is not a discount — it is a different asset.',
  manualRoute:
    'Identify the plan sheet covering the village and read the site off it against its survey number, or obtain a zoning certificate / land-use confirmation from the planning authority with jurisdiction (BDA, BMRDA, BIAAPA or the local planning authority as applicable). Supply the extracted zone and permitted uses as a file against this source.',
  produces: ['approval'],
  packDatasets: ['RMP 2015 land-use plan (as revised)'],
  fileIntake: {
    recordType: 'approval',
    formats: ['csv', 'json'],
    requiredFields: ['reference', 'issuedBy'],
    expectedShape: 'One row per site or survey number: reference (sheet or certificate reference), issuedBy, issuedOn, status (the zone), and notes.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    cities: ['Bengaluru'],
    scopeNote: 'Bengaluru metropolitan area, which is what the RMP covers.',
  },
};

/* ------------------------------------------------------------------ */
/* Karnataka — commercial aggregator                                   */
/* ------------------------------------------------------------------ */

const LANDEED: RegisteredSource = {
  id: 'in.aggregator.landeed',
  label: 'Landeed — commercial title-search aggregator',
  authority: 'Landeed (private company)',
  kind: 'registry',
  country: 'IN',
  access: 'auth_required',
  url: 'https://landeed.com/',
  hostnames: ['landeed.com'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'A commercial product. Access is by paid account and, for programmatic use, a commercial API agreement and key. No key is configured in this deployment, so the source is declared and not attempted. Listed because pretending the commercial route does not exist would be its own distortion: it is often the fastest way to a first-pass EC.',
  whatItWouldHaveAnswered:
    'A packaged encumbrance and registration search assembled from the same state registries, typically returned faster and in a more machine-readable form than the government portals manage. It is a convenience layer over the registry, not an independent authority — a discrepancy between an aggregator result and the SRO record is resolved in favour of the SRO.',
  manualRoute:
    'Open a commercial account with the aggregator and run the search there, or request an API key if programmatic access is wanted; then supply the returned extract to Valytica as a file. Treat the output as a lead to verify against the Sub-Registrar record, not as a substitute for it.',
  produces: ['encumbrance', 'instrument'],
  applicability: {
    countries: ['IN'],
    scopeNote: 'Indian states the aggregator covers; coverage varies by state and is worth confirming before relying on a nil result.',
  },
};

/* ------------------------------------------------------------------ */
/* Karnataka — operator-supplied file routes                           */
/* ------------------------------------------------------------------ */

/**
 * These four are the ones that actually put real Karnataka data into a case.
 *
 * Each is the machine-readable end of a source above: the operator passes the
 * gate a machine cannot, and hands over a file. They are registered as
 * separate sources rather than as a mode of the portal entry so that a report
 * can say both true things at once — "the portal itself is gated" and "the
 * extract you supplied from it produced 14 records".
 */

const GUIDANCE_VALUE_FILE: RegisteredSource = {
  id: 'in.ka.igr.guidance_value.file',
  label: 'Karnataka guidance-value table — operator-supplied extract',
  authority: 'Department of Stamps and Registration, Government of Karnataka (via the operator)',
  kind: 'guidance_value',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  hostnames: [],
  accessVerified: 'live',
  accessBasis: 'A local file supplied by the operator. Nothing is fetched; the only failure modes are parsing ones, and each is reported per row.',
  whatItWouldHaveAnswered:
    'The notified guidance value per unit area for the property\'s village and classification, and the date the rate took effect — the statutory floor for stamp duty and registration.',
  manualRoute:
    'Take the rate table from the Kaveri guidance-value search (see `in.ka.kaveri.guidance_value`) or from the jurisdictional Sub-Registrar office, and save it as CSV or JSON with one row per locality/classification. Each row needs the locality, the rate with its unit stated in the column header (for example "Rate per sqft (INR)"), and the effective date.',
  produces: ['guidance_value'],
  obtainedFrom: 'in.ka.kaveri.guidance_value',
  packDatasets: ['Kaveri Online Services (Dept. of Stamps & Registration, Karnataka)'],
  fileIntake: {
    recordType: 'guidance_value',
    formats: ['csv', 'json'],
    requiredFields: ['locality', 'ratePerSqm'],
    expectedShape:
      'One row per locality/classification: locality, the rate with its unit in the header (e.g. "Rate per sqft (INR)" or "Rate per sqm"), effective date in DD-MM-YYYY, and optionally propertyClass, district, taluk, village and notification reference.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka guidance values.',
  },
};

const EC_FILE: RegisteredSource = {
  id: 'in.ka.kaveri.ec.file',
  label: 'Encumbrance certificate entries — operator-supplied extract',
  authority: 'Department of Stamps and Registration, Government of Karnataka (via the operator)',
  kind: 'registry',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  hostnames: [],
  accessVerified: 'live',
  accessBasis: 'A local file supplied by the operator.',
  whatItWouldHaveAnswered:
    'The registered encumbrance entries for the property over the certified period — one row per entry, with the instrument, parties, date, extent and consideration.',
  manualRoute:
    'Download the EC from Kaveri or collect it from the Sub-Registrar office (see `in.ka.kaveri.ec`). Supply the PDF through the document pipeline for extraction, or — where you already have the entries in tabular form — supply a CSV with one row per EC entry against this source. This adapter takes structured rows only; it does not read PDFs.',
  produces: ['encumbrance', 'instrument'],
  obtainedFrom: 'in.ka.kaveri.ec',
  packDatasets: ['Kaveri Online Services (Dept. of Stamps & Registration, Karnataka)'],
  fileIntake: {
    recordType: 'encumbrance',
    formats: ['csv', 'json'],
    requiredFields: ['instrumentType', 'registeredOn'],
    expectedShape:
      'One row per EC entry: instrumentType (sale deed, mortgage, gift, release, lis pendens...), registeredOn in DD-MM-YYYY, registrationNumber, executant, claimant, and where stated consideration and extent with its unit.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka registrations.',
  },
};

const BBMP_TAX_FILE: RegisteredSource = {
  id: 'in.ka.bbmp.tax.file',
  label: 'BBMP property tax statement — operator-supplied extract',
  authority: 'Bruhat Bengaluru Mahanagara Palike (via the operator)',
  kind: 'tax',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  hostnames: [],
  accessVerified: 'live',
  accessBasis: 'A local file supplied by the operator.',
  whatItWouldHaveAnswered:
    'Tax paid by year against the PID, the assessed area and zone the demand was computed on, and any arrears.',
  manualRoute:
    'Take the paid-status statement from the BBMP property tax portal or the ward Revenue office (see `in.ka.bbmp.property_tax`) and save it as CSV with one row per assessment year.',
  produces: ['parcel'],
  obtainedFrom: 'in.ka.bbmp.property_tax',
  packDatasets: ['BBMP Sakala / property tax roll'],
  fileIntake: {
    recordType: 'parcel',
    formats: ['csv', 'json'],
    requiredFields: ['parcelRef'],
    expectedShape:
      'One row per assessment year: parcelRef (the PID or SAS application number), assessmentYear, amountPaid, paidOn in DD-MM-YYYY, and the assessed area with its unit stated in the header.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    cities: ['Bengaluru'],
    karnatakaJurisdictions: BBMP_JURISDICTIONS,
    scopeNote: 'BBMP-jurisdiction properties in Bengaluru only.',
  },
};

const COMPARABLES_FILE: RegisteredSource = {
  id: 'in.ka.comparables.file',
  label: 'Registered-transaction comparables — operator-supplied extract',
  authority: 'Operator (broker CMA, valuer schedule, or the operator\'s own transaction log)',
  kind: 'comparables',
  country: 'IN',
  state: KA,
  access: 'file_upload',
  hostnames: [],
  accessVerified: 'live',
  accessBasis: 'A local file supplied by the operator.',
  whatItWouldHaveAnswered:
    'Actual transacted prices for comparable properties near this one, with area, date and address — the evidence a comparable-sales valuation is supposed to rest on. Until this file arrives the engine is working from the pack\'s locality reference medians, which are a market-level statistic and not a transaction.',
  manualRoute:
    'Assemble the comparables you can actually evidence — registered transactions from a valuer\'s schedule, a broker\'s CMA, or your own completed deals — into a CSV with one row per transaction. State the area unit in the column header or in a unit column; sqft, sqm, guntha, cent and acre are all understood, but an unlabelled area column is rejected rather than guessed.',
  produces: ['comparable'],
  fileIntake: {
    recordType: 'comparable',
    formats: ['csv', 'json'],
    requiredFields: ['address', 'areaSqm', 'price', 'transactedOn'],
    expectedShape:
      'One row per transaction: address, area with its unit (header or unit column), price (Indian grouping and lakh/crore words are understood), transactedOn in DD-MM-YYYY, and optionally propertyType, distanceKm and source.',
  },
  applicability: {
    countries: ['IN'],
    states: [KA],
    scopeNote: 'Karnataka comparables. The engine will not cross the land/built boundary, so supply sites and built units separately.',
  },
};

/* ------------------------------------------------------------------ */
/* Netherlands                                                         */
/* ------------------------------------------------------------------ */

/**
 * The two PDOK entries are the only sources in this registry classified
 * `open`, and both were exercised live from this workspace on 2026-08-26:
 * unauthenticated HTTPS GET, no key, no CAPTCHA, HTTP 200 with GeoJSON.
 * They are national services published for reuse, which is why they can be
 * queried at all — and one bounded request per case is the whole of what the
 * HTTP adapter does with them.
 */

const PDOK_BAG: RegisteredSource = {
  id: 'nl.pdok.bag.verblijfsobject',
  label: 'PDOK — BAG verblijfsobject (addresses and buildings register)',
  authority: 'Kadaster, published through PDOK (Publieke Dienstverlening Op de Kaart)',
  kind: 'cadastral',
  country: 'NL',
  access: 'open',
  url: 'https://service.pdok.nl/lv/bag/wfs/v2_0',
  hostnames: ['service.pdok.nl', 'api.pdok.nl'],
  accessVerified: 'live',
  accessBasis:
    'Verified from this workspace on 2026-08-26: an unauthenticated WFS 2.0 GetFeature with an OGC filter on postcode returned HTTP 200 and GeoJSON features. No account, no key, no CAPTCHA. Note that the service ignores `CQL_FILTER` — it takes Filter Encoding 2.0 XML — so a query built for a GeoServer-style endpoint silently returns the wrong rows rather than erroring; `adapters/http.ts` builds FE 2.0 for that reason.',
  whatItWouldHaveAnswered:
    'The registered usable floor area (oppervlakte, in m2), construction year, use class and building identifier for the address, from the national addresses-and-buildings register. For a Dutch case this is an independent check on the area and year the listing claims.',
  produces: ['parcel'],
  packDatasets: ['BAG registry'],
  endpoint: {
    protocol: 'ogc_wfs_2_0',
    baseUrl: 'https://service.pdok.nl/lv/bag/wfs/v2_0',
    typeName: 'bag:verblijfsobject',
    count: 25,
    filters: [{ attribute: 'postcode', from: 'nl_postcode' }],
    optionalFilters: [{ attribute: 'huisnummer', from: 'nl_house_number' }],
    recordType: 'parcel',
    defaultAreaUnit: 'sqm',
  },
  applicability: {
    countries: ['NL'],
    scopeNote: 'Dutch addresses. The register is national, so no province gate applies.',
  },
};

const PDOK_KADASTRALE_KAART: RegisteredSource = {
  id: 'nl.pdok.kadastralekaart.perceel',
  label: 'PDOK — Kadastrale Kaart, Perceel (cadastral parcel geometry and extent)',
  authority: 'Kadaster, published through PDOK',
  kind: 'cadastral',
  country: 'NL',
  access: 'open',
  url: 'https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0',
  hostnames: ['service.pdok.nl'],
  accessVerified: 'live',
  accessBasis:
    'Verified from this workspace on 2026-08-26: unauthenticated WFS 2.0 GetCapabilities and GetFeature both returned HTTP 200, and a filter on kadastraleGemeenteWaarde + sectie returned real parcels. No account or key.',
  whatItWouldHaveAnswered:
    'The registered extent (kadastraleGrootteWaarde, in m2) and geometry of the cadastral parcel named by the kadastrale aanduiding, and whether that aanduiding resolves to a parcel at all. It answers extent and existence — it does not answer ownership or mortgages, which are in the BRK and are not open.',
  produces: ['parcel'],
  packDatasets: ['Kadaster'],
  endpoint: {
    protocol: 'ogc_wfs_2_0',
    baseUrl: 'https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0',
    typeName: 'kadastralekaart:Perceel',
    count: 5,
    filters: [
      { attribute: 'kadastraleGemeenteWaarde', from: 'nl_kadastrale_gemeente' },
      { attribute: 'sectie', from: 'nl_sectie' },
      { attribute: 'perceelnummer', from: 'nl_perceelnummer' },
    ],
    recordType: 'parcel',
    defaultAreaUnit: 'sqm',
  },
  applicability: {
    countries: ['NL'],
    scopeNote: 'Dutch parcels identified by a kadastrale aanduiding (gemeente, sectie, perceelnummer).',
  },
};

const KADASTER_BRK: RegisteredSource = {
  id: 'nl.kadaster.brk.eigendom',
  label: 'Kadaster — BRK ownership and mortgage extract (eigendomsinformatie)',
  authority: 'Kadaster',
  kind: 'registry',
  country: 'NL',
  access: 'auth_required',
  url: 'https://www.kadaster.nl/',
  hostnames: ['kadaster.nl', 'mijn.kadaster.nl'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'Ownership and mortgage information is a paid product bought through a Kadaster account (Mijn Kadaster / the public product shop); the open PDOK layers deliberately publish geometry and extent but not who owns what. Classified auth_required.',
  whatItWouldHaveAnswered:
    'The registered owner of the parcel, the acquisition instrument and date, and any mortgage (hypotheek) or attachment (beslag) registered against it. This is the Dutch equivalent of the EC question and, like the EC, it is the part that is not open.',
  manualRoute:
    'Buy the eigendomsinformatie extract for the parcel from Kadaster, quoting the kadastrale aanduiding, and supply the resulting PDF through the document pipeline. A notaris will normally pull this as a matter of course, so ask the notaris before buying it twice.',
  produces: ['encumbrance', 'instrument', 'parcel'],
  packDatasets: ['Kadaster'],
  applicability: {
    countries: ['NL'],
    scopeNote: 'Dutch parcels.',
  },
};

const WOZ_WAARDELOKET: RegisteredSource = {
  id: 'nl.woz.waardeloket',
  label: 'WOZ-waardeloket — municipal WOZ assessed value',
  authority: 'Waarderingskamer, on behalf of the municipalities',
  kind: 'tax',
  country: 'NL',
  access: 'file_upload',
  url: 'https://www.wozwaardeloket.nl/',
  hostnames: ['wozwaardeloket.nl'],
  accessVerified: 'general_knowledge',
  accessBasis:
    'The loket is publicly viewable without an account, but it exposes no documented public API and its terms are aimed at individual lookups rather than automated retrieval. Not classified `open`, because open access here was not verified and the site being browsable is not the same claim; the honest route is that the operator looks the address up and supplies what it shows.',
  whatItWouldHaveAnswered:
    'The WOZ assessed value for the address and its valuation reference date (waardepeildatum) — the statutory-reference anchor for a Dutch case, and the number the municipal tax and, indirectly, parts of the rent regime are computed from.',
  manualRoute:
    'Look the address up on the WOZ-waardeloket, or take the WOZ-beschikking the municipality sent the owner. Supply the beschikking as a document, or the value and reference date as a one-row CSV against this source.',
  produces: ['guidance_value'],
  packDatasets: ['Kadaster'],
  fileIntake: {
    recordType: 'guidance_value',
    formats: ['csv', 'json'],
    requiredFields: ['locality', 'ratePerSqm'],
    expectedShape:
      'One row per address: locality, the WOZ value, the area it relates to with its unit, and the waardepeildatum as the effective date.',
  },
  applicability: {
    countries: ['NL'],
    scopeNote: 'Dutch addresses.',
  },
};

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every source, in a fixed order.
 *
 * The order is the report order, and it is stable by construction so two runs
 * over the same case produce byte-identical attempt lists. Grouped by
 * authority rather than by access, so that a reader sees "here is everything
 * Kaveri would have told us" in one place instead of the blocked and the
 * workable halves of the same authority appearing pages apart.
 */
export const DATA_SOURCES: readonly RegisteredSource[] = Object.freeze([
  // Karnataka — registration
  KAVERI_EC,
  KAVERI_CERTIFIED_COPY,
  KAVERI_GUIDANCE_VALUE,
  EC_FILE,
  GUIDANCE_VALUE_FILE,
  // Karnataka — revenue and survey
  BHOOMI_RTC,
  BHOOMI_MUTATION,
  SURVEY_RECORDS,
  ESWATHU_FORM_9_11,
  // Karnataka — municipal
  BBMP_PROPERTY_TAX,
  BBMP_EKHATA,
  BBMP_TAX_FILE,
  // Karnataka — planning and RERA
  KRERA,
  BDA_NOTIFICATIONS,
  RMP_LANDUSE,
  // Karnataka — market
  COMPARABLES_FILE,
  // Commercial
  LANDEED,
  // Netherlands
  PDOK_BAG,
  PDOK_KADASTRALE_KAART,
  KADASTER_BRK,
  WOZ_WAARDELOKET,
]);

const BY_ID: ReadonlyMap<string, RegisteredSource> = new Map(DATA_SOURCES.map(s => [s.id, s]));

export function findSource(id: string): RegisteredSource | undefined {
  return BY_ID.get(id);
}

/** The contract-shaped view, for anything outside this package. */
export function toDescriptor(source: RegisteredSource): DataSourceDescriptor {
  const { id, label, authority, kind, country, state, access, url, whatItWouldHaveAnswered, manualRoute } = source;
  return { id, label, authority, kind, country, state, access, url, whatItWouldHaveAnswered, manualRoute };
}

export function allDescriptors(): DataSourceDescriptor[] {
  return DATA_SOURCES.map(toDescriptor);
}

/**
 * Hostnames of every source this registry declares unreachable.
 *
 * Exported so that the explorer's `BLOCKED_HOSTNAMES` and this registry can be
 * cross-checked rather than drifting apart — two files independently deciding
 * what is blocked is exactly how a portal ends up blocked in one code path and
 * hammered in the other. Note that `file_upload` hosts are included: a source
 * whose only supported route is a human downloading a file is a source no
 * automated fetch should be pointed at either.
 */
export const DECLARED_UNREACHABLE_HOSTNAMES: readonly string[] = Object.freeze(
  Array.from(
    new Set(
      DATA_SOURCES.filter(s => s.access !== 'open')
        .flatMap(s => s.hostnames)
        .sort(),
    ),
  ),
);

/** The access classifications that will never cause a network request from this package. */
export const NON_NETWORK_ACCESS: readonly SourceAccess[] = Object.freeze([
  'auth_required',
  'captcha',
  'offline_only',
  'file_upload',
]);

/* ------------------------------------------------------------------ */
/* Applicability                                                       */
/* ------------------------------------------------------------------ */

export interface ApplicabilityVerdict {
  applies: boolean;
  /** Always populated — a positive verdict states the match, a negative one states the gate that rejected it. */
  reason: string;
}

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Whether a source has anything to say about this case.
 *
 * Distinguished from unreachability on purpose. "BBMP has no record of a
 * Devanahalli gram panchayat site" is not a gap in the diligence — BBMP is not
 * the authority. Reporting it as unreachable would inflate the apparent list
 * of things we failed to check, which is the mirror image of the dishonesty
 * this registry exists to prevent.
 */
export function sourceApplies(source: RegisteredSource, identity: PropertyIdentity): ApplicabilityVerdict {
  const scope = source.applicability;

  if (!scope.countries.includes(identity.country)) {
    return {
      applies: false,
      reason: `Out of scope: ${source.label} covers ${scope.countries.join('/')}, this case is ${identity.country}. ${scope.scopeNote}`,
    };
  }

  if (scope.states && !scope.states.some(s => norm(s) === norm(identity.state))) {
    return {
      applies: false,
      reason: `Out of scope: ${source.label} covers ${scope.states.join('/')}, this case is in ${identity.state || 'an unstated state'}. ${scope.scopeNote}`,
    };
  }

  if (scope.cities && !scope.cities.some(c => norm(c) === norm(identity.city))) {
    return {
      applies: false,
      reason: `Out of scope: ${source.label} covers ${scope.cities.join('/')}, this case is in ${identity.city || 'an unstated city'}. ${scope.scopeNote}`,
    };
  }

  if (scope.propertyTypes && !scope.propertyTypes.includes(identity.propertyType)) {
    return {
      applies: false,
      reason: `Out of scope for a ${identity.propertyType.replace(/_/g, ' ')}. ${scope.scopeNote}`,
    };
  }

  if (scope.karnatakaJurisdictions) {
    const jurisdiction = identity.karnataka?.jurisdiction;
    if (!jurisdiction) {
      return {
        applies: false,
        reason: `Out of scope: ${source.label} is jurisdiction-specific (${scope.karnatakaJurisdictions.join('/')}) and this case does not state a Karnataka jurisdiction. ${scope.scopeNote}`,
      };
    }
    if (!scope.karnatakaJurisdictions.includes(jurisdiction)) {
      return {
        applies: false,
        reason: `Out of scope: ${source.label} covers ${scope.karnatakaJurisdictions.join('/')} properties, this case is ${jurisdiction}. ${scope.scopeNote}`,
      };
    }
  }

  return { applies: true, reason: `In scope: ${scope.scopeNote}` };
}

/** Every source that has something to say about this case, in registry order. */
export function applicableSources(identity: PropertyIdentity): RegisteredSource[] {
  return DATA_SOURCES.filter(s => sourceApplies(s, identity).applies);
}

/** Sources of a given kind, for callers that want (say) every comparables route. */
export function sourcesOfKind(kind: SourceKind): RegisteredSource[] {
  return DATA_SOURCES.filter(s => s.kind === kind);
}
