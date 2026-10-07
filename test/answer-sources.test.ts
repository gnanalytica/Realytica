/**
 * What an answer the chat gives by rule is made from, and how it says so.
 *
 * One test a rule. That every paper an answer read a value off is cited
 * where the value is said, as a mark the page draws as a chip for that paper
 * at that page, and that a memory line cites its paper the same way, at its
 * end, and that neither joins two things with a mark a line's end could
 * leave alone. That a thing two copies of a paper state is said once and
 * cited to both, a passage quoted from them too. That "FAR" written as the
 * abbreviation is the ratio. That a question is told to be one for the
 * papers' own words in each
 * of its forms, and not when the file holds what it asks as a value or it
 * asks somebody who is no paper; and that one nothing else answered is put
 * to the pages only when it names something with more than one word, to be
 * found together. That
 * the papers it is about are the ones it names, or all of them. And that the
 * passages found are said as the paper's own words, each with its citation.
 *
 * The search of the kept pages itself, the chat's tool for it, and a
 * collaborator's reach are proved with the pages, in `page-text.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  answerFromFile,
  attachEvidenceFile,
  citeToken,
  createProject,
  factKeysAsked,
  memUnderAnswer,
  memoryFacts,
  paperWordsAnswer,
  paperWordsAsked,
  papersAsked,
  reviewFacts,
  saidInPassing,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
} from '@realytica/shared';
import { parseAnswer, type Inline } from '../apps/web/src/components/chat/answer-blocks';

const value = (key: string, label: string, held: DocumentFact['value'], display: string, page = 1): DocumentFact => ({ key, label, value: held, display, page, quote: `${label}: ${display}` });

/** A paper on file, with what a person accepted off it. */
function filed(project: DdProject, title: string, kind: string, facts: DocumentFact[]): EvidenceRecord {
  const row = addEvidence(project, { title, kind: 'document', status: 'received' }, 'tester');
  row.documentType = kind;
  attachEvidenceFile(project, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 9, storageKey: `${title}.pdf`, capture: {} }, 'tester');
  row.facts = facts;
  reviewFacts(project, row.id, facts.map((fact) => fact.key), 'accept', 'tester');
  return row;
}

function plot() {
  const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0051');
  const deed = filed(project, 'Sale deed of 2019', 'Sale deed', [value('extent_title', 'Extent per title', 2450, '2,450 sqm', 2), value('root_year', 'Root of title', '1998-09-06', '6 Sep 1998')]);
  const khata = filed(project, 'Khata of the plot', 'Khata certificate and extract', [value('extent_khata', 'Extent per khata', 2400, '2,400 sqm')]);
  return { project, deed, khata };
}

/** A project whose zoning certificate states the FAR. */
function zoned(): DdProject {
  const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0052');
  filed(project, 'Zoning certificate', 'Zoning certificate', [value('zoning', 'Zoning', 'Residential (Main)', 'Residential (Main)'), value('permissible_far', 'FAR permissible', 2.25, '2.25')]);
  return project;
}

/** The spans the page draws an answer as. */
const spans = (text: string, places?: Parameters<typeof parseAnswer>[2]): Inline[] => parseAnswer(text, () => false, places).flatMap((block) => ('spans' in block ? block.spans : 'items' in block ? block.items.flat() : []));
const cited = (text: string): Array<[string, number | undefined]> => spans(text).flatMap((span) => (span.kind === 'evidence' ? [[span.id, span.page] as [string, number | undefined]] : []));

