/**
 * A site on several survey numbers.
 *
 * One read of the state's map was one parcel, and a township stands on many.
 * These pin what changes when every read is kept: which numbers the file
 * offers, how the reads are held so that the code that knew of one still
 * finds one — and is believed when it reads or clears without knowing of the
 * rest — what the map frames and draws, what the parcels add up to and how
 * that is set beside the documents, and what the valuation and the screen
 * make of it. The picker's lines and a run down them are in
 * `revenue-picker.test.ts`; the routes are in `revenue-parcels-routes.test.ts`.
 *
 * Every survey number and place in here is made up.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXTENT_APART_PCT,
  acceptValueOffers,
  addEvidence,
  applyRevenueMap,
  applySurveyBoundary,
  buildBoundary,
  bySurveyNumber,
  clearRevenueMap,
  compareProjectGis,
  createAssessment,
  createProject,
  extentAgainstDocuments,
  extentAgainstMap,
  extentGapPct,
  extentsApart,
  fileRevenueMapAsEvidence,
  offeredSurveyNumbers,
  parcelLabels,
  parseDocumentText,
  projectToIdentity,
  rememberAskedSurveyNo,
  removeRevenueMapRead,
  revenueExtent,
  revenueGuidance,
  revenueMapBrief,
  revenueMapEvidenceCode,
  revenueReadFor,
  revenueReads,
  revenueSiteBrief,
  reviewFacts,
  runProjectScreen,
  runValuationApproaches,
  siteFrame,
  siteRevenueFeatures,
  splitSurveyNumbers,
  statedNumbers,
  surveyNumberLines,
  surveyPieces,
  valueChecks,
  valueDrivers,
  valueOffers,
  valueSummary,
  type DdProject,
  type DocumentFact,
  type GeoPoint,
  type RevenueMapFactor,
  type RevenueMapFeature,
  type RevenueMapInsight,
  type RevenueMapRead,
} from '@realytica/shared';
import { parcelAnswering, parcelUnderAnySpelling, spellingsToAsk, suggestRevenuePlace } from '../apps/api/src/gis/revenue-map';

const ORIGIN = { lat: 12.71, lng: 77.69 };
const NOW = new Date('2026-10-01T00:00:00Z');

function east(m: number, lat = ORIGIN.lat): number {
  return m / (111_320 * Math.cos((lat * Math.PI) / 180));
}
function north(m: number): number {
  return m / 111_320;
}

/** A closed rectangle, its south-west corner `eastM` and `northM` from the origin. */
function rect(eastM: number, northM: number, widthM: number, heightM: number): GeoPoint[] {
  const west = ORIGIN.lng + east(eastM);
  const south = ORIGIN.lat + north(northM);
  return [
    { lat: south, lng: west },
    { lat: south, lng: west + east(widthM) },
    { lat: south + north(heightM), lng: west + east(widthM) },
    { lat: south + north(heightM), lng: west },
    { lat: south, lng: west },
  ];
}

function geojson(ring: GeoPoint[]): string {
  return JSON.stringify({ type: 'Polygon', coordinates: [ring.map((p) => [p.lng, p.lat])] });
}

/** The tank every parcel of the site is read beside: the same shape, whichever read reports it. */
const TANK = rect(400, 0, 200, 150);

function tank(id: string, distanceM: number): RevenueMapFeature {
  return { id, kind: 'state_water', layerKey: 'ka_water', name: 'Hosakere', distanceM, contains: false, ring: TANK };
}

/** One parcel's read: a 60 m by 40 m plot, `eastM` along from the origin. */
function read(surveyNo: string, eastM: number, over: Partial<RevenueMapRead> = {}): RevenueMapRead {
  const ring = rect(eastM, 0, 60, 40);
  return {
    readAt: '2026-10-01T06:00:00.000Z',
    state: 'KA',
    parcelRef: `kgis:2999999999:${surveyNo}`,
    surveyNo,
    village: 'Hosakere',
    mandal: 'Anekal',
    district: 'Bengaluru (Urban)',
    sourceLabel: 'K-GIS village map',
    rings: [ring],
    centre: { lat: ORIGIN.lat + north(20), lng: ORIGIN.lng + east(eastM + 30) },
    areaSqm: 2400,
    registerExtent: null,
    classification: null,
    prohibitedCategory: null,
    prohibitedRegisterUnjoined: true,
    features: [],
    factors: [],
    insights: [],
    anchor: null,
    emptyLayers: [],
    unreadLayers: [],
    ...over,
  };
}

function fact(key: string, value: string | number, over: Partial<DocumentFact> = {}): DocumentFact {
  return { key, label: key, value, display: String(value), page: 1, quote: `${key}: ${value}`, ...over };
}

/** A document on file that states these facts. */
function file(p: DdProject, title: string, documentType: string, facts: DocumentFact[]) {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  row.documentType = documentType;
  row.facts = facts;
  row.attachments = [{ id: `att_${title}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1000, storageKey: `s3://${title}`, uploadedAt: NOW.toISOString() } as never];
  return row;
}

function township(over: Partial<Parameters<typeof createProject>[0]> = {}): DdProject {
  return createProject({ name: 'Hosakere township', type: 'residential', location: 'Hosakere', city: 'Bengaluru', ...over }, 'RYT-P1');
}

/** Three parcels side by side, read in order. */
function threeParcels(p = township()): DdProject {
  applyRevenueMap(p, read('71', 0), 'tester');
  applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
  applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');
  return p;
}

/** A project as another process finds it in the store: through JSON, sharing nothing with the one it was read from. */
function fromStore(p: DdProject): DdProject {
  return JSON.parse(JSON.stringify(p)) as DdProject;
}

/*
 * What the code before this does, transcribed from it. It holds one read. A
 * read takes that one's place and, where no person has supplied an outline,
 * becomes the boundary. Clearing drops the read and a boundary a read
 * supplied. It has never heard of the list, and leaves it wherever it lies.
 */
function oldCodeReads(p: DdProject, r: RevenueMapRead): void {
  p.revenueMap = r;
  p.updatedAt = r.readAt;
  const onFile = p.surveyBoundary;
  if (!onFile || onFile.source === 'revenue_map') {
    const ring = r.rings[0];
    const boundary = ring && ring.length >= 3 ? buildBoundary(ring, 'revenue_map', r.readAt, `${r.sourceLabel}, Sy. ${r.surveyNo}`) : null;
    if (boundary) p.surveyBoundary = boundary;
  }
}
function oldCodeClears(p: DdProject): void {
  if (!p.revenueMap) return;
  p.revenueMap = undefined;
  if (p.surveyBoundary?.source === 'revenue_map') p.surveyBoundary = undefined;
}

/** The lender's check of that name, on the valuation as it stands. */
function lenderCheck(p: DdProject, key: string) {
  const working = runValuationApproaches(p);
  return valueChecks(p, working, valueSummary(p, working)).find((c) => c.key === key);
}

describe('the survey numbers a file offers', () => {
  it('splits a list the way a document or a person writes one', () => {
    assert.deepEqual(splitSurveyNumbers('71/2, 71/3 and 72'), ['71/2', '71/3', '72']);
    assert.deepEqual(splitSurveyNumbers('Sy. Nos. 71/1 & 72'), ['71/1', '72']);
    assert.deepEqual(splitSurveyNumbers('71 / 2A ,72'), ['71/2A', '72'], 'spaces are not part of a number');
    assert.deepEqual(splitSurveyNumbers('71/2, 71/2 and 71/2a, 71/2A'), ['71/2', '71/2a'], 'once each, whatever the case');
    assert.deepEqual(splitSurveyNumbers('Hosakere village'), [], 'a piece with no number in it is not one');
    assert.deepEqual(splitSurveyNumbers(undefined), []);
  });

  it('reads a piece as a survey number only when it is one', () => {
    const RANGE = 'A range is not read. Write each number, with commas between.';
    const SEVERAL = 'More than one number here. Put a comma between them.';
    const pieces = (text: string) => surveyPieces(text).map((p) => [p.surveyNo, p.unreadable ?? null]);
    assert.deepEqual(pieces('81 to 85'), [['81 to 85', RANGE]]);
    // A dash from a lower number to a higher may be a range or a part of a number. It is not guessed at, and the line says how to write either.
    assert.deepEqual(pieces('81-85'), [
      ['81-85', 'A dash from a lower number to a higher is read as a range, and a range is not read. For a part of a number write 81/85; for a run of numbers write each, with commas between.'],
    ]);
    assert.deepEqual(pieces('81/1 to 81/5'), [['81/1 to 81/5', RANGE]]);
    assert.deepEqual(pieces('82-1'), [['82-1', null]], 'and from a number to its part is one number');
    assert.deepEqual(pieces('81/1 81/2'), [['81/1 81/2', SEVERAL]]);
    assert.deepEqual(pieces('82; 83'), [['82; 83', SEVERAL]]);
    assert.deepEqual(pieces('Phase 2, Sy. No. 84'), [['Phase 2', 'Not read as a survey number.'], ['84', null]]);
    assert.deepEqual(pieces('88/2 (part), 84A & 85AA/1'), [['88/2', null], ['84A', null], ['85AA/1', null]]);
    assert.deepEqual(splitSurveyNumbers('81 to 85, 86'), ['86'], 'the first number of a range is never read in its place');
  });

  it('shows a range as it was written, on a line of its own that cannot be read', () => {
    const p = township();
    file(p, 'Fire NOC', 'Fire NOC', [fact('covered_survey_numbers', '81 to 85, 86')]);
    assert.deepEqual(offeredSurveyNumbers(p).map((o) => [o.surveyNo, Boolean(o.unreadable)]), [['86', false], ['81 to 85', true]]);

    // What a person typed comes first, as they typed it; then the file's numbers; then what the file states that is not a number.
    const lines = surveyNumberLines(p, '87-89, 90');
    assert.deepEqual(lines.map((l) => [l.surveyNo, Boolean(l.unreadable), l.typed]), [
      ['87-89', true, true],
      ['90', false, true],
      ['86', false, false],
      ['81 to 85', true, false],
    ]);
    assert.equal(lines[3]!.unreadable, 'A range is not read. Write each number, with commas between.', 'the line says why, and how to write it');
    assert.match(lines[0]!.unreadable ?? '', /For a part of a number write 87\/89; for a run of numbers write each, with commas between\.$/);
  });

  it('offers every number the documents state, accepted or waiting, and says which', () => {
    const p = township({ parcelId: 'Sy. No. 71/1' });
    const deed = file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '71/2')]);
    const rera = file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '71/2, 72, 73/1A', { review: 'proposed', source: 'model', page: 2 })]);
    const noc = file(p, 'Fire NOC', 'Fire NOC', [fact('covered_survey_numbers', '72 & 74', { review: 'proposed' })]);

    const offered = offeredSurveyNumbers(p);
    assert.deepEqual(offered.map((o) => o.surveyNo), ['71/1', '71/2', '72', '73/1A', '74']);

    const own = offered[0]!;
    assert.equal(own.onProject, true);
    assert.equal(own.accepted, true, 'the project records it');
    assert.deepEqual(own.documents, []);

    const twice = offered[1]!;
    assert.equal(twice.accepted, true, 'accepted on the deed, whatever the certificate still waits on');
    assert.deepEqual(twice.documents.map((d) => [d.evidenceId, d.accepted]), [[deed.id, true], [rera.id, false]], 'stated by two documents, offered once');

    const waiting = offered[2]!;
    assert.equal(waiting.accepted, false);
    assert.deepEqual(waiting.documents.map((d) => [d.document, d.page, d.accepted, d.byModel]), [
      ['RERA certificate', 2, false, true],
      ['Fire NOC', 1, false, false],
    ]);
    assert.equal(offered[3]!.documents[0]!.byModel, true, 'a number the model read says so');
    assert.deepEqual(offered[4]!.documents.map((d) => d.evidenceId), [noc.id], 'an approval’s covered numbers are offered too');
  });

  it('takes a zero before a part for the same number, on one line that names each paper', () => {
    const p = township();
    const rera = file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '77/03, 77/05 and 77/10', { review: 'proposed', source: 'model', page: 2 })]);
    const deed = file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '77/3 and 77/5')]);
    const offered = offeredSurveyNumbers(p);
    assert.deepEqual(offered.map((o) => o.surveyNo), ['77/3', '77/5', '77/10'], 'not 77/03 and 77/3 as two numbers');
    assert.deepEqual(offered[0]!.documents.map((d) => [d.evidenceId, d.accepted]), [[rera.id, false], [deed.id, true]]);
    assert.equal(offered[0]!.accepted, true, 'accepted on the deed, however the certificate spelt it');

    assert.deepEqual(surveyPieces('077/03, 77/3 & 77/030'), [{ surveyNo: '77/3', written: '077/03' }, { surveyNo: '77/30', written: '77/030' }]);
    assert.deepEqual(splitSurveyNumbers('77/0, 77/00, 70/1, 77/03A'), ['77/0', '70/1', '77/3A'], 'a zero that is the part, or ends a number, stays');

    // How the papers, or the person, spelt it goes with the line, for a map that spells it that way.
    assert.deepEqual(offered.map((o) => o.written ?? null), [['77/03'], ['77/05'], null]);
    assert.deepEqual(surveyNumberLines(p, '078/01, 77/3').map((l) => [l.surveyNo, l.written ?? null]), [['78/1', ['078/01']], ['77/3', ['77/03']], ['77/5', ['77/05']], ['77/10', null]]);

    // A parcel read as 77/3 answers for 77/03, and the number is not asked of the map twice.
    applyRevenueMap(p, read('77/3', 0), 'tester');
    assert.equal(revenueReadFor(revenueReads(p), '77/03')?.surveyNo, '77/3');
    assert.equal(surveyNumberLines(p, '77/03').filter((l) => l.read).length, 1);
  });

  it('marks a number as likely another one misread only where the file says so twice over', () => {
    const numbers = (stated: string) => {
      const p = township();
      file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', stated, { review: 'proposed', source: 'model' })]);
      return offeredSurveyNumbers(p).map((o) => [o.surveyNo, o.maybe ?? null]);
    };
    // 47/2 is stated, and no whole survey number in these papers runs to three digits: 472 is likely 47/2 with its stroke lost.
    assert.deepEqual(numbers('47/2, 47/3, 472, 67/1, 67/2'), [['47/2', null], ['47/3', null], ['67/1', null], ['67/2', null], ['472', '47/2']]);
    // 6712 is doubted where the papers state 67/12, and not where they do not: nothing is guessed at.
    assert.deepEqual(numbers('67/1, 67/2, 6712'), [['67/1', null], ['67/2', null], ['6712', null]]);
    assert.deepEqual(numbers('67/1, 67/12, 6712'), [['67/1', null], ['67/12', null], ['6712', '67/12']]);
    // Where the papers state whole numbers as long, 472 may well be one of them.
    assert.deepEqual(numbers('47/2, 472, 118, 245/1'), [['47/2', null], ['118', null], ['245/1', null], ['472', null]]);
    // A neighbour is a whole number like any other, though it begins with a number written before a stroke: 471 says this
    // village's numbers run to three digits, and 472 beside it is then a parcel, not 47/2 misread.
    assert.deepEqual(numbers('47/2, 471, 472'), [['47/2', null], ['471', null], ['472', null]]);
    assert.deepEqual(numbers('7/1, 71, 72, 73'), [['7/1', null], ['71', null], ['72', null], ['73', null]]);
    assert.deepEqual(numbers('12/3, 12/4, 123, 124, 125'), [['12/3', null], ['12/4', null], ['123', null], ['124', null], ['125', null]]);
    // Only a number that is itself another's strokeless form is no witness: 6712 and 4712 do not clear each other, or 472.
    assert.deepEqual(numbers('47/2, 47/12, 67/12, 472, 4712, 6712'), [
      ['47/2', null],
      ['47/12', null],
      ['67/12', null],
      ['472', '47/2'],
      ['4712', '47/12'],
      ['6712', '67/12'],
    ]);
    // The stroke lost from a number spelt with a zero.
    assert.deepEqual(numbers('77/03, 7703'), [['77/3', null], ['7703', '77/3']]);

    // A number on the project's own record is a person's, and is never doubted.
    const own = township({ parcelId: 'Sy. No. 472' });
    file(own, 'RERA', 'RERA certificate', [fact('survey_numbers', '47/2 and 472', { review: 'proposed', source: 'model' })]);
    assert.deepEqual(offeredSurveyNumbers(own).map((o) => [o.surveyNo, o.maybe ?? null]), [['47/2', null], ['472', null]]);

    // Nor is one a person accepted on a document, whatever another paper's reading of it still waits on.
    const accepted = township();
    file(accepted, 'RERA', 'RERA certificate', [fact('survey_numbers', '47/2 and 472', { review: 'proposed', source: 'model' })]);
    assert.equal(offeredSurveyNumbers(accepted)[1]!.maybe, '47/2');
    file(accepted, 'Sale deed', 'Sale deed', [fact('survey_numbers', '472')]);
    assert.deepEqual(offeredSurveyNumbers(accepted).map((o) => [o.surveyNo, o.accepted, o.maybe ?? null]), [['47/2', false, null], ['472', true, null]]);
  });

  it('lists the numbers in the order of the numbers, the parts of one together', () => {
    assert.deepEqual(['77/10', '9', '77/3', '78', '77', '77/5', '77/3A', '77/4', '47/2', '472'].sort(bySurveyNumber), ['9', '47/2', '77', '77/3', '77/3A', '77/4', '77/5', '77/10', '78', '472']);
    const p = township({ parcelId: 'Sy. No. 77/10' });
    file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '77/5, 67/2, 77/3, 81 to 85, 67/1 and 77/4', { review: 'proposed', source: 'model' })]);
    applyRevenueMap(p, read('70', 0), 'tester');
    assert.deepEqual(surveyNumberLines(p, '99, 12').map((l) => l.surveyNo), ['99', '12', '67/1', '67/2', '70', '77/3', '77/4', '77/5', '77/10', '81 to 85']);
  });

  it('does not wait on a number that is likely a misreading and that nobody has accepted', () => {
    const p = township();
    // Read off the page by this server's rules, and waiting: such a reading stands, and its numbers are waited for.
    file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '47/2, 47/3 and 472', { review: 'proposed' })]);
    file(p, 'Sale deed', 'Sale deed', [fact('extent_title', 4800)]);
    applyRevenueMap(p, read('47/2', 0), 'tester');
    applyRevenueMap(p, read('47/3', 80, { readAt: '2026-10-01T06:01:00.000Z' }), 'tester');
    // 472 is on no map. The site's extent is set against the two parcels, and is not held back for a third that is not one.
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual([stated.numbers, stated.read, stated.compared?.mapSqm], [['47/2', '47/3'], 2, 4800]);
  });

  it('counts a number only a model read for nothing until a person accepts it, and says a reading is waiting', () => {
    const p = township();
    file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '47/2 and 47/3', { review: 'proposed', source: 'model' })]);
    file(p, 'Sale deed', 'Sale deed', [fact('extent_title', 4800)]);
    applyRevenueMap(p, read('47/2', 0), 'tester');
    applyRevenueMap(p, read('47/3', 80, { readAt: '2026-10-01T06:01:00.000Z' }), 'tester');
    // Offered in the picker, as what it is, and standing for nothing.
    assert.deepEqual(offeredSurveyNumbers(p).map((o) => [o.surveyNo, o.stands, o.documents[0]?.byModel]), [['47/2', false, true], ['47/3', false, true]]);
    assert.deepEqual(statedNumbers(offeredSurveyNumbers(p)), [], 'nothing is waited for on a model’s word');
    // The site's extent is not set against the map while the numbers the site goes by rest on a reading nobody accepted.
    const stated = revenueExtent(p)!.documents!;
    assert.equal(stated.compared, null);
    assert.equal(stated.unset, 'a reading of the survey_numbers on the RERA certificate is waiting to be accepted and is not counted, so the numbers this land goes by are not all told and the map is not set against it');
    assert.equal(
      extentAgainstDocuments(revenueExtent(p)!)!.verdict,
      stated.unset,
      'and that is what the brief says in place of a comparison',
    );
    // Accepted, the numbers are the file's, and the comparison is made.
    reviewFacts(p, p.evidence[0]!.id, ['survey_numbers'], 'accept', 'tester');
    assert.deepEqual([revenueExtent(p)!.documents!.unset, revenueExtent(p)!.documents!.compared?.mapSqm], [undefined, 4800]);
  });

  it('waits for a number a person accepted, whatever it looks like', () => {
    // Two deeds accepted as stating Sy. 47/2 and Sy. 472: a real second parcel, though no other whole number here runs to three digits.
    const p = township();
    file(p, 'Sale deed A', 'Sale deed', [fact('survey_numbers', '47/2')]);
    file(p, 'Sale deed B', 'Sale deed', [fact('survey_numbers', '472')]);
    file(p, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 8000)]);
    applyRevenueMap(p, read('47/2', 0, { areaSqm: 4000, prohibitedRegisterUnjoined: false }), 'tester');
    assert.deepEqual(offeredSurveyNumbers(p).map((o) => [o.surveyNo, o.accepted, o.maybe ?? null]), [['47/2', true, null], ['472', true, null]]);

    const register = lenderCheck(p, 'prohibited')!;
    assert.deepEqual([register.verdict, register.headline], ['unknown', 'Sy. 472 not read'], 'not clear, with a parcel of the site unread');
    const hit = compareProjectGis(p, { revenue: revenueReads(p) }).hits.find((h) => h.code === 'revenue_documents_extent')!;
    assert.equal(hit.severity, 'info', 'not 4,000 sqm less on the map');
    assert.equal(hit.text, 'The documents state 8,000 sqm (Khata certificate and extract, p. 1). 1 of the 2 numbers the file states is read, so the map is not set against it yet.');
    assert.equal(lenderCheck(p, 'extents_agree')!.headline, 'Stated once', 'nor 50% apart');

    // Read, the two are the site.
    applyRevenueMap(p, read('472', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 4000, prohibitedRegisterUnjoined: false }), 'tester');
    assert.equal(lenderCheck(p, 'prohibited')!.verdict, 'clear');
    assert.equal(lenderCheck(p, 'extents_agree')!.verdict, 'clear');
  });

  it('offers nothing from a reading a person set aside, or a document that was replaced', () => {
    const p = township();
    file(p, 'Khata', 'Khata certificate and extract', [fact('survey_numbers', '81', { review: 'rejected' })]);
    file(p, 'Old deed', 'Sale deed', [fact('survey_numbers', '82')]).status = 'superseded';
    assert.deepEqual(offeredSurveyNumbers(p), []);
  });

  it('lines up what is offered, what is typed and what is read', () => {
    const p = township({ parcelId: 'Sy. No. 71/1' });
    file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '72')]);
    // The state's map holds whole survey numbers: 71/1 was asked for and 71 answered.
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    applyRevenueMap(p, read('90', 300, { readAt: '2026-10-01T06:05:00.000Z' }), 'tester');

    const lines = surveyNumberLines(p, '72, 75 and 71/2');
    assert.deepEqual(lines.map((l) => [l.surveyNo, l.typed, l.read?.surveyNo ?? null]), [
      // What a person typed that the file does not state, first and as typed.
      ['75', true, null],
      ['71/2', true, null],
      // Then what the file states and what is kept, in the order of the numbers.
      ['71/1', false, '71'],
      ['72', true, null],
      ['90', false, '90'],
    ]);
    assert.equal(lines[3]!.offered?.accepted, true, 'a typed number the file also states keeps its source, and its place among the file’s numbers');
    assert.equal(lines[4]!.offered, undefined, 'a parcel nothing on the file names still has its line');
  });
});

