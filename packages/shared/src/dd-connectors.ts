/**
 * The connector and watcher registry: every department's sources of record,
 * and the alarms that fire when what was fetched from them goes stale.
 *
 * Connectors are the design doc's "portals and automations per domain" made
 * into data. A connector is NOT a claim of integration: `recordKind` set
 * means the records module can fetch it when a vendor is configured;
 * everything else is a named authority with its public portal and the manual
 * route — which is still the fastest path when no vendor is connected,
 * because it says what the source settles and exactly how to ask it.
 *
 * Watchers are the staleness report, projected per department. Nothing new
 * is computed here: `buildStaleness` already knows what has aged and why,
 * and re-deriving expiry logic beside it would give the product two clocks
 * that disagree. What this module adds is the routing — which department's
 * workboard each alarm belongs on — so an expiring RERA registration rings
 * in Approvals and a stale EC search rings in Legal, instead of both living
 * on a page nobody has open.
 */

import type { PropertyCase, ReferenceData, StaleItem } from './types';
import { buildStaleness } from './staleness';
import { domainForRecordKind, domainsForDocumentKind } from './dd-domains';
import type { DdDomain } from './dd-domains';

/* ==================================================================== */
/* Connectors                                                            */
/* ==================================================================== */

export interface DdConnector {
  key: string;
  domain: DdDomain;
  /** The portal or counter, by the name people use for it. */
  label: string;
  /** Who stands behind the record. */
  authority: string;
  /** What this source settles that nothing else can. */
  settles: string;
  /** Public portal, when one exists. */
  url?: string;
  /** How to obtain the record by hand. */
  route: string;
  /**
   * The records module's kind for this source, when the fetch path covers
   * it — the workboard then offers Fetch through RecordFetchCard instead of
   * only naming the counter.
   */
  recordKind?: string;
}

/**
 * Karnataka / Bengaluru catalogue — the sources a DD engagement here
 * actually pulls from, per department. Every URL is the portal's public
 * front door, not a deep link that rots.
 */
