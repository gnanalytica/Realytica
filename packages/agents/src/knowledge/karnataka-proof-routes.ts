/**
 * Karnataka / Bengaluru proof-sourcing corpus.
 *
 * This is the grounding knowledge base for the proof-pathways agent: a
 * structured catalogue of how a Bengaluru property buyer actually goes about
 * obtaining a missing or thin proof — which authority, which portal or office,
 * what a licensed intermediary can and cannot do, what only the seller can
 * produce, and the reconstruct-from-secondary fallback for a genuinely lost
 * original. It exists so the model reasons from real institutional structure
 * rather than free-associating a plausible-sounding but invented procedure.
 *
 * PROVENANCE DISCIPLINE — read this before editing or trusting a figure below.
 * Every service name, portal name, fee and Sakala/departmental timeline in
 * this file is written from general knowledge of how these processes work,
 * not from a live read of a current government notification or portal. Portal
 * names are periodically rebranded (BBMP's own khata-migration portal has
 * gone by more than one name over the years), fee schedules are revised by
 * circular, and Sakala service-level timelines are targets, not guarantees —
 * real-world turnaround, especially anything requiring field inspection or a
 * manual pre-digitisation register search, routinely runs well past the
 * notified SLA. Every cost and duration below is therefore a *range*, marked
 * indicative, and every route in the rendered corpus carries the instruction
 * to verify current fees/timelines on the portal or with the office before a
 * user relies on them. Where a figure is genuinely just a commonly-cited
 * ballpark rather than something this file can stand behind, that is stated
 * explicitly rather than the number being quietly rounded to look more
 * certain than it is.
 *
 * This corpus is Karnataka/Bengaluru-specific by construction — every
 * authority and portal named here is only valid for a case whose state pack
 * is `karnataka`. `agents/proof-pathways.ts` is responsible for gating on
 * that before this file's contents ever reach a prompt; nothing in this file
 * enforces that gate itself.
 */

import type { CurrencyCode, DocumentKind, ProofRouteKind } from '@valytica/shared';

/** One concrete, costed, sequenced way to obtain a proof — the template a model route is grounded in. */
export interface ProofRouteTemplate {
  id: string;
  kind: ProofRouteKind;
  title: string;
  /** BBMP, Sub-Registrar, DC office, BDA, K-RERA, Gram Panchayat … */
  authority: string;
  portalOrAddress?: string;
  formOrReference?: string;
  steps: string[];
  prerequisites: string[];
  /** Indicative INR range — see file header. Absent where no meaningful government fee applies (e.g. asking the seller). */
  typicalCostInr?: { low: number; high: number };
  /** Indicative working-day range — see file header. */
  typicalDurationDays?: { low: number; high: number };
  feasibility: 'straightforward' | 'moderate' | 'difficult' | 'blocked';
  risks: string[];
}

/** Every known way to close one category of Bengaluru proof gap. */
export interface ProofTopic {
  key: string;
  label: string;
  /** DocumentKind(s) in the shared schema this topic corresponds to. */
  documentKinds: DocumentKind[];
  /** KARNATAKA_PACK.titleChecks keys this topic bears on. */
  complianceCheckKeys: string[];
  /** One or two sentences of what this proof is and why it matters. */
  context: string;
  /** Ranked best-first where a genuine ranking exists; order is not authoritative for every case. */
  routes: ProofRouteTemplate[];
  /**
   * Present only where "just go get it" is not actually true for at least
   * some real-world instances of this gap — the honest statement of what the
   * options really are when the primary route is structurally blocked (the
   * buyer isn't the applicant, the underlying defect can't be cured on
   * demand, the authority won't issue on request). The agent must surface
   * this rather than inventing a cheerful procedure when the case matches.
   */
  blockedNote?: string;
}

const INR: CurrencyCode = 'INR';