describe('the survey number a page is read as stating', () => {
  const FIRST = 'DEED OF ABSOLUTE SALE\nThis Deed of Sale is made and executed on 12 March 2019 between the Vendor and the Purchaser.\nThe Vendor is the absolute owner of the Schedule Property.';
  const stated = (parsed: ReturnType<typeof parseDocumentText>) => parsed.facts.filter((f) => f.key === 'survey_numbers').map((f) => [f.value, f.label, f.display]);

  /*
   * The parser keeps the one number a page returns to, as the code in
   * production does, and what it writes is read by that code from the same
   * store. A comma, an ampersand or the word after a survey number is as
   * often an address, an extent, a khata number or a date as it is a second
   * survey number, and a page read as stating "71, 3" puts a parcel on the
   * file that nobody named. A deed for several numbers is told from one for
   * one by what its extent is set against, not by reading a list here.
   */
  const PAGES: Array<[string, string]> = [
    ['an address after a comma', 'All that piece and parcel of land bearing Sy. No. 71, 3rd Cross, Hosakere Village, measuring 2400 square metres.'],
    ['an extent after a comma', 'All that piece and parcel of land bearing Sy. No. 71, 2 acres in extent, situated at Hosakere Village.'],
    ['a khata number after the word', 'All that piece and parcel of land bearing Survey No. 71 and 245/3 being its khata number, situated at Hosakere Village.'],
    ['a date after a comma', 'All that piece and parcel of land bearing Sy. No. 71, 12 March 2019 being the day possession was given.'],
    ['the parent holding it was carved from', 'A portion of the larger property comprised in Sy. Nos. 70, 71 and 72. The Schedule Property bears Sy. No. 71, and Sy. No. 71 is free of charge.'],
  ];

  for (const [what, line] of PAGES) {
    it(`is the one number, with ${what}`, () => {
      const deed = parseDocumentText([FIRST, `SCHEDULE PROPERTY\n${line}`], 'Sale deed.pdf');
      assert.equal(deed.type, 'sale_deed');
      assert.deepEqual(stated(deed), [['71', 'Survey number', 'Sy. No. 71']]);
      // The same through the reading every other kind of page gets.
      const note = parseDocumentText([`A note on the property.\n${line}`]);
      assert.equal(note.type, 'other');
      assert.deepEqual(stated(note), [['71', 'Survey number', 'Sy. No. 71']]);
      // Nothing but that number is offered to be read from the map.
      assert.deepEqual(splitSurveyNumbers(String(deed.facts.find((f) => f.key === 'survey_numbers')?.value)), ['71']);
    });
  }
});

describe('several reads kept on one project', () => {
  it('keeps each parcel in the order read, the first where the code before this looks', () => {
    const p = threeParcels();
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['71', '72', '73']);
    assert.equal(p.revenueMap?.surveyNo, '71', 'the old field holds the first read');
    assert.equal(p.revenueMaps?.length, 3);
    assert.equal(p.surveyBoundary?.source, 'revenue_map');
    assert.deepEqual(p.surveyBoundary?.ring, read('71', 0).rings[0], 'the boundary is one ring, the first read’s');
    assert.match(p.surveyBoundary?.suppliedNote ?? '', /Sy\. 71$/);
  });

  it('stores one read exactly as it always was', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    assert.equal(p.revenueMaps, undefined, 'no list for one read');
    assert.deepEqual(Object.keys(p.revenueMap!).sort(), Object.keys(read('71', 0)).sort(), 'and nothing added to the read');
  });

  it('puts a second read of a parcel where the first stood', () => {
    const p = threeParcels();
    const boundary = p.surveyBoundary;
    const set = applyRevenueMap(p, read('72', 80, { readAt: '2026-10-02T06:00:00.000Z', areaSqm: 3100 }), 'tester');
    assert.equal(set, null, 'a parcel that is not the first does not set the boundary');
    assert.deepEqual(revenueReads(p).map((r) => [r.surveyNo, r.areaSqm]), [['71', 2400], ['72', 3100], ['73', 1600]]);
    assert.equal(p.surveyBoundary, boundary);

    const again = applyRevenueMap(p, read('71', 0, { readAt: '2026-10-02T07:00:00.000Z' }), 'tester');
    assert.ok(again, 'a second read of the first parcel renews the boundary it supplied');
    assert.equal(p.surveyBoundary?.suppliedAt, '2026-10-02T07:00:00.000Z');
    assert.equal(revenueReads(p).length, 3);
  });

  it('removes one and keeps the rest', () => {
    const p = threeParcels();
    const boundary = p.surveyBoundary;
    assert.equal(removeRevenueMapRead(p, read('72', 80).parcelRef, 'tester'), true);
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['71', '73']);
    assert.equal(p.revenueMap?.surveyNo, '71');
    assert.equal(p.surveyBoundary, boundary, 'the boundary was not the one removed');
    assert.equal(removeRevenueMapRead(p, 'kgis:2999999999:999', 'tester'), false, 'a parcel that is not kept');
  });

  it('hands the old field and the boundary to the next read when the first goes', () => {
    const p = threeParcels();
    removeRevenueMapRead(p, read('71', 0).parcelRef, 'tester');
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['72', '73']);
    assert.equal(p.revenueMap?.surveyNo, '72');
    assert.deepEqual(p.surveyBoundary?.ring, read('72', 80).rings[0]);
    assert.equal(p.surveyBoundary?.source, 'revenue_map');

    removeRevenueMapRead(p, read('72', 80).parcelRef, 'tester');
    assert.equal(p.revenueMaps, undefined, 'one read left is stored as one read');
    assert.equal(p.revenueMap?.surveyNo, '73');

    removeRevenueMapRead(p, read('73', 160).parcelRef, 'tester');
    assert.equal(p.revenueMap, undefined);
    assert.equal(p.surveyBoundary, undefined, 'the last read takes its boundary with it');
  });

  it('clears every read at once', () => {
    const p = threeParcels();
    clearRevenueMap(p, 'tester');
    assert.deepEqual(revenueReads(p), []);
    assert.equal(p.revenueMap, undefined);
    assert.equal(p.revenueMaps, undefined);
    assert.equal(p.surveyBoundary, undefined);
  });

  it('never puts a parcel over a person’s outline, however many are read', () => {
    const p = township();
    applySurveyBoundary(p, geojson(rect(0, 0, 220, 40)), 'surveyor.geojson', 'tester');
    const supplied = p.surveyBoundary;
    threeParcels(p);
    assert.equal(p.surveyBoundary, supplied);
    removeRevenueMapRead(p, read('71', 0).parcelRef, 'tester');
    clearRevenueMap(p, 'tester');
    assert.equal(p.surveyBoundary, supplied, 'and removing them leaves it alone');
  });

  it('remembers the number a parcel was asked for as, and answers for it', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    assert.deepEqual(p.revenueMap?.askedAs, ['71/1']);
    const kept = rememberAskedSurveyNo(p, read('71', 0).parcelRef, '71 / 2');
    assert.deepEqual(kept?.askedAs, ['71/1', '71/2']);
    assert.equal(rememberAskedSurveyNo(p, 'kgis:2999999999:999', '5'), undefined);

    const reads = revenueReads(p);
    assert.equal(reads.length, 1, 'two numbers, one parcel');
    assert.equal(revenueReadFor(reads, '71/2')?.surveyNo, '71');
    assert.equal(revenueReadFor(reads, '71')?.surveyNo, '71');
    assert.equal(revenueReadFor(reads, '72'), undefined);

    applyRevenueMap(p, read('71', 0, { readAt: '2026-10-02T06:00:00.000Z' }), 'tester', '71');
    assert.deepEqual(p.revenueMap?.askedAs, ['71/1', '71/2'], 'a fresh read keeps what the parcel was asked for as');
  });

  it('says on the row a read is filed as that the outline is the whole survey number, where a part was asked for', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    assert.match(
      fileRevenueMapAsEvidence(p, 'tester').description ?? '',
      /\nThe state's map holds the whole survey number\. It was asked for as 71\/1, and the outline and extent here are all of Sy\. 71, which may be more land than the part asked for\.\n/,
    );
    const own = township();
    applyRevenueMap(own, read('71', 0), 'tester');
    assert.doesNotMatch(fileRevenueMapAsEvidence(own, 'tester').description ?? '', /whole survey number/);
  });

  it('tells two parcels with one survey number apart by their villages, everywhere they are named', () => {
    const p = township();
    const here = read('71', 0);
    const there = read('71', 500, { readAt: '2026-10-01T06:01:00.000Z', parcelRef: 'kgis:2999999998:71', village: 'Kalyani' });
    applyRevenueMap(p, here, 'tester');
    applyRevenueMap(p, there, 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:02:00.000Z' }), 'tester');
    const reads = revenueReads(p);
    assert.equal(reads.length, 3, 'the second Sy. 71 is another parcel, not a second read of the first');

    assert.deepEqual([...parcelLabels(reads).values()], ['71 (Hosakere)', '71 (Kalyani)', '72']);
    assert.deepEqual(revenueExtent(p)!.parcels.map((x) => x.label), ['71 (Hosakere)', '71 (Kalyani)', '72']);
    const overlay = compareProjectGis(p, { revenue: reads });
    assert.deepEqual(overlay.parcels?.map((x) => [x.parcelRef, x.label]), [
      [here.parcelRef, '71 (Hosakere)'],
      [there.parcelRef, '71 (Kalyani)'],
      [read('72', 80).parcelRef, '72'],
    ]);
    assert.match(overlay.hits.find((h) => h.code === 'revenue_parcel')!.text, /Sy\. 71 \(Hosakere\) \(2,400 sqm\), Sy\. 71 \(Kalyani\) \(2,400 sqm\), Sy\. 72 \(2,400 sqm\)/);
    assert.equal(valueOffers(p, NOW).find((o) => o.input === 'land_area' && o.source.kind === 'revenue_map')?.source.detail, 'Sy. 71 (Hosakere), 71 (Kalyani) and 72');

    // Each has a line of its own, and one is taken off without the other.
    assert.deepEqual(surveyNumberLines(p).map((l) => [l.surveyNo, l.read?.parcelRef]), [['71', here.parcelRef], ['71', there.parcelRef], ['72', read('72', 80).parcelRef]]);
    removeRevenueMapRead(p, there.parcelRef, 'tester');
    assert.deepEqual(revenueReads(p).map((r) => r.parcelRef), [here.parcelRef, read('72', 80).parcelRef]);
    assert.deepEqual([...parcelLabels(revenueReads(p)).values()], ['71', '72'], 'and the one left needs no village');

    // Two villages of one name: the taluk tells them apart.
    const twins = [read('71', 0), read('71', 500, { parcelRef: 'kgis:2999999997:71', mandal: 'Hoskote' })];
    assert.deepEqual([...parcelLabels(twins).values()], ['71 (Hosakere, Anekal)', '71 (Hosakere, Hoskote)']);
  });
});

