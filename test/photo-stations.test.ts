/**
 * Photographs tied to a place and a period.
 *
 * A station is a place shot again and again. A photograph of either store
 * carries its station and its place; a station's standing is read from the
 * days its shots were taken, by the day it is in India; a shot reaches a
 * station by a pick on the phone or by its own position, and otherwise
 * waits for a person; what is due is one line under Needs you; a milestone
 * says which of its photographs are missing; the series puts two periods
 * side by side; and a report prints a station's shot for its period.
 *
 * The project, the people and the photographs are invented. No model is
 * called: a model's picks are written in by hand where one is needed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_PHOTOGRAPHED,
  STATIONS_SET,
  STATION_MATCH_M,
  STATION_ROUND_SET,
  addEvidence,
  addFieldRecord,
  addMilestones,
  attachEvidenceFile,
  fieldCatalog,
  fileSiteLogPhoto,
  functionReportTemplate,
  generateReport,
  indiaToday,
  logSiteEntry,
  matchStation,
  metresBetween,
  milestonePhotoChecklist,
  milestonePhotoSaid,
  milestonesShortOfPhotos,
  ownerPack,
  ownerPackPeriod,
  photoObservationOfPicks,
  photoPeriod,
  photoSeries,
  photoStations,
  placeEntryShots,
  placeFault,
  placeSaid,
  projectPhotos,
  projectShots,
  projectView,
  readFunctionFields,
  readSheet,
  resolveReportBlock,
  resolveStationPhotos,
  seedDemoProject,
  seriesPair,
  setMilestonePercent,
  setShotPlace,
  shotDay,
  shotsOfEvidence,
  stationPlace,
  stationPoint,
  stationRound,
  stationShots,
  stationStanding,
  stationsDue,
  templateBlocks,
  createProject,
  type DdProject,
  type ProjectGrant,
  type SiteLogEntry,
  type StationShot,
} from '@realytica/shared';

const OWNER = 'dev@builders.example';
const ASHA = 'Asha Rao (asha@builders.example)';
/** A Tuesday in the middle of a month, at noon in India. */
const NOW = new Date('2026-10-13T06:30:00Z');
const SITE = { lat: 12.9716, lng: 77.5946 };
/** A point so many metres north of another. */
const north = (of: { lat: number; lng: number }, metres: number) => ({ lat: of.lat + metres / 111_194.93, lng: of.lng });

function add(project: DdProject, set: string, values: Record<string, unknown>): string {
  const out = addFieldRecord(project, set, values, OWNER);
  assert.deepEqual(out.rejected, [], set);
  return out.record!.id;
}

let photoNo = 0;
/** A day's entry from site with one photograph, placed by code as the route does. */
function shoot(project: DdProject, date: string, photo: { stationId?: string; point?: { lat: number; lng: number }; takenAt?: string } = {}, author = ASHA): SiteLogEntry {
  photoNo += 1;
  const { entry } = logSiteEntry(project, { clientId: `client-${photoNo}-${date}`, date, photos: [{ storageKey: `site_${project.id}_${photoNo}.png`, fileName: `shot-${photoNo}.png`, mimeType: 'image/png', takenAt: photo.takenAt ?? `${date}T05:00:00Z`, ...(photo.point ? { point: photo.point } : {}), ...(photo.stationId ? { stationId: photo.stationId } : {}) }] }, author);
  placeEntryShots(project, entry);
  return entry;
}

function filePhoto(project: DdProject, title: string, takenAt: string): { evidenceId: string; fileId: string } {
  photoNo += 1;
  const row = addEvidence(project, { title, kind: 'photograph', status: 'received' }, OWNER);
  const file = attachEvidenceFile(project, row.id, { fileName: `${title}.png`, mimeType: 'image/png', sizeBytes: 10, storageKey: `doc_${photoNo}.png`, capture: { takenAt, takenAtSource: 'stated', zone: 'north boundary' } }, OWNER);
  return { evidenceId: row.id, fileId: file.id };
}

interface Site {
  project: DdProject;
  block: string;
  unit: string;
  slab: string;
  finishes: string;
  north: string;
  stair: string;
  gate: string;
}

/** A project with a building, a unit, two milestones and three stations: two monthly on the slab's milestone, one weekly at the gate. */
function site(): Site {
  const project = createProject({ name: 'Canal Road flats', type: 'residential', location: 'Canal Road', city: 'Kadamba' }, 'RYT-PHO');
  const block = add(project, 'shared.buildings', { name: 'Block A' });
  const unit = add(project, 'shared.units', { number: 'A-301' });
  const [slab, finishes] = addMilestones(project, [{ name: 'Slab, level 3', weight: 10 }, { name: 'Finishes', weight: 10 }], OWNER).map((milestone) => milestone.id) as [string, string];
  const northId = add(project, STATIONS_SET, { label: 'North corner', building: block, floor: 'Level 3', element: 'slab', milestone: slab, needed: true, every: 'month' });
  const stair = add(project, STATIONS_SET, { label: 'Stair core', building: block, milestone: slab, needed: true, every: 'month' });
  const gate = add(project, STATIONS_SET, { label: 'Main gate', every: 'week' });
  return { project, block, unit, slab, finishes, north: northId, stair, gate };
}

