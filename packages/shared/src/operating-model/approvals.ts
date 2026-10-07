/**
 * Legal › Approvals & NOCs: every sanction, clearance and NOC the project
 * needs, what the file holds for each, and when each runs out.
 *
 * Read from the documents on file rather than typed into a second register:
 * a NOC filed on the vault is the approval, with the dates its own pages
 * state. The catalogue says which approvals a project needs and by which
 * stage; anything needed and not on file shows as missing.
 */

import type { DdProject, EvidenceRecord, LifecycleStage } from './types';
import type { DocumentFact } from './document-parse';
import { standingFacts, waitingReadings } from './fact-review';
import { SUB_STAGES, SUB_STAGE_LABEL } from './departments';

export interface ApprovalKind {
  key: string;
  label: string;
  authority: string;
  /** The document types that are this approval. */
  documentTypes: string[];
  /** Needed before the project can pass this lifecycle stage. */
  neededBy: LifecycleStage;
  /** Only for some projects: shown as "if applicable" until a document says it applies. */
  conditional?: boolean;
}

/**
 * What a residential or commercial development in Karnataka needs, in the
 * order it is usually obtained. Utility and aviation NOCs depend on the site;
 * they show once a document names them, or as "if applicable".
 */
export const APPROVAL_KINDS: readonly ApprovalKind[] = [
  { key: 'conversion', label: 'Land conversion (DC order)', authority: 'Deputy Commissioner', documentTypes: ['DC conversion order'], neededBy: 'acquisition' },
  { key: 'zoning', label: 'Zoning / land-use certificate', authority: 'Planning authority', documentTypes: ['Zoning certificate'], neededBy: 'design', conditional: true },
  { key: 'plan_sanction', label: 'Building plan sanction', authority: 'BBMP / BDA / BMRDA', documentTypes: ['Sanctioned building plan'], neededBy: 'approvals' },
  { key: 'environment', label: 'Environmental clearance', authority: 'SEIAA Karnataka', documentTypes: ['Environmental clearance'], neededBy: 'approvals' },
  { key: 'aviation', label: 'Height clearance (AAI NOC)', authority: 'Airports Authority of India', documentTypes: ['Aviation height NOC'], neededBy: 'approvals', conditional: true },
  { key: 'fire', label: 'Fire NOC', authority: 'Karnataka Fire and Emergency Services', documentTypes: ['Fire NOC'], neededBy: 'approvals', conditional: true },
  { key: 'utilities', label: 'Utility NOCs (power, water, telecom)', authority: 'BESCOM, BWSSB, BSNL', documentTypes: ['Utility NOC'], neededBy: 'approvals' },
  { key: 'rera', label: 'RERA registration', authority: 'K-RERA', documentTypes: ['RERA registration certificate'], neededBy: 'procurement' },
  { key: 'commencement', label: 'Commencement certificate', authority: 'Planning authority', documentTypes: ['Commencement certificate'], neededBy: 'construction' },
  { key: 'occupancy', label: 'Occupancy certificate', authority: 'Planning authority', documentTypes: ['Occupancy certificate'], neededBy: 'handover' },
];

export type ApprovalStatus = 'in_force' | 'expiring' | 'expired' | 'missing' | 'not_yet_due' | 'if_applicable';

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  in_force: 'In force',
  expiring: 'Expiring',
  expired: 'Expired',
  missing: 'Missing',
  not_yet_due: 'Not yet due',
  if_applicable: 'If applicable',
};

export interface ApprovalHeld {
  evidenceId: string;
  document: string;
  issuedBy?: string;
  reference?: string;
  issuedOn?: string;
  validUntil?: string;
  /** The facts' own words, for the page reference. */
  page?: number;
  /**
   * A reading of its dates, its number or who issued it waits on the paper:
   * a model's that nobody has accepted, or one two readers differ on. It
   * dates nothing here until a person decides it.
   */
  readingWaiting?: boolean;
}

export interface ApprovalLine {
  kind: ApprovalKind;
  status: ApprovalStatus;
  /** Every document on file that is this approval, newest first. */
  held: ApprovalHeld[];
  /** Days until the earliest validity runs out; negative once it has. */
  daysLeft: number | null;
  /** Why the status is what it is, in a line. */
  say: string;
}

/** Validity this close is worth an alert. */
export const EXPIRING_WITHIN_DAYS = 60;

function onFile(row: EvidenceRecord): boolean {
  if (row.status === 'superseded' || row.status === 'rejected' || row.status === 'missing') return false;
  return row.attachments.length > 0 || row.status === 'received' || row.status === 'validated' || row.status === 'used';
}

