/**
 * Each page's text, kept beside the file it was read from.
 *
 * A reading kept what it understood and threw the words away, so nothing
 * could later be answered from a paper that the rules had no pattern for.
 * These hold the keeping: one object a file, beside the file, under the
 * project; read back whole or searched for words; gone with the project.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { addEvidence, attachEvidenceFile, createProject, type ChatIngestFile, type DdProject, type DocumentFact } from '../packages/shared/src';

type PageText = typeof import('../apps/api/src/documents/page-text');
type Intake = typeof import('../apps/api/src/documents/intake');
type Storage = typeof import('../apps/api/src/storage');

let pageText: PageText;
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
