/**
 * Reports assembled from fields, held to what they promise.
 *
 * - Each of the three sources (`fields`, `field_table`, `field_chart`)
 *   resolves by code, with a footnote saying where a value came from and a
 *   word for where it stands.
 * - A value somebody offered and nobody accepted never prints: its place
 *   says "waiting". An assumed value says "assumed"; a figure worked out
 *   from a rule row prints the row's citation and "not verified".
 * - A function's template renders for a project with nothing recorded and
 *   for one with values, and every template the product declares is sound.
 * - A block detached from fields keeps what it read that day, marked with
 *   the day, and is not typed into. A person's note is capped.
 * - No model's words reach a report: a card that carries words is refused.
 * - Somebody working from a grant is handed no field block of a function
 *   out of their reach.
 *
 * Every name, paper and figure here is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  workstreamDefinition,
  FIELD_SETS,
  REPORT_NOTE_MOST,
  addEvidence,
  addFieldRecord,
  buildFieldCatalog,
  commitChatProposal,
  createChatProposal,
  createAssessment,
  createProject,
  decideField,
  detachReportBlock,
  editReportBlock,
  functionReportTemplate,
  functionReportTemplates,
  generateReport,
  insertReportBlock,
  isFrozenFieldBlock,
  issueReport,
  ownerPack,
  ownerPackPeriod,
  projectView,
  proposeFieldValues,
  readReportBlock,
  reattachReportBlock,
  recordCheckFields,
  reportTemplateFaults,
  resolveFieldBlock,
  resolveReportBlock,
  retuneReportBlock,
  seedDemoProject,
  setFieldValues,
  setSituation,
  templateBlocks,
  type DdProject,
  type FieldAddress,
  type FieldOrigin,
  type FieldSet,
  type ProjectGrant,
  type ReportBoundSource,
} from '@realytica/shared';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const OWNERS = 'legal.title.owners';
const LEAD = 'lead@firm.example';
const TEMPLATE = 'legal.title.holding.report';
const at = (field: string): FieldAddress => ({ fn: FN, set: HOLDING, field });

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-RPF');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  return p;
}

function deed(p: DdProject) {
  const row = addEvidence(p, { title: 'Sale deed 2019', kind: 'document' });
  row.documentType = 'Sale deed';
  return row;
}

const paper = (evidenceId: string): FieldOrigin => ({ kind: 'paper', evidenceId, page: 3, quote: 'measuring 1 acre 22 guntas', reader: 'model', proof: 'page_text' });
const checkOf = (p: DdProject, definitionId: string) => p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;

/** A project with a holding recorded: an extent accepted from a deed, a tenure read from a public source, two owners and a chain. */
function recorded(): { p: DdProject; deedId: string } {
  const p = project();
  const row = deed(p);
  proposeFieldValues(p, [{ address: at('extent'), value: '1 acre 22 guntas', origin: paper(row.id) }], 'model');
  decideField(p, at('extent'), 'accept', LEAD);
  proposeFieldValues(p, [{ address: at('tenure'), value: 'freehold', origin: { kind: 'external', source: 'Bhoomi land records', asOf: '2026-10-02' } }], 'model');
  decideField(p, at('tenure'), 'accept', LEAD);
  setFieldValues(p, { set: HOLDING }, { possession_verified: true, chain: [{ on: '2004-03-11', event: 'sale', from: 'K. Gowda', to: 'M. Rao' }, { on: '2019-06-20', event: 'sale', from: 'M. Rao', to: 'A. Rao' }] }, LEAD);
  addFieldRecord(p, OWNERS, { name: 'A. Rao', share_pct: 60, capacity: 'individual' }, LEAD);
  addFieldRecord(p, OWNERS, { name: 'B. Rao', share_pct: 40, capacity: 'individual' }, LEAD);
  return { p, deedId: row.id };
}

const cell = (resolved: ReturnType<typeof resolveFieldBlock>, label: string) => {
  const columns = resolved.table!.columns;
  const row = resolved.table!.rows.find((held) => held.cells[columns.indexOf('Field')] === label)!;
  return { value: row.cells[columns.indexOf('Value')]!, standing: row.cells[columns.indexOf('Standing')]! };
};

/* ==================================================================== */
/* The three sources                                                     */
/* ==================================================================== */