export const DD_CONNECTORS: DdConnector[] = [
  /* -- Land & revenue --------------------------------------------------- */
  {
    key: 'bhoomi',
    domain: 'land',
    label: 'Bhoomi (RTC / pahani)',
    authority: 'Revenue Department, Government of Karnataka',
    settles: 'The record of rights for a survey number — who the revenue record says holds the land, its extent and its classification.',
    url: 'https://landrecords.karnataka.gov.in',
    route: 'RTC extract from the Bhoomi portal or the taluk office Atalji Janasnehi Kendra.',
    recordKind: 'record_of_rights',
  },
  {
    key: 'mutation_register',
    domain: 'land',
    label: 'Mutation register',
    authority: 'Revenue Department, Government of Karnataka',
    settles: 'Whether the revenue record was actually carried forward to the current holder after each transfer — a deed without its mutation is a transfer the record has not absorbed.',
    url: 'https://landrecords.karnataka.gov.in',
    route: 'Mutation extract (MR copy) from the taluk office for each transfer in the chain.',
    recordKind: 'mutation',
  },
  {
    key: 'ekhata',
    domain: 'land',
    label: 'e-Khata / e-Aasthi',
    authority: 'BBMP / Urban local body',
    settles: 'The municipal account for the property — khata class (A or B), the holder the municipality bills, and whether the account is digital.',
    url: 'https://bbmpeaasthi.karnataka.gov.in',
    route: 'e-Khata from the BBMP e-Aasthi portal, or the khata extract across the ARO counter.',
    recordKind: 'khata_extract',
  },
  {
    key: 'survey_settlement',
    domain: 'land',
    label: 'Survey & Settlement (Mojini)',
    authority: 'Survey, Settlement and Land Records, GoK',
    settles: 'The measured boundary — tippani, atlas, field measurement book — against which every deed schedule and fence line is checked.',
    url: 'https://landsurvey.karnataka.gov.in',
    route: 'Certified survey sketch (11E / tippani) via Mojini or the taluk survey office.',
    recordKind: 'survey_map',
  },
  {
    key: 'dishaank',
    domain: 'land',
    label: 'Dishaank',
    authority: 'Survey, Settlement and Land Records, GoK',
    settles: 'Where a survey number sits on the map — the cadastral outline a site visit can stand inside.',
    route: 'Dishaank mobile app; overlay the survey number and confirm the parcel on the ground.',
  },

  /* -- Legal & title ---------------------------------------------------- */
  {
    key: 'kaveri_ec',
    domain: 'legal',
    label: 'Kaveri (encumbrance search)',
    authority: 'Department of Stamps and Registration, GoK',
    settles: 'Every registered charge over the title in the searched window — mortgage, lien, lis pendens, attachment — and the periods with no entry.',
    url: 'https://kaverionline.karnataka.gov.in',
    route: 'Form 15/16 encumbrance certificate through Kaveri Online Services or the jurisdictional Sub-Registrar.',
    recordKind: 'encumbrance_certificate',
  },
  {
    key: 'kaveri_cc',
    domain: 'legal',
    label: 'Kaveri (certified copies)',
    authority: 'Department of Stamps and Registration, GoK',
    settles: 'What a registered instrument actually says — the certified copy from the register, not the copy the seller chose to hand over.',
    url: 'https://kaverionline.karnataka.gov.in',
    route: 'Certified copy of the registered deed by document number and year from Kaveri or the SRO.',
    recordKind: 'certified_instrument',
  },
  {
    key: 'cersai',
    domain: 'legal',
    label: 'CERSAI',
    authority: 'Central Registry of Securitisation Asset Reconstruction and Security Interest',
    settles: 'Security interests lenders registered centrally — the mortgage that never reached the local encumbrance certificate.',
    url: 'https://www.cersai.org.in',
    route: 'Asset-based search on the CERSAI portal (paid; any registered user can search).',
  },
  {
    key: 'ecourts',
    domain: 'legal',
    label: 'eCourts / K-HC cause lists',
    authority: 'District & High Court registries',
    settles: 'Whether the parties or the property are in litigation the file does not mention.',
    url: 'https://ecourts.gov.in',
    route: 'Party-name search on eCourts and the Karnataka High Court site for each party in the chain.',
  },

  /* -- Approvals & planning ---------------------------------------------- */
  {
    key: 'bbmp_plan',
    domain: 'approvals',
    label: 'BBMP / BDA plan sanction',
    authority: 'BBMP Town Planning / Bangalore Development Authority',
    settles: 'What was sanctioned to be built — the plan every as-built deviation is measured against.',
    url: 'https://site.bbmp.gov.in',
    route: 'Certified copy of the sanctioned plan and commencement certificate from the sanctioning authority\'s town-planning wing.',
  },
  {
    key: 'bda_rmp',
    domain: 'approvals',
    label: 'BDA / LPA master plan (land use)',
    authority: 'Bangalore Development Authority / local planning authority (BMRDA, BIAAPA as applicable)',
    settles: 'The land-use zone, proposed roads and public-purpose reservations on the plan in force for this survey number — not the building sanction, and not a corridor market note.',
    url: 'https://kbda.karnataka.gov.in',
    route: 'Identify the RMP (or BMRDA / BIAAPA) sheet covering the village and read the survey number off it, or obtain a zoning / land-use certificate from the planning authority. RMP 2015 remains in force until a successor is notified. Do not treat the withdrawn RMP-2031 draft, DPPlans, or GISMaps.in as the plan in force. Attach the extract on the land-use check.',
  },
  {
    key: 'bbmp_gis',
    domain: 'approvals',
    label: 'BBMP GIS viewer',
    authority: 'Bruhat Bengaluru Mahanagara Palike',
    settles: 'Civic geography inside BBMP/GBA limits — wards, zones, lakes and parks on BBMP’s own map. Not the RMP land-use hatch, and not coverage for BMRDA villages.',
    url: 'https://bbmp.gov.in/gisviewer/',
    route: 'Open the GIS viewer, search the address or drop the pin, and read the ward / lake layers. Screenshot or export is context, not a zoning certificate. Sites outside BBMP (Harohalli, Kanakapura) will not be on this map — use BMRDA maps and the LPA sheet.',
  },
  {
    key: 'bmrda_maps',
    domain: 'approvals',
    label: 'BMRDA maps',
    authority: 'Bangalore Metropolitan Region Development Authority',
    settles: 'Published maps for the metropolitan region and LPAs outside BBMP core — the right official map sitting for Harohalli / Kanakapura.',
    url: 'https://bmrda.karnataka.gov.in/10/maps/en',
    route: 'Open the BMRDA maps page, identify the LPA sheet covering this village, and attach that extract (or a zoning certificate from the LPA) on the land-use check. We do not scrape the page.',
  },
  {
    key: 'krera',
    domain: 'approvals',
    label: 'K-RERA registry',
    authority: 'Karnataka Real Estate Regulatory Authority',
    settles: 'Whether the project is registered, until when, and what the promoter has filed quarterly — including complaints and orders against it.',
    url: 'https://rera.karnataka.gov.in',
    route: 'Project search by registration number on the K-RERA portal; download the registration certificate and latest quarterly update.',
  },
  {
    key: 'aai_nocas',
    domain: 'approvals',
    label: 'AAI NOCAS (height clearance)',
    authority: 'Airports Authority of India',
    settles: 'The permissible top elevation at these coordinates — the ceiling the airport funnel imposes regardless of FAR.',
    url: 'https://nocas2.aai.aero',
    route: 'Coordinate check on NOCAS; a formal NOC application where construction approaches the permissible height.',
  },

  /* -- Compliance -------------------------------------------------------- */
  {
    key: 'kspcb',
    domain: 'compliance',
    label: 'KSPCB (CFE / CFO)',
    authority: 'Karnataka State Pollution Control Board',
    settles: 'Consent for Establishment and the CURRENT Consent for Operation — an occupied building whose CFO lapsed is operating outside consent today.',
    url: 'https://kspcb.karnataka.gov.in',
    route: 'Consent status by application number on the KSPCB portal (XGN); ask the owner for the live CFO with its validity date.',
  },
  {
    key: 'fire_noc',
    domain: 'compliance',
    label: 'Fire & Emergency Services NOC',
    authority: 'Karnataka State Fire and Emergency Services',
    settles: 'The fire clearance and its renewal — an NOC is issued against a building as approved, and it expires.',
    url: 'https://ksfes.karnataka.gov.in',
    route: 'Current fire NOC with validity from the owner; verify issue against the department\'s records.',
  },
  {
    key: 'ceig',
    domain: 'compliance',
    label: 'CEIG (electrical / lifts)',
    authority: 'Chief Electrical Inspectorate, GoK',
    settles: 'Statutory approval of the HT installation, DG sets and every lift — each lift licence renews annually.',
    url: 'https://ceig.karnataka.gov.in',
    route: 'Current CEIG approvals and lift licences from the owner\'s O&M records; verify numbers with the inspectorate.',
  },
  {
    key: 'bbmp_tax',
    domain: 'compliance',
    label: 'BBMP property tax',
    authority: 'Bruhat Bengaluru Mahanagara Palike',
    settles: 'Whether the current assessment year is paid — unpaid tax is a charge that follows the property to its new owner.',
    url: 'https://bbmptax.karnataka.gov.in',
    route: 'Paid receipts by SAS application number for every year up to the current one.',
    recordKind: 'property_tax',
  },

  /* -- Financial ---------------------------------------------------------- */
  {
    key: 'kaveri_gv',
    domain: 'financial',
    label: 'Kaveri guidance value',
    authority: 'Department of Stamps and Registration, GoK',
    settles: 'The government floor value for this locality and use — what duty is actually computed on, and the floor no lender ignores.',
    url: 'https://kaverionline.karnataka.gov.in',
    route: 'Guidance-value search by village/locality on Kaveri; note the notification date.',
  },

  /* -- Project / Ops ------------------------------------------------------ */
  {
    key: 'krera_updates',
    domain: 'project_ops',
    label: 'K-RERA quarterly updates',
    authority: 'Karnataka Real Estate Regulatory Authority',
    settles: 'The promoter\'s own sworn progress — sold inventory, funds drawn, completion dates moved — filed quarterly under the Act.',
    url: 'https://rera.karnataka.gov.in',
    route: 'The project page\'s quarterly-update tab on the K-RERA portal.',
  },
];

