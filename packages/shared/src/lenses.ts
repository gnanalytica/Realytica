/**
 * The four readers, and what each of them is actually asking.
 *
 * One analysis, four deliverables. A developer, an engineer, an architect and
 * a project manager are all looking at the same site and the same findings,
 * but they are not asking the same question, and a report that answers all
 * four at once answers none of them well — it is the 19,000-pixel document
 * nobody reads to the end.
 *
 * A lens is therefore *not* a theme. It changes what leads, what is folded
 * away, which risks are the reader's to own and which actions are theirs to
 * take. What it must never change is a finding: the same site produces the
 * same risks under every lens, and a lens that could hide a critical risk
 * from the one person able to act on it would be a liability, not a feature.
 * `RESERVED_FOR_EVERYONE` below is what enforces that.
 */

import type { ActionOwner, ActionPriority, DriverCategory, LensKey, RiskCategory } from './types';

/** A section of the case, addressable by a lens. */
export type LensSection =
  | 'value'
  | 'offer'
  | 'costs'
  | 'title'
  | 'compliance'
  | 'planning'
  | 'site'
  | 'constraints'
  | 'documents'
  | 'actions'
  | 'risks'
  | 'evidence';

export interface LensProfile {
  key: LensKey;
  /** What this reader is called, to themselves. */
  label: string;
  /** Who they are, in one line, so a person picking a lens knows if it is theirs. */
  who: string;
  /** The question this reader opens the case to answer. */
  question: string;
  /**
   * Sections in the order this reader wants them. Every section appears in
   * every lens — the order changes, and what is above the fold changes with
   * it. Omitting a section per lens would mean a reader could not reach a
   * finding at all, which is the line this design does not cross.
   */
  sections: LensSection[];
  /** Risk categories this reader is normally the one to act on. */
  ownedRisks: RiskCategory[];
  /** Value drivers this reader can actually move. */
  ownedDrivers: DriverCategory[];
  /** Action owners whose work this reader is coordinating or doing. */
  ownedActions: ActionOwner[];
  /** The action horizon this reader lives in. */
  horizon: ActionPriority[];
}

/**
 * Risk severities nobody may have de-emphasised out of their view.
 *
 * A `critical` finding reaches every lens at the top, whoever owns it. The
 * architect who cannot see that the title is defective will keep drawing.
 */
export const RESERVED_FOR_EVERYONE = ['critical'] as const;

export const LENS_PROFILES: Record<LensKey, LensProfile> = {
  developer: {
    key: 'developer',
    label: 'Developer',
    who: 'You are deciding whether to buy this, and at what number.',
    question: 'Does this deal work, and what should I pay?',
    sections: ['value', 'offer', 'costs', 'risks', 'title', 'compliance', 'planning', 'actions', 'site', 'constraints', 'documents', 'evidence'],
    ownedRisks: ['financial', 'market', 'title', 'tenancy'],
    ownedDrivers: ['market', 'location', 'legal'],
    ownedActions: ['buyer', 'lender', 'valuer', 'seller'],
    horizon: ['now', 'before_offer'],
  },
  engineering: {
    key: 'engineering',
    label: 'Engineering',
    who: 'You are working out whether this can be built, and what building it costs.',
    question: 'Can this site take what we intend to put on it?',
    sections: ['site', 'constraints', 'planning', 'risks', 'compliance', 'documents', 'value', 'costs', 'actions', 'title', 'offer', 'evidence'],
    ownedRisks: ['structural', 'environmental', 'planning'],
    ownedDrivers: ['building', 'location', 'planning'],
    ownedActions: ['surveyor', 'valuer'],
    horizon: ['before_offer', 'before_completion'],
  },
  architect: {
    key: 'architect',
    label: 'Architect',
    who: 'You are establishing what the statute actually permits here.',
    question: 'What envelope can I design inside, and what binds it?',
    sections: ['planning', 'constraints', 'compliance', 'site', 'risks', 'documents', 'value', 'actions', 'title', 'costs', 'offer', 'evidence'],
    ownedRisks: ['planning', 'environmental', 'structural'],
    ownedDrivers: ['planning', 'building', 'location'],
    ownedActions: ['surveyor', 'lawyer'],
    horizon: ['before_offer', 'before_completion'],
  },
  project_manager: {
    key: 'project_manager',
    label: 'Project manager',
    who: 'You are sequencing the approvals, the documents and the dates.',
    question: 'What has to happen next, by when, and who is blocking?',
    sections: ['actions', 'documents', 'compliance', 'risks', 'title', 'planning', 'constraints', 'site', 'costs', 'value', 'offer', 'evidence'],
    ownedRisks: ['data', 'title', 'planning'],
    ownedDrivers: ['legal', 'planning'],
    ownedActions: ['lawyer', 'buyer', 'seller', 'surveyor', 'lender', 'valuer'],
    horizon: ['now', 'before_offer', 'before_completion'],
  },
};