describe('a period', () => {
  it('is a calendar month, a quarter of the financial year, or a week from Monday, and each is asked for by a shift', () => {
    assert.deepEqual(photoPeriod('2026-10-13', 'month'), { key: '2026-10', from: '2026-10-01', to: '2026-10-31', said: 'October 2026' });
    assert.deepEqual(photoPeriod('2026-10-13', 'month', -1), { key: '2026-09', from: '2026-09-01', to: '2026-09-30', said: 'September 2026' });
    assert.deepEqual(photoPeriod('2026-01-31', 'month', -2), { key: '2025-11', from: '2025-11-01', to: '2025-11-30', said: 'November 2025' });
    assert.deepEqual(photoPeriod('2026-10-13', 'quarter'), { key: 'FY2026-Q3', from: '2026-10-01', to: '2026-12-31', said: 'Q3 FY 2026-27' });
    assert.deepEqual(photoPeriod('2026-10-13', 'quarter', -1, 'calendar'), { key: '2026-Q3', from: '2026-07-01', to: '2026-09-30', said: 'Q3 2026' });
    // 13 October 2026 is a Tuesday: its week runs Monday the 12th to Sunday the 18th.
    assert.deepEqual(photoPeriod('2026-10-13', 'week'), { key: '2026-W42', from: '2026-10-12', to: '2026-10-18', said: 'Week of 12 Oct 2026' });
    assert.deepEqual(photoPeriod('2026-10-18', 'week').key, '2026-W42');
    assert.deepEqual(photoPeriod('2026-10-19', 'week').key, '2026-W43');
    // A week belongs to the year its Thursday is in: 1 January 2027 is a Friday, in the last week of 2026.
    assert.deepEqual([photoPeriod('2027-01-01', 'week').key, photoPeriod('2027-01-04', 'week').key], ['2026-W53', '2027-W01']);
  });

  it('takes a photograph’s day as the day it was in India', () => {
    assert.equal(shotDay('2026-10-31T18:29:59Z'), '2026-10-31', 'a minute before midnight in India');
    assert.equal(shotDay('2026-10-31T18:30:00Z'), '2026-11-01', 'midnight in India');
    assert.equal(shotDay('2026-10-31T23:50:00'), '2026-10-31', 'a camera’s own clock, with no offset, was on site');
    assert.equal(shotDay('2026-10-31'), '2026-10-31');
  });
});

describe('a station’s standing', () => {
  it('is shot this period, due, overdue or never shot, and turns at midnight in India', () => {
    assert.deepEqual(stationStanding([], 'month', '2026-10-13'), { standing: 'never' });
    assert.deepEqual(stationStanding(['2026-10-02'], 'month', '2026-10-13'), { standing: 'shot', lastDay: '2026-10-02', behind: 0 });
    assert.deepEqual(stationStanding(['2026-08-30', '2026-09-30'], 'month', '2026-10-13'), { standing: 'due', lastDay: '2026-09-30', behind: 1 });
    assert.deepEqual(stationStanding(['2026-08-30'], 'month', '2026-10-13'), { standing: 'overdue', lastDay: '2026-08-30', behind: 2 });
    // Shot on the last day of October: still shot at 23:59 there, due a minute later.
    const before = indiaToday(new Date('2026-10-31T18:29:00Z'));
    const after = indiaToday(new Date('2026-10-31T18:30:00Z'));
    assert.deepEqual([before, after], ['2026-10-31', '2026-11-01']);
    assert.equal(stationStanding(['2026-10-31'], 'month', before).standing, 'shot');
    assert.equal(stationStanding(['2026-10-31'], 'month', after).standing, 'due');
    // A week turns on Monday, a quarter on the first of its first month.
    assert.equal(stationStanding(['2026-10-18'], 'week', '2026-10-18').standing, 'shot');
    assert.equal(stationStanding(['2026-10-18'], 'week', '2026-10-19').standing, 'due');
    assert.equal(stationStanding(['2026-10-11'], 'week', '2026-10-19').standing, 'overdue');
    assert.equal(stationStanding(['2026-09-30'], 'quarter', '2026-09-30').standing, 'shot');
    assert.equal(stationStanding(['2026-09-30'], 'quarter', '2026-10-01').standing, 'due');
  });

  it('is said on the station’s own sheet, with the day of its last shot, in no tone that raises a line of its own', () => {
    const held = site();
    shoot(held.project, '2026-09-20', { stationId: held.north });
    shoot(held.project, '2026-08-20', { stationId: held.stair });
    shoot(held.project, '2026-10-13', { stationId: held.gate });
    const standing = (id: string) => {
      const reading = readSheet(held.project, STATIONS_SET, id, undefined, undefined, NOW)!;
      const view = reading.fields.find((field) => field.def.key === 'standing')!;
      return [view.held?.value, view.tone, reading.fields.find((field) => field.def.key === 'last_shot_on')!.held?.value ?? undefined];
    };
    assert.deepEqual(standing(held.north), ['Due', 'info', '2026-09-20']);
    assert.deepEqual(standing(held.stair), ['Overdue', 'info', '2026-08-20']);
    assert.deepEqual(standing(held.gate), ['Shot this period', 'good', '2026-10-13']);
    const fresh = add(held.project, STATIONS_SET, { label: 'Lift lobby', every: 'quarter' });
    assert.deepEqual(standing(fresh), ['Never shot', 'neutral', undefined]);
  });
});