describe('a block of named fields', () => {
  it('prints each value as written, with where it stands and a footnote saying where it came from', () => {
    const { p } = recorded();
    const resolved = resolveFieldBlock(p, { kind: 'fields', addresses: ['tenure', 'extent', 'owners_count', 'possession_verified', 'seller'].map(at) });
    assert.deepEqual(resolved.table!.columns, ['Field', 'Value', 'Standing']);

    const extent = cell(resolved, 'Extent held');
    assert.match(extent.value, /^1 acre 22 guntas \(6,272\.63 sqm\) \[\d\]$/, 'the unit as the deed wrote it');
    assert.equal(extent.standing, 'accepted');
    const note = (value: string) => resolved.footnotes!.find((held) => value.includes(`[${held.n}]`))!.text;
    assert.match(note(extent.value), /^Sale deed 2019, p\. 3; accepted by lead@firm\.example on \d+ \w+ \d{4}$/, 'the paper and its page, and who accepted it');

    const tenure = cell(resolved, 'Tenure');
    assert.match(tenure.value, /^Freehold \[\d\]$/);
    assert.match(note(tenure.value), /^Bhoomi land records, read 2 Oct 2026; accepted by /, 'the public source and the day it was read');

    assert.equal(cell(resolved, 'Owners').standing, 'worked out');
    assert.match(cell(resolved, 'Owners').value, /^2/);
    assert.equal(cell(resolved, 'Possession verified on site').standing, 'entered');
    assert.match(note(cell(resolved, 'Possession verified on site').value), /^Entered by lead@firm\.example on /);
    assert.deepEqual(cell(resolved, 'Seller'), { value: '—', standing: 'not recorded' });

    // The same content as lines, for whatever cannot draw a table; and one line for each row.
    assert.equal(resolved.lines.length, resolved.table!.rows.length);
    assert.ok(resolved.lines[1]!.startsWith('Extent held: 1 acre 22 guntas (6,272.63 sqm) ['));
    assert.equal(resolveFieldBlock(p, { kind: 'fields', layout: 'list', addresses: [at('tenure')] }).table, undefined, 'a list is lines alone');
    // Asked twice of the same project, it is the same block.
    assert.deepEqual(resolveFieldBlock(p, { kind: 'fields', addresses: [at('extent')] }), resolveFieldBlock(p, { kind: 'fields', addresses: [at('extent')] }));
  });

  it('never prints a value nobody accepted: its place says waiting', () => {
    const p = project();
    const row = deed(p);
    proposeFieldValues(p, [{ address: at('extent'), value: '5,123 sqm', origin: paper(row.id) }], 'model');
    const source: ReportBoundSource = { kind: 'fields', addresses: [at('extent'), at('value_at_rate')] };
    const resolved = resolveFieldBlock(p, source);
    assert.deepEqual(cell(resolved, 'Extent held').standing, 'waiting');
    assert.match(cell(resolved, 'Extent held').value, /^waiting \[1\]$/);
    assert.ok(!JSON.stringify(resolved).includes('5,123') && !JSON.stringify(resolved).includes('5123'), 'the figure offered is nowhere in the block');
    assert.match(resolved.footnotes![0]!.text, /waits for a person/);
    assert.match(resolved.note!, /^1 value waits for a person and is not printed\.$/);
    assert.equal(cell(resolved, 'Value of the land at Valuation’s rate').standing, 'not recorded', 'and nothing is worked out from it');

    // Two values stated and neither kept: still not a fact.
    decideField(p, at('extent'), 'accept', LEAD);
    setFieldValues(p, { set: HOLDING }, { extent: '4,900 sqm' }, 'junior@firm.example');
    const disputed = resolveFieldBlock(p, source);
    assert.equal(cell(disputed, 'Extent held').standing, 'waiting');
    assert.ok(!/5,123|4,900/.test(JSON.stringify(disputed)));

    // The same in a set of records and in a chart of it.
    proposeFieldValues(p, [{ address: { fn: FN, set: OWNERS, field: 'name' }, value: 'C. Rao', origin: paper(row.id) }], 'model');
    const owners = resolveFieldBlock(p, { kind: 'field_table', records: OWNERS });
    assert.ok(!JSON.stringify(owners).includes('C. Rao'));
    assert.equal(owners.table!.rows[0]!.cells[0]!.replace(/ \[\d\]/, ''), 'waiting');
  });

  it('says assumed of a usual value, cites the rule row a figure was worked out from, and says not verified where it is not', () => {
    const sheet: FieldSet = {
      id: 'finance.budget.receipts',
      fn: 'finance.budget',
      title: 'Receipts',
      v: 1,
      fields: [
        { key: 'collected', label: 'Collected from allottees', kind: 'money', currency: 'INR' },
        { key: 'retention_months', label: 'Defect liability', kind: 'duration', unit: 'months', defaults: [{ value: 60, from: 'catalog', cite: 'RERA Act 2016, section 14(3)' }] },
        {
          key: 'to_keep',
          label: 'To keep in the project account',
          kind: 'computed',
          dimension: 'money',
          currency: 'INR',
          formula: { op: 'divide', left: { op: 'multiply', left: { op: 'field', key: 'collected' }, right: { op: 'rate', table: 'rera_deposit_share' } }, right: { op: 'const', value: 100 } },
        },
      ],
      rules: [],
    };
    const catalog = buildFieldCatalog([...FIELD_SETS, sheet]);
    const p = project();
    setFieldValues(p, { set: sheet.id }, { collected: '2 Cr' }, LEAD, {}, catalog);
    const resolved = resolveFieldBlock(p, { kind: 'fields', addresses: sheet.fields.map((field) => ({ fn: sheet.fn, set: sheet.id, field: field.key })) }, new Date('2026-10-13T00:00:00.000Z'), catalog);
    const note = (value: string) => [...value.matchAll(/\[(\d+)\]/g)].map((found) => resolved.footnotes!.find((held) => held.n === Number(found[1]))!.text);

    const usual = cell(resolved, 'Defect liability');
    assert.equal(usual.standing, 'assumed');
    assert.match(usual.value, /^60 months \[\d\]$/);
    assert.match(note(usual.value)[0]!, /^A usual value: RERA Act 2016, section 14\(3\)\./);

    const kept = cell(resolved, 'To keep in the project account');
    assert.equal(kept.standing, 'worked out, not verified');
    assert.match(kept.value, /^₹1\.4 Cr/);
    assert.match(note(kept.value).join(' '), /Share of allottees’ money kept in the project account, 70 %: Real Estate \(Regulation and Development\) Act, 2016, section 4\(2\)\(l\)\(D\), in force from 1 May 2017; not verified/);
    assert.match(resolved.note!, /not verified/);
  });

  it('leaves out a field that is not in play, and says so where none is', () => {
    const p = project();
    const source: ReportBoundSource = { kind: 'fields', addresses: [at('conversion_order_no'), at('conversion_date')] };
    assert.deepEqual(resolveFieldBlock(p, source), { lines: [], recordIds: [], note: 'None of these fields is in play on this project.' });
    setSituation(p, FN, 'agricultural_land', true, LEAD);
    assert.deepEqual(resolveFieldBlock(p, source).table!.rows.map((row) => row.cells[2]), ['not recorded', 'not recorded']);
  });
});

