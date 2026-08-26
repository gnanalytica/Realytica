/**
 * What is worth looking for outside Realytica, and what each disclosure level
 * lets us look for.
 *
 * Deliberately model-free, and in `shared` rather than in the agent, for the
 * same reason the intake readout is: a model must not be the thing that
 * decides which record kinds matter or which ones a disclosure level permits.
 * It decides how to phrase a query and how to read a result. Everything about
 * *what is allowed and what is at stake* is settled here, deterministically,
 * and works with no credentials configured at all.
 *
 * That split also means the sweep degrades honestly. With no model available
 * the plan still runs and the case still shows what would have been searched
 * for, what each level gates, and what is going unchecked — which is a real
 * answer, and a different one from an empty list.
 */

import { disclosureAllows } from './disclosure';
import type { DisclosureLevel } from './disclosure';
import type { DiscoveryGate, DiscoveryRecordKind, PropertyIdentity } from './types';

export interface DiscoveryPlanItem {
  kind: DiscoveryRecordKind;
  label: string;
  /** The question this record kind answers about a property. */
  answers: string;
  /** The narrowest disclosure level that can find it. */
  needs: DisclosureLevel;
  /** What goes unchecked if it is not looked for. */
  consequence: string;
  /**
   * How to phrase the search, as a template over the identifiers. The agent
   * fills it; it does not invent its own targets. `{}` placeholders are
   * substituted from what the disclosure level permits, and an item whose
   * placeholders cannot all be filled is skipped rather than searched with a
   * hole in it.
   */
  queryTemplates: string[];
}

/**
 * Every record kind worth a search, in the order they matter.
 *
 * Ordering is not cosmetic: a sweep is bounded, and the first items are the
 * ones that can stop a transaction outright. A listing tells you what someone
 * is asking; a de-notification tells you the land may not be yours to build
 * on.
 */
export const DISCOVERY_PLAN: DiscoveryPlanItem[] = [
  {
    kind: 'litigation',
    label: 'Court and tribunal matters',
    answers: 'Is this parcel, or the title to it, the subject of a pending or decided case?',
    needs: 'property_identifiers',
    consequence:
      'A pending suit over the title is the single most expensive thing to discover after completion, and it is a ' +
      'public listing — an encumbrance certificate will not show it unless it was registered.',
    queryTemplates: [
      'survey number {parcelId} {locality} Bengaluru court case land dispute',
      '"{parcelId}" Karnataka High Court OR civil court property suit',
    ],
  },
  {
    kind: 'planning_notification',
    label: 'Acquisition and de-notification',
    answers: 'Has a development authority notified this land for acquisition, or de-notified it?',
    needs: 'property_identifiers',
    consequence:
      'Land under a live acquisition notification cannot be sold clean, and a de-notified parcel carries a history ' +
      'that lenders and later buyers will ask about. Neither appears on a khata.',
    queryTemplates: [
      'BDA OR BMRDA notification denotification survey number {parcelId} {locality}',
      '{locality} Bengaluru land acquisition notification survey {parcelId}',
    ],
  },
  {
    kind: 'rera_registration',
    label: 'RERA registration',
    answers: 'Is the project registered with the state authority, and what does the registration say about it?',
    needs: 'property_identifiers',
    consequence:
      'An unregistered project cannot legally be marketed or sold, and a registration carries the promised ' +
      'completion date the developer is held to.',
    queryTemplates: [
      'K-RERA registration "{projectName}" {locality} Bengaluru',
      'Karnataka RERA project {locality} survey {parcelId}',
    ],
  },
  {
    kind: 'municipal_notice',
    label: 'Municipal notices',
    answers: 'Has the municipality issued a notice, order or demolition action against this property?',
    needs: 'full_address',
    consequence:
      'A demolition or deviation notice against the address is served on the property, not the owner — it survives ' +
      'a sale and becomes the buyer’s problem.',
    queryTemplates: ['BBMP notice OR demolition "{addressLine}" {locality}'],
  },
  {
    kind: 'developer_track_record',
    label: 'Developer track record',
    answers: 'What has this developer completed, delayed or abandoned elsewhere?',
    needs: 'property_identifiers',
    consequence:
      'On a joint development or an under-construction purchase the developer’s record is the counterparty risk, ' +
      'and it is the part no document in the file speaks to.',
    queryTemplates: ['"{projectName}" developer Bengaluru delayed OR completed OR complaint'],
  },
  {
    kind: 'news',
    label: 'Press and filings',
    answers: 'What has been written about this project, this layout or this corridor?',
    needs: 'locality_only',
    consequence: 'Corridor-level reporting is where infrastructure timelines and rezoning first surface.',
    queryTemplates: ['{locality} Bengaluru {propertyType} market infrastructure news'],
  },
  {
    kind: 'listing',
    label: 'Listings',
    answers: 'What is being asked for comparable stock right now?',
    needs: 'locality_only',
    consequence: 'Asking prices are a claim by a seller, not evidence of value — useful only as a sanity check.',
    queryTemplates: ['{locality} Bengaluru {propertyType} for sale price'],
  },
];