describe('where a value in an answer was read', () => {
  it('is a citation the page draws as a chip: each paper its own, at its page, where the value is said', () => {
    const { project, deed, khata } = plot();
    assert.equal(citeToken(deed.id, 2), `[ev:${deed.id}:p2]`);
    assert.equal(citeToken(deed.id), `[ev:${deed.id}]`, 'a paper with no page named is cited whole');

    const extent = answerFromFile(project, 'What is the extent?')!;
    // Two values are two sentences on a line, each with its own paper after it. Whichever paper was filed last is said first: the order is the file's.
    assert.deepEqual(extent.text.split('\n')[0]!.split(/(?<=\]) /).sort(), [`Khata 2,400 sqm. [ev:${khata.id}:p1]`, `Title 2,450 sqm. [ev:${deed.id}:p2]`]);
    assert.match(extent.text.split('\n')[1]!, /^⚑ They differ by /);
    assert.doesNotMatch(extent.text, / · /, 'no mark stands between two values, where a chip that ends a line would leave it alone');
    // Three or more are a list, a value a row with its paper beside it. With the flag they are still one list and one flag: no row is folded into another to keep an answer short.
    const survey = filed(project, 'Survey sketch', 'Survey sketch', [value('extent_survey', 'Extent per survey sketch', 2445, '2,445 sqm')]);
    const plan = filed(project, 'Sanctioned plan', 'Sanctioned building plan', [value('sanctioned_extent', 'Extent per sanctioned layout', 2450, '2,450 sqm')]);
    const four = answerFromFile(project, 'What is the extent?')!.text;
    assert.deepEqual(four.split('\n').slice(0, 4).sort(), [`- Khata 2,400 sqm [ev:${khata.id}:p1]`, `- Sanctioned layout 2,450 sqm [ev:${plan.id}:p1]`, `- Survey 2,445 sqm [ev:${survey.id}:p1]`, `- Title 2,450 sqm [ev:${deed.id}:p2]`]);
    assert.deepEqual(parseAnswer(four, () => false).map((block) => block.kind), ['bullets', 'flag'], 'the page draws a row a value, then the flag');
    assert.doesNotMatch(four, / · /);
    assert.deepEqual(cited(extent.text).sort(), [[deed.id, 2], [khata.id, 1]].sort(), 'two papers, two chips');
    assert.doesNotMatch(extent.text, /, p\.\d/, 'and no page left as words nobody can press');

    // A citation follows the sentence it stands behind, full stop first: no mark is left alone after a chip that ends a line.
    const title = answerFromFile(project, 'How far back does the title go?')!;
    assert.match(title.text.split('\n')[0]!, new RegExp(`^Root of title 6 Sep 1998 — \\d+ years of chain\\. \\[ev:${deed.id}:p1\\]$`));
    assert.doesNotMatch(`${extent.text}\n${title.text}`, /\][.,:;]/);
    assert.deepEqual(cited(title.text), [[deed.id, 1]]);
    assert.deepEqual(title.citedEvidenceIds, [deed.id]);
  });

  it('is cited the same way on a line of memory, at the end of the line with no mark before it', () => {
    const { project, khata } = plot();
    const under = memUnderAnswer(project, memoryFacts(project).held, { question: 'What is the extent per khata?' })!;
    // The tag, then words. The citation follows the last of them after a space: a tag or a chip that ends a line leaves no mark alone.
    assert.match(under.text, new RegExp(`^- Extent per khata: 2,400 sqm \\[approved\\] \\d{1,2} \\w{3} \\d{4} \\[ev:${khata.id}:p1\\]$`, 'm'));
    assert.doesNotMatch(under.text, / · /, 'no mark hangs after the tag, before the chip or after it');
    const drawn = spans(under.text, under.rests);
    assert.deepEqual(drawn.filter((span) => span.kind === 'memory' || span.kind === 'evidence').map((span) => span.kind), ['memory', 'evidence'], 'the tag, then the chip for the paper');
  });
});

