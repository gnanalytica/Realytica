/**
 * The department review — a specialised run, composed rather than bespoke.
 *
 * Harvey's lesson was that specialisation belongs in the workflow, not in the
 * navigation. The same argument applies one level down: it belongs in the
 * BRIEF, not in a parallel agent. A per-department agent kind would need its
 * own route, capability probe, telemetry and review path, and would end up
 * with a second vocabulary for proposing findings — the exact mistake this
 * codebase has already paid for with the deleted `details` agent.
 *
 * So a review is a question, built here from the department's own question,
 * its recorded gaps and its documents, and asked through the copilot that
 * already has the read tools and already proposes findings for review. What
 * makes it specialised is that it names this department's material and
 * nothing else; what makes it safe is that it changes nothing about how a
 * proposal is reviewed.
 */

import type { PropertyCase } from './types';
import type { DdDomain } from './dd-domains';
import { DD_DOMAIN_PROFILES } from './dd-domains';
import { buildDepartmentDossier } from './dd-dossier';

/** What each department is actually looking for, in the terms a reviewer uses. */
const REVIEW_FOCUS: Record<DdDomain, string> = {
  land:
    'whether the extent, the boundaries and the classification agree across the deed, the khata and the survey record, and whether anything in the revenue record contradicts what the deed conveys',
  legal:
    'whether the chain of title connects party to party without a gap, what the encumbrance search actually covers, and whether any charge, litigation or restriction is recorded against the parties or the parcel',
  approvals:
    'whether what stands here was permitted, whether every permission is complete and current, and whether the as-built position departs from what was sanctioned',
  compliance:
    'whether the statutory consents that must be live today are live today — not merely granted once — and which have lapsed or are about to',
  technical:
    'the condition of the building system by system, what is defective, what it would take to put right, and which system nobody has assessed at all',
  financial:
    'what the findings on this file cost, which of them are provisions rather than costs, and how the asking price stands against what the methods support',
  project_ops:
    'whether the operation is ready to hand over — the O&M record, the warranties, the service contracts and the tenancy obligations',
  risk:
    'which findings across every department would actually stop or condition this transaction, and which are merely untidy',
};

export interface DepartmentReview {
  domain: DdDomain;
  /** The question put to the copilot. */
  question: string;
  /** What the review will look at, for the button's own confirmation. */
  summary: string;
  /** False when there is nothing on file for this department to review. */
  runnable: boolean;
}

/**
 * Composes the review brief for one department.
 *
 * The brief names the department's own documents and gaps so the run is
 * grounded in this file rather than in what a reviewer usually expects to
 * find — and it says outright that a gap is a valid finding, because the most
 * useful output of a review is often "you cannot answer this yet".
 */
export function buildDepartmentReview(propertyCase: PropertyCase, domain: DdDomain, now: string): DepartmentReview {
  const profile = DD_DOMAIN_PROFILES[domain];
  const dossier = buildDepartmentDossier(propertyCase, domain, { now });
  const docs = dossier.documents.map(d => d.fileName);
  const gaps = dossier.gaps.map(g => g.label);

  const runnable = docs.length > 0 || gaps.length > 0;

  const parts: string[] = [
    `Run the ${profile.label} review on this case.`,
    '',
    `The question this department answers: ${profile.question}`,
    `Look specifically at ${REVIEW_FOCUS[domain]}.`,
    '',
  ];
  if (docs.length > 0) {
    parts.push(`Documents filed to ${profile.label} (${docs.length}): ${docs.join(', ')}.`);
  } else {
    parts.push(`No documents are filed to ${profile.label} yet.`);
  }
  if (gaps.length > 0) {
    parts.push(`Already recorded as missing: ${gaps.slice(0, 12).join('; ')}${gaps.length > 12 ? `, and ${gaps.length - 12} more` : ''}.`);
  }
  parts.push(
    '',
    'Read the documents before concluding anything, and cite what you rely on.',
    'Where you find a defect or a departure that belongs on the record, draft it as a finding for review — do not state it as though it were already on the case.',
    'Do not repeat anything already recorded as missing; that is a gap, not a finding.',
    'If the documents do not let you answer, say which document would, and name it. An honest "this cannot be answered yet" is the most useful outcome a review can have.',
  );

  return {
    domain,
    question: parts.join('\n'),
    summary:
      docs.length > 0
        ? `${docs.length} document${docs.length === 1 ? '' : 's'}${gaps.length > 0 ? `, ${gaps.length} known gap${gaps.length === 1 ? '' : 's'}` : ''}`
        : 'nothing filed here yet',
    runnable,
  };
}
