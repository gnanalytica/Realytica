/**
 * Reading property documents with no model: text layers, OCR, and what the
 * reading proposes.
 *
 * Runs against the synthetic sample set in `apps/api/sample-documents` —
 * Ghostscript-written PDFs with compressed text layers, and two scans with no
 * text layer at all — so the reader is tested on the shapes it will actually
 * meet. Every document there is invented and carries a DEMO banner.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  absorbAnsweredGaps,
  addEvidence,
  commitChatProposal,
  createAssessment,
  createProject,
  documentAnswers,
  factFillProposals,
  flagFindingProposals,
  matchReadToRow,
  parseDocumentText,
  parseIndianDate,
  proposalsFromIngest,
  type ChatIngestFile,
  type DdProject,
} from '@realytica/shared';
import { readDocumentText, releaseOcr } from '../apps/api/src/documents/read-text';
import { readIngestLocally } from '../apps/api/src/documents/intake';

const DOCS = path.resolve('apps/api/sample-documents');

async function read(name: string) {
  const bytes = new Uint8Array(readFileSync(path.join(DOCS, name)));
  const mime = name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
  const text = await readDocumentText(bytes, mime, name);
  return { text, parsed: parseDocumentText(text.pages, name) };
}

function fact(parsed: ReturnType<typeof parseDocumentText>, key: string) {
  return parsed.facts.find((f) => f.key === key);
}

after(() => releaseOcr());

describe('reading a text-layer PDF', () => {
  it('reads a compressed, multi-page sale deed page by page', async () => {
    const { text, parsed } = await read('Sale_Deed_2019_Sy_118-2_Whitefield.pdf');
    assert.equal(text.method, 'text');
    assert.equal(text.pages.length, 3);
    assert.equal(parsed.type, 'sale_deed');
    assert.equal(fact(parsed, 'survey_numbers')?.value, '118/2');
    assert.equal(fact(parsed, 'extent_title')?.value, 12000);
    assert.equal(fact(parsed, 'extent_title')?.page, 2, 'the schedule is on page 2');
    assert.equal(fact(parsed, 'consideration')?.value, 420000000);
  });

  it("takes the deed's own registration, not the predecessor it recites", async () => {
    const { parsed } = await read('Sale_Deed_2019_Sy_118-2_Whitefield.pdf');
    assert.equal(fact(parsed, 'document_number')?.value, 'WTF-1-04471-2018-19');
    assert.equal(fact(parsed, 'sub_registrar')?.value, 'Whitefield');
    assert.equal(fact(parsed, 'root_year')?.value, '1998-09-06', 'the recital dates the root of title');
  });

  it('reads a boundary that contains "No." to the end of its line', async () => {
    const { parsed } = await read('Sale_Deed_2019_Sy_118-2_Whitefield.pdf');
    assert.equal(fact(parsed, 'boundary_west')?.value, 'Survey No. 118/1');
    // The parcel is the survey number the deed keeps returning to, not a neighbour.
    assert.notEqual(fact(parsed, 'survey_numbers')?.value, '118/1');
  });

  it('tells the mother deed from the sale deed by how title arose', async () => {
    const { parsed } = await read('Mother_Deed_1998_Sy_118-2.pdf');
    assert.equal(parsed.type, 'mother_deed');
    assert.equal(fact(parsed, 'root_year')?.value, '1998-09-06');
  });

  it('flags a subsisting mortgage on the EC as critical', async () => {
    const { parsed } = await read('Encumbrance_Certificate_Form15_1995-2025.pdf');
    assert.equal(parsed.type, 'encumbrance_certificate');
    assert.equal(fact(parsed, 'ec_from')?.value, '1995-04-01');
    assert.equal(fact(parsed, 'ec_to')?.value, '2025-03-31');
    assert.equal(fact(parsed, 'ec_nil')?.value, false);
    assert.ok(parsed.flags.some((f) => f.severity === 'critical' && /mortgage/i.test(f.title)));
  });

  it('reads the rest of the set as what each one is', async () => {
    const expected: Array<[string, string, string, unknown]> = [
      ['Khata_Certificate_and_Extract_BBMP.pdf', 'khata', 'extent_khata', 11850],
      ['Property_Tax_Receipt_BBMP_2025-26.pdf', 'property_tax_receipt', 'tax_paid', 1842650],
      ['Zoning_Certificate_BDA_RMP2015.pdf', 'zoning_certificate', 'permissible_far', 2.25],
      ['DC_Conversion_Order_2017.pdf', 'conversion_order', 'conversion_status', 'converted'],
      ['Building_Plan_Sanction_BBMP_2021.pdf', 'building_sanction', 'sanctioned_area', 27000],
      ['Survey_Sketch_11E_Sy_118-2.pdf', 'survey_sketch', 'extent_survey', 11980],
    ];
    for (const [name, type, key, value] of expected) {
      const { parsed } = await read(name);
      assert.equal(parsed.type, type, name);
      assert.equal(fact(parsed, key)?.value, value, `${name}: ${key}`);
    }
  });
});

describe('reading a scan with OCR', () => {
  it('reads a phone photo of a deed page', async () => {
    const { text, parsed } = await read('SCANNED_Sale_Deed_Schedule_Page.jpg');
    assert.equal(text.method, 'ocr');
    assert.ok((text.ocrConfidence ?? 0) > 70, `confidence ${text.ocrConfidence}`);
    assert.equal(parsed.type, 'sale_deed');
    assert.equal(fact(parsed, 'extent_title')?.value, 12000);
  });

  it('reads an image-only PDF', async () => {
    const { text, parsed } = await read('SCANNED_Encumbrance_Certificate.pdf');
    assert.equal(text.method, 'ocr');
    assert.deepEqual(text.ocrPages, [1]);
    assert.equal(parsed.type, 'encumbrance_certificate');
    assert.ok(parsed.flags.some((f) => /mortgage/i.test(f.title)));
  });
});

describe('what cannot be read', () => {
  it('says so in plain words rather than throwing', async () => {
    const empty = await readDocumentText(new Uint8Array(), 'application/pdf', 'empty.pdf');
    assert.equal(empty.method, 'none');
    assert.match(String(empty.failure), /empty/i);
    const junk = await readDocumentText(new TextEncoder().encode('%PDF-1.4 not really'), 'application/pdf', 'broken.pdf');
    assert.equal(junk.method, 'none');
    assert.ok(junk.failure && !/Error|stack|at /.test(junk.failure), junk.failure);
  });

  it('returns no guess for text that is not a property document', () => {
    const parsed = parseDocumentText(['Minutes of the residents association meeting. Tea was served.']);
    assert.equal(parsed.type, 'other');
    assert.equal(parsed.facts.length, 0);
  });
});

describe('dates as Indian instruments write them', () => {
  it('reads the common forms', () => {
    assert.equal(parseIndianDate('12-03-2019'), '2019-03-12');
    assert.equal(parseIndianDate('06.09.1998'), '1998-09-06');
    assert.equal(parseIndianDate('12th day of March, 2019'), '2019-03-12');
    assert.equal(parseIndianDate('4 August 2025'), '2025-08-04');
    assert.equal(parseIndianDate('31-02-2020'), null, 'no such day');
  });
});

/* ------------------------------------------------------------------ */
/* What a reading proposes                                             */
/* ------------------------------------------------------------------ */

