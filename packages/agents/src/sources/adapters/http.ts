/**
 * HTTP ingestion — and only for sources the registry classifies `open`.
 *
 * The constraint this file is built around is that **it must be almost
 * impossible to point at a gated portal by accident.** A generic "fetch a
 * URL" helper sitting in an agent codebase is one careless caller away from
 * hitting Kaveri, so the entry point takes a `RegisteredSource` rather than a
 * URL, refuses anything not classified `open` *before* constructing a request,
 * and reports `networkAttempted: false` so a caller can prove nothing left the
 * machine. The harness asserts exactly that.
 *
 * The other three rules, each with a reason:
 *
 * - **One attempt, no retries.** A public register that refused us is not more
 *   likely to agree 200 ms later, and a retry loop is the mechanism by which a
 *   well-meaning client becomes an abusive one. A transient failure surfaces as
 *   `unreachable` with the real reason and the operator can run the ingestion
 *   again if they want to.
 * - **A hard timeout.** An ingestion that hangs blocks the case; a bounded wait
 *   that fails honestly does not.
 * - **Never throws.** Every failure path — DNS, TLS, proxy, timeout, a 500, an
 *   XML exception report where JSON was expected — comes back as an
 *   `unreachable` result carrying the real reason. An adapter that throws makes
 *   "the source was down" indistinguishable from "the ingestion crashed", and
 *   those call for completely different responses from the user.
 *
 * At the time of writing the only `open` sources are the two Dutch PDOK
 * services. Both were exercised live from this workspace; both take OGC Filter
 * Encoding 2.0 rather than the GeoServer `CQL_FILTER` parameter, which they
 * accept and then *ignore* — a filter typo there returns the wrong parcel with
 * a 200 OK, which is the most dangerous failure mode available to a register
 * client, so the filter is built as FE 2.0 XML and nothing else.
 */

import type { IngestedRecord, PropertyIdentity } from '@valytica/shared';
import type { RejectedRow } from '../normalise';
import { normaliseRows } from '../normalise';
import type { CaseDerivedKey, RegisteredSource, WfsEndpointSpec } from '../registry';

/* ------------------------------------------------------------------ */
/* Injectable fetch                                                    */
/* ------------------------------------------------------------------ */

/**
 * The narrowest shape of `fetch` this adapter uses.
 *
 * Declared structurally rather than by referencing the DOM lib so the package
 * keeps its `lib: ES2022` tsconfig, and — the reason that actually matters —
 * so a test can pass a counting stub and prove no request was made.
 */
export interface FetchLike {
  (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      redirect?: 'follow' | 'error' | 'manual';
    },
  ): Promise<FetchLikeResponse>;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * A truthful User-Agent.
 *
 * It says what the client is, that it makes one bounded request, and that it
 * does not crawl — all three true. Impersonating a browser would get through
 * more doors and is exactly the behaviour that gets a whole class of tool
 * blocked; a server operator who wants to refuse this client should be able to.
 */
export const USER_AGENT = 'Valytica/0.1.0 (property-diligence tool; one bounded request per source per case; no crawling)';

export const DEFAULT_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Case-derived query keys                                             */
/* ------------------------------------------------------------------ */

/**
 * Everything a query can send to a third party, derived from the case.
 *
 * Kept as one small function so the disclosure surface is auditable in a
 * glance: a postcode, a house number and a cadastral designation leave the
 * machine, and nothing else does — no owner name, no price, no document
 * content.
 */
export function deriveCaseKeys(identity: PropertyIdentity): Partial<Record<CaseDerivedKey, string>> {
  const keys: Partial<Record<CaseDerivedKey, string>> = {};

  const postcode = (identity.postalCode ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^\d{4}[A-Z]{2}$/.test(postcode)) keys.nl_postcode = postcode;

  const addressWithoutPostcode = (identity.addressLine ?? '').replace(/\d{4}\s?[A-Za-z]{2}/g, ' ');
  const houseNumber = addressWithoutPostcode.match(/\b(\d{1,5})\b/);
  if (houseNumber) keys.nl_house_number = houseNumber[1];

  // Kadastrale aanduiding: `<GEMEENTE> <SECTIE> <NUMMER>`, e.g. `AMSTERDAM P 8765`.
  const aanduiding = (identity.parcelId ?? '').trim().match(/^(.+?)\s+([A-Za-z]{1,2})\s+(\d+)$/);
  if (aanduiding) {
    keys.nl_kadastrale_gemeente = titleCase(aanduiding[1]);
    keys.nl_sectie = aanduiding[2].toUpperCase();
    keys.nl_perceelnummer = aanduiding[3].replace(/^0+(?=\d)/, '');
  }

  return keys;
}

