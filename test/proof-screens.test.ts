/**
 * What the proof screens say where they have nothing to show, and where a
 * link from the chat lands when there is nothing drawn to land on.
 *
 * The reading desk drew one blank ruled sheet for every way a page can fail
 * to load, and said "nothing on it matched" under a reviewed paper's own
 * values. Title's page left out the chain of title until a chain was drawn,
 * so a link to it landed on the top of the page.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { functionSections } from '@realytica/shared';
import { noPageSaid, nothingRead, type NoPage } from '../apps/web/src/components/reading/said';

describe('a page the reading desk cannot draw', () => {
  const ways: NoPage[] = [
    { why: 'refused', status: 401 },
    { why: 'refused', status: 403 },
    { why: 'refused', status: 404 },
    { why: 'refused', status: 500 },
    { why: 'unreached' },
    { why: 'unreached', local: true },
    { why: 'broken' },
    { why: 'undrawable' },
    { why: 'pageless' },
  ];

  it('says something different for each way it failed', () => {
    const said = ways.map((no) => noPageSaid(no).said);
    assert.equal(new Set(said).size, ways.length, said.join(' | '));
    for (const line of said) assert.match(line, /^[A-Z].*\.$/, line);
  });

  it('names being signed out, a file that is not there, and a dropped connection', () => {
    assert.match(noPageSaid({ why: 'refused', status: 401 }).said, /signed out/i);
    assert.match(noPageSaid({ why: 'refused', status: 403 }).said, /access/i);
    assert.match(noPageSaid({ why: 'refused', status: 404 }).said, /not stored/i);
    assert.match(noPageSaid({ why: 'unreached' }).said, /connection/i);
    // Any other answer carries its number, so it can be told to whoever looks into it.
    assert.match(noPageSaid({ why: 'refused', status: 502 }).said, /502/);
  });

  it('offers another try where the fetch failed, and none where the file is the trouble', () => {
    const again = (no: NoPage) => noPageSaid(no).again;
    for (const no of ways.filter((w) => w.why === 'refused' || w.why === 'unreached')) assert.equal(again(no), true, JSON.stringify(no));
    for (const no of ways.filter((w) => w.why !== 'refused' && w.why !== 'unreached')) assert.equal(again(no), false, JSON.stringify(no));
  });
});

describe('“nothing on it matched” on the reading desk', () => {
  const read = { shown: true, streamed: 0, held: 0, phase: 'read' };

  it('is said where nothing was read', () => {
    assert.equal(nothingRead(read), true);
  });

  it('is not said under a filed paper’s own values', () => {
    // Opened for review: the stream's list is empty and the row holds what was read.
    assert.equal(nothingRead({ ...read, held: 4 }), false);
    assert.equal(nothingRead({ ...read, streamed: 4 }), false);
  });

  it('is not said before the reading is shown, after it failed, while a model reads, or beside a note', () => {
    assert.equal(nothingRead({ ...read, shown: false }), false);
    assert.equal(nothingRead({ ...read, phase: 'failed' }), false);
    assert.equal(nothingRead({ ...read, phase: 'model' }), false);
    assert.equal(nothingRead({ ...read, notes: 'A covering letter.' }), false);
  });
});

describe('a part of a function’s page the chat can land on', () => {
  const page = readFileSync(new URL('../apps/web/src/pages/projects/departments/WorkstreamPage.tsx', import.meta.url), 'utf8');

  it('is drawn whether or not there is anything in it yet', () => {
    // The chat lands on Title's chain whatever the project holds, so the page cannot wait for a chain to be drawn.
    assert.ok(functionSections('legal.title').includes('chain'));
    assert.doesNotMatch(page, /chain\?\.nodes\.length/, 'the chain of title is left out of the page until one is drawn');
    assert.match(page, /Not drawn yet\./, 'the part says so when there is no chain');
  });
});
