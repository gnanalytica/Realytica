import type { IntakeField, IntakeProvenance, PropertyIdentity } from '@valytica/shared';

/**
 * The particulars the intake knows how to capture, and what each one is worth.
 *
 * This table is the schema the conversation is allowed to fill. A model cannot
 * add to it: `applyCapture` drops any path that is not declared here, so an
 * agent that decides the property has a `swimmingPool` field writes nothing
 * rather than corrupting the draft.
 *
 * The ordering is the order a person would actually be asked, which is not the
 * order the type declares them. `PropertyIdentity` leads with `label`,
 * `country`, `state` — three things nobody volunteers about their own flat.
 * What a person says first is where it is and what it is, so that is what the
 * intake asks first and what everything else defers to.
 */
export interface IntakeFieldSpec {
  path: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'enum';
  options?: { value: string; label: string }[];
  /** What the screen cannot do, or does worse, without this. Shown to the user. */
  consequence: string;
  /**
   * The screen cannot run at all without this.
   *
   * Measured against the engine rather than assumed: with locality, property
   * type and built-up area it produces an indicative range, five risks and the
   * list of critical documents. Everything else widens or sharpens the answer.
   * Marking a merely-useful field blocking is how an intake becomes the form
   * it was meant to replace.
   */
  blocking?: boolean;
  /** Free-text hint for the model's parser, not shown to the user. */
  parseHint?: string;
}

const PROPERTY_TYPES: { value: string; label: string }[] = [
  { value: 'residential_apartment', label: 'Apartment / flat' },
  { value: 'residential_villa', label: 'Villa / row house' },
  { value: 'residential_plot', label: 'Residential plot / site' },
  { value: 'commercial_office', label: 'Office' },
  { value: 'retail_unit', label: 'Retail unit' },
  { value: 'industrial_warehouse', label: 'Warehouse / industrial' },
  { value: 'land_parcel', label: 'Land parcel' },
];

