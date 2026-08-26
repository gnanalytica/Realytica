/**
 * The place provider port.
 *
 * Mirrors the shape of the LLM provider port next door (`../providers`) and
 * for the same reason: the product must run, and run honestly, when nobody
 * has set a key. Every method returns a result that can say "I could not do
 * this, and here is what that leaves unknown" rather than throwing, so a
 * caller never has to choose between a crash and an empty array that reads as
 * "there is nothing nearby".
 *
 * --- What this port is for, and what it is not for ------------------------
 *
 * A consumer mapping service is a *context* layer for this product, not an
 * *evidence* layer. It can tell a buyer that the site pin sits 700 m from a
 * metro station and show them what the road looks like. It cannot tell them
 * where the parcel boundary runs, how much land there is, or how far the
 * building must stand back from a rajakaluve — those are surveyor and
 * authority questions, and `SiteContext` documents at length why no method
 * here returns them.
 *
 * Accordingly everything this port produces enters the case as
 * `external_dataset` evidence with the provider named, and nothing it
 * produces is allowed to overwrite a figure a document states.
 */

import type { GeoPoint, GeocodePrecision, AmenityKind, SiteContextGap } from '@realytica/shared';

/**
 * What a given place provider can actually do.
 *
 * Declared rather than assumed, exactly as `LlmCapability` is: a provider
 * that can geocode but has no street-level imagery is a legitimate provider,
 * and the caller degrades a named feature instead of discovering the gap as
 * an exception.
 */
export interface PlaceCapabilities {
  /** Address string -> coordinates, with a precision class. */
  geocode: boolean;
  /** Coordinates -> nearby places of a given kind. */
  nearbySearch: boolean;
  /** Road-network distance and duration between two points. */
  routing: boolean;
  /** Street-level imagery, and — required — its capture date. */
  streetView: boolean;
}

export interface GeocodeRequest {
  /** The full address line to resolve, already assembled by the caller. */
  query: string;
  /**
   * Optional viewport bias, e.g. the city centre. A Bengaluru address without
   * a bias regularly resolves to a same-named locality in another state.
   */
  biasTo?: GeoPoint;
  /** ISO 3166-1 alpha-2, to keep the geocoder inside the right country. */
  regionCode?: string;
}

export interface GeocodeResult {
  point: GeoPoint;
  precision: GeocodePrecision;
  /** The provider's own formatted address for what it matched. */
  resolvedAddress: string;
}

export interface NearbyRequest {
  around: GeoPoint;
  kind: AmenityKind;
  /** Search radius in metres. */
  radiusMetres: number;
  /** Cap on results returned, applied by the provider where it can. */
  limit: number;
}

export interface NearbyPlace {
  /** Provider-stable id for the place, used to build the amenity id. */
  id: string;
  name: string;
  point: GeoPoint;
}

export interface RouteRequest {
  from: GeoPoint;
  to: GeoPoint[];
}

export interface RouteLeg {
  /** Index into the request's `to` array. */
  toIndex: number;
  metres: number;
  seconds: number;
}

export interface StreetViewLookup {
  /** Where to look from — normally the site pin. */
  near: GeoPoint;
  /** How far the provider may wander to find a panorama, in metres. */
  radiusMetres: number;
}

export interface StreetViewPanorama {
  panoramaId: string;
  point: GeoPoint;
  /**
   * Capture date as the provider reports it, usually "YYYY-MM".
   *
   * Non-optional on purpose. A provider that finds a panorama but cannot say
   * when it was taken must return `null` from `findStreetView` rather than a
   * panorama with a blank date: an undated street image of a Bengaluru
   * periphery corridor is not weak evidence, it is misleading evidence, and
   * the type refuses to carry it.
   */
  capturedAt: string;
}

/**
 * The outcome of one provider call.
 *
 * `ok` carries the value; the failure arm carries a `SiteContextGap` that is
 * already written in the language a user reads, so the caller never has to
 * invent a consequence sentence for an error it does not understand.
 */
export type PlaceOutcome<T> = { ok: true; value: T } | { ok: false; gap: SiteContextGap };

export function placeOk<T>(value: T): PlaceOutcome<T> {
  return { ok: true, value };
}

export function placeGap<T>(gap: SiteContextGap): PlaceOutcome<T> {
  return { ok: false, gap };
}

export interface PlaceProvider {
  /** Stable id recorded on everything this provider produces. */
  readonly id: string;
  readonly label: string;
  readonly capabilities: PlaceCapabilities;
  /**
   * False when the provider exists but has no credentials. Kept separate from
   * `capabilities` because "this provider cannot do street view" and "nobody
   * has set the key yet" are different facts that need different sentences.
   */
  readonly configured: boolean;

  geocode(request: GeocodeRequest): Promise<PlaceOutcome<GeocodeResult>>;
  nearby(request: NearbyRequest): Promise<PlaceOutcome<NearbyPlace[]>>;
  route(request: RouteRequest): Promise<PlaceOutcome<RouteLeg[]>>;
  /** Resolves to `null` when there is coverage-free ground or no dated panorama. */
  findStreetView(lookup: StreetViewLookup): Promise<PlaceOutcome<StreetViewPanorama | null>>;
}

/* ==================================================================== */
/* Geometry                                                              */
/* ==================================================================== */

/**
 * Re-exported, not redefined.
 *
 * `haversineMetres`, `bearingDegrees` and `isSiteAccurate` live in the shared
 * package because the valuation engine needs them and cannot depend on this
 * one. They are surfaced here so a caller working with the port has them to
 * hand without a second import — but there is one definition of each, in
 * `@realytica/shared/site`, and this is not it.
 */
export { haversineMetres, bearingDegrees, isSiteAccurate } from '@realytica/shared';
