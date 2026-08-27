/**
 * Technical / construction due diligence — pure data and pure functions.
 *
 * Two catalogs, both closed sets rather than free text, for the same reason
 * every other catalog in this codebase is closed: a client that could invent
 * its own system name or document label would drift from what the report
 * renders and what a reviewer can act on. Neither catalog reaches anything —
 * this module has no I/O and no case-specific state.
 */

import type { RiskStatus, TechnicalDdPhase, TechnicalDocumentItem, TechnicalFinding, TechnicalSystem } from './types';

export const TECHNICAL_SYSTEMS: TechnicalSystem[] = [
  'architectural',
  'structural',
  'mep_hvac',
  'mep_phe',
  'mep_fire',
  'mep_electrical',
  'mep_ibms',
  'statutory',
  'ehs',
];

export const TECHNICAL_SYSTEM_LABEL: Record<TechnicalSystem, string> = {
  architectural: 'Architectural',
  structural: 'Structural',
  mep_hvac: 'MEP — HVAC',
  mep_phe: 'MEP — Plumbing & PHE',
  mep_fire: 'MEP — Fire protection',
  mep_electrical: 'MEP — Electrical (HT/LT)',
  mep_ibms: 'MEP — IBMS / BMS',
  statutory: 'Statutory',
  ehs: 'EHS',
};

/**
 * The required-documents checklist, transcribed from a real technical-DD
 * document request: Phase I (a built building) and Phase II (a proposed
 * add-on) ask for different things, because one is being verified and the
 * other is being planned.
 */
export const TECHNICAL_DOCUMENT_CHECKLIST: TechnicalDocumentItem[] = [
  // --- Phase I — built building ------------------------------------------
  { id: 'built-arch-master-plan', system: 'architectural', phase: 'built', label: 'Approved final master plan layout & built contour layout' },
  { id: 'built-arch-as-built-drawings', system: 'architectural', phase: 'built', label: 'Architectural & interior as-built plans, elevations & sections (CAD)' },
  { id: 'built-arch-specs-boq', system: 'architectural', phase: 'built', label: 'Technical specifications, BoQ (unpriced), list of makes for interior items' },
  { id: 'built-arch-dbr', system: 'architectural', phase: 'built', label: 'Design basis reports for interior and facade, with FSI calculations' },
  { id: 'built-arch-facade-maintenance', system: 'architectural', phase: 'built', label: 'Maintenance contract details for facade elements, if any' },
  { id: 'built-arch-google-map', system: 'architectural', phase: 'built', label: 'Google Map of the facility, if available' },

  { id: 'built-structural-soil-report', system: 'structural', phase: 'built', label: 'Soil investigation report' },
  { id: 'built-structural-dbr', system: 'structural', phase: 'built', label: 'Structural design basis report' },
  { id: 'built-structural-drawings', system: 'structural', phase: 'built', label: 'Structural drawings — member sizes, plans & sectional elevations' },
  { id: 'built-structural-calculations', system: 'structural', phase: 'built', label: 'Structural design calculations (STAAD/ETABS models, if available)' },
  { id: 'built-structural-concrete-grade', system: 'structural', phase: 'built', label: 'Concrete grade of major structural members' },
  { id: 'built-structural-foundation', system: 'structural', phase: 'built', label: 'Foundation details' },
  { id: 'built-structural-age-alterations', system: 'structural', phase: 'built', label: 'Age of each structure and details of additions/alterations' },
  { id: 'built-structural-repairs', system: 'structural', phase: 'built', label: 'Major repair or strengthening measures undertaken, incl. waterproofing' },
  { id: 'built-structural-collapse', system: 'structural', phase: 'built', label: 'Details of any structural collapse, if any' },
  { id: 'built-structural-tests', system: 'structural', phase: 'built', label: 'Details of structural tests conducted since commissioning' },

  { id: 'built-mep-drawings', system: 'mep_hvac', phase: 'built', label: 'All MEP services plans, elevations & sections (CAD)' },
  { id: 'built-mep-specs-boq', system: 'mep_hvac', phase: 'built', label: 'MEP technical specifications, BOQ (unpriced), equipment makes' },
  { id: 'built-mep-dbr', system: 'mep_hvac', phase: 'built', label: 'All MEP services design basis reports' },
  { id: 'built-mep-calculations', system: 'mep_hvac', phase: 'built', label: 'Design calculations for MEP services' },
  { id: 'built-mep-warranties', system: 'mep_hvac', phase: 'built', label: 'Equipment warranties & guarantees' },
  { id: 'built-mep-as-built', system: 'mep_hvac', phase: 'built', label: 'MEP as-built drawings' },
  { id: 'built-mep-maintenance', system: 'mep_hvac', phase: 'built', label: 'MEP maintenance contract documents' },

  { id: 'built-statutory-approvals', system: 'statutory', phase: 'built', label: 'Statutory approval documents — during, post-construction, and renewals' },

  { id: 'built-ehs-leed', system: 'ehs', phase: 'built', label: 'LEED / green-building documentation, if any' },

  // --- Phase II — proposed building ---------------------------------------
  { id: 'proposed-arch-master-plan', system: 'architectural', phase: 'proposed', label: 'Master plan amalgamating the whole campus for the add-on building' },
  { id: 'proposed-arch-dbr', system: 'architectural', phase: 'proposed', label: 'Design basis report with area calculations amalgamating the existing built stock' },
  { id: 'proposed-arch-statutory-status', system: 'architectural', phase: 'proposed', label: 'Status of application to the statutory authorities' },
  { id: 'proposed-arch-budget', system: 'architectural', phase: 'proposed', label: 'Broad-level budgets, if any' },
];

