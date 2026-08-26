/**
 * The record provider port — fetching statutory property records from a
 * vendor instead of waiting for someone to upload them.
 *
 * Mirrors the place provider next door and the LLM provider beside that, for
 * the third time and the same reason: the product must run, and run honestly,
 * when nobody has set a key. Every method returns an outcome that can say "I
 * could not get this, and here is what that leaves unknown" rather than
 * throwing, so a caller never has to choose between a crash and an empty
 * result that reads as "there is nothing recorded".
 *
 * --- Why this port exists at all ------------------------------------------
 *
 * `sources/registry.ts` is emphatic that the authoritative Karnataka
 * registries — Kaveri for registration and encumbrance, Bhoomi for revenue
 * records, the BBMP portals for khata and tax — sit behind logins, OTPs and
 * CAPTCHAs with no supported machine interface, and that automated access is
 * neither authorised nor achievable. None of that changes here. This port
 * does not scrape a registry.
 *
 * What it does is give the two legitimate routes a shape:
 *
 *  1. A commercial aggregator with an API and a contract. Several exist; the
 *     registry already declares one. An aggregator is a convenience layer
 *     over the registry, never an independent authority — and this port
 *     enforces that by tagging everything it returns as `secondary`, so a
 *     discrepancy against the Sub-Registrar record resolves against the
 *     aggregator every time.
 *  2. The operator downloading the record themselves and supplying the file.
 *     Already the supported route, and made first-class here rather than
 *     treated as the fallback for a failed fetch — a human passing a CAPTCHA
 *     and handing over a PDF is not a workaround, it is how this works.
 *
 * --- What a provider must never do ----------------------------------------
 *
 * Return a record it did not receive. An empty encumbrance certificate and a
 * failed fetch look identical downstream unless the port distinguishes them,
 * and confusing the two turns "we could not check" into "nothing is
 * registered against this title" — which is the single most dangerous
 * sentence this product could utter. Hence `RecordOutcome`'s gap arm carries
 * a reason and a manual route, and `nil_result` is a distinct, deliberate
 * outcome from `unavailable`.
 */

import type { DocumentKind } from '@realytica/shared';

/** What kind of statutory record is being asked for. */
export type RecordKind =
  /** Encumbrance certificate — the registered charge history over a period. */
  | 'encumbrance_certificate'
  /** A registrar-certified copy of one registered instrument. */
  | 'certified_instrument'
  /** Record of rights / RTC / 7-12 — the revenue record for agricultural land. */
  | 'record_of_rights'
  /** Mutation record — the transfer entry in the municipal or revenue register. */
  | 'mutation'
  /** Khata extract or certificate from the municipal register. */
  | 'khata_extract'
  /** Property tax paid statement. */
  | 'property_tax'
  /** Survey map / field measurement book sketch. */
  | 'survey_map';

/** The document kind a fetched record becomes once it is on the case. */
export const RECORD_DOCUMENT_KIND: Record<RecordKind, DocumentKind> = {
  encumbrance_certificate: 'encumbrance_certificate',
  certified_instrument: 'title_deed',
  record_of_rights: 'other',
  mutation: 'other',
  khata_extract: 'khata_extract',
  property_tax: 'property_tax_receipt',
  survey_map: 'other',
};

export interface RecordCapabilities {
  /** Which record kinds this provider can fetch at all. */
  kinds: RecordKind[];
  /** Which states or regions it covers, as the vendor states them. */
  regions: string[];
  /**
   * True when the provider can watch a record and report changes — the thing
   * that turns a one-off encumbrance search into a monitor. Declared rather
   * than assumed, because a provider that can fetch but not watch is a
   * legitimate provider and the caller must degrade a named feature.
   */
  monitor: boolean;
}

export interface RecordRequest {
  kind: RecordKind;
  /** Survey number, khata/PID, or whatever handle the vendor keys on. */
  identifiers: {
    parcelId?: string;
    khataOrPid?: string;
    state: string;
    district?: string;
    locality?: string;
  };
  /** Lookback for a period-based record like an encumbrance certificate. */
  period?: { fromYear: number; toYear: number };
}

/**
 * Why a record could not be produced, and what a person can do instead.
 *
 * `nil_result` is deliberately NOT in here: a genuine nil encumbrance is a
 * *result*, and one of the most valuable this product can obtain. Putting it
 * among the failures is precisely the conflation this port exists to stop.
 */
export type RecordGapReason =
  /** No provider is configured in this deployment. */
  | 'not_configured'
  /** A provider exists but does not cover this record kind or this state. */
  | 'out_of_coverage'
  /** The vendor was reachable and refused — auth, quota, or a policy block. */
  | 'refused'
  /** The vendor was unreachable, or timed out. */
  | 'unreachable'
  /** The request lacked an identifier the vendor requires. */
  | 'insufficient_identifiers';

export interface RecordGap {
  reason: RecordGapReason;
  /** What was being asked for. */
  kind: RecordKind;
  /** What is now unknown because this did not arrive. Shown to the user. */
  leavesUnknown: string;
  /** How a person gets it by hand. Always present — there is always a way. */
  manualRoute: string;
  /** Vendor-side detail, when there is any worth keeping. */
  detail?: string;
}

/**
 * A record that was actually obtained.
 *
 * `authority` is the field that keeps an aggregator honest: `secondary` means
 * this came from a convenience layer over the register, and a discrepancy
 * against the register itself is resolved against this copy.
 */
export interface FetchedRecord {
  kind: RecordKind;
  /** The vendor that produced it. */
  providerId: string;
  /** Where the content ultimately comes from. */
  authority: 'primary_register' | 'secondary';
  /** ISO date the vendor says the record was generated. */
  issuedAt?: string;
  /** ISO instant we received it. */
  retrievedAt: string;
  /** The bytes, when the vendor returns a document. */
  content?: { bytes: Uint8Array; contentType: string; fileName: string };
  /**
   * True when the search ran and the register holds nothing for this parcel
   * over this period. A real and valuable answer — never conflated with a
   * failure to search, which is a `RecordGap`.
   */
  nilResult?: boolean;
  /** What the vendor says about what it searched. Kept for the audit trail. */
  coverageNote?: string;
}

export type RecordOutcome = { ok: true; record: FetchedRecord } | { ok: false; gap: RecordGap };

export function recordOk(record: FetchedRecord): RecordOutcome {
  return { ok: true, record };
}

export function recordGap(gap: RecordGap): RecordOutcome {
  return { ok: false, gap };
}

export interface RecordProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: RecordCapabilities;
  /**
   * False when the provider exists but has no credentials. Separate from
   * `capabilities` for the same reason as on the place port: "this vendor
   * does not do RTCs" and "nobody has signed a contract yet" are different
   * facts needing different sentences.
   */
  readonly configured: boolean;
  /**
   * What the vendor is, in the user's terms, and what its output is worth.
   * Rendered wherever a fetched record is shown, so nobody mistakes an
   * aggregator's copy for the register.
   */
  readonly standing: string;

  fetch(request: RecordRequest): Promise<RecordOutcome>;
}
