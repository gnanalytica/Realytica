/**
 * What is mine, across every file.
 *
 * Sixteen fields in this model name a person and every one of them is free
 * text: `owner` on a check, an evidence row, a finding, a risk, an action, an
 * assessment, a project; `responsible` on a stage. Free text is why they work
 * at all — a site helper who has never signed in is still the person fixing the
 * boundary wall — and it is also why nobody could ever ask the one question
 * that matters on a Monday morning, which is what they are supposed to be doing
 * today.
 *
 * So this does not migrate the fields to ids. It resolves them.
 *
 * ## What "resolves" is allowed to mean
 *
 * Conservatively, and that is the whole design. A false negative costs one row
 * missing from a list somebody can also reach through the registers. A false
 * positive puts another person's work in front of you — on a screen whose
 * entire promise is "this is yours" — and the reader has no way to tell. So the
 * rules are the ones where being wrong is close to impossible:
 *
 *   the address · its local part · the full name as recorded
 *
 * and nothing looser. "Priya" does not match "Priya Shah" here, because a
 * workspace with two Priyas is not unusual and the failure would be silent.
 * `ownerSuggestions` exists so the free text converges on one of these forms
 * as people are typed in, rather than by anybody being asked to migrate.
 */

import type {
  ActionRecord,
  ActionStatus,
  DdProject,
  EvidenceRecord,
  EvidenceStatus,
  FindingRecord,
  FindingSeverity,
  FindingStatus,
  RiskRecord,
} from './types';

/** Somebody a piece of work can belong to. */
export interface WorkPerson {
  email: string;
  name?: string;
}

function fold(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function localPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at).toLowerCase() : '';
}

/**
 * Does this owner field name this person?
 *
 * Deliberately three exact comparisons rather than anything fuzzy. See the
 * header: the cost of the two failure directions is not symmetric.
 */
export function ownedBy(owner: string | undefined, person: WorkPerson): boolean {
  const wrote = fold(owner);
  if (!wrote) return false;
  if (wrote === fold(person.email)) return true;
  if (person.name && wrote === fold(person.name)) return true;
  const local = localPart(person.email);
  return local.length > 1 && wrote === local;
}

/* ==================================================================== */
/* One row of work                                                      */
/* ==================================================================== */

export type WorkKind = 'action' | 'finding' | 'risk' | 'evidence' | 'check';

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  action: 'Action',
  finding: 'Finding',
  risk: 'Risk',
  evidence: 'Document',
  check: 'Check',
};

/**
 * One thing somebody has to do, with enough on it to be triaged without
 * opening the project it belongs to.
 *
 * `pane` and `focusId` rather than a URL: this package knows the operating
 * model and deliberately not the routes, and `cockpitPath` already turns the
 * pair into one.
 */
export interface WorkItem {
  id: string;
  kind: WorkKind;
  title: string;
  projectId: string;
  projectName: string;
  projectReference: string;
  /** What the owner field actually said, so a mismatch is visible rather than magic. */
  owner: string;
  /** The record's own status word, already labelled by its register. */
  status: string;
  severity?: FindingSeverity;
  dueDate?: string;
  /** Set when the due date has passed and the row is not closed. */
  overdue?: boolean;
  detail?: string;
  ddId?: string;
  scopeId?: string;
}

/** Work that is finished is not work. */
const DONE_ACTION: ReadonlySet<ActionStatus> = new Set(['closed']);
const DONE_FINDING: ReadonlySet<FindingStatus> = new Set([
  'closed',
  'rejected',
  'duplicate',
  'superseded',
  'accepted',
]);
const DONE_EVIDENCE: ReadonlySet<EvidenceStatus> = new Set(['validated', 'used', 'superseded']);

function isOverdue(dueDate: string | undefined, now: string): boolean {
  if (!dueDate) return false;
  const due = Date.parse(dueDate);
  return Number.isFinite(due) && due < Date.parse(now);
}

/**
 * Everything on one project that belongs to this person and is not finished.
 *
 * Takes whatever project it is handed, which is what makes it safe on a
 * collaborator's behalf: pass the projection and it can only find work inside
 * the grant, with no rule of its own to get wrong.
 */
