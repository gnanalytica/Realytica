/**
 * GIS context overlay: pin/survey versus OSM, never RMP, never auto-filed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySurveyBoundary,
  buildProjectGraph,
  compareProjectGis,
  handleChatSides,
  osmElementsToFeatures,
  parseNamedPolygons,
  seedBdaReferenceProject,
  seedDemoProject,
  serializeGisOverlay,
  wantsGisOverlay,
  type OsmElementLike,
  type SiteContext,
} from '@realytica/shared';

const PIN = { lat: 12.97, lng: 77.59 };

function metresLng(m: number, lat = PIN.lat): number {
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
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [ring.map((p) => [p.lng, p.lat])],
  });
}

function withPin() {
  const project = seedDemoProject();
  project.siteContext = {
    caseId: project.id,
    location: {
      point: PIN,
      precision: 'rooftop',
      queried: project.siteAddress ?? project.location,
      resolvedAddress: 'Harohalli, Kanakapura Road',
      provider: 'stub',
      resolvedAt: '2026-08-31T00:00:00.000Z',
      caveat: 'Geocoded pin — not a surveyed parcel boundary.',
    },
    amenities: [],
    streetView: null,
    gaps: [],
    provider: 'stub',
    builtAt: '2026-08-31T00:00:00.000Z',
  } satisfies SiteContext;
  return project;
}

describe('GIS context overlay', () => {
  it('is CONTEXT, not RMP, and does not write registers', () => {
    const project = withPin();
    const evidenceBefore = project.evidence.length;
    const findingsBefore = project.findings.length;
    const graphBefore = buildProjectGraph(project).nodes.length;
    const tank = rect(PIN.lng + metresLng(30), PIN.lat - metresLat(20), 80, 80);
    const read = compareProjectGis(project, {
      osm: {
        features: [
          { id: 'osm_tank', kind: 'osm_water', name: 'Harohalli kere', ring: tank },
          {
            id: 'osm_farm',
            kind: 'osm_landuse',
            name: 'farmland',
            landuse: 'farmland',
            ring: rect(PIN.lng - metresLng(200), PIN.lat - metresLat(200), 500, 500),
          },
        ],
        fetchedAt: '2026-08-31T00:00:00.000Z',
      },
    });
    assert.equal(read.notStatute, true);
    assert.equal(read.notEvidence, true);
    assert.equal(read.notRmpGeometry, true);
    assert.ok(read.pin);
    assert.ok(read.hits.some((h) => h.code === 'not_rmp'));
    assert.ok(read.hits.some((h) => h.code === 'not_drain_class'));
    assert.ok(read.hits.some((h) => h.code === 'osm_landuse_at_pin' && /farmland/.test(h.text)));
    assert.ok(read.hits.some((h) => h.code === 'osm_water_near' && h.standing === 'context'));
    assert.doesNotMatch(serializeGisOverlay(read), /RMP hatch for this survey number was intersected/i);
    assert.equal(project.evidence.length, evidenceBefore);
    assert.equal(project.findings.length, findingsBefore);
    assert.equal(buildProjectGraph(project).nodes.length, graphBefore);
  });

  it('flags a survey sketch overlapping OSM water without filing it as evidence', () => {
    const project = withPin();
    const before = project.evidence.length;
    const survey = rect(PIN.lng, PIN.lat, 100, 80);
    applySurveyBoundary(project, geojson(survey), 'surveyor.geojson', 'tester');
    assert.equal(project.evidence.length, before);
    assert.ok(project.surveyBoundary);

    const lake = rect(PIN.lng + metresLng(20), PIN.lat + metresLat(10), 120, 120);
    const read = compareProjectGis(project, {
      osm: {
        features: [{ id: 'osm_lake', kind: 'osm_water', name: 'tank', ring: lake }],
      },
    });
    const overlap = read.hits.find((h) => h.code === 'osm_water_overlap');
    assert.ok(overlap);
    assert.equal(overlap.standing, 'context');
    assert.match(overlap.text, /not a classified lake|rajakaluve/i);
    assert.equal(project.evidence.length, before);
  });

  it('parses Overpass ways into water, waterway and landuse features', () => {
    const elements: OsmElementLike[] = [
      {
        type: 'way',
        id: 1,
        tags: { natural: 'water', name: 'Kere' },
        geometry: [
          { lat: 12.97, lon: 77.59 },
          { lat: 12.97, lon: 77.591 },
          { lat: 12.971, lon: 77.591 },
          { lat: 12.971, lon: 77.59 },
          { lat: 12.97, lon: 77.59 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { waterway: 'drain' },
        geometry: [
          { lat: 12.97, lon: 77.59 },
          { lat: 12.972, lon: 77.592 },
        ],
      },
      {
        type: 'way',
        id: 3,
        tags: { landuse: 'residential' },
        geometry: [
          { lat: 12.96, lon: 77.58 },
          { lat: 12.96, lon: 77.60 },
          { lat: 12.98, lon: 77.60 },
          { lat: 12.98, lon: 77.58 },
          { lat: 12.96, lon: 77.58 },
        ],
      },
      { type: 'relation', id: 9, tags: { natural: 'water' }, geometry: [] },
    ];
    const features = osmElementsToFeatures(elements);
    assert.equal(features.length, 3);
    assert.equal(features[0].kind, 'osm_water');
    assert.ok(features[0].ring);
    assert.equal(features[1].kind, 'osm_waterway');
    assert.ok(features[1].line);
    assert.equal(features[2].kind, 'osm_landuse');
    assert.equal(features[2].landuse, 'residential');
  });

  it('chat about the GIS map does not file OSM and points at Overview', () => {
    const project = seedDemoProject();
    const before = project.evidence.length;
    assert.equal(wantsGisOverlay('Show the GIS overlay on the map'), true);
    const side = handleChatSides(project, 'Show the GIS overlay on the map', 'tester');
    assert.ok(side);
    assert.equal(project.evidence.length, before);
    assert.equal(side.pane, 'overview');
    assert.match(side.text, /not the RMP/i);
    assert.match(side.text, /OpenStreetMap|OSM/i);
    assert.ok(side.proposals.some((p) => p.kind === 'open_connector'));
  });

  it('Harohalli sits on BMRDA maps, never BBMP WMS, and refuses DPPlans / GISMaps / RMP-2031 as overlay', () => {
    const project = seedDemoProject();
    const read = compareProjectGis(project, {
      places: {
        provider: 'stub',
        configured: true,
        query: 'Harohalli',
        point: { lat: 12.676, lng: 77.457 },
        amenities: [],
        gaps: [],
      },
    });
    assert.equal(read.maps.realm, 'bmrda');
    assert.ok(read.maps.sittings.some((s) => s.key === 'bmrda_maps'));
    assert.ok(read.maps.sittings.some((s) => s.key === 'bda_rmp'));
    assert.equal(read.maps.liveOverlays.length, 0);
    assert.ok(read.maps.refused.some((s) => s.key === 'dpplans_bengaluru' && s.standing === 'commercial'));
    assert.ok(read.maps.refused.some((s) => s.key === 'gismaps_bbmp_ward' && s.standing === 'unofficial'));
    assert.ok(read.maps.refused.some((s) => s.key === 'opencity_rmp_2031' && s.standing === 'withdrawn'));
    assert.match(serializeGisOverlay(read), /Planning realm: bmrda/);
    assert.match(serializeGisOverlay(read), /DPPlans is a paid/);
    assert.doesNotMatch(serializeGisOverlay(read), /RMP hatch for this survey number was intersected/i);
  });

  it('a pin inside BBMP can take civic WMS lakes/parks, still not RMP', () => {
    const project = seedDemoProject();
    project.jurisdiction = 'Karnataka / BBMP';
    project.location = 'Koramangala';
    project.siteAddress = 'Koramangala 4th Block';
    project.name = 'Koramangala infill';
    const read = compareProjectGis(project, {
      places: {
        provider: 'stub',
        configured: true,
        query: 'Koramangala',
        point: { lat: 12.93, lng: 77.63 },
        amenities: [],
        gaps: [],
      },
    });
    assert.equal(read.maps.realm, 'bbmp');
    assert.ok(read.maps.liveOverlays.some((s) => s.key === 'bbmp_gis' && Boolean(s.wms)));
    assert.ok(read.maps.sittings.some((s) => s.key === 'bbmp_gis'));
    assert.equal(read.notRmpGeometry, true);
  });

  it('BDA reference seed sits in BBMP, takes WMS, and points at RMP 2015 sheets', () => {
    const project = seedBdaReferenceProject();
    const read = compareProjectGis(project);
    assert.equal(read.maps.realm, 'bbmp');
    assert.ok(read.pin);
    assert.ok(read.pin && read.pin.lat > 12.82 && read.pin.lat < 13.16);
    assert.ok(read.maps.liveOverlays.some((s) => s.key === 'bbmp_gis' && Boolean(s.wms)));
    assert.ok(read.maps.sittings.some((s) => s.key === 'bda_rmp'));
    assert.ok(read.maps.sittings.some((s) => s.key === 'opencity_rmp_2015'));
    assert.ok(read.maps.sittings.some((s) => s.key === 'bbmp_gis'));
    assert.ok(!read.maps.sittings.some((s) => s.key === 'bmrda_maps'));
    assert.equal(read.notRmpGeometry, true);
    assert.match(serializeGisOverlay(read), /Planning realm: bbmp/);
  });

  it('parses civic KML, clips a Koramangala pin to ward and lake, and does not file it', () => {
    const project = seedDemoProject();
    project.jurisdiction = 'Karnataka / BBMP';
    project.location = 'Koramangala';
    project.siteAddress = 'Koramangala 4th Block';
    project.name = 'Koramangala infill';
    const before = project.evidence.length;
    const wardKml = `<?xml version="1.0"?><kml><Placemark><name>Ward 151 Koramangala</name><coordinates>77.62,12.92,0 77.64,12.92,0 77.64,12.94,0 77.62,12.94,0 77.62,12.92,0</coordinates></Placemark></kml>`;
    const lakeKml = `<?xml version="1.0"?><kml><Placemark><name>Koramangala kere</name><coordinates>77.629,12.929,0 77.632,12.929,0 77.632,12.932,0 77.629,12.932,0 77.629,12.929,0</coordinates></Placemark></kml>`;
    const wards = parseNamedPolygons(wardKml, 'ward');
    const lakes = parseNamedPolygons(lakeKml, 'lake');
    assert.equal(wards.length, 1);
    assert.equal(lakes.length, 1);
    const survey = rect(77.63, 12.93, 80, 80);
    applySurveyBoundary(project, geojson(survey), 'surveyor.geojson', 'tester');
    const read = compareProjectGis(project, {
      places: {
        provider: 'stub',
        configured: true,
        query: 'Koramangala',
        point: { lat: 12.93, lng: 77.63 },
        amenities: [],
        gaps: [],
      },
      civic: { lakes, wards },
    });
    assert.ok(read.features.some((f) => f.kind === 'civic_ward' && /Koramangala/.test(f.name ?? '')));
    assert.ok(read.features.some((f) => f.kind === 'civic_lake' && /kere/.test(f.name ?? '')));
    assert.ok(read.hits.some((h) => h.code === 'civic_ward' && h.standing === 'context'));
    assert.ok(read.hits.some((h) => h.code === 'civic_lake_overlap' && h.severity === 'flag' && h.standing === 'context'));
    assert.match(serializeGisOverlay(read), /OpenCity civic/);
    assert.equal(project.evidence.length, before);
    assert.equal(read.notRmpGeometry, true);
  });

  it('does not clip BBMP civic layers or WMS onto a Harohalli pin, and lists withdrawn 2031 sheets as links only', () => {
    const project = seedDemoProject();
    const before = project.evidence.length;
    const bbmpWard = parseNamedPolygons(
      `<?xml version="1.0"?><kml><Placemark><name>Ward 151 Koramangala</name><coordinates>77.62,12.92,0 77.64,12.92,0 77.64,12.94,0 77.62,12.94,0 77.62,12.92,0</coordinates></Placemark></kml>`,
      'ward',
    );
    const read = compareProjectGis(project, {
      places: {
        provider: 'stub',
        configured: true,
        query: 'Harohalli',
        point: { lat: 12.676, lng: 77.457 },
        amenities: [],
        gaps: [],
      },
      civic: { lakes: [], wards: bbmpWard },
      withdrawnSheets: [
        { name: 'RMP 2031 Kanakapura LPA proposed land use', url: 'https://data.opencity.in/dataset/bda-revised-master-plan-2031/kanakapura.pdf' },
        { name: 'RMP 2031 Whitefield zoning', url: 'https://data.opencity.in/dataset/bda-revised-master-plan-2031/whitefield.pdf' },
      ],
    });
    assert.equal(read.maps.realm, 'bmrda');
    assert.equal(read.maps.liveOverlays.length, 0);
    assert.equal(read.features.filter((f) => f.kind === 'civic_ward' || f.kind === 'civic_lake').length, 0);
    assert.ok(read.withdrawnSheets.some((s) => /Kanakapura/.test(s.name) && s.standing === 'withdrawn'));
    assert.ok(!read.withdrawnSheets.some((s) => /Whitefield/.test(s.name)));
    assert.ok(read.hits.some((h) => h.code === 'withdrawn_sheet' && /not in force/i.test(h.text)));
    assert.ok(!read.features.some((f) => /2031|Kanakapura LPA/.test(f.name ?? '')));
    assert.match(serializeGisOverlay(read), /Withdrawn \(not in force\): RMP 2031 Kanakapura/);
    assert.equal(project.evidence.length, before);
  });
});