export function technicalDocumentChecklist(phase: TechnicalDdPhase): TechnicalDocumentItem[] {
  return TECHNICAL_DOCUMENT_CHECKLIST.filter(item => item.phase === phase);
}

export function technicalDocumentItem(id: string): TechnicalDocumentItem | undefined {
  return TECHNICAL_DOCUMENT_CHECKLIST.find(item => item.id === id);
}

/**
 * The checklist against what has actually been marked supplied for one case
 * — the same "gap, not a failure" framing the rest of the completeness
 * surface uses. `provided` is the case's own `technicalDocumentsProvided`
 * map; a missing key reads as not yet provided.
 */
export function technicalDocumentGaps(phase: TechnicalDdPhase, provided: Record<string, boolean> | undefined): TechnicalDocumentItem[] {
  return technicalDocumentChecklist(phase).filter(item => !provided?.[item.id]);
}

/** Findings grouped by system, in the catalog's own order — never alphabetical, so the grouping reads the way a DD team is actually staffed. */
export function groupFindingsBySystem(findings: TechnicalFinding[]): { system: TechnicalSystem; findings: TechnicalFinding[] }[] {
  return TECHNICAL_SYSTEMS.map(system => ({ system, findings: findings.filter(f => f.system === system) })).filter(g => g.findings.length > 0);
}

/** Findings actually counting toward the case — proposed-but-unreviewed findings are a queue, not yet a fact about the building. */
export function acceptedTechnicalFindings(findings: TechnicalFinding[]): TechnicalFinding[] {
  return findings.filter(f => f.reviewState === 'accepted');
}

export function proposedTechnicalFindings(findings: TechnicalFinding[]): TechnicalFinding[] {
  return findings.filter(f => f.reviewState === 'proposed');
}

/** Open, accepted findings by severity — the number a headline actually wants: not proposals, not resolved items. */
export function openTechnicalFindingCounts(findings: TechnicalFinding[]): Record<RiskStatus, number> & { openCritical: number; openSerious: number } {
  const accepted = acceptedTechnicalFindings(findings);
  const open = accepted.filter(f => f.status === 'open');
  return {
    open: open.length,
    mitigated: accepted.filter(f => f.status === 'mitigated').length,
    accepted: accepted.filter(f => f.status === 'accepted').length,
    openCritical: open.filter(f => f.severity === 'critical').length,
    openSerious: open.filter(f => f.severity === 'serious').length,
  };
}
