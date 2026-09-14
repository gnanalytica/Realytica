/**
 * The revenue map on a project: a government record, machine-read, never
 * evidence; and never allowed to overwrite what a person supplied.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyRevenueMap,
  applySurveyBoundary,
  buildProjectGraph,
  clearRevenueMap,
  compareProjectGis,
  revenueMapBrief,
  revenueMapHits,
  seedDemoProject,
  surveyNoFromParcelId,
  type RevenueMapRead,
} from '@realytica/shared';

const CENTRE = { lat: 12.71, lng: 77.69 };

function metresLng(m: number, lat = CENTRE.lat): number {
  return m / (111_320 * Math.cos((lat * Math.PI) / 180));
}
function metresLat(m: number): number {
  return m / 111_320;
}

function rect(west: number, south: number, widthM: number, heightM: number) {
  const dLng = metresLng(widthM, south);
  const dLat = metresLat(heightM);
  return [
    { lat: south, lng: west },
    { lat: south, lng: west + dLng },
    { lat: south + dLat, lng: west + dLng },
    { lat: south + dLat, lng: west },
    { lat: south, lng: west },
  ];
}

function geojson(ring: { lat: number; lng: number }[]): string {
  return JSON.stringify({ type: 'Polygon', coordinates: [ring.map((p) => [p.lng, p.lat])] });
}

function read(overrides: Partial<RevenueMapRead> = {}): RevenueMapRead {
  const parcel = rect(CENTRE.lng, CENTRE.lat, 60, 40);
  return {
    readAt: '2026-09-08T06:00:00.000Z',
    state: 'KA',
    parcelRef: 'kgis:2003010043:10',
    surveyNo: '10',
    village: 'Anekal',
    mandal: 'Anekal',
    district: 'Bengaluru (Urban)',
    sourceLabel: 'K-GIS survey-number map',
    rings: [parcel],
    centre: CENTRE,
    areaSqm: 2400,
    registerExtent: null,
    classification: null,
    prohibitedCategory: null,
    prohibitedRegisterUnjoined: true,
    features: [
      {
        id: 'ka_water:1',
        kind: 'state_water',
        layerKey: 'ka_water',
        name: 'Anekal Kere',
        distanceM: 240,
        contains: false,
        ring: rect(CENTRE.lng + metresLng(300), CENTRE.lat, 200, 150),
      },
      {
        id: 'ka_drain:1',
        kind: 'state_drain',
        layerKey: 'ka_drain',
        name: null,
        distanceM: 40,
        contains: false,
        line: [
          { lat: CENTRE.lat - metresLat(60), lng: CENTRE.lng - metresLng(100) },
          { lat: CENTRE.lat - metresLat(60), lng: CENTRE.lng + metresLng(400) },
        ],
      },
    ],
    factors: [
      {
        code: 'ka_drain_buffer',
        label: 'Drain buffer',
        direction: 'down',
        severity: 'high',
        headline: 'A stream runs about 40 m from the plot.',
        detail: 'RMP 2015 keeps a buffer along secondary drains; a plan inside it is refused.',
        impactLowPct: -8,
        impactHighPct: -3,
        layerKey: 'ka_drain',
        source: 'K-GIS LULC 2023 — streams and canals',
        distanceM: 40,
      },
      {
        code: 'ka_zone_residential',
        label: 'Residential zone',
        direction: 'up',
        severity: 'low',
        headline: 'The master plan zones this land residential.',
        detail: 'BMRDA Anekal LPA sheet, proposed land use.',
        impactLowPct: 0,
        impactHighPct: 4,
        layerKey: 'ka_masterplan',
        source: 'BMRDA master plan — Anekal LPA',
        distanceM: null,
      },
    ],
    insights: [
      {
        code: 'ka_water_anekal_kere',
        kind: 'existing',
        layerKey: 'ka_water',
        featureId: 'ka_water:1',
        title: 'Anekal Kere',
        status: 'Recorded 2023',
        distanceM: 240,
        direction: 'east',
        meaning: 'A tank within 300 m; the 30 m buffer does not reach the plot.',
        source: 'K-GIS LULC 2023',
      },
    ],
    anchor: {
      guidancePerUnit: 18_400,
      unit: 'sqyd',
      locality: 'Anekal Kasaba',
      note: 'Kaveri guidance value as published, read on 2026-09-06.',
    },
    emptyLayers: ['ka_lulc'],
    unreadLayers: [],
    ...overrides,
  };
}

describe('revenue map on a project', () => {
  it('becomes the boundary only when nobody supplied one, and is never evidence', () => {
    const project = seedDemoProject();
    const evidenceBefore = project.evidence.length;
    const graphBefore = buildProjectGraph(project).nodes.length;

    const boundary = applyRevenueMap(project, read(), 'tester');
    assert.ok(boundary, 'the parcel ring is put on the project');
    assert.equal(project.surveyBoundary?.source, 'revenue_map');
    assert.ok(Math.abs((project.surveyBoundary?.computedAreaSqm ?? 0) - 2400) < 60, 'the ring measures what the read says');
    assert.equal(project.revenueMap?.parcelRef, 'kgis:2003010043:10');
    assert.equal(project.evidence.length, evidenceBefore, 'nothing was filed');
    assert.equal(buildProjectGraph(project).nodes.length, graphBefore, 'nothing entered the graph');
    assert.ok(project.audit.some((a) => a.newValue?.includes('revenueMap')), 'the read is audited');
  });

  it('never overwrites a surveyor\'s outline, but a second read replaces its own', () => {
    const project = seedDemoProject();
    applySurveyBoundary(project, geojson(rect(CENTRE.lng, CENTRE.lat, 50, 50)), 'surveyor.geojson', 'tester');
    const supplied = project.surveyBoundary;
    assert.equal(supplied?.source, 'uploaded_geojson');

    const boundary = applyRevenueMap(project, read(), 'tester');
    assert.equal(boundary, null, 'the read does not become the boundary');
    assert.equal(project.surveyBoundary, supplied, 'the upload is untouched');
    assert.ok(project.revenueMap, 'but the read itself is kept');

    const fresh = seedDemoProject();
    applyRevenueMap(fresh, read(), 'tester');
    const first = fresh.surveyBoundary?.suppliedAt;
    applyRevenueMap(fresh, read({ readAt: '2026-09-09T06:00:00.000Z', areaSqm: 2500 }), 'tester');
    assert.notEqual(fresh.surveyBoundary?.suppliedAt, first, 'a re-read replaces the boundary it supplied');
  });

  it('clearing the read takes its boundary with it and leaves a person\'s alone', () => {
    const own = seedDemoProject();
    applyRevenueMap(own, read(), 'tester');
    clearRevenueMap(own, 'tester');
    assert.equal(own.revenueMap, undefined);
    assert.equal(own.surveyBoundary, undefined);

    const theirs = seedDemoProject();
    applySurveyBoundary(theirs, geojson(rect(CENTRE.lng, CENTRE.lat, 50, 50)), 'surveyor.geojson', 'tester');
    applyRevenueMap(theirs, read(), 'tester');
    clearRevenueMap(theirs, 'tester');
    assert.equal(theirs.surveyBoundary?.source, 'uploaded_geojson');
  });

  it('draws the state layers on the overlay with the record standing, and flags what pushes down', () => {
    const project = seedDemoProject();
    applyRevenueMap(project, read(), 'tester');
    const overlay = compareProjectGis(project, { revenue: project.revenueMap });

    assert.equal(overlay.revenue?.standing, 'record');
    assert.equal(overlay.revenue?.featureCount, 2);
    assert.ok(overlay.features.some((f) => f.kind === 'state_water' && f.ring), 'the tank is a ring');
    assert.ok(overlay.features.some((f) => f.kind === 'state_drain' && f.line), 'the drain is a line');
    assert.equal(overlay.survey?.source, 'revenue_map', 'the parcel is the survey ring on the overlay');
    assert.equal(overlay.notEvidence, true);

    const hits = overlay.hits.filter((h) => h.code.startsWith('revenue_'));
    const parcel = hits.find((h) => h.code === 'revenue_parcel');
    assert.ok(parcel && parcel.standing === 'record' && /Sy\. 10, Anekal/.test(parcel.text));
    assert.match(parcel.text, /not a licensed survey/);

    const drain = hits.find((h) => h.code === 'revenue_factor' && /stream/.test(h.text));
    assert.equal(drain?.severity, 'flag', 'a drag factor is a flag');
    assert.match(drain?.text ?? '', /Source: K-GIS LULC 2023/);
    assert.equal(drain?.metres, 40);
    assert.doesNotMatch(drain?.text ?? '', /-?\d+%/, 'the engine\'s percentage does not travel');
    const zone = hits.find((h) => h.code === 'revenue_factor' && /residential/.test(h.text));
    assert.equal(zone?.severity, 'info', 'an uplift is a note');

    const unjoined = hits.find((h) => h.code === 'revenue_register_unjoined');
    assert.ok(unjoined && unjoined.standing === 'statute_needed', 'silence on the register is named as silence');
    assert.match(unjoined.text, /not a clean title/);

    const anchor = hits.find((h) => h.code === 'revenue_anchor');
    assert.match(anchor?.text ?? '', /18,400 per sq yd/);
    assert.ok(hits.some((h) => h.code === 'revenue_insight' && /Anekal Kere/.test(h.text)));
    assert.ok(!hits.some((h) => h.code === 'revenue_unread'), 'nothing was unread');
  });

  it('a prohibited entry is a flag; unread layers are named, not dropped', () => {
    const project = seedDemoProject();
    const hits = revenueMapHits(
      read({
        prohibitedCategory: 'Government land',
        prohibitedRegisterUnjoined: false,
        unreadLayers: [{ layer: 'ka_masterplan', reason: 'timeout' }],
      }),
      project,
    );
    const prohibited = hits.find((h) => h.code === 'revenue_prohibited');
    assert.equal(prohibited?.severity, 'flag');
    assert.match(prohibited?.text ?? '', /Government land/);
    assert.ok(!hits.some((h) => h.code === 'revenue_register_unjoined'));
    const unread = hits.find((h) => h.code === 'revenue_unread');
    assert.match(unread?.text ?? '', /masterplan/);
    assert.match(unread?.text ?? '', /means nothing/);
  });

  it('a supplied outline that disagrees with the register is a finding for both to keep', () => {
    const project = seedDemoProject();
    applySurveyBoundary(project, geojson(rect(CENTRE.lng, CENTRE.lat, 60, 60)), 'surveyor.geojson', 'tester');
    applyRevenueMap(project, read({ areaSqm: 2400 }), 'tester');
    const hits = revenueMapHits(project.revenueMap!, project);
    const extent = hits.find((h) => h.code === 'revenue_extent');
    assert.equal(extent?.severity, 'flag');
    assert.match(extent?.text ?? '', /more than the revenue map/);
    assert.match(extent?.text ?? '', /Both are kept/);
  });

  it('a parcel far from the pin is the loudest flag on the overlay', () => {
    const near = revenueMapHits(read(), seedDemoProject(), { lat: CENTRE.lat + 0.001, lng: CENTRE.lng });
    assert.ok(!near.some((h) => h.code === 'revenue_far_from_pin'), '110 m is the same place');
    const far = revenueMapHits(read(), seedDemoProject(), { lat: 12.93, lng: 77.62 });
    const hit = far.find((h) => h.code === 'revenue_far_from_pin');
    assert.equal(hit?.severity, 'flag');
    assert.match(hit?.text ?? '', /\d+\.\d km from this project’s pin/);
    assert.match(hit?.text ?? '', /wrong place/);
    assert.ok(!revenueMapHits(read(), seedDemoProject(), null).some((h) => h.code === 'revenue_far_from_pin'), 'no pin, no comparison');
  });

  it('reads the survey number out of whatever the file recorded', () => {
    assert.equal(surveyNoFromParcelId('Sy. No. 42/1'), '42/1');
    assert.equal(surveyNoFromParcelId('Survey 214/A, Balagere'), '214/A');
    assert.equal(surveyNoFromParcelId('Sy 12 / 1'), '12');
    assert.equal(surveyNoFromParcelId(''), '');
    assert.equal(surveyNoFromParcelId(undefined), '');
  });
});

describe('the brief: the read as points', () => {
  it('groups factors and insights under the questions a reader asks', () => {
    const brief = revenueMapBrief(read());
    assert.equal(brief.parcel.surveyNo, '10');
    assert.equal(brief.parcel.place, 'Anekal, Anekal, Bengaluru (Urban)');
    assert.equal(brief.parcel.extentSqm, 2400);
    assert.deepEqual(brief.register, { state: 'unjoined' });

    assert.equal(brief.warnings.length, 1, 'the drain buffer is the one warning');
    assert.equal(brief.warnings[0].title, 'Drain buffer');
    assert.equal(brief.warnings[0].where, '40 m away');
    assert.equal(brief.warnings[0].tone, 'warning');
    assert.match(brief.warnings[0].says, /stream runs about 40 m/);
    assert.match(brief.warnings[0].why ?? '', /RMP 2015/);

    assert.equal(brief.positives.length, 1, 'the residential zone is the one plus');
    assert.equal(brief.positives[0].tone, 'good');

    assert.equal(brief.nearby.length, 1, 'the tank is nearby and no factor names its layer');
    assert.equal(brief.nearby[0].title, 'Anekal Kere');
    assert.equal(brief.nearby[0].where, '240 m east');

    assert.deepEqual(brief.planned, []);
    assert.deepEqual(brief.zoning, []);
    assert.equal(brief.guidance?.perUnit, 18_400);
    assert.equal(brief.guidance?.unit, 'sqyd');
    assert.deepEqual(brief.notChecked, []);
    assert.deepEqual(brief.checkedClear, ['lulc']);
  });

  it('never prints the engine’s value percentages on the brief', () => {
    const brief = revenueMapBrief(read());
    const text = JSON.stringify([brief.warnings, brief.positives, brief.nearby, brief.planned, brief.zoning]);
    assert.doesNotMatch(text, /-?\d+%/);
  });

  it('keeps a planned alignment and a zone even when a factor covers the same layer; drops a duplicate lake', () => {
    const brief = revenueMapBrief(
      read({
        insights: [
          {
            code: 'rrr',
            kind: 'planned',
            layerKey: 'rrr',
            featureId: 'rrr:1',
            title: 'Regional Ring Road',
            status: 'Proposed — land acquisition in progress',
            distanceM: 1800,
            direction: 'south',
            meaning: 'The alignment passes 1.8 km south. Access improves without the plot being taken.',
            source: 'Telangana GIS — RRR alignment',
          },
          {
            code: 'ka_zone',
            kind: 'zoning',
            layerKey: 'ka_masterplan',
            featureId: null,
            title: 'Residential zone',
            status: 'BMRDA master plan, proposed land use',
            distanceM: 0,
            direction: null,
            meaning: 'Zoned residential in the Anekal LPA sheet.',
            source: 'BMRDA master plan',
          },
          {
            code: 'ka_drain_near',
            kind: 'risk',
            layerKey: 'ka_drain',
            featureId: 'ka_drain:1',
            title: 'Stream',
            status: 'Mapped in the 2023 land-use survey',
            distanceM: 40,
            direction: 'south',
            meaning: 'A stream 40 m south.',
            source: 'K-GIS LULC 2023',
          },
        ],
      }),
    );
    assert.equal(brief.planned.length, 1);
    assert.equal(brief.planned[0].where, '1.8 km south');
    assert.equal(brief.zoning.length, 1, 'the zone insight and the zone factor become one line under planning');
    assert.equal(brief.zoning[0].where, null, 'zero distance is not a place; the sentence says it applies to the plot');
    assert.equal(brief.zoning[0].tone, 'good', 'the merged line carries the factor’s verdict');
    assert.match(brief.zoning[0].says, /zones this land residential/);
    assert.deepEqual(brief.positives, [], 'the zone factor moved under planning; it is not printed twice');
    assert.deepEqual(brief.nearby, [], 'the drain insight merged into the drain factor; it is not repeated');
    assert.equal(brief.warnings.length, 1);
    assert.equal(brief.warnings[0].title, 'Stream', 'the insight names it');
    assert.equal(brief.warnings[0].where, '40 m south', 'and says which way');
    assert.match(brief.warnings[0].why ?? '', /RMP 2015/, 'the factor supplies the rule');
  });

  it('merges by code family and distance, not by layer key — the two spell layers differently', () => {
    // Read live from K-GIS on 2026-09-14: a factor cites the ArcGIS path, an
    // insight the engine key, and the same industrial zone was printed twice.
    const brief = revenueMapBrief(
      read({
        factors: [
          {
            code: 'industrial_adjacent',
            label: 'Land zoned industrial nearby',
            direction: 'down',
            severity: 'high',
            headline: 'Within about 400 m of land the master plan zones for industry.',
            detail: 'Adjacency brings heavy-vehicle traffic, effluent and noise.',
            impactLowPct: -15,
            impactHighPct: -5,
            layerKey: 'BMRDA/BMRDA/MapServer/4',
            source: 'BMRDA master plan — Anekal LPA',
            distanceM: null,
          },
          {
            code: 'water_body_amenity',
            label: 'Near a water body',
            direction: 'up',
            severity: 'low',
            headline: 'A live tank at this distance supports price.',
            detail: 'The premium is modest.',
            impactLowPct: 2,
            impactHighPct: 6,
            layerKey: 'LULC/State_LULC_2023/MapServer/0',
            source: 'K-GIS LULC 2023',
            distanceM: 679.1,
          },
        ],
        insights: [
          {
            code: 'ka_industrial_near',
            kind: 'zoning',
            layerKey: 'ka_masterplan_near',
            featureId: null,
            title: 'Land zoned industrial within about 400 m',
            status: 'BMRDA master plan, proposed land use',
            distanceM: 400,
            direction: null,
            meaning: 'Inside the 400 m box the master plan zones some land for industry.',
            source: 'BMRDA master plan',
          },
          {
            code: 'ka_water:0:679',
            kind: 'existing',
            layerKey: 'ka_water',
            featureId: 'ka_water:0',
            title: 'Anekal Kere',
            status: 'Mapped as tank in the 2023 land-use survey',
            distanceM: 679.1,
            direction: 'west',
            meaning: '679 m to the west.',
            source: 'K-GIS LULC 2023',
          },
          {
            code: 'ka_water:1:720',
            kind: 'existing',
            layerKey: 'ka_water',
            featureId: 'ka_water:2',
            title: 'Unnamed tank',
            status: 'Mapped as tank in the 2023 land-use survey',
            distanceM: 720.3,
            direction: 'north',
            meaning: '720 m to the north.',
            source: 'K-GIS LULC 2023',
          },
        ],
      }),
    );
    assert.equal(brief.zoning.length, 1, 'one industrial line, under planning');
    assert.equal(brief.zoning[0].tone, 'warning');
    assert.equal(brief.zoning[0].where, '400 m away');
    assert.deepEqual(brief.warnings, [], 'the industrial factor is not printed a second time as a warning');
    assert.equal(brief.positives.length, 1);
    assert.equal(brief.positives[0].title, 'Anekal Kere', 'the named tank, not "near a water body"');
    assert.equal(brief.positives[0].where, '679 m west');
    assert.equal(brief.nearby.length, 1);
    assert.equal(brief.nearby[0].title, 'Unnamed tank', 'the second tank has no factor and stays a note');
  });

  it('names a listed parcel, and the layers that did not answer', () => {
    const brief = revenueMapBrief(
      read({
        prohibitedCategory: 'Government land',
        prohibitedRegisterUnjoined: false,
        unreadLayers: [{ layer: 'ka_masterplan', reason: 'timeout' }],
      }),
    );
    assert.deepEqual(brief.register, { state: 'listed', category: 'Government land' });
    assert.deepEqual(brief.notChecked, [{ layer: 'masterplan', reason: 'timeout' }]);
  });
});
