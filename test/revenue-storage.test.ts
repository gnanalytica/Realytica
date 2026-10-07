/**
 * What a site's reads weigh on the project's record, and how they are stored.
 *
 * A project is stored and sent as one piece, and the host will not send a
 * piece much over four megabytes. A read of the state's map carries the
 * outline of every tank within a kilometre, and the parcel next door carries
 * the same tanks. These pin how that is kept from sinking the record: the
 * first read whole where the code in production looks for it, every other
 * read with its shapes kept once, nothing lost on the way back out, and a
 * record stored the older way still read.
 *
 * The reads here are shaped like a real one — a handful of land-use polygons
 * of a couple of hundred vertices each, written out to the last decimal as
 * the state's server writes them — and are the weight a real read was
 * measured at. Every number and place is made up.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  applyRevenueMap,
  buildBoundary,
  clearRevenueMap,
  compareProjectGis,
  createProject,
  rememberAskedSurveyNo,
  removeRevenueMapRead,
  revenueReads,
  revenueSiteBrief,
  type DdProject,
  type GeoPoint,
  type RevenueMapFactor,
  type RevenueMapFeature,
  type RevenueMapInsight,
  type RevenueMapRead,
} from '@realytica/shared';
import { PROJECT_RECORD_CEILING_BYTES, recordBytes, roomForRead } from '../apps/api/src/gis/revenue-map';

const ORIGIN = { lat: 12.9698131, lng: 77.7499721 };
const east = (m: number) => m / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
const north = (m: number) => m / 111_320;

/** An outline as the state's land-use layer holds one: many vertices, none of them round. */
function outline(eastM: number, northM: number, radiusM: number, vertices: number, seed: number): GeoPoint[] {
  const ring = Array.from({ length: vertices }, (_, n) => {
    const angle = (2 * Math.PI * n) / vertices;
    const reach = radiusM * (1 + 0.25 * Math.sin(seed + n * 1.7) + 0.1 * Math.cos(seed * 3 + n * 0.37));
    return { lat: ORIGIN.lat + north(northM + Math.sin(angle) * reach), lng: ORIGIN.lng + east(eastM + Math.cos(angle) * reach) };
  });
  return [...ring, ring[0]!];
}

/** The tanks within a kilometre of the site. Every parcel of it is read against the same six. */
const TANKS = [
  { name: 'Hosakere', at: [520, 310], radius: 140, vertices: 196 },
  { name: 'Kalyani', at: [-640, 120], radius: 90, vertices: 168 },
  { name: null, at: [230, -710], radius: 70, vertices: 152 },
  { name: 'Dodda Kere', at: [-380, -560], radius: 180, vertices: 214 },
  { name: null, at: [760, -240], radius: 60, vertices: 148 },
  { name: 'Chikka Kere', at: [-150, 820], radius: 110, vertices: 176 },
].map((tank, n) => ({ ...tank, ring: outline(tank.at[0]!, tank.at[1]!, tank.radius, tank.vertices, n + 1) }));

/** A stream within reach of a parcel. Neighbours share one; every so often a parcel meets another. */
const stream = (n: number) => outline(120 + n * 240, 60 + (n % 2) * 40, 45, 84, 20 + n);

const factor = (code: string, label: string, distanceM: number): RevenueMapFactor => ({
  code,
  label,
  direction: 'down',
  severity: 'high',
  headline: `${label}: the nearest edge lies about ${Math.round(distanceM)} m from the boundary of the plot, by the state's land-use survey of 2023.`,
  detail: 'A plan inside the buffer the rules set round it is refused sanction, and a lender asks for the tank or drain authority to say in writing where the buffer runs before the land is taken as security.',
  impactLowPct: -12,
  impactHighPct: -4,
  layerKey: 'LULC/State_LULC_2023/MapServer/0',
  source: 'Karnataka GIS (K-GIS) — state land use 2023, water bodies',
  distanceM,
});

const insight = (featureId: string | null, title: string, distanceM: number, kind: RevenueMapInsight['kind']): RevenueMapInsight => ({
  code: `${featureId ?? title}:${Math.round(distanceM)}`,
  kind,
  layerKey: 'ka_water',
  featureId,
  title,
  status: 'Mapped as a tank in the 2023 land-use survey',
  distanceM,
  direction: 'north-east',
  meaning: `About ${Math.round(distanceM)} m to the north-east of the plot. The survey knows where the water is, not what the tank is called in the revenue record or whether its bed is encroached.`,
  source: 'Karnataka GIS (K-GIS) — state land use 2023, water bodies',
});

