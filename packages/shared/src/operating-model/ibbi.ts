/**
 * The twelve things Rule 8(3) says a valuation report must state, and which of
 * them this file can actually satisfy.
 *
 * The structure was already right in outline — instruction, subject, dates,
 * basis, approaches, reconciliation, caveats — which is why it was easy to
 * believe it was complete. Checked against the rule itself, five of the twelve
 * items were absent and two more were partial. The absent ones are not
 * decorative: the valuer's identity, their disclosure of interest, and the
 * inspections actually undertaken are the items that make a report a
 * professional act rather than a spreadsheet with headings.
 *
 * Source: Rule 8, Companies (Registered Valuers and Valuation) Rules 2017.
 * The rule is a report-contents checklist and this module treats it as one. It
 * does not make anything here a certified valuation — a certificate needs a
 * registered valuer's signature, and no amount of completeness substitutes.
 *
 * ## Why completeness is computed rather than asserted
 *
 * A report that quietly omits the conflict disclosure looks exactly like one
 * that had nothing to disclose. `rule8Completeness` returns a status per item
 * so the page can say which of the twelve are answered, which are partial and
 * which are missing — and so the caveat about what this is can be built from
 * fact rather than written once and left to rot.
 */

import type { IbbiValuationSections } from './types';

export type Rule8Item =
  | 'background'
  | 'purpose'
  | 'identity'
  | 'conflict'
  | 'dates'
  | 'inspections'
  | 'sources'
  | 'procedures'
  | 'restrictions'
  | 'factors'
  | 'conclusion'
  | 'caveats';

/** The rule's own wording, abridged, so a reader can check the mapping. */
export const RULE_8_ITEMS: ReadonlyArray<{ item: Rule8Item; clause: string; says: string }> = [
  { item: 'background', clause: '8(3)(a)', says: 'Background information of the asset being valued' },
  { item: 'purpose', clause: '8(3)(b)', says: 'Purpose of valuation and appointing authority' },
  { item: 'identity', clause: '8(3)(c)', says: 'Identity of the valuer and any other experts involved' },
  { item: 'conflict', clause: '8(3)(d)', says: 'Disclosure of valuer interest or conflict, if any' },
  { item: 'dates', clause: '8(3)(e)', says: 'Date of appointment, valuation date and date of report' },
  { item: 'inspections', clause: '8(3)(f)', says: 'Inspections and/or investigations undertaken' },
  { item: 'sources', clause: '8(3)(g)', says: 'Nature and sources of the information used or relied upon' },
  { item: 'procedures', clause: '8(3)(h)', says: 'Procedures adopted and valuation standards followed' },
  { item: 'restrictions', clause: '8(3)(i)', says: 'Restrictions on use of the report, if any' },
  { item: 'factors', clause: '8(3)(j)', says: 'Major factors that influenced the valuation' },
  { item: 'conclusion', clause: '8(3)(k)', says: 'Conclusion' },
  { item: 'caveats', clause: '8(3)(l)', says: 'Caveats, limitations and disclaimers' },
];

export type Rule8Status = 'stated' | 'partial' | 'missing';

export interface Rule8Row {
  item: Rule8Item;
  clause: string;
  says: string;
  status: Rule8Status;
  /** What is missing, in terms of what somebody would do about it. */
  note?: string;
}

/**
 * Who signed, and what they had to declare.
 *
 * Nothing here validates a registration number against IBBI's register — that
 * is a lookup this product does not do, and pretending otherwise would be
 * worse than leaving the field free text. What it does is make the absence
 * visible: a report with no valuer named says so on its own face.
 */
export interface ValuerIdentity {
  name: string;
  /** IBBI registration number, when the person holds one. */
  registrationNumber?: string;
  /** Asset class they are registered for — L&B, P&M, S&FA. */
  registeredFor?: string;
  firm?: string;
  /** Anyone else whose work this rests on. Rule 8(2) makes the signer liable for it. */
  otherExperts?: Array<{ name: string; contribution: string }>;
}

/**
 * Rule 8(3)(d).
 *
 * `declared: false` with no interests is a positive statement — "I have
 * considered this and have none" — and is different from nobody having filled
 * it in, which is what an absent `conflict` means. The two must never render
 * the same, which is the whole reason this is an object rather than a string.
 */
export interface ConflictDisclosure {
  declared: boolean;
  interests: string[];
  statedBy: string;
  statedAt: string;
}

export interface InspectionRecord {
  /** The site visit this came from, so a reader can walk to it. */
  visitId: string;
  visitedOn: string;
  by: string;
  /** What could not be inspected. The half a report most often omits. */
  limitations: string[];
}

/** Everything Rule 8 asks for that the original sections had no home for. */
export interface Rule8Additions {
  valuer?: ValuerIdentity;
  conflict?: ConflictDisclosure;
  appointedOn?: string;
  reportedOn?: string;
  inspections?: InspectionRecord[];
  /** 8(3)(i) — kept apart from the caveats, because the rule keeps them apart. */
  restrictionsOnUse?: string[];
  /** 8(3)(j) — what actually moved the number. */
  majorFactors?: string[];
  /** 8(3)(h) — the standards the procedures followed. */
  standardsFollowed?: string[];
}

