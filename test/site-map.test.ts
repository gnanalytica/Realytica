/**
 * Where the site map opens, where its street view looks from, which
 * addresses it will offer as links, and whether its "where I am" button is
 * allowed to ask.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GIS_OVERLAY_RADIUS_M,
  SITE_FRAME_MARGIN_M,
  STREET_VIEW_REACH_M,
  haversineMetres,
  isHttpsUrl,
  siteFrame,
  type GeoPoint,
  type GisOverlayRead,
  type SiteFrame,
} from '@realytica/shared';
import { securityHeaders } from '../apps/api/src/http/hardening';

const ORIGIN = { lat: 12.97, lng: 77.59 };

/** Metres in a degree of latitude, and of longitude at a latitude: the same flat-ground rule the frame is built with. */
const PER_DEG_LAT = 111_320;
function perDegLng(lat: number): number {
  return PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function moved(from: GeoPoint, northM: number, eastM: number): GeoPoint {
  return { lat: from.lat + northM / PER_DEG_LAT, lng: from.lng + eastM / perDegLng(from.lat) };
}

/** A plot with its south-west corner on the origin, as an open ring. */
function plot(widthM: number, heightM: number): GeoPoint[] {
  return [ORIGIN, moved(ORIGIN, 0, widthM), moved(ORIGIN, heightM, widthM), moved(ORIGIN, heightM, 0)];
}

function pinAt(point: GeoPoint): GisOverlayRead['pin'] {
  return { ...point, caveat: 'Geocoded pin — not a surveyed parcel boundary.', source: 'site_context' };
}

function outline(ring: GeoPoint[]): GisOverlayRead['survey'] {
  return { ring, source: 'uploaded_geojson', computedAreaSqm: 0, caveat: 'Supplied outline.' };
}

/** How far the frame runs, east to west and north to south, in metres. */
function across(frame: SiteFrame): { ew: number; ns: number } {
  return {
    ew: (frame.east - frame.west) * perDegLng(frame.point.lat),
    ns: (frame.north - frame.south) * PER_DEG_LAT,
  };
}

function holds(frame: SiteFrame, point: GeoPoint): boolean {
  return point.lat >= frame.south && point.lat <= frame.north && point.lng >= frame.west && point.lng <= frame.east;
}

function near(actual: number, expected: number, within: number): void {
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);
}

