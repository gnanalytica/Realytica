/**
 * The chat's tools that leave a value or an answer behind, held to the page.
 *
 * A model names a paper, a page and the paper's words. Nothing it says of
 * those is taken on trust: the server looks for the words on the pages it
 * read itself (the page check a review answer is held to), keeps the page
 * that holds them, and calls the value unverified where no page does. Words
 * given as a paper's that no page of it holds are not laid beside a
 * questionnaire question at all.
 *
 * The project, the paper and its pages are invented.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { addEvidence, addQuestionnaire, createAssessment, createProject, readFunctionFields, type DdProject, type FieldOrigin } from '@realytica/shared';
import { createProjectTools, setPaperPages } from '@realytica/agents';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const PAGES = ['SALE DEED. This deed of absolute sale is made at Mysuru.', 'The vendor is the absolute owner in fee simple of the schedule property.', 'Schedule: land measuring 1 acre 22 guntas in Sy. No. 41/3, Kere village.'];

function project(): DdProject {
  const p = createProject({ name: 'Kere Road plot', type: 'residential', location: 'Kere Road', city: 'Bengaluru' }, 'RYT-FRT');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  return p;
}

function deed(p: DdProject) {
  const row = addEvidence(p, { title: 'Sale deed 2019', kind: 'document' });
  row.documentType = 'Sale deed';
  row.attachments = [{ id: 'f1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k-${row.id}`, uploadedAt: '2026-10-01T00:00:00.000Z', uploadedBy: 'tester' } as never];
  row.facts = [];
  return row;
}

function tools(p: DdProject) {
  const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] };
  const all = createProjectTools(p, 'tester', bag as never) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
  return async (name: string, args: unknown) => JSON.parse(await all.find((tool) => tool.name === name)!.run(args as never, undefined as never));
}

const holding = (field: string) => ({ set: HOLDING, field });
const origin = (p: DdProject, key: string) => p.fieldSheets![HOLDING]!.values[key]!.origin as Extract<FieldOrigin, { kind: 'paper' }>;

describe('propose_field_values', () => {
  afterEach(() => setPaperPages(null));

  it('keeps the page that holds the words, and calls a value unverified where no page does or none is kept', async () => {
    const p = project();
    const row = deed(p);
    setPaperPages(async (_project, evidenceId) => (evidenceId === row.id ? PAGES : null));
    const run = tools(p);
    const out = await run('propose_field_values', {
      values: [
        // Named on the wrong page, and found on the right one.
        { address: holding('tenure'), value: 'freehold', origin: { kind: 'paper', evidenceId: row.id, page: 1, quote: 'absolute owner in fee simple', reader: 'parser', proof: 'page_text' } },
        // Words no page of the paper holds.
        { address: holding('extent'), value: '5000 sqm', origin: { kind: 'paper', evidenceId: row.id, page: 3, quote: 'land measuring 5000 square metres' } },
      ],
    });
    assert.deepEqual(out.outcomes.map((o: { outcome: string }) => o.outcome), ['waiting', 'waiting']);
    assert.deepEqual([origin(p, 'tenure').page, origin(p, 'tenure').proof, origin(p, 'tenure').reader], [2, 'page_text', 'model'], 'what the model said of its own reading is not what is kept');
    assert.deepEqual([origin(p, 'extent').page, origin(p, 'extent').proof], [3, 'unverified']);
    const accept = readFunctionFields(p, FN).needs.accept;
    assert.deepEqual(accept.map((line) => [line.address!.field, line.oneAtATime]).sort(), [['extent', true], ['tenure', false]], 'only what the page bears out may be taken with "accept all"');

    // Where the pages of the papers are not kept at all, nothing a model quotes is proven.
    const bare = project();
    const paper = deed(bare);
    setPaperPages(null);
    await tools(bare)('propose_field_values', { values: [{ address: holding('tenure'), value: 'freehold', origin: { kind: 'paper', evidenceId: paper.id, page: 2, quote: 'absolute owner in fee simple' } }] });
    assert.equal(origin(bare, 'tenure').proof, 'unverified');
  });

  it('declares what an origin may hold, and takes nothing else', async () => {
    const p = project();
    const all = createProjectTools(p, 'tester', { proposals: [], navigations: [], toolCalls: [], choices: [] } as never) as unknown as Array<{ name: string; input_schema: { properties: { values: { items: { properties: { origin: { additionalProperties: boolean; properties: Record<string, unknown> } } } } } } }>;
    const declared = all.find((tool) => tool.name === 'propose_field_values')!.input_schema.properties.values.items.properties.origin;
    assert.equal(declared.additionalProperties, false);
    assert.deepEqual(Object.keys(declared.properties).sort(), ['asOf', 'evidenceId', 'kind', 'page', 'quote', 'source', 'url']);
  });
});

describe('suggest_answers', () => {
  afterEach(() => setPaperPages(null));

  it('lays a paper’s words beside a question only where a page of the paper holds them', async () => {
    const p = project();
    const row = deed(p);
    const sheet = addQuestionnaire(p, { title: 'Queries on title', department: 'legal', parsed: { header: [], questions: [{ text: 'What is the extent?' }, { text: 'Is there a mortgage?' }] } }, 'tester');
    const [extent, mortgage] = sheet.questions;
    setPaperPages(async () => PAGES);
    const out = await tools(p)('suggest_answers', {
      questionnaireId: sheet.id,
      answers: [
        { questionId: extent!.id, evidenceId: row.id, page: 1, quote: 'land measuring 1 acre 22 guntas', value: '1 acre 22 guntas' },
        { questionId: mortgage!.id, evidenceId: row.id, page: 2, quote: 'the property is free of every mortgage and charge' },
      ],
    });
    assert.deepEqual([out.suggested, out.droppedForNoProof], [1, 1]);
    assert.deepEqual([extent!.answer, extent!.proof?.[0]?.page, extent!.suggested], ['1 acre 22 guntas', 3, true], 'on the page that holds the words');
    assert.equal(mortgage!.answer ?? '', '', 'words the paper does not hold are not suggested as the paper’s');
  });
});