describe('a table of fields', () => {
  it('prints a table field with the columns chosen, and where the table came from', () => {
    const { p } = recorded();
    const resolved = resolveFieldBlock(p, { kind: 'field_table', address: at('chain'), columns: ['on', 'event', 'to'] });
    assert.deepEqual(resolved.table!.columns, ['Date', 'Event', 'To']);
    assert.deepEqual(resolved.table!.rows.map((row) => row.cells), [['11 Mar 2004', 'Sale', 'M. Rao'], ['20 Jun 2019', 'Sale', 'A. Rao']]);
    assert.match(resolved.note!, /^2 rows, entered \[1\]\.$/);
    assert.match(resolved.footnotes![0]!.text, /^Entered by lead@firm\.example on /);
    assert.equal(resolveFieldBlock(project(), { kind: 'field_table', address: at('chain') }).note, 'Chain of title: no row is recorded yet.');
  });

  it('prints the records of a set that repeats, one row each', () => {
    const { p } = recorded();
    const resolved = resolveFieldBlock(p, { kind: 'field_table', records: OWNERS, columns: ['name', 'share_pct', 'capacity'] });
    assert.deepEqual(resolved.table!.columns, ['Name', 'Share', 'Holds as']);
    assert.deepEqual(resolved.table!.rows.map((row) => row.cells.map((text) => text.replace(/( \[\d+\])+$/, ''))), [['A. Rao', '60%', 'individual'], ['B. Rao', '40%', 'individual']]);
    assert.ok(resolved.footnotes!.length >= 1 && resolved.table!.rows.every((row) => row.address?.record));
    assert.equal(resolveFieldBlock(project(), { kind: 'field_table', records: OWNERS }).note, 'No owner is recorded yet.');
  });
});