function fact(facts: DocumentFact[], ...keys: string[]): DocumentFact | undefined {
  for (const key of keys) {
    const hit = facts.find((f) => f.key === key);
    if (hit) return hit;
  }
  return undefined;
}

function dateOf(f: DocumentFact | undefined): string | undefined {
  if (!f) return undefined;
  const raw = String(f.value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : undefined;
}

const ISSUED_KEYS = ['issued_on', 'sanction_date', 'rera_approved_on', 'oc_date', 'conversion_date'];
const VALID_KEYS = ['valid_until', 'rera_valid_until'];
const REFERENCE_KEYS = ['reference', 'sanction_number', 'rera_number', 'clearance_number', 'order_number'];
const HELD_KEYS = new Set([...ISSUED_KEYS, ...VALID_KEYS, ...REFERENCE_KEYS, 'issued_by']);

function heldFrom(row: EvidenceRecord): ApprovalHeld {
  // What stands on the paper. A date only a model read, that nobody has accepted, neither starts nor ends an approval.
  const facts = standingFacts(row);
  const issued = fact(facts, ...ISSUED_KEYS);
  const valid = fact(facts, ...VALID_KEYS);
  const ref = fact(facts, ...REFERENCE_KEYS);
  const by = fact(facts, 'issued_by');
  return {
    evidenceId: row.id,
    document: row.title,
    ...(by ? { issuedBy: String(by.value) } : {}),
    ...(ref ? { reference: String(ref.value) } : {}),
    ...(dateOf(issued) ? { issuedOn: dateOf(issued) } : {}),
    ...(dateOf(valid) ? { validUntil: dateOf(valid) } : {}),
    ...(issued?.page ? { page: issued.page } : {}),
    ...(waitingReadings(row).some((f) => HELD_KEYS.has(f.key)) ? { readingWaiting: true } : {}),
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2020-03-10 → 10 Mar 2020, as the documents themselves write it. */
function onDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

/** The approvals register: each approval the project needs, and where it stands. */
export function approvalsRegister(project: DdProject, now = new Date()): ApprovalLine[] {
  const today = now.toISOString().slice(0, 10);
  const stageIndex = SUB_STAGES.indexOf(project.currentStage);
  const rows = (project.evidence ?? []).filter(onFile);
  return APPROVAL_KINDS.map((kind) => {
    const held = rows
      .filter((r) => r.documentType && kind.documentTypes.includes(r.documentType))
      .map(heldFrom)
      .sort((a, b) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? ''));
    const validities = held.map((h) => h.validUntil).filter((v): v is string => !!v).sort();
    const earliest = validities[0];
    const daysLeft = earliest ? daysBetween(today, earliest) : null;
    const due = SUB_STAGES.indexOf(kind.neededBy) <= stageIndex;
    let status: ApprovalStatus;
    let say: string;
    if (held.length) {
      if (daysLeft !== null && daysLeft < 0) {
        status = 'expired';
        say = `Lapsed on ${onDay(earliest!)}.`;
      } else if (daysLeft !== null && daysLeft <= EXPIRING_WITHIN_DAYS) {
        status = 'expiring';
        say = `Valid until ${onDay(earliest!)} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`;
      } else {
        status = 'in_force';
        say = earliest ? `Valid until ${onDay(earliest)}.` : held[0]!.issuedOn ? `Issued ${onDay(held[0]!.issuedOn)}; no expiry stated.` : 'On file; no dates read yet.';
      }
    } else if (kind.conditional) {
      status = 'if_applicable';
      say = 'Needed only for some sites. Nothing on file says it applies.';
    } else if (due) {
      status = 'missing';
      say = `Needed from the ${SUB_STAGE_LABEL[kind.neededBy]} step and not on file.`;
    } else {
      status = 'not_yet_due';
      say = `Needed from the ${SUB_STAGE_LABEL[kind.neededBy]} step.`;
    }
    // Said where a reading would have dated it: it waits, and until a person decides it the line above stands without it.
    if (held.some((h) => h.readingWaiting)) say = `${say} A reading of its details is waiting to be accepted on the document.`;
    return { kind, status, held, daysLeft, say };
  });
}

/** Whether construction may run: commencement on file, plan sanction in force. */
export function constructionGate(project: DdProject, now = new Date()): { open: boolean; missing: string[] } {
  const register = approvalsRegister(project, now);
  const need = ['plan_sanction', 'commencement'];
  const missing = register.filter((l) => need.includes(l.kind.key) && (l.status === 'missing' || l.status === 'expired' || l.status === 'not_yet_due')).map((l) => l.kind.label);
  return { open: missing.length === 0, missing };
}
