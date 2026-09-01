/**
 * Where this product's vocabulary meets the published one.
 *
 * Everything here exists because the codebase was deciding for itself
 * something a standards body had already settled. That is not a small thing
 * in diligence: a report grades a defect, states an area basis, names a file
 * and classifies a contamination finding, and every one of those words means
 * something specific to the person reading it. Inventing a private dialect
 * asks each client to learn it, and worse, lets a term that has a legal
 * definition elsewhere be used here for something slightly different.
 *
 * Each mapping below carries the standard it comes from and, where it
 * matters, what that standard does NOT cover — the caveat is the load-bearing
 * half. ASTM's REC taxonomy is the vocabulary a lender expects; it is also
 * anchored to a US liability regime India has no analogue for, and a product
 * that borrowed the words while implying the protection would be worse than
 * one that never mentioned them.
 *
 * These are mappings, not the standards themselves. Five of the eight sources
 * on the reference shelf are paid publications; nothing here reproduces one.
 */

import type { FindingSeverity } from './types';

/* ==================================================================== */
/* RICS — grading a defect                                               */
/* ==================================================================== */

/**
 * The traffic light a reader of a technical DD report expects.
 *
 * RICS grades on three: 1 no repair needed but maintain, 2 defects needing
 * repair but not urgently, 3 serious and needing urgent investigation or
 * repair. This product grades findings on four severities, which is a finer
 * internal instrument — so the rating is DERIVED rather than recorded
 * separately. Two stored gradings of the same defect drift, and the one a
 * client reads should never be the one that drifted.
 *
 * Source: Technical due diligence of commercial property, RICS professional
 * standard (reissued April 2023).
 */
export type RicsConditionRating = 1 | 2 | 3;