export function connectorsForDomain(domain: DdDomain): DdConnector[] {
  return DD_CONNECTORS.filter(c => c.domain === domain);
}

/* ==================================================================== */
/* Watchers                                                              */
/* ==================================================================== */

export interface DdWatcherAlert extends StaleItem {
  domain: DdDomain;
}

/**
 * Which department a staleness item rings in. Keyed on the item's own key
 * and kind — the stable identifiers `buildStaleness` mints — never on label
 * text, which is prose and free to change.
 */
function watcherDomain(item: StaleItem, caseData: PropertyCase): DdDomain {
  if (item.key.startsWith('register:')) return domainForRecordKind(item.key.slice('register:'.length));
  if (item.key.startsWith('ec_period:')) return 'legal';
  if (item.key.startsWith('rera:')) return 'approvals';
  if (item.key.startsWith('tax_year:')) return 'compliance';
  if (item.key.startsWith('document:')) {
    const doc = caseData.documents.find(d => item.key === `document:${d.id}`);
    const domains = doc ? domainsForDocumentKind(doc.kind) : [];
    return domains[0] ?? 'legal';
  }
  switch (item.kind) {
    case 'planning':
      return 'approvals';
    case 'reference_data':
      return 'financial';
    case 'site_context':
      return 'land';
    default:
      return 'risk'; // the screen's own age, and anything unclassified, rings on the risk board
  }
}

/**
 * The staleness report routed to departments. Same items, same clock, same
 * honesty rule — nothing here says a figure is wrong, only that it is
 * carried from a date — just delivered to the workboard whose reader can
 * act on it.
 */
export function ddWatcherAlerts(caseData: PropertyCase, refData: ReferenceData, now: string): DdWatcherAlert[] {
  return buildStaleness(caseData, refData, now).items.map(item => ({ ...item, domain: watcherDomain(item, caseData) }));
}
