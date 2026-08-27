/**
 * The eight due-diligence domains, and how everything the case already
 * stores maps onto them.
 *
 * A domain is a facet, not a store: checks, risks, findings, documents and
 * portal records keep living where they live, and these maps say which
 * department reads each one. That is what lets the domain workboards be one
 * component driven by data, and what gives the evidence graph its `domain`
 * attribute, without a single row being moved or duplicated.
 *
 * Every map here is closed and explicit — the same rule as every other
 * catalog in this codebase. A key the maps do not know falls back to the
 * stated default rather than being guessed at by pattern-matching: a check
 * filed under the wrong department is findable, a check filed under a
 * regex's opinion is not.
 */

import type { DocumentKind, RiskCategory, TechnicalSystem } from './types';

export type DdDomain = 'land' | 'legal' | 'approvals' | 'compliance' | 'technical' | 'financial' | 'project_ops' | 'risk';

export const DD_DOMAIN_KEYS: DdDomain[] = ['land', 'legal', 'approvals', 'compliance', 'technical', 'financial', 'project_ops', 'risk'];

export interface DdDomainProfile {
  key: DdDomain;
  label: string;
  /** The question this department answers — the workboard's own headline. */
  question: string;
}

export const DD_DOMAIN_PROFILES: Record<DdDomain, DdDomainProfile> = {
  land: { key: 'land', label: 'Land', question: 'Is the land itself what the papers say it is?' },
  legal: { key: 'legal', label: 'Legal', question: 'Can this owner actually transfer it, unencumbered?' },
  approvals: { key: 'approvals', label: 'Approvals', question: 'Was what stands here permitted, and is the permission complete?' },
  compliance: { key: 'compliance', label: 'Compliance', question: 'Do the statutory clearances hold today, not just at sanction?' },
  technical: { key: 'technical', label: 'Technical', question: 'Does the building actually work, system by system?' },
  financial: { key: 'financial', label: 'Financial', question: 'What does what is wrong here cost, and who pays it?' },
  project_ops: { key: 'project_ops', label: 'Project / Ops', question: 'Is the operation ready for handover, tenants and FM?' },
  risk: { key: 'risk', label: 'Risk', question: 'What blocks the transaction, and what merely conditions it?' },
};

/**
 * Which department reads each state-pack check. Keys are the pack's own
 * check keys; a key from a future pack that no map entry names lands in
 * `compliance`, the departmental home of "a statutory rule was tested".
 */
const CHECK_DOMAIN: Record<string, DdDomain> = {
  khata_classification: 'land',
  e_khata_issuance: 'land',
  dc_conversion: 'land',
  ptcl_restriction: 'land',
  bda_bmrda_acquisition: 'land',
  gram_panchayat_form_limits: 'land',
  encumbrance_continuity: 'legal',
  layout_approval_status: 'approvals',
  occupancy_certificate_compliance: 'approvals',
  krera_registration: 'approvals',
};

export function domainForCheck(checkKey: string): DdDomain {
  return CHECK_DOMAIN[checkKey] ?? 'compliance';
}

const RISK_CATEGORY_DOMAIN: Record<RiskCategory, DdDomain> = {
  title: 'legal',
  planning: 'approvals',
  structural: 'technical',
  financial: 'financial',
  market: 'financial',
  tenancy: 'project_ops',
  environmental: 'compliance',
  data: 'risk',
};

export function domainForRiskCategory(category: RiskCategory): DdDomain {
  return RISK_CATEGORY_DOMAIN[category];
}

const SYSTEM_DOMAIN: Partial<Record<TechnicalSystem, DdDomain>> = {
  statutory: 'compliance',
  project_ops: 'project_ops',
};

export function domainForSystem(system: TechnicalSystem): DdDomain {
  return SYSTEM_DOMAIN[system] ?? 'technical';
}

/**
 * One document routinely feeds several departments — the coverage map from
 * the evidence-graph board (the TCS required-documents list alone feeds
 * Approvals, Technical, Compliance and Financial). Hence a list, not a
 * single home.
 */
const DOCUMENT_DOMAINS: Record<DocumentKind, DdDomain[]> = {
  title_deed: ['land', 'legal'],
  mother_deed: ['land', 'legal'],
  sale_agreement: ['legal'],
  joint_development_agreement: ['legal'],
  lease_agreement: ['legal', 'project_ops'],
  encumbrance_certificate: ['legal'],
  khata_extract: ['land'],
  conversion_certificate: ['land'],
  form_9_11: ['land'],
  possession_certificate: ['land'],
  kadaster_extract: ['land', 'legal'],
  approved_building_plan: ['approvals', 'technical'],
  sanctioned_plan_bbmp: ['approvals', 'technical'],
  commencement_certificate: ['approvals'],
  occupancy_certificate: ['approvals', 'compliance'],
  rera_registration: ['approvals'],
  betterment_charges_receipt: ['approvals', 'financial'],
  property_tax_receipt: ['compliance', 'financial'],
  energy_label: ['compliance'],
  woz_assessment: ['compliance', 'financial'],
  valuation_report: ['financial'],
  floor_plan: ['technical'],
  photograph: ['technical', 'project_ops'],
  other: [],
  unclassified: [],
};

export function domainsForDocumentKind(kind: DocumentKind): DdDomain[] {
  return DOCUMENT_DOMAINS[kind] ?? [];
}

/**
 * Which department each fetchable statutory record serves. Keys are the
 * records module's own `RecordKind` strings; kept as strings here because
 * shared must not depend on the agents package.
 */
const RECORD_KIND_DOMAIN: Record<string, DdDomain> = {
  encumbrance_certificate: 'legal',
  certified_instrument: 'legal',
  record_of_rights: 'land',
  mutation: 'land',
  khata_extract: 'land',
  property_tax: 'compliance',
  survey_map: 'land',
};

export function domainForRecordKind(recordKind: string): DdDomain {
  return RECORD_KIND_DOMAIN[recordKind] ?? 'compliance';
}
