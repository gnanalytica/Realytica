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

  it('draws a memory tag where the turn says one was printed, and nowhere else, whatever the text says', () => {
    const drawn = (blocks: Block[]) => blocks.flatMap(b => ('spans' in b ? b.spans : 'items' in b ? b.items.flat() : [])).flatMap(s => (s.kind === 'memory' ? [s.tag] : []));
    const text = 'The extent is 11,850 sq ft [approved]. Its number is 1234/56 [waiting · stands].\n- The seller may be a company [thought]';
    const places = [
      { tag: 'approved' as const, at: [text.indexOf('[approved]')] },
      { tag: 'proposed' as const, stands: true, at: [text.indexOf('[waiting')] },
      { tag: 'thought' as const, at: [text.indexOf('[thought]')] },
    ];
    assert.deepEqual(drawn(parseAnswer(text, NO_NODES, places)), ['approved', 'waiting · stands', 'thought']);
    assert.deepEqual(parseAnswer('- It waits [waiting]', NO_NODES, [{ tag: 'proposed', stands: false, at: [11] }]), [{ kind: 'bullets', items: [[{ kind: 'text', text: 'It waits ' }, { kind: 'memory', tag: 'waiting' }]] }]);

    // The same words with no places, or on a line of their own: words in brackets, whoever wrote them.
    assert.deepEqual(drawn(parseAnswer(text, NO_NODES)), []);
    assert.deepEqual(parseInline('Counsel signed it off [approved].', NO_NODES).map(s => s.kind), ['text']);
    // A turn that rests on one fact, and words beside it that only read as a tag: the one place is drawn and no other.
    const forged = 'The title is clear and counsel has signed it off [approved]. The extent is 11,850 sq ft [waiting].';
    assert.deepEqual(drawn(parseAnswer(forged, NO_NODES, [{ tag: 'proposed', stands: false, at: [forged.indexOf('[waiting]')] }])), ['waiting']);
    // A place that does not hold that fact's tag draws nothing: a waiting fact cannot be drawn where the text says approved.
    assert.deepEqual(drawn(parseAnswer(forged, NO_NODES, [{ tag: 'proposed', stands: false, at: [forged.indexOf('[approved]')] }, { tag: 'approved', at: [3, -1, 9999] }])), []);
    // And the characters a tag is anchored by while the text is read are no way in either.
    assert.deepEqual(drawn(parseAnswer('Signed off \uE0000\uE001 and [waiting].', NO_NODES, [{ tag: 'proposed', stands: false, at: [19] }])), ['waiting']);
  });

  it('reads bold and code', () => {
    const spans = parseInline('The **survey number** is `112/3`.', NO_NODES);
    assert.deepEqual(spans.map(s => s.kind), ['text', 'bold', 'text', 'code', 'text']);
  });

  it('says an id of the frame that the graph no longer has in words, where it stood', () => {
    // The project graph's frame was redrawn to match the menu: twelve steps
    // became four stages and Design became one function of Engineering. An
    // answer written before quotes `…::stage::design`, which is no node now
    // and is still the Design step. Taken out, it left "It moved from to in
    // March." Printed as a key it is unreadable. So it is printed as its
    // name, in plain words, because there is nothing to open.
    const said = (line: string) => text(parseInline(line, NO_NODES));
    assert.equal(said('It moved from [prj_1a-2b::stage::design] to [prj_1a-2b::stage::approvals] in March.'), 'It moved from Design to Approvals in March.');
    assert.equal(said('Design keeps the drawing register [prj_1a-2b::ws::design.drawings].'), 'Design keeps the drawing register Drawings & versions.');
    // A department the project has switched off, and a function under it.
    assert.equal(said('Nothing is bought until [prj_1a-2b::dept::procurement] is switched on.'), 'Nothing is bought until Procurement is switched on.');
    assert.equal(said('Orders would sit in [prj_1a-2b::ws::procurement.orders].'), 'Orders would sit in Purchase orders & commitments.');
    // One run of words again, not three with seams where the id was.
    assert.deepEqual(parseInline('At the step [prj_1a-2b::stage::acquisition] now.', NO_NODES), [{ kind: 'text', text: 'At the step Acquisition now.' }]);
    // Found by its own shape, so prose in brackets earlier on the line does not hide it.
    assert.equal(said('As noted [see above], at [prj_1a-2b::stage::feasibility] still.'), 'As noted [see above], at Feasibility still.');
  });

  it('opens a sentence with the name when the sentence opened with the id', () => {
    const said = (line: string) => text(parseInline(line, NO_NODES));
    assert.equal(said('[prj_1a-2b::stage::acquisition] closed in March.'), 'Acquisition closed in March.');
    assert.equal(said('Legal is open. [prj_1a-2b::dept::design] is not.'), 'Legal is open. Design is not.');
    // The name said a sentence or a clause earlier is not the name said just
    // before: the second sentence still needs its subject.
    assert.equal(
      said('The file is at Acquisition. [prj_1a-2b::stage::acquisition] closes when the deed is registered.'),
      'The file is at Acquisition. Acquisition closes when the deed is registered.',
    );
    assert.equal(said('Acquisition is done, so [prj_1a-2b::stage::acquisition] needs no more work.'), 'Acquisition is done, so Acquisition needs no more work.');
  });

  it('does not say a name twice when the words just before the id were the name', () => {
    const said = (line: string) => text(parseInline(line, NO_NODES));
    assert.equal(said('The file is at the Acquisition step [prj_1a-2b::stage::acquisition] and Legal is open.'), 'The file is at the Acquisition step and Legal is open.');
    assert.equal(said('The Design department ([prj_1a-2b::dept::design]) is switched on.'), 'The Design department is switched on.');
    // By its one word or its name in full, whichever the sentence used.
    assert.equal(said('Legal & Compliance ([prj_1a-2b::dept::legal]) is off.'), 'Legal & Compliance is off.');
    assert.equal(said('The Title function [prj_1a-2b::ws::legal.title] is off.'), 'The Title function is off.');
    assert.equal(said('Title & land records [prj_1a-2b::ws::legal.title] is off.'), 'Title & land records is off.');
    // And through emphasis, which is not part of the words.
    assert.equal(text(parseInline('At the **Acquisition** step [prj_1a-2b::stage::acquisition] now.', NO_NODES)), 'At the Acquisition step now.');
    // A name that is only near is not the name just before.
    assert.equal(said('Acquisition and the rest [prj_1a-2b::stage::acquisition].'), 'Acquisition and the rest Acquisition.');
  });

  it('takes out only a frame id that nothing can name', () => {
    // A key that was never a stage, a step, a department or a workstream. It
    // supports nothing and says nothing, so it leaves the sentence.
    const said = (line: string) => text(parseInline(line, NO_NODES));
    assert.equal(said('It is at [prj_1a-2b::stage::nowhere] still.'), 'It is at still.');
    assert.equal(said('It is with the team ([prj_1a-2b::dept::nobody]) now.'), 'It is with the team now.');
    assert.equal(said('It sits in [prj_1a-2b::ws::legal.nothing].'), 'It sits in.');
    // At the start of a line the space after it goes with it.
    assert.deepEqual(parseInline('[prj_1a-2b::stage::nowhere] is done.', NO_NODES), [{ kind: 'text', text: 'is done.' }]);
    // A word that only looks like a key of the language is not a name either.
    assert.equal(said('It is at [prj_1a-2b::stage::constructor] still.'), 'It is at still.');
  });

  it('never leaves a line empty where an id was all it had', () => {
    const said = (line: string) => text(parseInline(line, NO_NODES));
    assert.equal(said('[prj_1a-2b::ws::design.rfis]'), 'RFIs');
    assert.equal(said('[prj_1a-2b::dept::procurement]'), 'Procurement');
    // Nothing names this one, and taking it out would leave nothing at all.
    // It is marked, as a record's id is, and not dropped.
    assert.deepEqual(parseInline('[prj_1a-2b::stage::nowhere]', NO_NODES), [{ kind: 'dangling', id: 'prj_1a-2b::stage::nowhere' }]);
    assert.deepEqual(parseInline('([prj_1a-2b::stage::nowhere]).', NO_NODES), [{ kind: 'dangling', id: 'prj_1a-2b::stage::nowhere' }]);
    assert.deepEqual(parseInline('[prj_1a-2b::stage::nowhere] [prj_1a-2b::ws::legal.nothing]', NO_NODES), [
      { kind: 'dangling', id: 'prj_1a-2b::stage::nowhere' },
      { kind: 'dangling', id: 'prj_1a-2b::ws::legal.nothing' },
    ]);

    // As bullets, which is where a line is most often one id and no more.
    const blocks = parseAnswer('Still open:\n- [prj_1a-2b::ws::design.rfis]\n- [prj_1a-2b::dept::procurement]\n- [prj_1a-2b::stage::nowhere]', NO_NODES);
    const list = blocks[1] as Extract<Block, { kind: 'bullets' }>;
    assert.deepEqual(list.items.map(text), ['RFIs', 'Procurement', '<dangling:prj_1a-2b::stage::nowhere>']);
    assert.ok(list.items.every((item) => item.length > 0));
  });

  it('shows a frame id the graph still has as a node, by name', () => {
    const live = nodes('prj_1a-2b::stage::construction', 'prj_1a-2b::ws::legal.title');
    const spans = parseInline('At [prj_1a-2b::stage::construction], with [prj_1a-2b::ws::legal.title] and the old [prj_1a-2b::ws::design.rfis].', live);
    assert.deepEqual(
      spans.filter(s => s.kind === 'node').map(s => (s as { id: string }).id),
      ['prj_1a-2b::stage::construction', 'prj_1a-2b::ws::legal.title'],
    );
    assert.equal(text(spans), 'At <node:prj_1a-2b::stage::construction>, with <node:prj_1a-2b::ws::legal.title> and the old RFIs.');
  });

  it('still marks a record’s id that resolves to nothing, and still prints what is not ours', () => {
    // Only the frame's ids are put into words. A record is a reference the
    // answer made, and one we cannot follow stays visible as one.
    const spans = parseInline('See [dd-risk-9] and [prj_1a-2b::approval::fire] and [prj_1a-2b::stage::acquisition].', NO_NODES);
    assert.equal(spans.filter(s => s.kind === 'dangling').length, 1);
    assert.equal(text(spans), 'See <dangling:dd-risk-9> and [prj_1a-2b::approval::fire] and Acquisition.');
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

  it('sets a flagged line apart from the prose on either side of it', () => {
    // What a dropped paper's reply looks like: where it went, what differs, what waits.
    const blocks = parseAnswer(
      'Read the DC conversion order.\nFiled under Legal › Approvals, at the Land stage.\n⚑ Differs from what is on file: Survey number 118/2 against 41/3. Nothing is overwritten.\n5 values are waiting on the right.\nReaches Valuation.',
      NO_NODES,
    );
    assert.deepEqual(kinds(blocks), ['paragraph', 'flag', 'paragraph']);
    assert.equal(text((blocks[0] as Extract<Block, { kind: 'paragraph' }>).spans), 'Read the DC conversion order. Filed under Legal › Approvals, at the Land stage.');
    // The mark is the block's, not the sentence's: it is drawn, so it is not also printed.
    assert.equal(text((blocks[1] as Extract<Block, { kind: 'flag' }>).spans), 'Differs from what is on file: Survey number 118/2 against 41/3. Nothing is overwritten.');
    assert.equal(text((blocks[2] as Extract<Block, { kind: 'paragraph' }>).spans), '5 values are waiting on the right. Reaches Valuation.');
  });

  it('keeps each flagged line its own', () => {
    const blocks = parseAnswer('Two charges are open.\n⚑ Mortgage to the bank, high.\n⚑ Attachment order, critical.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph', 'flag', 'flag']);
  });

  it('keeps a citation inside a flagged line', () => {
    const blocks = parseAnswer('⚑ The names differ [ev:ev-3].', NO_NODES);
    assert.deepEqual(kinds(blocks), ['flag']);
    assert.deepEqual((blocks[0] as Extract<Block, { kind: 'flag' }>).spans.map(s => s.kind), ['text', 'evidence', 'text']);
  });

  it('leaves a flag in the middle of a sentence where it was written', () => {
    const blocks = parseAnswer('Filed the sale deed. ⚑ Charge on the land.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph']);
    assert.equal(text((blocks[0] as Extract<Block, { kind: 'paragraph' }>).spans), 'Filed the sale deed. ⚑ Charge on the land.');
  });

  it('reads a flag with nothing after it as prose', () => {
    assert.deepEqual(kinds(parseAnswer('⚑', NO_NODES)), ['paragraph']);
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