describe('a place on a photograph', () => {
  it('is kept on a site-log photograph and on a filed one, set by a person, and goes with the shot when it is filed', () => {
    const held = site();
    const entry = shoot(held.project, '2026-10-05');
    assert.equal(entry.photos[0]!.stationId, undefined, 'nothing picked and no position: no station');
    setShotPlace(held.project, { entryId: entry.id, index: 0 }, { stationId: held.north, place: { unit: held.unit } }, OWNER);
    assert.deepEqual(entry.photos[0]!.place, { unit: held.unit, building: held.block, floor: 'Level 3', milestone: held.slab, element: 'slab' }, 'the station’s own place, and the unit given beside it');
    assert.equal(entry.photos[0]!.stationId, held.north);
    assert.equal(entry.photos[0]!.placed?.how, 'person');
    assert.equal(entry.photos[0]!.placed?.by, OWNER);

    const filed = filePhoto(held.project, 'Boundary wall', '2026-10-06T04:00:00Z');
    setShotPlace(held.project, { evidenceId: filed.evidenceId }, { place: { building: held.block, floor: ' Terrace ', element: 'boundary_wall' } }, OWNER);
    const capture = held.project.evidence.find((row) => row.id === filed.evidenceId)!.attachments[0]!.capture!;
    assert.deepEqual(capture.place, { building: held.block, floor: 'Terrace', element: 'boundary_wall' });
    assert.equal(capture.zone, 'north boundary', 'the free-text area a person wrote stays, and is still read');
    assert.equal(projectShots(held.project).find((shot) => shot.evidenceId === filed.evidenceId)!.zone, 'north boundary');
    assert.equal(placeSaid(held.project, capture.place), 'Block A · Terrace · Boundary wall');

    // Filed onto the register, the site photograph is the same shot: one photograph, with its station and place.
    const row = fileSiteLogPhoto(held.project, entry.id, 0, OWNER);
    assert.equal(row.attachments[0]!.capture!.stationId, held.north);
    assert.deepEqual(row.attachments[0]!.capture!.place, entry.photos[0]!.place);
    assert.equal(projectShots(held.project).filter((shot) => shot.key === entry.photos[0]!.storageKey).length, 1);
    assert.equal(stationShots(photoStations(held.project).find((station) => station.id === held.north)!, projectShots(held.project))[0]!.by, ASHA, 'and it still says who took it');

    // Taken away again.
    setShotPlace(held.project, { evidenceId: filed.evidenceId }, { stationId: null, place: null }, OWNER);
    assert.deepEqual([capture.place, capture.stationId, capture.placed], [undefined, undefined, undefined]);
  });

  it('names only what the project keeps', () => {
    const held = site();
    assert.equal(placeFault(held.project, { building: held.block, unit: held.unit, milestone: held.slab, element: 'slab', floor: 'Level 3' }), undefined);
    assert.match(placeFault(held.project, { building: 'rec_none' })!, /building/);
    assert.match(placeFault(held.project, { unit: held.block })!, /unit/);
    assert.match(placeFault(held.project, { milestone: 'mil_none' })!, /milestone/);
    assert.match(placeFault(held.project, { floor: 'x'.repeat(41) })!, /40/);
    const entry = shoot(held.project, '2026-10-05');
    assert.throws(() => setShotPlace(held.project, { entryId: entry.id, index: 0 }, { stationId: 'rec_none' }, OWNER), /No station/);
    assert.throws(() => setShotPlace(held.project, { entryId: entry.id, index: 3 }, { stationId: held.north }, OWNER), /No site photograph/);
    assert.throws(() => setShotPlace(held.project, { evidenceId: 'ev_none' }, { stationId: held.north }, OWNER), /No photograph/);
    assert.equal(entry.photos[0]!.place, undefined, 'and a refusal writes nothing');
  });

  it('takes the element a model picked only once a person accepts it, and shows words a model wrote before as written before', () => {
    const held = site();
    const picked = filePhoto(held.project, 'Column at grid C4', '2026-10-06T04:00:00Z');
    const file = held.project.evidence.find((row) => row.id === picked.evidenceId)!.attachments[0]!;
    // What a model hands back is picks off three lists: written in here, with no model called.
    file.observation = photoObservationOfPicks('property', [{ element: 'column', condition: 'honeycombing', location: 'upper_floor', confidence: 0.82 }, { element: 'formwork', condition: 'work_in_progress', location: 'upper_floor', confidence: 0.4 }], 'stand-in', NOW.toISOString());
    const shot = () => shotsOfEvidence(held.project, [picked.evidenceId])[0]!;
    assert.deepEqual(shot().offer, { element: 'column', confidence: 0.82 }, 'the surest pick is offered');
    assert.equal(shot().place, undefined, 'and is nobody’s place until taken');
    assert.equal(shot().writtenBefore, undefined, 'picks are not prose');
    setShotPlace(held.project, { evidenceId: picked.evidenceId }, { place: { element: shot().offer!.element } }, OWNER);
    assert.deepEqual(shot().place, { element: 'column' });
    assert.equal(shot().offer, undefined, 'once the place names an element nothing more is offered');

    const old = filePhoto(held.project, 'Old photograph', '2026-06-01T04:00:00Z');
    held.project.evidence.find((row) => row.id === old.evidenceId)!.attachments[0]!.observation = { subject: 'property', description: 'A cracked beam above the entrance.', elements: ['beam'], notes: [], suggestedFindings: [], model: 'an older model', at: '2026-06-02T00:00:00Z' };
    assert.equal(shotsOfEvidence(held.project, [old.evidenceId])[0]!.writtenBefore, 'A cracked beam above the entrance.');
    assert.equal(shotsOfEvidence(held.project, [old.evidenceId])[0]!.offer, undefined, 'and offers nothing: it has no picks');
  });
});