export const LENS_KEYS: LensKey[] = Object.keys(LENS_PROFILES) as LensKey[];

export function lensProfile(key: LensKey): LensProfile {
  return LENS_PROFILES[key];
}

/**
 * The pre-lens `PersonaKey` mapped onto a lens.
 *
 * The old values were written for a demand-side buyer — an investor, an
 * adviser, a valuation firm. The product is for the supply side, so three of
 * the four have no lens that genuinely corresponds and land on `developer`,
 * which is the reading closest to what they were used for. This exists so
 * that cases stored before lenses existed open somewhere sensible, not
 * because the mapping is meaningful.
 */
export function lensFromPersona(persona: string | undefined): LensKey {
  return persona === 'valuation_firm' ? 'project_manager' : 'developer';
}

/**
 * The lens in force for a case.
 *
 * Three sources, most specific first: what the reader chose, what the
 * project kind implies, and — for a case stored before any of this existed —
 * the legacy persona. Never throws and never returns nothing: there is always
 * a reader, even if it is the default one.
 */
export function resolveLens(input: {
  lens?: LensKey;
  defaultLens?: LensKey;
  persona?: string;
}): LensKey {
  return input.lens ?? input.defaultLens ?? lensFromPersona(input.persona);
}

/**
 * Order sections for a reader.
 *
 * Takes the sections a case actually has, rather than the full list, so a
 * case with no site context does not get an empty "Site" heading pushed to
 * the top of the engineering lens. Anything the lens has no opinion about
 * keeps its incoming order, after everything the lens ranked.
 */
export function orderSections(available: LensSection[], lens: LensKey): LensSection[] {
  const ranked = LENS_PROFILES[lens].sections;
  const have = new Set(available);
  const out = ranked.filter(s => have.has(s));
  for (const s of available) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * Split findings into this reader's and everyone else's.
 *
 * `mine` is what they act on; `others` is still returned, never dropped, so
 * the UI can show it folded rather than pretend it does not exist. A critical
 * severity is always `mine` — see `RESERVED_FOR_EVERYONE`.
 */
export function partitionByLens<T extends { category: RiskCategory; severity: string }>(
  items: T[],
  lens: LensKey,
): { mine: T[]; others: T[] } {
  const owned = new Set<RiskCategory>(LENS_PROFILES[lens].ownedRisks);
  const mine: T[] = [];
  const others: T[] = [];
  for (const item of items) {
    if ((RESERVED_FOR_EVERYONE as readonly string[]).includes(item.severity) || owned.has(item.category)) mine.push(item);
    else others.push(item);
  }
  return { mine, others };
}

/** The same split for actions, on owner and horizon rather than category. */
export function partitionActionsByLens<T extends { owner: ActionOwner; priority: ActionPriority }>(
  actions: T[],
  lens: LensKey,
): { mine: T[]; others: T[] } {
  const profile = LENS_PROFILES[lens];
  const owners = new Set<ActionOwner>(profile.ownedActions);
  const horizon = new Set<ActionPriority>(profile.horizon);
  const mine: T[] = [];
  const others: T[] = [];
  for (const action of actions) {
    if (owners.has(action.owner) && horizon.has(action.priority)) mine.push(action);
    else others.push(action);
  }
  return { mine, others };
}
