/**
 * The official reference shelf — catalogue, not a corpus.
 *
 * Acts, circulars and gazettes that a Karnataka DD sitting may need to cite.
 * Standing is metadata: an open PDF may be fetched later; a paid code is named
 * with a buy link; a textbook is cite-only. Nothing here is this project's
 * evidence. Filing a circular as if it were the Fire NOC on Harohalli is the
 * failure mode this module exists to prevent.
 *
 * Do not scrape CAPTCHA/OTP portals. Do not ingest NBC or IVS full text.
 */

import type { ScopeKey } from './types';

export type ReferenceStanding = 'official_pdf' | 'official_html' | 'catalogue_only' | 'paid' | 'withdrawn';

export interface ReferenceWork {
  id: string;
  title: string;
  issuer: string;
  url: string;
  /**
   * Direct file to fetch when `url` is a landing page. Open official PDFs only.
   * Paid and gated hosts are never set here.
   */
  ingestUrl?: string;
  asOf: string;
  standing: ReferenceStanding;
  note: string;
  tags: string[];
  scopeKeys: ScopeKey[];
}

export interface ReferenceHit extends ReferenceWork {
  /** Always true. Copilot and UI must not file the hit as evidence. */
  notEvidence: true;
  passages?: Array<{ heading: string; text: string }>;
  ingested?: boolean;
}

