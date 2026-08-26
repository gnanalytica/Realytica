/**
 * What Realytica is allowed to say about a property to something outside it.
 *
 * The web-search agents were built to one rule, stated once in
 * `market-research.ts` and repeated in `explorer.ts`: the address, owner
 * name, price and document contents must never reach a web search. So they
 * research the *locality* — the market, the corridor, the infrastructure —
 * and never the property.
 *
 * That rule is right for a demand-side buyer, where knowing which property
 * someone is looking at leaks their intent to whoever is watching the query.
 * It is too strict for a developer screening an acquisition, because the
 * things they most need found — the K-RERA registration, a de-notification,
 * a pending writ naming the survey number — are public records that can only
 * be found by searching for the property itself.
 *
 * So the rule becomes a stated choice rather than a constant. Each level
 * below names exactly what leaves the system, what it makes findable, and
 * what it costs. The choice is recorded on the case and stamped on every
 * finding it produced, so a year later it is still possible to say what was
 * disclosed to find any given fact.
 *
 * Three things are withheld at *every* level and are not negotiable here:
 * the owner's name, the price, and the contents of any document. Those are
 * the deal and the paperwork, not the property, and nothing about searching
 * for a parcel requires them.
 */

export type DisclosureLevel = 'locality_only' | 'property_identifiers' | 'full_address';

export interface DisclosureDescriptor {
  level: DisclosureLevel;
  label: string;
  /** One line: who this level is right for. */
  who: string;
  /** Exactly what leaves the system at this level. Rendered to the user verbatim. */
  sends: string[];
  /** What this level makes findable that the level below does not. */
  unlocks: string[];
  /** What choosing it costs. Stated even for the default, which also has one. */
  cost: string;
}

/** Withheld at every level, regardless of what the user chooses. */
export const NEVER_DISCLOSED: string[] = [
  "The owner's or seller's name",
  'The asking price and any figure you have negotiated',
  'The contents of any document you have uploaded',
  'Your own identity, and the fact that you are looking at this property',
];

export const DISCLOSURE_LEVELS: Record<DisclosureLevel, DisclosureDescriptor> = {
  locality_only: {
    level: 'locality_only',
    label: 'Locality only',
    who: 'The safe default. Nothing identifying this specific parcel ever leaves.',
    sends: [
      'The city and locality',
      'The property type and its areas',
      'Nothing that identifies which property in that locality',
    ],
    unlocks: [
      'Market rates, corridor and infrastructure news, comparable-set context',
    ],
    cost:
      'Anything recorded against this specific parcel — its RERA registration, a de-notification, a writ naming the ' +
      'survey number — cannot be found, because finding it requires searching for it.',
  },
  property_identifiers: {
    level: 'property_identifiers',
    label: 'Property identifiers',
    who: 'A developer or adviser screening a site, where the parcel is a public record anyway.',
    sends: [
      'Everything the locality level sends',
      'The survey number',
      'The khata or PID, and the jurisdiction and conversion status',
      'The case label you wrote — check it does not contain more than you mean to send',
    ],
    unlocks: [
      'K-RERA project registration and its status',
      'BDA/BMRDA notification and de-notification lists naming the survey number',
      'Court and tribunal listings that name the parcel',
      'News and filings about the project or the layout',
    ],
    cost:
      'A survey number is a public record, but a search for one is visible to whoever runs the search index. Someone ' +
      'watching that traffic learns which parcel is being looked at — not who is looking, but that somebody is.',
  },
  full_address: {
    level: 'full_address',
    label: 'Full address',
    who: 'When the parcel is not findable by survey number alone and the address is the only handle.',
    sends: [
      'Everything the identifiers level sends',
      'The street address and postal code',
    ],
    unlocks: [
      'Listings, project microsites and press that name the address but not the survey number',
      'Municipal notices and civic complaints filed against the address',
    ],
    cost:
      'The most specific handle there is. An address plus a timestamp is enough for an interested party to infer that ' +
      'a transaction is being contemplated. Choose this when the alternative is not finding the thing at all.',
  },
};

export const DISCLOSURE_ORDER: DisclosureLevel[] = ['locality_only', 'property_identifiers', 'full_address'];

export function disclosureDescriptor(level: DisclosureLevel): DisclosureDescriptor {
  return DISCLOSURE_LEVELS[level];
}

/** Is `level` at least as permissive as `required`? */
export function disclosureAllows(level: DisclosureLevel, required: DisclosureLevel): boolean {
  return DISCLOSURE_ORDER.indexOf(level) >= DISCLOSURE_ORDER.indexOf(required);
}

/**
 * The level in force for a case.
 *
 * Absent means nobody has chosen, and the answer is the safe default — never
 * the permissive one. A disclosure setting that could be reached by omission
 * would not be a choice.
 */
export function resolveDisclosure(level: DisclosureLevel | undefined): DisclosureLevel {
  return level ?? 'locality_only';
}