/** One parcel's read, `at` plots along from the first, as the engine hands it over. */
function read(surveyNo: string, at: number, readAt = `2026-10-01T06:${String(at).padStart(2, '0')}:00.000Z`): RevenueMapRead {
  const eastM = at * 70;
  const distance = (tank: (typeof TANKS)[number]) => Math.hypot(tank.at[0]! - eastM, tank.at[1]!) - tank.radius;
  const near = [...TANKS].sort((a, b) => distance(a) - distance(b));
  const beside = Math.floor(at / 4);
  const features: RevenueMapFeature[] = [
    ...near.map((tank, n) => ({ id: `ka_water:${n}`, kind: 'state_water' as const, layerKey: 'ka_water', name: tank.name, distanceM: distance(tank), contains: false, ring: tank.ring })),
    { id: 'ka_drain:0', kind: 'state_drain' as const, layerKey: 'ka_drain', name: null, distanceM: 35 + (at % 4) * 20, contains: false, ring: stream(beside) },
  ];
  return {
    readAt,
    state: 'KA',
    parcelRef: `kgis:2999999999:${surveyNo}`,
    surveyNo,
    village: 'Hosakere',
    mandal: 'Anekal',
    district: 'Bengaluru (Urban)',
    sourceLabel: 'K-GIS village map',
    rings: [outline(eastM, 0, 30, 26, 100 + at)],
    centre: { lat: ORIGIN.lat, lng: ORIGIN.lng + east(eastM) },
    areaSqm: 2400 + at * 37.25,
    registerExtent: null,
    classification: 'Hosakere-1 hobli',
    prohibitedCategory: null,
    prohibitedRegisterUnjoined: true,
    features,
    factors: [
      factor('water_body_near', 'Near a water body', distance(near[0]!)),
      factor('ka_drain_buffer', 'Inside a drain buffer', 35 + (at % 4) * 20),
      factor('water_body_cluster', 'Several tanks within a kilometre', distance(near[1]!)),
      factor('zone_agricultural', 'Zoned agricultural in the master plan', 0),
      factor('zone_mix', 'Other zones within 400 m', 0),
      factor('guidance_gap', 'No road-wise guidance value', 0),
    ],
    insights: [
      ...near.map((tank, n) => insight(`ka_water:${n}`, tank.name ?? 'Tank', distance(tank), 'existing')),
      insight('ka_drain:0', 'Stream', 35 + (at % 4) * 20, 'risk'),
      insight(null, 'Agricultural zone', 0, 'zoning'),
      insight(null, 'Also zoned within 400 m: residential, commercial', 0, 'zoning'),
    ],
    anchor: { guidancePerUnit: 42_000, unit: 'sqyd', locality: 'Hosakere', note: 'Kaveri guidance value for the village, as published and captured on the date the engine ships with.' },
    emptyLayers: [],
    unreadLayers: [],
  };
}