const SHELF: ReferenceWork[] = [
  {
    id: 'ref_ibbi_rv_rules_2017',
    title: 'Companies (Registered Valuers and Valuation) Rules, 2017',
    issuer: 'IBBI',
    url: 'https://ibbi.gov.in/uploads/rules.pdf',
    asOf: '2017-10-18',
    standing: 'official_pdf',
    note: 'Rule 8 is the report-contents checklist. Structure only — not a certificate.',
    tags: ['ibbi', 'valuation', 'rule 8', 'registered valuer'],
    scopeKeys: ['indicative_valuation', 'financial_appraisal'],
  },
  {
    id: 'ref_ibbi_caveats_2020',
    title: 'Guidelines on Use of Caveats, Limitations and Disclaimers by Registered Valuers, 2020',
    issuer: 'IBBI',
    url: 'https://ibbi.gov.in/uploads/legalframwork/e5e1300db2dd6a8bebe289ba579a7c14.pdf',
    asOf: '2020-09-01',
    standing: 'official_pdf',
    note: 'How caveats may be written. Does not replace a signed valuation.',
    tags: ['ibbi', 'caveat', 'disclaimer', 'valuation'],
    scopeKeys: ['indicative_valuation'],
  },
  {
    id: 'ref_ibbi_lb_report_format',
    title: 'IBBI Land & Building valuation report format',
    issuer: 'IBBI',
    url: 'https://ibbi.gov.in/uploads/legalframwork/9d426e3d5c806a7a8f763103960345ea.pdf',
    asOf: '2018-01-01',
    standing: 'official_pdf',
    note: 'Instruction, subject, dates, basis/premise, legal/planning, methods, caveats.',
    tags: ['ibbi', 'land', 'building', 'report format', 'valuation'],
    scopeKeys: ['indicative_valuation', 'legal', 'regulatory'],
  },
  {
    id: 'ref_ibbi_ibc_valuation',
    title: 'IBBI guidelines on use of registered valuers under the IBC',
    issuer: 'IBBI',
    url: 'https://ibbi.gov.in/uploads/whatsnew/97388870e87e11d5df09b29b69bbbb38.pdf',
    asOf: '2018-01-01',
    standing: 'official_pdf',
    note: 'IBC valuation process. Not this file\'s evidence.',
    tags: ['ibbi', 'ibc', 'insolvency', 'valuation'],
    scopeKeys: ['indicative_valuation', 'financial_appraisal'],
  },
  {
    id: 'ref_ibbi_ivs_2026',
    title: 'IBBI circular adopting IVS for IBC valuations (IBBI/RV/93/2026)',
    issuer: 'IBBI',
    url: 'https://ibbi.gov.in/uploads/legalframwork/b176b05d02cba50ae0d3279ff6ed553e.pdf',
    asOf: '2026-04-01',
    standing: 'official_pdf',
    note: 'IVS adopted for IBC work from 1 Apr 2026. Full IVS text is paid — do not pirate.',
    tags: ['ibbi', 'ivs', 'international valuation standards', 'circular'],
    scopeKeys: ['indicative_valuation'],
  },
  {
    id: 'ref_ibbi_lb_syllabus_2026',
    title: 'IBBI Land & Building examination syllabus (from 21 Aug 2026)',
    issuer: 'IBBI',
    url: 'https://ibbi.gov.in/uploads/press/943997ca0a413c95309187fe9f948dc5.pdf',
    asOf: '2026-08-21',
    standing: 'official_pdf',
    note: 'Syllabus names the statutes a valuer is expected to know. Cite them; do not dump SCC.',
    tags: ['ibbi', 'syllabus', 'land', 'building', 'exam'],
    scopeKeys: ['indicative_valuation', 'legal', 'regulatory'],
  },
  {
    id: 'ref_registration_act',
    title: 'Registration Act, 1908',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/2190',
    asOf: '1908-01-01',
    standing: 'official_html',
    note: 'When an instrument must be registered. Not a substitute for the deed on file.',
    tags: ['registration', 'deed', 'sub-registrar', 'title'],
    scopeKeys: ['legal'],
  },
  {
    id: 'ref_tpa',
    title: 'Transfer of Property Act, 1882',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/2338',
    asOf: '1882-01-01',
    standing: 'official_html',
    note: 'Conveyance, mortgage, lease. Cite the section; the deed on this file is the evidence.',
    tags: ['tpa', 'transfer', 'conveyance', 'mortgage', 'title'],
    scopeKeys: ['legal'],
  },
  {
    id: 'ref_rera',
    title: 'Real Estate (Regulation and Development) Act, 2016',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/2158',
    asOf: '2016-03-26',
    standing: 'official_html',
    note: 'RERA registration and promoter duties. K-RERA portal is a named route, not a scrape target.',
    tags: ['rera', 'k-rera', 'promoter', 'project registration'],
    scopeKeys: ['regulatory', 'commercial_market'],
  },
  {
    id: 'ref_ibc',
    title: 'Insolvency and Bankruptcy Code, 2016',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/2154',
    asOf: '2016-05-28',
    standing: 'official_html',
    note: 'IBC process. Valuation under IBC still needs an IBBI-registered valuer\'s own report.',
    tags: ['ibc', 'insolvency', 'bankruptcy', 'nclt'],
    scopeKeys: ['financial_appraisal', 'indicative_valuation', 'legal'],
  },
  {
    id: 'ref_ptcl',
    title: 'Karnataka Scheduled Castes and Scheduled Tribes (Prohibition of Transfer of Certain Lands) Act, 1978',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/bitstream/123456789/7812/1/2_of_1979_%28e%29.pdf',
    asOf: '1979-01-01',
    standing: 'official_pdf',
    note: 'PTCL / PTCL-in-substance restrictions on certain lands. A title opinion still needs the revenue record on this file.',
    tags: ['ptcl', 'sc', 'st', 'granted land', 'karnataka', 'title'],
    scopeKeys: ['legal', 'land_site'],
  },
  {
    id: 'ref_land_acquisition_2013',
    title: 'Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/2121',
    ingestUrl: 'https://www.indiacode.nic.in/bitstream/123456789/2121/1/A2013-30.pdf',
    asOf: '2013-09-26',
    standing: 'official_html',
    note: 'Acquisition process and compensation. Not this file\'s award.',
    tags: ['land acquisition', 'larr', 'compensation', 'rehabilitation'],
    scopeKeys: ['legal', 'land_site'],
  },
  {
    id: 'ref_easements',
    title: 'Indian Easements Act, 1882',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/2349',
    asOf: '1882-01-01',
    standing: 'official_html',
    note: 'Rights of way, light, drainage. The survey on this file is the evidence of the path.',
    tags: ['easement', 'right of way', 'access'],
    scopeKeys: ['legal', 'land_site'],
  },
  {
    id: 'ref_hindu_succession',
    title: 'Hindu Succession Act, 1956',
    issuer: 'India Code',
    url: 'https://www.indiacode.nic.in/handle/123456789/1713',
    asOf: '1956-06-17',
    standing: 'official_html',
    note: 'Intestate succession. A family partition on this file still has to be the registered instrument.',
    tags: ['succession', 'partition', 'hindu', 'heir'],
    scopeKeys: ['legal'],
  },
  {
    id: 'ref_ktcp_1961',
    title: 'Karnataka Town and Country Planning Act, 1961',
    issuer: 'Government of Karnataka / DPAL',
    url: 'https://dpal.karnataka.gov.in',
    ingestUrl: 'https://dpal.karnataka.gov.in/storage/pdf-files/11%20of%201963%20(E).pdf',
    asOf: '1963-01-01',
    standing: 'official_pdf',
    note: 'The Act under which a master plan is prepared and land use is assigned. Cite the section; the sheet or zoning certificate on this file is the evidence for this parcel.',
    tags: ['ktcp', 'master plan', 'town planning', 'zoning', 'rmp', 'land use'],
    scopeKeys: ['regulatory', 'land_site', 'legal'],
  },
  {
    id: 'ref_rmp_2015',
    title: 'Revised Master Plan 2015 for Bengaluru (as extended)',
    issuer: 'Bangalore Development Authority',
    url: 'https://kbda.karnataka.gov.in',
    asOf: '2015-01-01',
    standing: 'official_html',
    note: 'Plan in force until a successor is notified. Published as map sheets and zoning regulations — not a per-parcel API. Do not ingest unofficial GIS. RMP-2031 draft was withdrawn. GBA/BDA 2041–47 plans are being drafted. File the sheet or zoning certificate on this check; do not treat this catalogue row as Harohalli\'s extract.',
    tags: ['rmp', 'master plan', 'bda', 'land use', 'zoning', 'bengaluru', 'town plan'],
    scopeKeys: ['regulatory', 'land_site'],
  },
  {
    id: 'ref_bbmp_gis',
    title: 'BBMP GIS viewer',
    issuer: 'Bruhat Bengaluru Mahanagara Palike',
    url: 'https://bbmp.gov.in/gisviewer/',
    asOf: '2026-01-01',
    standing: 'official_html',
    note: 'Civic GIS inside BBMP/GBA (wards, zones, lakes, parks). Not the RMP land-use hatch. Not coverage for Harohalli / Kanakapura. Do not scrape; open the viewer on the sitting.',
    tags: ['bbmp', 'gis', 'ward', 'lake', 'bengaluru', 'viewer'],
    scopeKeys: ['regulatory', 'land_site'],
  },
  {
    id: 'ref_bmrda_maps',
    title: 'BMRDA maps',
    issuer: 'Bangalore Metropolitan Region Development Authority',
    url: 'https://bmrda.karnataka.gov.in/10/maps/en',
    asOf: '2026-01-01',
    standing: 'official_html',
    note: 'Official maps page for BMRDA / LPA areas outside BBMP core. The right counter for Harohalli. File the sheet covering this village; do not treat this catalogue row as the extract.',
    tags: ['bmrda', 'lpa', 'kanakapura', 'harohalli', 'master plan', 'maps'],
    scopeKeys: ['regulatory', 'land_site'],
  },
  {
    id: 'ref_rmp_2031_withdrawn',
    title: 'BDA Revised Master Plan 2031 (draft, withdrawn)',
    issuer: 'OpenCity archive of BDA draft',
    url: 'https://data.opencity.in/dataset/bda-revised-master-plan-2031',
    asOf: '2017-12-01',
    standing: 'withdrawn',
    note: 'Civic archive of the 2017 draft. BDA withdrew RMP-2031 in 2020. RMP 2015 remains in force. Never overlay or file these PDFs as the plan in force.',
    tags: ['rmp', 'rmp-2031', 'withdrawn', 'opencity', 'bda', 'draft'],
    scopeKeys: ['regulatory', 'land_site'],
  },
  {
    id: 'ref_dpplans_bengaluru',
    title: 'DPPlans Bengaluru development-plan overlay',
    issuer: 'DPPlans (commercial)',
    url: 'https://dpplans.com/bengaluru-dp-plan/',
    asOf: '2026-01-01',
    standing: 'catalogue_only',
    note: 'Paid third-party viewer. They state the download is not the planning authority’s sanctioned document, and high zoom is paywalled. Do not scrape, overlay or file as the master-plan extract.',
    tags: ['dpplans', 'commercial', 'rmp', 'unofficial'],
    scopeKeys: ['regulatory', 'land_site'],
  },
  {
    id: 'ref_gismaps_bbmp_ward',
    title: 'GISMaps.in BBMP ward map',
    issuer: 'GISMaps.in (third party)',
    url: 'https://www.gismaps.in/Karnataka%20Ward%20Maps/BBMP_WardMap_Karnataka.html',
    asOf: '2026-01-01',
    standing: 'catalogue_only',
    note: 'Unofficial ward cartography. Use BBMP GIS viewer for civic wards. Do not treat this as the layer of record.',
    tags: ['gismaps', 'ward', 'bbmp', 'unofficial'],
    scopeKeys: ['regulatory', 'land_site'],
  },
  {
    id: 'ref_dpal_karnataka',
    title: 'Karnataka Department of Parliamentary Affairs and Legislation — acts',
    issuer: 'Government of Karnataka',
    url: 'https://dpal.karnataka.gov.in',
    asOf: '2026-01-01',
    standing: 'official_html',
    note: 'KLR, KTCP and other state acts. Prefer this over unofficial PRS copies.',
    tags: ['karnataka', 'klr', 'ktcp', 'land reforms', 'town planning', 'conversion'],
    scopeKeys: ['legal', 'regulatory', 'land_site'],
  },
  {
    id: 'ref_nbc_bis',
    title: 'National Building Code of India 2016',
    issuer: 'Bureau of Indian Standards',
    url: 'https://www.bis.gov.in/standards/national-building-code/',
    asOf: '2016-01-01',
    standing: 'paid',
    note: 'NBC is a paid BIS publication. Catalogue it; do not ingest or pirate the full text. Fire and structural checks still need the drawings and NOCs on this file.',
    tags: ['nbc', 'bis', 'fire', 'structural', 'building code'],
    scopeKeys: ['technical', 'hse', 'regulatory'],
  },
  {
    id: 'ref_ivs_ivsc',
    title: 'International Valuation Standards (IVS)',
    issuer: 'IVSC',
    url: 'https://www.ivsc.org/standards/',
    asOf: '2025-01-01',
    standing: 'paid',
    note: 'Full IVS text is licensed. IBBI adopted IVS for IBC work; this product does not ship the book.',
    tags: ['ivs', 'ivsc', 'valuation standards'],
    scopeKeys: ['indicative_valuation'],
  },

  /* ------------------------------------------------------------------ */
  /* Process and classification standards                                */
  /*                                                                     */
  /* Everything above is Indian statute or valuation doctrine — what the  */
  /* law requires and what a value means. Nothing above says how a        */
  /* diligence is SCOPED, how its findings are graded, how a document is  */
  /* named, or what an area actually measures. Those are settled          */
  /* questions with published answers, and a product that invents its own */
  /* vocabulary for them is asking every client to learn a dialect.       */
  /* ------------------------------------------------------------------ */
  {
    id: 'ref_rics_tdd',
    title: 'Technical due diligence of commercial property (RICS professional standard)',
    issuer: 'RICS',
    url: 'https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/real-estate-standards/technical-due-diligence-of-commercial-property',
    asOf: '2023-04-01',
    standing: 'official_html',
    note: 'Reissued April 2023 as a professional standard (first published January 2020 as a guidance note). Names four TDD purposes — acquisition, occupation, disposal, refurbishment — and carries a standard scope of service as tickable items. Its traffic-light rating (1 green / 2 amber / 3 red) is the convention a reader of a TDD report expects, with a separate escalation for defects needing immediate action.',
    tags: ['rics', 'due diligence', 'tdd', 'scope of service', 'traffic light', 'condition rating'],
    scopeKeys: ['technical', 'condition_operations', 'regulatory', 'hse'],
  },
  {
    id: 'ref_rics_tdd_scope',
    title: 'Technical Due Diligence Services — Scope of Services (England and Wales)',
    issuer: 'RICS',
    url: 'https://www.rics.org/content/dam/ricsglobal/documents/standards/building-surveying-standards/standard-forms-of-consultation/5-technical-due-diligence-services_ew_may-2022.pdf',
    asOf: '2022-05-01',
    standing: 'official_pdf',
    note: 'The scope document itself, as numbered tickable items: statutory compliance, building services, environmental and site factors, environmental (phase 1) audit, sustainability, documentation review during and post inspection, maintenance and cost reporting. The closest published thing to a check catalogue for technical DD.',
    tags: ['rics', 'scope of services', 'checklist', 'tdd'],
    scopeKeys: ['technical', 'regulatory', 'esg', 'condition_operations'],
  },
  {
    id: 'ref_ipms',
    title: 'International Property Measurement Standards: All Buildings',
    issuer: 'IPMS Coalition',
    url: 'https://ipmsc.org/',
    asOf: '2023-01-01',
    standing: 'official_pdf',
    note: 'What an area measurement actually includes, as component tables. Matters here because only “carpet area” has a statutory definition in India (RERA s.2(k)); “super built-up” has none, which is why RERA stopped sales being quoted on it. A valuation that states a basis without saying which standard defines it has not stated a basis.',
    tags: ['ipms', 'area', 'measurement', 'carpet area', 'built-up'],
    scopeKeys: ['indicative_valuation', 'technical', 'commercial_market'],
  },
  {
    id: 'ref_icms',
    title: 'International Cost Management Standard (ICMS 3)',
    issuer: 'ICMS Coalition / RICS',
    url: 'https://icms-coalition.org/',
    asOf: '2021-11-01',
    standing: 'official_pdf',
    note: 'How construction cost is classified and reported so two projects can be compared. Mapped to NRM, Uniclass, OmniClass and BESMM, and it now carries carbon alongside cost. Use it to say what a budget line IS, not to measure it — ICMS is a reporting framework, not a method of measurement.',
    tags: ['icms', 'cost', 'benchmarking', 'carbon', 'nrm'],
    scopeKeys: ['cost_quantity', 'financial_appraisal', 'procurement'],
  },
  {
    id: 'ref_iso_19650',
    title: 'BS EN ISO 19650 — information management, and its UK National Annex naming convention',
    issuer: 'ISO / BSI',
    url: 'https://www.iso.org/standard/68078.html',
    asOf: '2018-12-01',
    standing: 'paid',
    note: 'The published answer to how a document is named: project–originator–volume–level–type–role–number. Role codes are a subset of the Uniclass 2015 Roles table. An evidence pack that lands in a client CDE with ad-hoc filenames has to be renamed by hand at the other end.',
    tags: ['iso 19650', 'naming convention', 'cde', 'document control', 'information management'],
    scopeKeys: ['technical', 'quality', 'procurement'],
  },
  {
    id: 'ref_uniclass',
    title: 'Uniclass 2015 classification tables',
    issuer: 'NBS',
    url: 'https://uniclass.thenbs.com/',
    asOf: '2015-01-01',
    standing: 'official_html',
    note: 'Free, maintained, and structured to ISO 12006-2 — Entities, Spaces/locations, Elements, Systems, Products, Roles. OmniClass is the North American equivalent and the two correlate through the same ISO framework. The answer to “what is this asset, in a word another system will recognise”.',
    tags: ['uniclass', 'classification', 'omniclass', 'iso 12006-2', 'asset type'],
    scopeKeys: ['technical', 'condition_operations', 'cost_quantity'],
  },
  {
    id: 'ref_astm_e1527',
    title: 'ASTM E1527-21 — Phase I Environmental Site Assessment',
    issuer: 'ASTM International',
    url: 'https://www.astm.org/e1527-21.html',
    asOf: '2021-11-01',
    standing: 'paid',
    note: 'The environmental finding taxonomy with legal weight: REC, HREC (cleaned up, no use restrictions) and CREC (cleaned up subject to controls). US-anchored — it establishes CERCLA liability protection, which India has no analogue for — but the three-way classification is the vocabulary a lender or an international buyer will expect a contamination finding in.',
    tags: ['astm', 'phase i', 'environmental', 'rec', 'contamination'],
    scopeKeys: ['esg', 'land_site'],
  },
  {
    id: 'ref_ivs_ipms_note',
    title: 'RICS Valuation — Global Standards (Red Book Global)',
    issuer: 'RICS',
    url: 'https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/valuation-standards/red-book',
    asOf: '2025-01-31',
    standing: 'paid',
    note: 'Incorporates IVS and adds mandatory RICS practice on terms of engagement, inspection, and reporting. Where IVS says what a value means, the Red Book says what a valuer must do and record before stating one — which is the half a DD file has to evidence.',
    tags: ['rics', 'red book', 'valuation', 'terms of engagement'],
    scopeKeys: ['indicative_valuation'],
  },
];