describe('a hobli, which is a place and not a class of land', () => {
  it('is told as the hobli it is, under the map and on the row a read is filed as', () => {
    // Karnataka's map gives no class of land for a parcel. The engine hands over the hobli in that place.
    const p = township();
    applyRevenueMap(p, read('71', 0, { classification: 'Hosakere-2 hobli' }), 'tester');
    const told = revenueSiteBrief(p)!.parcels[0]!;
    assert.deepEqual([told.classification, told.hobli], [null, 'Hosakere-2'], 'not “Revenue class: Hosakere-2 hobli”');
    assert.deepEqual([revenueMapBrief(p.revenueMap!).parcel.classification, revenueMapBrief(p.revenueMap!).parcel.hobli], [null, 'Hosakere-2']);
    const filed = fileRevenueMapAsEvidence(p, 'tester').description ?? '';
    assert.match(filed, /\nHobli: Hosakere-2\.\n/);
    assert.doesNotMatch(filed, /Classification on the register/);
    assert.equal(p.revenueMap?.classification, 'Hosakere-2 hobli', 'what is stored is what the engine gave, where the code in production reads it');
  });

  it('leaves a class of land a class, where the state’s register records one', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0, { state: 'TS', classification: 'Patta land (dry)' }), 'tester');
    const told = revenueSiteBrief(p)!.parcels[0]!;
    assert.deepEqual([told.classification, told.hobli], ['Patta land (dry)', null]);
    assert.match(fileRevenueMapAsEvidence(p, 'tester').description ?? '', /\nClassification on the register: Patta land \(dry\)\.\n/);

    const none = township();
    applyRevenueMap(none, read('72', 80), 'tester');
    assert.deepEqual([revenueSiteBrief(none)!.parcels[0]!.classification, revenueSiteBrief(none)!.parcels[0]!.hobli], [null, null], 'and nothing where the map gives neither');
  });
});

describe('the code before this, running against the same store', () => {
  it('still finds one whole read and one ring where it always looked', () => {
    const stored = fromStore(threeParcels());
    const first = stored.revenueMap!;
    for (const key of Object.keys(read('71', 0)) as Array<keyof RevenueMapRead>) assert.notEqual(first[key], undefined, `${key} is on the read`);
    assert.equal(first.surveyNo, '71');
    assert.equal(stored.surveyBoundary?.ring.length, 5);
    assert.ok((stored.surveyBoundary?.computedAreaSqm ?? 0) > 2300);

    // The call that code makes: one read, handed over as one.
    const overlay = compareProjectGis(stored, { revenue: stored.revenueMap });
    assert.equal(overlay.revenue?.surveyNo, '71');
    assert.equal(overlay.survey?.source, 'revenue_map');
    assert.equal(overlay.parcels?.length, 1);
  });

  it('is taken at its word when it reads: the one read it holds is all there is', () => {
    const p = fromStore(threeParcels());
    // It reads Sy. 72 again, which the list holds second. Its read is the only one it knows.
    oldCodeReads(p, read('72', 80, { readAt: '2026-10-03T06:00:00.000Z', areaSqm: 3200 }));
    assert.equal(p.revenueMaps?.length, 3, 'the list it could not see is still stored');
    assert.deepEqual(revenueReads(p).map((r) => [r.surveyNo, r.areaSqm]), [['72', 3200]], 'and is not read back beside what it wrote');
    assert.deepEqual(p.surveyBoundary?.ring, read('72', 80).rings[0], 'the boundary it moved is the parcel it holds');
    assert.equal(compareProjectGis(p, { revenue: revenueReads(p) }).parcels?.length, 1);
    assert.equal(revenueExtent(p)?.totalSqm, 3200);

    // The next read here adds to what that code left, and the list it left behind goes.
    applyRevenueMap(p, read('89', 380, { readAt: '2026-10-03T08:00:00.000Z' }), 'tester');
    assert.equal(p.revenueMap?.surveyNo, '72');
    assert.deepEqual(p.revenueMaps?.map((r) => r.surveyNo), ['72', '89']);
    assert.deepEqual(p.surveyBoundary?.ring, read('72', 80).rings[0], 'the boundary stays the first read’s');
  });

  it('is taken at its word when it reads the first parcel again, too', () => {
    const p = fromStore(threeParcels());
    oldCodeReads(p, read('71', 0, { readAt: '2026-10-03T06:00:00.000Z', areaSqm: 2500 }));
    assert.deepEqual(revenueReads(p).map((r) => [r.surveyNo, r.areaSqm]), [['71', 2500]], 'the same parcel, read at another moment, is not the head of the list');
    assert.equal(p.surveyBoundary?.suppliedAt, '2026-10-03T06:00:00.000Z');
  });

  it('keeps what a parcel was asked for as when that code reads it again', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z' }), 'tester');
    const q = fromStore(p);
    // Its read carries no such thing: it does not know a parcel can answer for another number.
    oldCodeReads(q, read('71', 0, { readAt: '2026-10-03T06:00:00.000Z' }));
    assert.equal(q.revenueMap?.askedAs, undefined);
    assert.deepEqual(revenueReads(q)[0]!.askedAs, ['71/1']);
    assert.equal(revenueReadFor(revenueReads(q), '71/1')?.readAt, '2026-10-03T06:00:00.000Z', 'so 71/1 is still answered, by the fresh read');

    applyRevenueMap(q, read('73', 160, { readAt: '2026-10-03T07:00:00.000Z' }), 'tester');
    assert.deepEqual(q.revenueMap?.askedAs, ['71/1'], 'and the next write here puts it on the stored read');
  });

  it('is believed when it clears: a list it could not see is not read back', () => {
    const p = fromStore(threeParcels());
    oldCodeClears(p);
    assert.equal(p.revenueMaps?.length, 3, 'the list is still stored');
    assert.equal(p.surveyBoundary, undefined, 'the boundary a read supplied went with the read');
    assert.deepEqual(revenueReads(p), [], 'and the list is not read');
    assert.equal(revenueSiteBrief(p), null);
    assert.equal(valueOffers(p, NOW).some((o) => o.source.kind === 'revenue_map'), false);
    assert.equal(compareProjectGis(p, { revenue: revenueReads(p) }).parcels?.length, 0);

    applyRevenueMap(p, read('95', 0, { readAt: '2026-10-04T06:00:00.000Z' }), 'tester');
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['95'], 'the next read here starts afresh');
    assert.equal(p.revenueMaps, undefined);
  });

  it('is believed when it clears and then reads: the parcels it cleared do not come back beside the new one', () => {
    const p = fromStore(threeParcels());
    oldCodeClears(p);
    oldCodeReads(p, read('95', 600, { readAt: '2026-10-04T06:00:00.000Z' }));
    assert.equal(p.revenueMaps?.length, 3, 'three parcels of the site that was cleared are still stored');
    assert.deepEqual(revenueReads(p).map((r) => r.surveyNo), ['95']);
    assert.equal(p.surveyBoundary?.source, 'revenue_map');
    assert.deepEqual(p.surveyBoundary?.ring, read('95', 600).rings[0], 'the boundary is where that code put it');

    // Every reader of the reads sees one parcel: the map, the extent, the valuation.
    assert.deepEqual(compareProjectGis(p, { revenue: revenueReads(p) }).parcels?.map((x) => x.surveyNo), ['95']);
    assert.equal(revenueExtent(p)?.totalSqm, 2400);
    assert.equal(valueOffers(p, NOW).find((o) => o.input === 'land_area' && o.source.kind === 'revenue_map')?.value, 2400);
    assert.deepEqual(surveyNumberLines(p).map((l) => l.surveyNo), ['95']);

    applyRevenueMap(p, read('96', 680, { readAt: '2026-10-04T07:00:00.000Z' }), 'tester');
    assert.deepEqual(p.revenueMaps?.map((r) => r.surveyNo), ['95', '96'], 'and the next read here is the second parcel, not the fifth');

    // The same when the parcel it reads is the one that led the list it cleared.
    const q = fromStore(threeParcels());
    oldCodeClears(q);
    oldCodeReads(q, read('71', 0, { readAt: '2026-10-04T06:00:00.000Z' }));
    assert.deepEqual(revenueReads(q).map((r) => r.surveyNo), ['71']);

    // And a list that code left behind with nothing beside it is cleared from here.
    const r = fromStore(threeParcels());
    oldCodeClears(r);
    clearRevenueMap(r, 'tester');
    assert.equal(r.revenueMaps, undefined);
  });
});

describe('the frame over several parcels', () => {
  const pin = { lat: ORIGIN.lat + north(900), lng: ORIGIN.lng + east(900), caveat: 'Geocoded pin.', source: 'site_context' as const };

  it('holds every parcel, and opens on the middle of them', () => {
    const overlay = compareProjectGis(threeParcels(), { revenue: revenueReads(threeParcels()) });
    assert.deepEqual(overlay.parcels?.map((x) => x.surveyNo), ['71', '72', '73']);
    const frame = siteFrame({ pin, survey: overlay.survey, parcels: overlay.parcels });
    assert.ok(frame);
    assert.equal(frame.from, 'outlines');
    for (const parcel of overlay.parcels ?? []) {
      for (const corner of parcel.ring) {
        assert.ok(corner.lat >= frame.south && corner.lat <= frame.north && corner.lng >= frame.west && corner.lng <= frame.east, `Sy. ${parcel.surveyNo} is in the frame`);
      }
    }
    // The three plots run 220 m east from the origin and 40 m north.
    assert.ok(Math.abs(frame.point.lng - (ORIGIN.lng + east(110))) < 1e-6);
    assert.ok(Math.abs(frame.point.lat - (ORIGIN.lat + north(20))) < 1e-6);
    assert.ok(frame.reachM > 200 && frame.reachM < 220, 'a street view is looked for as far as the furthest corner, and the allowance beyond');
    assert.equal(pin.lat > frame.north, true, 'a pin 900 m off does not widen it');
  });

  it('counts an outline the revenue map supplied once, as the first parcel', () => {
    const overlay = compareProjectGis(threeParcels(), { revenue: revenueReads(threeParcels()) });
    const withIt = siteFrame({ pin: null, survey: overlay.survey, parcels: overlay.parcels });
    const without = siteFrame({ pin: null, survey: null, parcels: overlay.parcels });
    assert.deepEqual(withIt, without);
    const one = siteFrame({ pin: null, survey: overlay.survey, parcels: overlay.parcels?.slice(0, 1) });
    assert.equal(one?.from, 'outline', 'one parcel is one outline');
  });

  it('holds a person’s outline and the parcels beside it', () => {
    const p = township();
    applySurveyBoundary(p, geojson(rect(-300, 100, 50, 50)), 'surveyor.geojson', 'tester');
    threeParcels(p);
    const overlay = compareProjectGis(p, { revenue: revenueReads(p) });
    const frame = siteFrame(overlay);
    assert.ok(frame);
    assert.equal(frame.from, 'outlines');
    assert.ok(frame.west <= ORIGIN.lng + east(-300), 'the supplied outline');
    assert.ok(frame.east >= ORIGIN.lng + east(220), 'and the furthest parcel');
  });
});

