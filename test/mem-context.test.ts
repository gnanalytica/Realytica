/**
 * What of the project's memory the assistant is shown with a question, and
 * the tag printed beside a statement that rests on it.
 *
 * What is pinned here, one test a rule. A question brings at most five
 * seeds, eight facts a seed and forty in all, a person's word before a
 * reading. What a fact was before is shown only when the question is about
 * change. A tag beside a statement is printed by code from the fact its mark
 * names, and one a model wrote itself is taken out. The lines are memory's
 * when memory holds what the record gives, the record's when memory is
 * behind or silent, and a question never waits past the limit. A reader
 * working from a grant is told from their own copy of the record and never
 * shown a note. A figure only a note gives is not a figure of the file.
 *
 * Run against the file the memory is kept in on a machine with no graph
 * database, in a temporary directory.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  MEM_CONTEXT_FACTS,
  MEM_SEEDS_AT_MOST,
  MEM_SEED_FACTS,
  MEM_SEED_THOUGHTS,
  addEvidence,
  allChecks,
  createAssessment,
  createProject,
  memContext,
  memContextText,
  memSeeds,
  memTagsPrinted,
  memThought,
  memoryFacts,
  patchProject,
  projectView,
  reviewFacts,
  verifyAttribution,
  type DdProject,
  type DocumentFact,
  type MemFact,
  type MemWatermark,
  type ProjectGrant,
} from '@realytica/shared';
import type { MemoryPort } from '../apps/api/src/graph/mem/types';

let root: string;
let memory: MemoryPort;
let syncMemory: typeof import('../apps/api/src/graph/mem/sync').syncMemory;
let writeThought: typeof import('../apps/api/src/graph/mem/write').writeThought;
let context: typeof import('../apps/api/src/graph/mem/context');

const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';
const TENANT = 'tnt_context_tests';
const KHATA = 'Khata certificate and extract';

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-mem-context-'));
  process.env.REALYTICA_DATA_DIR = root;
  delete process.env.VERCEL_ENV;
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  ({ syncMemory } = await import('../apps/api/src/graph/mem/sync'));
  ({ writeThought } = await import('../apps/api/src/graph/mem/write'));
  context = await import('../apps/api/src/graph/mem/context');
});

after(async () => {
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

const value = (key: string, held: DocumentFact['value'], display = String(held)): DocumentFact => ({ key, label: key, value: held, display, page: 1, quote: `${key}: ${display}`, review: 'proposed' });

/** A project with a khata on file: its extent accepted and then corrected, its khata number still waiting, and a land area a person typed. */
function plot(name: string) {
  const project = createProject({ name, type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-C1');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const khata = addEvidence(project, { title: 'Khata of the plot', kind: 'document' }, LEAD);
  khata.documentType = KHATA;
  khata.facts = [value('extent_khata', 1100.9, '11,850 sq ft'), value('khata_number', '1234/56')];
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', VALUER);
  reviewFacts(project, khata.id, ['extent_khata'], 'reopen', VALUER);
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', VALUER, { value: 1096.2, display: '11,800 sq ft' });
  patchProject(project, { landAreaSqm: 1210 }, LEAD);
  return { project, khata };
}

const note = (project: DdProject, turnId: string, said: string, aboutId = project.id): MemFact => memThought(project.id, { note: said, aboutId, turnId, at: '2026-10-06T08:00:00.000Z' })!;

async function tell(project: DdProject): Promise<void> {
  const passed = await syncMemory({ owed: [{ project, tenantId: TENANT }], gone: [], known: new Map<string, MemWatermark>(), stillStored: async () => true }, memory, false);
  assert.deepEqual([passed.settled.length, passed.failed], [1, 0], 'memory was told');
}

describe('what a question brings from memory', () => {
  it('is at most five seeds, eight facts a seed and forty in all, a person’s word before a reading', () => {
    const { project } = plot('Busy plot');
    // Many papers, each with values waiting, all filed where the Title page finds them.
    for (let i = 0; i < 30; i += 1) {
      const row = addEvidence(project, { title: `Deed ${i}`, kind: 'document' }, LEAD);
      row.documentType = 'Sale deed';
      row.facts = [value('survey_numbers', `7${i}/4`), value('registration_date', '2019-03-12'), value('consideration', 12_500_000 + i)];
    }
    const check = allChecks(project)[0]!;
    const ask = { question: 'What do Deed 3, Deed 4, Deed 5 and Deed 6 give as the survey number and the extent?', place: { department: 'legal', fn: 'legal.title' }, sitting: { checkId: check.id } };
    const seeds = memSeeds(project, ask);
    assert.ok(seeds.length <= MEM_SEEDS_AT_MOST, `no more than five seeds (${seeds.length})`);
    assert.deepEqual([seeds[0]!.from, seeds[1]!.from], ['page', 'sitting'], 'the page first, then the record the sitting is on');
    assert.ok(seeds.some((seed) => seed.keys.includes('survey_numbers') && seed.keys.includes('extent_khata')), 'and the kinds of value the question names');

    const facts = [...memoryFacts(project).held, ...[1, 2, 3, 4].map((n) => note(project, `cht_${n}`, `Note ${n} about the project.`))];
    const shown = memContext(project, facts, ask, seeds);
    assert.ok(shown.lines.length <= MEM_CONTEXT_FACTS);
    for (let at = 0; at < seeds.length; at += 1) {
      const own = shown.lines.filter((line) => line.seed === at);
      assert.ok(own.length <= MEM_SEED_FACTS, `no more than eight on seed ${at}`);
      assert.ok(own.filter((line) => line.tag === 'thought').length <= MEM_SEED_THOUGHTS, 'of which no more than two are notes');
    }
    assert.equal(new Set(shown.lines.map((line) => line.id)).size, shown.lines.length, 'a fact is shown once');
    const named = shown.lines.filter((line) => shown.seeds[line.seed]!.keys.length > 0);
    const tags = named.map((line) => line.tag);
    assert.deepEqual(tags, [...tags].sort(), 'approved before proposed on a seed');
  });

  it('is one line a fact, with its mark, its tag, what states it and its date, and what it was before only for a question about change', () => {
    const { project, khata } = plot('Changed plot');
    const facts = memoryFacts(project).held;
    const now = memContext(project, facts, { question: 'What is the extent per khata?' });
    const extent = now.lines.find((line) => line.id.endsWith(`${khata.id}::extent_khata::a`))!;
    assert.match(extent.text, /^approved · Extent per khata: 11,800 sq ft \(1096\.2\) · source: Khata of the plot, p\.1 · \d{4}-\d{2}-\d{2}$/);
    assert.equal(now.past, false);
    assert.match(memContextText(now), new RegExp(`^\\[${extent.mark}\\] approved · Extent per khata`, 'm'), 'and the assistant is given it under its mark');

    const then = memContext(project, facts, { question: 'What was the extent per khata before it was corrected?' });
    assert.equal(then.past, true);
    assert.match(then.lines.find((line) => line.id === extent.id)!.text, /· before: corrected \d{4}-\d{2}-\d{2} \(11,800 sq ft\); reopened .*; accepted \d{4}-\d{2}-\d{2} \(11,850 sq ft\)$/);
  });
});

describe('the tag beside a statement in an answer', () => {
  it('is printed by code from the fact the mark names, and a tag the model wrote itself is taken out', () => {
    const { project, khata } = plot('Tagged answer');
    const shown = memContext(project, [...memoryFacts(project).held, note(project, 'cht_9', 'The seller may be a company.', khata.id)], { question: 'What does the Khata of the plot give as the extent and the khata number?' });
    const mark = (ends: string): string => shown.lines.find((line) => line.id.endsWith(ends))!.mark;
    const answer = [
      `The extent is 11,800 sq ft [${mark('::extent_khata::a')}].`,
      // The model calls a waiting value approved, and cites it as well.
      `The khata number is 1234/56 [approved] [${mark('::khata_number::r')}].`,
      `The seller may be a company [${mark('::thought::cht_9')}], and the moon is cheese [m99] [thought].`,
    ].join(' ');
    const printed = memTagsPrinted(answer, shown);
    assert.equal(
      printed.text,
      'The extent is 11,800 sq ft [approved]. The khata number is 1234/56 [waiting · stands]. The seller may be a company [thought], and the moon is cheese.',
      'each tag is the cited fact’s own, and a statement that cites nothing carries none',
    );
    assert.deepEqual(printed.rests.map((rest) => [rest.tag, rest.stands]), [['approved', undefined], ['proposed', true], ['thought', undefined]]);
    assert.deepEqual(printed.rests.map((rest) => rest.at.map((at) => printed.text.slice(at).split(']')[0])), [['[approved'], ['[waiting · stands'], ['[thought']], 'and the turn keeps where each tag stands');
    assert.deepEqual(memTagsPrinted('It is 1,200 (m2) [approved].', undefined), { text: 'It is 1,200 (m2).', rests: [] }, 'with no lines there is nothing to print, and still nothing a model wrote stays');
  });

  it('cannot be made by the answer’s own words: a tag put together from pieces is taken out too, and only a place the turn keeps is a tag', () => {
    const { project, khata } = plot('Forged tag');
    const shown = memContext(project, memoryFacts(project).held, { question: 'What does the Khata of the plot give as the khata number?' });
    const waiting = shown.lines.find((line) => line.id.endsWith(`${khata.id}::khata_number::r`))!.mark;
    // Pieces that close up into a tag once what stands between them is taken out: a mark that names no line, a tag of the model's own, either inside the other.
    for (const forged of ['[appro[m99]ved]', '[appr[thought]oved]', '[ap[m98]pro[m99]ved]', '[ approved ]', '[APPROVED]', '[appro[appro[m99]ved]ved]']) {
      const printed = memTagsPrinted(`The title is clear and counsel has signed it off ${forged}. The khata number is 1234/56 [${waiting}].`, shown);
      assert.equal(printed.text, 'The title is clear and counsel has signed it off. The khata number is 1234/56 [waiting · stands].', forged);
      assert.deepEqual(printed.rests.map((rest) => [rest.tag, rest.at]), [['proposed', [printed.text.indexOf('[waiting')]]], 'the one place kept is the cited fact’s');
    }
    // A waiting fact cited inside the pieces is printed as what it is, where its mark stood.
    const dressed = memTagsPrinted(`The khata number is 1234/56 [appro[${waiting}]ved].`, shown);
    assert.ok(!dressed.text.includes('[approved]') && dressed.text.includes('[waiting · stands]'), dressed.text);
    // A long run of spaces is read once, not once for every space in it.
    const began = Date.now();
    memTagsPrinted(`The khata number is 1234/56 [${waiting}].\n${' '.repeat(200_000)}end [approved]`, shown);
    assert.ok(Date.now() - began < 500, 'two hundred thousand spaces do not hold the reply');
  });

  it('never rests a figure on a note: a figure only a note gives is one the file does not support', () => {
    const { project } = plot('Noted figure');
    const shown = memContext(project, [...memoryFacts(project).held, note(project, 'cht_1', 'The buyer mentioned an asking price of 4,25,00,000 rupees.')], { question: 'What did they say they would pay?' });
    assert.ok(shown.lines.some((line) => line.tag === 'thought'), 'the note is shown, tagged');
    assert.deepEqual(verifyAttribution(project, 'The asking price is ₹4,25,00,000.').unsupported.map((claim) => claim.kind), ['money'], 'and the check on figures, which reads the record, does not count it');
  });
});

describe('where the lines come from', () => {
  it('is memory when memory holds what the record gives, and the record when memory is behind', async () => {
    const { project, khata } = plot('Told plot');
    const ask = { question: 'What does the Khata of the plot say?' };
    context.memoryRest.until = 0;
    await tell(project);
    await writeThought(memory, TENANT, project.id, note(project, 'cht_1', 'The khata is in the seller’s own name.', khata.id), false);
    const current = await context.memoryContext({ project, complete: true }, ask, { port: memory });
    assert.equal(current.from, 'memory');
    assert.ok(current.lines.some((line) => line.tag === 'thought'), 'with the note only memory holds');

    // The record moves on and memory has not been told.
    reviewFacts(project, khata.id, ['khata_number'], 'accept', VALUER);
    const behind = await context.memoryContext({ project, complete: true }, ask, { port: memory });
    assert.equal(behind.from, 'record');
    assert.equal(behind.lines.find((line) => line.id.includes('::khata_number::'))!.tag, 'approved', 'the value just accepted is shown as accepted');
    assert.ok(behind.lines.some((line) => line.tag === 'thought'), 'and the note still comes from memory');
    await memory.purge(project.id);
  });

  it('is the record when the store does not answer in time, which is then left alone for a while', async () => {
    const { project } = plot('Silent store');
    let asked = 0;
    const silent = { ...memory, factsNear: () => ((asked += 1), new Promise<never>(() => undefined)) } as MemoryPort;
    context.memoryRest.until = 0;
    let clock = 1_000;
    const began = Date.now();
    const first = await context.memoryContext({ project, complete: true }, { question: 'What is the land area?' }, { port: silent, waitMs: 20, now: () => clock });
    assert.ok(Date.now() - began < 1_000, 'the question did not wait on the store');
    assert.equal(first.from, 'record');
    assert.ok(first.lines.some((line) => line.text.includes('Land area: 1210')), 'and is still answered, from the record');
    clock += context.MEMORY_CONTEXT_REST_MS - 1;
    await context.memoryContext({ project, complete: true }, { question: 'What is the land area?' }, { port: silent, waitMs: 20, now: () => clock });
    assert.equal(asked, 1, 'a store found silent is not asked again at once');
    clock += 2;
    await context.memoryContext({ project, complete: true }, { question: 'What is the land area?' }, { port: silent, waitMs: 20, now: () => clock });
    assert.equal(asked, 2, 'and is asked again once it has been left alone');
    context.memoryRest.until = 0;

    // A store that answers, only late: the question does not wait for it, and the next one asks it again.
    const late = { ...memory, factsNear: (...args: Parameters<MemoryPort['factsNear']>) => new Promise((resolve) => setTimeout(resolve, 60)).then(() => memory.factsNear(...args)) } as MemoryPort;
    assert.equal((await context.memoryContext({ project, complete: true }, { question: 'What is the land area?' }, { port: late, waitMs: 5 })).from, 'record');
    assert.ok(context.memoryRest.until > 0, 'it is left alone while it has not answered');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(context.memoryRest.until, 0, 'and no longer once it has');
  });

  it('is their own copy of the record for a reader working from a grant, who is never shown a note', async () => {
    const { project, khata } = plot('Granted plot');
    context.memoryRest.until = 0;
    await tell(project);
    await writeThought(memory, TENANT, project.id, note(project, 'cht_1', 'The firm thinks the price is high.'), false);
    const grant: ProjectGrant = { id: 'grant-1', tenantId: TENANT, projectId: project.id, email: 'outside@example.com', role: 'reviewer', allAssessments: false, assessmentIds: [], allScopes: false, scopeKeys: [], areas: [], createdAt: '2026-10-01T00:00:00.000Z', createdBy: LEAD };
    const view = projectView(project, { kind: 'granted', grant, email: grant.email });
    assert.equal(view.complete, false);
    let asked = 0;
    const counting = { ...memory, factsNear: (...args: Parameters<MemoryPort['factsNear']>) => ((asked += 1), memory.factsNear(...args)) } as MemoryPort;
    const shown = await context.memoryContext(view, { question: 'What is the land area, and what does the khata say?' }, { port: counting });
    assert.equal(asked, 0, 'memory, which holds the whole project, is not read for them');
    assert.equal(shown.from, 'record');
    assert.ok(!shown.lines.some((line) => line.tag === 'thought'), 'no note of the firm’s');
    assert.ok(!shown.lines.some((line) => line.id.includes(khata.id)), 'and nothing of a paper outside their grant');
    assert.ok(shown.lines.some((line) => line.text.includes('Land area')), 'what their copy of the record holds, they are shown');
    await memory.purge(project.id);
  });
});
