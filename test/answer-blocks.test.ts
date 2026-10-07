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
import { acceptValueOffers, addComparable, applyProjectChat, changesBetween, createProject, recordAsItStands, seedDemoProject, turnChanged, valueOffers } from '@realytica/shared';
import type { DdProject, ScreenResult, ValuationRun } from '@realytica/shared';
import { besideChips, oneOfEach, parseAnswer, parseInline, replyRan } from '../apps/web/src/components/chat/answer-blocks';
import type { Block, Inline, ReplyKept } from '../apps/web/src/components/chat/answer-blocks';

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

  it('reads the page a citation names, and gives each citation in a sentence its own chip', () => {
    // "This paper, page N" is `[ev:<id>:p<N>]`. Two papers in one sentence
    // are two tokens, and each chip opens its own.
    const spans = parseInline('The extent is on [ev:ev_1a-2b:p3] and the khata on [ev:ev_3c-4d:p12], with [ev:ev_5e-6f].', NO_NODES);
    assert.deepEqual(spans.filter(s => s.kind === 'evidence'), [
      { kind: 'evidence', id: 'ev_1a-2b', page: 3 },
      { kind: 'evidence', id: 'ev_3c-4d', page: 12 },
      { kind: 'evidence', id: 'ev_5e-6f' },
    ]);
    // Inside a mark, a list item or a table cell it is read the same way.
    assert.deepEqual(parseInline('**[ev:ev-3:p2]**', NO_NODES), [{ kind: 'evidence', id: 'ev-3', page: 2 }]);
    const list = parseAnswer('1. Get the EC\n- stated on [ev:ev-3:p2]', NO_NODES)[0] as Extract<Block, { kind: 'numbers' }>;
    assert.deepEqual(list.details?.[0][0], [{ kind: 'text', text: 'stated on ' }, { kind: 'evidence', id: 'ev-3', page: 2 }]);
    // What follows the id is a page only when it is a whole number from 1.
    // Anything else stays part of the id, and the chip then says it names nothing.
    for (const tail of ['p0', 'p', 'p3a', 'p12345', 'page3', '3']) {
      assert.deepEqual(parseInline(`[ev:ev-3:${tail}]`, NO_NODES), [{ kind: 'evidence', id: `ev-3:${tail}` }], tail);
    }
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
    // answer made, and one we cannot follow stays visible as one. An approval
    // is a record: its id is the project's with a tail, and is marked whole.
    const spans = parseInline('See [dd-risk-9] and [prj_1a-2b::approval::fire] and [prj_1a-2b::stage::acquisition] in [Sy.118/2].', NO_NODES);
    assert.equal(text(spans), 'See <dangling:dd-risk-9> and <dangling:prj_1a-2b::approval::fire> and Acquisition in [Sy.118/2].');
  });

  it('makes a chip of every record on a line, whatever is in brackets before it', () => {
    // Only the first bracketed word on a line used to be looked at, so a
    // footnote mark or an aside hid every id written after it.
    const CHK = 'chk_1a111df8cb5-03f853e9e3ff4-9a470905e71a3';
    const FND = 'fnd_1a111df8cb5-03d65c4ab51e8-7263070314d64';
    const live = nodes(CHK, FND);
    assert.equal(text(parseInline(`See [1] and [${CHK}] for the position.`, live)), `See [1] and <node:${CHK}> for the position.`);
    assert.equal(
      text(parseInline(`As noted [see above], [${CHK}] rests on [${FND}] [sic] and on [${CHK}].`, live)),
      `As noted [see above], <node:${CHK}> rests on <node:${FND}> [sic] and on <node:${CHK}>.`,
    );
    // A citation between them is still one chip, and its own kind.
    assert.deepEqual(parseInline(`[a] [ev:ev-3] [b] [${FND}]`, live).map(s => s.kind), ['text', 'evidence', 'text', 'node']);
    // In a table cell too, which is parsed as a line of its own.
    const table = parseAnswer(`| Check | Note |\n| --- | --- |\n| [x] [${CHK}] | open |`, live)[0] as Extract<Block, { kind: 'table' }>;
    assert.deepEqual(table.rows[0][0].map(s => s.kind), ['text', 'node']);
  });

  it('makes a chip of a record inside bold or code, and keeps the mark on the words beside it', () => {
    // The server puts brackets round an id wherever the model wrote it, and
    // a model writes an id in backticks more often than not.
    const CHK = 'chk_1a111df8cb5-03f853e9e3ff4-9a470905e71a3';
    const live = nodes(CHK);
    assert.deepEqual(parseInline(`Open **[${CHK}]** and \`[${CHK}]\` now.`, live), [
      { kind: 'text', text: 'Open ' },
      { kind: 'node', id: CHK },
      { kind: 'text', text: ' and ' },
      { kind: 'node', id: CHK },
      { kind: 'text', text: ' now.' },
    ]);
    assert.deepEqual(parseInline(`**The parcel check [${CHK}] is open**`, live), [
      { kind: 'bold', text: 'The parcel check ' },
      { kind: 'node', id: CHK },
      { kind: 'bold', text: ' is open' },
    ]);
    // A citation and an id that names nothing are read there as they are anywhere.
    assert.deepEqual(parseInline('`[ev:ev-3]` **[chk_1a111-0-0]**', live).map(s => s.kind), ['evidence', 'text', 'dangling']);
    // Words in brackets stay words, with their mark, and no mark is read inside another.
    assert.deepEqual(parseInline('**see [above] and `this`**', live), [{ kind: 'bold', text: 'see [above] and `this`' }]);
    assert.deepEqual(parseInline('`rows[0]`', live), [{ kind: 'code', text: 'rows[0]' }]);
  });

  it('marks an id of the shape this product mints when nothing on the project has it', () => {
    // An id is a prefix and an underscore now. The marker knew only the two
    // older shapes, so an id that named nothing printed raw, brackets and all.
    const gone = (token: string) => parseInline(`See ${token} for the position.`, NO_NODES).filter(s => s.kind === 'dangling').length;
    for (const id of ['chk_1a111df8cb5-0000000000000-0000000000000', 'fnd_1a2b-3c', 'rsk_9', 'act_1a', 'ev_1a111df8c67-0', 'rpt_2026-10', 'prj_1a-2b::qa::legal.title']) {
      assert.equal(gone(`[${id}]`), 1, id);
    }
    // Cut short by the model that quoted it: the case the marker was written for.
    assert.equal(gone('[chk_1a11…71a3]'), 1);
    assert.equal(gone('[dd-check-…bda_bmrda_acquisition]'), 1);
    // The product's own words open the same way and are not ids: none holds a digit.
    for (const word of ['[run_valuation]', '[run_screen]', '[log_site_entry]', '[dd_progress]', '[act_now]', '[val_per_sqm]']) {
      assert.equal(gone(word), 0, word);
    }
    // And a prefix this product does not use is somebody else's reference.
    for (const other of ['[doc_12]', '[EC_2019]', '[sy_118]', '[1]', '[2217/1998-99]']) {
      assert.equal(gone(other), 0, other);
    }
    // One the project has is its chip, not a mark.
    assert.deepEqual(parseInline('[chk_1a]', nodes('chk_1a')), [{ kind: 'node', id: 'chk_1a' }]);
  });

  it('prints an id of a kind with no page as words, and marks only a kind the chat can open', () => {
    // A card, a chat turn, a line of the history, a valuation run, a flow and
    // a run have no page, so the chat is given no name for one whether the
    // project has it or not. Marked as broken, a card waiting on the project
    // read as missing from it.
    for (const id of ['prp_1a111df8cb8-8fc21af2ece8f-255df7f5f3a81', 'cht_1a1150765be-1', 'aud_1a114de5be5-2', 'val_1a2b-3', 'flw_1a2b-4', 'run_1a2b-5']) {
      assert.deepEqual(parseInline(`The card [${id}] is waiting.`, NO_NODES), [{ kind: 'text', text: `The card ${id} is waiting.` }], id);
    }
    // Cut short, in a mark, or beside a record: the same.
    assert.equal(text(parseInline('See [prp_1a11…3a81] and [chk_1a-2b].', NO_NODES)), 'See prp_1a11…3a81 and <dangling:chk_1a-2b>.');
    assert.deepEqual(parseInline('**[cht_1a-2b]**', NO_NODES), [{ kind: 'bold', text: 'cht_1a-2b' }]);
    // The product's own words that open the same way keep their brackets.
    assert.equal(text(parseInline('Use [run_valuation] or [val_per_sqm].', NO_NODES)), 'Use [run_valuation] or [val_per_sqm].');
    // A name the chat was given wins, whatever the kind.
    assert.deepEqual(parseInline('[prp_1a-2b]', nodes('prp_1a-2b')), [{ kind: 'node', id: 'prp_1a-2b' }]);
  });

  it('takes a frame id nothing can name out of bold and code as it does out of plain words', () => {
    // The bold one used to be marked as broken and the plain one taken out, in the same sentence.
    assert.deepEqual(parseInline('See **[x1::ws::bogus]** now, and plain [x1::ws::bogus] now', NO_NODES), [{ kind: 'text', text: 'See now, and plain now' }]);
    assert.deepEqual(parseInline('See `[x1::ws::bogus]` now.', NO_NODES), [{ kind: 'text', text: 'See now.' }]);
    // The words beside it keep their mark.
    assert.deepEqual(parseInline('**[x1::ws::bogus] is late**', NO_NODES), [{ kind: 'bold', text: 'is late' }]);
    // Marked only where the whole line has no word left, in a mark or out of one.
    for (const line of ['[x1::ws::bogus]', '**[x1::ws::bogus]**', '`[x1::ws::bogus]`', '**[x1::ws::bogus]** ([x1::ws::bogus])']) {
      assert.ok(parseInline(line, NO_NODES).every((s) => s.kind === 'dangling' && s.id === 'x1::ws::bogus'), line);
      assert.ok(parseInline(line, NO_NODES).length > 0, line);
    }
    // One with a name is said in words there too, with the mark.
    assert.deepEqual(parseInline('**[prj_1a-2b::ws::design.rfis]**', NO_NODES), [{ kind: 'bold', text: 'RFIs' }]);
  });

  it('does not say a name again inside bold or code when the words just before the mark were the name', () => {
    // The server brackets an id wherever a model wrote it, and a model writes
    // one in backticks more often than not. The plain id left the sentence
    // and the marked one printed the name a second time, in its mark.
    const said = (line: string) => text(parseInline(line, NO_NODES));
    assert.equal(said('Title & land records (`[prj_1a-2b::ws::legal.title]`) holds five papers.'), 'Title & land records holds five papers.');
    assert.equal(said('The file is at the Acquisition step `[prj_1a-2b::stage::acquisition]` now.'), 'The file is at the Acquisition step now.');
    assert.equal(said('The Acquisition step **[prj_1a-2b::stage::acquisition]** is done.'), 'The Acquisition step is done.');
    // The mark goes with it, and the sentence is one run of words again.
    assert.deepEqual(parseInline('The Design department (**[prj_1a-2b::dept::design]**) is on.', NO_NODES), [{ kind: 'text', text: 'The Design department is on.' }]);
    // Other words inside the mark stay, and keep it.
    assert.deepEqual(parseInline('Acquisition **[prj_1a-2b::stage::acquisition] is done**', NO_NODES), [
      { kind: 'text', text: 'Acquisition ' },
      { kind: 'bold', text: 'is done' },
    ]);
    // A name a sentence earlier is not the name just before, in a mark as out of one: the sentence still needs its subject.
    assert.deepEqual(parseInline('The file is at Acquisition. **[prj_1a-2b::stage::acquisition]** closes in March.', NO_NODES), [
      { kind: 'text', text: 'The file is at Acquisition. ' },
      { kind: 'bold', text: 'Acquisition' },
      { kind: 'text', text: ' closes in March.' },
    ]);
    // And a marked id nothing was said before is still said in words, with its mark.
    assert.deepEqual(parseInline('It moved to `[prj_1a-2b::stage::acquisition]` in March.', NO_NODES), [
      { kind: 'text', text: 'It moved to ' },
      { kind: 'code', text: 'Acquisition' },
      { kind: 'text', text: ' in March.' },
    ]);
  });
});