function freshProject(): DdProject {
  const project = createProject({ name: 'Whitefield Tech Park Block C', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-T');
  for (const title of ['Mother deed / title chain', 'Sale deed (registered conveyance)', 'Encumbrance certificate (Form 15/16, 30-year)']) {
    addEvidence(project, { title, kind: 'document', status: 'expected' });
  }
  return project;
}

async function ingestOf(name: string): Promise<ChatIngestFile> {
  const buffer = readFileSync(path.join(DOCS, name));
  return readIngestLocally({ fileName: name, mimeType: 'application/pdf', sizeBytes: buffer.length, storageKey: `k-${name}` }, buffer);
}

describe('where a read document is filed', () => {
  it('files a sale deed on the sale deed row, not the mother deed row', async () => {
    const project = freshProject();
    const file = await ingestOf('Sale_Deed_2019_Sy_118-2_Whitefield.pdf');
    const row = matchReadToRow(project, file.read!);
    assert.equal(row?.title, 'Sale deed (registered conveyance)');
  });

  it('files the mother deed on the title-chain row', async () => {
    const project = freshProject();
    const file = await ingestOf('Mother_Deed_1998_Sy_118-2.pdf');
    assert.equal(matchReadToRow(project, file.read!)?.title, 'Mother deed / title chain');
  });

  it('names a new row for what the document is, not its filename', async () => {
    const project = freshProject();
    const file = await ingestOf('Zoning_Certificate_BDA_RMP2015.pdf');
    const [card] = proposalsFromIngest(project, [file]);
    assert.equal(card?.payload.title, 'Zoning certificate');
    assert.equal(card?.payload.readFailure, undefined);
  });

  it('matches phrases, never a shared word', () => {
    assert.ok(documentAnswers('Sale deed', 'Title extract'));
    assert.ok(documentAnswers('Survey sketch', 'Survey plan'));
    assert.ok(!documentAnswers('Survey sketch', 'Condition survey'));
    assert.ok(!documentAnswers('Sanctioned building plan', 'Sanction letter'));
    assert.ok(!documentAnswers('Encumbrance certificate', 'EC order'));
  });
});

describe('what a read document proposes', () => {
  it('fills only blank fields, and never twice', async () => {
    const project = freshProject();
    createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const file = await ingestOf('Khata_Certificate_and_Extract_BBMP.pdf');
    const first = factFillProposals(project, file.read!.facts, { fileName: file.fileName });
    assert.ok(first.some((c) => (c.payload.values as Record<string, unknown>).extent_khata === 11850));
    const again = factFillProposals(project, file.read!.facts, { fileName: file.fileName }, 'tester', first);
    assert.equal(again.length, 0, 'the same values are not offered twice');
  });

  it('raises a flag as a finding once, however many copies of the EC arrive', async () => {
    const project = freshProject();
    const file = await ingestOf('Encumbrance_Certificate_Form15_1995-2025.pdf');
    const cards = flagFindingProposals(project, file.read!.flags, { fileName: file.fileName });
    assert.equal(cards.length, 1);
    assert.equal(flagFindingProposals(project, file.read!.flags, { fileName: file.fileName }, 'tester', cards).length, 0);
  });
});

describe('documents filed before the DD that asks for them', () => {
  it('are linked to the new checks instead of leaving empty duplicate rows', async () => {
    const project = freshProject();
    const file = await ingestOf('Sale_Deed_2019_Sy_118-2_Whitefield.pdf');
    const [card] = proposalsFromIngest(project, [file]);
    project.chatProposals.push(card!);
    commitChatProposal(project, card!.id);
    const deed = project.evidence.find((e) => e.documentType === 'Sale deed')!;
    assert.ok(deed.attachments.length, 'the deed is filed');

    const dd = createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const parcel = dd.scopes.flatMap((s) => s.checks).find((c) => c.expectedEvidence.includes('Title extract'))!;
    assert.ok(parcel.evidenceIds.includes(deed.id), 'the deed answers the check');
    assert.ok(!project.evidence.some((e) => e.title === 'Title extract' && e.status === 'expected'), 'no empty "Title extract" row beside it');
  });

  it('a document filed after the DD answers every open row it is', () => {
    const project = freshProject();
    createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const gap = project.evidence.find((e) => e.title === 'Title extract' && e.status === 'expected')!;
    const deed = project.evidence.find((e) => e.title === 'Sale deed (registered conveyance)')!;
    deed.documentType = 'Sale deed';
    deed.attachments.push({ id: 'f1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', uploadedAt: new Date().toISOString() } as never);
    const absorbed = absorbAnsweredGaps(project, deed);
    assert.ok(absorbed.some((g) => g.id === gap.id));
    assert.equal(gap.status, 'superseded');
    assert.equal(gap.supersededById, deed.id, 'kept, with a pointer to what answered it');
    assert.ok(deed.checkIds.length > 0);
  });
});
