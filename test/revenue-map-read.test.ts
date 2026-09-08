/**
 * Translating Kshetra's report into the record Realytica keeps.
 *
 * The fixture is a real report the engine produced for a Telangana municipal
 * parcel, captured in Kshetra's own tests. What matters here is what crosses
 * the boundary and what does not: geometry in lat/lng, the published rate
 * without the engine's market multiple, factors without declared answers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fixture from '../packages/site-intel/checks/fixtures/site-intel-report.json';
import type { SiteIntelReport } from '../packages/site-intel/src/types';
import { toRevenueMapRead } from '../apps/api/src/gis/revenue-map';

function report(): SiteIntelReport {
  // The capture predates `state`, `areaMap` and `insights`, and its parcel row
  // predates `state` on the summary; the rest is the engine's own output.
  const base = (fixture as unknown as { report: Omit<SiteIntelReport, 'state' | 'areaMap' | 'insights'> }).report;
  const centre = base.parcel!.centroid;
  return {
    ...base,
    parcel: { ...base.parcel!, state: 'TS' },
    state: 'TS',
    areaMap: {
      centre,
      emptyLayers: ['metro_stations'],
      unreadLayers: [],
      features: [
        {
          id: 'water_bodies:7',
          kind: 'water',
          layerKey: 'water_bodies',
          name: 'Peddacheruvu',
          distanceM: 180,
          contains: false,
          rings: [
            [
              [centre.lng + 0.002, centre.lat],
              [centre.lng + 0.003, centre.lat],
              [centre.lng + 0.003, centre.lat + 0.001],
              [centre.lng + 0.002, centre.lat],
            ],
          ],
        },
        {
          id: 'metro_stations:2',
          kind: 'metro',
          layerKey: 'metro_stations',
          name: 'Uppal',
          distanceM: 900,
          contains: false,
          point: [centre.lng - 0.008, centre.lat],
        },
        {
          id: 'hmda_zone:1',
          kind: 'hmda_zone',
          layerKey: 'hmda_zone',
          name: 'HMDA',
          distanceM: 0,
          contains: true,
          rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        },
      ],
    },
    insights: [
      {
        code: 'water_peddacheruvu_180',
        kind: 'existing',
        layerKey: 'water_bodies',
        featureId: 'water_bodies:7',
        title: 'Peddacheruvu',
        status: 'Recorded',
        distanceM: 180,
        direction: 'east',
        meaning: 'A tank within 200 m.',
        source: 'Telangana GIS',
      },
    ],
  };
}

describe('toRevenueMapRead', () => {
  it('keeps the parcel, converts geometry, and drops what Realytica prices itself', () => {
    const r = report();
    const read = toRevenueMapRead(r, '2026-09-08T00:00:00.000Z');

    assert.equal(read.state, 'TS');
    assert.equal(read.parcelRef, r.parcel!.ref);
    assert.equal(read.surveyNo, r.parcel!.parcelNo);
    assert.equal(read.sourceLabel, r.parcel!.sourceLabel);
    assert.equal(read.areaSqm, r.parcel!.areaSqm);

    const ring = read.rings[0];
    assert.ok(ring.length >= 4);
    const [lng, lat] = r.parcel!.rings[0][0];
    assert.deepEqual(ring[0], { lat, lng }, 'ArcGIS [lng, lat] becomes {lat, lng}');

    assert.equal(read.features.length, 2, 'HMDA jurisdiction polygons are not drawn');
    const tank = read.features.find((f) => f.kind === 'state_water');
    assert.ok(tank?.ring && tank.ring.length === 4 && tank.name === 'Peddacheruvu');
    const station = read.features.find((f) => f.kind === 'state_transport');
    assert.ok(station?.point && Math.abs(station.point.lng - (r.areaMap.centre.lng - 0.008)) < 1e-9);

    assert.equal(read.factors.length, r.factors.filter((f) => f.confidence !== 'declared').length);
    for (const f of read.factors) {
      assert.ok(['up', 'down'].includes(f.direction));
      assert.ok(['critical', 'high', 'medium', 'low'].includes(f.severity));
      assert.ok(f.layerKey, 'every factor names its layer');
      assert.ok(f.source, 'and says it in words');
    }

    assert.equal(read.insights.length, 1);
    assert.equal(read.emptyLayers[0], 'metro_stations');
    assert.deepEqual(read.unreadLayers, r.gaps);
    assert.equal(read.prohibitedRegisterUnjoined, false, 'the municipal cadastre is joined to the register');
  });

  it('carries the published rate, not the engine\'s market figure', () => {
    const r = report();
    const anchor = r.estimate!.anchor;
    const read = toRevenueMapRead(r);
    assert.ok(read.anchor);
    const expected = anchor.basis === 'guidance_multiplied' ? anchor.ratePerUnit / anchor.marketMultiple : anchor.ratePerUnit;
    assert.ok(Math.abs(read.anchor.guidancePerUnit - expected) < 1e-6);
    assert.equal(read.anchor.unit, anchor.unit);
    assert.equal(read.anchor.note, anchor.note);
  });

  it('a rural or K-GIS parcel with no entry is marked as silence, and a user rate is not an anchor', () => {
    const r = report();
    const rural = { ...r, parcel: { ...r.parcel!, source: 'rural' as const, prohibitedCategory: null } };
    assert.equal(toRevenueMapRead(rural).prohibitedRegisterUnjoined, true);
    const listed = { ...r, parcel: { ...r.parcel!, source: 'kgis' as const, prohibitedCategory: 'Government land' } };
    const read = toRevenueMapRead(listed);
    assert.equal(read.prohibitedRegisterUnjoined, false);
    assert.equal(read.prohibitedCategory, 'Government land');

    const typed = {
      ...r,
      estimate: { ...r.estimate!, anchor: { ...r.estimate!.anchor, basis: 'user' as const } },
    };
    assert.equal(toRevenueMapRead(typed).anchor, null);
  });

  it('refuses a report with no parcel — a pin is not a revenue-map read', () => {
    assert.throws(() => toRevenueMapRead({ ...report(), parcel: null }), /needs one/);
  });
});
