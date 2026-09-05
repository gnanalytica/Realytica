/**
 * How Google's `location_type` becomes a precision class.
 *
 * Every payload below is a real response, taken from the live Geocoding API
 * with this deployment's own key, because the case this file exists for was
 * invisible until a real key answered. Asked about a Bengaluru township,
 * Google returns `GEOMETRIC_CENTER` with `types: ['premise', 'street_address']`
 * — it has matched the named building complex and returned its centroid. That
 * was being reported as a locality centre, which made the case print "the
 * address on file did not resolve to a specific building" about a result that
 * resolved to exactly one.
 *
 * The distinction is worth a class of its own in both directions: a premise
 * centroid is this property, and it is also not necessarily this unit.
 */

import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { createGoogleMapsProvider } from '@realytica/agents';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answering(result: Record<string, unknown>): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 'OK', results: [result] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

async function precisionFor(result: Record<string, unknown>) {
  answering(result);
  const provider = createGoogleMapsProvider({
    apiKey: 'test-key',
    endpoints: {
      geocode: 'https://example.invalid/geocode',
      nearby: 'https://example.invalid/nearby',
      matrix: 'https://example.invalid/matrix',
      streetViewMetadata: 'https://example.invalid/sv',
      staticMap: 'https://example.invalid/map',
      streetViewImage: 'https://example.invalid/svi',
    },
  });
  const out = await provider.geocode({ query: 'anything' });
  assert.ok(out.ok, 'the stub answers OK');
  return out.value;
}

/** Verbatim from the live API for "Sobha Dream Acres, Balagere Road, Panathur". */
const TOWNSHIP = {
  formatted_address: 'Sobha Dream Acres, 1144, Balagere Main Rd, Panathur, Bengaluru, Karnataka 560087, India',
  types: ['premise', 'street_address'],
  geometry: { location: { lat: 12.9384124, lng: 77.7200107 }, location_type: 'GEOMETRIC_CENTER' },
};

/** Verbatim from the live API for "Balagere Village, Varthur Hobli, Bengaluru". */
const VILLAGE = {
  formatted_address: 'Balagere Village, Balagere, Bengaluru, Karnataka 560087, India',
  types: ['locality', 'political'],
  geometry: { location: { lat: 12.937604, lng: 77.728734 }, location_type: 'GEOMETRIC_CENTER' },
};

describe('geocode precision', () => {
  it('calls a matched premise a premise, not a neighbourhood', async () => {
    const value = await precisionFor(TOWNSHIP);
    assert.equal(value.precision, 'premise_centre');
    assert.match(value.resolvedAddress, /Sobha Dream Acres/);
  });

  it('still calls a village centre a locality centre, however precise the geometry claims to be', async () => {
    const value = await precisionFor(VILLAGE);
    assert.equal(value.precision, 'locality_centre');
  });

  it('reads a road centre as a locality centre, because a polyline centre is not a property', async () => {
    const value = await precisionFor({
      formatted_address: 'Balagere Main Rd, Bengaluru, Karnataka, India',
      types: ['route'],
      geometry: { location: { lat: 12.94, lng: 77.72 }, location_type: 'GEOMETRIC_CENTER' },
    });
    assert.equal(value.precision, 'locality_centre');
  });

  it('leaves a rooftop match alone', async () => {
    const value = await precisionFor({
      formatted_address: '1144, Balagere Main Rd, Bengaluru 560087, India',
      types: ['street_address'],
      geometry: { location: { lat: 12.94, lng: 77.72 }, location_type: 'ROOFTOP' },
    });
    assert.equal(value.precision, 'rooftop');
  });

  it('a premise typed as a locality is still a locality — the region types win', async () => {
    const value = await precisionFor({
      formatted_address: 'Panathur, Bengaluru, Karnataka, India',
      types: ['sublocality', 'premise'],
      geometry: { location: { lat: 12.94, lng: 77.69 }, location_type: 'GEOMETRIC_CENTER' },
    });
    assert.equal(value.precision, 'locality_centre');
  });
});
