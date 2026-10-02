/**
 * The document vault: one place every document lives, each owned by the
 * workstream it belongs to.
 *
 * A document is filed once. Which department it belongs to is read from what
 * it is — a sale deed is Legal's title work, a fire NOC is Legal's approvals,
 * a site photograph is Construction's site record — unless a person said
 * otherwise. Other departments still reach it through the links.
 */

import type { DdProject, EvidenceRecord } from './types';
import { workstreamOfCheck, workstreamDefinition, type DepartmentKey } from './departments';
import { allChecks } from './engagements';

/** What each kind of document the reader recognises belongs to. */
export const DOCUMENT_WORKSTREAM: Readonly<Record<string, string>> = {
  'Sale deed': 'legal.title',
  'Mother deed': 'legal.title',
  'Encumbrance certificate': 'legal.title',
  'Khata certificate and extract': 'legal.title',
  'Property tax receipt': 'legal.title',
  'Survey sketch': 'legal.title',
  'RTC (record of rights)': 'legal.title',
  'Joint development agreement': 'legal.title',
  'Agreement to sell': 'legal.title',
  'Lease deed': 'legal.title',
  'Certificate of incorporation': 'legal.title',
  'Legal opinion on title': 'legal.title',
  'Zoning certificate': 'legal.approvals',
  'DC conversion order': 'legal.approvals',
  'Sanctioned building plan': 'legal.approvals',
  'Occupancy certificate': 'legal.approvals',
  'Commencement certificate': 'legal.approvals',
  'RERA registration certificate': 'legal.approvals',
  'Environmental clearance': 'legal.approvals',
  'Utility NOC': 'legal.approvals',
  'Aviation height NOC': 'legal.approvals',
  'Fire NOC': 'legal.approvals',
  'Valuation report': 'finance.valuation',
  'Progress certificate': 'construction.progress',
  'TDS certificate': 'finance.tax',
};

/** The workstream a document belongs to, or undefined while nothing says. */
export function documentWorkstream(project: DdProject, evidence: EvidenceRecord): string | undefined {
  if (evidence.workstream && workstreamDefinition(evidence.workstream)) return evidence.workstream;
  if (evidence.documentType && DOCUMENT_WORKSTREAM[evidence.documentType]) return DOCUMENT_WORKSTREAM[evidence.documentType];
  const certified = (project.certifiedReports ?? []).find((r) => r.evidenceId === evidence.id);
  if (certified) return certified.workstream;
  if (evidence.kind === 'photograph') return 'construction.site';
  if (evidence.kind === 'market_comparable') return 'finance.valuation';
  const check = allChecks(project).find((c) => c.evidenceIds.includes(evidence.id));
  if (check) return workstreamOfCheck(check.definitionId);
  if (evidence.kind === 'approval') return 'legal.approvals';
  return undefined;
}

export function documentDepartment(project: DdProject, evidence: EvidenceRecord): DepartmentKey | undefined {
  const ws = documentWorkstream(project, evidence);
  return ws ? workstreamDefinition(ws)?.department : undefined;
}

/** The documents a workstream owns. */
export function workstreamDocuments(project: DdProject, workstream: string): EvidenceRecord[] {
  return project.evidence.filter((e) => documentWorkstream(project, e) === workstream);
}

/** Give a document to a workstream by hand; `null` hands it back to what it is. */
export function setDocumentWorkstream(project: DdProject, evidenceId: string, workstream: string | null): EvidenceRecord {
  const row = project.evidence.find((e) => e.id === evidenceId);
  if (!row) throw new Error('No document by that id.');
  if (workstream === null) delete row.workstream;
  else {
    if (!workstreamDefinition(workstream)) throw new Error('Unknown workstream.');
    row.workstream = workstream;
  }
  row.updatedAt = new Date().toISOString();
  return row;
}