export const INTAKE_FIELDS: IntakeFieldSpec[] = [
  {
    path: 'locality',
    label: 'Locality',
    kind: 'string',
    blocking: true,
    consequence:
      'Every comparable, the guidance rate and the planning position are looked up by locality. Without it the screen has no market to price against.',
    parseHint: 'A Bengaluru locality name such as Whitefield, Sarjapur Road, Jayanagar, HSR Layout.',
  },
  {
    path: 'propertyType',
    label: 'Property type',
    kind: 'enum',
    options: PROPERTY_TYPES,
    blocking: true,
    consequence:
      'Decides whether value comes from built-up area or from the land itself, and which diligence applies — a site and a flat fail in completely different ways.',
  },
  {
    path: 'builtUpAreaSqm',
    label: 'Built-up area',
    kind: 'number',
    blocking: true,
    consequence: 'The indicative range is a rate times an area. Without an area there is no range.',
    parseHint:
      'Accept square feet or square metres and say which was given. Bengaluru is quoted in sqft; 1 sqm = 10.7639 sqft. Store square metres.',
  },
  {
    path: 'plotAreaSqm',
    label: 'Plot area',
    kind: 'number',
    consequence: 'For a site or villa this is what value is set by. For a flat it is the undivided share, which matters to the title chain but not the rate.',
    parseHint: 'A "30x40 site" is 30ft x 40ft = 1200 sqft = 111.48 sqm.',
  },
  {
    path: 'askingPrice',
    label: 'Asking price',
    kind: 'number',
    consequence:
      'Without it the screen still produces a range, but cannot tell you whether what you are being asked to pay sits inside it — which is usually the actual question.',
    parseHint: 'Indian numbering: "1.2 cr" = 12000000, "85 lakh" / "85L" = 8500000.',
  },
  {
    path: 'city',
    label: 'City',
    kind: 'string',
    consequence: 'Narrows the locality lookup when two cities share a locality name.',
  },
  {
    path: 'addressLine',
    label: 'Address',
    kind: 'string',
    consequence: 'Not used by the screen. Recorded so the case is identifiable later and so a site visit has somewhere to go.',
  },
  {
    path: 'parcelId',
    label: 'Survey number',
    kind: 'string',
    consequence:
      'The key the title chain is traced on. Missing it does not stop a screen, but no document can be reconciled against the land without it.',
    parseHint: 'A Karnataka survey number such as 42/3, 116/2B, or a khata/PID number if that is what they have.',
  },
  {
    path: 'tenure',
    label: 'Tenure',
    kind: 'enum',
    options: [
      { value: 'freehold', label: 'Freehold' },
      { value: 'leasehold', label: 'Leasehold' },
      { value: 'unknown', label: 'Not sure' },
    ],
    consequence: 'A leasehold interest is valued and financed differently, and the residual term becomes the dominant risk.',
  },
  {
    path: 'yearBuilt',
    label: 'Year built',
    kind: 'number',
    consequence: 'Drives the depreciation applied to the replacement-cost anchor, and whether an occupancy certificate should exist.',
  },
  {
    path: 'karnataka.khataType',
    label: 'Khata type',
    kind: 'enum',
    options: [
      { value: 'a_khata', label: 'A khata' },
      { value: 'b_khata', label: 'B khata' },
      { value: 'e_khata', label: 'e-khata' },
      { value: 'gram_panchayat_form_9_11', label: 'Gram panchayat (Form 9/11)' },
      { value: 'none', label: 'No khata' },
      { value: 'unknown', label: 'Not sure' },
    ],
    consequence:
      'The single largest determinant of whether a Bengaluru property is financeable and registrable. B khata blocks most home loans and cannot be regularised on demand.',
  },
  {
    path: 'karnataka.jurisdiction',
    label: 'Jurisdiction',
    kind: 'enum',
    options: [
      { value: 'BBMP', label: 'BBMP' },
      { value: 'BDA', label: 'BDA' },
      { value: 'BMRDA', label: 'BMRDA' },
      { value: 'BIAAPA', label: 'BIAAPA' },
      { value: 'gram_panchayat', label: 'Gram panchayat' },
      { value: 'unknown', label: 'Not sure' },
    ],
    consequence: "Sets whose building and revenue rules apply, and therefore which approvals should exist and which are worthless.",
  },
  {
    path: 'karnataka.landConversionStatus',
    label: 'Land conversion',
    kind: 'enum',
    options: [
      { value: 'converted', label: 'Converted (DC converted)' },
      { value: 'agricultural', label: 'Still agricultural' },
      { value: 'not_applicable', label: 'Not applicable' },
      { value: 'unknown', label: 'Not sure' },
    ],
    consequence:
      'Building on unconverted agricultural land is unlawful and the structure is not regularisable. On the periphery this is the finding that most often kills a deal.',
  },
  {
    path: 'karnataka.areaBasis',
    label: 'Area basis',
    kind: 'enum',
    options: [
      { value: 'carpet', label: 'Carpet' },
      { value: 'built_up', label: 'Built-up' },
      { value: 'super_built_up', label: 'Super built-up' },
      { value: 'unknown', label: 'Not sure' },
    ],
    consequence:
      'Bengaluru quotes super built-up while RERA mandates carpet, a 25-35% difference. Not knowing which basis the area was quoted on makes the rate per sqft incomparable.',
  },
];

const BY_PATH = new Map(INTAKE_FIELDS.map(f => [f.path, f]));

export function fieldSpec(path: string): IntakeFieldSpec | undefined {
  return BY_PATH.get(path);
}

/** Square feet to square metres. Bengaluru quotes sqft; the contract stores sqm. */
export const SQFT_PER_SQM = 10.7639;

/**
 * Coerce a captured value to what its field declares, or reject it.
 *
 * Returns `undefined` for anything that does not fit, which `applyCapture`
 * treats as "this capture did not happen". Silently storing a string where a
 * number belongs would surface much later as a valuation of `NaN`.
 */
export function coerceValue(spec: IntakeFieldSpec, raw: unknown): string | number | boolean | null | undefined {
  if (raw === null) return null;
  switch (spec.kind) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return undefined;
    case 'enum': {
      const s = String(raw);
      return spec.options?.some(o => o.value === s) ? s : undefined;
    }
    case 'string': {
      const s = String(raw).trim();
      return s.length > 0 ? s : undefined;
    }
  }
}

export interface CaptureInput {
  path: string;
  value: unknown;
  provenance: IntakeProvenance;
  basis?: string;
  saidAs?: string;
}

/**
 * Fold captures into the field list.
 *
 * Two rules, both about not letting the conversation quietly overwrite the
 * user:
 *
 *  - An unconfirmed inference never replaces something the user stated. The
 *    model re-inferring `super_built_up` on every turn must not clobber the
 *    `carpet` they typed.
 *  - Re-stating a value re-stamps its provenance, so correcting an inference
 *    by saying the real answer promotes the field to `stated` and clears the
 *    "confirm this" prompt, which is what a person expects to happen.
 */