describe('matching a shot to a station', () => {
  const stations = [
    { id: 'a', point: SITE },
    { id: 'b', point: north(SITE, 200) },
    { id: 'c' },
  ];

  it('takes the station picked on the phone, whatever the position says', () => {
    assert.deepEqual(matchStation(stations, { stationId: 'b', point: SITE }), { stationId: 'b', how: 'picked' });
    assert.deepEqual(matchStation(stations, { stationId: 'c' }), { stationId: 'c', how: 'picked' });
  });

  it('else takes the one station within the distance: at the distance counts, a metre past does not', () => {
    const at = north(SITE, STATION_MATCH_M - 0.01);
    const past = north(SITE, STATION_MATCH_M + 1);
    assert.ok(Math.abs(metresBetween(SITE, north(SITE, STATION_MATCH_M)) - STATION_MATCH_M) < 0.01, 'the test’s own metres are metres');
    assert.equal(matchStation(stations, { point: at })?.stationId, 'a');
    assert.equal(matchStation(stations, { point: at })?.how, 'near');
    assert.equal(matchStation(stations, { point: past }), undefined);
    assert.deepEqual(matchStation(stations, { point: SITE }), { stationId: 'a', how: 'near', metres: 0 });
    // The threshold is the caller's to name.
    assert.equal(matchStation(stations, { point: past }, STATION_MATCH_M + 2)?.stationId, 'a');
    assert.equal(matchStation(stations, { point: north(SITE, 10) }, 10)?.stationId, 'a', 'exactly at the distance is within it');
  });

  it('else leaves it unmatched: no position, nothing near, a station no longer there, or two stations it cannot tell apart', () => {
    assert.equal(matchStation(stations, {}), undefined);
    assert.equal(matchStation(stations, { point: north(SITE, 100) }), undefined);
    assert.equal(matchStation(stations, { stationId: 'gone' }), undefined);
    const stacked = [{ id: 'level-3', point: SITE }, { id: 'level-4', point: north(SITE, 5) }];
    assert.equal(matchStation(stacked, { point: north(SITE, 2) }), undefined, 'the same corner on two floors is a question for a person');
  });

  it('gives a site entry’s photographs their stations as it is filed, and the rest wait as place not set', () => {
    const held = site();
    // Picked once on the phone, with the phone's position: that is where the station is shot from.
    const first = shoot(held.project, '2026-09-10', { stationId: held.north, point: SITE });
    assert.deepEqual([first.photos[0]!.stationId, first.photos[0]!.placed?.how, first.photos[0]!.placed?.by], [held.north, 'picked', ASHA]);
    assert.deepEqual(stationPoint(photoStations(held.project).find((station) => station.id === held.north)!, held.project), SITE);
    // Next month nobody picks: the photograph's own position, 12 m off, finds the station.
    const second = shoot(held.project, '2026-10-08', { point: north(SITE, 12) });
    assert.deepEqual([second.photos[0]!.stationId, second.photos[0]!.placed?.how, second.photos[0]!.placed?.by], [held.north, 'near', 'Realytica']);
    assert.ok(Math.abs(second.photos[0]!.placed!.metres! - 12) < 0.2);
    assert.deepEqual(second.photos[0]!.place, stationPlace(photoStations(held.project).find((station) => station.id === held.north)!));
    // Far from any station, and one with no position at all: both wait.
    const far = shoot(held.project, '2026-10-09', { point: north(SITE, 400) });
    const blind = shoot(held.project, '2026-10-10');
    // A station id the list does not hold is dropped, never kept as sent.
    const stray = shoot(held.project, '2026-10-11', { stationId: 'rec_from_another_project' });
    assert.deepEqual([far, blind, stray].map((entry) => [entry.photos[0]!.stationId, entry.photos[0]!.place]), [[undefined, undefined], [undefined, undefined], [undefined, undefined]]);
    const round = stationRound(held.project, NOW);
    assert.deepEqual(round.placeNotSet.map((shot) => shot.siteLog!.entryId).sort(), [far.id, blind.id, stray.id].sort());
    // A person places one, and it stops waiting.
    setShotPlace(held.project, { entryId: blind.id, index: 0 }, { stationId: held.stair }, OWNER);
    assert.deepEqual(stationRound(held.project, NOW).placeNotSet.map((shot) => shot.siteLog!.entryId).sort(), [far.id, stray.id].sort());
  });
});