describe('the state’s layers across several reads', () => {
  /** Each read numbers its features afresh, by distance from its own parcel. */
  function beside(): DdProject {
    const p = township();
    applyRevenueMap(p, read('71', 0, { features: [tank('ka_water:0', 340)] }), 'tester');
    applyRevenueMap(
      p,
      read('72', 80, {
        readAt: '2026-10-01T06:01:00.000Z',
        features: [
          { id: 'ka_water:0', kind: 'state_water', layerKey: 'ka_water', name: 'Kalyani', distanceM: 90, contains: false, ring: rect(80, 130, 40, 40) },
          tank('ka_water:1', 260),
        ],
      }),
      'tester',
    );
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', features: [tank('ka_water:0', 180)] }), 'tester');
    return p;
  }

  it('keeps a lake three parcels share once, at its distance from the nearest', () => {
    const merged = siteRevenueFeatures(revenueReads(beside()));
    assert.equal(merged.length, 2, 'the tank once, and the pond one parcel alone is near');
    const shared = merged.find((f) => f.name === 'Hosakere')!;
    assert.equal(shared.distanceM, 180);
    assert.equal(shared.surveyNo, '73', 'and says which parcel that is');
    assert.equal(new Set(merged.map((f) => f.id)).size, 2, 'two things two reads gave one id are told apart');
  });

  it('draws them once on the overlay, and one read exactly as before', () => {
    const p = beside();
    const overlay = compareProjectGis(p, { revenue: revenueReads(p) });
    const drawn = overlay.features.filter((f) => f.kind === 'state_water');
    assert.equal(drawn.length, 2);
    assert.equal(overlay.revenue?.featureCount, 2);
    assert.equal(drawn.find((f) => f.name === 'Hosakere')?.nearestSurveyNo, '73');

    const alone = compareProjectGis(p, { revenue: revenueReads(p)[0] });
    assert.deepEqual(alone.features.filter((f) => f.kind === 'state_water').map((f) => [f.id, f.distanceM, f.nearestSurveyNo]), [['ka_water:0', 340, undefined]]);
  });

  it('draws the nearest when the layers hold more than the map is given to draw', () => {
    // The engine lists a layer at a time, so the furthest tank of the first layer comes before the nearest drain of the last.
    const tanks = (surveyNo: string, from: number): RevenueMapFeature[] =>
      Array.from({ length: 70 }, (_, n) => ({
        id: `ka_water:${n}`,
        kind: 'state_water' as const,
        layerKey: 'ka_water',
        name: `Tank ${surveyNo}-${n}`,
        distanceM: from - n * 10,
        contains: false,
        point: { lat: ORIGIN.lat + north(from - n * 10), lng: ORIGIN.lng },
      }));
    const one = township();
    applyRevenueMap(one, read('71', 0, { features: [...tanks('a', 3000), ...tanks('b', 2000)] }), 'tester');
    const alone = compareProjectGis(one, { revenue: one.revenueMap }).features.filter((f) => f.kind === 'state_water');
    assert.equal(alone.length, 120);
    assert.equal(Math.max(...alone.map((f) => f.distanceM ?? 0)), 2800, 'the twenty left out are the twenty furthest, not the last twenty listed');

    const two = township();
    applyRevenueMap(two, read('71', 0, { features: tanks('a', 3000) }), 'tester');
    applyRevenueMap(two, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', features: tanks('b', 2000) }), 'tester');
    const together = compareProjectGis(two, { revenue: revenueReads(two) }).features.filter((f) => f.kind === 'state_water');
    assert.equal(together.length, 120);
    assert.equal(Math.max(...together.map((f) => f.distanceM ?? 0)), 2800);

    // Under the limit nothing is put in another order: the features come as the engine gave them.
    const few = township();
    applyRevenueMap(few, read('71', 0, { features: tanks('a', 3000) }), 'tester');
    assert.deepEqual(compareProjectGis(few, { revenue: few.revenueMap }).features.filter((f) => f.kind === 'state_water').map((f) => f.distanceM), tanks('a', 3000).map((f) => f.distanceM));
  });

  it('tells one read in the brief exactly as that read is told on its own', () => {
    const p = township();
    const only = read('71', 0, {
      features: [tank('ka_water:0', 340)],
      insights: [{ code: 'ka_water:0:340', kind: 'existing', layerKey: 'ka_water', featureId: 'ka_water:0', title: 'Hosakere', status: 'Mapped as tank', distanceM: 340, direction: 'east', meaning: '340 m to the east.', source: 'K-GIS LULC 2023' }],
      unreadLayers: [{ layer: 'ka_masterplan', reason: 'timeout' }],
    });
    applyRevenueMap(p, only, 'tester');
    const site = revenueSiteBrief(p)!;
    const one = revenueMapBrief(only);
    assert.deepEqual(site.nearby, one.nearby.map((item) => ({ ...item, parcels: ['71'], told: only.parcelRef })));
    assert.equal(site.nearby[0]!.where, '340 m east', 'no parcel is named where there is only one');
    assert.deepEqual(site.notChecked, [{ layer: 'masterplan', reason: 'timeout', parcels: ['71'] }]);
    assert.deepEqual(site.parcels.map((x) => [x.surveyNo, x.extentSqm, x.register.state]), [['71', 2400, 'unjoined']]);
  });

  it('says a finding once in the brief, for the parcel it bears on hardest', () => {
    const p = township();
    const near = (distanceM: number, direction: string) => ({
      features: [tank('ka_water:0', distanceM)],
      insights: [
        { code: `ka_water:0:${distanceM}`, kind: 'existing' as const, layerKey: 'ka_water', featureId: 'ka_water:0', title: 'Hosakere', status: 'Mapped as tank', distanceM, direction, meaning: `${distanceM} m to the ${direction}.`, source: 'K-GIS LULC 2023' },
      ],
    });
    applyRevenueMap(p, read('71', 0, near(340, 'east')), 'tester');
    applyRevenueMap(
      p,
      read('72', 80, {
        readAt: '2026-10-01T06:01:00.000Z',
        ...near(260, 'east'),
        factors: [
          { code: 'ka_drain_buffer', label: 'Drain buffer', direction: 'down', severity: 'high', headline: 'A stream runs about 30 m from the plot.', detail: 'A plan inside the buffer is refused.', impactLowPct: -8, impactHighPct: -3, layerKey: 'ka_drain', source: 'K-GIS LULC 2023', distanceM: 30 },
        ],
      }),
      'tester',
    );
    const brief = revenueSiteBrief(p)!;
    assert.deepEqual(brief.parcels.map((x) => x.surveyNo), ['71', '72']);
    assert.equal(brief.nearby.length, 1, 'one tank, one line');
    assert.equal(brief.nearby[0]!.where, '260 m east of Sy. 72', 'told from the nearer parcel');
    assert.deepEqual(brief.nearby[0]!.parcels, ['71', '72']);
    assert.equal(brief.warnings.length, 1);
    assert.equal(brief.warnings[0]!.where, '30 m from Sy. 72', 'a finding about one parcel names it');
    assert.deepEqual(brief.warnings[0]!.parcels, ['72']);
  });

  /** The tank as one read tells it: named, at a distance and a bearing. */
  const tankInsight = (distanceM: number): RevenueMapInsight => ({
    code: `ka_water:0:${distanceM}`,
    kind: 'existing',
    layerKey: 'ka_water',
    featureId: 'ka_water:0',
    title: 'Hosakere',
    status: 'Mapped as tank',
    distanceM,
    direction: 'east',
    meaning: `${distanceM} m to the east.`,
    source: 'K-GIS LULC 2023',
  });
  /** What the engine makes of the same tank, where it makes anything: the same layer family, at the same distance. */
  const tankFactor = (distanceM: number, over: Partial<RevenueMapFactor>): RevenueMapFactor => ({
    code: 'water_body_near',
    label: 'Near a water body',
    direction: 'down',
    severity: 'high',
    headline: `A tank lies ${distanceM} m from the plot.`,
    detail: 'Inside the buffer no plan is sanctioned.',
    impactLowPct: -12,
    impactHighPct: -4,
    layerKey: 'ka_water',
    source: 'K-GIS LULC 2023',
    distanceM,
    ...over,
  });

  it('puts one tank under one heading, the gravest any parcel puts it under, whichever parcel was read first', () => {
    // Inside the buffer of one plot, a plus for the plot across the road, and merely near the third.
    const inBuffer = (surveyNo: string, eastM: number, readAt: string) =>
      read(surveyNo, eastM, { readAt, features: [tank('ka_water:0', 40)], insights: [tankInsight(40)], factors: [tankFactor(40, {})] });
    const across = (surveyNo: string, eastM: number, readAt: string) =>
      read(surveyNo, eastM, { readAt, features: [tank('ka_water:0', 180)], insights: [tankInsight(180)], factors: [tankFactor(180, { code: 'water_view', label: 'Water frontage', direction: 'up', severity: 'low' })] });
    const near = (surveyNo: string, eastM: number, readAt: string) => read(surveyNo, eastM, { readAt, features: [tank('ka_water:0', 260)], insights: [tankInsight(260)] });

    for (const order of [
      [inBuffer, across, near],
      [near, across, inBuffer],
    ]) {
      const p = township();
      order.forEach((make, at) => applyRevenueMap(p, make(String(71 + at), at * 80, `2026-10-01T06:0${at}:00.000Z`), 'tester'));
      const grave = revenueReads(p).find((r) => r.factors.some((f) => f.code === 'water_body_near'))!;
      const brief = revenueSiteBrief(p)!;
      assert.equal(brief.warnings.length, 1);
      assert.equal(brief.warnings[0]!.title, 'Hosakere');
      assert.equal(brief.warnings[0]!.where, `40 m east of Sy. ${grave.surveyNo}`, 'told for the plot inside the buffer');
      assert.equal(brief.warnings[0]!.told, grave.parcelRef);
      assert.deepEqual([brief.positives, brief.nearby], [[], []], 'and not again as a plus or as something nearby');
      // The same on the overlay: one finding, a flag, pointing at the one tank drawn.
      const overlay = compareProjectGis(p, { revenue: revenueReads(p) });
      const told = overlay.hits.filter((h) => /Hosakere/.test(h.text) && (h.code === 'revenue_factor' || h.code === 'revenue_insight'));
      assert.deepEqual(told.map((h) => [h.code, h.severity]), [['revenue_factor', 'flag']]);
      assert.equal(overlay.features.filter((f) => f.kind === 'state_water').length, 1);
      assert.equal(told[0]!.featureId, overlay.features.find((f) => f.kind === 'state_water')!.id);
    }
  });

  it('does not call two findings one because they are of one kind', () => {
    const drain = (distanceM: number): RevenueMapFactor => ({
      code: 'ka_drain_buffer',
      label: 'Drain buffer',
      direction: 'down',
      severity: 'high',
      headline: `A stream runs about ${distanceM} m from the plot.`,
      detail: 'A plan inside the buffer is refused.',
      impactLowPct: -8,
      impactHighPct: -3,
      layerKey: 'ka_drain',
      source: 'K-GIS LULC 2023',
      distanceM,
    });
    const zone: RevenueMapFactor = { ...drain(0), code: 'zone_agricultural', label: 'Agricultural zone', severity: 'medium', headline: 'Zoned agricultural in the master plan.', detail: 'Conversion is needed before a plan.', layerKey: 'ka_zone' };
    const p = township();
    applyRevenueMap(p, read('71', 0, { factors: [drain(30), zone] }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', factors: [drain(12), zone] }), 'tester');
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z' }), 'tester');
    const warnings = revenueSiteBrief(p)!.warnings;
    assert.deepEqual(
      warnings.map((w) => [w.title, w.where, w.parcels]),
      [
        ['Drain buffer', '30 m from Sy. 71', ['71']],
        ['Agricultural zone', 'Sy. 71 and 72', ['71', '72']],
        ['Drain buffer', '12 m from Sy. 72', ['72']],
      ],
      'two streams are two lines; one zone said the same of two parcels is one, naming them',
    );
  });

  it('knows a named drain cut at two places for one drain, by the vertices the two cuts share', () => {
    /** The length of a drain the engine keeps near a parcel: the same drain, cut where that parcel's reach ends. */
    const cut = (id: string, name: string | null, fromM: number, points: number, distanceM: number): RevenueMapFeature => ({
      id,
      kind: 'state_drain',
      layerKey: 'ka_drain',
      name,
      distanceM,
      contains: false,
      line: Array.from({ length: points }, (_, n) => ({ lat: ORIGIN.lat + north(60), lng: ORIGIN.lng + east(fromM + n * 5) })),
    });
    const p = township();
    applyRevenueMap(p, read('71', 0, { features: [cut('ka_drain:0', 'Hosakere Rajakaluve', 0, 120, 30)] }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', features: [cut('ka_drain:0', 'Hosakere Rajakaluve', 80, 121, 12)] }), 'tester');
    const one = siteRevenueFeatures(revenueReads(p));
    assert.equal(one.length, 1, 'drawn once, though no two reads hold the same length of it');
    assert.deepEqual([one[0]!.distanceM, one[0]!.surveyNo, one[0]!.line?.length], [12, '72', 121], 'at its distance from the nearer parcel, and the longer length of it');
    assert.equal(compareProjectGis(p, { revenue: revenueReads(p) }).features.filter((f) => f.kind === 'state_drain').length, 1);

    // Another drain in the same layer is another drain.
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', features: [cut('ka_drain:0', 'Kalyani Kaluve', 160, 40, 25)] }), 'tester');
    assert.deepEqual(siteRevenueFeatures(revenueReads(p)).map((f) => f.name), ['Hosakere Rajakaluve', 'Kalyani Kaluve']);

    // A line with no name has only its shape to go by, and two cuts of it stay two.
    const r = township();
    applyRevenueMap(r, read('71', 0, { features: [cut('ka_drain:0', null, 0, 120, 30)] }), 'tester');
    applyRevenueMap(r, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', features: [cut('ka_drain:0', null, 80, 121, 12)] }), 'tester');
    assert.equal(siteRevenueFeatures(revenueReads(r)).length, 2);
  });
});

describe('a named line that passes the site in two lengths', () => {
  /** One length of the nala, whole: the same shape whichever parcel's read holds it. */
  const length = (id: string, northM: number, distanceM: number, points = 30): RevenueMapFeature => ({
    id,
    kind: 'state_drain',
    layerKey: 'ka_drain',
    name: 'Hosakere Nala',
    distanceM,
    contains: false,
    line: Array.from({ length: points }, (_, n) => ({ lat: ORIGIN.lat + north(northM), lng: ORIGIN.lng + east(n * 10) })),
  });
  /** What a read tells of a length: the widening proposed along it, by the id that read gave the length. */
  const told = (featureId: string, widthM: number, distanceM: number): RevenueMapInsight => ({
    code: `${featureId}:${distanceM}`,
    kind: 'planned',
    layerKey: 'ka_drain',
    featureId,
    title: `Hosakere Nala, ${widthM} m widening`,
    status: 'Proposed',
    distanceM,
    direction: 'north',
    meaning: `A ${widthM} m widening is proposed.`,
    source: 'K-GIS drains',
  });

  /** Sy. 71 lies nearer the north length, Sy. 72 the south: each read lists its nearer length first. */
  function twoLengths(): DdProject {
    const p = township();
    applyRevenueMap(
      p,
      read('71', 0, { features: [length('ka_drain:0', 300, 60), length('ka_drain:1', -300, 340)], insights: [told('ka_drain:0', 12, 60), told('ka_drain:1', 30, 340)] }),
      'tester',
    );
    applyRevenueMap(
      p,
      read('72', 80, {
        readAt: '2026-10-01T06:01:00.000Z',
        features: [length('ka_drain:0', -300, 40), length('ka_drain:1', 300, 320)],
        insights: [told('ka_drain:0', 30, 40), told('ka_drain:1', 12, 320)],
      }),
      'tester',
    );
    return p;
  }

  it('keeps both lengths, each at its distance from the parcel nearest it', () => {
    const drawn = siteRevenueFeatures(revenueReads(twoLengths()));
    const northOf = (f: RevenueMapFeature) => Math.round((f.line![0]!.lat - ORIGIN.lat) * 111_320);
    assert.deepEqual(
      drawn.map((f) => [northOf(f), f.distanceM, f.surveyNo]).sort((a, b) => Number(b[0]) - Number(a[0])),
      [
        [300, 60, '71'],
        [-300, 40, '72'],
      ],
      'the north length is not lost to the south one drawn twice',
    );
  });

  it('tells each length once, for the parcel nearest it', () => {
    const planned = revenueSiteBrief(twoLengths())!.planned;
    assert.deepEqual(
      planned.map((item) => [item.title, item.where]).sort(),
      [
        ['Hosakere Nala, 12 m widening', '60 m north of Sy. 71'],
        ['Hosakere Nala, 30 m widening', '40 m north of Sy. 72'],
      ],
    );
  });

  it('draws a length once where two reads cut it differently, and keeps the longer cut', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0, { features: [length('ka_drain:0', 300, 60, 30), length('ka_drain:1', -300, 340, 12)] }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', features: [length('ka_drain:0', -300, 40, 30), length('ka_drain:1', 300, 320, 12)] }), 'tester');
    const drawn = siteRevenueFeatures(revenueReads(p));
    assert.deepEqual(
      drawn.map((f) => [Math.sign(f.line![0]!.lat - ORIGIN.lat), f.line!.length, f.distanceM, f.surveyNo]).sort((x, y) => Number(y[0]) - Number(x[0])),
      [
        [1, 30, 60, '71'],
        [-1, 30, 40, '72'],
      ],
      'two cuts that share their vertices are one length of the line',
    );
  });

  it('keeps both lengths where each read holds one of them, and neither repeats the name', () => {
    // The widening is read within reach of each parcel: Sy. 71 holds only the north length, Sy. 72 only the south.
    const p = township();
    applyRevenueMap(p, read('71', 0, { features: [length('ka_drain:0', 300, 60)], insights: [told('ka_drain:0', 12, 60)] }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', features: [length('ka_drain:0', -300, 40)], insights: [told('ka_drain:0', 30, 40)] }), 'tester');
    const northOf = (f: RevenueMapFeature) => Math.round((f.line![0]!.lat - ORIGIN.lat) * 111_320);
    assert.deepEqual(
      siteRevenueFeatures(revenueReads(p)).map((f) => [northOf(f), f.distanceM, f.surveyNo]),
      [
        [300, 60, '71'],
        [-300, 40, '72'],
      ],
      'the north length is not lost under the name it shares with the south',
    );
    assert.deepEqual(
      revenueSiteBrief(p)!.planned.map((item) => [item.title, item.where]).sort(),
      [
        ['Hosakere Nala, 12 m widening', '60 m north of Sy. 71'],
        ['Hosakere Nala, 30 m widening', '40 m north of Sy. 72'],
      ],
      'and what is proposed along each is told, for the parcel beside it',
    );
    const overlay = compareProjectGis(p, { revenue: revenueReads(p) });
    const lines = overlay.features.filter((f) => f.kind === 'state_drain');
    assert.equal(lines.length, 2);
    assert.deepEqual(overlay.hits.filter((h) => /Hosakere Nala/.test(h.text)).map((h) => h.featureId).sort(), lines.map((f) => f.id).sort(), 'each told against the length drawn for it');
  });

  it('takes a cut for the length it shares most with, where two lengths meet at a point', () => {
    /** A length running north or south from the point where the two meet. */
    const from = (id: string, towards: 1 | -1, points: number, distanceM: number): RevenueMapFeature => ({
      id,
      kind: 'state_drain',
      layerKey: 'ka_drain',
      name: 'Hosakere Nala',
      distanceM,
      contains: false,
      line: Array.from({ length: points }, (_, n) => ({ lat: ORIGIN.lat + north(towards * n * 10), lng: ORIGIN.lng + east(700) })),
    });
    const p = township();
    applyRevenueMap(p, read('71', 0, { features: [from('ka_drain:0', 1, 30, 60), from('ka_drain:1', -1, 30, 340)] }), 'tester');
    // Sy. 72 holds a shorter cut of the south length only. It shares the meeting point with the north length, and sixteen vertices with the south.
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', features: [from('ka_drain:0', -1, 16, 40)] }), 'tester');
    const drawn = siteRevenueFeatures(revenueReads(p));
    assert.deepEqual(
      drawn.map((f) => [Math.sign(f.line![1]!.lat - ORIGIN.lat), f.distanceM, f.surveyNo]),
      [
        [1, 60, '71'],
        [-1, 40, '72'],
      ],
    );
  });
});

describe('the extent, totalled', () => {
  it('adds the outlines up, and counts a parcel that answered two numbers once', () => {
    const p = threeParcels();
    rememberAskedSurveyNo(p, read('71', 0).parcelRef, '71/2');
    const extent = revenueExtent(p)!;
    assert.deepEqual(extent.parcels.map((x) => [x.surveyNo, x.areaSqm, x.registerExtent]), [['71', 2400, null], ['72', 3000, null], ['73', 1600, null]]);
    assert.equal(extent.totalSqm, 7000);
    assert.equal(extent.documents, null, 'no document states an extent');
    assert.equal(revenueExtent(township()), null, 'nothing read, nothing to total');
  });

  it('shows the register’s own words beside each outline, and never adds them', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0, { registerExtent: '0-24' }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', registerExtent: '0-30' }), 'tester');
    const extent = revenueExtent(p)!;
    assert.deepEqual(extent.parcels.map((x) => x.registerExtent), ['0-24', '0-30']);
    assert.equal(extent.totalSqm, 4800);
  });

  /** The hit that sets the documents' extent beside the map's. */
  const documentsHit = (p: DdProject) => compareProjectGis(p, { revenue: revenueReads(p) }).hits.find((h) => h.code === 'revenue_documents_extent');
  /** A title deed for these survey numbers, stating this extent. */
  const deed = (p: DdProject, numbers: string, sqm: number) => file(p, `Sale deed ${numbers}`, 'Sale deed', [fact('survey_numbers', numbers), fact('extent_title', sqm)]);

  it('sets the total beside the extent a document was accepted as stating, in plain numbers', () => {
    const p = threeParcels();
    file(p, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 6750)]);
    file(p, 'Sale deed', 'Sale deed', [fact('extent_title', 6800, { page: 3 })]);
    file(p, 'Survey sketch', 'Survey sketch', [fact('extent_survey', 5000, { review: 'proposed' })]);
    const stated = revenueExtent(p)!.documents!;
    assert.equal(stated.sqm, 6800, 'the title before the khata that says the same land again, and never a reading still waiting');
    assert.equal(stated.from, 'Sale deed, p. 3');
    assert.deepEqual([stated.named, stated.numbers], [false, []], 'no document names a number, and neither does the file: it is the whole site’s');
    assert.deepEqual(
      stated.compared,
      { parcels: ['71', '72', '73'], mapSqm: 7000, mapMoreSqm: 200, apartPct: extentGapPct(6800, 7000), apart: false, wholeNumbers: [], everyParcel: false },
      '200 in 7,000 is under the line',
    );
    // The same figure the valuation takes from the documents first.
    assert.equal(valueOffers(p, NOW).find((o) => o.input === 'land_area' && o.source.kind === 'document')?.value, stated.sqm);

    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'info');
    assert.equal(hit.text, 'The documents state 6,800 sqm (Sale deed, p. 3). The map shows 7,000 sqm: 200 sqm more on the map.');
  });

  it('says the same of one parcel, and raises a gap past the line', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    file(p, 'Sale deed', 'Sale deed', [fact('extent_title', 2000, { page: 2 })]);
    const hit = compareProjectGis(p, { revenue: p.revenueMap }).hits.find((h) => h.code === 'revenue_documents_extent')!;
    assert.equal(hit.severity, 'flag');
    assert.equal(
      hit.text,
      'The documents state 2,000 sqm (Sale deed, p. 2). The map shows 2,400 sqm: 400 sqm more on the map. Both are kept. Which one is the land being sold is a question for the surveyor and the deed.',
    );
    assert.equal(revenueSiteBrief(p)!.extent.documents?.compared?.mapMoreSqm, 400);
  });

  it('raises a gap by one rule, here and in the lender’s check of the papers', () => {
    assert.equal(EXTENT_APART_PCT, 5);
    // A twentieth of the larger figure, or more.
    assert.equal(extentsApart(7368, 7000), false);
    assert.equal(extentsApart(7369, 7000), true);
    assert.equal(extentsApart(7000, 6651), false);
    assert.equal(extentsApart(7000, 6649), true);
    assert.equal(extentsApart(6649, 7000), true, 'whichever way round they are given');

    for (const [sqm, apart] of [[7368, false], [7369, true], [6651, false], [6649, true]] as const) {
      const p = threeParcels();
      file(p, 'Sale deed', 'Sale deed', [fact('extent_title', sqm)]);
      assert.equal(revenueExtent(p)!.documents!.compared!.apart, apart, `${sqm} against 7,000 under the map`);
      assert.equal(documentsHit(p)!.severity, apart ? 'flag' : 'info');
      const check = lenderCheck(p, 'extents_agree')!;
      assert.equal(check.verdict, apart ? 'attention' : 'clear', `${sqm} against 7,000 in the lender’s check`);
      assert.match(check.source, /the state revenue map, 3 parcels added up$/);
    }
    const less = threeParcels();
    file(less, 'Sale deed', 'Sale deed', [fact('extent_title', 7369)]);
    assert.match(documentsHit(less)!.text, /369 sqm less on the map\. Both are kept\./);
  });

  it('adds up what several title deeds state, each for its own survey number', () => {
    const p = threeParcels();
    deed(p, '71', 2400);
    deed(p, '72', 3000);
    deed(p, '73', 1500);
    // The khata is for land the deeds already state: it is the same land said again, and is not added.
    file(p, 'Khata', 'Khata certificate and extract', [fact('survey_numbers', '71, 72 and 73'), fact('extent_khata', 6900)]);
    const stated = revenueExtent(p)!.documents!;
    assert.equal(stated.sources.length, 3);
    assert.equal(stated.sqm, 6900, 'not the 2,400 of whichever deed came first');
    assert.equal(stated.from, '3 documents');
    assert.deepEqual(stated.numbers, ['71', '72', '73']);
    assert.equal(stated.read, 3);
    assert.equal(stated.compared?.mapSqm, 7000);
    assert.equal(stated.compared?.apart, false);
    assert.deepEqual(extentAgainstDocuments(revenueExtent(p)!), {
      stated: '6,900 sqm for Sy. 71, 72 and 73 (3 documents)',
      verdict: 'the map shows 7,000 sqm: 100 sqm more on the map',
      apart: false,
    });
    assert.equal(documentsHit(p)!.severity, 'info');
  });

  it('does not set a deed for three numbers against two parcels', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    deed(p, '71, 72 and 73', 7000);
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual([stated.numbers, stated.read, stated.compared], [['71', '72', '73'], 2, null]);
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'info', '5,400 sqm of parcels against 7,000 sqm of deed is two parcels of three, not land gone missing');
    assert.equal(hit.text, 'The documents state 7,000 sqm for Sy. 71, 72 and 73 (Sale deed, p. 1). 2 of the 3 numbers are read, so the map is not set against it yet.');
    const once = lenderCheck(p, 'extents_agree')!;
    assert.equal(once.headline, 'Stated once', 'and the map is not one of the papers until it is the same land');
    assert.equal(
      once.detail,
      'A lender compares the extent on the title, the khata, the survey sketch and the map. Only one of them states this land, so there is nothing to compare it with. The map is read and is not set beside it: 2 of the 3 numbers are read, so the map is not set against it yet.',
      'it does not say only one of them is on file, when the map is read and left out',
    );
    const noMap = township();
    deed(noMap, '71, 72 and 73', 7000);
    assert.match(lenderCheck(noMap, 'extents_agree')!.detail, /Only one of them is on file, so there is nothing to compare it with\.$/);

    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm for Sy. 71, 72 and 73 (Sale deed, p. 1). The map shows 7,000 sqm: the same.');
    assert.equal(lenderCheck(p, 'extents_agree')!.verdict, 'clear');

    // The same while the deed's own reading still waits for a person: nothing says yet which land it states.
    const waiting = township();
    applyRevenueMap(waiting, read('71', 0), 'tester');
    applyRevenueMap(waiting, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    file(waiting, 'Sale deed', 'Sale deed', [
      fact('survey_numbers', '71, 72 and 73', { review: 'proposed' }),
      fact('extent_title', 7000, { review: 'proposed' }),
    ]);
    assert.equal(documentsHit(waiting), undefined, 'the map is set only against an extent a person has accepted');
    assert.equal(lenderCheck(waiting, 'extents_agree')!.headline, 'Stated once', 'and two parcels added up are not called 23% short of a deed for three');

    // One parcel beside one waiting reading is compared, as it was before parcels were kept.
    const one = township();
    applyRevenueMap(one, read('71', 0), 'tester');
    file(one, 'Sale deed', 'Sale deed', [fact('extent_title', 2400, { review: 'proposed' })]);
    assert.equal(lenderCheck(one, 'extents_agree')!.verdict, 'clear');
    assert.match(lenderCheck(one, 'extents_agree')!.source, /the state revenue map$/);

    // Not a model's reading. Nobody has accepted it, so it is no paper beside the map: it waits, and the check says so.
    const model = township();
    applyRevenueMap(model, read('71', 0), 'tester');
    file(model, 'Sale deed', 'Sale deed', [fact('extent_title', 1100, { review: 'proposed', source: 'model' })]);
    const waits = lenderCheck(model, 'extents_agree')!;
    assert.deepEqual([waits.verdict, waits.headline], ['unknown', 'Stated once'], '1,100 beside the map’s 2,400 is not 54% apart while it is a model’s word');
    assert.match(waits.detail, /A reading of the extent_title on the sale deed is waiting to be accepted and is not counted\./);
    assert.match(waits.source, /^the state revenue map$/);
    reviewFacts(model, model.evidence.find((e) => e.documentType === 'Sale deed')!.id, ['extent_title'], 'accept', 'tester');
    assert.equal(lenderCheck(model, 'extents_agree')!.verdict, 'blocker', 'accepted, it is a paper like any other');

    // And several parcels with no document beside them are the one statement there is.
    const alone = threeParcels();
    assert.deepEqual([lenderCheck(alone, 'extents_agree')!.headline, lenderCheck(alone, 'extents_agree')!.source], ['Stated once', 'the state revenue map, 3 parcels added up']);
  });

  it('takes an extent whose document names no number as the whole site’s: every parcel read, once every number the file states is among them', () => {
    const p = township({ parcelId: 'Sy. No. 71' });
    file(p, 'Sale deed', 'Sale deed', [fact('extent_title', 7000)]);
    // Sy. 72 and 73 are numbers a person typed: nothing on the file states them.
    applyRevenueMap(p, read('72', 80, { areaSqm: 3000 }), 'tester');
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 1600 }), 'tester');
    const before = revenueExtent(p)!.documents!;
    assert.deepEqual([before.named, before.numbers, before.read, before.compared], [false, ['71'], 0, null]);
    assert.equal(documentsHit(p)!.severity, 'info');
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm (Sale deed, p. 1). Sy. 71, which the file states, is not read, so the map is not set against it yet.');

    applyRevenueMap(p, read('71', 0, { readAt: '2026-10-01T06:02:00.000Z' }), 'tester');
    const after = revenueExtent(p)!.documents!;
    assert.deepEqual(after.compared?.parcels, ['72', '73', '71']);
    assert.equal(after.compared?.mapSqm, 7000, 'not Sy. 71 alone, which is all the file names');
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm (Sale deed, p. 1). The map shows 7,000 sqm: the same.');
    assert.equal(lenderCheck(p, 'extents_agree')!.verdict, 'clear');

    // Where the file names a part of a number and the map answers with the whole of it, that is said of this figure too.
    const part = township({ parcelId: 'Sy. No. 71/1' });
    file(part, 'Sale deed', 'Sale deed', [fact('extent_title', 1000)]);
    applyRevenueMap(part, read('71', 0), 'tester', '71/1');
    assert.equal(documentsHit(part)!.severity, 'info');
    assert.equal(
      documentsHit(part)!.text,
      'The documents state 1,000 sqm (Sale deed, p. 1). The map shows 2,400 sqm: 1,400 sqm more on the map; the map holds the whole of Sy. 71, asked for here by a part.',
    );
  });

  it('says which number is not read when a deed is for one', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    deed(p, '73', 1600);
    assert.equal(documentsHit(p)!.severity, 'info');
    assert.equal(documentsHit(p)!.text, 'The documents state 1,600 sqm for Sy. 73 (Sale deed, p. 1). Sy. 73 is not read, so the map is not set against it yet.');
  });

  it('sets a deed for two numbers against those two parcels, not against the third beside them', () => {
    const p = threeParcels();
    deed(p, '71 and 72', 5000);
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual(stated.compared?.parcels, ['71', '72']);
    assert.equal(stated.compared?.mapSqm, 5400, 'Sy. 73 is read, and the deed is not about it');
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'flag');
    assert.match(hit.text, /^The documents state 5,000 sqm for Sy\. 71 and 72 \(Sale deed, p\. 1\)\. Their parcels on the map measure 5,400 sqm: 400 sqm more on the map\. Both are kept\./);
    assert.match(lenderCheck(p, 'extents_agree')!.source, /the state revenue map, 2 parcels added up$/);
  });

  it('says a whole survey number is more land than a part of it, and does not raise it', () => {
    const p = township();
    // The deed is for 71/1. The state's map holds 71 whole, and answers with that.
    deed(p, '71/1', 1000);
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual(stated.compared, { parcels: ['71'], mapSqm: 2400, mapMoreSqm: 1400, apartPct: extentGapPct(1000, 2400), apart: false, wholeNumbers: ['71'], everyParcel: false });
    const overlay = compareProjectGis(p, { revenue: revenueReads(p) });
    const hit = overlay.hits.find((h) => h.code === 'revenue_documents_extent')!;
    assert.equal(hit.severity, 'info');
    assert.equal(
      hit.text,
      'The documents state 1,000 sqm for Sy. 71/1 (Sale deed, p. 1). The map shows 2,400 sqm: 1,400 sqm more on the map; the map holds the whole of Sy. 71, of which the documents state a part.',
    );
    assert.match(overlay.hits.find((h) => h.code === 'revenue_parcel')!.text, /2,400 sqm surveyed\. The map holds the whole survey number, asked for as 71\/1\. /);
    assert.equal(lenderCheck(p, 'extents_agree')!.headline, 'Stated once', 'a whole number is not put among the papers against a part of it');

    // A part cannot be more land than the whole: that way round it is raised.
    const more = township();
    deed(more, '71/1', 3000);
    applyRevenueMap(more, read('71', 0), 'tester', '71/1');
    assert.equal(revenueExtent(more)!.documents!.compared!.apart, true);
    assert.equal(compareProjectGis(more, { revenue: revenueReads(more) }).hits.find((h) => h.code === 'revenue_documents_extent')!.severity, 'flag');
  });

  it('takes a deed the page gave one number of for that parcel at least, and for every parcel read where its figure is theirs', () => {
    // "Sy. Nos. 71, 72 and 73 … 7000 square metres", of which a page read as text keeps the one number it repeats.
    const p = threeParcels();
    deed(p, '71', 7000);
    const stated = revenueExtent(p)!.documents!;
    assert.equal(stated.sources[0]!.atLeast, true);
    assert.deepEqual(stated.compared, { parcels: ['71', '72', '73'], mapSqm: 7000, mapMoreSqm: 0, apartPct: 0, apart: false, wholeNumbers: [], everyParcel: true });
    assert.equal(documentsHit(p)!.severity, 'info', 'not 4,600 sqm less on the map than a parcel of 2,400');
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm (Sale deed, p. 1). The map shows 7,000 sqm for every parcel read: the same.');
    const check = lenderCheck(p, 'extents_agree')!;
    assert.equal(check.verdict, 'clear', 'and the lender’s check takes that total, not a parcel 66% short of the deed');
    assert.equal(check.detail, '2 statements of the extent agree: 7,000 sqm (Sale deed p. 1); 7,000 sqm (the state revenue map, 3 parcels added up).');
  });

  it('still raises such a deed while its figure is neither that parcel’s nor every parcel’s, and says what to do', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    deed(p, '71', 7000);
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'flag');
    assert.equal(
      hit.text,
      'The documents state 7,000 sqm for Sy. 71 (Sale deed, p. 1). Their parcels on the map measure 2,400 sqm: 4,600 sqm less on the map; the page was read as naming Sy. 71 alone, so if the document is for more survey numbers, read those too. Both are kept. Which one is the land being sold is a question for the surveyor and the deed.',
    );
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');
    assert.equal(documentsHit(p)!.severity, 'info', 'read the third, and it is the figure of every parcel');

    // More land on the map than a deed for one number states is raised as it always was.
    const less = threeParcels();
    deed(less, '71', 1000);
    assert.equal(documentsHit(less)!.severity, 'flag');
    assert.match(documentsHit(less)!.text, /Their parcels on the map measure 2,400 sqm: 1,400 sqm more on the map\. Both are kept\./);
  });

  it('holds such a deed at “2 of 3 read” while a number the file states is unread, as the check beside it does', () => {
    // The record names three survey numbers. The deed, read off the page, names one of them and states 7,000 sqm.
    const p = township({ parcelId: 'Sy. Nos. 71, 72 and 73' });
    deed(p, '71', 7000);
    const joined = { prohibitedRegisterUnjoined: false };
    applyRevenueMap(p, read('71', 0, joined), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000, ...joined }), 'tester');
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual([stated.named, stated.numbers, stated.read, stated.compared], [false, ['71', '72', '73'], 2, null]);
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'info', 'not 4,600 sqm less on the map, with a third parcel still to read');
    assert.equal(hit.text, 'The documents state 7,000 sqm (Sale deed, p. 1). 2 of the 3 numbers the file states are read, so the map is not set against it yet.');
    const papers = lenderCheck(p, 'extents_agree')!;
    assert.equal(papers.headline, 'Stated once', 'nor 66% apart');
    assert.match(papers.detail, /The map is read and is not set beside it: 2 of the 3 numbers the file states are read, so the map is not set against it yet\.$/);
    assert.equal(lenderCheck(p, 'prohibited')!.headline, 'Sy. 73 not read', 'the three say one thing');

    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600, ...joined }), 'tester');
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm (Sale deed, p. 1). The map shows 7,000 sqm for every parcel read: the same.');
    assert.equal(lenderCheck(p, 'extents_agree')!.verdict, 'clear');
    assert.equal(lenderCheck(p, 'prohibited')!.verdict, 'clear');

    // With every number the file states read and the figure still nobody's, it is raised, and says what to do.
    const short = township({ parcelId: 'Sy. Nos. 71 and 72' });
    deed(short, '71', 7000);
    applyRevenueMap(short, read('71', 0), 'tester');
    applyRevenueMap(short, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    assert.equal(documentsHit(short)!.severity, 'flag');
    assert.match(documentsHit(short)!.text, /4,600 sqm less on the map; the page was read as naming Sy\. 71 alone, so if the document is for more survey numbers, read those too\./);
  });

  it('takes a number a model read, or one a person corrected, as all the document names', () => {
    for (const how of [{ source: 'model' as const }, { edited: true }]) {
      const p = threeParcels();
      file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '71', how), fact('extent_title', 7000)]);
      const stated = revenueExtent(p)!.documents!;
      assert.equal(stated.sources[0]!.atLeast, false);
      assert.equal(stated.compared?.everyParcel, false);
      assert.equal(documentsHit(p)!.severity, 'flag', '7,000 sqm for Sy. 71 and no other, against a parcel of 2,400');
    }
  });

  it('waits for the numbers a document is read as stating while only its extent is accepted', () => {
    // Accepting an extent in the valuation accepts that one value: the survey numbers beside it still wait.
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    file(p, 'Deed of the three', 'Sale deed', [fact('survey_numbers', '71, 72 and 73', { review: 'proposed' }), fact('extent_title', 7000)]);
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual([stated.named, stated.numbers, stated.read, stated.compared], [true, ['71', '72', '73'], 2, null]);
    assert.equal(documentsHit(p)!.severity, 'info', 'not 1,600 sqm less on the map');
    assert.equal(
      documentsHit(p)!.text,
      'The documents state 7,000 sqm for Sy. 71, 72 and 73 (Sale deed, p. 1). 2 of the 3 numbers are read, so the map is not set against it yet.',
    );
    assert.equal(lenderCheck(p, 'extents_agree')!.headline, 'Stated once', 'nor 23% apart');
  });

  it('sets an accepted extent against nothing while its document’s numbers are a model’s reading nobody accepted', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    const jda = file(p, 'Deed of the three', 'Sale deed', [fact('survey_numbers', '71, 72 and 73', { review: 'proposed', source: 'model' }), fact('extent_title', 7000)]);
    const stated = revenueExtent(p)!.documents!;
    // The numbers are not taken for the document's, and neither is their absence: the extent is not made the whole site's.
    assert.deepEqual([stated.named, stated.numbers, stated.sources[0]!.numbersWaiting, stated.compared], [true, [], true, null]);
    assert.equal(documentsHit(p)!.severity, 'info', 'not 1,600 sqm less on the map');
    assert.equal(
      documentsHit(p)!.text,
      'The documents state 7,000 sqm (Sale deed, p. 1). A reading of the survey numbers it names is waiting to be accepted, so the land it is for is not told yet and the map is not set against it.',
    );
    const lender = lenderCheck(p, 'extents_agree')!;
    assert.equal(lender.headline, 'Stated once', 'nor 23% apart');
    assert.match(lender.detail, /A reading of the survey_numbers on the sale deed is waiting to be accepted and is not counted\./);
    // Accepted, they are the land the extent is for, and the comparison waits only for the third parcel.
    reviewFacts(p, jda.id, ['survey_numbers'], 'accept', 'tester');
    assert.match(documentsHit(p)!.text, /for Sy\. 71, 72 and 73 .* 2 of the 3 numbers are read, so the map is not set against it yet\./);
  });

  it('adds up three deeds whose extents are accepted and whose numbers still wait', () => {
    const p = threeParcels();
    for (const [number, sqm] of [['71', 2400], ['72', 3000], ['73', 1600]] as const) {
      file(p, `Sale deed ${number}`, 'Sale deed', [fact('survey_numbers', number, { review: 'proposed' }), fact('extent_title', sqm)]);
    }
    assert.equal(revenueExtent(p)!.documents!.sqm, 7000, 'not the newest deed’s 1,600 taken for the whole site');
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm for Sy. 71, 72 and 73 (3 documents). The map shows 7,000 sqm: the same.');
  });

  it('takes none of several documents for the site where none names a number and they do not agree', () => {
    const p = threeParcels();
    file(p, 'Sale deed A', 'Sale deed', [fact('extent_title', 2400)]);
    file(p, 'Sale deed B', 'Sale deed', [fact('extent_title', 3000)]);
    file(p, 'Sale deed C', 'Sale deed', [fact('extent_title', 1600)]);
    const stated = revenueExtent(p)!.documents!;
    assert.deepEqual([stated.sqm, stated.compared, stated.sources.length], [null, null, 3]);
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'info', 'not 5,400 sqm more on the map than whichever deed was filed last');
    assert.match(hit.text, /^The documents state [\d, sqmand]+ \(3 documents\)\. None of them names a survey number, so they may be the same land or different land: they are neither added up nor set against the map\.$/);
    for (const figure of ['2,400 sqm', '3,000 sqm', '1,600 sqm']) assert.ok(hit.text.includes(figure), figure);
    // The lender's check still sets them against each other, as it always has: nothing says they are different land.
    const check = lenderCheck(p, 'extents_agree')!;
    assert.equal(check.verdict, 'blocker');
    assert.doesNotMatch(check.source, /revenue map/);
    assert.match(check.detail, /The map is read and is not set beside them: none of them names a survey number/);

    // Three deeds for three equal plots agree with each other and are still three plots: one is not taken for the site.
    const plots = township();
    for (const [number, at] of [['71', 0], ['72', 1], ['73', 2]] as const) {
      applyRevenueMap(plots, read(number, at * 80, { readAt: `2026-10-01T06:0${at}:00.000Z` }), 'tester');
      file(plots, `Sale deed ${number}`, 'Sale deed', [fact('extent_title', 2400)]);
    }
    assert.equal(revenueExtent(plots)!.documents!.sqm, null);
    assert.equal(documentsHit(plots)!.severity, 'info', 'not 4,800 sqm more on the map than one deed of the three');

    // A deed, its khata and its sketch are different papers for one piece of land, and say it again while they agree.
    const papers = threeParcels();
    file(papers, 'Sale deed', 'Sale deed', [fact('extent_title', 7000)]);
    file(papers, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 6900)]);
    file(papers, 'Survey sketch', 'Survey sketch', [fact('extent_survey', 7050)]);
    assert.equal(revenueExtent(papers)!.documents!.sqm, 7000);
    assert.equal(documentsHit(papers)!.text, 'The documents state 7,000 sqm (Sale deed, p. 1). The map shows 7,000 sqm: the same.');
    assert.equal(lenderCheck(papers, 'extents_agree')!.verdict, 'clear');
  });

  it('adds deeds for different survey numbers up in the lender’s check, as the map’s own comparison does', () => {
    const p = threeParcels();
    deed(p, '71', 2400);
    deed(p, '72', 3000);
    deed(p, '73', 1600);
    assert.equal(documentsHit(p)!.text, 'The documents state 7,000 sqm for Sy. 71, 72 and 73 (3 documents). The map shows 7,000 sqm: the same.');
    const check = lenderCheck(p, 'extents_agree')!;
    assert.equal(check.verdict, 'clear', 'three deeds for three parcels do not disagree by being three sizes: not 47% apart beside “the same”');
    assert.equal(check.detail, '2 statements of the extent agree: 7,000 sqm (3 documents for different survey numbers, added up); 7,000 sqm (the state revenue map, 3 parcels added up).');

    // With no map read, nothing states any of that land a second time.
    const papers = township();
    deed(papers, '71', 2400);
    deed(papers, '72', 3000);
    deed(papers, '73', 1600);
    const alone = lenderCheck(papers, 'extents_agree')!;
    assert.deepEqual([alone.verdict, alone.headline], ['unknown', 'Stated once']);
    assert.match(alone.detail, /The 3 documents on file state the extents of different survey numbers, 7,000 sqm in all, and nothing else states the same land, so there is nothing to compare them with\.$/);

    // A khata for one of those numbers is set against that number's deed, and against no other.
    file(papers, 'Khata', 'Khata certificate and extract', [fact('survey_numbers', '72'), fact('extent_khata', 2500)]);
    const one = lenderCheck(papers, 'extents_agree')!;
    assert.equal(one.verdict, 'blocker', '2,500 against 3,000');
    assert.match(one.detail, /^The papers disagree on the extent: 3,000 sqm \(Sale deed p\. 1\); 2,500 sqm \(Khata certificate and extract p\. 1\)\./);

    // And a khata for all three against what the three deeds add up to.
    file(papers, 'Khata of the whole', 'Khata certificate and extract', [fact('survey_numbers', '71, 72 and 73', { source: 'model' }), fact('extent_khata', 7000)]);
    assert.match(lenderCheck(papers, 'extents_agree')!.source, /^3 documents for different survey numbers, added up, Khata certificate and extract p\. 1/);
  });

  it('still sets a paper that names no number against the one that does, as the lender’s check always has', () => {
    const p = township();
    deed(p, '71', 2400);
    file(p, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 2900)]);
    const check = lenderCheck(p, 'extents_agree')!;
    assert.equal(check.verdict, 'blocker', '2,400 on the deed against 2,900 on the khata');
    assert.match(check.detail, /^The papers disagree on the extent: 2,400 sqm \(Sale deed p\. 1\); 2,900 sqm \(Khata certificate and extract p\. 1\)\./);

    // Beside deeds for several numbers it is the whole site's, set against what they add up to.
    const several = township();
    deed(several, '71', 2400);
    deed(several, '72', 3000);
    file(several, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 5400)]);
    const whole = lenderCheck(several, 'extents_agree')!;
    assert.equal(whole.verdict, 'clear');
    assert.equal(whole.detail, '2 statements of the extent agree: 5,400 sqm (2 documents for different survey numbers, added up); 5,400 sqm (Khata certificate and extract p. 1).');
  });

  it('lets a whole survey number account for more land on the map only up to its own area', () => {
    const p = township();
    file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '71/1, 72, 73, 74, 75 and 76', { source: 'model' }), fact('extent_title', 30_000)]);
    applyRevenueMap(p, read('71', 0, { areaSqm: 5000 }), 'tester', '71/1');
    ['72', '73', '74', '75', '76'].forEach((number, at) => {
      applyRevenueMap(p, read(number, 80 * (at + 1), { readAt: `2026-10-01T06:0${at + 1}:00.000Z`, areaSqm: 10_000 }), 'tester');
    });
    const compared = revenueExtent(p)!.documents!.compared!;
    assert.deepEqual([compared.mapSqm, compared.wholeNumbers], [55_000, ['71']]);
    assert.equal(compared.apart, true, 'the five parcels that are not a whole number are 50,000 sqm by themselves, against a deed for 30,000');
    assert.equal(documentsHit(p)!.severity, 'flag');
    assert.match(
      documentsHit(p)!.text,
      /The map shows 55,000 sqm: 25,000 sqm more on the map; the map holds the whole of Sy\. 71, and the parcels without it still measure more than the documents state\. Both are kept\./,
    );

    assert.deepEqual(extentAgainstMap(30_000, 55_000, 5_000), { apart: true, excused: false });
    assert.deepEqual(extentAgainstMap(51_000, 55_000, 5_000), { apart: false, excused: true }, 'a gap the whole number’s own area covers');
    assert.deepEqual(extentAgainstMap(54_000, 55_000, 5_000), { apart: false, excused: false }, 'a gap under the line needs no accounting for');
    assert.deepEqual(extentAgainstMap(60_000, 55_000, 5_000), { apart: true, excused: false }, 'less land on the map is never accounted for this way');
  });

  it('sets nothing against a document some of whose numbers could not be read', () => {
    const p = township();
    file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '80 and 81 to 85', { source: 'model' }), fact('extent_title', 60_000)]);
    applyRevenueMap(p, read('80', 0, { areaSqm: 10_000 }), 'tester');
    assert.equal(revenueExtent(p)!.documents!.compared, null);
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'info', 'not 50,000 sqm less on the map than a deed for Sy. 80');
    assert.equal(
      hit.text,
      'The documents state 60,000 sqm (Sale deed, p. 1). It names “81 to 85”, which is not read as survey numbers, so the land it is for cannot be told and the map is not set against it.',
    );
    assert.equal(lenderCheck(p, 'extents_agree')!.headline, 'Stated once');
  });

  it('does not match a deed’s number to whichever of two parcels carrying it was read first', () => {
    const p = township();
    file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '71', { source: 'model' }), fact('extent_title', 2400)]);
    applyRevenueMap(p, read('71', 0, { areaSqm: 9000 }), 'tester');
    applyRevenueMap(p, read('71', 500, { readAt: '2026-10-01T06:01:00.000Z', parcelRef: 'kgis:2999999998:71', village: 'Kalyani' }), 'tester');
    assert.equal(revenueExtent(p)!.documents!.compared, null);
    const hit = documentsHit(p)!;
    assert.equal(hit.severity, 'info', 'not 6,600 sqm more on the map, from the Sy. 71 of the other village');
    assert.equal(
      hit.text,
      'The documents state 2,400 sqm for Sy. 71 (Sale deed, p. 1). Two parcels read carry the number 71, Sy. 71 (Hosakere) and 71 (Kalyani), and the documents do not say which, so the map is not set against it.',
    );
    assert.equal(lenderCheck(p, 'extents_agree')!.headline, 'Stated once');
  });

  it('compares a person’s outline, and the land area on the project, with all the parcels and not with one', () => {
    const own = township();
    applySurveyBoundary(own, geojson(rect(0, 0, 220, 40)), 'surveyor.geojson', 'tester');
    threeParcels(own);
    const hits = compareProjectGis(own, { revenue: revenueReads(own) }).hits;
    const extent = hits.filter((h) => h.code === 'revenue_extent');
    assert.equal(extent.length, 1, 'once, not once for each parcel');
    assert.match(extent[0]!.text, /more than the revenue map’s 3 parcels together \(Sy\. 71, 72 and 73, 7,000 sqm\)/);

    const sized = threeParcels();
    sized.landAreaSqm = 7100;
    assert.equal(compareProjectGis(sized, { revenue: revenueReads(sized) }).hits.some((h) => h.code === 'survey_area'), false, 'one parcel of three is not held against the whole site’s area');
    sized.landAreaSqm = 9000;
    const area = compareProjectGis(sized, { revenue: revenueReads(sized) }).hits.find((h) => h.code === 'survey_area')!;
    assert.match(area.text, /The 3 parcels read from the revenue map enclose 22\.2% less than the land area on this project \(9,000 sqm\)/);
  });
});

