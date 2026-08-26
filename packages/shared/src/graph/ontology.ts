/**
 * The closed ontology behind the title graph, and the normalisation that
 * makes it hold together.
 *
 * Everything in this file is a pure function of its arguments. No clock, no
 * PRNG, no ambient state — `buildTitleGraph` is required to produce a
 * byte-identical graph for the same case on every run, and it can only do
 * that if identity (merge keys), ids and validation are deterministic here
 * first.
 *
 * Three things live in this module because three different consumers need
 * them to agree exactly:
 *
 * 1. **Merge keys.** "Sy. No. 118/2", "Survey Number 118/2" and "SY NO 118/2"
 *    are one parcel; "Sri. Ramaiah S/o Muniyappa" and "RAMAIAH" are one
 *    person. If the builder and the proposal validator normalise differently,
 *    a model-proposed edge that names a node the graph genuinely has would be
 *    rejected as unknown — so both go through `mergeKeyFor` and nothing else
 *    is allowed to invent its own normalisation.
 *
 * 2. **Endpoint rules.** The ontology is closed on kinds *and* on which kinds
 *    an edge may join. `conveyed_to` from a parcel to an approval is not a
 *    slightly-wrong edge, it is a meaningless one; the validator rejects it
 *    rather than storing it and hoping nothing reads it.
 *
 * 3. **The remedy catalogue.** `ResolutionPath.impact` is computed by grouping
 *    findings on the *exact* text they put in `resolvedBy`. That only works if
 *    a chain break and a contradiction that both need the mother deed write
 *    the identical sentence, so the sentences are constants here rather than
 *    prose written at each call site.
 */

import type {
  DocumentKind,
  RiskSeverity,
  TitleEdge,
  TitleEdgeKind,
  TitleGraph,
  TitleNode,
  TitleNodeKind,
} from '../types';

/* ==================================================================== */
/* The closed kind sets                                                  */
/* ==================================================================== */

/**
 * Listed explicitly rather than derived from the union type, because the
 * whole point of `applyEdgeProposals` rejecting an unknown kind is that the
 * check survives to runtime — a TypeScript union does not.
 */
export const TITLE_NODE_KINDS: readonly TitleNodeKind[] = [
  'party',
  'parcel',
  'instrument',
  'authority',
  'encumbrance',
  'approval',
] as const;

export const TITLE_EDGE_KINDS: readonly TitleEdgeKind[] = [
  'conveyed_to',
  'conveyed_by',
  'affects',
  'derives_from',
  'encumbers',
  'issued_by',
  'supersedes',
  'asserts_area',
  'identifies',
] as const;

export function isTitleNodeKind(value: unknown): value is TitleNodeKind {
  return typeof value === 'string' && (TITLE_NODE_KINDS as readonly string[]).includes(value);
}

export function isTitleEdgeKind(value: unknown): value is TitleEdgeKind {
  return typeof value === 'string' && (TITLE_EDGE_KINDS as readonly string[]).includes(value);
}

/**
 * Which node kinds each edge kind is allowed to join, in the direction the
 * contract documents. `undefined` on either side means "any node kind" — used
 * only by `asserts_area`, whose whole purpose is that anything at all may
 * make a claim about a parcel's extent.
 */
export const EDGE_ENDPOINT_RULES: Record<
  TitleEdgeKind,
  { from?: readonly TitleNodeKind[]; to?: readonly TitleNodeKind[] }
> = {
  conveyed_to: { from: ['instrument'], to: ['party'] },
  conveyed_by: { from: ['instrument'], to: ['party'] },
  affects: { from: ['instrument', 'approval', 'encumbrance'], to: ['parcel'] },
  // Instrument-to-instrument is the chain of title; parcel-to-parcel is a
  // subdivision or amalgamation (and is how a built unit is tied to the land
  // parcel it was carved out of).
  derives_from: { from: ['instrument', 'parcel'], to: ['instrument', 'parcel'] },
  encumbers: { from: ['encumbrance'], to: ['parcel'] },
  issued_by: { from: ['approval', 'encumbrance', 'instrument'], to: ['authority'] },
  supersedes: { from: ['instrument'], to: ['instrument'] },
  asserts_area: { to: ['parcel'] },
  // Two nodes judged to be the same real-world thing, so they must at least
  // be the same kind of thing.
  identifies: {},
};

