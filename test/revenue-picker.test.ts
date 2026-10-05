/**
 * The picker's lines, and a run down them.
 *
 * `revenue-parcels.test.ts` proves what is kept on the file. This proves what
 * the picker makes of it, without a screen: which lines are ticked before a
 * person touches them, which requests a run makes, what a line goes on saying
 * once the file has been fetched again, and what a run does when the map
 * stops answering or the server asks to be left alone for a while.
 *
 * Every survey number and place in here is made up.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  applyRevenueMap,
  createProject,
  rememberAskedSurveyNo,
  removeRevenueMapRead,
  surveyNumberLines,
  type DdProject,
  type DocumentFact,
  type RevenueMapRead,
  type SurveyNumberLine,
} from '@realytica/shared';
import {
  GIVE_UP_AFTER,
  isTicked,
  lineKey,
  lineSource,
  readInTurn,
  readsAgain,
  runPlan,
  settled,
  ticksAfter,
  type ReadState,
  type RevenueReadResult,
} from '../apps/web/src/lib/revenue-run';

const HOSAKERE = 'kgis:2999999999';
const KALYANI = 'kgis:2999999998';

/** One parcel's read, as the picker needs it: which parcel, where, and how big. */
function read(surveyNo: string, over: Partial<RevenueMapRead> = {}): RevenueMapRead {
  const corner = { lat: 12.71, lng: 77.69 };
  return {
    readAt: '2026-10-01T06:00:00.000Z',
    state: 'KA',
    parcelRef: `${HOSAKERE}:${surveyNo}`,
    surveyNo,
    village: 'Hosakere',
    mandal: 'Anekal',
    district: 'Bengaluru (Urban)',
    sourceLabel: 'K-GIS village map',
    rings: [[corner, { lat: 12.71, lng: 77.6905 }, { lat: 12.7104, lng: 77.6905 }, { lat: 12.7104, lng: 77.69 }, corner]],
    centre: { lat: 12.7102, lng: 77.69025 },
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
function file(p: DdProject, documentType: string, facts: DocumentFact[]): void {
  const row = addEvidence(p, { title: documentType, kind: 'document', status: 'received' }, 'tester');
  row.documentType = documentType;
  row.facts = facts;
}

function township(over: Partial<Parameters<typeof createProject>[0]> = {}): DdProject {
  return createProject({ name: 'Hosakere township', type: 'residential', location: 'Hosakere', city: 'Bengaluru', ...over }, 'RYT-P2');
}

/** The line for a number, as the picker holds it. */
function lineFor(lines: SurveyNumberLine[], surveyNo: string): SurveyNumberLine {
  const line = lines.find((l) => l.surveyNo === surveyNo);
  assert.ok(line, `a line for ${surveyNo}`);
  return line;
}

describe('a line of the picker', () => {
  it('is known by its number and the parcel it is read as, so two villages’ Sy. 71 are two lines', () => {
    const p = township({ parcelId: 'Sy. No. 71/1' });
    applyRevenueMap(p, read('71'), 'tester', '71/1');
    applyRevenueMap(p, read('71', { readAt: '2026-10-01T06:01:00.000Z', parcelRef: `${KALYANI}:71`, village: 'Kalyani' }), 'tester');
    const keys = surveyNumberLines(p, '72a').map(lineKey);
    assert.deepEqual(keys, [`71/1|${HOSAKERE}:71`, '72A|', `71|${KALYANI}:71`]);
    assert.equal(new Set(keys).size, keys.length, 'a tick or a state set on one line is never another line’s');
  });

  it('is ticked before anybody touches it only when the number is theirs to read: typed, or stated, accepted and not yet read', () => {
    const p = township({ parcelId: 'Sy. No. 71' });
    file(p, 'Sale deed', [fact('survey_numbers', '72')]);
    file(p, 'RERA certificate', [fact('survey_numbers', '73, 81 to 85', { review: 'proposed', source: 'model' })]);
    applyRevenueMap(p, read('71'), 'tester');
    const lines = surveyNumberLines(p, '74');
    assert.deepEqual(lines.map((l) => [l.surveyNo, isTicked(l, {})]), [
      ['71', false],
      ['72', true],
      ['73', false],
      ['81 to 85', false],
      ['74', true],
    ]);
  });

  it('keeps a person’s own tick and untick, and never ticks a piece that is not one number', () => {
    const p = township({ parcelId: 'Sy. No. 71' });
    file(p, 'Sale deed', [fact('survey_numbers', '72')]);
    file(p, 'RERA certificate', [fact('survey_numbers', '73, 81 to 85', { review: 'proposed', source: 'model' })]);
    applyRevenueMap(p, read('71'), 'tester');
    const lines = surveyNumberLines(p);
    const choices = {
      [lineKey(lineFor(lines, '71'))]: true,
      [lineKey(lineFor(lines, '72'))]: false,
      [lineKey(lineFor(lines, '73'))]: true,
      [lineKey(lineFor(lines, '81 to 85'))]: true,
    };
    assert.deepEqual(lines.map((l) => [l.surveyNo, isTicked(l, choices)]), [
      ['71', true],
      ['72', false],
      ['73', true],
      ['81 to 85', false],
    ]);
  });

  it('says where its number came from, and of a reading nobody has accepted that it is one — before it is read and after', () => {
    const p = township({ parcelId: 'Sy. No. 71' });
    file(p, 'Sale deed', [fact('survey_numbers', '72', { page: 3 })]);
    file(p, 'RERA certificate', [fact('survey_numbers', '72, 73', { review: 'proposed', source: 'model', page: 2 })]);
    file(p, 'Fire NOC', [fact('covered_survey_numbers', '74', { review: 'proposed' })]);
    const lines = surveyNumberLines(p, '75');
    assert.deepEqual(lineSource(lineFor(lines, '71'), false), { text: 'On this project', waiting: false });
    assert.deepEqual(lineSource(lineFor(lines, '72'), true), { text: 'Sale deed, p. 3 and 1 more · accepted', waiting: false });
    assert.deepEqual(lineSource(lineFor(lines, '75'), true), { text: 'Typed', waiting: false });

    assert.deepEqual(lineSource(lineFor(lines, '73'), false), { text: 'RERA certificate, p. 2 · waiting', waiting: true });
    assert.deepEqual(lineSource(lineFor(lines, '73'), true), { text: 'RERA certificate, p. 2 · read by the model, not yet accepted', waiting: true }, 'ticked to be read, it says what it is');
    assert.deepEqual(lineSource(lineFor(lines, '74'), true), { text: 'Fire NOC, p. 1 · read from the page, not yet accepted', waiting: true });

    // Read, and its tick gone with the run: the line still says the number is a machine's reading.
    applyRevenueMap(p, read('73'), 'tester');
    const after = lineFor(surveyNumberLines(p), '73');
    assert.equal(isTicked(after, {}), false);
    assert.deepEqual(lineSource(after, false), { text: 'RERA certificate, p. 2 · read by the model, not yet accepted', waiting: true });
  });
});

describe('what a run asks for', () => {
  it('is one request to a ticked line, in the order of the lines', () => {
    const p = township({ parcelId: 'Sy. No. 71' });
    file(p, 'Sale deed', [fact('survey_numbers', '72 and 73')]);
    applyRevenueMap(p, read('71'), 'tester');
    const lines = surveyNumberLines(p, '74');
    const plan = runPlan(lines, { [lineKey(lineFor(lines, '73'))]: false });
    assert.deepEqual(plan.map((step) => [step.key, step.also, readsAgain(step.line)]), [['72|', [], false], ['74|', [], false]]);
  });

  it('reads a kept parcel again once, however many of its numbers are ticked', () => {
    const p = township({ parcelId: 'Sy. No. 71/1, 71/2' });
    applyRevenueMap(p, read('71'), 'tester', '71/1');
    rememberAskedSurveyNo(p, `${HOSAKERE}:71`, '71/2');
    applyRevenueMap(p, read('72', { readAt: '2026-10-01T06:01:00.000Z' }), 'tester');
    const lines = surveyNumberLines(p);
    assert.deepEqual(lines.map((l) => [l.surveyNo, l.read?.surveyNo]), [['71/1', '71'], ['71/2', '71'], ['72', '72']]);

    const all = Object.fromEntries(lines.map((l) => [lineKey(l), true]));
    const plan = runPlan(lines, all);
    assert.deepEqual(plan.map((step) => [step.key, step.also]), [
      [`71/1|${HOSAKERE}:71`, [`71/2|${HOSAKERE}:71`]],
      [`72|${HOSAKERE}:72`, []],
    ], '71/1 and 71/2 are one parcel and one slow read, and both lines stand or fall by it');
    assert.equal(plan.every((step) => readsAgain(step.line)), true, 'each by the parcel’s own reference, wherever the picker now points');
  });

  it('reads a number a person typed in the place picked, even when a parcel under that number is kept', () => {
    const p = township({ parcelId: 'Sy. No. 71/1' });
    applyRevenueMap(p, read('71'), 'tester', '71/1');
    const lines = surveyNumberLines(p, '71');
    const typed = lineFor(lines, '71');
    assert.equal(typed.read?.parcelRef, `${HOSAKERE}:71`, 'it is shown as read, by the parcel that answers it here');
    assert.equal(readsAgain(typed), false, 'and typed with another village picked, it is that village’s Sy. 71 that is asked for');

    // Ticked beside the kept parcel's own line, they are two requests: one by reference, one by place.
    const plan = runPlan(lines, { [lineKey(lineFor(lines, '71/1'))]: true });
    assert.deepEqual(plan.map((step) => [step.key, readsAgain(step.line), step.also]), [
      [`71/1|${HOSAKERE}:71`, true, []],
      [`71|${HOSAKERE}:71`, false, []],
    ]);
  });
});

describe('what the lines show once the file has been fetched again', () => {
  it('keeps what the file cannot say, and lets go of what it can', () => {
    const states: Record<string, ReadState> = {
      a: { phase: 'read', surveyNo: '71', areaSqm: 2400 },
      b: { phase: 'absent', near: ['72/1'] },
      c: { phase: 'failed', reason: 'Not responding.' },
      d: { phase: 'reading' },
      e: { phase: 'waiting', seconds: 20 },
    };
    assert.deepEqual(settled(states), { b: states.b, c: states.c });
  });

  it('does not go on calling a number read after its read is removed', () => {
    const p = township();
    file(p, 'Sale deed', [fact('survey_numbers', '72')]);
    const before = lineKey(lineFor(surveyNumberLines(p), '72'));
    // The run read it, and said so under the key the line had then.
    let states: Record<string, ReadState> = { [before]: { phase: 'read', surveyNo: '72', areaSqm: 2400 } };
    const choices = ticksAfter({ [before]: true }, [before]);

    // The file, fetched again, holds the read: the line is now the parcel's, and the file speaks for it.
    applyRevenueMap(p, read('72'), 'tester');
    states = settled(states);
    const kept = lineFor(surveyNumberLines(p), '72');
    assert.equal(lineKey(kept), `72|${HOSAKERE}:72`);
    assert.equal(isTicked(kept, choices), false, 'a number just read is not ticked to be read again');

    // The read is removed — here, or by another save. The line is back where it started, and nothing calls it read.
    removeRevenueMapRead(p, `${HOSAKERE}:72`, 'tester');
    const gone = lineFor(surveyNumberLines(p), '72');
    assert.equal(lineKey(gone), before);
    assert.equal(gone.read, undefined);
    assert.equal(states[lineKey(gone)], undefined, 'what the run left behind no longer says “Read · 2,400 sqm” of it');
    assert.equal(isTicked(gone, choices), true, 'and it is offered to be read, as any stated number not yet read is');
  });

  it('leaves a person’s ticks as they set them, but for the lines that were read', () => {
    assert.deepEqual(ticksAfter({ '72|': true, '73|': false, '74|': true }, ['72|']), { '73|': false, '74|': true });

    // A stated, accepted number somebody unticked is not ticked again behind their back when a run ends.
    const p = township();
    file(p, 'Sale deed', [fact('survey_numbers', '72 and 73')]);
    const lines = surveyNumberLines(p);
    const unticked = { [lineKey(lineFor(lines, '73'))]: false };
    const after = ticksAfter(unticked, runPlan(lines, unticked).map((step) => step.key));
    assert.equal(isTicked(lineFor(lines, '73'), after), false);
  });
});

describe('reading several numbers in turn', () => {
  const ok = (surveyNo: string, over: Partial<Extract<RevenueReadResult, { ok: true }>> = {}): RevenueReadResult => ({
    ok: true,
    read: read(surveyNo),
    boundary: null,
    note: `Sy. ${surveyNo} is kept with the other parcels.`,
    ...over,
  });
  const down: RevenueReadResult = { ok: false, status: 502, error: 'Karnataka’s survey-number map (K-GIS) is not responding right now (timeout).' };
  const tooMany = (retryAfterS?: number): RevenueReadResult => ({ ok: false, status: 429, error: 'Too many requests. Try again shortly.', ...(retryAfterS === undefined ? {} : { retryAfterS }) });

  type Answer = RevenueReadResult | Error;

  /**
   * A run against answers given in advance — one for a line, or one for each
   * time it is asked — with every state each line went through and every
   * pause the run sat out. No timer runs: the wait is handed in.
   */
  async function run(answers: Array<[string, Answer | Answer[]]>, opts: { stopAfter?: number; stopDuringWait?: boolean } = {}) {
    const asked: string[] = [];
    const waits: number[] = [];
    const states: Array<[string, string | null]> = [];
    const left = new Map(answers.map(([line, answer]) => [line, Array.isArray(answer) ? [...answer] : [answer]]));
    let stopped = false;
    const outcome = await readInTurn(
      answers.map(([line]) => line),
      async (line) => {
        asked.push(line);
        const queue = left.get(line)!;
        const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
        if (answer instanceof Error) throw answer;
        return answer;
      },
      {
        state: (line, state) => states.push([line, !state ? null : state.phase === 'waiting' ? `waiting ${state.seconds}` : state.phase]),
        stop: () => stopped || (opts.stopAfter !== undefined && asked.length >= opts.stopAfter),
        wait: async (seconds) => {
          waits.push(seconds);
          if (opts.stopDuringWait) stopped = true;
        },
      },
    );
    return { outcome, asked, states, waits };
  }

  it('goes on to the next number when one is not on the map or fails', async () => {
    const { outcome, asked, states } = await run([
      ['71', ok('71', { boundary: {} as never, note: 'Parcel from the revenue map is now the project boundary.' })],
      ['72/9', { ok: false, status: 404, error: 'Sy. 72/9 is not in the published map for Hosakere.', near: ['72/1', '72/2'] }],
      ['73', down],
      ['74', new Error('Failed to fetch')],
      ['75', ok('75')],
    ]);
    assert.deepEqual(asked, ['71', '72/9', '73', '74', '75'], 'one request each, in order');
    assert.deepEqual(states, [
      ['71', 'reading'],
      ['71', 'read'],
      ['72/9', 'reading'],
      ['72/9', 'absent'],
      ['73', 'reading'],
      ['73', 'failed'],
      ['74', 'reading'],
      ['74', 'failed'],
      ['75', 'reading'],
      ['75', 'read'],
    ]);
    assert.deepEqual(outcome.done, ['71', '75']);
    assert.equal(outcome.ended, undefined);
    assert.equal(outcome.note, 'Parcel from the revenue map is now the project boundary.', 'the note of the read that set the boundary');
  });

  it('keeps the near numbers for a line that is not on the map, and the reason for one that failed', async () => {
    const seen: ReadState[] = [];
    await readInTurn(
      ['72/9', '73'],
      async (line) => (line === '73' ? { ok: false, status: 502, error: 'Not responding.' } : { ok: false, status: 404, error: 'Not there.', near: ['72/1'] }),
      { state: (_line, state) => state && state.phase !== 'reading' && seen.push(state) },
    );
    assert.deepEqual(seen, [{ phase: 'absent', near: ['72/1'] }, { phase: 'failed', reason: 'Not responding.' }]);
  });

  it('does not call a missing project, or a parcel no longer kept, a number missing from the map', async () => {
    const { states } = await run([['71', { ok: false, status: 404, error: 'Project not found' }]]);
    assert.deepEqual(states.at(-1), ['71', 'failed']);
  });

  it('waits as long as the server asks when it has had too many requests, and reads the same line again', async () => {
    const { outcome, asked, states, waits } = await run([
      ['71', ok('71')],
      ['72', [tooMany(20), ok('72')]],
      ['73', ok('73')],
    ]);
    assert.deepEqual(waits, [20]);
    assert.deepEqual(asked, ['71', '72', '72', '73'], 'the line it was turned away on is asked for again, and the run goes on');
    assert.deepEqual(states.filter(([line]) => line === '72'), [['72', 'reading'], ['72', 'waiting 20'], ['72', 'reading'], ['72', 'read']]);
    assert.deepEqual(outcome.done, ['71', '72', '73']);
    assert.equal(outcome.ended, undefined);
  });

  it('waits half a minute when the server does not say how long, and never more than a minute and a half', async () => {
    assert.deepEqual((await run([['71', [tooMany(), ok('71')]]])).waits, [30]);
    assert.deepEqual((await run([['71', [tooMany(0), ok('71')]]])).waits, [30]);
    assert.deepEqual((await run([['71', [tooMany(600), ok('71')]]])).waits, [90]);
  });

  it('ends when the server still turns it away after the wait, and leaves the rest unasked', async () => {
    const { outcome, asked, states } = await run([
      ['71', ok('71')],
      ['72', tooMany(20)],
      ['73', ok('73')],
    ]);
    assert.deepEqual(asked, ['71', '72', '72'], 'once more after the wait, and no further');
    assert.equal(outcome.ended, 'Too many requests. Try again shortly.');
    assert.deepEqual(outcome.done, ['71']);
    assert.deepEqual(states.at(-1), ['72', null], 'the number it was turned away on is not marked as failed');
  });

  it('ends at once when this person may not read the map here', async () => {
    for (const status of [401, 403]) {
      const { outcome, asked, states } = await run([
        ['71', { ok: false, status, error: 'You do not have access to this project.' }],
        ['72', ok('72')],
      ]);
      assert.deepEqual(asked, ['71'], 'every line after would be refused the same way');
      assert.equal(outcome.ended, 'You do not have access to this project.');
      assert.deepEqual(states.at(-1), ['71', null]);
    }
  });

  it('gives up when the map does not answer three numbers running', async () => {
    assert.equal(GIVE_UP_AFTER, 3);
    const { outcome, asked, states } = await run([
      ['71', ok('71')],
      ['72', down],
      ['73', down],
      ['74', new Error('Failed to fetch')],
      ['75', ok('75')],
      ['76', ok('76')],
    ]);
    assert.deepEqual(asked, ['71', '72', '73', '74'], 'sixty numbers are not each made to wait out a map that is down');
    assert.equal(outcome.ended, 'The map did not answer 3 numbers in a row, so the rest were not asked for. Read them again later.');
    assert.deepEqual(outcome.done, ['71']);
    assert.deepEqual(states.filter(([, phase]) => phase === 'failed').map(([line]) => line), ['72', '73', '74'], 'each of the three keeps its own reason');
  });

  it('does not give up while the map is answering, whatever it answers', async () => {
    const { outcome, asked } = await run([
      ['71', down],
      ['72', down],
      ['73', { ok: false, status: 404, error: 'Sy. 73 is not in the published map for Hosakere.', near: [] }],
      ['74', down],
      ['75', down],
      ['76', { ok: false, status: 400, error: 'That place could not be matched.' }],
      ['77', down],
      ['78', down],
      ['79', ok('79')],
    ]);
    assert.equal(asked.length, 9, 'a number the map says it does not hold, and a place it cannot match, are answers');
    assert.equal(outcome.ended, undefined);
    assert.deepEqual(outcome.done, ['79']);
  });

  it('ends after the number in hand when a person stops it', async () => {
    const { outcome, asked } = await run([['71', ok('71')], ['72', ok('72')], ['73', ok('73')]], { stopAfter: 2 });
    assert.deepEqual(asked, ['71', '72']);
    assert.deepEqual(outcome.done, ['71', '72']);
    assert.equal(outcome.ended, undefined);
  });

  it('ends without asking again when a person stops it during a wait', async () => {
    const { outcome, asked, states } = await run([['71', ok('71')], ['72', [tooMany(20), ok('72')]], ['73', ok('73')]], { stopDuringWait: true });
    assert.deepEqual(asked, ['71', '72']);
    assert.deepEqual(outcome.done, ['71']);
    assert.equal(outcome.ended, undefined, 'stopped by a person, not ended by the server');
    assert.deepEqual(states.at(-1), ['72', null], 'the line it was waiting on is left as it was before the run');
  });
});