describe('a chart of fields', () => {
  it('draws only figures that stand, and carries the same figures as a table', () => {
    const { p, deedId } = recorded();
    proposeFieldValues(p, [{ address: { fn: FN, set: OWNERS, field: 'share_pct' }, value: 99, origin: paper(deedId) }], 'model');
    const resolved = resolveFieldBlock(p, { kind: 'field_chart', records: OWNERS, x: 'name', y: 'share_pct', mark: 'bar' });
    assert.deepEqual(resolved.chart, { mark: 'bar', x: 'Name', y: 'Share', points: [{ label: 'A. Rao', value: 60, said: resolved.chart!.points[0]!.said }, { label: 'B. Rao', value: 40, said: resolved.chart!.points[1]!.said }] });
    assert.match(resolved.chart!.points[0]!.said, /^60%/);
    assert.deepEqual(resolved.table!.rows.map((row) => row.cells[0]), ['A. Rao', 'B. Rao']);
    assert.ok(!JSON.stringify(resolved).includes('99'), 'a share nobody accepted is not drawn');
    assert.match(resolved.note!, /waits? for a person/);
    assert.match(resolveFieldBlock(project(), { kind: 'field_chart', records: OWNERS, x: 'name', y: 'share_pct' }).note!, /No owner is recorded yet/);
  });
});

/* ==================================================================== */
/* Templates                                                             */
/* ==================================================================== */