describe('what is due', () => {
  it('is one line under the Site record’s Needs you, with its count and the sheet that lists the stations', () => {
    const held = site();
    shoot(held.project, '2026-10-02', { stationId: held.north });
    shoot(held.project, '2026-09-28', { stationId: held.stair });
    const page = readFunctionFields(held.project, 'construction.site', NOW);
    assert.deepEqual(page.needs.due_soon.map((line) => [line.sheet, line.text]), [['Photograph round', 'Stations with no photograph this period: 2.']], 'one line, however many stations');
    assert.deepEqual([page.needs.failing.length, page.needs.missing.length, page.needs.accept.length, page.needs.decide.length], [0, 0, 0, 0]);
    assert.equal(page.needs.due_soon[0]!.key.startsWith(`${STATION_ROUND_SET}::`), true, 'and Open goes to the round');
    const round = stationRound(held.project, NOW);
    assert.deepEqual(round.due.map((row) => [row.station.label, row.standing]), [['Main gate', 'never'], ['Stair core', 'due']], 'the stations inside, the longest behind first');
    assert.deepEqual(round.rows.find((row) => row.station.id === held.stair)!.guide?.day, '2026-09-28', 'with last period’s shot to frame against');
    // Every station shot: the line goes, and the round says so.
    shoot(held.project, '2026-10-12', { stationId: held.stair });
    shoot(held.project, '2026-10-13', { stationId: held.gate });
    const after = readFunctionFields(held.project, 'construction.site', NOW);
    assert.deepEqual(after.needs.due_soon, []);
    assert.equal(readSheet(held.project, STATION_ROUND_SET, undefined, undefined, undefined, NOW)!.fields.find((field) => field.def.key === 'standing')!.held?.value, 'Every station photographed this period');
  });

  it('lists the photographs each milestone needs, and says in a sentence which are missing once it is reported complete', () => {
    const held = site();
    shoot(held.project, '2026-10-03', { stationId: held.north });
    let checks = milestonePhotoChecklist(held.project, NOW);
    assert.deepEqual(checks.map((check) => [check.name, check.complete, check.short, check.stations.map((row) => [row.label, row.have])]), [['Slab, level 3', false, 1, [['North corner', true], ['Stair core', false]]]], 'only a milestone a needed station names, and Finishes names none');
    assert.equal(milestonePhotoSaid(checks[0]!), 'Slab, level 3: 1 of 2 required photographs taken this period. Still to take: Stair core.');
    assert.deepEqual(milestonesShortOfPhotos(checks), [], 'nothing fails while the milestone is open');
    assert.deepEqual(readFunctionFields(held.project, 'construction.site', NOW).needs.failing, []);

    // Reported complete on 10 October with the stair core not shot.
    setMilestonePercent(held.project, held.slab, 100, OWNER, '2026-10-10T08:00:00Z', '2026-10-10');
    checks = milestonePhotoChecklist(held.project, NOW);
    assert.equal(milestonePhotoSaid(checks[0]!), 'Slab, level 3 is reported complete and 1 of its 2 required photographs is not taken: Stair core.');
    assert.deepEqual(readFunctionFields(held.project, 'construction.site', NOW).needs.failing.map((line) => line.text), ['Milestones reported complete with a required photograph missing: 1.']);

    // A shot from the period it was completed in, or later, is what it needs.
    shoot(held.project, '2026-10-12', { stationId: held.stair });
    checks = milestonePhotoChecklist(held.project, NOW);
    assert.equal(milestonePhotoSaid(checks[0]!), 'Slab, level 3: all 2 required photographs are taken.');
    assert.deepEqual(readFunctionFields(held.project, 'construction.site', NOW).needs.failing, []);
    // Read two months on, September's absence is not held against a milestone completed in October.
    assert.deepEqual(milestonesShortOfPhotos(milestonePhotoChecklist(held.project, new Date('2026-12-20T06:00:00Z'))), []);
  });

  it('tells the phone which stations are due, each with its place and the shot to frame against', () => {
    const held = site();
    shoot(held.project, '2026-09-28', { stationId: held.north, point: SITE });
    shoot(held.project, '2026-10-13', { stationId: held.gate });
    const due = stationsDue(held.project, NOW);
    assert.deepEqual(due.map((station) => [station.label, station.standing, station.period.said]), [['Stair core', 'never', 'October 2026'], ['North corner', 'due', 'October 2026']]);
    const northDue = due.find((station) => station.id === held.north)!;
    assert.equal(northDue.place, 'Block A · Level 3 · Slab, level 3 · Slab');
    assert.deepEqual(northDue.point, SITE);
    assert.equal(northDue.lastDay, '2026-09-28');
    assert.deepEqual(Object.keys(northDue.guide!).sort(), ['siteLog', 'takenAt']);
    assert.equal(due.find((station) => station.id === held.stair)!.guide, undefined, 'a station never shot has nothing to frame against');
  });
});

describe('the series', () => {
  const shot = (day: string, key = day): StationShot => ({ key, takenAt: `${day}T05:00:00Z`, day, by: ASHA });

  it('groups a station’s shots by period, the newest period first and the newest shot first within it', () => {
    const groups = photoSeries([shot('2026-08-04'), shot('2026-10-02'), shot('2026-09-15'), shot('2026-10-11')], 'month');
    assert.deepEqual(groups.map((group) => [group.period.said, group.shots.map((held) => held.day)]), [['October 2026', ['2026-10-11', '2026-10-02']], ['September 2026', ['2026-09-15']], ['August 2026', ['2026-08-04']]]);
    assert.deepEqual(photoSeries([shot('2026-10-11'), shot('2026-10-12'), shot('2026-10-05')], 'week').map((group) => [group.period.key, group.shots.length]), [['2026-W42', 1], ['2026-W41', 2]]);
    assert.deepEqual(photoSeries([shot('2026-10-11'), shot('2026-06-30')], 'quarter').map((group) => group.period.said), ['Q3 FY 2026-27', 'Q1 FY 2026-27']);
  });

  it('puts this period beside the last, or any two picked, the earlier on the left', () => {
    const groups = photoSeries([shot('2026-08-04'), shot('2026-09-15'), shot('2026-10-11')], 'month');
    const said = (pair: ReturnType<typeof seriesPair>) => [pair.left?.period.key, pair.right?.period.key];
    assert.deepEqual(said(seriesPair(groups)), ['2026-09', '2026-10']);
    assert.deepEqual(said(seriesPair(groups, { left: '2026-08', right: '2026-10' })), ['2026-08', '2026-10']);
    assert.deepEqual(said(seriesPair(groups, { left: '2026-10', right: '2026-08' })), ['2026-08', '2026-10'], 'picked the wrong way round, they are still in order');
    assert.deepEqual(said(seriesPair(groups, { right: '2026-09' })), ['2026-08', '2026-09'], 'the later one changed: the one before it comes beside');
    assert.deepEqual(said(seriesPair(groups, { left: 'no-such-period' })), ['2026-09', '2026-10']);
    assert.deepEqual(said(seriesPair(groups.slice(0, 1))), [undefined, '2026-10'], 'one period has nothing to stand beside');
    assert.deepEqual(said(seriesPair([])), [undefined, undefined]);
  });

  it('reads a station’s shots from both stores, and a field’s photographs from the register rows it names', () => {
    const held = site();
    shoot(held.project, '2026-08-20', { stationId: held.north });
    shoot(held.project, '2026-09-18', { stationId: held.north });
    const filed = filePhoto(held.project, 'North corner, October', '2026-10-07T04:00:00Z');
    // Filed on the station's own sheet, by a person.
    held.project.fieldSheets![STATIONS_SET]!.records!.find((record) => record.id === held.north)!.values.shots = { value: [filed.evidenceId], by: OWNER, at: NOW.toISOString() };
    const station = photoStations(held.project).find((one) => one.id === held.north)!;
    const groups = photoSeries(stationShots(station, projectShots(held.project)), station.every);
    assert.deepEqual(groups.map((group) => group.period.said), ['October 2026', 'September 2026', 'August 2026']);
    assert.deepEqual([groups[0]!.shots[0]!.evidenceId, Boolean(groups[1]!.shots[0]!.siteLog)], [filed.evidenceId, true]);
    // A snag's photographs, say: two register rows two months apart are two periods.
    const before = filePhoto(held.project, 'Snag before', '2026-08-03T04:00:00Z');
    const after = filePhoto(held.project, 'Snag after', '2026-10-09T04:00:00Z');
    assert.deepEqual(photoSeries(shotsOfEvidence(held.project, [before.evidenceId, after.evidenceId, 'ev_gone']), 'month').map((group) => group.period.key), ['2026-10', '2026-08']);
  });
});