/**
 * `AMSTERDAM` -> `Amsterdam`, which is how the Kadaster publishes the
 * kadastrale gemeente. Imperfect for names with internal punctuation
 * (`'s-Gravenhage`), which is why a miss reports `no_match` with the value
 * tried rather than pretending the parcel does not exist.
 */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();
}

/* ------------------------------------------------------------------ */
/* WFS request construction                                            */
/* ------------------------------------------------------------------ */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** OGC Filter Encoding 2.0 — an `And` of equality predicates, or a single one. */
export function buildWfsFilter(predicates: { attribute: string; value: string }[]): string {
  const clauses = predicates
    .map(p => `<fes:PropertyIsEqualTo><fes:ValueReference>${xmlEscape(p.attribute)}</fes:ValueReference><fes:Literal>${xmlEscape(p.value)}</fes:Literal></fes:PropertyIsEqualTo>`)
    .join('');
  const body = predicates.length > 1 ? `<fes:And>${clauses}</fes:And>` : clauses;
  return `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">${body}</fes:Filter>`;
}

export function buildWfsUrl(spec: WfsEndpointSpec, predicates: { attribute: string; value: string }[]): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: spec.typeName,
    outputFormat: 'application/json',
    count: String(spec.count),
    FILTER: buildWfsFilter(predicates),
  });
  return `${spec.baseUrl}?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

export interface HttpAttemptResult {
  outcome: 'ingested' | 'no_match' | 'unreachable' | 'skipped';
  records: IngestedRecord[];
  rejected: RejectedRow[];
  note: string;
  /** The URL requested, present only when a request was actually issued. */
  requestedUrl?: string;
  /** Proof, for the caller and the report, of whether anything left the machine. */
  networkAttempted: boolean;
  httpStatus?: number;
  elapsedMs?: number;
}

export interface HttpAdapterOptions {
  now: Date;
  baseConfidence: number;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  userAgent?: string;
}

const noNetwork = (outcome: HttpAttemptResult['outcome'], note: string): HttpAttemptResult => ({
  outcome,
  records: [],
  rejected: [],
  note,
  networkAttempted: false,
});

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

/**
 * Query one `open` source for one case.
 *
 * Refuses, without a request, in three situations: the source is not `open`,
 * the source declares no endpoint, or the case cannot supply a value for every
 * required filter. The third refusal is the important one — an unfiltered
 * GetFeature against a national register returns real, confidently wrong
 * parcels, so a missing key must never degrade into a broader query.
 */
export async function fetchOpenSource(
  source: RegisteredSource,
  identity: PropertyIdentity,
  options: HttpAdapterOptions,
): Promise<HttpAttemptResult> {
  if (source.access !== 'open') {
    return noNetwork(
      'unreachable',
      `Refused by the HTTP adapter: ${source.label} is classified \`${source.access}\`, not \`open\`, so no request was made. ${source.whatItWouldHaveAnswered}`,
    );
  }
  const spec = source.endpoint;
  if (!spec) {
    return noNetwork('unreachable', `Refused by the HTTP adapter: ${source.label} is classified \`open\` but declares no endpoint.`);
  }

  const keys = deriveCaseKeys(identity);
  const predicates: { attribute: string; value: string }[] = [];
  const missing: CaseDerivedKey[] = [];
  for (const filter of spec.filters) {
    const value = keys[filter.from];
    if (value === undefined) missing.push(filter.from);
    else predicates.push({ attribute: filter.attribute, value });
  }
  if (missing.length > 0) {
    return noNetwork(
      'skipped',
      `Not queried: ${source.label} is keyed on ${spec.filters.map(f => f.attribute).join(' + ')} and this case does not yield ${missing.join(', ')}. Querying without a full key would return other people's parcels, so no request was made.`,
    );
  }
  for (const filter of spec.optionalFilters ?? []) {
    const value = keys[filter.from];
    if (value !== undefined) predicates.push({ attribute: filter.attribute, value });
  }

  const url = buildWfsUrl(spec, predicates);
  const fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) {
    return noNetwork('unreachable', `No fetch implementation available in this runtime, so ${source.label} was not queried.`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let response: FetchLikeResponse;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'User-Agent': options.userAgent ?? USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const aborted = controller.signal.aborted;
    return {
      outcome: 'unreachable',
      records: [],
      rejected: [],
      networkAttempted: true,
      requestedUrl: url,
      elapsedMs,
      note: aborted
        ? `${source.label} did not respond within ${timeoutMs} ms; the request was abandoned rather than retried. ${source.whatItWouldHaveAnswered}`
        : `${source.label} could not be reached: ${describeError(error)}. ${source.whatItWouldHaveAnswered}`,
    };
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - startedAt;
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    return {
      outcome: 'unreachable',
      records: [],
      rejected: [],
      networkAttempted: true,
      requestedUrl: url,
      httpStatus: response.status,
      elapsedMs,
      note: `${source.label} answered ${response.status} but the body could not be read: ${describeError(error)}.`,
    };
  }

  if (!response.ok) {
    return {
      outcome: 'unreachable',
      records: [],
      rejected: [],
      networkAttempted: true,
      requestedUrl: url,
      httpStatus: response.status,
      elapsedMs,
      note: `${source.label} answered HTTP ${response.status} ${response.statusText}: ${excerpt(body)}. ${source.whatItWouldHaveAnswered}`,
    };
  }

  // A WFS reports its own errors as an XML ExceptionReport with a 200, so the
  // body is checked rather than the status.
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return {
      outcome: 'unreachable',
      records: [],
      rejected: [],
      networkAttempted: true,
      requestedUrl: url,
      httpStatus: response.status,
      elapsedMs,
      note: `${source.label} answered HTTP ${response.status} but with ${response.headers.get('content-type') ?? 'an unstated content type'} rather than JSON — commonly a WFS ExceptionReport: ${excerpt(body)}.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return {
      outcome: 'unreachable',
      records: [],
      rejected: [],
      networkAttempted: true,
      requestedUrl: url,
      httpStatus: response.status,
      elapsedMs,
      note: `${source.label} answered HTTP ${response.status} with a body that is not valid JSON: ${describeError(error)}.`,
    };
  }

  const features = extractFeatures(parsed);
  if (features.length === 0) {
    return {
      outcome: 'no_match',
      records: [],
      rejected: [],
      networkAttempted: true,
      requestedUrl: url,
      httpStatus: response.status,
      elapsedMs,
      note: `${source.label} answered, and holds no feature matching ${predicates.map(p => `${p.attribute}=${p.value}`).join(', ')}. That is an answer, not a failure: either the identifier is wrong or the register genuinely has no such entry — both are worth resolving before relying on the case's stated parcel id.`,
    };
  }

  const normalisation = normaliseRows(
    features.map((values, i) => ({ rowNumber: i + 1, values })),
    {
      sourceId: source.id,
      recordType: spec.recordType,
      defaultAreaUnit: spec.defaultAreaUnit,
      now: options.now,
      baseConfidence: options.baseConfidence,
      // GeoJSON carries plenty of service-internal keys (geometry hashes,
      // label rotations); carrying them onto records would bury the fields
      // that matter, so unmapped columns are reported and dropped here.
      keepUnmapped: false,
    },
  );

  return {
    outcome: normalisation.records.length > 0 ? 'ingested' : 'no_match',
    records: normalisation.records,
    rejected: normalisation.rejected,
    networkAttempted: true,
    requestedUrl: url,
    httpStatus: response.status,
    elapsedMs,
    note: `${source.label} answered HTTP ${response.status} in ${elapsedMs} ms with ${features.length} feature(s) for ${predicates
      .map(p => `${p.attribute}=${p.value}`)
      .join(', ')}; ${normalisation.records.length} ingested, ${normalisation.rejected.length} rejected.${
      normalisation.rejected.length > 0 ? ` First rejection — row ${normalisation.rejected[0].rowNumber}: ${normalisation.rejected[0].reason}.` : ''
    }`,
  };
}

function extractFeatures(parsed: unknown): Record<string, unknown>[] {
  if (parsed === null || typeof parsed !== 'object') return [];
  const collection = parsed as { features?: unknown };
  if (!Array.isArray(collection.features)) return [];
  const out: Record<string, unknown>[] = [];
  for (const feature of collection.features) {
    if (feature === null || typeof feature !== 'object') continue;
    const props = (feature as { properties?: unknown }).properties;
    if (props !== null && typeof props === 'object') out.push(props as Record<string, unknown>);
  }
  return out;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.name}: ${cause.message})` : '';
    return `${error.name}: ${error.message}${causeText}`;
  }
  return String(error);
}

function excerpt(body: string, limit = 240): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