export function myWorkOn(project: DdProject, person: WorkPerson, now: string): WorkItem[] {
  const items: WorkItem[] = [];
  const base = {
    projectId: project.id,
    projectName: project.name,
    projectReference: project.reference,
  };

  for (const action of project.actions) {
    if (!ownedBy(action.owner, person) || DONE_ACTION.has(action.status)) continue;
    items.push({
      ...base,
      id: action.id,
      kind: 'action',
      title: action.title,
      owner: action.owner,
      status: action.status,
      severity: action.priority,
      dueDate: action.dueDate,
      overdue: action.status === 'overdue' || isOverdue(action.dueDate, now),
      detail: action.description,
    });
  }

  for (const finding of project.findings) {
    if (!ownedBy(finding.owner, person) || DONE_FINDING.has(finding.status)) continue;
    items.push({
      ...base,
      id: finding.id,
      kind: 'finding',
      title: finding.title,
      owner: finding.owner!,
      status: finding.status,
      severity: finding.severity,
      detail: finding.description,
    });
  }

  for (const risk of project.risks) {
    if (!ownedBy(risk.owner, person)) continue;
    items.push({
      ...base,
      id: risk.id,
      kind: 'risk',
      title: risk.title,
      owner: risk.owner!,
      status: risk.materiality,
      severity: risk.materiality,
      detail: risk.mitigation,
    });
  }

  for (const row of project.evidence) {
    if (!ownedBy(row.owner, person) || DONE_EVIDENCE.has(row.status)) continue;
    items.push({
      ...base,
      id: row.id,
      kind: 'evidence',
      title: row.title,
      owner: row.owner!,
      status: row.status,
      detail: row.description,
    });
  }

  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (!ownedBy(check.owner, person) || check.result !== 'pending') continue;
        items.push({
          ...base,
          id: check.id,
          kind: 'check',
          title: check.title,
          owner: check.owner!,
          status: check.result,
          ddId: assessment.id,
          scopeId: scope.id,
        });
      }
    }
  }

  return items;
}

/**
 * The order a person reads this in.
 *
 * Overdue first, then what has a date, soonest first, then by severity. Rows
 * with neither a date nor a severity go last rather than being dropped —
 * "somebody put my name on this and never said when" is a real state and
 * hiding it is how it stays true.
 */
const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function sortWork(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (Boolean(a.dueDate) !== Boolean(b.dueDate)) return a.dueDate ? -1 : 1;
    const sa = a.severity ? SEVERITY_RANK[a.severity] : 9;
    const sb = b.severity ? SEVERITY_RANK[b.severity] : 9;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title);
  });
}

export function myWorkAcross(projects: readonly DdProject[], person: WorkPerson, now: string): WorkItem[] {
  return sortWork(projects.flatMap((p) => myWorkOn(p, person, now)));
}

/** A count worth putting on a nav item: how much of this is late. */
export function overdueCount(items: readonly WorkItem[]): number {
  return items.filter((i) => i.overdue).length;
}

/* ==================================================================== */
/* Converging the free text                                             */
/* ==================================================================== */

/**
 * What to offer when somebody is typing an owner.
 *
 * The names already on this project first — most work is handed to somebody
 * already on the file — then everybody else in the workspace. Offered rather
 * than enforced: the field stays free text because the person doing the work
 * is not always somebody with an account, and a picker that refuses them would
 * be a picker people route around by typing the name into the description.
 */
export function ownerSuggestions(
  project: DdProject | undefined,
  roster: readonly WorkPerson[],
): string[] {
  const onFile = new Set<string>();
  if (project) {
    const add = (value: string | undefined) => {
      const text = (value ?? '').trim();
      if (text) onFile.add(text);
    };
    add(project.owner);
    for (const a of project.assessments) {
      add(a.owner);
      for (const s of a.scopes) {
        add(s.owner);
        for (const c of s.checks) add(c.owner);
      }
    }
    for (const r of project.evidence) add(r.owner);
    for (const f of project.findings) add(f.owner);
    for (const r of project.risks) add(r.owner);
    for (const a of project.actions) add(a.owner);
  }

  const known = roster.map((p) => p.name?.trim() || p.email);
  const seen = new Set<string>();
  return [...onFile, ...known].filter((value) => {
    const key = fold(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