describe('a finding about one parcel names it', () => {
  it('on the prohibited register, far from the pin, and under water', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0, { prohibitedRegisterUnjoined: false }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', prohibitedCategory: 'Government land', prohibitedRegisterUnjoined: false }), 'tester');
    applyRevenueMap(p, read('73', 5000, { readAt: '2026-10-01T06:02:00.000Z' }), 'tester');
    const overlay = compareProjectGis(p, {
      places: { provider: 'stub', configured: true, query: 'Hosakere', point: ORIGIN, amenities: [], gaps: [] },
      revenue: revenueReads(p),
      osm: { features: [{ id: 'osm_tank', kind: 'osm_water', name: 'tank', ring: rect(90, 10, 30, 20) }] },
    });
    const of = (code: string) => overlay.hits.filter((h) => h.code === code);

    assert.equal(of('revenue_prohibited').length, 1);
    assert.match(of('revenue_prohibited')[0]!.text, /^Sy\. 72 is on the prohibited-property register \(Government land\)/);
    assert.match(of('revenue_register_unjoined')[0]!.text, /No prohibited-register entry came back for Sy\. 73,/, 'silence is named for the parcel it is silence about');

    assert.equal(of('revenue_far_from_pin').length, 1);
    assert.match(of('revenue_far_from_pin')[0]!.text, /The revenue map places Sy\. 73, /);

    assert.equal(of('osm_water_overlap').length, 1);
    assert.match(of('osm_water_overlap')[0]!.text, /^The revenue map’s parcel for Sy\. 72 overlaps OSM tank/);

    const parcels = of('revenue_parcel');
    assert.equal(parcels.length, 1);
    assert.match(parcels[0]!.text, /Revenue map: 3 parcels.*Sy\. 71 \(2,400 sqm\), Sy\. 72 \(2,400 sqm\), Sy\. 73 \(2,400 sqm\)\. 7,200 sqm in all/);
    assert.match(parcels[0]!.text, /not a licensed survey/);
  });

  it('in the valuation’s lender checks, where one listed parcel blocks the site', () => {
    const p = threeParcels();
    const check = () => {
      const working = runValuationApproaches(p);
      return valueChecks(p, working, valueSummary(p, working)).find((c) => c.key === 'prohibited')!;
    };
    assert.equal(check().verdict, 'unknown', 'three parcels the register is not joined to');
    // Each read again, from a layer that is joined to the register.
    for (const r of revenueReads(p)) applyRevenueMap(p, { ...r, prohibitedRegisterUnjoined: false }, 'tester');
    assert.equal(check().verdict, 'clear');
    applyRevenueMap(p, { ...revenueReads(p)[2]!, prohibitedCategory: 'Inam land' }, 'tester');
    assert.equal(check().verdict, 'blocker');
    assert.equal(check().headline, 'Sy. 73 listed');
  });

  it('does not call the site clear of the prohibited register while a number the file states is unread', () => {
    const p = township();
    file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', '71, 72 and 73', { source: 'model' })]);
    file(p, 'Fire NOC', 'Fire NOC', [fact('covered_survey_numbers', '90 & 91', { review: 'proposed' })]);
    const joined = { prohibitedRegisterUnjoined: false };
    applyRevenueMap(p, read('71', 0, joined), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', ...joined }), 'tester');
    const two = lenderCheck(p, 'prohibited')!;
    assert.deepEqual([two.verdict, two.headline], ['unknown', 'Sy. 73 not read'], 'two parcels clear do not answer for the third');
    assert.equal(
      two.detail,
      'The revenue map read found none of the 2 parcels on a prohibited register. But Sy. 73 is stated on this file and not read from the map, and one listed parcel blocks a site. Read it, or search the register at the sub-registrar.',
    );

    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', ...joined }), 'tester');
    assert.equal(lenderCheck(p, 'prohibited')!.verdict, 'clear', 'a number that only waits on a reading nobody accepted does not hold it back');

    // One parcel read of three stated is no clearer, and a listed parcel blocks whatever is unread.
    const one = township();
    file(one, 'Sale deed', 'Sale deed', [fact('survey_numbers', '71, 72 and 73', { source: 'model' })]);
    applyRevenueMap(one, read('71', 0, joined), 'tester');
    assert.deepEqual([lenderCheck(one, 'prohibited')!.verdict, lenderCheck(one, 'prohibited')!.headline], ['unknown', 'Sy. 72 and 73 not read']);
    applyRevenueMap(one, read('71', 0, { readAt: '2026-10-02T06:00:00.000Z', prohibitedCategory: 'Government land', ...joined }), 'tester');
    assert.equal(lenderCheck(one, 'prohibited')!.verdict, 'blocker');
  });
});

