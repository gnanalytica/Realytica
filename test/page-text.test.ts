/**
 * Each page's text, kept beside the file it was read from.
 *
 * A reading kept what it understood and threw the words away, so nothing
 * could later be answered from a paper that the rules had no pattern for.
 * These hold the keeping: one object a file, beside the file, under the
 * project; read back whole or searched for words; gone with the project.
 * And the two readers of what was kept: the chat's own rule, which answers a
 * question put to a paper with the passage, the paper and the page, and the
 * tool a model in the chat searches the same pages with. Both search the
 * papers on the copy of the project they are handed, and no other. A passage
 * leaves out the line that numbers its page and nothing that could be the
 * paper's own, and a question's own words count where one passage holds them
 * all.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { addEvidence, attachEvidenceFile, createProject, paperWordsAnswer, paperWordsAsked, type ChatIngestFile, type DdProject, type DocumentFact } from '../packages/shared/src';

type PageText = typeof import('../apps/api/src/documents/page-text');
type Agents = typeof import('@realytica/agents');
type Intake = typeof import('../apps/api/src/documents/intake');
type Storage = typeof import('../apps/api/src/storage');

let pageText: PageText;
let createProjectTools: Agents['createProjectTools'];
let setPaperSearch: Agents['setPaperSearch'];
let readIngestLocally: Intake['readIngestLocally'];
let mergeModelReading: Intake['mergeModelReading'];
let storage: Storage['storageAdapter'];
let uploads: string;

before(async () => {
  // Chosen before the storage adapter is first loaded, which is when it decides where to write.
  process.env.REALYTICA_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'realytica-pages-'));
  storage = (await import('../apps/api/src/storage')).storageAdapter;
  uploads = (await import('../apps/api/src/storage/filesystem')).UPLOADS_DIR;
  pageText = await import('../apps/api/src/documents/page-text');
  // The reader, loaded the same way as what stores its pages: a row's pages are held by the module that read it.
  ({ readIngestLocally, mergeModelReading } = await import('../apps/api/src/documents/intake'));
  // And the chat's tools, the same way: the search is installed in the module the pages' own file loaded.
  ({ createProjectTools, setPaperSearch } = await import('@realytica/agents'));
});

after(() => {
  delete process.env.REALYTICA_DATA_DIR;
});

async function pdfOf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595, 842]);
    text.split('\n').forEach((line, n) => page.drawText(line, { x: 40, y: 780 - n * 16, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}

const DEED = [
  'SALE DEED\nThis Deed of Absolute Sale is made at Suvarnagiri between the vendor and the purchaser.\nThe vendor conveys the schedule property to the purchaser for a sale consideration of Rs. 3,18,50,000.',
  'SCHEDULE PROPERTY\nSurvey No. 73/4 of Navilugudda Village, with a right of way twelve feet wide over Survey No. 73/3\nto reach Temple Tank Road, which the purchaser shall keep open at all times.',
];
const KHATA = ['KHATA CERTIFICATE\nKhata No. 1907/88/3 stands in the name of Smt. Rathnamma Siddalingaiah in the register of this office.\nProperty: Survey No. 88/3, Kallusanka Village, Temple Car Street.'];

/** A project with the two papers filed on it, each stored and read as an upload is. */
async function filed(): Promise<{ project: DdProject; files: ChatIngestFile[] }> {
  const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
  const files: ChatIngestFile[] = [];
  for (const [title, fileName, pages] of [['Sale deed', 'deed.pdf', DEED], ['Khata', 'khata.pdf', KHATA]] as const) {
    const bytes = await pdfOf([...pages]);
    const storageKey = `${title.toLowerCase().replace(/\s+/g, '-')}-0001.pdf`;
    await storage.putDocument(project.id, storageKey, bytes, 'application/pdf');
    const row = addEvidence(project, { title, kind: 'document', status: 'received' });
    attachEvidenceFile(project, row.id, { fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey, capture: {} }, 'tester');
    files.push(await readIngestLocally({ fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey }, bytes));
  }
  return { project, files };
}