/** True when `kind` may legally join a `fromKind` node to a `toKind` node. */
export function edgeEndpointsValid(kind: TitleEdgeKind, fromKind: TitleNodeKind, toKind: TitleNodeKind): boolean {
  const rule = EDGE_ENDPOINT_RULES[kind];
  if (rule.from && !rule.from.includes(fromKind)) return false;
  if (rule.to && !rule.to.includes(toKind)) return false;
  // `identifies` has no fixed endpoint list, but claiming a party and a parcel
  // are the same real-world thing is nonsense in any ontology.
  if (kind === 'identifies' && fromKind !== toKind) return false;
  return true;
}

/* ==================================================================== */
/* Deterministic hashing & slugs                                         */
/* ==================================================================== */

/**
 * xmur3, the same string hash the scoring engine seeds its PRNG from. It is
 * duplicated rather than imported because `engine.ts` keeps it private, and
 * because the use here is different in kind: nothing random is derived from
 * it. It only disambiguates ids whose readable slug would otherwise collide,
 * so the graph never has to fall back on array position for identity.
 */
function stableHash(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Fixed-width hex digest, used as the collision-proof tail of every graph id. */
export function stableDigest(input: string, length = 6): string {
  return stableHash(input).toString(16).padStart(8, '0').slice(0, length);
}

/** Readable, url-safe fragment of an identifier. Truncated so ids stay legible. */
export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > maxLength ? slug.slice(0, maxLength).replace(/-+$/g, '') : slug;
}

/* ==================================================================== */
/* Merge-key normalisation                                               */
/* ==================================================================== */

/**
 * Noise words a Karnataka parcel reference is written with, in every
 * combination a registrar, a khata clerk and an OCR pass will produce. They
 * carry no information — "Sy. No. 118/2" and "118/2" are the same parcel —
 * so they are removed before comparison.
 *
 * Deliberately absent: `site`, `plot`, `khata`, `flat`. "Site No. 42" and
 * "Sy. No. 42" are genuinely different parcels in the same village and
 * merging them would be a title error, not a tidy-up.
 */
const PARCEL_NOISE_WORDS = /\b(survey|surveys|sy|s\.y|no|nos|number|numbers|bearing)\b/g;

/**
 * Aggressive parcel normalisation.
 *
 * Order matters: punctuation becomes whitespace first so `Sy.No.118/2` splits
 * into words the noise filter can see, but `/` survives because in a survey
 * number the sub-division separator is load-bearing (118/2 and 1182 are not
 * the same parcel). A hyphen between two digits is folded to `/` because
 * registries write 118-2 and 118/2 interchangeably; a hyphen anywhere else
 * (AC-4321) is just punctuation.
 */
export function normaliseParcelKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/(\d)\s*-\s*(\d)/g, '$1/$2')
    .replace(/[^a-z0-9/]+/g, ' ')
    // "S.Y. No. 118/2" has already lost its full stops by this point, leaving
    // two orphaned letters the noise filter would not recognise as the "sy"
    // abbreviation. Rejoin them before filtering.
    .replace(/\bs\s+y\b/g, 'sy')
    .replace(PARCEL_NOISE_WORDS, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '');
}

/**
 * Honorifics and courtesy titles. A Karnataka deed will name the same person
 * as "Sri. Ramaiah", "Sri Ramaiah", "Ramaiah" and "Late Sri Ramaiah" across
 * four documents; none of those prefixes identifies anybody.
 */
const PARTY_HONORIFICS =
  /^(?:(?:sri|shri|smt|srimathi|kum|kumari|mr|mrs|ms|miss|dr|prof|late|thiru|sarvashri|m\/s|messrs|the)\.?\s+)+/;

/**
 * Everything from a relational or descriptive qualifier onwards is dropped.
 * "Ramaiah S/o Muniyappa aged 62 years residing at ..." identifies the same
 * person as "Ramaiah"; keeping the tail means the two never merge, and the
 * tail is about the *father*, not about the party.
 */
const PARTY_QUALIFIER_TAIL =
  /\b(?:s\/o|w\/o|d\/o|c\/o|h\/o|son\s+of|wife\s+of|daughter\s+of|aged|residing|resident|r\/a|r\/o|represented\s+by|rep\.?\s+by|alias)\b.*$/;