export const REFERENCE_SHELF: readonly ReferenceWork[] = SHELF;

/** Open official PDFs the API may fetch into the shelf cache. Never paid. Never gated portals. */
export function fetchableReferenceWorks(): ReferenceWork[] {
  return SHELF.filter((w) => w.standing !== 'paid' && (w.standing === 'official_pdf' || Boolean(w.ingestUrl)));
}

export function referenceFetchUrl(work: ReferenceWork): string {
  return work.ingestUrl || work.url;
}

const STANDING_LINE =
  'REFERENCE — not this project\'s evidence. Cite title + asOf. Do not file the URL as a document on the register.';

function scoreWork(work: ReferenceWork, needle: string, scopeKey?: ScopeKey, checkTitle?: string): number {
  if (!needle && !scopeKey && !checkTitle) return 0;
  let score = 0;
  const title = work.title.toLowerCase();
  const tags = work.tags.join(' ').toLowerCase();
  const issuer = work.issuer.toLowerCase();
  if (needle) {
    if (title.includes(needle)) score += 8;
    if (tags.includes(needle)) score += 5;
    if (issuer.includes(needle)) score += 3;
    if (work.id.toLowerCase() === needle) score += 12;
    for (const part of needle.split(/\s+/).filter((p) => p.length > 2)) {
      if (title.includes(part) || tags.includes(part)) score += 1;
    }
  }
  if (scopeKey && work.scopeKeys.includes(scopeKey)) score += 4;
  if (checkTitle) {
    const check = checkTitle.toLowerCase();
    if (tags.split(' ').some((tag) => tag.length > 3 && check.includes(tag))) score += 3;
  }
  return score;
}