describe('a paper that is on the file twice', () => {
  const owner = (name: string) => value('owner', 'Owner on record', name, name);

  it('has the name it states said once in an answer, the paper named, both copies cited', () => {
    const { project, deed } = plot();
    deed.facts = [...(deed.facts ?? []), value('purchaser', 'Purchaser', 'Asha Rao', 'Asha Rao')];
    reviewFacts(project, deed.id, ['purchaser'], 'accept', 'tester');
    const first = filed(project, 'Khata certificate', 'Khata certificate and extract', [owner('Asha Rao')]);
    const again = filed(project, 'Khata certificate (2)', 'Khata certificate and extract', [owner('Asha Rao')]);
    const lines = answerFromFile(project, 'Who owns it?')!.text.split('\n');
    assert.equal(lines[0], `Asha Rao. [ev:${deed.id}:p1]`);
    // Which record is in that name is said in words, and once: the two copies are one sentence, cited to both.
    assert.equal(lines.filter((line) => /same name/.test(line)).length, 1);
    assert.match(lines[1]!, /^The khata certificate and extract is in the same name\. \[ev:[^\]]+:p1\] \[ev:[^\]]+:p1\]$/);
    assert.deepEqual(cited(lines[1]!).map(([id]) => id).sort(), [first.id, again.id].sort());
    assert.equal(lines.length, 2);

    // A copy that names somebody else is not the same thing said twice: it has its own sentence, and the flag.
    const other = filed(project, 'Khata certificate (3)', 'Khata certificate and extract', [owner('Vikram Shetty')]);
    const differs = answerFromFile(project, 'Who owns it?')!.text.split('\n');
    assert.ok(differs.includes(`The khata certificate and extract names Vikram Shetty. [ev:${other.id}:p1]`));
    assert.ok(differs.some((line) => line.startsWith('⚑ The names differ')));
  });

  it('has each value said once on a line of memory, cited to both copies', () => {
    const { project } = plot();
    const first = filed(project, 'Khata certificate', 'Khata certificate and extract', [owner('Asha Rao')]);
    const again = filed(project, 'Khata certificate (2)', 'Khata certificate and extract', [owner('Asha Rao')]);
    const under = memUnderAnswer(project, memoryFacts(project).held, { question: 'Who is the owner on record?' })!;
    const lines = under.text.split('\n').filter((line) => line.startsWith('- Owner on record'));
    assert.equal(lines.length, 1, 'one line, not one a copy');
    assert.match(lines[0]!, /^- Owner on record: Asha Rao \[approved\] \d{1,2} \w{3} \d{4} \[ev:[^\]]+:p1\] \[ev:[^\]]+:p1\]$/);
    assert.deepEqual(cited(lines[0]!).map(([id]) => id).sort(), [first.id, again.id].sort());
    assert.equal(under.rests.length, 1, 'and its tag is printed once');
  });
});

describe('what a question is about', () => {
  it('is the kinds of value its answer is made from, and nothing for small talk', () => {
    assert.deepEqual(factKeysAsked('Is there a mortgage?'), ['ec_from', 'ec_to', 'ec_nil', 'subsisting_charges']);
    assert.deepEqual(factKeysAsked('How far back does the title go?'), ['root_year', 'registration_date', 'title_origin', 'document_number']);
    assert.deepEqual(factKeysAsked('What’s missing here?'), [], 'a question about no one kind of value');
    // "Far" as the common word asks about no FAR.
    for (const asked of ['What have we found so far?', 'How far along is the work?']) assert.ok(!factKeysAsked(asked).includes('permissible_far'), asked);
    assert.ok(factKeysAsked('What is the FAR so far?').includes('permissible_far'), 'though the same sentence may still name it');
    // Written as the abbreviation it is the ratio, whatever word follows: in capitals, after "the", or in full.
    for (const asked of ['Is the FAR more than 2?', 'Is the FAR less than 2.5?', 'Is the FAR too high?', 'Is FAR more than 2 allowed?', 'is the far too high?', 'IS THE FAR TOO HIGH?', 'Is the floor area ratio more than 2?']) {
      assert.ok(factKeysAsked(asked).includes('permissible_far'), asked);
      assert.ok(answerFromFile(zoned(), asked)?.text.includes('Permissible FAR 2.25'), asked);
    }
    for (const asked of ['Is this far more than we expected?', 'WHAT HAVE WE FOUND SO FAR?', 'Is it far too early to say?']) assert.ok(!factKeysAsked(asked).includes('permissible_far'), asked);
    for (const said of ['hello', 'Hi!', 'hi there', 'Hello again!', 'thanks', 'Thank you!', 'thank you so much', 'Great, thanks a lot.', 'What can you do?']) assert.equal(saidInPassing(said), true, said);
    for (const asked of ['What is the extent?', 'Is there a mortgage?', 'Thanks, and what is the extent?']) assert.equal(saidInPassing(asked), false, asked);
  });
});