/**
 * Party normalisation. Whitespace is removed entirely at the end so that
 * "de Groot" and "deGroot" merge — a space inside a surname is an OCR
 * accident far more often than it is a distinction.
 */
export function normalisePartyKey(raw: string): string {
  let value = raw
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[.,;:()\[\]"'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value.replace(PARTY_QUALIFIER_TAIL, ' ');
  // Applied after the tail is cut, and repeatedly, so "Late Sri Ramaiah"
  // loses both prefixes rather than only the outermost one.
  let previous = '';
  while (previous !== value) {
    previous = value;
    value = value.replace(PARTY_HONORIFICS, '').trim();
  }
  return value
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '');
}

/**
 * The fallback for instruments, authorities, approvals and encumbrances.
 * These are identified by a reference the issuer assigned (a registration
 * number, an OC number, a document id), so there is nothing domain-specific
 * to strip — only case, punctuation and spacing.
 */
export function normaliseGenericKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '');
}

/**
 * The single entry point. Every merge key in the graph — builder-made or
 * proposal-supplied — is produced here, so the two can never disagree about
 * whether a name resolves to an existing node.
 */
export function mergeKeyFor(kind: TitleNodeKind, raw: string): string {
  switch (kind) {
    case 'parcel':
      return normaliseParcelKey(raw);
    case 'party':
      return normalisePartyKey(raw);
    case 'instrument':
    case 'authority':
    case 'encumbrance':
    case 'approval':
    default:
      return normaliseGenericKey(raw);
  }
}

/**
 * A flat, an office floor and a built house are not the land parcel they sit
 * on, and their areas are not comparable with the land's. The ontology has no
 * `building` kind, so the built unit is modelled as its own parcel node
 * carved out of the land parcel (joined by `derives_from`, the contract's
 * subdivision edge), and this suffix keeps the two merge keys distinct while
 * still deriving one from the other.
 */
export function builtUnitMergeKey(landMergeKey: string): string {
  return `${landMergeKey}/builtunit`;
}

/* ==================================================================== */
/* Deterministic ids                                                     */
/* ==================================================================== */

/**
 * Node ids are a function of (kind, merge key) alone — never of iteration
 * order — which is what makes two documents mentioning the same parcel land
 * on the same node without any second pass to reconcile them.
 */
export function titleNodeId(kind: TitleNodeKind, mergeKey: string): string {
  return `node-${kind}-${slugify(mergeKey)}-${stableDigest(`${kind}|${mergeKey}`)}`;
}

/**
 * Edge ids take a discriminator because the same pair of nodes legitimately
 * carries several edges of the same kind: a khata extract and a title deed
 * both `asserts_area` about one parcel, and collapsing them would destroy
 * exactly the disagreement the graph exists to surface.
 */
export function titleEdgeId(kind: TitleEdgeKind, fromNodeId: string, toNodeId: string, discriminator = ''): string {
  return `edge-${kind}-${stableDigest(`${kind}|${fromNodeId}|${toNodeId}|${discriminator}`, 10)}`;
}

/* ==================================================================== */
/* Areas: units, and what an area is an area *of*                        */
/* ==================================================================== */

/**
 * Conversions to square metres. Karnataka paperwork quotes extents in at
 * least six units within a single file — a deed in square feet, a khata in
 * square metres, an old grant in gunthas, an RTC in acres — and comparing two
 * of them without converting first produces a "contradiction" that is really
 * a unit error.
 *
 * Values are exact definitions, not approximations: 1 ft = 0.3048 m exactly,
 * 1 acre = 4840 sq yd, 1 guntha = 1089 sq ft, 1 cent = 1/100 acre.
 */
const AREA_UNIT_TO_SQM: Record<string, number> = {
  sqm: 1,
  m2: 1,
  sqmt: 1,
  sqmtr: 1,
  sqmeter: 1,
  sqmetre: 1,
  sqmeters: 1,
  sqmetres: 1,
  squaremetre: 1,
  squaremeter: 1,
  sqft: 0.09290304,
  ft2: 0.09290304,
  sqfeet: 0.09290304,
  squarefeet: 0.09290304,
  squarefoot: 0.09290304,
  sqyd: 0.83612736,
  yd2: 0.83612736,
  squareyard: 0.83612736,
  gaz: 0.83612736,
  acre: 4046.8564224,
  acres: 4046.8564224,
  hectare: 10000,
  hectares: 10000,
  ha: 10000,
  guntha: 101.17141056,
  gunta: 101.17141056,
  gunthas: 101.17141056,
  cent: 40.468564224,
  cents: 40.468564224,
};

