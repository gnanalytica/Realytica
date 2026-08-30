/**
 * Reading structure out of prose nobody promised would have any.
 *
 * The copilot is not instructed to format, and on this deployment it is a
 * free-tier model that could not be relied on to follow an output contract if
 * it were. So the parser's contract runs the other way: every rule has to
 * DEGRADE to a paragraph. The assertions that matter here are the negative
 * ones — a half-written table, a lone dash, a sentence ending in a colon —
 * because those are what a model actually emits, and each one turning into a
 * broken table or an empty list is worse than the wall of text this replaced.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer, parseInline } from '../apps/web/src/components/chat/answer-blocks';
import type { Block, Inline } from '../apps/web/src/components/chat/answer-blocks';

const NO_NODES = () => false;
const nodes = (...ids: string[]) => (id: string) => ids.includes(id);

function text(spans: Inline[]): string {
  return spans.map(s => ('text' in s ? s.text : 'id' in s ? `<${s.kind}:${s.id}>` : '')).join('');
}

describe('inline spans', () => {
  it('renders an evidence citation where the sentence made it', () => {
    const spans = parseInline('The khata is clean [ev:ev-12] as of March.', NO_NODES);
    assert.deepEqual(
      spans.map(s => s.kind),
      ['text', 'evidence', 'text'],
    );
    assert.equal((spans[1] as { id: string }).id, 'ev-12');
  });

  it('never reads an evidence token as a node as well', () => {
    // One citation rendering as two chips was a real bug on the server side.
    const spans = parseInline('See [ev:ev-9].', id => id === 'ev:ev-9' || id === 'ev-9');
    assert.equal(spans.filter(s => s.kind === 'evidence').length, 1);
    assert.equal(spans.filter(s => s.kind === 'node').length, 0);
  });

  it('leaves bracketed prose alone when it is not a node', () => {
    const spans = parseInline('As noted [see above] the chain breaks.', NO_NODES);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].kind, 'text');
    assert.equal(text(spans), 'As noted [see above] the chain breaks.');
  });

  it('makes a real chip only for an id the graph actually holds', () => {
    const spans = parseInline('Compare [dd-risk-1] and [dd-risk-2].', nodes('dd-risk-1'));
    assert.equal(spans.filter(s => s.kind === 'node').length, 1);
    assert.equal(spans.filter(s => s.kind === 'dangling').length, 1);
  });

  it('marks one of our ids that resolves to nothing, rather than printing it', () => {
    // Observed in a real answer: `[dd-check-…bda_bmrda_acquisition]`, where
    // the model abbreviated the id. As prose it printed an ellipsis and an
    // underscore-cased key mid-sentence and read as a rendering fault. It is
    // marked rather than dropped — a reference we cannot follow is a fact
    // about the answer, and hiding it would make an unsupported claim look
    // clean.
    const spans = parseInline('See [dd-check-x_y] for the position.', NO_NODES);
    assert.equal(spans.filter(s => s.kind === 'dangling').length, 1);
  });

  it('leaves ordinary bracketed prose alone even when it resolves to nothing', () => {
    // The cost of being wrong here is much higher than a stray dangling id:
    // "[see above]" must never render as a broken-reference marker.
    for (const phrase of ['[see above]', '[sic]', '[emphasis added]']) {
      const spans = parseInline(`Note ${phrase} carefully.`, NO_NODES);
      assert.equal(spans.filter(s => s.kind === 'dangling').length, 0, phrase);
    }
  });

  it('reads bold and code', () => {
    const spans = parseInline('The **survey number** is `112/3`.', NO_NODES);
    assert.deepEqual(spans.map(s => s.kind), ['text', 'bold', 'text', 'code', 'text']);
  });
});

describe('blocks', () => {
  const kinds = (blocks: Block[]) => blocks.map(b => b.kind);

  it('reads a dashed list as a list', () => {
    const blocks = parseAnswer('Three problems:\n- No EC\n- Chain break in 1998\n- Tax arrears', NO_NODES);
    assert.deepEqual(kinds(blocks), ['heading', 'bullets']);
    const list = blocks[1] as Extract<Block, { kind: 'bullets' }>;
    assert.equal(list.items.length, 3);
    assert.equal(text(list.items[1]), 'Chain break in 1998');
  });

  it('reads a numbered list, and keeps the model’s own numbering out of the text', () => {
    const blocks = parseAnswer('1. Get the EC\n2. Chase the khata', NO_NODES);
    const list = blocks[0] as Extract<Block, { kind: 'numbers' }>;
    assert.equal(text(list.items[0]), 'Get the EC');
  });

  it('reads a pipe table', () => {
    const blocks = parseAnswer('| Method | Value |\n| --- | --- |\n| Comparable | 1.5 Cr |\n| Residual | 1.4 Cr |', NO_NODES);
    assert.deepEqual(kinds(blocks), ['table']);
    const table = blocks[0] as Extract<Block, { kind: 'table' }>;
    assert.equal(table.head.length, 2);
    assert.equal(table.rows.length, 2);
    assert.equal(text(table.rows[0][1]), '1.5 Cr');
  });

  it('treats a table with no rows as prose rather than an empty table', () => {
    // Header and divider with nothing under them are two consecutive lines,
    // so they join into one paragraph like any other wrapped prose. Ugly, and
    // deliberately so: it renders what the model actually wrote instead of an
    // empty table with headings and no data, which reads as lost content.
    const blocks = parseAnswer('| Method | Value |\n| --- | --- |', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph']);
  });

  it('treats a table with no divider as prose', () => {
    // Pipes turn up in ordinary prose — a model writing "yes | no" must not
    // produce a one-column table.
    const blocks = parseAnswer('The answer is yes | no depending on the deed.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph']);
  });

  it('does not treat a trailing colon as a heading', () => {
    // "In summary:" as the last line is the end of a sentence, not a section.
    const blocks = parseAnswer('Nothing else is outstanding.\n\nIn summary:', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph', 'paragraph']);
  });

  it('joins wrapped lines into one paragraph', () => {
    const blocks = parseAnswer('The title chain closes\nfrom 1994 to 2019.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph']);
    assert.equal(text((blocks[0] as Extract<Block, { kind: 'paragraph' }>).spans), 'The title chain closes from 1994 to 2019.');
  });

  it('returns a single paragraph for an unformatted answer', () => {
    // The status quo has to keep working: a model that formats nothing gets
    // exactly what it got before.
    const blocks = parseAnswer('There is no encumbrance certificate on file for the required period.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph']);
  });

  it('reads the markdown heading the models actually emit', () => {
    // Observed live: nvidia/nemotron-3-super-120b-a12b:free opened each
    // finding with `## 1. …`. Nothing asks it to; it does it anyway.
    const blocks = parseAnswer('## 1. Aerodrome height restriction\nThe site adjoins the approach funnel.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['heading', 'paragraph']);
    const head = blocks[0] as Extract<Block, { kind: 'heading' }>;
    assert.equal(text(head.spans), '1. Aerodrome height restriction');
  });

  it('does not read a hash inside a sentence as a heading', () => {
    const blocks = parseAnswer('The plot is Site No. #118 in the layout.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph']);
  });

  it('reads a bare --- as a divider, not as two dashes of prose', () => {
    // Observed in production: long answers separate their sections this way,
    // and it printed literally in the middle of the paragraph.
    const blocks = parseAnswer('First point.\n\n---\n\nSecond point.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph', 'rule', 'paragraph']);
  });

  it('does not read a dashed list item as a divider', () => {
    const blocks = parseAnswer('- one\n- two', NO_NODES);
    assert.deepEqual(kinds(blocks), ['bullets']);
  });

  it('returns nothing for an empty answer rather than an empty paragraph', () => {
    assert.deepEqual(parseAnswer('', NO_NODES), []);
    assert.deepEqual(parseAnswer('   \n\n  ', NO_NODES), []);
  });
});