describe('more land on a whole survey number, against the figures on the file', () => {
  const kinds = (p: DdProject, code: string) => compareProjectGis(p, { revenue: revenueReads(p) }).hits.filter((h) => h.code === code);
  const SAID = 'where a part was asked for, so more land on the map is what a part of a survey number looks like.';
  const raised = (p: DdProject) => runProjectScreen(p, NOW.toISOString()).risks.some((r) => r.code === 'boundary_area_mismatch');

  it('is said and not raised for one parcel, on the map and on the screen', () => {
    const p = township();
    p.landAreaSqm = 480;
    // 71/1 was asked for. The state's map holds 71 whole: 2,400 sqm, five times the land on the file.
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    const area = kinds(p, 'survey_area');
    assert.deepEqual(area.map((h) => h.severity), ['info']);
    assert.equal(area[0]!.text, `The outline encloses 400.0% more than the land area on this project (480 sqm). The map holds the whole of Sy. 71, ${SAID}`);
    assert.equal(projectToIdentity(p).boundary, undefined, 'the whole of a number is not the outline of a part of it');
    assert.equal(raised(p), false);

    // Less land in the outline than on the file is not what a part of a number looks like, and is raised.
    p.landAreaSqm = 9000;
    assert.deepEqual(kinds(p, 'survey_area').map((h) => h.severity), ['flag']);

    // Asked for by its own number, the parcel is the site: raised on the map and on the screen as it always was.
    const own = township();
    own.landAreaSqm = 480;
    applyRevenueMap(own, read('71', 0), 'tester');
    assert.deepEqual(kinds(own, 'survey_area').map((h) => h.severity), ['flag']);
    assert.equal(raised(own), true);
  });

  it('is said and not raised for several, up to the whole numbers’ own area', () => {
    const p = township();
    p.landAreaSqm = 864;
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z' }), 'tester', '72/3');
    const area = kinds(p, 'survey_area');
    assert.deepEqual(area.map((h) => h.severity), ['info']);
    assert.equal(area[0]!.text, `The 2 parcels read from the revenue map enclose 455.6% more than the land area on this project (864 sqm). The map holds the whole of Sy. 71 and 72, ${SAID}`);

    // A third parcel that is nobody's part: it and the land area are like for like, and 1,600 sqm against 864 is raised.
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');
    assert.deepEqual(kinds(p, 'survey_area').map((h) => h.severity), ['flag']);
  });

  it('is said and not raised against a person’s own outline of the part', () => {
    const p = township();
    applySurveyBoundary(p, geojson(rect(0, 0, 25, 40)), 'surveyor.geojson', 'tester');
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    const one = kinds(p, 'revenue_extent');
    assert.deepEqual(one.map((h) => h.severity), ['info']);
    assert.match(one[0]!.text, /^The supplied survey outline encloses 58\.3% less than the revenue map’s parcel for Sy\. 71 \(2,400 sqm\)\. The map holds the whole of Sy\. 71, where a part was asked for/);

    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z' }), 'tester', '72/3');
    const two = kinds(p, 'revenue_extent');
    assert.deepEqual(two.map((h) => h.severity), ['info']);
    assert.match(two[0]!.text, /than the revenue map’s 2 parcels together \(Sy\. 71 and 72, 4,800 sqm\)\. The map holds the whole of Sy\. 71 and 72, where a part was asked for/);
  });
});