describe('a function’s report template', () => {
  it('is declared beside the field set, and every one the product declares is sound', () => {
    const template = functionReportTemplate(TEMPLATE)!;
    assert.deepEqual([template.fn, template.set, template.title], [FN, HOLDING, 'Land holding report']);
    assert.deepEqual(reportTemplateFaults(), []);
    // Every department hands over at least one report its own file declares, and each is fields, tables, charts, photographs resolved by place and period, and capped notes: no section holds prose.
    const declared = functionReportTemplates().filter((template) => !template.id.endsWith('.checks'));
    assert.deepEqual([...new Set(declared.map((template) => workstreamDefinition(template.fn)!.department))].sort(), ['commercial', 'construction', 'design', 'finance', 'legal', 'procurement']);
    for (const template of declared) {
      assert.ok(template.sections.every((section) => 'fields' in section || 'table' in section || 'records' in section || 'chart' in section || 'note' in section || 'photos' in section), template.id);
      assert.ok(template.sections.filter((section) => 'note' in section).length <= 1, `${template.id} has one note at most`);
    }
    // The functions that keep their fields on checks, in the departments that hand over a report, each have one.
    const ids = functionReportTemplates().map((held) => held.id);
    for (const id of ['legal.title.checks', 'legal.approvals.checks', 'finance.valuation.checks', 'finance.budget.checks', 'construction.progress.checks', 'construction.quality.checks']) assert.ok(ids.includes(id), id);
    assert.ok(!ids.includes('commercial.market.checks'), 'a department with no report of its own has none');
    // A fault is named, with the template and the section it is in.
    assert.deepEqual(reportTemplateFaults([{ id: 't', fn: FN, set: HOLDING, title: 'T', sections: [{ heading: 'A', fields: ['no_such'] }, { heading: 'B', note: { maxLength: 99_999 } }, { heading: 'C', chart: { of: 'chain', x: 'on', y: 'event' } }] }]), [
      'Report “t”, “B”: a note is capped at between 1 and 2000 characters.',
      'Report “t”, “A”: There is no field “no_such” on “legal.title.holding”.',
      'Report “t”, “C”: “Event” is not a figure, so there is nothing to draw.',
    ]);
  });

  it('renders for a project with nothing recorded and for one with values', () => {
    const empty = project();
    const bare = generateReport(empty, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    assert.deepEqual([bare.kind, bare.templateId, bare.title], ['function', TEMPLATE, 'Land holding report — Harohalli']);
    assert.deepEqual(bare.body.blocks.map((block) => [block.heading, block.source?.kind ?? 'note']), [
      ['The holding', 'fields'],
      ['Owners', 'field_table'],
      ['Shares held', 'field_chart'],
      ['Chain of title', 'field_table'],
      ['Conversion', 'fields'],
      ['The parcel check', 'fields'],
      ['Opinion on the holding', 'note'],
    ]);
    const read = (p: DdProject, report: typeof bare) => report.body.blocks.map((block) => resolveReportBlock(p, block));
    const [holding, owners, shares, chain, conversion, parcel, opinion] = read(empty, bare);
    assert.deepEqual(holding!.table!.rows.map((row) => [row.cells[0], row.cells[1], row.cells[2]]), [
      ['Tenure', '—', 'not recorded'],
      ['Extent held', '—', 'not recorded'],
      ['Land area in the title deeds', '—', 'not recorded'],
      ['Owners', '0', 'worked out'],
      ['Value of the land at Valuation’s rate', '—', 'not recorded'],
      ['Holding record', '—', 'not recorded'],
      ['Seller', '—', 'not recorded'],
      ['Possession verified on site', '—', 'not recorded'],
    ]);
    assert.equal(holding!.footnotes, undefined);
    assert.deepEqual([owners!.note, chain!.note, conversion!.note], ['No owner is recorded yet.', 'Chain of title: no row is recorded yet.', 'None of these fields is in play on this project.']);
    assert.match(shares!.note!, /No owner is recorded yet/);
    assert.equal(parcel!.table!.rows.length, 4, 'a check’s fields are read by the same address');
    assert.deepEqual(opinion!.lines, []);
    assert.deepEqual([bare.body.blocks[6]!.origin, bare.body.blocks[6]!.cap], ['authored', 800]);

    const { p } = recorded();
    recordCheckFields(p, checkOf(p, 'land_site.parcel_identification').id, { extent_title: 6273, survey_numbers: '41/2' }, LEAD);
    const full = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const [held, people, drawn, links, , check] = read(p, full);
    assert.ok(held!.footnotes!.length >= 3);
    assert.equal(people!.table!.rows.length, 2);
    assert.equal(drawn!.chart!.points.length, 2);
    assert.equal(links!.table!.rows.length, 2);
    assert.match(check!.lines.join('\n'), /Extent per title: 6,273 sqm/);
    // The mirror of the check's extent says where it is read from.
    const mirror = held!.table!.rows.find((row) => row.cells[0] === 'Land area in the title deeds')!;
    assert.match(held!.footnotes!.find((note) => mirror.cells[1]!.includes(`[${note.n}]`))!.text, /^Read from Parcel identification matches title and survey\.$/);

    assert.throws(() => generateReport(p, { kind: 'function', template: 'no.such.report', generatedBy: LEAD }), /no template by that name/);
  });

  it('renders every declared template on a new project and on the demo project', () => {
    for (const p of [project(), seedDemoProject()]) {
      for (const template of functionReportTemplates()) {
        const report = generateReport(p, { kind: 'function', template: template.id, generatedBy: LEAD });
        assert.equal(report.body.blocks.length, templateBlocks(template).length);
        for (const block of report.body.blocks) {
          const resolved = resolveReportBlock(p, block);
          assert.ok(resolved.lines.length > 0 || resolved.note !== undefined || block.origin === 'authored', `${template.id} › ${block.heading}`);
        }
      }
    }
  });
});

/* ==================================================================== */
/* Arranging, notes and freezing                                         */
/* ==================================================================== */

describe('a person arranging a report', () => {
  it('adds a block of fields, and is refused one that names no such field', () => {
    const { p } = recorded();
    const report = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const block = insertReportBlock(p, report.id, { heading: 'Tenure', source: { kind: 'fields', addresses: [at('tenure')] }, afterBlockId: report.body.blocks[0]!.id }, LEAD);
    assert.equal(report.body.blocks[1]!.id, block.id);
    assert.throws(() => insertReportBlock(p, report.id, { source: { kind: 'fields', addresses: [at('no_such_field')] } }, LEAD), /no field “no_such_field”/);
    assert.throws(() => retuneReportBlock(p, report.id, block.id, { kind: 'field_chart', address: at('chain'), x: 'on', y: 'event' }, LEAD), /not a figure/);
    assert.throws(() => editReportBlock(p, report.id, block.id, { text: 'Freehold, I am sure.' }, LEAD), /not yours to write/, 'a block bound to fields is not typed into');
  });

  it('writes a note between blocks, capped, with their name and the day', () => {
    const { p } = recorded();
    const report = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const opinion = report.body.blocks.at(-1)!;
    editReportBlock(p, report.id, opinion.id, { text: 'The holding is in order subject to the survey sketch.' }, LEAD);
    assert.deepEqual([opinion.editedBy, opinion.editedAt!.slice(0, 4) >= '2026'], [LEAD, true]);
    assert.throws(() => editReportBlock(p, report.id, opinion.id, { text: 'x'.repeat(801) }, LEAD), /holds 800 characters at most, and this is 801/);
    assert.equal(opinion.text, 'The holding is in order subject to the survey sketch.', 'a note past its cap is refused, not cut');
    const note = insertReportBlock(p, report.id, { heading: 'A note', text: 'Seen on site.' }, LEAD);
    assert.throws(() => editReportBlock(p, report.id, note.id, { text: 'y'.repeat(REPORT_NOTE_MOST + 1) }, LEAD), /2,000 characters at most/);
    assert.throws(() => insertReportBlock(p, report.id, { text: 'y'.repeat(REPORT_NOTE_MOST + 1) }, LEAD), /at most/);
  });

  it('detaches a block of fields, which then stays as it read that day, is marked with the day and is not typed into', () => {
    const { p } = recorded();
    const report = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const holding = report.body.blocks[0]!;
    const shares = report.body.blocks[2]!;
    const before = resolveReportBlock(p, holding);
    const drawn = resolveReportBlock(p, shares);
    detachReportBlock(p, report.id, holding.id, LEAD);
    detachReportBlock(p, report.id, shares.id, LEAD);
    assert.ok(isFrozenFieldBlock(holding) && holding.detachedAt && holding.detachedFrom === 'fields' && holding.origin === 'authored');

    // The fields move on; the block does not.
    setFieldValues(p, { set: HOLDING }, { possession_verified: false }, LEAD);
    addFieldRecord(p, OWNERS, { name: 'C. Rao', share_pct: 10 }, LEAD);
    assert.deepEqual(resolveReportBlock(p, holding), before, 'the table, the footnotes and the note as they stood');
    assert.deepEqual(resolveReportBlock(p, shares).chart, drawn.chart, 'and the chart');
    assert.throws(() => editReportBlock(p, report.id, holding.id, { text: 'Tenure: leasehold' }, LEAD), /holds what the fields said on \d{4}-\d{2}-\d{2}\. It is not typed into/);
    editReportBlock(p, report.id, holding.id, { heading: 'The holding, as first read' }, LEAD);

    // Put back, it reads the same fields again, as they are now.
    reattachReportBlock(p, report.id, holding.id, LEAD);
    assert.deepEqual([holding.origin, holding.source?.addresses?.length, holding.detachedAt, holding.frozenTable], ['derived', 8, undefined, undefined]);
    assert.equal(cell(resolveReportBlock(p, holding), 'Possession verified on site').value.replace(/ \[\d\]/, ''), 'no');
  });

  it('issues a report whose field blocks then keep their footnotes and their chart', () => {
    const { p } = recorded();
    const report = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const was = report.body.blocks.map((block) => resolveReportBlock(p, block));
    issueReport(p, report.id, LEAD, { name: 'A. Lead' });
    setFieldValues(p, { set: HOLDING }, { possession_verified: false }, LEAD);
    addFieldRecord(p, OWNERS, { name: 'C. Rao', share_pct: 10 }, LEAD);
    for (const [index, block] of report.body.blocks.entries()) {
      if (!block.source) continue;
      const now = readReportBlock(p, block, true);
      assert.deepEqual([now.lines, now.table, now.footnotes, now.chart, now.note], [was[index]!.lines, was[index]!.table, was[index]!.footnotes, was[index]!.chart, was[index]!.note], block.heading);
    }
  });
});

/* ==================================================================== */
/* No model's words                                                      */
/* ==================================================================== */

describe('a card a model raised against a report', () => {
  const card = (p: DdProject, payload: Record<string, unknown>) => {
    const made = createChatProposal('edit_report', 'Edit the report', 'Offered by a model.', 'Changes the open report.', payload, 'model');
    p.chatProposals.push(made);
    return made.id;
  };

  it('is refused where it carries words, and accepted where it names what a section reads', () => {
    const { p } = recorded();
    const report = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const count = report.body.blocks.length;
    assert.throws(() => commitChatProposal(p, card(p, { reportId: report.id, heading: 'Opinion', text: 'The title is clean and marketable.' }), LEAD), /written by a person/);
    assert.throws(() => commitChatProposal(p, card(p, { reportId: report.id, blockId: report.body.blocks.at(-1)!.id, text: 'The title is clean.' }), LEAD), /written by a person/);
    assert.equal(report.body.blocks.length, count);
    assert.ok(!JSON.stringify(report).includes('clean'), 'none of its words is on the report');

    commitChatProposal(p, card(p, { reportId: report.id, source: { kind: 'fields', addresses: [at('tenure'), at('extent')] } }), LEAD);
    const added = report.body.blocks.at(-1)!;
    assert.deepEqual([added.origin, added.source?.kind, added.heading, added.text], ['derived', 'fields', 'Land holding', undefined], 'a section of field addresses, named by code');
  });
});

/* ==================================================================== */
/* The status report and the owner pack                                  */
/* ==================================================================== */

describe('the status report and the owner pack', () => {
  it('a status report on a project that keeps fields says which were recorded in its period', () => {
    const bare = createProject({ name: 'Empty plot', type: 'residential', location: 'Elsewhere', city: 'Bengaluru' }, 'RYT-RPE');
    const none = generateReport(bare, { kind: 'status', period: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }, generatedBy: LEAD });
    assert.deepEqual(none.body.blocks.map((block) => block.source?.kind), ['status_changed', 'status_waiting', 'status_next'], 'a project that keeps none reads as it did');

    const { p } = recorded();
    for (const value of Object.values(p.fieldSheets![HOLDING]!.values)) {
      value.at = '2026-10-05T09:00:00.000Z';
      if (value.acceptedAt) value.acceptedAt = '2026-10-05T09:00:00.000Z';
    }
    const report = generateReport(p, { kind: 'status', period: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }, generatedBy: LEAD });
    const block = report.body.blocks[3]!;
    assert.deepEqual([block.heading, block.source?.kind], ['Fields recorded, October 2026', 'fields']);
    const resolved = resolveReportBlock(p, block);
    const fields = resolved.table!.rows.map((row) => row.cells[resolved.table!.columns.indexOf('Field')]);
    assert.ok(['Tenure', 'Extent held', 'Chain of title'].every((label) => fields.includes(label)), fields.join(', '));
    assert.ok(resolved.footnotes!.some((note) => note.text.startsWith('Sale deed 2019, p. 3')));
    const earlier = resolveFieldBlock(p, { kind: 'fields', from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    assert.ok(!earlier.lines.some((line) => line.includes('Tenure')), 'a field decided in another period is not among them');
  });

  it('an owner pack prints the functions’ own fields under Time and Cost where the project keeps them, and is as it was where it keeps none', () => {
    const p = project();
    const period = ownerPackPeriod({ month: '2026-10' });
    const before = ownerPack(p, period, new Date('2026-10-13T00:00:00.000Z'));
    assert.deepEqual(before.sections.map((section) => [section.key, section.fields === undefined]), [['standing', true], ['time', true], ['cost', true], ['decisions', true], ['meetings', true], ['papers', true]]);

    p.assessments[0]!.scopes[0]!.checks.push({ ...checkOf(p, 'land_site.parcel_identification'), id: 'chk_budget', definitionId: 'cost_quantity.budget_current', fields: {} });
    recordCheckFields(p, 'chk_budget', { sanctioned_budget: 420000000, current_forecast: 445000000 }, LEAD);
    const after = ownerPack(p, period, new Date('2026-10-13T00:00:00.000Z'));
    const cost = after.sections.find((section) => section.key === 'cost')!;
    assert.deepEqual(cost.fields!.table!.columns, ['Where', 'Field', 'Value', 'Standing']);
    assert.deepEqual(cost.fields!.table!.rows.map((row) => [row.cells[1], row.cells[2]!.replace(/ \[\d\]$/, ''), row.cells[3]]).slice(0, 3), [
      ['Sanctioned budget', '₹42 Cr', 'entered'],
      ['Current forecast at completion', '₹44.5 Cr', 'entered'],
      ['Spent to date', '—', 'not recorded'],
    ]);
    assert.match(cost.fields!.footnotes![0]!.text, /^Entered by lead@firm\.example on /);
    assert.equal(after.sections.find((section) => section.key === 'time')!.fields, undefined);
    assert.deepEqual(after.sections.map((section) => section.parts), before.sections.map((section) => section.parts), 'what the pack already said is unchanged');
  });
});

/* ==================================================================== */
/* Roles                                                                 */
/* ==================================================================== */

describe('somebody working from a grant', () => {
  const grant = (scopeKeys: ProjectGrant['scopeKeys']): ProjectGrant =>
    ({ id: 'g1', tenantId: 't1', projectId: 'p1', email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys, areas: ['reports'], createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'owner' }) as ProjectGrant;

  it('is handed no field block of a function out of their reach, live, detached or issued', () => {
    const { p } = recorded();
    const live = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    detachReportBlock(p, live.id, live.body.blocks[0]!.id, LEAD);
    const issued = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    issueReport(p, issued.id, LEAD, { name: 'A. Lead' });
    for (const value of Object.values(p.fieldSheets![HOLDING]!.values)) value.at = '2026-10-05T09:00:00.000Z';
    const status = generateReport(p, { kind: 'status', period: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }, generatedBy: LEAD });
    issueReport(p, status.id, LEAD, { name: 'A. Lead' });

    const outside = projectView(p, { kind: 'granted', grant: grant(['technical']), email: 'sam@site.example' }).project;
    assert.equal(outside.reports.length, 3);
    for (const report of outside.reports.slice(0, 2)) {
      assert.deepEqual(report.body.blocks.map((block) => block.heading), ['Opinion on the holding'], 'only the note is left of a report on Title');
    }
    const theirs = outside.reports[2]!.body.blocks[3]!;
    assert.deepEqual([theirs.frozenTable!.rows.length, theirs.frozen!.length, theirs.frozenFootnotes?.length ?? 0], [0, 0, 0], 'and of the period’s fields, none of Title’s');
    assert.ok(!JSON.stringify([outside.reports[0], outside.reports[1], theirs]).includes('6,272.63') && !JSON.stringify([outside.reports[0], outside.reports[1], theirs]).includes('Sale deed 2019'));

    const inside = projectView(p, { kind: 'granted', grant: grant(['legal']), email: 'sam@site.example' }).project;
    assert.equal(inside.reports[0]!.body.blocks.length, 7);
    assert.ok(inside.reports[2]!.body.blocks[3]!.frozenTable!.rows.length > 0);
    assert.equal(p.reports[0]!.body.blocks.length, 7, 'the project itself is not changed');
  });

  it('is handed no buyer and no sale off a report: a block is cut by the rule the sheets are cut by', () => {
    const { p } = recorded();
    const unit = addFieldRecord(p, 'shared.units', { number: 'A-501', carpet_area: '100 sqm', sale_released: true, sale_agreed_value: 8_000_000, handover_offered_on: '2026-10-01' }, LEAD).record!;
    const buyer = addFieldRecord(p, 'shared.parties', { name: 'A. Buyer', kind: 'individual', roles: ['customer'] }, LEAD).record!;
    addFieldRecord(p, 'commercial.inventory.buyers', { party: buyer.id, unit: unit.id }, LEAD);
    const report = generateReport(p, { kind: 'function', template: TEMPLATE, generatedBy: LEAD });
    const add = (heading: string, source: Parameters<typeof insertReportBlock>[2]['source']) => insertReportBlock(p, report.id, { heading, source }, LEAD);
    add('Buyers', { kind: 'field_table', records: 'commercial.inventory.buyers' });
    add('Sale of a unit', { kind: 'fields', addresses: [{ fn: 'shared', set: 'shared.units', field: 'sale_agreed_value', record: unit.id }] });
    add('Units and their sale', { kind: 'field_table', records: 'shared.units', columns: ['number', 'sale_agreed_value'] });
    add('Units', { kind: 'field_table', records: 'shared.units', columns: ['number', 'carpet_area'] });
    add('Possession', { kind: 'field_table', records: 'shared.units', columns: ['number', 'handover_offered_on'] });
    const parties = add('Parties', { kind: 'field_table', records: 'shared.parties', columns: ['name', 'roles'] });

    // A surveyor on Handover reads the unit and its possession. The sale and the buyers are Sales' own, whoever else may see the unit.
    const handover = projectView(p, { kind: 'granted', grant: grant(['condition_operations']), email: 'sam@site.example' }).project;
    const headings = handover.reports.at(-1)!.body.blocks.map((block) => block.heading);
    for (const kept of ['Units', 'Possession']) assert.ok(headings.includes(kept), kept);
    for (const cut of ['Buyers', 'Sale of a unit', 'Units and their sale']) assert.ok(!headings.includes(cut), cut);
    assert.ok(!JSON.stringify(handover.reports).includes('A. Buyer'), 'a live list of parties is read from their own copy, which holds no buyer');

    // Kept as it read one day, a list of parties carries its names with it: it is not handed over at all.
    detachReportBlock(p, report.id, parties.id, LEAD);
    assert.ok(JSON.stringify(p.reports.at(-1)).includes('A. Buyer'));
    const after = projectView(p, { kind: 'granted', grant: grant(['condition_operations']), email: 'sam@site.example' }).project;
    assert.ok(!after.reports.at(-1)!.body.blocks.some((block) => block.heading === 'Parties'));
    assert.ok(!JSON.stringify(after.reports).includes('A. Buyer'));
  });
});
