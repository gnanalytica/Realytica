/**
 * The thing photographs are taken ON.
 *
 * Until this existed, forty shots from one morning on site were forty
 * unrelated attachments that happened to share a date. Everything a reader
 * wants to know about them is a property of the VISIT, not of any one file:
 * who went, when, what they could and could not get to, and what the weather
 * was doing when they looked at the roof.
 *
 * That last one is not decoration. A condition inspection carried out in heavy
 * rain cannot report on ponding, and one carried out on a Sunday cannot report
 * on how the plant runs under load. RICS asks a surveyor to record the
 * limitations of an inspection precisely because a report that omits them
 * reads as more complete than it is — the reader has no way to tell "no defect
 * found" from "could not get onto the roof".
 *
 * ## Why it is its own record rather than a field on a photograph
 *
 * Three reasons, and the third is the real one:
 *
 * 1. The facts are about the visit, so repeating them on forty attachments is
 *    forty chances to disagree.
 * 2. A visit exists even when nobody photographed anything — "we went, the
 *    gate was locked, we saw nothing" is one of the more consequential things
 *    a diligence file can record, and it has no attachment to hang off.
 * 3. A valuation cites an INSPECTION DATE, and that date has to be a fact
 *    somebody can check rather than the minimum of some EXIF timestamps.
 *    `indicative_valuation.dates` already records it and computes the gap to
 *    the valuation date; this is the record that date is supposed to name.
 */

import type { CapturePurpose } from './capture';

/** What could not be seen, in the surveyor's own words plus a reason code. */
export type VisitLimitationKind =
  | 'no_access'
  | 'occupied'
  | 'weather'
  | 'concealed'
  | 'height'
  | 'services_off'
  | 'time'
  | 'other';

export const VISIT_LIMITATION_LABEL: Record<VisitLimitationKind, string> = {
  no_access: 'No access',
  occupied: 'Occupied — could not enter',
  weather: 'Weather prevented inspection',
  concealed: 'Concealed by finishes or stored goods',
  height: 'Out of reach — no access equipment',
  services_off: 'Services isolated — could not be tested',
  time: 'Insufficient time on site',
  other: 'Other',
};

export interface VisitLimitation {
  kind: VisitLimitationKind;
  /** What specifically could not be seen. "Roof — no ladder", not "some areas". */
  what: string;
}

export type SiteVisitStatus = 'planned' | 'completed' | 'aborted';

export interface SiteVisitRecord {
  id: string;
  title: string;
  purpose: CapturePurpose;
  /** ISO date. A planned visit carries a future one; that is the point of `planned`. */
  visitedOn: string;
  status: SiteVisitStatus;
  /** Who actually attended. A name, because a report has to say who looked. */
  surveyor: string;
  accompaniedBy?: string;
  weather?: string;
  notes?: string;
  /**
   * What could not be inspected. An EMPTY array is a claim — it says the
   * surveyor saw everything — so the UI must distinguish "none recorded" from
   * "none", and `visitCoverage` reports which of the two this is.
   */
  limitations: VisitLimitation[];
  assetIds: string[];
  assessmentIds: string[];
  /** Findings raised off this visit. */
  findingIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSiteVisitInput {
  title: string;
  purpose: CapturePurpose;
  visitedOn: string;
  surveyor: string;
  status?: SiteVisitStatus;
  accompaniedBy?: string;
  weather?: string;
  notes?: string;
  limitations?: VisitLimitation[];
  assetIds?: string[];
  assessmentIds?: string[];
}

export interface PatchSiteVisitInput {
  title?: string;
  purpose?: CapturePurpose;
  visitedOn?: string;
  surveyor?: string;
  status?: SiteVisitStatus;
  accompaniedBy?: string;
  weather?: string;
  notes?: string;
  limitations?: VisitLimitation[];
  assetIds?: string[];
  assessmentIds?: string[];
}