describe('what the valuation is offered', () => {
  const landFromMap = (p: DdProject) => valueOffers(p, NOW).filter((o) => o.input === 'land_area' && o.source.kind === 'revenue_map');

  it('offers the parcels added up as the land area, last, naming the numbers', () => {
    const p = threeParcels();
    file(p, 'Sale deed', 'Sale deed', [fact('extent_title', 6800)]);
    const offers = valueOffers(p, NOW).filter((o) => o.input === 'land_area');
    assert.deepEqual(offers.map((o) => [o.value, o.source.kind]), [[6800, 'document'], [7000, 'revenue_map']]);
    const total = offers[1]!;
    assert.equal(total.rank, 5);
    assert.equal(total.source.detail, 'Sy. 71, 72 and 73, Hosakere');
    assert.match(total.basis, /The 3 parcel outlines the state publishes for these survey numbers, added up\./);
    assert.match(total.basis, /Machine-read/);
  });

  it('offers one parcel exactly as it always has', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    const [only] = landFromMap(p);
    assert.equal(only!.value, 2400);
    assert.equal(only!.source.detail, 'Sy. 71, Hosakere');
    assert.equal(only!.id, 'land_area|revenue_map|Sy. 71, Hosakere||2400', 'so an offer set aside before stays set aside');
    assert.match(only!.basis, /^The parcel outline the state publishes for this survey number\./);
  });

  it('keeps one guidance value, says which parcel it is, and names the others where they differ', () => {
    const anchor = (guidancePerUnit: number) => ({ guidancePerUnit, unit: 'sqyd' as const, locality: 'Hosakere', note: 'Kaveri guidance value as published.' });
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', anchor: anchor(18_000) }), 'tester');
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', anchor: anchor(18_000) }), 'tester');

    const same = valueOffers(p, NOW).filter((o) => o.input === 'land_rate_per_sqm');
    assert.equal(same.length, 1);
    assert.equal(same[0]!.source.detail, 'Guidance value, Hosakere, Sy. 72', 'the first parcel that carries one');
    assert.match(same[0]!.basis, /Read for Sy\. 72\./);
    assert.doesNotMatch(same[0]!.basis, /differ/);
    assert.deepEqual(revenueGuidance(revenueReads(p))?.differing, []);

    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-02T06:00:00.000Z', anchor: anchor(24_000) }), 'tester');
    const differ = valueOffers(p, NOW).filter((o) => o.input === 'land_rate_per_sqm');
    assert.equal(differ.length, 1, 'still one, not one for each');
    assert.equal(Math.round(differ[0]!.value), Math.round(18_000 / 0.83612736), 'the first parcel’s, never an average');
    assert.match(differ[0]!.basis, /Sy\. 73 carries ₹24,000 per sq yd: the published values differ by parcel, and this is the one for Sy\. 72, not an average\./);

    createAssessment(p, { ddType: 'indicative_valuation', name: 'Valuation', owner: 'tester', targetType: 'project' });
    const taken = acceptValueOffers(p, [differ[0]!.id], 'tester');
    assert.deepEqual(taken.refused, []);
    const cited = revenueReads(p)[1]!;
    assert.ok(p.evidence.some((e) => e.screenCode === revenueMapEvidenceCode(cited)), 'accepting it files the read of the parcel it came from');
    assert.equal(p.evidence.some((e) => e.screenCode === revenueMapEvidenceCode(p.revenueMap!)), false);
  });

  it('says what the total is not: the whole of a number asked for by a part, and a number nobody has accepted', () => {
    const p = township();
    const rera = file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '72', { review: 'proposed', source: 'model' })]);
    file(p, 'Fire NOC', 'Fire NOC', [fact('covered_survey_numbers', '73', { review: 'proposed' })]);
    applyRevenueMap(p, read('71', 0), 'tester', '71/1');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000 }), 'tester');
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');

    // Beside each parcel in the table under the map,
    assert.deepEqual(revenueExtent(p)!.parcels.map((x) => [x.label, x.askedAs, x.unaccepted]), [['71', ['71/1'], null], ['72', [], 'model'], ['73', [], 'page']]);
    assert.deepEqual(revenueSiteBrief(p)!.parcels.map((x) => [x.askedAs, x.unaccepted]), [[['71/1'], null], [[], 'model'], [[], 'page']]);
    // in the overlay's own words about the parcels,
    assert.match(
      compareProjectGis(p, { revenue: revenueReads(p) }).hits.find((h) => h.code === 'revenue_parcel')!.text,
      /Sy\. 71 \(2,400 sqm; whole survey number, asked for as 71\/1\), Sy\. 72 \(3,000 sqm; read by the model, not yet accepted\), Sy\. 73 \(1,600 sqm; read from the page, not yet accepted\)\. 7,000 sqm in all/,
    );
    // and on the figure the valuation is offered.
    const [total] = landFromMap(p);
    assert.equal(total!.value, 7000);
    assert.match(total!.basis, / Sy\. 71 is the whole survey number, asked for as 71\/1: its outline may hold more land than the site\./);
    assert.match(total!.basis, / Sy\. 72 is read by the model, not yet accepted\./);
    assert.match(total!.basis, / Sy\. 73 is read from the page, not yet accepted\./);

    // Accepting the reading is what takes the words off.
    rera.facts![0]!.review = 'accepted';
    assert.equal(revenueExtent(p)!.parcels[1]!.unaccepted, null);
    assert.doesNotMatch(landFromMap(p)[0]!.basis, /Sy\. 72 is read by the model/);

    // One parcel says it of itself.
    const one = township();
    file(one, 'RERA', 'RERA certificate', [fact('survey_numbers', '72', { review: 'proposed', source: 'model' })]);
    applyRevenueMap(one, read('72', 80, { areaSqm: 3000 }), 'tester');
    assert.match(compareProjectGis(one, { revenue: one.revenueMap }).hits.find((h) => h.code === 'revenue_parcel')!.text, /3,000 sqm surveyed\. The number is read by the model, not yet accepted\. /);
    assert.match(landFromMap(one)[0]!.basis, / Sy\. 72 is read by the model, not yet accepted\.$/);
  });
});