/**
 * Normalises an extracted area to square metres.
 *
 * Returns `undefined` — never a guess — when the value does not parse or the
 * unit is one we have no exact conversion for. A silently assumed unit is the
 * one failure mode that turns this whole module from a title check into a
 * source of false findings, so an unknown unit drops the claim instead.
 *
 * A missing unit is read as square metres, because that is the unit every
 * area field the extractor emits is tagged with; a *present but unrecognised*
 * unit is still rejected.
 */
export function areaToSqm(value: string | number, unit?: string): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (unit === undefined || unit === '') return numeric;
  const key = unit.toLowerCase().replace(/[^a-z0-9]/g, '');
  const factor = AREA_UNIT_TO_SQM[key];
  if (factor === undefined) return undefined;
  return numeric * factor;
}

/**
 * Which physical thing an area figure describes.
 *
 * This is the gate that stops the flagship `area_mismatch` check from firing
 * on a category error. A 145 sqm flat inside a 55 sqm share of land is not a
 * contradiction; it is two correct numbers about two different objects. Areas
 * are only ever compared within one of these buckets.
 */
export type AreaSubject = 'land' | 'built';

/**
 * The five independent area sources the extractor actually produces, plus the
 * two the case record itself carries. Keyed by the exact `ExtractedField.key`
 * so this registry cannot drift from `extractFields`.
 *
 * `landWhenSiteOnly` marks a field whose subject depends on the property: a
 * khata extract for a vacant site assesses the *site* extent, while for a flat
 * it assesses the built-up area. Getting that wrong would either miss a real
 * extent conflict or invent one.
 */
export const AREA_CLAIM_FIELDS: Record<string, { subject: AreaSubject; landWhenSiteOnly?: boolean; what: string }> = {
  /** Title deed — the extent the conveyance schedule describes. */
  extent: { subject: 'land', what: 'extent conveyed by the title deed' },
  /** Mother deed — the extent the parent conveyance described. */
  extentConveyed: { subject: 'land', what: 'extent conveyed by the mother deed' },
  /** Khata extract — assessed extent; the site itself where nothing is built. */
  assessedArea: { subject: 'built', landWhenSiteOnly: true, what: 'area assessed on the khata' },
  /** Floor plan — the drawn envelope. Always about the building. */
  drawnArea: { subject: 'built', what: 'area drawn on the floor plan' },
  /** Kadaster — perceel oppervlakte is by definition the land parcel. */
  perceelOppervlakte: { subject: 'land', what: 'perceel oppervlakte on the Kadaster extract' },
};

/* ==================================================================== */
/* Party-bearing fields                                                  */
/* ==================================================================== */

/**
 * Extraction field keys that name a person or entity, and the role that
 * naming gives them.
 *
 * `party_mismatch` is defined as a register naming a holder no deed conveys
 * to, so the detector needs to know which fields carry names at all and which
 * side of the deed/register line the document sits on. Roles are kept
 * explicit rather than inferred from the document kind because a single
 * instrument can name both a grantor and a grantee.
 */
export type PartyRole = 'grantee' | 'grantor' | 'holder' | 'tenant';

export const PARTY_NAME_FIELDS: Record<string, { role: PartyRole; label: string }> = {
  ownerName: { role: 'grantee', label: 'Registered owner' },
  granteeName: { role: 'grantee', label: 'Grantee' },
  vendeeName: { role: 'grantee', label: 'Purchaser' },
  grantorName: { role: 'grantor', label: 'Grantor' },
  vendorName: { role: 'grantor', label: 'Vendor' },
  sellerName: { role: 'grantor', label: 'Vendor' },
  khataHolderName: { role: 'holder', label: 'Khata holder' },
  assesseeName: { role: 'holder', label: 'Assessee' },
  holderName: { role: 'holder', label: 'Recorded holder' },
  tenantName: { role: 'tenant', label: 'Tenant' },
};

/* ==================================================================== */
/* What each document kind *is*                                          */
/* ==================================================================== */