/**
 * The project name, as far as we can honestly derive one.
 *
 * Taken from the case label, which the user wrote, by stripping the leading
 * unit descriptor and the trailing locality. Returns `undefined` rather than
 * a guess when nothing survives — a query built around an empty project name
 * searches for the locality and reports the result as if it were about the
 * project.
 */
export function projectNameFrom(identity: PropertyIdentity): string | undefined {
  const label = identity.label ?? '';
  // "3BHK — Prestige Lakeside Habitat, Whitefield" -> "Prestige Lakeside Habitat"
  const afterDash = label.includes('—') ? label.slice(label.indexOf('—') + 1) : label;
  const beforeComma = afterDash.split(',')[0] ?? '';
  const cleaned = beforeComma.trim();
  if (cleaned.length < 4) return undefined;
  if (identity.locality && cleaned.toLowerCase() === identity.locality.toLowerCase()) return undefined;
  return cleaned;
}

/** The identifier substitutions a disclosure level permits. */
export function discoveryTokens(identity: PropertyIdentity, level: DisclosureLevel): Record<string, string | undefined> {
  const tokens: Record<string, string | undefined> = {
    locality: identity.locality || undefined,
    propertyType: identity.propertyType.replace(/_/g, ' '),
  };
  if (disclosureAllows(level, 'property_identifiers')) {
    tokens.parcelId = identity.parcelId || undefined;
    tokens.projectName = projectNameFrom(identity);
  }
  if (disclosureAllows(level, 'full_address')) {
    tokens.addressLine = identity.addressLine || undefined;
  }
  return tokens;
}

/** Fill a template, or return undefined when any placeholder has no value. */
export function fillQuery(template: string, tokens: Record<string, string | undefined>): string | undefined {
  let missing = false;
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = tokens[key];
    if (!value) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? undefined : filled.replace(/\s+/g, ' ').trim();
}

export interface DiscoveryPlan {
  /** Items that can be searched at this level, with their queries filled in. */
  searchable: { item: DiscoveryPlanItem; queries: string[] }[];
  /** Items the level forbids, and what would unlock them. */
  gated: DiscoveryGate[];
  /**
   * Items the level permits but whose queries could not be built, because the
   * identifier they need is not on the case. Distinct from gated: widening
   * disclosure will not help, supplying the survey number will.
   */
  missingIdentifiers: { kind: DiscoveryRecordKind; needs: string }[];
}

/**
 * What this sweep can and cannot look for, before any model runs.
 *
 * Three outcomes per record kind, and they are three different problems:
 * searchable, gated by the disclosure level, or blocked by an identifier the
 * case does not carry. Collapsing them would leave a user widening disclosure
 * to fix a missing survey number.
 */
export function planDiscovery(identity: PropertyIdentity, level: DisclosureLevel): DiscoveryPlan {
  const tokens = discoveryTokens(identity, level);
  const searchable: DiscoveryPlan['searchable'] = [];
  const gated: DiscoveryGate[] = [];
  const missingIdentifiers: DiscoveryPlan['missingIdentifiers'] = [];

  for (const item of DISCOVERY_PLAN) {
    if (!disclosureAllows(level, item.needs)) {
      gated.push({ kind: item.kind, needs: item.needs, consequence: item.consequence });
      continue;
    }
    const queries = item.queryTemplates.map(t => fillQuery(t, tokens)).filter((q): q is string => q !== undefined);
    if (queries.length === 0) {
      const needed = item.queryTemplates
        .flatMap(t => [...t.matchAll(/\{(\w+)\}/g)].map(m => m[1]))
        .filter(key => !tokens[key]);
      missingIdentifiers.push({
        kind: item.kind,
        needs: [...new Set(needed)].map(k => (k === 'parcelId' ? 'the survey number' : k === 'projectName' ? 'a project name' : k === 'addressLine' ? 'the street address' : k)).join(' and '),
      });
      continue;
    }
    searchable.push({ item, queries });
  }

  return { searchable, gated, missingIdentifiers };
}