describe('the photographs section of a report', () => {
  function shot(held: Site) {
    shoot(held.project, '2026-08-21', { stationId: held.north });
    shoot(held.project, '2026-09-19', { stationId: held.north });
    shoot(held.project, '2026-09-25', { stationId: held.north }, 'Vikram Shah (vikram@builders.example)');
    shoot(held.project, '2026-09-05', { stationId: held.stair });
    const filed = filePhoto(held.project, 'Stair core, August', '2026-08-11T04:00:00Z');
    setShotPlace(held.project, { evidenceId: filed.evidenceId }, { stationId: held.stair }, OWNER);
    return filed;
  }
  const SEPTEMBER = { to: '2026-10-01T00:00:00.000Z' };

  it('prints each station’s newest shot of the period, with its day and who took it, and says which were not photographed', () => {
    const held = site();
    shot(held);
    const block = resolveStationPhotos(held.project, { kind: 'station_photographs', ...SEPTEMBER, photos: { show: 'period', most: 12 } }, NOW);
    assert.deepEqual(block.table!.columns, ['Station', 'Place', 'Period', 'Taken', 'By']);
    assert.deepEqual(block.table!.rows.map((row) => row.cells), [
      ['North corner', 'Block A · Level 3 · Slab, level 3 · Slab', 'September 2026', '25 Sep 2026', 'Vikram Shah'],
      ['Stair core', 'Block A · Slab, level 3', 'September 2026', '5 Sep 2026', 'Asha Rao'],
      ['Main gate', '', 'September 2026', NOT_PHOTOGRAPHED, ''],
    ]);
    assert.equal(block.note, '2 of 3 stations photographed in September 2026.');
    assert.deepEqual(block.lines, ['North corner, September 2026: taken 25 Sep 2026 by Vikram Shah.', 'Stair core, September 2026: taken 5 Sep 2026 by Asha Rao.', 'Main gate, September 2026: not photographed.']);
    assert.ok(block.table!.rows[0]!.sitePhoto, 'a photograph still in the site log is named by its entry');
    assert.deepEqual(block.recordIds, [held.north, held.stair, held.gate]);
  });

  it('prints this period beside the last, for stations named or at a place, and at most as many as asked', () => {
    const held = site();
    const august = shot(held);
    const beside = resolveStationPhotos(held.project, { kind: 'station_photographs', ...SEPTEMBER, photos: { show: 'period_and_last', most: 12, stations: [held.stair] } }, NOW);
    assert.deepEqual(beside.table!.rows.map((row) => [row.cells[0], row.cells[2], row.cells[3]]), [['Stair core', 'August 2026', '11 Aug 2026'], ['Stair core', 'September 2026', '5 Sep 2026']]);
    assert.deepEqual(beside.table!.rows[0]!.evidenceIds, [august.evidenceId], 'a filed photograph is named by its register row');
    const placed = resolveStationPhotos(held.project, { kind: 'station_photographs', ...SEPTEMBER, photos: { show: 'period', most: 12, place: { building: held.block, floor: 'Level 3' } } }, NOW);
    assert.deepEqual(placed.table!.rows.map((row) => row.cells[0]), ['North corner']);
    const capped = resolveStationPhotos(held.project, { kind: 'station_photographs', ...SEPTEMBER, photos: { show: 'period', most: 2 } }, NOW);
    assert.deepEqual([capped.table!.rows.length, capped.note], [2, '2 of 2 stations photographed in September 2026. 1 more station not printed.']);
    assert.match(resolveStationPhotos(held.project, { kind: 'station_photographs', photos: { show: 'period', most: 12, place: { unit: held.unit } } }, NOW).note!, /No photo station is kept at the place/);
    // With no period of its own, the section is of the period today is in.
    assert.deepEqual(resolveStationPhotos(held.project, { kind: 'station_photographs', photos: { show: 'period', most: 1 } }, NOW).table!.rows[0]!.cells.slice(2, 4), ['October 2026', NOT_PHOTOGRAPHED]);
    // A weekly or a quarterly section reads its own period.
    assert.equal(resolveStationPhotos(held.project, { kind: 'station_photographs', ...SEPTEMBER, photos: { show: 'period', most: 1, every: 'quarter' } }, NOW).table!.rows[0]!.cells[2], 'Q2 FY 2026-27');
  });

  it('is a section of Construction’s monthly progress report, placed by the owner pack, and leaves the ticked section as it was', () => {
    const held = site();
    shot(held);
    const template = functionReportTemplate('construction.progress.report')!;
    const section = templateBlocks(template).find((block) => block.source?.kind === 'station_photographs')!;
    assert.deepEqual(section.source, { kind: 'station_photographs', photos: { show: 'period_and_last', most: 12 } });
    const report = generateReport(held.project, { kind: 'function', template: template.id, generatedBy: OWNER }, OWNER);
    const block = report.body.blocks.find((one) => one.source?.kind === 'station_photographs')!;
    assert.equal(block.heading, 'Site photographs, this month beside the last');
    assert.equal(resolveReportBlock(held.project, block).table!.rows.length, 6, 'three stations, two periods each');

    const pack = ownerPack(held.project, ownerPackPeriod({ month: '2026-09' }, NOW), NOW);
    const time = pack.sections.find((part) => part.key === 'time')!;
    assert.deepEqual(time.photos!.table!.rows.slice(0, 2).map((row) => [row.cells[0], row.cells[2], row.cells[3]]), [['North corner', 'August 2026', '21 Aug 2026'], ['North corner', 'September 2026', '25 Sep 2026']]);
    assert.equal(ownerPack(held.project, ownerPackPeriod({ quarter: 'FY2026-Q2' }, NOW), NOW).sections.find((part) => part.key === 'time')!.photos!.table!.rows[1]!.cells[2], 'Q2 FY 2026-27');

    // The photographs a person ticked into the report still print in their own section.
    const ticked = filePhoto(held.project, 'Chosen by hand', '2026-09-02T04:00:00Z');
    held.project.evidence.find((row) => row.id === ticked.evidenceId)!.inReport = true;
    const old = resolveReportBlock(held.project, { id: 'b1', origin: 'derived', source: { kind: 'site_photographs' } });
    assert.deepEqual(old.table!.columns, ['No.', 'Area', 'Caption', 'What the photograph shows', 'Taken']);
    assert.deepEqual(old.recordIds, [ticked.evidenceId]);
  });
});