/**
 * How a document enters the graph.
 *
 * - `instrument` — it does legal work between parties.
 * - `approval`   — it is a permission granted by an authority.
 * - `register`   — it is an authority's record *about* the property. The
 *                  closed ontology has no `record` node kind, so a register
 *                  record enters as the authority that issued it, with the
 *                  document carried on the assertion. That keeps provenance
 *                  intact without inventing a kind the contract forbids.
 * - `none`       — nothing structural to add (a photograph, a valuation).
 *
 * `conveysOwnership` is separate from `instrument` on purpose. A sale
 * agreement and a lease are instruments — they create enforceable rights and
 * belong in the graph — but neither conveys title, so neither may appear as a
 * link in the chain. Treating an agreement to sell as a conveyance is the
 * single most common way a chain of title is read wrongly.
 */
export type DocumentGraphRole = 'instrument' | 'approval' | 'register' | 'none';

export const DOCUMENT_GRAPH_ROLE: Record<DocumentKind, { role: DocumentGraphRole; conveysOwnership: boolean; label: string }> = {
  title_deed: { role: 'instrument', conveysOwnership: true, label: 'Sale / title deed' },
  mother_deed: { role: 'instrument', conveysOwnership: true, label: 'Mother deed' },
  joint_development_agreement: { role: 'instrument', conveysOwnership: true, label: 'Joint development agreement' },
  sale_agreement: { role: 'instrument', conveysOwnership: false, label: 'Agreement to sell' },
  lease_agreement: { role: 'instrument', conveysOwnership: false, label: 'Lease' },
  occupancy_certificate: { role: 'approval', conveysOwnership: false, label: 'Occupancy certificate' },
  commencement_certificate: { role: 'approval', conveysOwnership: false, label: 'Commencement certificate' },
  approved_building_plan: { role: 'approval', conveysOwnership: false, label: 'Approved building plan' },
  sanctioned_plan_bbmp: { role: 'approval', conveysOwnership: false, label: 'BBMP sanctioned plan' },
  conversion_certificate: { role: 'approval', conveysOwnership: false, label: 'DC conversion order' },
  rera_registration: { role: 'approval', conveysOwnership: false, label: 'RERA registration' },
  possession_certificate: { role: 'approval', conveysOwnership: false, label: 'Possession certificate' },
  khata_extract: { role: 'register', conveysOwnership: false, label: 'Khata extract' },
  property_tax_receipt: { role: 'register', conveysOwnership: false, label: 'Property tax record' },
  form_9_11: { role: 'register', conveysOwnership: false, label: 'Gram Panchayat Form 9/11' },
  kadaster_extract: { role: 'register', conveysOwnership: false, label: 'Kadaster extract' },
  woz_assessment: { role: 'register', conveysOwnership: false, label: 'WOZ assessment' },
  encumbrance_certificate: { role: 'register', conveysOwnership: false, label: 'Encumbrance certificate' },
  betterment_charges_receipt: { role: 'register', conveysOwnership: false, label: 'Betterment charges receipt' },
  // A drawing grants nothing, but the ontology has no kind for one and the
  // plan family is where it belongs; `grantsPermission` on the node records
  // the distinction rather than losing it.
  floor_plan: { role: 'approval', conveysOwnership: false, label: 'Floor plan' },
  valuation_report: { role: 'none', conveysOwnership: false, label: 'Valuation report' },
  energy_label: { role: 'none', conveysOwnership: false, label: 'Energy label' },
  photograph: { role: 'none', conveysOwnership: false, label: 'Photograph' },
  other: { role: 'none', conveysOwnership: false, label: 'Other document' },
  unclassified: { role: 'none', conveysOwnership: false, label: 'Unclassified document' },
};

/* ==================================================================== */
/* Severity arithmetic                                                   */
/* ==================================================================== */

/**
 * Findings are weighted, not counted, everywhere they are aggregated —
 * `ResolutionPath.impact` and `integrityScore` both depend on it. Doubling at
 * each step is deliberate: it makes one critical finding worth eight
 * informational ones, which matches how a title lawyer triages and stops a
 * long tail of minor notes from swamping the one thing that actually blocks a
 * transaction.
 */
export const SEVERITY_WEIGHT: Record<RiskSeverity, number> = {
  info: 1,
  warning: 2,
  serious: 4,
  critical: 8,
};

const SEVERITY_ORDER: RiskSeverity[] = ['critical', 'serious', 'warning', 'info'];

