/**
 * Where a fact's words are on its page.
 *
 * A fact carries its page and quote; the reader also keeps where each word it
 * read sits, and matches the quote back to those words so the page can be
 * marked — the quote highlighted, the value ringed. Checked on made-up pages
 * for the matching rules, and on the fixture documents through the real
 * reader: a text-layer deed and a scanned EC read by OCR.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { DocumentFact } from '@realytica/shared';
import { locateFact, locateFacts } from '../apps/api/src/documents/locate';
import { needsModelReading, readIngestLocally } from '../apps/api/src/documents/intake';
import { readDocumentText, releaseOcr, type LayoutWord } from '../apps/api/src/documents/read-text';
import { clipNotes } from '../packages/agents/src/project/ingest-intelligence';

after(() => releaseOcr());

/** A page of words laid out left to right on numbered lines, 0.1 of the page apart. */
function page(lines: string[]): LayoutWord[] {
  const words: LayoutWord[] = [];
  lines.forEach((line, row) => {
    let x = 0.05;
    for (const text of line.split(' ')) {
      const w = text.length * 0.01;
      words.push({ text, x, y: 0.1 + row * 0.1, w, h: 0.02 });
      x += w + 0.01;
    }
  });
  return words;
}

function fact(over: Partial<DocumentFact>): DocumentFact {
  return { key: 'k', label: 'K', value: '', display: '', page: 1, quote: '', ...over };
}

describe('placing a fact on its page', () => {
  const layout = [{ page: 1, words: page(['This Deed of Sale is made at Bengaluru', 'on this 12-03-2019 between the parties', 'in respect of Sy. No. 118/2 at Whitefield']) }];

  it('marks the quote line by line, and rings the value inside it', () => {
    const marks = locateFact(
      fact({ key: 'survey_numbers', value: '118/2', display: 'Sy. No. 118/2', quote: 'in respect of Sy. No. 118/2 at Whitefield' }),
      layout,
    );
    assert.ok(marks, 'placed');
    assert.equal(marks.quote.length, 1, 'one line');
    assert.equal(marks.value?.length, 1);
    const [q] = marks.quote;
    const [v] = marks.value!;
    assert.ok(v!.x >= q!.x && v!.x + v!.w <= q!.x + q!.w + 1e-6, 'the value sits inside the quote');
    assert.ok(Math.abs(v!.y - 0.3) < 0.001, 'on the third line');
  });

  it('runs a quote over two lines as two marks', () => {
    const marks = locateFact(fact({ quote: 'made at Bengaluru on this 12-03-2019', value: 'x', display: 'x' }), layout);
    assert.equal(marks?.quote.length, 2);
  });

  it('finds a date the page writes its own way', () => {
    const marks = locateFact(fact({ key: 'registration_date', value: '2019-03-12', display: '12 Mar 2019', quote: 'on this 12-03-2019 between the parties' }), layout);
    assert.equal(marks?.value?.length, 1, 'ringed though the display reads "12 Mar 2019"');
  });

  it('places nothing rather than something wrong', () => {
    assert.equal(locateFact(fact({ quote: 'words that are not on this page at all', value: 'nope', display: 'nope' }), layout), undefined);
    assert.equal(locateFact(fact({ page: 2, quote: 'This Deed of Sale', value: 'x', display: 'x' }), layout), undefined, 'a page with no words read');
    const facts = [fact({ quote: 'nothing like it' })];
    assert.equal(locateFacts(facts, layout)[0], facts[0], 'an unplaced fact is left as it was');
  });
});

describe('the fixture documents, read for real', () => {
  const sample = (name: string) => readFileSync(path.resolve('test/fixtures/documents', name));

  it('places every fact of a text-layer deed, and keeps the words in reading order', async () => {
    const bytes = sample('Sale_Deed_2019_Sy_118-2_Whitefield.pdf');
    const pages: number[] = [];
    const text = await readDocumentText(new Uint8Array(bytes), 'application/pdf', 'deed.pdf', { onPage: (p) => pages.push(p) });
    assert.deepEqual(pages, [1, 2, 3], 'each page announced as it is started');
    const first = text.layout?.find((p) => p.page === 1)?.words ?? [];
    assert.ok(first.length > 50);
    const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    assert.equal(fold(first.map((w) => w.text).join(' ')), fold(text.pages[0]!), 'the words are the page text');
    assert.ok(first.every((w) => w.x >= 0 && w.x <= 1 && w.y >= 0 && w.y <= 1 && w.w > 0), 'inside the page');

    const read = await readIngestLocally({ fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k' } as never, bytes);
    const facts = read.read?.facts ?? [];
    assert.ok(facts.length >= 10);
    assert.equal(facts.filter((f) => f.marks).length, facts.length, 'every fact placed');
    const vendor = facts.find((f) => f.key === 'vendor')!;
    assert.ok(vendor.marks?.value?.length, "the vendor's name is ringed");
  });

  it('places the facts of a scanned EC from the words OCR boxed', async () => {
    const bytes = sample('SCANNED_Encumbrance_Certificate.pdf');
    const read = await readIngestLocally({ fileName: 'ec.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k' } as never, bytes);
    assert.equal(read.read?.method, 'ocr');
    const facts = read.read?.facts ?? [];
    assert.ok(facts.length >= 4);
    assert.ok(facts.filter((f) => f.marks).length >= facts.length - 1, 'placed from OCR boxes');
    const survey = facts.find((f) => f.key === 'survey_numbers');
    assert.ok(survey?.marks?.value?.length, 'the survey number is ringed on the scan');
  });
});

describe("the model's notes on a card", () => {
  it('end at a sentence, not mid-word', () => {
    const notes = 'The file is a set of merged ECs covering 2015 to 2024. One transaction is recorded in 2021. Page references are self-reported by the model rather than verified.';
    assert.equal(clipNotes(notes, 120), 'The file is a set of merged ECs covering 2015 to 2024. One transaction is recorded in 2021.');
    assert.equal(clipNotes('short', 120), 'short');
    assert.match(clipNotes('a'.repeat(30) + ' ' + 'word '.repeat(40), 60), /…$/);
  });
});

describe('which documents a model is asked about', () => {
  const file = (read?: { type: string; facts: unknown[]; confidence?: number }) => ({ fileName: 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', ...(read ? { read: { confidence: 0.9, ...read } } : {}) }) as never;

  it('only the ones the reader did not understand, or only half made out', () => {
    assert.equal(needsModelReading(file({ type: 'sale_deed', facts: [{}, {}, {}, {}] })), false, 'a deed read with its facts is filed as read');
    assert.equal(needsModelReading(file({ type: 'sale_deed', facts: [{}] })), true, 'one fact off a long scan is a thin reading');
    assert.equal(needsModelReading(file({ type: 'sale_deed', facts: [{}, {}, {}, {}], confidence: 0.3 })), true, 'a guess at what it is');
    assert.equal(needsModelReading(file({ type: 'other', facts: [{}] })), true, 'not recognised');
    assert.equal(needsModelReading(file({ type: 'encumbrance_certificate', facts: [] })), true, 'nothing read from it — a Kannada scan');
    assert.equal(needsModelReading(file()), true, 'not read at all');
  });
});