describe('an old project, with photographs and no stations', () => {
  it('loads and reads as it did: no line, no count, no station, and its photographs listed as before', () => {
    const project = seedDemoProject();
    const entry = shoot(project, '2026-10-05', { point: SITE });
    const filed = filePhoto(project, 'Old boundary', '2026-10-06T04:00:00Z');
    assert.deepEqual([entry.photos[0]!.stationId, entry.photos[0]!.place, entry.photos[0]!.placed], [undefined, undefined, undefined]);
    const page = readFunctionFields(project, 'construction.site', NOW);
    assert.equal(page.counts.total, 0, 'nothing under Needs you');
    const round = readSheet(project, STATION_ROUND_SET, undefined, undefined, undefined, NOW)!;
    assert.deepEqual(round.fields.filter((field) => field.def.kind === 'computed').map((field) => [field.def.key, field.held?.value ?? null]), [['stations', 0], ['shot', null], ['due', null], ['overdue', null], ['place_not_set', null], ['milestones_short', null]], 'a round it does not run has no figures, never noughts');
    assert.deepEqual(round.fields.find((field) => field.def.key === 'standing')!.held?.value, 'No station kept');
    assert.deepEqual([stationRound(project, NOW).rows, stationRound(project, NOW).placeNotSet, stationsDue(project, NOW), milestonePhotoChecklist(project, NOW)], [[], [], [], []]);
    // The photographs list is what it was: the same rows, with no new member on any.
    const listed = projectPhotos(project).filter((photo) => photo.key === filed.evidenceId || photo.siteLog?.entryId === entry.id);
    assert.deepEqual(listed.map((photo) => Object.keys(photo).sort()), [
      ['area', 'caption', 'described', 'evidenceId', 'fileId', 'inReport', 'key', 'point', 'provesAnAnswer', 'seen', 'shows', 'suggestions', 'takenAt', 'title', 'usedIn'],
      ['caption', 'described', 'inReport', 'key', 'point', 'provesAnAnswer', 'seen', 'siteLog', 'suggestions', 'takenAt', 'title', 'usedIn'],
    ]);
    assert.match(resolveStationPhotos(project, { kind: 'station_photographs', photos: { show: 'period', most: 12 } }, NOW).note!, /No photo station is kept/);
    assert.equal(ownerPack(project, ownerPackPeriod({ month: '2026-09' }, NOW), NOW).sections.find((part) => part.key === 'time')!.photos, undefined, 'and its owner pack carries no photographs section');
    // The stored photographs hold no member they did not hold before.
    assert.deepEqual(Object.keys(entry.photos[0]!).sort(), ['fileName', 'mimeType', 'point', 'storageKey', 'takenAt']);
  });

  it('declares the stations within the catalog’s limits, with the series viewer on their shots', () => {
    const set = fieldCatalog().sets.get(STATIONS_SET)!;
    assert.equal(set.fn, 'construction.site');
    assert.ok(set.fields.filter((def) => (def.tier ?? 'core') === 'core').length <= 12);
    assert.ok(set.fields.length <= 20);
    assert.deepEqual(set.fields.filter((def) => def.kind === 'evidence').map((def) => [def.key, def.viewer, def.accepts]), [['shots', 'series', 'image']]);
    assert.deepEqual(fieldCatalog().sheets.get('construction.site')!.map((held) => held.id), [STATION_ROUND_SET, STATIONS_SET], 'the Site record’s first sheets');
  });
});