export const KARNATAKA_PROOF_TOPICS: ProofTopic[] = [
  /* ------------------------------------------------------------------ */
  {
    key: 'khata_extract',
    label: 'Khata extract & khata certificate (incl. transfer and bifurcation)',
    documentKinds: ['khata_extract'],
    complianceCheckKeys: ['khata_classification'],
    context:
      'The BBMP register entry confirming the property is recorded for tax and utility purposes. Whether it is A-khata (fully compliant) or B-khata (recorded but not compliant) is the single biggest binary in a Bengaluru title screen, and it gates bank lending, building-plan sanction and resale liquidity.',
    routes: [
      {
        id: 'khata_extract_online_reprint',
        kind: 'online_portal',
        title: 'Reprint/extract of an already-issued khata',
        authority: 'BBMP',
        portalOrAddress: 'BBMP e-Khata / property-tax self-service portal (branding has changed more than once — confirm the current URL)',
        formOrReference: 'Khata extract / khata certificate request',
        steps: [
          'Search by PID, old khata number, or SAS application number.',
          'Download or request a reprint of the extract and certificate.',
          'Cross-check the owner name, survey number and area against the sale deed before relying on it.',
        ],
        prerequisites: ['PID or old khata/SAS number', 'Owner name as recorded'],
        typicalCostInr: { low: 25, high: 200 },
        typicalDurationDays: { low: 0, high: 3 },
        feasibility: 'straightforward',
        risks: ['Only works if a khata already exists and is digitised — does nothing for a property with no khata on record.'],
      },
      {
        id: 'khata_transfer_mutation',
        kind: 'in_person_office',
        title: 'Khata transfer (mutation) after a registered sale',
        authority: 'BBMP — jurisdictional zonal Revenue Office / Assistant Revenue Officer',
        portalOrAddress: 'Jurisdictional BBMP zonal office (Sakala-notified service)',
        formOrReference: 'Khata transfer application (Sakala service)',
        steps: [
          'File the khata-transfer application with the registered sale deed, previous khata, latest tax receipt and an indemnity bond/affidavit.',
          'Pay the khata transfer fee (a percentage of the property value/guidance value in most schedules — the exact percentage and any minimum have been revised over time; confirm the current rate before budgeting).',
          'Attend any field verification BBMP schedules.',
          'Collect the fresh khata once approved.',
        ],
        prerequisites: ['Registered sale deed in the new owner\'s name', 'Previous khata certificate', 'Up-to-date property tax receipts'],
        typicalCostInr: { low: 1000, high: 50000 },
        typicalDurationDays: { low: 15, high: 45 },
        feasibility: 'moderate',
        risks: [
          'Backlogged in many wards well beyond the Sakala-notified window.',
          'Can be refused or stalled if property-tax arrears or a betterment-charge shortfall surface during the field check.',
        ],
      },
      {
        id: 'khata_bifurcation',
        kind: 'in_person_office',
        title: 'Khata bifurcation (splitting one khata after partition/subdivision)',
        authority: 'BBMP — jurisdictional zonal Revenue Office',
        formOrReference: 'Khata bifurcation application',
        steps: [
          'File with the registered partition/release deed or the layout sketch showing the subdivided site.',
          'Provide the existing (undivided) khata and tax records.',
          'Undergo field inspection — bifurcation is rarely granted on paper alone.',
          'Collect the separate khata(s) once the survey/inspection is accepted.',
        ],
        prerequisites: ['Registered partition or release deed establishing the individual site', 'Existing khata for the larger parcel'],
        typicalCostInr: { low: 1000, high: 30000 },
        typicalDurationDays: { low: 30, high: 60 },
        feasibility: 'moderate',
        risks: ['Slower than a plain transfer because it requires a fresh survey match; a poorly-drafted partition deed is a common cause of rejection.'],
      },
      {
        id: 'khata_licensed_intermediary',
        kind: 'authorised_intermediary',
        title: 'File through a licensed documentation agent / property liaison',
        authority: 'Private licensed intermediary (not a government body)',
        steps: [
          'Engage a documentation agent or advocate experienced with BBMP khata filings.',
          'They assemble the same underlying documents and file/track the application on your behalf.',
        ],
        prerequisites: ['Same underlying documents as the direct route — an intermediary cannot substitute for missing ones'],
        typicalCostInr: { low: 2000, high: 15000 },
        typicalDurationDays: { low: 15, high: 45 },
        feasibility: 'straightforward',
        risks: ['A liaison speeds up filing and tracking but cannot manufacture documents that do not exist, and does not change BBMP\'s own processing time.'],
      },
      {
        id: 'khata_duplicate_lost',
        kind: 'reconstruct_from_secondary',
        title: 'Duplicate certificate for a genuinely lost original',
        authority: 'BBMP — jurisdictional zonal Revenue Office',
        steps: [
          'File a police complaint / GD entry for the lost document (commonly required as supporting evidence).',
          'Publish a public notice in a newspaper inviting objections, where the office requires it.',
          'Apply for a duplicate citing the loss, with an indemnity bond.',
        ],
        prerequisites: ['Some independent trace of the original khata (old tax receipts, PID) so BBMP can locate its own record'],
        typicalCostInr: { low: 500, high: 5000 },
        typicalDurationDays: { low: 20, high: 45 },
        feasibility: 'moderate',
        risks: ['If BBMP\'s own record cannot be located either, this route stalls — it depends on BBMP\'s file existing, not just the applicant\'s copy.'],
      },
    ],
    blockedNote:
      'Where the property is B-khata because of an unapproved layout, unconverted (agricultural) land, or unpaid dues, filing a khata-transfer or bifurcation application does not upgrade it to A-khata — the underlying defect has to be cured first (see the DC-conversion and layout-approval topics), and BBMP has periodically run discretionary B-to-A conversion or regularisation schemes rather than offering it as a standing service. Where the underlying defect cannot be cured, or no regularisation window is open: (1) price the transaction as a B-khata purchase (cash-heavy, harder to finance, real resale discount) rather than assuming conversion is a formality, (2) make seller-funded conversion a condition precedent to registration if the seller is willing and the defect is genuinely curable, or (3) walk away. Do not present "just apply for A-khata" as a resolved next step for a B-khata case without this caveat.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'e_khata',
    label: 'e-Khata (digitised khata record)',
    documentKinds: ['khata_extract'],
    complianceCheckKeys: ['e_khata_issuance'],
    context:
      'The digitised BBMP record Karnataka has been migrating property registers into. A growing number of lenders and the Sub-Registrar\'s own systems treat its absence as a registration or lending blocker even where the underlying paper khata is otherwise in order.',
    routes: [
      {
        id: 'e_khata_migration_online',
        kind: 'online_portal',
        title: 'Apply for e-khata migration from an existing paper khata',
        authority: 'BBMP',
        portalOrAddress: 'BBMP e-khata migration portal (name/URL has changed with successive BBMP IT rollouts — confirm current one)',
        formOrReference: 'e-Khata migration request',
        steps: [
          'Upload the existing paper khata certificate, latest tax receipt and sale deed.',
          'BBMP\'s system cross-checks the record against its own database.',
          'Where the match is clean, e-khata issues without a counter visit; where survey data mismatches, expect a manual step.',
        ],
        prerequisites: ['An existing paper A-khata (or equivalent) already in the current owner\'s name'],
        typicalCostInr: { low: 0, high: 500 },
        typicalDurationDays: { low: 1, high: 20 },
        feasibility: 'straightforward',
        risks: ['Mismatches between the paper record and BBMP\'s digitised base are common for older properties and push this into a manual, slower path.'],
      },
      {
        id: 'e_khata_manual_reconciliation',
        kind: 'in_person_office',
        title: 'Manual reconciliation at the ward office when online migration stalls',
        authority: 'BBMP — jurisdictional ward/zonal office',
        steps: [
          'Visit the ward office with the paper khata and tax history.',
          'Have staff reconcile the mismatch (survey number, area, or owner-name discrepancy) against BBMP\'s master record.',
          'Re-submit or re-trigger the e-khata request once reconciled.',
        ],
        prerequisites: ['Paper khata', 'Full tax-payment history'],
        typicalCostInr: { low: 0, high: 1000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'moderate',
        risks: ['Reconciliation delay is a common, genuine bottleneck rather than a formality — do not assume a fixed short timeline.'],
      },
    ],
    blockedNote:
      'e-Khata is generated from an existing paper khata — there is no route to obtain one for a property that has no valid paper khata (B-khata or none) in the first place. Fix the underlying khata_extract gap first.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'encumbrance_certificate',
    label: 'Encumbrance certificate (30-year, and closing a shorter window)',
    documentKinds: ['encumbrance_certificate'],
    complianceCheckKeys: ['encumbrance_continuity'],
    context:
      'The Sub-Registrar\'s record of every registered transaction and charge over a chosen period. A clean nil-encumbrance certificate for the full requested window is what rules out an undisclosed mortgage, lien or pending litigation; a gap in the window is exactly where such a thing hides.',
    routes: [
      {
        id: 'ec_kaveri_online',
        kind: 'online_portal',
        title: 'Apply for EC over a specified date range',
        authority: 'Sub-Registrar, via Kaveri Online Services',
        portalOrAddress: 'Kaveri Online Services (kaverionline.karnataka.gov.in)',
        formOrReference: 'Form 22 (EC application); EC issued as Form 15 (encumbrances found) or Form 16 (nil)',
        steps: [
          'Search by survey number/property description and specify the required date range.',
          'Pay the online fee (charged per year of search in most schedules).',
          'Download the EC for whatever portion of the range the digitised index covers.',
        ],
        prerequisites: ['Survey number / property description', 'Village/taluk and jurisdictional Sub-Registrar office'],
        typicalCostInr: { low: 200, high: 1500 },
        typicalDurationDays: { low: 0, high: 5 },
        feasibility: 'straightforward',
        risks: [
          'Online records typically only go back to whenever that SRO\'s indices were computerised (commonly somewhere in the late 1990s to 2000s, but this varies by office) — it will not by itself produce a genuine 30-year EC for an older property.',
        ],
      },
      {
        id: 'ec_manual_search_pre_digitisation',
        kind: 'in_person_office',
        title: 'Manual register search for years before computerisation',
        authority: 'Jurisdictional Sub-Registrar office',
        formOrReference: 'Written manual-search application specifying the exact years needed',
        steps: [
          'File a written application at the SRO naming the precise years not covered online.',
          'Pay the manual-search fee (higher than the online per-year fee in most schedules).',
          'Await the clerk\'s physical search of the Index II registers for those years.',
          'Collect the EC (or a "nil for the searched years" endorsement) once complete.',
        ],
        prerequisites: ['Exact years to be searched', 'As much of the survey number/party-name detail as can be supplied, to narrow the manual search'],
        typicalCostInr: { low: 500, high: 5000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'moderate',
        risks: [
          'This is genuinely slower and less certain than the online route — a clerk manually checking bound registers can take materially longer than any notified SLA, especially in a high-volume office.',
          'Bengaluru\'s Sub-Registrar jurisdictions have been redrawn more than once; the historical volumes for an older survey number may now sit with a different present-day SRO than the one with current jurisdiction — confirm which office holds the relevant years before filing.',
        ],
      },
      {
        id: 'ec_licensed_intermediary',
        kind: 'authorised_intermediary',
        title: 'Deed writer / advocate empanelled with the Sub-Registrar',
        authority: 'Private licensed intermediary',
        steps: [
          'Engage an advocate or deed writer who routinely files manual-search EC requests at that specific SRO.',
          'They track the physical search and collect the certificate.',
        ],
        prerequisites: ['Same particulars as the direct manual-search route'],
        typicalCostInr: { low: 1000, high: 8000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'straightforward',
        risks: ['Speeds up liaison, not the underlying manual-search turnaround.'],
      },
      {
        id: 'ec_gap_secondary_evidence',
        kind: 'reconstruct_from_secondary',
        title: 'Bridge a genuinely irrecoverable gap with secondary evidence',
        authority: 'N/A — assembled by the buyer\'s advocate, not issued by an authority',
        steps: [
          'Obtain the mother-deed chain covering the gap years, so ownership continuity is independently evidenced even without an EC for those years.',
          'Obtain a seller affidavit / indemnity specifically addressing the gap period.',
          'Have a lawyer render a title-search opinion that explicitly states the gap and what it was bridged with.',
        ],
        prerequisites: ['Mother-deed chain', 'Cooperative seller willing to sign an affidavit'],
        feasibility: 'difficult',
        risks: [
          'This is a materially weaker substitute for an actual EC, not an equivalent — it should be flagged to the buyer as reduced protection, never presented as closing the gap on the same footing as a real certificate.',
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'mother_deed_sale_deed_certified_copy',
    label: 'Certified copy of the sale deed / mother deed',
    documentKinds: ['mother_deed', 'title_deed'],
    complianceCheckKeys: [],
    context:
      'The registered instrument(s) establishing the unbroken ownership chain. A certified copy pulled independently from the Sub-Registrar is the trustworthy verification step, distinct from — and more reliable than — a photocopy handed over by the seller.',
    routes: [
      {
        id: 'certified_copy_kaveri_online',
        kind: 'online_portal',
        title: 'Certified-copy e-service for a digitised registration',
        authority: 'Sub-Registrar, via Kaveri Online Services',
        formOrReference: 'Certified-copy request, by registration/document number, book and year',
        steps: [
          'Search by document number, year and SRO (or by executant/claimant name and approximate year if the exact number is unknown).',
          'Pay the per-page copying fee.',
          'Download the certified copy once matched.',
        ],
        prerequisites: ['Registration/document number and year, or enough party/date detail to locate it'],
        typicalCostInr: { low: 100, high: 1000 },
        typicalDurationDays: { low: 0, high: 5 },
        feasibility: 'straightforward',
        risks: ['Only covers documents registered after that SRO\'s own digitisation cutoff.'],
      },
      {
        id: 'certified_copy_manual_sro',
        kind: 'in_person_office',
        title: 'In-person application for a pre-digitisation deed',
        authority: 'Jurisdictional Sub-Registrar office (the one where the deed was originally registered)',
        steps: [
          'File an application with whatever book/volume/page reference or party names/approximate year are known.',
          'Pay the search fee plus copying fee.',
          'Await the manual register search and collect the certified copy.',
        ],
        prerequisites: ['As much registration detail as can be assembled — book/volume/page speeds this up considerably'],
        typicalCostInr: { low: 200, high: 2000 },
        typicalDurationDays: { low: 7, high: 21 },
        feasibility: 'moderate',
        risks: ['A very old deed with no known reference number can take a genuinely long manual search, or may not be locatable at all if volumes were damaged or lost.'],
      },
      {
        id: 'mother_deed_from_seller',
        kind: 'from_seller',
        title: 'Request the registered copy (or full link-document chain) from the seller',
        authority: 'N/A — the current owner',
        steps: [
          'Ask the seller for their registered sale deed and, for the mother deed, the full chain of prior link documents establishing how they came to own it.',
        ],
        prerequisites: [],
        feasibility: 'straightforward',
        risks: [
          'Fastest and free, but the buyer is relying entirely on what the seller chooses to produce — an independently pulled certified copy from the Sub-Registrar is still the step that actually verifies it, and should follow rather than be skipped.',
        ],
      },
      {
        id: 'mother_deed_reconstruct_secondary',
        kind: 'reconstruct_from_secondary',
        title: 'Reconstructing an untraceable chain from secondary records',
        authority: 'N/A — assembled from multiple sources, not issued by one authority',
        steps: [
          'Pull a certified RTC (Record of Rights, Tenancy and Crops) extract or Bhoomi record referencing the transaction, for land of agricultural origin.',
          'Assemble whatever certified copies, mutation entries, or revenue records corroborate the ownership chain.',
          'Where the chain still cannot be established with confidence, consult a lawyer on a title-establishing or declaratory suit — genuinely slow (commonly many months to a few years) and a last resort, not a routine step.',
        ],
        prerequisites: [],
        feasibility: 'difficult',
        risks: ['This is meaningfully weaker than a traceable registered chain and should be flagged as materially higher title risk, not treated as a like-for-like substitute.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'dc_conversion_order',
    label: 'DC conversion order (agricultural to non-agricultural land use)',
    documentKinds: ['conversion_certificate'],
    complianceCheckKeys: ['dc_conversion'],
    context:
      'The Deputy Commissioner\'s order permitting non-agricultural use of land that was originally agricultural revenue land. Without it, any building on the land is irregular regardless of what the khata says, and it is a required precursor to a clean BBMP khata for such land.',
    routes: [
      {
        id: 'dc_conversion_application',
        kind: 'in_person_office',
        title: 'Apply for land-use conversion',
        authority: 'Office of the Deputy Commissioner (Land Revenue) / revenue department conversion section',
        formOrReference: 'Conversion application under the Karnataka Land Revenue Act, 1964, s.95',
        steps: [
          'File the application with an RTC extract, survey sketch and the landowner\'s title documents.',
          'Undergo the revenue department\'s site inspection and clearances.',
          'Pay the conversion fee, typically assessed against the guidance value of the land.',
          'Collect the conversion order once granted.',
        ],
        prerequisites: ['Applicant must be the landowner (or hold a valid power of attorney from them) — see the blocked-scenario note below', 'Current RTC extract', 'Survey sketch'],
        typicalCostInr: { low: 10000, high: 300000 },
        typicalDurationDays: { low: 45, high: 180 },
        feasibility: 'difficult',
        risks: [
          'One of the slower, more inspection-dependent processes in this corpus — departmental SLAs are commonly cited in the 60-90 working-day range, but real-world experience running well beyond that is common, and this file cannot confirm a reliable current figure.',
          'Can be refused where the land falls in a category ineligible for conversion (e.g. certain tank-bed, forest, or otherwise restricted classifications) irrespective of the applicant\'s intent.',
        ],
      },
      {
        id: 'dc_conversion_surveyor_liaison',
        kind: 'authorised_intermediary',
        title: 'Licensed surveyor / liaison agent for the technical filing',
        authority: 'Private licensed surveyor / liaison agent',
        steps: ['Engage a licensed surveyor to prepare the required sketch and a liaison agent to file and track the application.'],
        prerequisites: ['Same underlying eligibility and ownership prerequisites as the direct route'],
        typicalCostInr: { low: 5000, high: 50000 },
        typicalDurationDays: { low: 45, high: 180 },
        feasibility: 'moderate',
        risks: ['Improves the odds of a technically clean filing but does not shorten the department\'s own inspection/approval timeline.'],
      },
    ],
    blockedNote:
      'DC conversion can only be applied for by the landowner (or an agent holding their valid power of attorney) — a prospective buyer has no standing to apply for conversion on land they do not yet own. Where the property remains unconverted agricultural land at the time of screening, the real options are: (1) make seller-completed conversion a condition precedent to registration (this adds real time to the transaction and is not guaranteed to succeed), (2) proceed only via an agreement-to-sell contingent on conversion, understanding the legal fragility that structure carries and the scrutiny such arrangements have drawn from courts and RERA, (3) price in the unconverted status and the construction-legality risk it carries rather than treat it as fixable pre-purchase, or (4) walk away. Do not present "apply for DC conversion" as a next step the buyer themselves can take before completing the purchase.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'property_tax_receipt_sas',
    label: 'BBMP property tax paid receipt & SAS number',
    documentKinds: ['property_tax_receipt'],
    complianceCheckKeys: [],
    context:
      'Confirms tax dues are current and carries the SAS (Self-Assessment Scheme) application number BBMP uses to trace the property across its systems — the reference most other BBMP lookups key off.',
    routes: [
      {
        id: 'tax_receipt_online_reprint',
        kind: 'online_portal',
        title: 'Look up and reprint the paid receipt / find the SAS number',
        authority: 'BBMP property tax self-service portal',
        steps: [
          'Search by PID, old assessment/khata number, or owner name and ward.',
          'Reprint the latest paid receipt, which will display the SAS application number.',
        ],
        prerequisites: ['PID or old khata/assessment number (or enough owner/ward detail for a name search)'],
        typicalCostInr: { low: 0, high: 100 },
        typicalDurationDays: { low: 0, high: 1 },
        feasibility: 'straightforward',
        risks: ['Search-by-name can be unreliable for common names or where the property spans a ward boundary re-classification.'],
      },
      {
        id: 'tax_receipt_ward_office',
        kind: 'in_person_office',
        title: 'Reconciliation at the ward Revenue office',
        authority: 'BBMP — jurisdictional ward Revenue office',
        steps: ['Visit with any old receipts or the khata to help staff locate a record the online search cannot find.'],
        prerequisites: ['Any available prior tax documentation'],
        typicalCostInr: { low: 0, high: 500 },
        typicalDurationDays: { low: 1, high: 10 },
        feasibility: 'moderate',
        risks: ['Needed mainly for very old or recently-clubbed/split assessments.'],
      },
      {
        id: 'tax_receipt_from_seller',
        kind: 'from_seller',
        title: 'Ask the seller directly',
        authority: 'N/A — the current owner',
        steps: ['Request the SAS number and recent receipts from the seller.'],
        prerequisites: [],
        feasibility: 'straightforward',
        risks: ['Verify independently on the BBMP portal — a seller with tax arrears has an incentive not to volunteer that, and a photocopy alone does not prove currency.'],
      },
    ],
    blockedNote:
      'A fresh SAS self-assessment generally requires a valid khata to already be in place — if there is no khata on record at all, a tax assessment cannot be originated independently of first resolving the khata_extract gap.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'sanctioned_plan_commencement_occupancy',
    label: 'Sanctioned building plan, commencement certificate, occupancy certificate',
    documentKinds: ['sanctioned_plan_bbmp', 'commencement_certificate', 'occupancy_certificate'],
    complianceCheckKeys: ['occupancy_certificate_compliance'],
    context:
      'The sanctioned plan is what BBMP approved; the commencement certificate confirms construction was authorised to begin against it; the occupancy certificate confirms BBMP inspected the finished building and found it matched. OC absence is one of the most common reasons a Bengaluru apartment is refused a home loan.',
    routes: [
      {
        id: 'sanctioned_plan_copy_request',
        kind: 'in_person_office',
        title: 'Certified copy of an already-sanctioned plan',
        authority: 'BBMP Town Planning wing, jurisdictional zonal office (some post-digitisation records searchable via BBMP\'s online building-plan portal)',
        steps: [
          'Search or request by sanction number/PID if verifying an existing approval.',
          'Pay the copying fee and collect the certified copy.',
        ],
        prerequisites: ['Sanction number or PID, where known'],
        typicalCostInr: { low: 200, high: 2000 },
        typicalDurationDays: { low: 5, high: 20 },
        feasibility: 'moderate',
        risks: ['Retrieval for older, pre-digitisation sanctions can be slow and is not always successful if the physical file is not readily located.'],
      },
      {
        id: 'rti_confirm_bbmp_records',
        kind: 'in_person_office',
        title: 'RTI request to confirm whether a sanction/OC exists on BBMP\'s file',
        authority: 'BBMP Public Information Officer, under the Right to Information Act 2005',
        formOrReference: 'RTI application',
        steps: [
          'File a written RTI request asking BBMP to confirm whether a sanctioned plan and/or occupancy certificate exists for the specific PID/address.',
          'BBMP has a statutory response window (commonly cited as around 30 days).',
        ],
        prerequisites: ['PID or precise address'],
        typicalCostInr: { low: 10, high: 50 },
        typicalDurationDays: { low: 20, high: 35 },
        feasibility: 'straightforward',
        risks: ['Confirms whether a record exists but does not itself produce the document — a positive RTI answer still needs to be followed by a certified-copy request.'],
      },
      {
        id: 'occupancy_certificate_from_developer',
        kind: 'from_seller',
        title: 'Request from the seller / builder / owners\' association',
        authority: 'N/A — the developer or the unit seller',
        steps: ['Ask the seller, or the apartment association if the seller does not have it, whether the OC was ever issued for the block/tower and request a copy.'],
        prerequisites: [],
        feasibility: 'moderate',
        risks: ['In many otherwise-reputable developments the OC was simply never applied for — this is a known, common gap, not necessarily a sign of anything else wrong.'],
      },
    ],
    blockedNote:
      'A commencement certificate is issued to the developer/builder during construction and cannot be originated retroactively by a buyer of a completed unit — only a copy of one already issued can be obtained. An occupancy certificate that was never applied for cannot be obtained by an individual unit buyer either: it must be applied for by the developer/builder or (post-handover) the owners\' association, and BBMP will only issue it if the built structure is close enough to the sanctioned plan to pass inspection. Where OC is missing: (1) push the developer/association to file for it — sometimes achievable, sometimes not if deviations from plan are significant, (2) check whether a state amnesty/regularisation scheme for unauthorised construction is currently open (these run periodically, are not always available, and eligibility varies — verify current status rather than assuming one exists), or (3) accept the absence as a standing risk to financing and resale. Do not present "get the OC" as a simple, always-achievable next step.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'betterment_charges_receipt',
    label: 'Betterment charges receipt',
    documentKinds: ['betterment_charges_receipt'],
    complianceCheckKeys: [],
    context:
      'Confirms development/betterment charges levied by BBMP or BDA for area infrastructure were paid. Unpaid charges can attach to the property and block a khata transfer at registration.',
    routes: [
      {
        id: 'betterment_charges_duplicate',
        kind: 'in_person_office',
        title: 'Duplicate receipt / no-dues certificate',
        authority: 'BBMP or BDA revenue counter (whichever levied it)',
        steps: ['Request a duplicate receipt or a clearance/no-dues certificate against the PID or khata number.'],
        prerequisites: ['PID or khata number'],
        typicalCostInr: { low: 0, high: 500 },
        typicalDurationDays: { low: 1, high: 10 },
        feasibility: 'straightforward',
        risks: [],
      },
      {
        id: 'betterment_charges_from_seller',
        kind: 'from_seller',
        title: 'Ask the seller / original developer',
        authority: 'N/A',
        steps: ['Request the original receipt from the seller or the layout\'s original developer.'],
        prerequisites: [],
        feasibility: 'straightforward',
        risks: [],
      },
      {
        id: 'betterment_charges_arrear_payment',
        kind: 'reconstruct_from_secondary',
        title: 'Pay the outstanding charge to clear the record, where it was never paid',
        authority: 'BBMP or BDA revenue counter',
        steps: [
          'Request BBMP/BDA to compute the arrear betterment charge against the property.',
          'Pay the computed amount to obtain a clean record going forward.',
        ],
        prerequisites: [],
        feasibility: 'moderate',
        risks: ['This shifts a cost the seller should logically have borne onto whoever pays it now — factor it into price negotiation rather than treating it as a free fix.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'bda_allotment_possession',
    label: 'BDA allotment letter & possession certificate',
    documentKinds: ['possession_certificate'],
    complianceCheckKeys: ['bda_bmrda_acquisition'],
    context:
      'For a BDA-allotted site, proves the original allottee lawfully took possession from the Bangalore Development Authority before any resale began the chain. BDA sites also generally require BDA to endorse each subsequent transfer, not just a private sale deed.',
    routes: [
      {
        id: 'bda_certified_copy',
        kind: 'in_person_office',
        title: 'Certified copy of the allotment/possession record',
        authority: 'BDA Estates section / concerned Estate Officer',
        steps: [
          'Apply with the site/allotment reference number.',
          'Request the certified copy of the allotment letter and possession certificate.',
        ],
        prerequisites: ['Site number, layout name, and allotment reference where known'],
        typicalCostInr: { low: 200, high: 2000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'moderate',
        risks: ['Digitised coverage is uneven across allotment years — older allotments may require a slower manual file search.'],
      },
      {
        id: 'bda_from_seller_chain',
        kind: 'from_seller',
        title: 'Full chain of BDA-endorsed transfer documents from the seller',
        authority: 'N/A',
        steps: ['Request the allotment letter and every subsequent BDA-endorsed transfer document from the seller, not just the most recent sale deed.'],
        prerequisites: [],
        feasibility: 'straightforward',
        risks: ['A private sale deed alone, without BDA\'s own transfer endorsement, is a known gap on BDA sites and should not be treated as sufficient by itself.'],
      },
      {
        id: 'bda_duplicate_lost_allotment',
        kind: 'reconstruct_from_secondary',
        title: 'Duplicate for a lost original allotment letter',
        authority: 'BDA Estates section',
        steps: [
          'Apply in writing citing the loss, typically with an indemnity bond.',
          'A newspaper public notice inviting objections is commonly required.',
        ],
        prerequisites: [],
        feasibility: 'difficult',
        risks: ['Processing a duplicate-allotment request tends to run considerably longer than a routine certified-copy request, and is not guaranteed if BDA\'s own file is also incomplete.'],
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'form_9_11',
    label: 'Form 9 & 11 (gram panchayat property register and tax-paid certificate)',
    documentKinds: ['form_9_11'],
    complianceCheckKeys: ['gram_panchayat_form_limits'],
    context:
      'The gram-panchayat equivalent of a khata for areas BBMP has not (yet) absorbed: Form 9 is the property-register extract, Form 11 the tax-paid certificate. Sits outside BBMP\'s building-plan and khata regime entirely.',
    routes: [
      {
        id: 'form_9_11_panchayat_office',
        kind: 'in_person_office',
        title: 'Apply directly at the gram panchayat office',
        authority: 'Concerned Gram Panchayat',
        steps: [
          'File with the sale deed/RTC and prior tax receipts.',
          'Most panchayats process this largely as an in-person, manual service — online coverage is far less complete than BBMP\'s.',
        ],
        prerequisites: ['Sale deed or RTC extract', 'Prior tax receipts, where any exist'],
        typicalCostInr: { low: 100, high: 2000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'moderate',
        risks: ['Panchayat offices normally issue Form 9/11 only to the recorded owner or their authorised agent — a buyer pre-purchase typically needs the seller\'s cooperation to apply or to authorise a check.'],
      },
      {
        id: 'form_9_11_e_swathu',
        kind: 'online_portal',
        title: 'Check status on Karnataka\'s panchayat property digitisation portal',
        authority: 'Rural Development & Panchayat Raj Department (e-Swathu or successor system)',
        steps: ['Search by property/khata reference where the panchayat has been onboarded to the digitised system.'],
        prerequisites: ['Panchayat name and property reference'],
        typicalCostInr: { low: 0, high: 100 },
        typicalDurationDays: { low: 0, high: 5 },
        feasibility: 'moderate',
        risks: ['Coverage and reliability vary considerably panchayat to panchayat — treat this as "worth checking", not as an assured source, and fall back to the in-person route if it comes up empty.'],
      },
    ],
    blockedNote:
      'Where the area has since been annexed into BBMP limits, Form 9/11 records are not simply superseded automatically — a separate BBMP khata conversion process applies, and that is a distinct gap from obtaining the Form 9/11 itself (see the khata_extract topic). Do not treat producing the Form 9/11 as resolving jurisdictional status if annexation is in question.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'krera_registration',
    label: 'K-RERA registration',
    documentKinds: ['rera_registration'],
    complianceCheckKeys: ['krera_registration'],
    context:
      'Confirms a project that should be registered with Karnataka RERA actually is, giving statutory recourse on construction delay and defects. Registration is obtained by the promoter, not by an individual buyer.',
    routes: [
      {
        id: 'krera_public_search',
        kind: 'online_portal',
        title: 'Verify an existing registration independently',
        authority: 'Karnataka Real Estate Regulatory Authority (K-RERA)',
        portalOrAddress: 'K-RERA public project-search portal',
        steps: ['Search by project name, promoter, or district and compare the result against the registration number the seller/promoter cites.'],
        prerequisites: ['Project name or claimed registration number'],
        typicalCostInr: { low: 0, high: 0 },
        typicalDurationDays: { low: 0, high: 0 },
        feasibility: 'straightforward',
        risks: ['A claimed registration number that does not appear in the public search is itself a significant finding, not a data-entry issue to assume away.'],
      },
      {
        id: 'krera_written_query',
        kind: 'in_person_office',
        title: 'Direct written query / RTI to K-RERA',
        authority: 'K-RERA',
        steps: ['Where the project does not appear in search but the promoter insists it is registered, write to K-RERA (or file an RTI) asking for an authoritative confirmation.'],
        prerequisites: ['Project name, promoter name, address'],
        typicalCostInr: { low: 0, high: 50 },
        typicalDurationDays: { low: 15, high: 30 },
        feasibility: 'straightforward',
        risks: [],
      },
    ],
    blockedNote:
      'K-RERA registration is obtained by the promoter/developer, not by a unit buyer, and only applies to projects meeting RERA\'s applicability thresholds. A buyer cannot register a project themselves. Where a project that should be registered is not: (1) treat it as a compliance red flag on the promoter rather than a document to source, (2) a lawyer can advise on a complaint to K-RERA, which has powers to direct registration or penalise non-compliant promoters, (3) for a long-completed project past the point registration would materially help, confirm with counsel whether pursuing registration is even still the relevant remedy for this purchase.',
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'layout_approval_plan',
    label: 'Layout approval plan (BDA / BMRDA / panchayat / private) and the revenue-layout problem',
    documentKinds: ['other'],
    complianceCheckKeys: ['layout_approval_status'],
    context:
      'The order sanctioning the subdivision a site sits in. A site with no traceable layout-approval order behind it is the paperwork signature of a revenue layout — sites carved directly out of agricultural revenue land and sold by sketch or GPA without any layout-plan sanction — which is a serious, not a minor, finding.',
    routes: [
      {
        id: 'layout_approval_bda_bmrda_search',
        kind: 'in_person_office',
        title: 'Request the layout approval order by layout name/number',
        authority: 'BDA or BMRDA layout section (whichever approved the layout)',
        steps: [
          'Identify the layout name and approving authority from the sale deed or the seller.',
          'Request the sanctioned layout plan / approval order by that reference.',
        ],
        prerequisites: ['Layout name and, where known, approval order number'],
        typicalCostInr: { low: 200, high: 2000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'moderate',
        risks: ['Retrieval for older or smaller layouts can be slow and is not always successful.'],
      },
      {
        id: 'layout_approval_panchayat_search',
        kind: 'in_person_office',
        title: 'Panchayat-approved layout records',
        authority: 'Concerned Gram Panchayat / local planning authority',
        steps: ['Request the layout approval record directly from the panchayat that approved it.'],
        prerequisites: ['Layout name'],
        typicalCostInr: { low: 100, high: 1000 },
        typicalDurationDays: { low: 10, high: 30 },
        feasibility: 'moderate',
        risks: [],
      },
      {
        id: 'layout_approval_from_developer',
        kind: 'from_seller',
        title: 'Request from the seller / original layout developer',
        authority: 'N/A',
        steps: ['Ask the seller, or trace the original private developer of the layout, for their copy of the approval order.'],
        prerequisites: [],
        feasibility: 'moderate',
        risks: ['Often the only practical source for an older private layout, since the approving authority\'s own retrieval can be slow and imprecise for smaller, older layouts.'],
      },
    ],
    blockedNote:
      'A genuinely unapproved or revenue layout cannot usually be retroactively approved simply by filing an application. Regularisation of unauthorised layouts in Karnataka has historically occurred only through periodic, discretionary state government schemes (an "Akrama-Sakrama"-type scheme is the one most commonly cited), which are not always open, do not guarantee approval even when open, and have themselves faced legal challenge and uncertainty over validity at various points. Where no layout approval exists and no regularisation window is confirmed currently open: (1) confirm whether the site can even be registered, khata-ed or building-plan-sanctioned at all in this state (often refused outright on an unapproved layout), (2) price the material discount this should carry rather than treat it as a temporary paperwork gap, or (3) walk away. Do not present "get the layout approved" as a routine next step without this caveat attached.',
  },
];

/** Look up a topic by its key — used to build a case-specific excerpt if ever needed. */
export function findProofTopic(key: string): ProofTopic | undefined {
  return KARNATAKA_PROOF_TOPICS.find(t => t.key === key);
}

/** Provenance banner repeated at the head of the rendered corpus — see file header for the full rationale. */
export const KARNATAKA_PROOF_ROUTES_VERIFY_BANNER =
  'Every fee and timeline below is an indicative range from general knowledge of these processes, not a live read of a ' +
  'current notification or portal. Portal names, fee schedules and Sakala/departmental timelines change by circular and ' +
  'IT rollout. Treat every figure as a starting point for the buyer to verify on the relevant portal or with the office ' +
  'directly — never state a fee or duration as settled.';

/**
 * Render the full corpus as a single deterministic text block for the
 * agent's cached system prefix. Deterministic ordering and no timestamps —
 * this must byte-for-byte match across calls for prompt caching to hold.
 */
export function renderKarnatakaProofRoutesCorpus(): string {
  const lines: string[] = [];
  lines.push('=== Karnataka / Bengaluru proof-sourcing corpus ===');
  lines.push(KARNATAKA_PROOF_ROUTES_VERIFY_BANNER);
  lines.push('');
  for (const topic of KARNATAKA_PROOF_TOPICS) {
    lines.push(`--- ${topic.label} (topic key: ${topic.key}) ---`);
    lines.push(`Document kind(s): ${topic.documentKinds.join(', ')}`);
    if (topic.complianceCheckKeys.length > 0) {
      lines.push(`Related compliance check(s): ${topic.complianceCheckKeys.join(', ')}`);
    }
    lines.push(topic.context);
    for (const route of topic.routes) {
      const cost = route.typicalCostInr ? `₹${route.typicalCostInr.low}-${route.typicalCostInr.high} (indicative)` : 'no material government fee, or not applicable';
      const duration = route.typicalDurationDays ? `${route.typicalDurationDays.low}-${route.typicalDurationDays.high} working days (indicative)` : 'not applicable';
      lines.push(`* [${route.kind}] ${route.title} — ${route.authority}${route.portalOrAddress ? ` (${route.portalOrAddress})` : ''}`);
      if (route.formOrReference) lines.push(`  Form/reference: ${route.formOrReference}`);
      lines.push(`  Steps: ${route.steps.join(' -> ')}`);
      if (route.prerequisites.length > 0) lines.push(`  Prerequisites: ${route.prerequisites.join('; ')}`);
      lines.push(`  Typical cost: ${cost}. Typical duration: ${duration}. Feasibility: ${route.feasibility}.`);
      if (route.risks.length > 0) lines.push(`  Risks: ${route.risks.join(' | ')}`);
    }
    if (topic.blockedNote) {
      lines.push(`  WHEN STRUCTURALLY BLOCKED: ${topic.blockedNote}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
