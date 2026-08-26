/**
 * The place provider port and the site-context builder.
 *
 * Driven against a stand-in provider rather than a network, so the
 * orchestration is tested without a billing account: the ordering, the
 * approximate-pin flag, the street-view heading, and every named gap.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bearingDegrees, haversineMetres, isSiteAccurate, siteContextQuery } from '@realytica/shared';
import type { GeocodePrecision } from '@realytica/shared';
import { buildSiteContext, placeGap, placeOk, unconfiguredPlaceProvider } from '@realytica/agents';
import type { NearbyPlace, PlaceProvider, RouteLeg, StreetViewPanorama } from '@realytica/agents';
import { NOW, seedFor } from './fixtures';

const SITE = { lat: 13.2437, lng: 77.7126 };

interface StubOptions {
  precision?: GeocodePrecision;
  geocodeFails?: boolean;
  transit?: NearbyPlace[];
  routes?: RouteLeg[] | 'fail';
  streetView?: StreetViewPanorama | null | 'fail' | 'undated';
}

function stubProvider(options: StubOptions = {}): PlaceProvider {
  return {
    id: 'stub',
    label: 'Stub',
    capabilities: { geocode: true, nearbySearch: true, routing: true, streetView: true },
    configured: true,
    async geocode(request) {
      if (options.geocodeFails) {
        return placeGap({ code: 'geocode_no_match', attempted: `Resolving "${request.query}".`, consequence: 'Not placed on a map.' });
      }
      return placeOk({ point: SITE, precision: options.precision ?? 'rooftop', resolvedAddress: 'Resolved Address' });
    },
    async nearby(request) {
      if (request.kind === 'transit') return placeOk(options.transit ?? []);
      if (request.kind === 'hospital') {
        return placeGap({ code: 'nearby_failed:hospital', attempted: 'Searching for hospitals.', consequence: 'Nothing of this kind is listed.' });
      }
      return placeOk([]);
    },
    async route() {
      if (options.routes === 'fail') {
        return placeGap({ code: 'routing_failed', attempted: 'Measuring road distance.', consequence: 'Straight-line only.' });
      }
      return placeOk(options.routes ?? []);
    },
    async findStreetView() {
      if (options.streetView === 'fail') {
        return placeGap({ code: 'streetview_failed', attempted: 'Looking up imagery.', consequence: 'No street-level view.' });
      }
      if (options.streetView === 'undated') {
        return placeGap({ code: 'streetview_undated', attempted: 'Looking up imagery.', consequence: 'Not shown undated.' });
      }
      return placeOk(options.streetView ?? null);
    },
  };
}

const STATION: NearbyPlace = { id: 'p1', name: 'Test Station', point: { lat: 13.22, lng: 77.706 } };

function build(options: StubOptions = {}, identityOverrides: Record<string, unknown> = {}) {
  const seed = seedFor('Devanahalli');
  return buildSiteContext({
    caseId: 'test-case',
    identity: { ...seed.identity, ...identityOverrides },
    provider: stubProvider(options),
    now: NOW,
  });
}

describe('geometry', () => {
  test('haversine is symmetric and zero on itself', () => {
    assert.equal(Math.round(haversineMetres(SITE, SITE)), 0);
    const other = { lat: 13.1986, lng: 77.7066 };
    assert.equal(Math.round(haversineMetres(SITE, other)), Math.round(haversineMetres(other, SITE)));
  });

  test('bearing points the right way round the compass', () => {
    assert.ok(Math.abs(bearingDegrees(SITE, { lat: SITE.lat + 1, lng: SITE.lng })) < 1, 'due north');
    assert.ok(Math.abs(bearingDegrees(SITE, { lat: SITE.lat, lng: SITE.lng + 1 }) - 90) < 1, 'due east');
  });

  test('only a rooftop or interpolated match describes the property', () => {
    assert.equal(isSiteAccurate('rooftop'), true);
    assert.equal(isSiteAccurate('interpolated'), true);
    assert.equal(isSiteAccurate('locality_centre'), false);
    assert.equal(isSiteAccurate('approximate'), false);
  });

  test('the geocoder query is assembled from the address on file', () => {
    const seed = seedFor('Devanahalli');
    const query = siteContextQuery(seed.identity);
    assert.ok(query.startsWith(seed.identity.addressLine), 'the address line must lead');
    assert.ok(query.includes(seed.identity.city));
  });
});

describe('building a site context', () => {
  test('a precise pin carries the caveat that it is not a boundary', async () => {
    const context = await build();
    assert.equal(context.location!.precision, 'rooftop');
    assert.match(context.location!.caveat, /not a surveyed parcel boundary/);
  });

  test('a locality-centre pin says so, and flags every distance measured from it', async () => {
    const context = await build({ precision: 'locality_centre', transit: [STATION] });
    assert.match(context.location!.caveat, /not this property/);
    assert.equal(context.amenities[0].fromApproximatePin, true);
  });

  test('straight-line distance is always present; road distance only when routed', async () => {
    const withoutRoute = await build({ transit: [STATION] });
    assert.ok(withoutRoute.amenities[0].straightLineMetres > 0);
    assert.equal(withoutRoute.amenities[0].drivingMetres, undefined);

    const withRoute = await build({ transit: [STATION], routes: [{ toIndex: 0, metres: 3400, seconds: 480 }] });
    assert.equal(withRoute.amenities[0].drivingMetres, 3400);
  });

  test('a failed routing call degrades to straight line and names the gap', async () => {
    const context = await build({ transit: [STATION], routes: 'fail' });
    assert.equal(context.amenities[0].drivingMetres, undefined);
    assert.ok(context.gaps.some(g => g.code === 'routing_failed'));
  });

  test('street view is pointed at the site and carries its capture date', async () => {
    const context = await build({
      streetView: { panoramaId: 'pano-1', point: { lat: 13.244, lng: 77.713 }, capturedAt: '2021-11' },
    });
    assert.equal(context.streetView!.capturedAt, '2021-11');
    assert.ok(context.streetView!.offsetMetres > 0);
    assert.ok(context.streetView!.headingDegrees >= 0 && context.streetView!.headingDegrees < 360);
    assert.match(context.streetView!.url, /site-context\/street-view\?pano=pano-1/);
  });

  test('undated imagery is refused rather than shown', async () => {
    const context = await build({ streetView: 'undated' });
    assert.equal(context.streetView, null);
    assert.ok(context.gaps.some(g => g.code === 'streetview_undated'));
  });

  test('no coverage is a named gap, not silence', async () => {
    const context = await build({ streetView: null });
    assert.equal(context.streetView, null);
    const gap = context.gaps.find(g => g.code === 'streetview_no_coverage')!;
    assert.match(gap.consequence, /access road may not be a public road/);
  });

  test('a failed amenity lookup is a gap; an empty result is not', async () => {
    const context = await build({ transit: [] });
    // The stub fails hospitals and returns nothing for transit. Only the
    // failure is a gap — an empty neighbourhood and a broken lookup must
    // never look the same.
    assert.ok(context.gaps.some(g => g.code === 'nearby_failed:hospital'));
    assert.equal(context.gaps.filter(g => g.code.startsWith('nearby_failed:transit')).length, 0);
  });

  test('a failed geocode stops the build and explains what is lost', async () => {
    const context = await build({ geocodeFails: true });
    assert.equal(context.location, null);
    assert.equal(context.amenities.length, 0);
    assert.ok(context.gaps.some(g => g.code === 'geocode_no_match'));
  });

  test('an address with no street line warns that only the locality can resolve', async () => {
    const context = await build({ precision: 'locality_centre' }, { addressLine: '' });
    assert.ok(context.gaps.some(g => g.code === 'address_line_missing'));
  });

  test('a case with no address at all does not call the provider', async () => {
    const context = await build({}, { addressLine: '', locality: '', city: '', state: '', postalCode: '' });
    assert.equal(context.location, null);
    assert.deepEqual(context.gaps.map(g => g.code), ['no_address_on_file']);
  });
});

describe('the unconfigured provider', () => {
  test('answers every method with a named gap rather than throwing', async () => {
    const context = await buildSiteContext({
      caseId: 'test-case',
      identity: seedFor('Devanahalli').identity,
      provider: unconfiguredPlaceProvider,
      now: NOW,
    });
    assert.equal(context.location, null);
    assert.equal(context.provider, 'unconfigured');
    const gap = context.gaps.find(g => g.code === 'no_provider_key')!;
    assert.match(gap.consequence, /REALYTICA_GOOGLE_MAPS_API_KEY/);
  });
});