describe('each page’s text, kept beside its file', () => {
  it('is one object a file, beside the file, saying what was read and by which reader', async () => {
    const { project, files } = await filed();
    await pageText.keepPageTexts(project.id, files);
    const kept = readdirSync(path.join(uploads, project.id)).sort();
    assert.deepEqual(kept, ['khata-0001.pdf', 'pagetext_khata-0001.pdf.json', 'pagetext_sale-deed-0001.pdf.json', 'sale-deed-0001.pdf']);
    const deed = JSON.parse(readFileSync(path.join(uploads, project.id, 'pagetext_sale-deed-0001.pdf.json'), 'utf8'));
    assert.deepEqual([deed.v, deed.fileName, deed.pagesInFile, deed.pagesRead, deed.pages.map((p: { page: number; reader: string }) => [p.page, p.reader])], [1, 'deed.pdf', 2, 2, [[1, 'text'], [2, 'text']]]);
    assert.match(deed.pages[1].text, /right of way twelve feet wide/);
    assert.ok(readFileSync(path.join(uploads, project.id, 'pagetext_sale-deed-0001.pdf.json')).length < 2_000, 'small: the words and little else');
  });

  it('takes its name from the file’s key, flat, and never beginning with it', () => {
    assert.equal(pageText.pageTextKey('3f2a9c1e-77aa.pdf'), 'pagetext_3f2a9c1e-77aa.pdf.json');
    assert.equal(pageText.pageTextKey('s3://register/Khata 1.pdf'), 'pagetext_s3_register_Khata_1.pdf.json', 'whatever the key, one name in the project’s own folder');
  });

  it('gives a paper’s pages back, and nothing for a paper it has none for', async () => {
    const { project, files } = await filed();
    await pageText.keepPageTexts(project.id, files);
    const khata = await pageText.loadPageTexts(project.id, 'khata-0001.pdf');
    assert.deepEqual([khata?.pagesInFile, khata?.pagesRead, khata?.pages.length], [1, 1, 1]);
    assert.match(khata!.pages[0]!.text, /Khata No\. 1907\/88\/3/);
    assert.equal(await pageText.loadPageTexts(project.id, 'never-read.pdf'), null);
    await storage.putDocument(project.id, pageText.pageTextKey('broken.pdf'), Buffer.from('{"v":1,'), 'application/json');
    assert.equal(await pageText.loadPageTexts(project.id, 'broken.pdf'), null, 'an object it cannot read is no pages, not an error');
  });

  it('finds words in a project’s papers: the paper, the page, and the words around them', async () => {
    const { project, files } = await filed();
    await pageText.keepPageTexts(project.id, files);
    const found = await pageText.searchPageTexts(project, 'right of WAY');
    assert.deepEqual(found.hits.map((h) => [h.title, h.fileName, h.page, h.reader]), [['Sale deed', 'deed.pdf', 2, 'text']]);
    assert.match(found.hits[0]!.snippet, /with a right of way twelve feet wide over Survey No\. 73\/3/);
    assert.ok(found.hits[0]!.snippet.length <= 190, 'a short piece of the page, not the page');
    assert.deepEqual([found.opened, found.notOpened], [2, 0]);

    const both = await pageText.searchPageTexts(project, 'survey village');
    assert.deepEqual(both.hits.map((h) => [h.fileName, h.page]).sort(), [['deed.pdf', 2], ['khata.pdf', 1]], 'every word on the page, wherever on it');
    assert.deepEqual((await pageText.searchPageTexts(project, 'way mortgage')).hits, [], 'not a page that has only some of them');
    assert.deepEqual((await pageText.searchPageTexts(project, 'purchase')).hits, [], 'whole words: "purchaser" is not "purchase"');
    assert.deepEqual((await pageText.searchPageTexts(project, '  ')).hits, []);
  });

  it('opens no more files than it is allowed, and says how many it left', async () => {
    const { project, files } = await filed();
    await pageText.keepPageTexts(project.id, files);
    const one = await pageText.searchPageTexts(project, 'survey', { maxFiles: 1 });
    assert.deepEqual([one.opened, one.notOpened, one.hits.length], [1, 1, 1]);
    const first = await pageText.searchPageTexts(project, 'survey', { maxHits: 1 });
    assert.equal(first.hits.length, 1);
  });

  it('goes when the paper’s text is forgotten, and with the project', async () => {
    const { project, files } = await filed();
    await pageText.keepPageTexts(project.id, files);
    await pageText.forgetPageTexts(project.id, 'khata-0001.pdf');
    assert.equal(await pageText.loadPageTexts(project.id, 'khata-0001.pdf'), null);
    assert.ok(await pageText.loadPageTexts(project.id, 'sale-deed-0001.pdf'));
    // Deleting a project deletes everything under its uploads, which is where these are.
    await storage.deleteCaseDocuments(project.id);
    assert.equal(existsSync(path.join(uploads, project.id)), false);
    assert.equal(await pageText.loadPageTexts(project.id, 'sale-deed-0001.pdf'), null);
  });

  it('keeps nothing for a file nothing was read from, and does not let a model’s quotes replace a page of text', async () => {
    const { project, files } = await filed();
    const unread = await readIngestLocally({ fileName: 'empty.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'empty-0001.pdf' }, await pdfOf(['']));
    await pageText.keepPageTexts(project.id, [...files, unread]);
    assert.equal(await pageText.loadPageTexts(project.id, 'empty-0001.pdf'), null);

    // The same deed, read this turn by the model alone: this process holds no page of it.
    const row: ChatIngestFile = { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'sale-deed-0001.pdf' };
    const quote: DocumentFact = { key: 'access', label: 'Access', value: 'right of way', display: 'right of way', page: 2, quote: 'with a right of way twelve feet wide', source: 'model', pageCheck: 'page' };
    const byModel = mergeModelReading(row, { ...row, modelRead: true, modelFacts: [quote], reading: { pagesInFile: 2, pagesRead: 2, readers: { text: 0, ocr: 0, model: 2 }, modelReasons: [], modelPages: [], modelPagesRead: [1, 2] } });
    await pageText.keepPageTexts(project.id, [byModel]);
    assert.match((await pageText.loadPageTexts(project.id, 'sale-deed-0001.pdf'))!.pages[1]!.text, /Navilugudda Village/, 'the fuller text already kept stands');

    const fresh: ChatIngestFile = { ...row, storageKey: 'sale-deed-0002.pdf' };
    await pageText.keepPageTexts(project.id, [mergeModelReading(fresh, { ...fresh, modelRead: true, modelFacts: [quote], reading: byModel.reading })]);
    const kept = await pageText.loadPageTexts(project.id, 'sale-deed-0002.pdf');
    assert.deepEqual(kept?.pages, [{ page: 2, reader: 'model', text: 'with a right of way twelve feet wide' }], 'where nothing was kept, what the model quoted is; a page it was sent and gave nothing for is not a page read');
    assert.deepEqual([kept?.pagesRead, kept?.pagesInFile], [1, 2]);
  });
});

describe('a question put to a paper’s own words', () => {
  /** The project with both papers filed and their pages kept. */
  async function kept(): Promise<DdProject> {
    const { project, files } = await filed();
    await pageText.keepPageTexts(project.id, files);
    return project;
  }

  it('finds a word in whatever form the paper writes it, and quotes from where the words stand together', async () => {
    const project = await kept();
    // The deed says "conveys" and "purchaser"; the question says them its own way.
    const loose = await pageText.searchPageTexts(project, 'conveyed purchasers', { loose: true });
    assert.deepEqual(loose.hits.map((h) => [h.fileName, h.page]), [['deed.pdf', 1]]);
    assert.deepEqual((await pageText.searchPageTexts(project, 'conveyed purchasers')).hits, [], 'asked for as written, a word is only itself');
    assert.deepEqual((await pageText.searchPageTexts(project, 'purchase', { loose: true })).hits, [], 'and "purchase" is still not "purchaser"');
    // "Survey" stands twice on the deed's second page. The passage is from where the other words are.
    const [open] = (await pageText.searchPageTexts(project, 'survey keep open')).hits;
    assert.match(open!.snippet, /Survey No\. 73\/3 to reach Temple Tank Road, which the purchaser shall keep open at all times/);

    // A word that stands on a page in two forms is quoted where it is written as it was asked.
    const last = ['IN WITNESS WHEREOF the vendor and the purchaser have set their hands to this deed on the day,', 'month and year first above written, at Suvarnagiri, in the presence of the persons named below,', 'each of whom has seen the parties sign.', 'WITNESSES: 1. Basavaraju Hiremath of Suvarnagiri 2. Chennamma Patil of Kallusanka', '', 'Page 3 of 3'].join('\n');
    const bytes = await pdfOf([last]);
    await storage.putDocument(project.id, 'attestation-0001.pdf', bytes, 'application/pdf');
    const row = addEvidence(project, { title: 'Attestation page', kind: 'document', status: 'received' });
    attachEvidenceFile(project, row.id, { fileName: 'attestation.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'attestation-0001.pdf', capture: {} }, 'tester');
    await pageText.keepPageTexts(project.id, [await readIngestLocally({ fileName: 'attestation.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'attestation-0001.pdf' }, bytes)]);
    const [witnesses] = (await pageText.searchPageTexts(project, 'witnesses', { loose: true })).hits;
    assert.match(witnesses!.snippet, /WITNESSES: 1\. Basavaraju Hiremath of Suvarnagiri 2\. Chennamma Patil/);
    // The line that numbers the page is the printer's: the passage ends where the paper's own words do.
    assert.match((await pageText.loadPageTexts(project.id, 'attestation-0001.pdf'))!.pages[0]!.text, /Page 3 of 3\s*$/, 'the page is kept whole');
    assert.match(witnesses!.snippet, /Chennamma Patil of Kallusanka$/);
    assert.doesNotMatch(witnesses!.snippet, /Page 3 of 3/);
  });

  it('leaves out of a passage only a line that is unmistakably the page’s own number', async () => {
    const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0043');
    const row = addEvidence(project, { title: 'Sale deed', kind: 'document', status: 'received' });
    attachEvidenceFile(project, row.id, { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'deed-0009.pdf', capture: {} }, 'tester');
    const pages = [
      // A survey number alone on a page's last line is the paper's own.
      { page: 1, reader: 'text', text: 'SCHEDULE\nThe schedule property is the converted land bearing survey number\n118/2' },
      // So is a date alone on its first, and a count that is not this page of this paper's. "2 of 3" on page 2 of 3 numbers the page.
      { page: 2, reader: 'text', text: '12/03/2019\nThe schedule property is bounded on the east by the culvert lane, being plot\n3 of 4\n2 of 3' },
      // "Page 3" says what it is, and so does a number a printer set between dashes.
      { page: 3, reader: 'text', text: 'Page 3\nThe schedule property measures as stated in the culvert survey.\n- 3 -' },
    ];
    await storage.putDocument(project.id, pageText.pageTextKey('deed-0009.pdf'), Buffer.from(JSON.stringify({ v: 1, fileName: 'deed.pdf', readAt: '2026-10-07T00:00:00.000Z', pagesInFile: 3, pagesRead: 3, pages })), 'application/json');
    const found = await pageText.searchPageTexts(project, 'schedule property');
    assert.deepEqual(
      found.hits.map((hit) => [hit.page, hit.snippet]),
      [
        [1, 'SCHEDULE The schedule property is the converted land bearing survey number 118/2'],
        [2, '12/03/2019 The schedule property is bounded on the east by the culvert lane, being plot 3 of 4'],
        [3, 'The schedule property measures as stated in the culvert survey.'],
      ],
    );
  });

  it('takes a question’s own words only where one passage holds them all', async () => {
    const project = await kept();
    // "Deed" opens the deed's first page and "consideration" ends it: the page has both, and no passage of it does.
    assert.deepEqual((await pageText.searchPageTexts(project, 'deed consideration', { loose: true })).hits.map((h) => [h.fileName, h.page]), [['deed.pdf', 1]]);
    assert.deepEqual((await pageText.searchPageTexts(project, 'deed consideration', { loose: true, together: true })).hits, []);
    const [near] = (await pageText.searchPageTexts(project, 'purchaser consideration', { loose: true, together: true })).hits;
    assert.match(near!.snippet, /to the purchaser for a sale consideration of Rs\. 3,18,50,000/);
    // A question nothing else answered is put to the pages that way. One asked outright of a paper is found anywhere on a page.
    const unanswered = paperWordsAsked('Was the deed for a consideration?', { unanswered: true })!;
    assert.deepEqual(unanswered, { words: 'deed consideration', together: true });
    assert.deepEqual((await pageText.paperPassages(project, unanswered)).passages, []);
    assert.equal((await pageText.paperPassages(project, { words: 'deed consideration' })).passages.length, 1);
  });

  it('is answered by rule with the passage, the paper and the page, said to be the paper’s own words', async () => {
    const project = await kept();
    const deed = project.evidence.find((row) => row.title === 'Sale deed')!;
    const asked = paperWordsAsked('What does the deed say about the right of way?')!;
    assert.deepEqual(asked, { words: 'right way', paper: 'the deed' });
    const found = await pageText.paperPassages(project, asked);
    assert.deepEqual(found.passages.map((passage) => [passage.evidenceId, passage.page, passage.reader]), [[deed.id, 2, 'text']]);
    const answer = paperWordsAnswer(found.passages, { notOpened: found.notOpened })!;
    assert.match(answer.text, new RegExp(`^The paper’s own words: “.*with a right of way twelve feet wide over Survey No\\. 73/3.*” \\[ev:${deed.id}:p2\\]$`));
    assert.deepEqual(answer.citedEvidenceIds, [deed.id]);

    // A paper named is the only one searched, and one the file does not hold is not answered from another.
    assert.deepEqual((await pageText.paperPassages(project, { words: 'survey', paper: 'the khata' })).passages.map((passage) => passage.page), [1]);
    assert.deepEqual((await pageText.paperPassages(project, { words: 'survey', paper: 'the lease' })).passages, []);
    assert.equal(paperWordsAnswer((await pageText.paperPassages(project, { words: 'mortgage' })).passages), null, 'nothing found is no answer');
  });

  it('searches only the papers on the copy of the project it is handed', async () => {
    const project = await kept();
    // An outside collaborator's copy: the khata is not among their papers.
    const theirs = { ...project, evidence: project.evidence.filter((row) => row.title !== 'Khata') };
    assert.deepEqual((await pageText.paperPassages(project, { words: 'Rathnamma' })).passages.length, 1);
    assert.deepEqual((await pageText.paperPassages(theirs, { words: 'Rathnamma' })).passages, [], 'a name on a paper they were not given is not found for them');
  });

  it('is a tool a model in the chat has: read only, with each passage’s paper and page, over the same copy', async () => {
    const project = await kept();
    const deed = project.evidence.find((row) => row.title === 'Sale deed')!;
    const search = (of: DdProject, input: { words: string; paper?: string }) => {
      const bag = { proposals: [], navigations: [], toolCalls: [] as Array<{ name: string; summary: string }>, choices: [] };
      const tool = (createProjectTools(of, 'tester', bag) as unknown as Array<{ name: string; run: (args: never, context: never) => Promise<string> }>).find((held) => held.name === 'search_papers')!;
      return tool.run(input as never, undefined as never).then((out) => ({ out: JSON.parse(out) as { searched: boolean; hits: Array<{ evidenceId: string; paper: string; page: number; passage: string; cite: string }>; note: string }, bag }));
    };
    const before = JSON.stringify(project);
    const { out, bag } = await search(project, { words: 'right of way' });
    assert.deepEqual(out.hits.map((hit) => [hit.evidenceId, hit.paper, hit.page, hit.cite]), [[deed.id, 'Sale deed', 2, `[ev:${deed.id}:p2]`]]);
    assert.match(out.hits[0]!.passage, /right of way twelve feet wide/);
    assert.deepEqual(bag.toolCalls, [{ name: 'search_papers', summary: 'Searched the papers: 1 page' }]);
    assert.deepEqual([bag.proposals, bag.navigations], [[], []]);
    assert.equal(JSON.stringify(project), before, 'it changes nothing');

    assert.deepEqual((await search(project, { words: 'survey', paper: 'khata' })).out.hits.map((hit) => hit.paper), ['Khata']);
    const theirs = { ...project, evidence: project.evidence.filter((row) => row.title !== 'Khata') };
    assert.deepEqual((await search(theirs, { words: 'Rathnamma' })).out.hits, [], 'a collaborator’s search is of their own papers');
    assert.match((await search(project, { words: 'lease', paper: 'the lease deed' })).out.note, /^No paper on this project goes by that name\.$/);

    // Where the app has installed no search, the tool says the pages are not kept, and makes nothing up.
    setPaperSearch(null);
    assert.deepEqual((await search(project, { words: 'right of way' })).out, { searched: false, note: 'The pages of the papers are not kept on this deployment.' });
    setPaperSearch((of, words) => pageText.searchPageTexts(of, words, { loose: true, maxHits: 8 }));
  });
});