describe('a question for the papers’ own words', () => {
  it('is told in each of its forms, with the words to find and the paper named', () => {
    for (const [question, words, paper] of [
      ['What does the deed say about the right of way?', 'right way', 'the deed'],
      ['what does the sale deed say about the witnesses', 'witnesses', 'the sale deed'],
      ['Does the EC mention a lease?', 'lease', 'the EC'],
      ['Where does it say acquisition proceedings?', 'acquisition proceedings', undefined],
      ['What do the papers say about the storm water drain?', 'storm water drain', undefined],
      ['Is there anything about a compound wall in the khata?', 'compound wall', 'the khata'],
      ['What is said about the witnesses?', 'witnesses', undefined],
      ['Which paper mentions the storm water drain?', 'storm water drain', undefined],
    ] as const) {
      assert.deepEqual(paperWordsAsked(question), { words, ...(paper ? { paper } : {}) }, question);
    }
  });

  it('is not one when the file holds what it asks as a value, when it asks somebody who is no paper, or when it asks nothing of a paper', () => {
    for (const question of [
      // The extent, the owner and the mortgage are values on the file, answered from them with their pages.
      'What does the deed say about the extent?',
      'What does the sale deed say about the vendor?',
      'Does the EC mention a mortgage?',
      // Not a paper.
      'What do we say about the right of way?',
      'What does memory say about the drain?',
      // No "about": what a paper says as a whole is its values.
      'What does the sale deed say?',
      'What is the extent?',
      'Add a note: the deed mentions a right of way',
    ]) {
      assert.equal(paperWordsAsked(question), undefined, question);
    }
  });

  it('takes a question nothing else answered by its own words, unless it is one of judgement or names nothing', () => {
    // Its words count where one passage holds them all: two common words are somewhere on most pages.
    assert.deepEqual(paperWordsAsked('Who has to keep the drain clear?', { unanswered: true }), { words: 'keep drain clear', together: true });
    assert.equal(paperWordsAsked('Who has to keep the drain clear?'), undefined, 'only when nothing else answered');
    for (const question of ['Why does the drain matter?', 'Should we buy it?', 'And then?', 'ok', 'Keep the drain clear']) {
      assert.equal(paperWordsAsked(question, { unanswered: true }), undefined, question);
    }
  });

  it('takes no question by one word: a page that shares a word with a question does not answer it', () => {
    for (const question of ['Where is the site?', 'Do I have access to the documents?', 'the plan?', 'what about the schedule?', 'Who were the witnesses?']) {
      assert.equal(paperWordsAsked(question, { unanswered: true }), undefined, question);
    }
    // What a shortened word leaves behind is no word to look for.
    assert.equal(paperWordsAsked('who’s the witness?', { unanswered: true }), undefined);
    assert.deepEqual(paperWordsAsked('Who’s to keep the drain clear, and what doesn’t count?', { unanswered: true }), { words: 'keep drain clear count', together: true });
    // Asked outright what a paper says, one word is enough: the question says it is the paper's.
    assert.deepEqual(paperWordsAsked('What does the deed say about the neighbour’s wall?'), { words: 'neighbour wall', paper: 'the deed' });
  });

  it('is about the papers it names, by title or kind or short name, and about all of them when it names none', () => {
    const { project, deed, khata } = plot();
    const ec = filed(project, 'Search of the register', 'Encumbrance certificate', []);
    addEvidence(project, { title: 'Mother deed', kind: 'document', status: 'expected' }, 'tester');
    const ids = (paper?: string) => papersAsked(project, { words: 'drain', ...(paper ? { paper } : {}) }).map((row) => row.id);
    assert.deepEqual(ids(), [deed.id, khata.id, ec.id], 'every paper with a file; one still expected has no pages');
    assert.deepEqual(ids('the deed'), [deed.id]);
    assert.deepEqual(ids('the khata'), [khata.id]);
    assert.deepEqual(ids('the EC'), [ec.id], 'by the short name people use');
    assert.deepEqual(ids('the lease agreement'), [], 'a paper the file does not hold is not answered from another');
    // A collaborator's copy of the project holds fewer papers, and those are all that is searched.
    assert.deepEqual(papersAsked({ evidence: project.evidence.filter((row) => row.id !== khata.id) }, { words: 'drain', paper: 'the khata' }), []);
  });

  it('is answered with the passages, said to be the papers’ own words, each cited to its page', () => {
    const { deed, khata } = plot();
    const one = paperWordsAnswer([{ evidenceId: deed.id, page: 2, snippet: '…with a right of way twelve feet wide…', reader: 'text' }])!;
    assert.equal(one.text, `The paper’s own words: “…with a right of way twelve feet wide…” [ev:${deed.id}:p2]`);
    // The reply says whose words they are. The label under it says where they are from, and not the same words again.
    assert.deepEqual([one.summary, one.citedEvidenceIds, cited(one.text)], ['Quoted from the page', [deed.id], [[deed.id, 2]]]);

    const passages = [
      { evidenceId: deed.id, page: 2, snippet: 'a right of way', reader: 'text' as const },
      { evidenceId: khata.id, page: 1, snippet: 'right of way over the lane', reader: 'ocr' as const },
      { evidenceId: deed.id, page: 3, snippet: 'the said right of way', reader: 'model' as const },
      { evidenceId: deed.id, page: 4, snippet: 'way', reader: 'text' as const },
    ];
    const many = paperWordsAnswer(passages, { notOpened: 2 })!;
    assert.deepEqual(many.text.split('\n'), [
      'The papers’ own words:',
      `- “a right of way” [ev:${deed.id}:p2]`,
      `- As OCR read them: “right of way over the lane” [ev:${khata.id}:p1]`,
      `- As a model quoted them: “the said right of way” [ev:${deed.id}:p3]`,
      '- and 1 more page',
      '2 papers were not searched.',
    ]);
    assert.deepEqual([many.summary, many.citedEvidenceIds], ['Quoted from the pages', [deed.id, khata.id]]);
    assert.deepEqual(cited(many.text), [[deed.id, 2], [khata.id, 1], [deed.id, 3]], 'a chip for each passage');
    assert.equal(paperWordsAnswer([{ ...passages[1]!, snippet: 'over the lane' }])!.text, `The paper’s own words, as OCR read them: “over the lane” [ev:${khata.id}:p1]`);
    assert.equal(paperWordsAnswer([]), null, 'nothing found is no answer');
  });

  it('says a passage two copies of a paper hold once, cited to both, and as a reading only where no copy has it as text', () => {
    const { deed, khata } = plot();
    const clause = '…the Vendor has paid all taxes and cesses up to the date of this deed…';
    // A scanned page of the deed and the deed itself hold the clause word for word, whatever the case and spacing OCR gave it.
    const twice = paperWordsAnswer([
      { evidenceId: khata.id, page: 1, snippet: '…the VENDOR has paid all taxes and  cesses up to the date of this deed…', reader: 'ocr' },
      { evidenceId: deed.id, page: 2, snippet: clause, reader: 'text' },
    ])!;
    assert.equal(twice.text, `The papers’ own words: “${clause}” [ev:${khata.id}:p1] [ev:${deed.id}:p2]`, 'once, in the file’s own text, and not said to be a reading');
    assert.deepEqual([twice.summary, twice.citedEvidenceIds, cited(twice.text)], ['Quoted from the pages', [khata.id, deed.id], [[khata.id, 1], [deed.id, 2]]]);
    // Among other passages it is one item, and the pages past the third passage are counted, not the copies.
    const many = paperWordsAnswer([
      { evidenceId: khata.id, page: 1, snippet: clause, reader: 'ocr' },
      { evidenceId: khata.id, page: 2, snippet: 'tax paid up to 2025-26', reader: 'text' },
      { evidenceId: deed.id, page: 2, snippet: clause, reader: 'ocr' },
      { evidenceId: deed.id, page: 3, snippet: 'tax receipt annexed', reader: 'text' },
      { evidenceId: deed.id, page: 4, snippet: 'no tax is due', reader: 'text' },
    ])!;
    assert.deepEqual(many.text.split('\n'), [
      'The papers’ own words:',
      `- As OCR read them: “${clause}” [ev:${khata.id}:p1] [ev:${deed.id}:p2]`,
      `- “tax paid up to 2025-26” [ev:${khata.id}:p2]`,
      `- “tax receipt annexed” [ev:${deed.id}:p3]`,
      '- and 1 more page',
    ]);
  });
});
