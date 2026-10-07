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
import { DEPARTMENT_SHORT, FUNCTION_SHORT, functionKey, withDepartment, workstreamOfCheck, workstreamDefinition } from './departments';
import { allChecks } from './engagements';
import { recordAuditEvent } from './operations';
import { decisionRefused } from './review';
import type { MayDecide } from './team';

/**
 * The model's classification in the register's own words.
 *
 * The document reader names what it read from the model's list of kinds;
 * the register, the vault and the approvals all speak the parser's labels.
 * Where both name the same document, the model's reading files it under the
 * parser's label, so a merged bundle the parser could not read still lands
 * in the workstream it belongs to. A type says what a document is; it is no
 * claim about any page, so it needs no citation to stand.
 */
const MODEL_KIND_TYPE: Readonly<Record<string, string>> = {
  title_deed: 'Sale deed',
  sale_agreement: 'Agreement to sell',
  encumbrance_certificate: 'Encumbrance certificate',
  property_tax_receipt: 'Property tax receipt',
  approved_building_plan: 'Sanctioned building plan',
  sanctioned_plan_bbmp: 'Sanctioned building plan',
  occupancy_certificate: 'Occupancy certificate',
  khata_extract: 'Khata certificate and extract',
  rera_registration: 'RERA registration certificate',
  mother_deed: 'Mother deed',
  conversion_certificate: 'DC conversion order',
  commencement_certificate: 'Commencement certificate',
  joint_development_agreement: 'Joint development agreement',
  valuation_report: 'Valuation report',
  lease_agreement: 'Lease deed',
};

/** The register's label for a kind the model read, if the register knows it. */
export function documentTypeOfKind(kind: string | undefined): string | undefined {
  return kind ? MODEL_KIND_TYPE[kind] : undefined;
}

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

/** The documents a workstream owns. */
export function workstreamDocuments(project: DdProject, workstream: string): EvidenceRecord[] {
  return project.evidence.filter((e) => documentWorkstream(project, e) === workstream);
}

/** A function as a place is written: "Legal › Title", and "Engineering › Design" for any of the design workstreams. */
function placeSaid(workstream: string): string {
  const fn = functionKey(workstream);
  return withDepartment(fn, fn === workstream ? (FUNCTION_SHORT[fn] ?? workstreamDefinition(fn)?.label ?? fn) : DEPARTMENT_SHORT.design);
}

/**
 * Make a change that may move a paper from one function to another: giving
 * it to a function by hand, handing it back, saying what kind of paper it is,
 * filing it as a certified report.
 *
 * Which function holds a paper says whose its values are to decide. So moving
 * a paper a function already holds is that department's own decision: where a
 * person is asking (`mayDecide`), it takes a lead or a signer of the
 * department that holds the paper now, as it stands before the change, and
 * anybody else is refused before anything changes. Otherwise a lead of one
 * department could take a paper from another and decide it there. A paper no
 * function holds yet is given its first home by whoever may file it.
 *
 * `to` says where the paper would be held once the change is made, asked of
 * the same record the department is read from. `change` makes the change.
 * Every move is written on the trail: from where, to where, by whom.
 */
export function moveDocument(
  project: DdProject,
  row: EvidenceRecord,
  to: (record: DdProject) => string | undefined,
  actor: string,
  mayDecide: MayDecide | undefined,
  change: () => void,
): void {
  const record = mayDecide?.record ?? project;
  const from = documentWorkstream(record, row);
  const next = to(record);
  // A move is between functions. The design workstreams are one function, and a paper passed between them has not moved.
  const moves = (from ? functionKey(from) : undefined) !== (next ? functionKey(next) : undefined);
  const department = from ? workstreamDefinition(from)?.department : undefined;
  if (moves && department && mayDecide && !mayDecide(department)) throw decisionRefused('Moving a paper out of the function that holds it', department, mayDecide);
  change();
  if (moves) {
    recordAuditEvent(project, { actor, action: 'assign_document', entityType: 'evidence', entityId: row.id, oldValue: from ? placeSaid(from) : undefined, newValue: next ? placeSaid(next) : 'Documents' });
  }
}

/**
 * Put what a reading took a paper for on its row.
 *
 * `known` is a kind this server's rules read off the file. `offered` is one
 * only a model, or a hint that came with the file, took it for.
 *
 * A row with no kind yet takes the rules' kind as its own. A row that has a
 * kind keeps it, whatever is read off a file put on it: a reading never
 * renames a paper. The kind says which function holds the paper and which of
 * its values stand, so a rename by upload would move it past the rule for a
 * move and take accepted values out of force, with nobody asked and nothing
 * on the trail. What the reading took it for is kept beside the row's kind as
 * an offer instead (`proposedDocumentType`). Making it the row's kind is then
 * a person's to do, by confirming or correcting it, where it is held to that
 * rule and written down.
 *
 * A model's kind is always an offer. Nothing is offered that the row already
 * says, or that a person has refused for this paper. Returns the offer left
 * on the row, if one was.
 */
export function kindAsRead(row: EvidenceRecord, read: { known?: string; offered?: string }): string | undefined {
  if (read.known && (!row.documentType || row.documentType === read.known)) {
    row.documentType = read.known;
    // The row says what it is now. What was offered for it before is no longer an offer waiting to be confirmed over it.
    delete row.proposedDocumentType;
    return undefined;
  }
  const offer = read.known ?? read.offered;
  if (!offer || offer === row.documentType || offer === row.refusedDocumentType) return undefined;
  row.proposedDocumentType = offer;
  return offer;
}

/**
 * Give a document to a workstream by hand; `null` hands it back to what it
 * is. Either may move the paper from the function that holds it, and is held
 * to the rule for a move (`moveDocument`).
 */
export function setDocumentWorkstream(project: DdProject, evidenceId: string, workstream: string | null, actor: string, options: { mayDecide?: MayDecide } = {}): EvidenceRecord {
  const row = project.evidence.find((e) => e.id === evidenceId);
  if (!row) throw new Error('No document by that id.');
  if (workstream !== null && !workstreamDefinition(workstream)) throw new Error('Unknown workstream.');
  const { workstream: _given, ...handedBack } = row;
  moveDocument(project, row, (record) => workstream ?? documentWorkstream(record, handedBack), actor, options.mayDecide, () => {
    if (workstream === null) delete row.workstream;
    else row.workstream = workstream;
    row.updatedAt = new Date().toISOString();
  });
  return row;
}