function township(): DdProject {
  return createProject({ name: 'Hosakere township', type: 'residential', location: 'Hosakere', city: 'Bengaluru' }, 'RYT-S1');
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
/** A project as another process finds it in the store. */
const fromStore = (p: DdProject) => JSON.parse(JSON.stringify(p)) as DdProject;
/** The reads of the first `count` parcels of the site. */
const parcels = (count: number) => Array.from({ length: count }, (_, at) => read(String(71 + at), at));

function site(count: number): DdProject {
  const p = township();
  for (const r of parcels(count)) applyRevenueMap(p, r, 'tester');
  return p;
}

describe('what a read weighs', () => {
  it('is, in this fixture, what a real read was measured at', () => {
    const one = bytes(read('71', 0));
    assert.ok(one > 60_000 && one < 75_000, `${one} bytes: a real read measured 65 to 70 KB`);
  });

  it('is its own weight for the first parcel, kept once', () => {
    const empty = bytes(township());
    const one = bytes(site(1)) - empty;
    assert.ok(one < bytes(read('71', 0)) + 2_000, `${one} bytes for the first read, with its boundary and its line on the audit trail`);
    // The second read does not bring a second copy of the first.
    const second = bytes(site(2)) - bytes(site(1));
    assert.ok(second < 12_000, `${second} bytes for the second parcel: where every read was kept whole it was the first read again and the second, ${2 * bytes(read('72', 1))} bytes`);
  });

  it('is under a fifth of that for every parcel after, where it was the whole read each time', () => {
    const whole = bytes(read('71', 0));
    const two = bytes(site(2));
    const all = bytes(site(74));
    const each = (all - two) / 72;
    // Measured here at about 12 KB: a kilobyte of outline, a kilobyte of notes of what lies near and where its shape is kept,
    // eight of what the engine says of this parcel in sentences that carry its own distances, and a new stream now and then.
    assert.ok(each < 14_000 && each < whole / 5, `${Math.round(each)} bytes a parcel, measured over 72 of them, against ${whole} for a read kept whole`);
    assert.ok(each > 6_000, `${Math.round(each)} bytes a parcel: its outline, and what the engine and the register say of it, are its own`);
    // Seventy-four parcels, the number one real project's papers state: about a megabyte, where kept whole they were five.
    const reads = all - bytes(township());
    assert.ok(reads < 1_100_000, `${reads} bytes for 74 parcels`);
    assert.ok(74 * whole > 4_500_000, 'kept whole, they were more than the host sends in one piece');
  });
});

describe('how several reads are stored', () => {
  it('keeps the first read whole where the code in production looks, and nothing of it a second time', () => {
    const p = fromStore(site(3));
    assert.deepEqual(p.revenueMap, read('71', 0), 'the one read that code knows, exactly as the engine gave it');
    const [first, second] = p.revenueMaps ?? [];
    assert.deepEqual([first?.parcelRef, first?.readAt], [p.revenueMap?.parcelRef, p.revenueMap?.readAt], 'the first place stands for it');
    assert.deepEqual([first?.features, first?.factors, first?.insights, first?.rings], [[], [], [], []], 'and repeats none of what it found');
    assert.equal(p.revenueMaps?.length, 3);

    // A tank the first read holds is not written out again for the second.
    const tank = second!.features.find((f) => f.kind === 'state_water')!;
    assert.equal(tank.ring, undefined);
    assert.match(tank.shape ?? '', /^\^ka_water:\d$/);
    assert.equal(p.revenueShapes, undefined, 'three neighbours meet no shape the first does not hold');
  });

  it('keeps once a shape the first read does not hold, however many parcels lie beside it', () => {
    const p = fromStore(site(12));
    // Parcels five to eight lie beside a second stream, nine to twelve beside a third.
    assert.deepEqual(Object.keys(p.revenueShapes ?? {}), ['s0', 's1']);
    assert.deepEqual(p.revenueShapes?.s0, { ring: stream(1) });
    const beside = (p.revenueMaps ?? []).filter((r) => r.features.some((f) => f.shape === 's0')).map((r) => r.surveyNo);
    assert.deepEqual(beside, ['75', '76', '77', '78']);
  });

  it('hands every read back as the engine gave it', () => {
    for (const count of [1, 2, 3, 12]) {
      const p = site(count);
      assert.deepEqual(revenueReads(p), parcels(count));
      assert.deepEqual(revenueReads(fromStore(p)), parcels(count), 'and the same out of the store');
    }
  });

  it('draws and tells every parcel’s layers from what is stored once', () => {
    const p = fromStore(site(12));
    const overlay = compareProjectGis(p, { revenue: revenueReads(p) });
    assert.equal(overlay.features.filter((f) => f.kind === 'state_water').length, 6, 'six tanks, each once, each with its outline');
    assert.equal(overlay.features.filter((f) => f.kind === 'state_drain').length, 3);
    assert.ok(overlay.features.filter((f) => f.kind === 'state_water' || f.kind === 'state_drain').every((f) => (f.ring?.length ?? 0) > 20));
    assert.equal(revenueSiteBrief(p)!.parcels.length, 12);
  });

  it('reads a record stored before this, with every read whole', () => {
    const [a, b, c] = parcels(3);
    const p = township();
    // As it was written then: the first read where it always was, and every read whole in the list, the first among them.
    p.revenueMap = a;
    p.revenueMaps = [a!, b!, c!];
    p.surveyBoundary = buildBoundary(a!.rings[0]!, 'revenue_map', a!.readAt, `${a!.sourceLabel}, Sy. ${a!.surveyNo}`) ?? undefined;
    const old = fromStore(p);
    assert.deepEqual(revenueReads(old), [a, b, c]);

    // The next read kept here stores it the lighter way, and loses nothing.
    const before = bytes(old);
    applyRevenueMap(old, read('74', 3), 'tester');
    assert.deepEqual(revenueReads(fromStore(old)), parcels(4));
    assert.ok(bytes(old) < before - 100_000, `${before} bytes before a fourth parcel was added, ${bytes(old)} after`);
  });

  it('hands the code in production a whole read when the first is taken off, and when a number is remembered', () => {
    const p = fromStore(site(12));
    removeRevenueMapRead(p, read('71', 0).parcelRef, 'tester');
    assert.deepEqual(p.revenueMap, read('72', 1), 'the next read, with every shape on it');
    assert.deepEqual(revenueReads(fromStore(p)), parcels(12).slice(1));

    rememberAskedSurveyNo(p, read('75', 4).parcelRef, '75/2');
    assert.deepEqual(p.revenueMap, read('72', 1));
    assert.deepEqual(revenueReads(fromStore(p)).map((r) => r.askedAs ?? []), parcels(12).slice(1).map((r) => (r.surveyNo === '75' ? ['75/2'] : [])));

    // Down to one parcel, it is one read and nothing else.
    for (const r of parcels(12).slice(2)) removeRevenueMapRead(p, r.parcelRef, 'tester');
    assert.deepEqual([p.revenueMap, p.revenueMaps, p.revenueShapes], [read('72', 1), undefined, undefined]);
  });

  it('never puts another tank’s outline on a feature when a build that knows the list, but not this way of keeping it, has written', () => {
    const shapeOf = (f: RevenueMapFeature) => f.ring ?? f.line ?? f.point;
    const whole = parcels(13);

    // That build adds a read: the first read whole in the list's first place, the rest as it found them, the new one whole.
    const added = fromStore(site(12));
    added.revenueMaps = [added.revenueMap!, ...added.revenueMaps!.slice(1), whole[12]!];
    assert.deepEqual(revenueReads(added), whole, 'the first read is still the one the shapes are on, and every read comes back whole');

    // It takes the first read off: the second, as stored, is now where the first was, and the shapes it noted are on a read that is gone.
    const removed = fromStore(site(12));
    removed.revenueMap = removed.revenueMaps![1];
    removed.revenueMaps = removed.revenueMaps!.slice(1);
    const back = revenueReads(removed);
    assert.deepEqual(back.map((r) => r.surveyNo), whole.slice(1, 12).map((r) => r.surveyNo));
    for (const [at, r] of back.entries()) {
      for (const [n, f] of r.features.entries()) {
        const true_ = shapeOf(whole[at + 1]!.features[n]!);
        if (shapeOf(f) !== undefined) assert.deepEqual(shapeOf(f), true_, `Sy. ${r.surveyNo}: a shape that is given is the feature's own`);
      }
    }
    assert.ok(back[5]!.features.some((f) => f.kind === 'state_drain' && shapeOf(f) !== undefined), 'a shape kept for the site is still found');
    assert.ok(back[5]!.features.some((f) => f.kind === 'state_water' && shapeOf(f) === undefined), 'one that was on the read that is gone is left off, and not guessed');

    // It reads the first parcel again, and the state's layer now lists the tanks in another order: the same ids, other tanks.
    const again = fromStore(site(12));
    const fresh = read('71', 0, '2026-10-05T06:00:00.000Z');
    const tanks = fresh.features.filter((f) => f.kind === 'state_water');
    fresh.features = fresh.features.map((f) => (f.kind === 'state_water' ? { ...tanks[(tanks.indexOf(f) + 1) % tanks.length]!, id: f.id } : f));
    again.revenueMap = fresh;
    again.revenueMaps = [fresh, ...again.revenueMaps!.slice(1)];
    for (const [at, r] of revenueReads(again).entries()) {
      if (at === 0) continue;
      for (const [n, f] of r.features.entries()) {
        if (shapeOf(f) !== undefined) assert.deepEqual(shapeOf(f), shapeOf(whole[at]!.features[n]!), `Sy. ${r.surveyNo}: not the outline of whichever tank now carries that id`);
      }
    }
  });

  it('takes a read as it finds it, where a record holds less of one than the engine gives', () => {
    // A record is whatever is in the store. One with no features on its read is still a read, and still opens.
    const bare = { readAt: '2026-10-01T06:00:00.000Z', state: 'KA', parcelRef: 'kgis:2999999999:71', surveyNo: '71', village: 'Hosakere', mandal: 'Anekal', district: 'Bengaluru (Urban)' } as RevenueMapRead;
    const p = township();
    p.revenueMap = bare;
    assert.deepEqual(revenueReads(p), [bare]);
    p.revenueMaps = [bare, { ...bare, parcelRef: 'kgis:2999999999:72', surveyNo: '72' }];
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['71', '72']);
  });

  it('leaves nothing behind when the reads are cleared, here or by the code in production', () => {
    const p = fromStore(site(12));
    clearRevenueMap(p, 'tester');
    assert.deepEqual([p.revenueMap, p.revenueMaps, p.revenueShapes], [undefined, undefined, undefined]);

    // That code clears the one read it knows, and reads another parcel. The list and the shapes it left are not read back.
    const q = fromStore(site(12));
    q.revenueMap = read('95', 30, '2026-10-04T06:00:00.000Z');
    assert.deepEqual(revenueReads(q), [read('95', 30, '2026-10-04T06:00:00.000Z')]);
    applyRevenueMap(q, read('96', 31, '2026-10-04T07:00:00.000Z'), 'tester');
    assert.deepEqual(revenueReads(fromStore(q)).map((r) => r.surveyNo), ['95', '96']);
    assert.equal(q.revenueMaps?.length, 2, 'and the next read kept here writes them afresh');
  });
});