describe('what moves the value, on a site of several parcels', () => {
  const drain = (distanceM: number): RevenueMapFactor => ({
    code: 'ka_drain_buffer',
    label: 'Drain buffer',
    direction: 'down',
    severity: 'high',
    headline: `A stream runs about ${distanceM} m from the plot.`,
    detail: 'A plan inside the buffer is refused.',
    impactLowPct: -8,
    impactHighPct: -3,
    layerKey: 'ka_drain',
    source: 'K-GIS LULC 2023',
    distanceM,
  });
  const zone: RevenueMapFactor = { ...drain(0), code: 'zone_agricultural', label: 'Agricultural zone', severity: 'medium', headline: 'Zoned agricultural in the master plan.', impactLowPct: -5, impactHighPct: -5, layerKey: 'ka_zone' };
  const fromMap = (p: DdProject) =>
    valueDrivers(p, runValuationApproaches(p))
      .filter((d) => d.key.startsWith('map:'))
      .map((d) => [d.key, d.label, d.direction, d.impact, d.basis]);

  it('takes them from every parcel, not from the first alone, and says which parcel', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', factors: [drain(30)] }), 'tester');
    assert.deepEqual(fromMap(p), [['map:ka_drain_buffer', 'Drain buffer · 30 m from Sy. 72', 'down', { low: -8, high: -3 }, 'A stream runs about 30 m from the plot.']]);
  });

  it('tells a finding two parcels share once, and two of one kind apart, each under a key of its own', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0, { factors: [drain(30), zone] }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', factors: [drain(12), zone] }), 'tester');
    const second = read('72', 80).parcelRef;
    assert.deepEqual(fromMap(p), [
      ['map:ka_drain_buffer', 'Drain buffer · 30 m from Sy. 71', 'down', { low: -8, high: -3 }, 'A stream runs about 30 m from the plot.'],
      ['map:zone_agricultural', 'Agricultural zone', 'down', { low: -5, high: -5 }, 'Zoned agricultural in the master plan.'],
      [`map:ka_drain_buffer:${second}`, 'Drain buffer · 12 m from Sy. 72', 'down', { low: -8, high: -3 }, 'A stream runs about 12 m from the plot.'],
    ]);
  });

  it('tells one parcel’s as it always did', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0, { factors: [drain(30), zone] }), 'tester');
    assert.deepEqual(fromMap(p), [
      ['map:ka_drain_buffer', 'Drain buffer', 'down', { low: -8, high: -3 }, 'A stream runs about 30 m from the plot.'],
      ['map:zone_agricultural', 'Agricultural zone', 'down', { low: -5, high: -5 }, 'Zoned agricultural in the master plan.'],
    ]);
  });
});

describe('the guideline value of a site whose parcels carry different rates', () => {
  const anchor = (guidancePerUnit: number) => ({ guidancePerUnit, unit: 'sqyd' as const, locality: 'Hosakere', note: 'Kaveri guidance value as published.' });
  const summary = (p: DdProject) => valueSummary(p, runValuationApproaches(p));
  const SQM_PER_SQYD = 0.83612736;
  /** The same figure, give or take the whole rupee a rate per square metre is kept to. */
  const about = (actual: number, expected: number) => Math.abs(actual / expected - 1) < 1e-4;

  it('counts each parcel at its own rate, in the share of the land its outline is', () => {
    const p = township();
    p.landAreaSqm = 10_000;
    applyRevenueMap(p, read('71', 0, { areaSqm: 1000, anchor: anchor(10_000) }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 9000, anchor: anchor(30_000) }), 'tester');
    const guideline = summary(p).guideline!;
    // A tenth of the land at ₹10,000 and nine tenths at ₹30,000 is ₹28,000 a square yard.
    assert.ok(about(guideline.perSqm, 28_000 / SQM_PER_SQYD), `${guideline.perSqm} a square metre`);
    assert.equal(guideline.areaSqm, 10_000);
    assert.ok(about(guideline.value, 334_877_213), `₹${Math.round(guideline.value)}: about ₹33.5 crore, where the first parcel’s rate on the whole plot made ₹12 crore`);
    assert.equal(guideline.published, 'each parcel at its own rate (Sy. 71 ₹10,000 per sq yd, Sy. 72 ₹30,000 per sq yd)');
  });

  it('gives none, and says why, where one of them carries no rate', () => {
    const p = township();
    p.landAreaSqm = 11_600;
    applyRevenueMap(p, read('71', 0, { areaSqm: 1000, anchor: anchor(10_000) }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 9000, anchor: anchor(30_000) }), 'tester');
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');
    const s = summary(p);
    assert.equal(s.guideline, null);
    assert.equal(
      s.guidelineNote,
      "The map published no guidance value for Sy. 73, so the guideline value of the whole site cannot be worked out from the map. The value it published for Sy. 71 is offered as a land rate, and is that parcel's alone.",
    );
    assert.equal(s.vsGuideline, null);
    const check = lenderCheck(p, 'vs_guideline')!;
    assert.deepEqual([check.verdict, check.headline, check.detail], ['unknown', 'No guideline value for the site', s.guidelineNote], 'the check says which parcel, and is not left out as if there were nothing to say');
  });

  it('gives none either where the others agree: a parcel with no published value is not lent its neighbours’', () => {
    const p = township();
    p.landAreaSqm = 7000;
    applyRevenueMap(p, read('71', 0, { anchor: anchor(18_000) }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000, anchor: anchor(18_000) }), 'tester');
    applyRevenueMap(p, read('73', 160, { readAt: '2026-10-01T06:02:00.000Z', areaSqm: 1600 }), 'tester');
    const s = summary(p);
    assert.equal(s.guideline, null, '1,600 sqm of the site has no published value: ₹18,000 on all of it is nobody’s figure');
    assert.match(s.guidelineNote ?? '', /^The map published no guidance value for Sy\. 73, /);
    assert.equal(lenderCheck(p, 'vs_guideline')!.verdict, 'unknown');
    // The rate itself is still offered, as the one parcel's it is, and which parcel has none is said wherever the value is.
    const rates = valueOffers(p, NOW).filter((o) => o.input === 'land_rate_per_sqm' && o.source.kind === 'revenue_map');
    assert.equal(rates.length, 1);
    assert.match(rates[0]!.basis, / Read for Sy\. 71\. The map published no value for Sy\. 73\. /);
    assert.deepEqual(revenueSiteBrief(p)!.guidance?.unpriced, ['73'], 'beside the value under the map');
    assert.match(compareProjectGis(p, { revenue: revenueReads(p) }).hits.find((h) => h.code === 'revenue_anchor')!.text, /read for Sy\. 71\. The map published no value for Sy\. 73\. /);

    // One parcel with no published value has no guideline value and nothing to say about one, as before.
    const one = township();
    one.landAreaSqm = 2400;
    applyRevenueMap(one, read('71', 0), 'tester');
    assert.deepEqual([summary(one).guideline, summary(one).guidelineNote], [null, undefined]);
  });

  it('is the one rate on the plot where every parcel carries the same, as for one parcel', () => {
    const p = township();
    p.landAreaSqm = 5400;
    applyRevenueMap(p, read('71', 0, { anchor: anchor(18_000) }), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', areaSqm: 3000, anchor: anchor(18_000) }), 'tester');
    const guideline = summary(p).guideline!;
    assert.equal(guideline.published, '₹18,000 per sq yd, Hosakere');
    assert.ok(about(guideline.value, (18_000 / SQM_PER_SQYD) * 5400), `₹${Math.round(guideline.value)}`);
  });
});

describe('the screen, on a site of several parcels', () => {
  const flagged = (p: DdProject) => runProjectScreen(p, NOW.toISOString()).risks.some((r) => r.code === 'boundary_area_mismatch');

  it('does not take the first parcel for the site: it is not held against the whole area, nor set back from', () => {
    const p = threeParcels();
    p.landAreaSqm = 7000;
    assert.equal(p.surveyBoundary?.source, 'revenue_map');
    assert.equal(projectToIdentity(p).boundary, undefined, 'one parcel of three is not the outline of the site');
    assert.equal(flagged(p), false, '2,400 sqm of 7,000 is the first parcel, not two thirds of the land gone');
    assert.ok(p.surveyBoundary, 'and the boundary on the file is left as it was');
  });

  it('takes one parcel, and a person’s outline, as it always did', () => {
    const one = township();
    one.landAreaSqm = 7000;
    applyRevenueMap(one, read('71', 0), 'tester');
    assert.equal(projectToIdentity(one).boundary, one.surveyBoundary);
    assert.equal(flagged(one), true, 'one parcel that stands alone is the site, and 2,400 against 7,000 is said');

    const own = township();
    own.landAreaSqm = 7000;
    applySurveyBoundary(own, geojson(rect(0, 0, 220, 40)), 'surveyor.geojson', 'tester');
    threeParcels(own);
    assert.equal(projectToIdentity(own).boundary, own.surveyBoundary, 'a person’s outline is the site however many parcels are read');
    assert.equal(flagged(own), true, '8,800 sqm outlined against 7,000 recorded');
  });
});

describe('where the picker starts, with several parcels kept', () => {
  it('is the village of the parcel read last', () => {
    const p = township();
    applyRevenueMap(p, read('71', 0), 'tester');
    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T09:00:00.000Z', village: 'Kalyani', mandal: 'Anekal', district: 'Bengaluru (Urban)' }), 'tester');
    const s = suggestRevenuePlace(p);
    assert.equal(s.from, 'last read');
    assert.equal(s.village, 'Kalyani');
  });

  it('still names the first number a document was accepted as stating, split as a list is', () => {
    const p = township();
    file(p, 'RERA', 'RERA certificate', [fact('survey_numbers', '77/3, 78 & 79', { review: 'proposed' })]);
    assert.equal(suggestRevenuePlace(p).surveyNo, undefined, 'a reading still waiting is not offered as the project’s number');
    file(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', 'Sy. No. 71 / 2 and 72')]);
    assert.equal(suggestRevenuePlace(p).surveyNo, '71/2');
  });
});

describe('the engine’s check of the quoted area against one parcel', () => {
  const quoted: RevenueMapFactor = {
    code: 'parcel_extent_mismatch',
    label: 'Claimed extent exceeds the surveyed boundary',
    direction: 'down',
    severity: 'high',
    headline: 'The area quoted is more than the boundary holds.',
    detail: 'Reconcile the two before pricing.',
    impactLowPct: -20,
    impactHighPct: -5,
    layerKey: 'geomForSurveyNum',
    source: 'K-GIS',
    distanceM: 0,
  };
  const other: RevenueMapFactor = { ...quoted, code: 'water_body_near', label: 'Near a water body', headline: 'A tank lies near the plot.' };
  const told = (p: DdProject) => revenueReads(p).map((r) => r.factors.map((f) => f.code));
  const onTheOverlay = (p: DdProject) => compareProjectGis(p, { revenue: revenueReads(p) }).hits.some((h) => h.text.includes(quoted.headline));

  it('is told of a parcel that stands alone, left out while the site has more than one, and told again when it is alone again', () => {
    const p = township();
    p.landAreaSqm = 9000;
    // Read alone, with the land area on the project: the engine holds 9,000 sqm against this one parcel.
    applyRevenueMap(p, read('71', 0, { factors: [quoted, other] }), 'tester');
    assert.deepEqual(told(p), [['parcel_extent_mismatch', 'water_body_near']]);
    assert.equal(onTheOverlay(p), true);

    applyRevenueMap(p, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z', factors: [other] }), 'tester');
    assert.deepEqual(told(p), [['water_body_near'], ['water_body_near']], 'the site’s area is all its parcels, so it is not held against one');
    assert.equal(onTheOverlay(p), false);
    assert.equal(revenueSiteBrief(p)!.warnings.some((w) => w.code === 'parcel_extent_mismatch'), false);
    assert.equal(valueDrivers(p, runValuationApproaches(p)).some((d) => d.key.startsWith('map:parcel_extent_mismatch')), false);
    assert.deepEqual(p.revenueMap!.factors.map((f) => f.code), ['parcel_extent_mismatch', 'water_body_near'], 'the store keeps what the engine said');
    const filed = fileRevenueMapAsEvidence(p, 'tester');
    assert.match(filed.description ?? '', /Near a water body: A tank lies near the plot\./);
    assert.doesNotMatch(filed.description ?? '', /Claimed extent exceeds/, 'and the first parcel is filed as it is told, not as it is stored');

    removeRevenueMapRead(p, read('72', 80).parcelRef, 'tester');
    assert.deepEqual(told(p), [['parcel_extent_mismatch', 'water_body_near']]);
  });

  it('is left out whoever made the first read, and whenever', () => {
    // The code before this asks it of every parcel it reads. A read it made alone is the first of two here.
    const p = township();
    oldCodeReads(p, read('71', 0, { factors: [quoted] }));
    const q = fromStore(p);
    assert.deepEqual(told(q), [['parcel_extent_mismatch']], 'alone, as that code left it, it is told');
    applyRevenueMap(q, read('72', 80, { readAt: '2026-10-01T06:01:00.000Z' }), 'tester');
    assert.deepEqual(told(q), [[], []]);
    assert.equal(onTheOverlay(q), false);
  });
});

describe('the parcel the map answers a survey number with', () => {
  const found = (...numbers: string[]) => numbers.map((parcelNo) => ({ parcelNo, ref: `kgis:2999999999:${parcelNo}` }));

  it('is the number itself, whatever the case of a letter in it', () => {
    assert.equal(parcelAnswering(found('71', '71A', '712'), '71a')?.parcelNo, '71A');
    assert.equal(parcelAnswering(found('71', '712'), '71')?.parcelNo, '71');
  });

  it('is the whole number a part was asked for by, when that is all the search finds', () => {
    assert.equal(parcelAnswering(found('71'), '71/2')?.parcelNo, '71', 'Karnataka’s map holds whole numbers');
    assert.equal(parcelAnswering(found('71'), '71-2')?.parcelNo, '71');
    assert.equal(parcelAnswering(found('71A'), '71a/2')?.parcelNo, '71A');
  });

  it('is never a neighbour the search happened to find', () => {
    assert.equal(parcelAnswering(found('712'), '71'), undefined, 'a village with no 71 does not put 712 on the file under that number');
    assert.equal(parcelAnswering(found('7'), '71'), undefined);
    assert.equal(parcelAnswering(found('71'), '710/2'), undefined);
    assert.equal(parcelAnswering(found('711', '712'), '71'), undefined);
    assert.equal(parcelAnswering([], '71'), undefined);
  });
});

describe('a number the state’s map spells another way than it is kept', () => {
  /** A state's layer that matches a number by how it starts, and spells a part with its zero. */
  function layer(holds: string[]) {
    const asked: string[] = [];
    const search = async (spelling: string) => {
      asked.push(spelling);
      return { ok: true as const, data: holds.filter((parcelNo) => parcelNo.startsWith(spelling)).map((parcelNo) => ({ parcelNo, ref: `ts:${parcelNo}` })) };
    };
    return { asked, search };
  }

  it('is asked for again as the paper writes it, when the number as kept is not found', async () => {
    assert.deepEqual(spellingsToAsk('TS', '77/3', ['77/03']), ['77/3', '77/03']);
    const zeroed = layer(['77/03', '77/04', '78']);
    assert.deepEqual(await parcelUnderAnySpelling(spellingsToAsk('TS', '77/3', ['77/03']), zeroed.search), { found: { parcelNo: '77/03', ref: 'ts:77/03' } });
    assert.deepEqual(zeroed.asked, ['77/3', '77/03']);

    // Found as it is kept, it is asked for once.
    const plain = layer(['77/3', '77/4']);
    assert.deepEqual(await parcelUnderAnySpelling(spellingsToAsk('TS', '77/3', ['77/03']), plain.search), { found: { parcelNo: '77/3', ref: 'ts:77/3' } });
    assert.deepEqual(plain.asked, ['77/3']);

    // On the map under neither, it says both were asked, and what the map holds that starts as the first does.
    const neither = layer(['77/30', '77/31']);
    assert.deepEqual(await parcelUnderAnySpelling(spellingsToAsk('TS', '77/3', ['77/03']), neither.search), { near: ['77/30', '77/31'], alsoAsked: ['77/03'] });

    // A map that does not answer the second time has not said the number is missing.
    let times = 0;
    const down = { ok: false as const, reason: 'http', detail: 'HTTP 503' };
    assert.deepEqual(await parcelUnderAnySpelling(['77/3', '77/03'], async () => ((times += 1) === 1 ? { ok: true as const, data: [] as Array<{ parcelNo: string }> } : down)), { failed: down });
  });

  it('is asked of Karnataka’s map once, which takes the whole number whatever part is named', () => {
    assert.deepEqual(spellingsToAsk('KA', '77/3', ['77/03']), ['77/3']);
    assert.deepEqual(spellingsToAsk('KA', '77/3', ['077/03']), ['77/3', '077/03'], 'a whole number written with a zero is another question');
  });

  it('is only ever asked for under another spelling of the same number', () => {
    assert.deepEqual(spellingsToAsk('TS', '77/3', ['78/03', '', '77/3', ' 77 / 03 ']), ['77/3', '77/03']);
    assert.deepEqual(spellingsToAsk('TS', '77/3'), ['77/3']);
  });
});