describe('what stands beside a chip', () => {
  // The chip of a line, and what is kept against it.
  const beside = (line: string) => {
    const spans = parseInline(line, nodes('fnd_1a-2b'));
    const { words, lead, tail } = besideChips(spans);
    const at = spans.findIndex((s) => s.kind === 'node');
    return { lead: lead[at], tail: tail[at], words: words.filter(Boolean) };
  };

  it('keeps closing punctuation against the chip it was written against', () => {
    for (const mark of ['.', ',', ';', ':', '!', '?', ')', ']', '”', '’', '"', "'", '’s', "'s", '.)', '...']) {
      assert.deepEqual(beside(`See [fnd_1a-2b]${mark} Next.`), { lead: undefined, tail: { text: mark, bold: false }, words: ['See ', ' Next.'] }, mark);
    }
    // At the end of the line as before a space.
    assert.deepEqual(beside('See [fnd_1a-2b].').tail, { text: '.', bold: false });
    // An opening bracket or quotation mark before it, with a space or nothing before that.
    assert.deepEqual(beside('See ([fnd_1a-2b]) now'), { lead: { text: '(', bold: false }, tail: { text: ')', bold: false }, words: ['See ', ' now'] });
    assert.deepEqual(beside('“[fnd_1a-2b]” it says').lead, { text: '“', bold: false });
  });

  it('keeps an ellipsis, and a dash whatever follows it', () => {
    assert.deepEqual(beside('See [fnd_1a-2b]… next.').tail, { text: '…', bold: false });
    assert.deepEqual(beside('See [fnd_1a-2b]— next.').tail, { text: '—', bold: false });
    assert.deepEqual(beside('See [fnd_1a-2b]—next.'), { lead: undefined, tail: { text: '—', bold: false }, words: ['See ', 'next.'] });
    assert.deepEqual(beside('See [fnd_1a-2b])— next.').tail, { text: ')—', bold: false });
  });

  it('keeps a stop written in bold, as bold', () => {
    // "**Check the mortgage [chip].** Next." The stop is a bold run of its own, and stood apart from the chip.
    assert.deepEqual(beside('**Check the mortgage [fnd_1a-2b].** Next.'), { lead: undefined, tail: { text: '.', bold: true }, words: ['Check the mortgage ', ' Next.'] });
    assert.deepEqual(beside('**Check [fnd_1a-2b], then** go.'), { lead: undefined, tail: { text: ',', bold: true }, words: ['Check ', ' then', ' go.'] });
    assert.deepEqual(beside('**Check ([fnd_1a-2b])** now'), { lead: { text: '(', bold: true }, tail: { text: ')', bold: true }, words: ['Check ', ' now'] });
  });

  it('leaves alone what is not written against the chip, or runs on into a word', () => {
    for (const after of ['', ' and more', '.Next', ' (aside)', ' . Next', '-next', '5 of them', '/a']) {
      assert.equal(beside(`See [fnd_1a-2b]${after}`).tail, undefined, after);
    }
    assert.equal(beside('**See [fnd_1a-2b] and** more').tail, undefined);
    // Code is not punctuation, and a bracket in the middle of a word is not an opening one.
    assert.equal(beside('See [fnd_1a-2b]`.`').tail, undefined);
    assert.equal(beside('f([fnd_1a-2b]').lead, undefined);
  });

  it('draws citations of two copies of one paper, side by side, as one', () => {
    // A passage and a line of memory cite every copy that holds the words.
    const title: Record<string, string> = { 'ev-a': 'Sale deed', 'ev-b': 'Sale deed', 'ev-c': 'Sale deed', 'ev-k': 'Khata' };
    const reads = (span: { id: string; page?: number }) => (title[span.id] ? `${title[span.id]} p.${span.page ?? ''}` : null);
    const fold = (line: string) => {
      const { spans, copies } = oneOfEach(parseInline(line, NO_NODES), reads);
      return { said: text(spans), copies: copies.filter((n) => n > 1) };
    };
    assert.deepEqual(fold('Paid on 28 Apr 2025 [ev:ev-a:p1] [ev:ev-b:p1]'), { said: 'Paid on 28 Apr 2025 <evidence:ev-a>', copies: [2] });
    assert.deepEqual(fold('Paid [ev:ev-a:p1] [ev:ev-b:p1] [ev:ev-c:p1]. Next [ev:ev-k].'), { said: 'Paid <evidence:ev-a>. Next <evidence:ev-k>.', copies: [3] });
    // The one drawn is the first, with its page, and a stop after the last is kept against it.
    const { spans } = oneOfEach(parseInline('Paid [ev:ev-a:p2] [ev:ev-b:p2].', NO_NODES), reads);
    assert.deepEqual(spans, [{ kind: 'text', text: 'Paid ' }, { kind: 'evidence', id: 'ev-a', page: 2 }, { kind: 'text', text: '.' }]);
    assert.deepEqual(besideChips(spans).tail[1], { text: '.', bold: false });
    // One paper cited twice is one chip, and is one paper.
    assert.deepEqual(fold('Paid [ev:ev-a:p1] [ev:ev-a:p1]'), { said: 'Paid <evidence:ev-a>', copies: [] });
    // Not folded: another page, another paper, anything written between them, or a paper the project does not have.
    for (const line of ['[ev:ev-a:p1] [ev:ev-b:p2]', '[ev:ev-a:p1] [ev:ev-k:p1]', '[ev:ev-a:p1], [ev:ev-b:p1]', '[ev:ev-a:p1] and [ev:ev-b:p1]', '[ev:ev-x:p1] [ev:ev-y:p1]', '[ev:ev-a] [ev:ev-b:p1]']) {
      const kept = oneOfEach(parseInline(line, NO_NODES), reads);
      assert.equal(kept.spans.filter((s) => s.kind === 'evidence').length, 2, line);
      assert.ok(kept.copies.every((n) => n === 1), line);
    }
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

  it('keeps a numbered list one list when its items are set apart by blank lines', () => {
    // Each blank line used to end the list, so three items were three lists
    // and every one of them was numbered 1.
    const blocks = parseAnswer('To close:\n\n1. First\n\n2. Second\n\n\n3. Third\n\nThat is all.', NO_NODES);
    assert.deepEqual(kinds(blocks), ['paragraph', 'numbers', 'paragraph']);
    const list = blocks[1] as Extract<Block, { kind: 'numbers' }>;
    assert.deepEqual(list.items.map(text), ['First', 'Second', 'Third']);
    assert.equal(list.start, undefined);
    assert.equal(list.details, undefined);
  });

  it('keeps the dashed lines under a numbered item with that item', () => {
    const blocks = parseAnswer('1. Get the EC\n- from the sub-registrar\n- for thirty years\n2. Chase the khata\n   - at the BBMP office\n3. Pay the tax', NO_NODES);
    assert.deepEqual(kinds(blocks), ['numbers']);
    const list = blocks[0] as Extract<Block, { kind: 'numbers' }>;
    assert.deepEqual(list.items.map(text), ['Get the EC', 'Chase the khata', 'Pay the tax']);
    assert.deepEqual(list.details?.map((under) => under.map(text)), [['from the sub-registrar', 'for thirty years'], ['at the BBMP office'], []]);

    // Set apart by blank lines as well, as a model that spaces its items writes them.
    const spaced = parseAnswer('1. Get the EC\n\n   - from the sub-registrar\n\n2. Chase the khata\n\n   - at the BBMP office [ev:ev-3]', NO_NODES);
    assert.deepEqual(kinds(spaced), ['numbers']);
    const loose = spaced[0] as Extract<Block, { kind: 'numbers' }>;
    assert.deepEqual(loose.items.map(text), ['Get the EC', 'Chase the khata']);
    assert.deepEqual(loose.details?.map((under) => under.map(text)), [['from the sub-registrar'], ['at the BBMP office <evidence:ev-3>']]);
  });

  it('leaves a dashed list after a numbered one alone when a blank line parts them', () => {
    const blocks = parseAnswer('1. Get the EC\n2. Chase the khata\n\n- Tax is paid\n- Khata is in the seller’s name', NO_NODES);
    assert.deepEqual(kinds(blocks), ['numbers', 'bullets']);
    assert.equal((blocks[0] as Extract<Block, { kind: 'numbers' }>).details, undefined);
    // Unless the list is written that way: an earlier item's details stood apart too, so the last item's are its own.
    const apart = parseAnswer('1. Get the EC\n\n- from the sub-registrar\n\n2. Chase the khata\n\n- at the BBMP office', NO_NODES);
    assert.deepEqual(kinds(apart), ['numbers']);
    assert.deepEqual((apart[0] as Extract<Block, { kind: 'numbers' }>).details?.map((under) => under.map(text)), [['from the sub-registrar'], ['at the BBMP office']]);
    // A divider is not a detail either.
    assert.deepEqual(kinds(parseAnswer('1. Get the EC\n- - -\n2. Chase the khata', NO_NODES)), ['numbers', 'rule', 'numbers']);
  });

  it('counts on from the number an item was written with', () => {
    // A sentence between two items still ends the list. The second half is
    // numbered as the answer numbered it, not from 1 again.
    const blocks = parseAnswer('1. Get the EC\nIt has to cover thirty years.\n2. Chase the khata\n3. Pay the tax', NO_NODES);
    assert.deepEqual(kinds(blocks), ['numbers', 'paragraph', 'numbers']);
    assert.equal((blocks[0] as Extract<Block, { kind: 'numbers' }>).start, undefined);
    const rest = blocks[2] as Extract<Block, { kind: 'numbers' }>;
    assert.equal(rest.start, 2);
    assert.deepEqual(rest.items.map(text), ['Chase the khata', 'Pay the tax']);
  });

  it('starts another list where the number starts again at 1', () => {
    const lists = (answer: string) =>
      parseAnswer(answer, NO_NODES).map((b) => (b.kind === 'numbers' ? { start: b.start ?? 1, items: b.items.map(text), under: (b.details ?? []).map((d) => d.map(text)) } : b.kind === 'bullets' ? b.items.map(text) : b.kind));
    // Two lists with only a blank line between them ran on as one, numbered 1 to 4.
    assert.deepEqual(lists('1. A\n2. B\n\n1. C\n2. D'), [
      { start: 1, items: ['A', 'B'], under: [] },
      { start: 1, items: ['C', 'D'], under: [] },
    ]);
    assert.deepEqual(lists('1. A\n2. B\n1. C\n2. D'), [
      { start: 1, items: ['A', 'B'], under: [] },
      { start: 1, items: ['C', 'D'], under: [] },
    ]);
    // Dashes between them, set apart and not set in, are a list of their own: the second list does not make them B's.
    assert.deepEqual(lists('1. A\n2. B\n\n- x\n- y\n\n1. C'), [{ start: 1, items: ['A', 'B'], under: [] }, ['x', 'y'], { start: 1, items: ['C'], under: [] }]);
    // Set in under B they are B's, and C is still the first of another list.
    assert.deepEqual(lists('1. A\n2. B\n\n   - x\n   - y\n\n1. C'), [
      { start: 1, items: ['A', 'B'], under: [[], ['x', 'y']] },
      { start: 1, items: ['C'], under: [] },
    ]);
    // An answer that writes every item "1." is counting one list.
    assert.deepEqual(lists('1. A\n\n1. B\n- b\n\n1. C'), [{ start: 1, items: ['A', 'B', 'C'], under: [[], ['b'], []] }]);
    // And a list that opens at 0 goes on to 1.
    assert.deepEqual(lists('0. A\n1. B\n2. C'), [{ start: 0, items: ['A', 'B', 'C'], under: [] }]);
    // Once: a second 1 starts another list, where it ran on as 0, 1, 2.
    assert.deepEqual(lists('0. Zero\n1. One\n\n1. Again'), [
      { start: 0, items: ['Zero', 'One'], under: [] },
      { start: 1, items: ['Again'], under: [] },
    ]);
    // A second 0 starts another as well, once the count has gone past it. D ran on as the fourth item and E stood alone as "1.".
    assert.deepEqual(lists('0. A\n1. B\n2. C\n\n0. D\n1. E'), [
      { start: 0, items: ['A', 'B', 'C'], under: [] },
      { start: 0, items: ['D', 'E'], under: [] },
    ]);
    assert.deepEqual(lists('0. Zero\n10. Ten\n\n0. Zero\n1. One'), [
      { start: 0, items: ['Zero', 'Ten'], under: [] },
      { start: 0, items: ['Zero', 'One'], under: [] },
    ]);
    // An answer that writes every item "0." is counting one list, and a 0 in a list that opened at 1 is its next item, as they were.
    assert.deepEqual(lists('0. A\n\n0. B\n\n0. C'), [{ start: 0, items: ['A', 'B', 'C'], under: [] }]);
    assert.deepEqual(lists('1. A\n2. B\n0. C'), [{ start: 1, items: ['A', 'B', 'C'], under: [] }]);
    // A list that follows straight after one that kept its dashed lines standing apart keeps its own the same way.
    // The last line was drawn as a loose list, so one answer was drawn two ways.
    assert.deepEqual(lists('1. First\n\n- a\n\n2. Second\n\n- c\n\n1. Again\n\n- d'), [
      { start: 1, items: ['First', 'Second'], under: [['a'], ['c']] },
      { start: 1, items: ['Again'], under: [['d']] },
    ]);
    // Only straight after: with a sentence between them the second list is read by itself.
    assert.deepEqual(lists('1. First\n\n- a\n\n2. Second\n\n- c\n\nThen the rest.\n\n1. Again\n\n- d'), [
      { start: 1, items: ['First', 'Second'], under: [['a'], ['c']] },
      'paragraph',
      { start: 1, items: ['Again'], under: [] },
      ['d'],
    ]);
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

  it('sets a line that ends in its source apart from the line after it', () => {
    // Two sentences on two lines, each with its source. Joined into one
    // paragraph, a chip that went to the next line stood at the head of the
    // next sentence and read as its source.
    const said = (answer: string) => parseAnswer(answer, NO_NODES).map((b) => (b.kind === 'paragraph' ? text(b.spans) : b.kind));
    assert.deepEqual(said('Residential (Main) under the plan of 2015. [ev:ev-1:p1]\nPermissible FAR 2.25; 2.25 was sanctioned [ev:ev-2:p1].\nNothing else is on file.'), [
      'Residential (Main) under the plan of 2015. <evidence:ev-1>',
      'Permissible FAR 2.25; 2.25 was sanctioned <evidence:ev-2>.',
      'Nothing else is on file.',
    ]);
    // Whatever closes the sentence after the source.
    assert.equal(said('It is on the deed ([ev:ev-1]).\nAnd “on the khata [ev:ev-2].”\nNo more.').length, 3);
    // A sentence wrapped after its source is still one sentence.
    assert.deepEqual(said('It is on the deed [ev:ev-1]\nand on the khata [ev:ev-2].\nNo more.'), ['It is on the deed <evidence:ev-1> and on the khata <evidence:ev-2>.', 'No more.']);
    // A source in the middle of a line does not end it, and lines with no source run on as they did.
    assert.deepEqual(said('The deed [ev:ev-1] is registered\nand the khata follows it.'), ['The deed <evidence:ev-1> is registered and the khata follows it.']);
    assert.deepEqual(said('The chain closes\nfrom 1994 to 2019 [ev:ev-1].\nThe khata is clean.'), ['The chain closes from 1994 to 2019 <evidence:ev-1>.', 'The khata is clean.']);
    // Words in brackets, a record and a link to notes are not a source.
    assert.equal(said('As noted [see above]\nit runs on. See [fnd_1a-2b]\nand [notes:mtg_1a2b]\nto the end.').length, 1);
    // In a list a line is an item already.
    assert.deepEqual(said('- on the deed [ev:ev-1]\n- on the khata [ev:ev-2]'), ['bullets']);
    // A source written on the line under a cited line is that line's too: it stood as a paragraph of one chip.
    assert.deepEqual(said('A is so [ev:ev-1:p1]\n[ev:ev-2:p2].\nNo more.'), ['A is so <evidence:ev-1> <evidence:ev-2>.', 'No more.']);
    assert.deepEqual(said('Sources: [ev:ev-1]\n[ev:ev-2]\n[ev:ev-3]'), ['Sources: <evidence:ev-1> <evidence:ev-2> <evidence:ev-3>']);
    // A record or words in brackets at the head of the next line are not a source: the line before still ends there.
    assert.equal(said('On the deed [ev:ev-1].\n[fnd_1a-2b] is open.').length, 2);
    assert.equal(said('On the deed [ev:ev-1].\n[see above] it runs.').length, 2);
    // An ellipsis closes the sentence after a source as three stops do.
    assert.deepEqual(said('It trails off [ev:ev-1]…\nNext thing.'), ['It trails off <evidence:ev-1>…', 'Next thing.']);
    assert.deepEqual(said('It trails off [ev:ev-1]...\nNext thing.'), ['It trails off <evidence:ev-1>...', 'Next thing.']);
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

describe('the picture under a reply', () => {
  const day = (time: string) => `2026-10-07T${time}Z`;
  const screenAt = (time: string) => ({ generatedAt: day(time), risks: [{ id: 'risk-1', severity: 'critical' }] }) as unknown as ScreenResult;
  const runAt = (time: string, over: Partial<ValuationRun> = {}) =>
    ({ id: `val_${time}`, status: 'computed', createdAt: day(time), indicatedValue: 402_600_000, low: 370_392_000, high: 434_808_000, currency: 'INR', working: { reconciliation: { outcome: 'indicated' } }, ...over }) as unknown as ValuationRun;
  const reply = (time: string, text: string, lines: string[] = [], over: Partial<ReplyKept> = {}): ReplyKept => ({ role: 'assistant', at: day(time), text, ...(lines.length ? { changed: { lines } } : {}), ...over });

  // A message put to the chat's own rules, and the reply as the API keeps it: with the lines of what it changed.
  const say = (project: DdProject, message: string): ReplyKept => {
    const stood = recordAsItStands(project);
    const turn = applyProjectChat(project, message, { actor: 'tester' }).assistantTurn;
    return { ...turn, changed: turnChanged(changesBetween(stood, project), true) };
  };

  it('is the screen’s risks under the reply that ran the screen, and not under the one that proposed it', () => {
    // The chart used to sit under "Ready to screen… It waits on the Value tab", and "Ran the property screen." had none.
    const project = seedDemoProject();
    const proposed = say(project, 'Screen the property');
    assert.match(proposed.text, /waits on the Value tab/);
    assert.deepEqual(replyRan(proposed, project), {});
    const ran = say(project, 'approve all');
    assert.equal(ran.text, 'Ran the property screen.');
    assert.deepEqual(replyRan(ran, project), { screen: project.lastScreenResult });
    assert.deepEqual(replyRan(proposed, project), {}, 'the reply that proposed it still has none');
    // Asked for again while the first still shows: the words are about a screen, and it ran none.
    assert.deepEqual(replyRan(say(project, 'Screen the property'), project), {});
  });

  it('is the range under the reply that ran a valuation with a figure, and nothing for a run with none', () => {
    const project = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru', landAreaSqm: 1200 }, 'RYT-AB1');
    const none = say(project, 'Run the valuation');
    assert.match(none.text, /^No figure yet/);
    assert.deepEqual(replyRan(none, project), {});

    for (const [n, price] of [58_000_000, 62_000_000, 60_500_000].entries()) addComparable(project, { title: `Plot, Sy. ${120 + n}`, price, areaSqm: 1200, kind: 'transaction', weight: 1 }, 'tester');
    acceptValueOffers(project, valueOffers(project).map((offer) => offer.id), 'tester');
    const valued = say(project, 'Run the valuation');
    assert.match(valued.text, /^Indicative value ₹/);
    const run = project.valuationRuns.at(-1)!;
    assert.deepEqual(replyRan(valued, project), { valuation: run });
    assert.ok(run.low < run.indicatedValue && run.indicatedValue < run.high);
    // The earlier reply reported a run with no figure, and still draws nothing.
    assert.deepEqual(replyRan(none, project), {});
  });

  it('takes the time and the reply’s own account together, never one alone', () => {
    const project = { lastScreenResult: screenAt('07:05:16.724'), valuationRuns: [runAt('07:05:11.183'), runAt('07:05:20.590')] };
    const ranScreen = reply('07:05:16.737', 'Ran the property screen. 1 more is waiting: 1 under Risks and actions.', ['Drafted “Red flag report”', 'Changed the last screen']);
    assert.deepEqual(replyRan(ranScreen, project), { screen: project.lastScreenResult });
    // Four seconds after that screen, a reply about a valuation: it has its own run and not the screen.
    const valued = reply('07:05:20.603', 'Indicative value ₹40.26 Cr. Comparable rate on saleable area: ₹40.26 Cr (100%).', ['Marked the valuation as superseded', 'Ran the valuation']);
    assert.deepEqual(replyRan(valued, project), { valuation: project.valuationRuns[1] });
    // A second after the screen ran, a reply that only says one is waiting.
    assert.deepEqual(replyRan(reply('07:05:17.900', 'A property screen is already waiting on the Value tab.'), project), {});
    // The right words an hour on are about a screen the project no longer holds.
    assert.deepEqual(replyRan(reply('08:05:16.737', 'Ran the property screen.', ['Changed the last screen']), project), {});
    // A reply cannot have made what was made after it.
    assert.deepEqual(replyRan(reply('07:05:16.700', 'Ran the property screen.', ['Changed the last screen']), project), {});
    // An accepted card says it in the middle of a sentence.
    assert.deepEqual(replyRan(reply('07:05:21.000', 'Filed 2 documents and ran the valuation.'), project), { valuation: project.valuationRuns[1] });
  });

  it('draws nothing for a run with no figure, a reply that was undone, or the reply that undid it', () => {
    const at = '07:05:20.590';
    const ran = (project: { valuationRuns: ValuationRun[] }, over: Partial<ReplyKept> = {}) => replyRan(reply('07:05:20.603', 'Indicative value ₹40.26 Cr.', ['Ran the valuation'], over), project);
    assert.deepEqual(Object.keys(ran({ valuationRuns: [runAt(at)] })), ['valuation']);
    // No approach ran, or they disagreed: the amount is 0 and is not a figure.
    for (const outcome of ['no_approach_ran', 'approaches_disagree']) {
      assert.deepEqual(ran({ valuationRuns: [runAt(at, { indicatedValue: 0, low: 0, high: 0, working: { reconciliation: { outcome } } } as never)] }), {}, outcome);
    }
    // A figure with no range round it is not drawn as one.
    assert.deepEqual(ran({ valuationRuns: [runAt(at, { low: 0 })] }), {});
    assert.deepEqual(ran({ valuationRuns: [runAt(at, { low: 500_000_000 })] }), {});
    // A run kept before the working was is judged by its amounts.
    assert.deepEqual(Object.keys(ran({ valuationRuns: [runAt(at, { working: undefined })] })), ['valuation']);
    // Undone: the run is gone from the project, and the reply says so of itself.
    assert.deepEqual(ran({ valuationRuns: [runAt(at)] }, { changed: { lines: ['Ran the valuation'], undone: { at: day('07:05:22.771'), by: 'tester', back: 1, of: 1 } } }), {});
    // The reply that undoes one quotes its lines.
    const undo = reply('07:05:22.771', 'Undone:\n- Marked the valuation as superseded.\n- Ran the valuation.', [], { toolCalls: [{ name: 'undo', summary: 'Undone' }] });
    assert.deepEqual(replyRan(undo, { valuationRuns: [runAt(at)] }), {});
    // The person's own message, no project, a time that cannot be read.
    assert.deepEqual(replyRan({ ...reply('07:05:20.603', 'Ran the valuation'), role: 'user' }, { valuationRuns: [runAt(at)] }), {});
    assert.deepEqual(replyRan(reply('07:05:20.603', 'Ran the valuation'), undefined), {});
    assert.deepEqual(replyRan({ ...reply('07:05:20.603', 'Ran the valuation'), at: 'just now' }, { valuationRuns: [runAt(at)] }), {});
  });
});