/** 0 for the worst severity. Used for deterministic "worst first" ordering. */
export function severityRank(severity: RiskSeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** Picks the harsher of two severities. */
export function worstSeverity(a: RiskSeverity, b: RiskSeverity): RiskSeverity {
  return severityRank(a) <= severityRank(b) ? a : b;
}

/* ==================================================================== */
/* The remedy catalogue                                                  */
/* ==================================================================== */

/**
 * Every remedy a finding may name, as a fixed sentence.
 *
 * `resolutionPaths` computes impact by grouping findings on the exact string
 * they put in `resolvedBy`, so the counterfactual — "obtain this one document
 * and these four findings close" — is only true if two findings needing the
 * same document write the same sentence. Free-text remedies at each call site
 * would silently split one resolution path into four with a quarter of the
 * impact each, which is worse than useless: it would rank the wrong document
 * first.
 *
 * `documentKind` is left undefined where the remedy is not a document the
 * product knows how to file (a surveyor's measurement, for instance) — the
 * path is still computed and ranked, it just cannot be tied to an upload slot.
 */
export interface RemedySpec {
  /** Stated as an instruction, because it lands in `ResolutionPath.obtain`. */
  obtain: string;
  documentKind?: DocumentKind;
}

export const REMEDIES = {
  motherDeed: {
    obtain: 'Obtain the mother deed and link documents, certified, carrying their execution and registration dates',
    documentKind: 'mother_deed',
  },
  registeredConveyance: {
    obtain: 'Obtain the registered conveyance deed that vests title in the present owner',
    documentKind: 'title_deed',
  },
  intermediateConveyance: {
    obtain: 'Obtain the registered instrument, succession certificate or partition deed that carries title across the break in the chain',
    documentKind: 'title_deed',
  },
  certifiedRegisteredCopies: {
    obtain: 'Obtain certified copies of the registered instruments from the jurisdictional Sub-Registrar, showing the registration dates',
    documentKind: 'title_deed',
  },
  thirtyYearEc: {
    obtain: 'Obtain a 30-year encumbrance certificate (Form 15 / Form 16) from the jurisdictional Sub-Registrar',
    documentKind: 'encumbrance_certificate',
  },
  surveyorSketch: {
    obtain: 'Obtain a measurement sketch from a licensed surveyor (tippani, akarband and hissa map) reconciling the extent on the ground',
    documentKind: undefined,
  },
  khataExtract: {
    obtain: 'Obtain the current khata extract and khata certificate from the jurisdictional authority',
    documentKind: 'khata_extract',
  },
  khataMutation: {
    obtain: 'Obtain the khata transfer (mutation) record showing how the register came to name its present holder',
    documentKind: 'khata_extract',
  },
  conversionOrder: {
    obtain: 'Obtain the deputy commissioner conversion order (Section 95) for the survey number',
    documentKind: 'conversion_certificate',
  },
  commencementCertificate: {
    obtain: 'Obtain the dated commencement certificate from the sanctioning authority',
    documentKind: 'commencement_certificate',
  },
  occupancyCertificate: {
    obtain: 'Obtain the dated occupancy certificate from the sanctioning authority',
    documentKind: 'occupancy_certificate',
  },
  kadasterExtract: {
    obtain: 'Obtain a current Kadaster extract (eigendomsinformatie) for the perceel',
    documentKind: 'kadaster_extract',
  },
} as const satisfies Record<string, RemedySpec>;

export type RemedyKey = keyof typeof REMEDIES;

/**
 * Reverse index from remedy sentence back to its key, so `resolutionPaths`
 * can recover a `documentKind` and a stable id from nothing but the string a
 * finding recorded. Built once, at module load, from the catalogue itself —
 * it cannot drift.
 */
type RemedyIndexEntry = { key: RemedyKey; spec: RemedySpec };

const REMEDY_BY_TEXT: Map<string, RemedyIndexEntry> = new Map(
  (Object.keys(REMEDIES) as RemedyKey[]).map((key): [string, RemedyIndexEntry] => [
    REMEDIES[key].obtain,
    { key, spec: REMEDIES[key] },
  ]),
);

export function lookupRemedy(obtainText: string): RemedyIndexEntry | undefined {
  return REMEDY_BY_TEXT.get(obtainText);
}

/* ==================================================================== */
/* Validation                                                            */
/* ==================================================================== */

/**
 * Structural problems a finished graph must never have.
 *
 * Returns a list rather than throwing so `applyEdgeProposals` can use the same
 * rules to explain a rejection to a model, while `assertTitleGraphIntegrity`
 * uses them as an internal assertion. Anything reported here is a builder bug
 * or an accepted-but-wrong proposal, not bad user input.
 */
export function validateTitleGraph(graph: TitleGraph): string[] {
  const problems: string[] = [];
  const byId = new Map<string, TitleNode>();

  for (const node of graph.nodes) {
    if (!isTitleNodeKind(node.kind)) problems.push(`node ${node.id}: kind '${node.kind}' is outside the ontology`);
    if (byId.has(node.id)) problems.push(`node ${node.id}: duplicate node id`);
    if (node.mergeKey === '') problems.push(`node ${node.id}: empty merge key`);
    if (node.assertedBy.length === 0) problems.push(`node ${node.id}: no assertion — every node must say who claims it`);
    byId.set(node.id, node);
  }

  // Two nodes of the same kind sharing a merge key means the merge failed:
  // by definition they are one real-world thing.
  const seenMergeKeys = new Map<string, string>();
  for (const node of graph.nodes) {
    const composite = `${node.kind}|${node.mergeKey}`;
    const existing = seenMergeKeys.get(composite);
    if (existing !== undefined && existing !== node.id) {
      problems.push(`nodes ${existing} and ${node.id}: same kind and merge key but not merged`);
    }
    seenMergeKeys.set(composite, node.id);
  }

  const seenEdgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!isTitleEdgeKind(edge.kind)) {
      problems.push(`edge ${edge.id}: kind '${edge.kind}' is outside the ontology`);
      continue;
    }
    if (seenEdgeIds.has(edge.id)) problems.push(`edge ${edge.id}: duplicate edge id`);
    seenEdgeIds.add(edge.id);
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (!from) problems.push(`edge ${edge.id}: fromNodeId ${edge.fromNodeId} is not a node in this graph`);
    if (!to) problems.push(`edge ${edge.id}: toNodeId ${edge.toNodeId} is not a node in this graph`);
    if (from && to && !edgeEndpointsValid(edge.kind, from.kind, to.kind)) {
      problems.push(`edge ${edge.id}: '${edge.kind}' cannot join a ${from.kind} to a ${to.kind}`);
    }
    if (edge.assertedBy.length === 0) problems.push(`edge ${edge.id}: no assertion — every edge must say who claims it`);
    if (edge.validFrom && edge.validTo && edge.validFrom > edge.validTo) {
      problems.push(`edge ${edge.id}: validFrom ${edge.validFrom} is after validTo ${edge.validTo}`);
    }
  }

  return problems;
}