export function ricsConditionRating(severity: FindingSeverity): RicsConditionRating {
  if (severity === 'critical' || severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export const RICS_RATING_LABEL: Record<RicsConditionRating, string> = {
  1: 'No repair needed — maintain',
  2: 'Repair or replacement needed, not urgent',
  3: 'Serious — urgent investigation, repair or replacement',
};

/**
 * "Dangerous" is a separate question from "urgent", and RICS treats it as one.
 *
 * A rating of 3 says the defect is serious. It does not say somebody could be
 * hurt today. The standard asks for defects needing immediate action, or that
 * could foreseeably pose a danger, to be called out and the appropriate person
 * contacted as soon as reasonably possible — which is an escalation, not a
 * grade. Collapsing the two into one scale loses the only distinction that
 * changes what happens in the next hour.
 */
export interface RicsEscalation {
  /** Somebody must act now, ahead of the report. */
  immediateAction: boolean;
  /** Who was told, and when — the record the standard asks for. */
  notifiedTo?: string;
  notifiedAt?: string;
}

/* ==================================================================== */
/* RICS — banding what a remedy costs                                    */
/* ==================================================================== */

/**
 * When the money falls, which is the table a TDD report is read for.
 *
 * A buyer does not primarily want a list of defects; they want to know what
 * has to be spent before completion, in the first year, and over the hold.
 * Bands rather than dates because the report is a snapshot and a date implies
 * a precision a visual inspection does not have.
 */
export type RemedialBand = 'immediate' | 'year_1' | 'years_1_5' | 'years_5_10';

export const REMEDIAL_BANDS: readonly RemedialBand[] = ['immediate', 'year_1', 'years_1_5', 'years_5_10'] as const;

export const REMEDIAL_BAND_LABEL: Record<RemedialBand, string> = {
  immediate: 'Immediate — before completion',
  year_1: 'Within a year',
  years_1_5: 'Years 1–5',
  years_5_10: 'Years 5–10',
};

/* ==================================================================== */
/* IPMS and RERA — what an area measurement means                        */
/* ==================================================================== */

/**
 * The measurement standard a stated area was taken under.
 *
 * This exists because of a real defect: the product offered `carpet`,
 * `built_up` and `super_built_up` as if they were three equivalent bases.
 * Only the first has a statutory definition in India — RERA s.2(k) — and
 * "super built-up" has none at all, which is precisely why RERA stopped
 * apartments being sold on it. A valuation that states a basis without saying
 * which document defines that basis has not stated one.
 *
 * IPMS levels are kept coarse deliberately. The sub-variants exist and matter
 * to a measuring surveyor, but recording a precision this product cannot
 * verify from a drawing would be a worse error than recording the level.
 *
 * Source: IPMS All Buildings, IPMS Coalition.
 */
export type IpmsBasis = 'ipms_1' | 'ipms_2' | 'ipms_3' | 'ipms_4';

export const IPMS_BASIS_LABEL: Record<IpmsBasis, string> = {
  ipms_1: 'IPMS 1 — whole building, measured to the outer face',
  ipms_2: 'IPMS 2 — whole building, measured internally',
  ipms_3: 'IPMS 3 — the area in an occupant’s exclusive use',
  ipms_4: 'IPMS 4 — component areas within a floor',
};

/** The bases the Indian market quotes in, and what each is actually worth. */
export const INDIAN_AREA_BASIS_STANDING: Record<string, { defined: boolean; note: string }> = {
  carpet: {
    defined: true,
    note: 'Defined in RERA s.2(k): net usable floor area, excluding external walls, service shafts, exclusive balcony and exclusive open terrace. Legally enforceable on a registered project.',
  },
  built_up: {
    defined: false,
    note: 'No statutory definition. Conventionally carpet plus wall thickness and balcony, but the convention varies by developer, so two “built-up” figures are not comparable.',
  },
  super_built_up: {
    defined: false,
    note: 'No statutory definition at all, and the reason RERA stopped apartments being sold on it — the loading applied to reach it is at the seller’s discretion. Do not state a value on this basis without also recording the RERA carpet area.',
  },
  unknown: { defined: false, note: 'Nobody has recorded what the stated area measures.' },
};

/**
 * The same basis arrives spelled three ways.
 *
 * `super_built_up` off the screen engine's `AreaBasis`, `super built-up` off a
 * check's radio, `Super Built Up` off a brochure. They are one fact, so the
 * lookup normalises rather than making each caller remember which spelling
 * this particular table happens to use.
 */
export function normaliseAreaBasis(basis: string): string {
  return basis.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * True when a quoted basis carries no definition anyone can check.
 *
 * Note the default: an unrecognised basis is UNDEFINED, not defined. A basis
 * this table has never heard of is precisely the case where a stated area
 * means nothing verifiable, and defaulting the other way would let a typo
 * silence the one warning that matters.
 */
export function areaBasisIsUndefined(basis: string): boolean {
  return INDIAN_AREA_BASIS_STANDING[normaliseAreaBasis(basis)]?.defined !== true;
}

/** What a stated basis is worth, in words, for whoever has to read the figure. */
export function areaBasisNote(basis: string): string {
  return INDIAN_AREA_BASIS_STANDING[normaliseAreaBasis(basis)]?.note ?? INDIAN_AREA_BASIS_STANDING.unknown!.note;
}

/* ==================================================================== */
/* ASTM E1527 — classifying an environmental finding                     */
/* ==================================================================== */

/**
 * The three-way classification a lender or an international buyer expects a
 * contamination finding in.
 *
 * Borrowed as VOCABULARY, and the distinction matters. ASTM E1527's legal
 * force is that a conforming Phase I establishes CERCLA landowner liability
 * protection in the United States. India has no analogue, so recording a
 * finding as an HREC here says "cleaned up, no use restrictions" and nothing
 * more — it confers no protection, and a report that implied otherwise would
 * be making a claim about a statute that does not apply.
 *
 * Source: ASTM E1527-21.
 */
export type EnvironmentalCondition = 'rec' | 'hrec' | 'crec';

export const ENVIRONMENTAL_CONDITION_LABEL: Record<EnvironmentalCondition, string> = {
  rec: 'REC — hazardous substances present, likely present, or a material threat of release',
  hrec: 'HREC — a past REC, cleaned up, with no use restrictions left',
  crec: 'CREC — a past REC, cleaned up subject to controls that remain in force',
};

export const ENVIRONMENTAL_CONDITION_CAVEAT =
  'ASTM E1527 classification. The standard establishes CERCLA liability protection in the United States; India has no equivalent, so this records what was found and how it was resolved — not a protection.';

/* ==================================================================== */
/* ISO 19650 — naming a document                                         */
/* ==================================================================== */

/**
 * The fields an information container is named from.
 *
 * `project-originator-volume-level-type-role-number`, per the UK National
 * Annex to BS EN ISO 19650-2. Role codes are drawn from the Uniclass 2015
 * Roles table, which is why the two standards travel together.
 *
 * Every part optional except the project, because a diligence pack collects
 * documents from a dozen sources and most arrive with none of this known.
 * A partial name is still more useful at the far end than a filename, and
 * refusing to name anything until every field is known would mean naming
 * nothing.
 */
export interface Iso19650Ref {
  originator?: string;
  volume?: string;
  level?: string;
  /** Uniclass-style document type: DR drawing, SP specification, RP report, SH schedule. */
  type?: string;
  /** Uniclass Roles code — A architect, C civil, S structural, K client, M M&E. */
  role?: string;
  number?: string;
}

const UNSET = 'XX';

/**
 * The conforming name for one document.
 *
 * Unknown fields become `XX`, which is the standard's own placeholder rather
 * than an omission — a name with a gap in it cannot be parsed back into its
 * fields, and being parseable is the whole point of a naming convention.
 */
export function iso19650Name(projectCode: string, ref: Iso19650Ref | undefined): string {
  const parts = [
    projectCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || UNSET,
    ref?.originator || UNSET,
    ref?.volume || UNSET,
    ref?.level || UNSET,
    ref?.type || UNSET,
    ref?.role || UNSET,
    (ref?.number || '').padStart(4, '0') || '0000',
  ];
  return parts.map((p) => String(p).replace(/[^A-Za-z0-9]/g, '').toUpperCase()).join('-');
}

/** How complete a container's reference is, so a pack can report its own conformance. */
export function iso19650Completeness(ref: Iso19650Ref | undefined): { known: number; total: number } {
  const fields = [ref?.originator, ref?.volume, ref?.level, ref?.type, ref?.role, ref?.number];
  return { known: fields.filter((f) => Boolean(f && String(f).trim())).length, total: fields.length };
}

/* ==================================================================== */
/* Uniclass 2015 — saying what an asset is                               */
/* ==================================================================== */

/**
 * A working subset of the Uniclass Entities table.
 *
 * Not the whole table — Uniclass is thousands of rows, it is free and
 * maintained at source, and shipping a frozen copy is how a classification
 * goes stale in a codebase. These are the entities a real-estate diligence
 * actually meets, offered as suggestions; the field takes any code, because
 * a product that only accepted its own subset would be back to a private
 * vocabulary with extra steps.
 *
 * Source: Uniclass 2015, NBS. Structured to ISO 12006-2, and correlated with
 * OmniClass through that framework.
 */
export const UNICLASS_ENTITIES: readonly { code: string; title: string }[] = [
  { code: 'En_20_10_30', title: 'Apartment blocks' },
  { code: 'En_20_10_38', title: 'Detached houses' },
  { code: 'En_20_20_53', title: 'Office buildings' },
  { code: 'En_20_20_67', title: 'Retail buildings' },
  { code: 'En_20_20_35', title: 'Hotels' },
  { code: 'En_20_30_45', title: 'Industrial buildings' },
  { code: 'En_20_30_88', title: 'Warehouses' },
  { code: 'En_20_40_36', title: 'Hospitals' },
  { code: 'En_20_40_75', title: 'Schools' },
  { code: 'En_25_10_25', title: 'Car parks' },
  { code: 'En_40_20_70', title: 'Roads' },
  { code: 'En_80_30_80', title: 'Substations' },
  { code: 'En_80_50_84', title: 'Water treatment plants' },
] as const;

/** Loose, because a code typed by hand should be corrected rather than refused. */
export function looksLikeUniclassCode(value: string): boolean {
  return /^[A-Z][a-z]_\d{2}(_\d{2})*$/.test(value.trim());
}