describe('a collaborator’s copy', () => {
  const grant = (over: Partial<ProjectGrant>): ProjectGrant => ({ id: 'g', tenantId: 't', projectId: 'p', email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: [], areas: [], createdAt: NOW.toISOString(), createdBy: OWNER, ...over });
  const copyFor = (project: DdProject, over: Partial<ProjectGrant>) => projectView(project, { kind: 'granted', email: 'sam@site.example', grant: grant(over) }).project;

  function placed(): Site & { filed: string } {
    const held = site();
    shoot(held.project, '2026-10-05', { stationId: held.north });
    const filed = filePhoto(held.project, 'Shot of the stair', '2026-10-06T04:00:00Z');
    // On the register in a scope a narrow grant can hold.
    const row = held.project.evidence.find((one) => one.id === filed.evidenceId)!;
    setShotPlace(held.project, { evidenceId: filed.evidenceId }, { stationId: held.stair, place: { unit: held.unit } }, OWNER);
    return { ...held, filed: row.id };
  }

  it('holds the stations only with the site record area and a scope the Site’s checks sit in, and never the site log’s shots', () => {
    const held = placed();
    const project = seedDemoProject();
    project.fieldSheets = held.project.fieldSheets;
    project.milestones = held.project.milestones;
    project.siteLog = held.project.siteLog;
    const scopeOnly = copyFor(project, { scopeKeys: ['land_site'] });
    assert.equal(scopeOnly.fieldSheets?.[STATIONS_SET], undefined, 'the scope alone does not open the site record');
    const withArea = copyFor(project, { scopeKeys: ['land_site'], areas: ['site_record'] });
    assert.deepEqual(photoStations(withArea).map((station) => station.label), ['North corner', 'Stair core', 'Main gate']);
    assert.deepEqual(withArea.siteLog, [], 'the site’s own entries stay the firm’s');
    assert.deepEqual(stationRound(withArea, NOW).rows.map((row) => row.shots.length), [0, 0, 0]);
    const other = copyFor(project, { scopeKeys: ['legal'], areas: ['site_record'] });
    assert.equal(other.fieldSheets?.[STATIONS_SET], undefined);
  });

  it('keeps of a photograph’s place only what the copy holds: the station where the station is on it, the unit where the unit is', () => {
    const held = placed();
    const project = seedDemoProject();
    project.fieldSheets = held.project.fieldSheets;
    project.milestones = held.project.milestones;
    const row = held.project.evidence.find((one) => one.id === held.filed)!;
    // Filed under a scope of the demo project's, so a grant of that scope is handed the photograph itself.
    const scope = project.assessments.flatMap((assessment) => assessment.scopes).find((one) => one.scopeKey === 'cost_quantity')!;
    project.evidence.push({ ...row, scopeInstanceIds: [scope.id] });
    const full = project.evidence.find((one) => one.id === held.filed)!.attachments[0]!.capture!;
    assert.deepEqual([full.stationId, full.place?.unit, full.place?.building, full.place?.milestone], [held.stair, held.unit, held.block, held.slab]);

    // A quantity surveyor on Cost with no area: the photograph is theirs by its scope, and no sheet is, so neither the station, the unit nor the building.
    const surveyor = copyFor(project, { scopeKeys: ['cost_quantity'] });
    assert.deepEqual(Object.keys(surveyor.fieldSheets ?? {}), []);
    const cut = surveyor.evidence.find((one) => one.id === held.filed)!.attachments[0]!.capture!;
    assert.equal(cut.stationId, undefined);
    assert.deepEqual([cut.place?.unit, cut.place?.building, cut.place?.floor], [undefined, undefined, undefined], 'a floor is a floor of its building, and goes with it');
    assert.equal(cut.place?.milestone, held.slab, 'the schedule is on every copy, so the milestone stays');
    assert.equal(cut.placed, undefined, 'and how it was placed is not said of a place cut short');
    for (const id of [held.stair, held.unit, held.block]) assert.equal(JSON.stringify(surveyor).includes(id), false, 'none of those ids is anywhere on the copy');
    assert.equal(cut.takenAt, full.takenAt, 'the rest of what the photograph says is untouched');
    // The project itself is not changed by the cutting.
    assert.equal(project.evidence.find((one) => one.id === held.filed)!.attachments[0]!.capture!.stationId, held.stair);

    // With the site record and its scope, the station and the building come too; the unit only where a function in reach links to units.
    const onSite = copyFor(project, { scopeKeys: ['cost_quantity', 'land_site'], areas: ['site_record'] });
    const kept = onSite.evidence.find((one) => one.id === held.filed)!.attachments[0]!.capture!;
    assert.deepEqual([kept.stationId, kept.place?.building, kept.place?.floor], [held.stair, held.block, undefined]);
    assert.equal(kept.place?.unit, onSite.fieldSheets?.['shared.units'] ? held.unit : undefined);
  });

  it('leaves a station off the list where it names a building the copy does not hold', () => {
    const held = placed();
    const project = seedDemoProject();
    project.fieldSheets = { ...held.project.fieldSheets };
    project.milestones = held.project.milestones;
    const whole = copyFor(project, { scopeKeys: ['land_site'], areas: ['site_record'] });
    assert.equal(photoStations(whole).length, 3);
    // The building taken off the project's list after the stations were made: a station that names it is not on the copy.
    const buildings = project.fieldSheets!['shared.buildings']!;
    project.fieldSheets!['shared.buildings'] = { ...buildings, records: buildings.records!.map((record) => (record.id === held.block ? { ...record, removed: { by: OWNER, at: NOW.toISOString() } } : record)) };
    const cut = copyFor(project, { scopeKeys: ['land_site'], areas: ['site_record'] });
    assert.deepEqual(photoStations(cut).map((station) => station.label), ['Main gate'], 'only the station that names no building');
    assert.equal(photoStations(project).length, 3, 'and the project keeps all three');
  });
});
