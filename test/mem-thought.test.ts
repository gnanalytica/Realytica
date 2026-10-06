/**
 * The assistant's own notes.
 *
 * A reply carries its note as one last line, and the line comes off the
 * reply. The note is kept as a fact tagged `thought`, on the page of what it
 * is about. The tag is set by code. Nothing comes in through the note's door
 * tagged as anything else, and nothing told from the record can write over a
 * note. A note is the one thing memory holds that the record cannot tell
 * again: a start-over leaves it, a purge of the project takes it, and a
 * project keeps only its newest.
 *
 * Run against the file the memory is kept in on a machine with no graph
 * database, in a temporary directory.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MEM_NOTE_LINE, MEM_SCHEMA, addEvidence, createProject, memNoteOfReply, memThought, memThoughtAbout, memWho, memoryFacts, type DdProject, type MemFact, type MemWatermark } from '@realytica/shared';
import type { MemoryPort } from '../apps/api/src/graph/mem/types';

let root: string;
let memory: MemoryPort;
let syncMemory: typeof import('../apps/api/src/graph/mem/sync').syncMemory;
let writeMemory: typeof import('../apps/api/src/graph/mem/write').writeMemory;
let writeThought: typeof import('../apps/api/src/graph/mem/write').writeThought;
let keepThought: typeof import('../apps/api/src/graph/mem/thought').keepThought;

const LEAD = 'lead@example.com';
const TENANT = 'tnt_thought_tests';

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-mem-thought-'));
  process.env.REALYTICA_DATA_DIR = root;
  delete process.env.VERCEL_ENV;
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  ({ syncMemory } = await import('../apps/api/src/graph/mem/sync'));
  ({ writeMemory, writeThought } = await import('../apps/api/src/graph/mem/write'));
  ({ keepThought } = await import('../apps/api/src/graph/mem/thought'));
});

after(async () => {
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

function plot(name: string) {
  const project = createProject({ name, type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-T1');
  const deed = addEvidence(project, { title: 'Sale deed', kind: 'document' }, LEAD);
  return { project, deed };
}

async function tell(project: DdProject, known = new Map<string, MemWatermark>()): Promise<void> {
  const passed = await syncMemory({ owed: [{ project, tenantId: TENANT }], gone: [], known, stillStored: async () => true }, memory, false);
  assert.deepEqual([passed.settled.length, passed.failed], [1, 0], 'memory was told');
}

const notesOf = async (project: DdProject): Promise<MemFact[]> => (await memory.factsOf(project.id)).filter((fact) => fact.tag === 'thought');

describe('the note a reply leaves', () => {
  it('is its last line in a fixed form, and comes off the reply', () => {
    const said = memNoteOfReply('The deed names two sellers.\n\nAsk for the partition deed next.\nNote to memory [ev_12]: The   deed names two sellers, a father and a son.');
    assert.deepEqual(said, { text: 'The deed names two sellers.\n\nAsk for the partition deed next.', note: 'The deed names two sellers, a father and a son.', about: 'ev_12' });
    assert.deepEqual(memNoteOfReply('**Note to memory:** The site is a corner plot.'), { text: '', note: 'The site is a corner plot.' }, 'however the line is dressed');
    assert.deepEqual(memNoteOfReply('Nothing to keep here.'), { text: 'Nothing to keep here.' }, 'and a reply with no such line is left as it is');
    assert.equal(memNoteOfReply('Note to memory: The extent was corrected once [m3] [approved].').note, 'The extent was corrected once.', 'a mark or a tag written into a note is not part of the sentence kept');
    assert.equal(memNoteOfReply(`Note to memory: ${'word '.repeat(200)}`).note!.length, MEM_NOTE_LINE, 'a note is cut to the length a note may be');
  });

  it('is about the record it names when the reader can see that record, else the sitting’s check, else the project', () => {
    const { project, deed } = plot('About plot');
    assert.equal(memThoughtAbout(project, deed.id), deed.id);
    assert.equal(memThoughtAbout(project, 'ev_of_another_project'), project.id, 'an id that names nothing here is not believed');
    assert.equal(memThoughtAbout(project, undefined, { checkId: 'chk_nowhere' }), project.id);
  });
});

describe('a note kept in memory', () => {
  it('is a fact tagged thought by code, on the page of what it is about, holding the sentence and nothing else', async () => {
    const { project, deed } = plot('Noted plot');
    await keepThought(project, TENANT, { note: 'The deed names two sellers, a father and a son.', about: deed.id, turnId: 'cht_7', at: '2026-10-06T08:00:00.000Z', place: { department: 'legal', fn: 'legal.title' } }, memory);
    assert.deepEqual(await notesOf(project), [
      { id: `${project.id}::thought::cht_7`, tag: 'thought', key: 'note', label: 'Note', value: 'The deed names two sellers, a father and a son.', aboutId: deed.id, department: 'legal', fn: 'legal.title', recordedAt: '2026-10-06T08:00:00.000Z', source: 'cht_7' },
    ]);
    assert.deepEqual((await memory.pagesOf(project.id)).map((page) => [page.aboutId, page.notes]), [[deed.id, 1]], 'and its page says how many notes it holds');

    // What may never be kept is not kept in a note either, and a note is one line.
    for (const said of ['Call the seller on 98765 43210.', 'Write to seller@example.com.', 'Line one.\nLine two.']) {
      await keepThought(project, TENANT, { note: said, turnId: `cht_${said.length}`, at: '2026-10-06T09:00:00.000Z' }, memory);
    }
    assert.equal((await notesOf(project)).length, 1, 'a phone number, an address for mail or a paragraph is no note');
    await memory.purge(project.id);
  });

  it('never comes in as anything else, and nothing told from the record writes over one', async () => {
    const { project } = plot('Guarded plot');
    const thought = memThought(project.id, { note: 'The plot is a corner plot.', aboutId: project.id, turnId: 'cht_1', at: '2026-10-06T08:00:00.000Z' })!;
    assert.deepEqual(await writeThought(memory, TENANT, project.id, thought, false), { written: 1 });
    // Offered through the note's door as approved, under a fact's id, or for another project: nothing is written.
    const approved = { ...thought, id: `${project.id}::thought::cht_2`, tag: 'approved', by: memWho(project.id, LEAD) } as MemFact;
    const asFact = { ...thought, id: `${project.id}::fact::${project.id}::note` } as MemFact;
    for (const offered of [approved, asFact]) assert.deepEqual(await writeThought(memory, TENANT, project.id, offered, false), { written: 0 });
    assert.deepEqual(await writeThought(memory, TENANT, 'prj_another', thought, false), { written: 0 });
    // And through the record's door, a note is not a fact to put, and a note's id is not one to drop.
    const through = { auditThrough: project.audit.at(-1)!.id };
    await writeMemory(memory, TENANT, {}, { projectId: project.id, entries: [], through, factChanges: { put: [{ ...thought, value: 'Written over.' }], drop: [thought.id] } }, false);
    assert.deepEqual(await notesOf(project), [thought], 'the note is as it was written');
    await memory.purge(project.id);
  });

  it('is left by a start-over, which lets go of what the record can tell again, and goes with a purge', async () => {
    const { project } = plot('Started over');
    await tell(project);
    const thought = memThought(project.id, { note: 'The seller is in a hurry.', aboutId: project.id, turnId: 'cht_1', at: '2026-10-06T08:00:00.000Z' })!;
    await writeThought(memory, TENANT, project.id, thought, false);
    const facts = memoryFacts(project).held.length;
    assert.ok(facts > 0);

    // The live site arrives over memory a preview wrote: every entry and every fact told from the record goes and is told again.
    const passed = await syncMemory({ owed: [{ project, tenantId: TENANT }], gone: [], known: new Map(), stillStored: async () => true }, memory, true);
    assert.equal(passed.failed, 0);
    const stands = (await memory.watermarks([project.id])).get(project.id)!;
    assert.deepEqual([stands.schema, stands.live], [MEM_SCHEMA, true], 'memory was started over by the live site');
    assert.deepEqual(await notesOf(project), [thought], 'and the note is still there');
    assert.equal((await memory.factsOf(project.id)).length, facts + 1, 'beside the facts, told again');

    await memory.purge(project.id);
    assert.deepEqual(await memory.factsOf(project.id), [], 'a project removed takes its notes with it');
  });

  it('is one of the newest a project keeps: the oldest go as newer ones are written', async () => {
    const { project } = plot('Many notes');
    for (let n = 1; n <= 5; n += 1) {
      const thought = memThought(project.id, { note: `Note ${n}.`, aboutId: project.id, turnId: `cht_${n}`, at: `2026-10-06T08:0${n}:00.000Z` })!;
      await memory.think({ projectId: project.id, tenantId: TENANT, thought, schema: MEM_SCHEMA, live: false, keep: 3 });
    }
    assert.deepEqual((await notesOf(project)).map((fact) => fact.value).sort(), ['Note 3.', 'Note 4.', 'Note 5.']);
    // A build that may not write this memory adds no note to it.
    const later = memThought(project.id, { note: 'From an older build.', aboutId: project.id, turnId: 'cht_9', at: '2026-10-06T09:00:00.000Z' })!;
    await tell(project);
    assert.deepEqual(await memory.think({ projectId: project.id, tenantId: TENANT, thought: later, schema: MEM_SCHEMA - 1, live: false, keep: 3 }), { newer: MEM_SCHEMA });
    await memory.purge(project.id);
  });
});