/** Throws on any structural problem. Mirrors `assertEvidenceIntegrity` in the engine. */
export function assertTitleGraphIntegrity(graph: TitleGraph): void {
  const problems = validateTitleGraph(graph);
  if (problems.length > 0) {
    throw new Error(`Title graph integrity broken: ${problems.join('; ')}`);
  }
}

/* ==================================================================== */
/* Deterministic ordering                                                */
/* ==================================================================== */

/**
 * Total orders over nodes and edges.
 *
 * Insertion order depends on the order documents happen to arrive in, which
 * is not part of the case's meaning. Sorting on intrinsic properties before
 * returning is what makes "the same case produces a byte-identical graph"
 * true rather than merely usually true.
 */
export function compareNodes(a: TitleNode, b: TitleNode): number {
  const kindOrder = TITLE_NODE_KINDS.indexOf(a.kind) - TITLE_NODE_KINDS.indexOf(b.kind);
  if (kindOrder !== 0) return kindOrder;
  if (a.mergeKey !== b.mergeKey) return a.mergeKey < b.mergeKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compareEdges(a: TitleEdge, b: TitleEdge): number {
  const kindOrder = TITLE_EDGE_KINDS.indexOf(a.kind) - TITLE_EDGE_KINDS.indexOf(b.kind);
  if (kindOrder !== 0) return kindOrder;
  if (a.fromNodeId !== b.fromNodeId) return a.fromNodeId < b.fromNodeId ? -1 : 1;
  if (a.toNodeId !== b.toNodeId) return a.toNodeId < b.toNodeId ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