describe('where the site map opens', () => {
  it('opens on the outline, and not on a pin a kilometre away', () => {
    const ring = plot(40, 60);
    const pin = moved(ORIGIN, 800, 700);
    const frame = siteFrame({ pin: pinAt(pin), survey: outline(ring) });
    assert.ok(frame);
    assert.equal(frame.from, 'outline');
    for (const corner of ring) assert.ok(holds(frame, corner));
    assert.equal(holds(frame, pin), false);
  });

  it('puts the point that stands for the site in the middle of the outline', () => {
    const ring = plot(40, 60);
    const frame = siteFrame({ pin: pinAt(moved(ORIGIN, 800, 700)), survey: outline(ring) });
    assert.ok(frame);
    const middle = moved(ORIGIN, 30, 20);
    near(haversineMetres(frame.point, middle), 0, 0.5);
  });

  it('keeps a small plot its surroundings: the margin either side of its centre', () => {
    const frame = siteFrame({ pin: null, survey: outline(plot(40, 60)) });
    assert.ok(frame);
    const { ew, ns } = across(frame);
    near(ew, 2 * SITE_FRAME_MARGIN_M, 1);
    near(ns, 2 * SITE_FRAME_MARGIN_M, 1);
    near((frame.south + frame.north) / 2, frame.point.lat, 1e-9);
    near((frame.west + frame.east) / 2, frame.point.lng, 1e-9);
  });

  it('gives a large outline a tenth of its own size as room on every side', () => {
    const ring = plot(3000, 2000);
    const frame = siteFrame({ pin: pinAt(ORIGIN), survey: outline(ring) });
    assert.ok(frame);
    const { ew, ns } = across(frame);
    near(ew, 3600, 1);
    near(ns, 2400, 1);
    for (const corner of ring) assert.ok(holds(frame, corner));
  });

  it('reads the same whether or not the ring repeats its first point', () => {
    const open = plot(40, 60);
    const closed = [...open, open[0]];
    assert.deepEqual(siteFrame({ pin: null, survey: outline(closed) }), siteFrame({ pin: null, survey: outline(open) }));
  });

  it('treats an outline of one point as that point with the margin round it', () => {
    const frame = siteFrame({ pin: pinAt(moved(ORIGIN, 500, 500)), survey: outline([ORIGIN]) });
    assert.ok(frame);
    assert.equal(frame.from, 'outline');
    assert.deepEqual(frame.point, ORIGIN);
    const { ew, ns } = across(frame);
    near(ew, 2 * SITE_FRAME_MARGIN_M, 1);
    near(ns, 2 * SITE_FRAME_MARGIN_M, 1);
    assert.equal(frame.reachM, STREET_VIEW_REACH_M);
  });

  it('goes to the pin when the ring on file is empty', () => {
    const pin = moved(ORIGIN, 120, -80);
    const frame = siteFrame({ pin: pinAt(pin), survey: outline([]) });
    assert.ok(frame);
    assert.equal(frame.from, 'pin');
    assert.deepEqual(frame.point, pin);
  });

  it('has nowhere to open with an empty ring and no pin, or with neither', () => {
    assert.equal(siteFrame({ pin: null, survey: outline([]) }), null);
    assert.equal(siteFrame({ pin: null, survey: null }), null);
  });

  it('frames a pin with no outline by the distance the overlay reads context for', () => {
    const frame = siteFrame({ pin: pinAt(ORIGIN), survey: null });
    assert.ok(frame);
    assert.equal(frame.from, 'pin');
    assert.deepEqual(frame.point, ORIGIN);
    const { ew, ns } = across(frame);
    near(ew, 2 * GIS_OVERLAY_RADIUS_M, 1);
    near(ns, 2 * GIS_OVERLAY_RADIUS_M, 1);
  });
});

describe('how far from the site a street view is looked for', () => {
  it('is the allowance alone from a pin, which is on or beside a road', () => {
    assert.equal(siteFrame({ pin: pinAt(ORIGIN), survey: null })?.reachM, STREET_VIEW_REACH_M);
  });

  it('runs from the middle of an outline to its corner, and the allowance beyond', () => {
    // Half the diagonal of 40 by 60 is 36 m.
    assert.equal(siteFrame({ pin: null, survey: outline(plot(40, 60)) })?.reachM, STREET_VIEW_REACH_M + 36);
    // Of 3 km by 2 km it is 1.8 km: the reach is what a search from the middle needs to get to the edge.
    const ring = plot(3000, 2000);
    const large = siteFrame({ pin: null, survey: outline(ring) });
    assert.ok(large);
    assert.equal(large.reachM, Math.round(STREET_VIEW_REACH_M + haversineMetres(large.point, ring[2])));
    assert.ok(large.reachM > 1800 && large.reachM < 2000);
  });
});

describe('addresses the map will offer as links', () => {
  it('offers https and nothing else', () => {
    assert.equal(isHttpsUrl('https://data.opencity.in/dataset/x/download/sheet-12.pdf'), true);
    assert.equal(isHttpsUrl('HTTPS://data.opencity.in/sheet.pdf'), true);
    for (const url of [
      'http://data.opencity.in/sheet.pdf',
      'javascript:alert(1)',
      ' https://data.opencity.in/sheet.pdf',
      '//data.opencity.in/sheet.pdf',
      'data:text/html,<script>alert(1)</script>',
      '/sheet.pdf',
      '',
    ]) {
      assert.equal(isHttpsUrl(url), false, url);
    }
  });
});

describe('the map asking where the reader is', () => {
  it('is allowed from the app\'s own pages where the API serves them, and camera, microphone and payment are not', () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    };
    securityHeaders({})({ headers: {} } as never, res as never, () => {});
    const policy = headers.get('permissions-policy') ?? '';
    // `geolocation=()` here made the browser refuse the button's press before anybody was asked.
    assert.match(policy, /geolocation=\(self\)/);
    for (const feature of ['camera', 'microphone', 'payment']) assert.match(policy, new RegExp(`${feature}=\\(\\)`));
  });
});