describe('room on the record for a read', () => {
  /** The record filled by what else a project holds, to within `short` bytes of what it may weigh. */
  function filled(p: DdProject, short: number): DdProject {
    const notes = addEvidence(p, { title: 'A long document', kind: 'document', status: 'received' }, 'tester');
    notes.extractionNotes = 'x'.repeat(PROJECT_RECORD_CEILING_BYTES - recordBytes(p) - short);
    return p;
  }
  const LATER = '2026-10-05T06:00:00.000Z';

  it('weighs a parcel read again, and keeps it only at the weight it had', () => {
    const p = filled(site(3), 150);
    assert.ok(recordBytes(p) < PROJECT_RECORD_CEILING_BYTES);
    // The same parcel as it was: one more line on the audit trail takes the record over, and that is not what filled it.
    assert.deepEqual(roomForRead(p, read('72', 1, LATER)), { fits: true });

    // The same parcel, come back with the outline of a reservoir it had not held.
    const again = read('72', 1, LATER);
    const heavier = { ...again, features: [...again.features, { id: 'ka_water:9', kind: 'state_water' as const, layerKey: 'ka_water', name: 'Reservoir', distanceM: 940, contains: false, ring: outline(900, 900, 400, 420, 77) }] };
    const refused = roomForRead(p, heavier);
    assert.equal(refused.fits, false);
    assert.equal(
      refused.fits ? '' : refused.error,
      '3 parcels are kept on this project. Sy. 72 was read again and the fresh read is not kept: it is heavier than the read it would replace, and with it the project’s record would weigh over 2.5 MB, and a record much heavier than that stops opening. The read already kept stays as it was.',
    );
    assert.deepEqual(roomForRead(site(3), heavier), { fits: true }, 'on a record with room it is kept like any read');
  });

  it('says a record with no parcel kept is already too heavy to take one, and does not ask for a read to be removed', () => {
    const p = filled(township(), 150);
    const refused = roomForRead(p, read('71', 0));
    assert.equal(
      refused.fits ? '' : refused.error,
      'No parcel is kept on this project, and its record is already too heavy to take one. Sy. 71 was read from the map and is not kept: with it the project’s record would weigh over 2.5 MB, and a record much heavier than that stops opening. It is what else the file holds that fills it.',
    );
    // With one kept, there is one to remove, and the words say so.
    const one = filled(site(1), 150);
    const second = roomForRead(one, read('72', 1));
    assert.match(second.fits ? '' : second.error, /^1 parcel is kept on this project\. Sy\. 72 was read from the map and is not kept: .* Remove a read that is not needed to make room\.$/);
  });
});