export function applyCapture(existing: IntakeField[], captures: CaptureInput[], now: string): {
  fields: IntakeField[];
  captured: IntakeField[];
  rejected: { path: string; reason: string }[];
} {
  const byPath = new Map(existing.map(f => [f.path, f]));
  const captured: IntakeField[] = [];
  const rejected: { path: string; reason: string }[] = [];

  for (const c of captures) {
    const spec = BY_PATH.get(c.path);
    if (!spec) {
      rejected.push({ path: c.path, reason: 'not a particular this intake captures' });
      continue;
    }
    const value = coerceValue(spec, c.value);
    if (value === undefined) {
      rejected.push({ path: c.path, reason: `"${String(c.value)}" is not a valid ${spec.kind} for ${spec.label}` });
      continue;
    }
    const prior = byPath.get(c.path);
    const priorIsStated = prior?.provenance === 'stated' || prior?.provenance === 'document' || prior?.confirmed === true;
    if (prior && priorIsStated && c.provenance !== 'stated' && c.provenance !== 'document') {
      rejected.push({ path: c.path, reason: `${spec.label} was already given by the user; an inference may not overwrite it` });
      continue;
    }
    const field: IntakeField = {
      path: c.path,
      label: spec.label,
      value,
      saidAs: c.saidAs,
      provenance: c.provenance,
      basis: c.basis,
      // Stating something is confirming it. Only inferences and defaults wait.
      confirmed: c.provenance === 'stated' || c.provenance === 'document',
      at: now,
    };
    byPath.set(c.path, field);
    captured.push(field);
  }

  return { fields: [...byPath.values()], captured, rejected };
}

/** Read a field's value, or undefined when it has not been captured. */
export function valueOf(fields: IntakeField[], path: string): string | number | boolean | null | undefined {
  const f = fields.find(x => x.path === path);
  return f ? f.value : undefined;
}

/**
 * Assemble the flat field list into the nested identity the engine takes.
 *
 * Everything the intake never asks about is defaulted here, in one visible
 * place, rather than being scattered through the conversation as invented
 * particulars. A default is not a finding: `unknown` enums stay `unknown` so
 * the screen reports them as gaps instead of treating them as answers.
 */
export function draftIdentity(fields: IntakeField[]): PropertyIdentity {
  const s = (p: string, fallback = ''): string => {
    const v = valueOf(fields, p);
    return typeof v === 'string' ? v : fallback;
  };
  const n = (p: string): number | undefined => {
    const v = valueOf(fields, p);
    return typeof v === 'number' ? v : undefined;
  };
  const locality = s('locality');
  const label = [s('addressLine') || locality, locality].filter(Boolean).join(' — ') || 'Untitled case';

  // Narrowed through the field spec's own option list rather than by a bare
  // cast: `coerceValue` already refused anything not in it, so this reads the
  // guarantee that is actually in place instead of asserting a new one.
  const enumOf = <T extends string>(path: string, fallback: T): T => {
    const v = valueOf(fields, path);
    return typeof v === 'string' && fieldSpec(path)?.options?.some(o => o.value === v) ? (v as T) : fallback;
  };

  return {
    label,
    country: 'IN',
    state: 'Karnataka',
    city: s('city', 'Bengaluru'),
    locality,
    addressLine: s('addressLine'),
    postalCode: s('postalCode'),
    parcelId: s('parcelId'),
    propertyType: enumOf<PropertyIdentity['propertyType']>('propertyType', 'residential_apartment'),
    tenure: enumOf<PropertyIdentity['tenure']>('tenure', 'unknown'),
    builtUpAreaSqm: n('builtUpAreaSqm') ?? 0,
    plotAreaSqm: n('plotAreaSqm') ?? 0,
    yearBuilt: n('yearBuilt'),
    askingPrice: n('askingPrice'),
    currency: 'INR',
    karnataka: {
      jurisdiction: enumOf('karnataka.jurisdiction', 'unknown'),
      khataType: enumOf('karnataka.khataType', 'unknown'),
      eKhataIssued: valueOf(fields, 'karnataka.eKhataIssued') === true,
      landConversionStatus: enumOf('karnataka.landConversionStatus', 'unknown'),
      areaBasis: enumOf('karnataka.areaBasis', 'unknown'),
    },
  };
}