function statusOf(filled: boolean, partial: boolean): Rule8Status {
  if (filled) return 'stated';
  return partial ? 'partial' : 'missing';
}

/**
 * Which of the twelve this report actually answers.
 *
 * The notes are written as instructions rather than as diagnoses — "record the
 * valuer's name and registration" rather than "identity missing" — because the
 * only useful thing a completeness readout can do is tell somebody what to go
 * and do.
 */
export function rule8Completeness(sections: IbbiValuationSections, extra: Rule8Additions = {}): Rule8Row[] {
  const has = (s?: string) => Boolean(s && s.trim());
  const rows: Rule8Row[] = [];

  for (const { item, clause, says } of RULE_8_ITEMS) {
    let status: Rule8Status = 'missing';
    let note: string | undefined;

    switch (item) {
      case 'background':
        status = statusOf(has(sections.subject), false);
        note = status === 'missing' ? 'Record the subject on Subject identification.' : undefined;
        break;
      case 'purpose':
        // The appointing authority is the half that is usually absent, and it
        // is the half that says who the valuer answers to.
        status = statusOf(has(sections.instruction) && has(extra.valuer?.firm), has(sections.instruction));
        note = has(sections.instruction) && !has(extra.valuer?.firm) ? 'Purpose is stated; name the appointing authority as well.' : undefined;
        break;
      case 'identity':
        status = statusOf(has(extra.valuer?.name) && has(extra.valuer?.registrationNumber), has(extra.valuer?.name));
        note = !has(extra.valuer?.name)
          ? 'Record who is signing this, and their IBBI registration number.'
          : !has(extra.valuer?.registrationNumber)
            ? 'A name is recorded but no registration number, so this cannot be a registered valuer’s report.'
            : undefined;
        break;
      case 'conflict':
        // Absent and "declared none" are different facts.
        status = extra.conflict ? 'stated' : 'missing';
        note = extra.conflict ? undefined : 'Nobody has declared whether they hold an interest. An absent disclosure is not a nil disclosure.';
        break;
      case 'dates':
        status = statusOf(
          has(sections.dates.valuationDate) && has(extra.appointedOn) && has(extra.reportedOn),
          has(sections.dates.valuationDate),
        );
        note =
          has(sections.dates.valuationDate) && (!has(extra.appointedOn) || !has(extra.reportedOn))
            ? 'Valuation date is set; the rule also asks for the date of appointment and the date of the report.'
            : undefined;
        break;
      case 'inspections':
        status = statusOf(Boolean(extra.inspections?.length), false);
        note = extra.inspections?.length ? undefined : 'No inspection recorded. Record a site visit and it will be read from there.';
        break;
      case 'sources':
        status = statusOf(sections.evidenceReliedUponIds.length > 0, sections.evidenceConsideredIds.length > 0);
        note = sections.evidenceReliedUponIds.length ? undefined : 'Mark the evidence this rests on as used, not merely received.';
        break;
      case 'procedures':
        status = statusOf(sections.approaches.length > 0 && Boolean(extra.standardsFollowed?.length), sections.approaches.length > 0);
        note =
          sections.approaches.length && !extra.standardsFollowed?.length
            ? 'The procedures are shown; name the valuation standards they followed.'
            : undefined;
        break;
      case 'restrictions':
        status = statusOf(Boolean(extra.restrictionsOnUse?.length), sections.caveats.length > 0);
        note = extra.restrictionsOnUse?.length
          ? undefined
          : 'Restrictions on use are their own item in the rule, kept apart from the caveats. State who may rely on this and for what.';
        break;
      case 'factors':
        status = statusOf(Boolean(extra.majorFactors?.length), has(sections.legalPlanningAssumptions));
        note = extra.majorFactors?.length ? undefined : 'Only the legal and planning assumptions are recorded. State what actually moved the number.';
        break;
      case 'conclusion':
        status = statusOf(has(sections.reconciliation), false);
        break;
      case 'caveats':
        status = statusOf(sections.caveats.length > 0, false);
        break;
    }
    rows.push({ item, clause, says, status, ...(note ? { note } : {}) });
  }
  return rows;
}

export interface Rule8Summary {
  rows: Rule8Row[];
  stated: number;
  partial: number;
  missing: number;
  total: number;
  /** One sentence for the head of the report. */
  say: string;
}

export function rule8Summary(sections: IbbiValuationSections, extra: Rule8Additions = {}): Rule8Summary {
  const rows = rule8Completeness(sections, extra);
  const stated = rows.filter((r) => r.status === 'stated').length;
  const partial = rows.filter((r) => r.status === 'partial').length;
  const missing = rows.filter((r) => r.status === 'missing').length;
  return {
    rows,
    stated,
    partial,
    missing,
    total: rows.length,
    // Deliberately never congratulatory. Twelve of twelve is a complete
    // STRUCTURE, and a structure is not a certificate — the distinction this
    // whole product turns on.
    say:
      missing === 0 && partial === 0
        ? `All ${rows.length} Rule 8(3) items are stated. That is a complete structure, not a certified valuation — a certificate needs a registered valuer’s signature.`
        : `${stated} of ${rows.length} Rule 8(3) items stated, ${partial} partial, ${missing} missing. This is an indicative valuation and does not meet the report-contents rule.`,
  };
}