export function lookupReferences(
  query: string,
  extra?: { scopeKey?: ScopeKey; checkTitle?: string },
  limit = 6,
): ReferenceHit[] {
  const needle = query.trim().toLowerCase();
  const ranked = SHELF
    .map((work) => ({ work, score: scoreWork(work, needle, extra?.scopeKey, extra?.checkTitle) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.work.id.localeCompare(b.work.id))
    .slice(0, limit);
  return ranked.map((row) => ({ ...row.work, notEvidence: true as const }));
}

export function serializeReferenceHits(hits: ReferenceHit[]): string {
  if (hits.length === 0) {
    return `${STANDING_LINE}\nNo catalogue match. Do not invent a statute or scrape a gated portal.`;
  }
  const lines = [STANDING_LINE];
  for (const hit of hits) {
    lines.push(
      `[${hit.id}] ${hit.title} (${hit.issuer}, asOf ${hit.asOf}, ${hit.standing}${hit.ingested ? ', ingested' : ''}) ${hit.url} — ${hit.note}`,
    );
    for (const passage of hit.passages ?? []) {
      lines.push(`  cite ${passage.heading}: “${passage.text.slice(0, 420)}${passage.text.length > 420 ? '…' : ''}”`);
    }
  }
  return lines.join('\n');
}
