/**
 * What a function's page opens on, and the one way each figure is written.
 *
 * A function opens on Needs you and the list of its sheets and nothing else;
 * Needs you is at most five lines in all with one action each; a good
 * standing is never drawn above failing lines; a chat proposal waits only on
 * the function it concerns; a day, an amount and a share are each written one
 * way; and a drop of papers still being read is said so after a reload.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  RECORD_AS_OFFERED,
  addEvidence,
  agreeSaid,
  countSaid,
  createAssessment,
  createProject,
  daySaid,
  fieldCatalogFor,
  formatFieldValue,
  percentSaid,
  proposeFieldValues,
  readFunctionFields,
  setFieldValues,
  setTeamMember,
  type CheckFieldDef,
  type DdProject,
  type FieldAddress,
  type FieldException,
  type FieldOrigin,
  type FunctionFields,
  type GeneratedReport,
  type WaitingEntry,
} from '@realytica/shared';
import { NEEDS_SHOWN, needAction, needAssumes, needChips, needLines, needRuleRows, needRuleUnchecked, needSource, needUnverified, needWhere, sheetItem, sheetItemOf } from '../apps/web/src/components/fields/needs';
import { person, pct, money, readingSaid, date } from '../apps/web/src/lib/format';
import { reportSummary } from '../apps/web/src/lib/report-summary';
import { readingProgress } from '../apps/web/src/lib/reading-pending';
import { waitingOnPane } from '../apps/web/src/pages/projects/cockpit/waiting-here';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const LEAD = 'lead@firm.example';

function project(): DdProject {
  const p = createProject({ name: 'Kere Bank', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-NDY');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead' } }, 'owner');
  return p;
}

function deed(p: DdProject) {
  const row = addEvidence(p, { title: 'Sale deed 2019', kind: 'document' });
  row.documentType = 'Sale deed';
  row.attachments = [{ id: 'f1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k-${row.id}`, uploadedAt: '2026-10-01T00:00:00.000Z', uploadedBy: 'tester' } as never];
  return row;
}

const paper = (evidenceId: string): FieldOrigin => ({ kind: 'paper', evidenceId, page: 3, quote: 'measuring 1 acre 22 guntas', reader: 'model', proof: 'page_text' });
const at = (field: string, set = HOLDING): FieldAddress => ({ fn: FN, set, field });

const line = (need: FieldException['need'], n: number): FieldException => ({ kind: need === 'accept' ? 'proposed' : need === 'missing' ? 'missing' : 'rule', need, key: `${need}-${n}`, sheet: 'Land holding', label: `Line ${n}`, text: '' });
const needsOf = (counts: Partial<Record<FieldException['need'], number>>): FunctionFields['needs'] => {
  const of = (need: FieldException['need']) => Array.from({ length: counts[need] ?? 0 }, (_, n) => line(need, n));
  return { decide: of('decide'), accept: of('accept'), failing: of('failing'), due_soon: of('due_soon'), missing: of('missing') };
};

describe('Needs you, on opening', () => {
  it('shows at most five lines in all, the most pressing first across its groups', () => {
    // The review's Title: 1 to decide, 11 to accept, 16 failing, 4 due soon, 28 missing. Sixty lines.
    const needs = needsOf({ decide: 1, accept: 11, failing: 16, due_soon: 4, missing: 28 });
    const shown = needLines(needs);
    assert.equal(NEEDS_SHOWN, 5);
    assert.equal(shown.length, 5);
    assert.deepEqual(shown.map((exception) => exception.need), ['decide', 'accept', 'accept', 'accept', 'accept']);
    // Failing is reached when nothing waits to be decided or accepted, and Missing last.
    assert.deepEqual(needLines(needsOf({ failing: 2, due_soon: 1, missing: 9 })).map((exception) => exception.need), ['failing', 'failing', 'due_soon', 'missing', 'missing']);
  });

  it('counts each group on a chip that narrows the card to it, and lifts the cap with one Show all', () => {
    const needs = needsOf({ decide: 1, accept: 11, failing: 16, missing: 28 });
    assert.deepEqual(needChips(needs), [{ kind: 'decide', count: 1 }, { kind: 'accept', count: 11 }, { kind: 'failing', count: 16 }, { kind: 'missing', count: 28 }]);
    const failing = needLines(needs, { only: 'failing' });
    assert.equal(failing.length, 5);
    assert.ok(failing.every((exception) => exception.need === 'failing'));
    assert.equal(needLines(needs, { only: 'failing', all: true }).length, 16);
    assert.equal(needLines(needs, { all: true }).length, 56);
  });

  it('says where a line sits once: never the sheet’s name under a line that is already called it', () => {
    assert.equal(needWhere({ label: 'Variations', sheet: 'Variations · VO-08' }), 'VO-08');
    assert.equal(needWhere({ label: 'Monthly cost report', sheet: 'Monthly cost report' }), '');
    assert.equal(needWhere({ label: 'Extent held', sheet: 'Land holding' }), 'Land holding');
  });

  it('names a source by its paper and page, or by the day it was read, never by a raw date', () => {
    assert.equal(needSource({ kind: 'paper', label: 'Sale deed 2019', evidenceId: 'e1', page: 3 }), 'Sale deed 2019, p. 3');
    assert.equal(needSource({ kind: 'external', label: 'Kaveri guidance values', asOf: '2026-10-09T04:00:00.000Z' }), 'Kaveri guidance values, read 9 Oct 2026');
    assert.equal(needSource(undefined), '');
  });

  it('carries a place on the sheets in an address and reads it back', () => {
    assert.equal(sheetItem({ set: HOLDING, field: 'extent' }), `${HOLDING}::::extent`);
    assert.deepEqual(sheetItemOf(`${HOLDING}::::extent`), { set: HOLDING, field: 'extent' });
    assert.deepEqual(sheetItemOf('legal.title.owners::rec_1::name'), { set: 'legal.title.owners', record: 'rec_1', field: 'name' });
    assert.equal(sheetItemOf(null), null);
  });
});

describe('every line of Needs you has one action that works', () => {
  it('offers Accept only where the value can be accepted on this page, and Open everywhere else', () => {
    const p = project();
    const row = deed(p);
    proposeFieldValues(p, [{ address: at('extent'), value: 5000, origin: paper(row.id) }], 'model');
    const catalog = fieldCatalogFor(p);
    const page = readFunctionFields(p, FN);
    const offered = page.needs.accept.find((exception) => exception.address?.field === 'extent')!;
    assert.deepEqual(needAction(page, offered, true, p, catalog), { kind: 'accept' });
    // Somebody who may not decide is not shown a button that would be refused: the line opens the field.
    assert.deepEqual(needAction(page, offered, false, p, catalog), { kind: 'open', target: { where: 'here', set: HOLDING, field: 'extent' } });
  });

  it('never offers Accept on a field that only reads another: the line opens the check that holds the value', () => {
    const p = project();
    const page = readFunctionFields(p, FN);
    const catalog = fieldCatalogFor(p);
    const mirror = page.sheets.flatMap((sheet) => (sheet.reading ? sheet.reading.fields : [])).find((view) => view.def.sameAs && catalog.checks.has(view.def.sameAs.set))!;
    assert.ok(mirror, 'Title reads a figure off a check');
    // A value offered to the check shows on the field that reads it. Accepting it there is refused by the server ("worked out, and nobody decides it").
    const offered: FieldException = { kind: 'proposed', need: 'accept', key: 'k', sheet: 'Land holding', address: mirror.address, label: mirror.def.label, text: '6,070 sqm' };
    const action = needAction(page, offered, true, p, catalog);
    assert.equal(action.kind, 'open');
    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => ({ ddId: a.id, scopeId: s.id, checkId: c.id, definitionId: c.definitionId })))).find((c) => c.definitionId === mirror.def.sameAs!.set)!;
    assert.deepEqual(action, { kind: 'open', target: { where: 'check', ddId: check.ddId, scopeId: check.scopeId, checkId: check.checkId, field: mirror.def.sameAs!.field } }, 'and names the field, so the check’s screen brings it into view');
  });

  it('accepts a value held on a check from the line drawn beside the field that reads it, opens the cause of a line another function’s record makes, and opens a record a paper offered as the record', () => {
    const p = project();
    const page = readFunctionFields(p, FN);
    const catalog = fieldCatalogFor(p);
    const mirror = page.sheets.flatMap((sheet) => (sheet.reading ? sheet.reading.fields : [])).find((view) => view.def.sameAs && catalog.checks.has(view.def.sameAs.set))!;
    const held = { ...mirror.def.sameAs!, fn: FN };
    // As the engine lists it: the address is the check's own field, and `shownAt` the field that reads it.
    const beside: FieldException = { kind: 'proposed', need: 'accept', key: 'k', sheet: 'Land holding', address: held, shownAt: mirror.address, label: mirror.def.label, text: '6,070 sqm' };
    assert.deepEqual(needAction(page, beside, true, p, catalog), { kind: 'accept' });
    assert.deepEqual(needAction(page, beside, false, p, catalog), { kind: 'open', target: { where: 'here', set: mirror.address.set, field: mirror.address.field } }, 'somebody who may not decide there opens the field it is drawn at');

    const caused: FieldException = { kind: 'rule', need: 'failing', key: 'r', sheet: 'Contract terms', label: 'Contract terms', text: 'No security is held.', target: { fn: 'procurement.vendors', set: 'procurement.vendors.securities', record: 'rec_1', field: '' } };
    assert.deepEqual(needAction(page, caused, true, p, catalog), { kind: 'open', target: { where: 'function', fn: 'procurement.vendors', set: 'procurement.vendors.securities', record: 'rec_1', field: '' } });

    const whole: FieldException = { kind: 'proposed', need: 'accept', key: 'o', sheet: 'Owners', record: 'rec_2', address: { fn: FN, set: 'legal.title.owners', record: 'rec_2', field: RECORD_AS_OFFERED }, label: 'New owner', text: 'Name Lakeside Homes LLP' };
    assert.deepEqual(needAction(page, whole, false, p, catalog), { kind: 'open', target: { where: 'here', set: 'legal.title.owners', record: 'rec_2' } }, 'the record, and no field called "record as offered"');
  });

  it('marks a line that rests on a rule nobody checked, on a usual value or on words not found on the page', () => {
    const p = project();
    const page = readFunctionFields(p, FN);
    const rule: FieldException = { kind: 'rule', need: 'failing', key: 'r', sheet: 'Owners', label: 'Owners', text: 'A share is short.', ruleUnchecked: true, assumes: ['Discount rate'], cites: [{ key: 'k', label: 'Consent share', value: 66.67, from: '2017-05-01', source: { regulation: 'An invented circular' }, verified: false }] };
    assert.equal(needRuleUnchecked(page, rule), true);
    assert.equal(needRuleRows(page, rule), 'Consent share, from 1 May 2017');
    assert.deepEqual(needAssumes(page, rule), ['Discount rate']);
    assert.equal(needUnverified({ kind: 'proposed', need: 'accept', key: 'p', sheet: 'Owners', label: 'Name', text: 'A. Rao', source: { kind: 'paper', label: 'Sale deed', proof: 'unverified' } }), true);
    assert.equal(needUnverified({ kind: 'proposed', need: 'accept', key: 'p', sheet: 'Owners', label: 'Name', text: 'A. Rao', source: { kind: 'paper', label: 'Sale deed', proof: 'page_text' } }), false);
  });

  it('opens a failing, a missing and a sheet-level line where it sits', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { tenure: 'freehold' }, LEAD);
    const page = readFunctionFields(p, FN);
    const catalog = fieldCatalogFor(p);
    const missing = page.needs.missing[0]!;
    assert.deepEqual(needAction(page, missing, true, p, catalog), { kind: 'open', target: { where: 'here', set: missing.address!.set, field: missing.address!.field } });
    // A rule's line names no field: it opens its sheet, or the record it is about.
    const rule: FieldException = { kind: 'rule', need: 'failing', key: 'legal.title.owners::rec_9::rule::r1', sheet: 'Owners · A. Rao', record: 'rec_9', label: 'Owners', text: 'No heir is recorded.' };
    assert.deepEqual(needAction(page, rule, true, p, catalog), { kind: 'open', target: { where: 'here', set: 'legal.title.owners', record: 'rec_9' } });
    const situation: FieldException = { kind: 'situation', need: 'decide', key: 'situation::joint_development', sheet: '', label: 'Joint development', text: '', situation: 'joint_development' };
    assert.deepEqual(needAction(page, situation, true, p, catalog), { kind: 'situation', key: 'joint_development' });
  });
});

describe('a function’s page', () => {
  const read = (file: string) => readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');
  const page = read('pages/projects/departments/WorkstreamPage.tsx');
  const sheets = read('components/fields/FieldSheets.tsx');

  it('draws one part at a time, opening on Needs you and the sheets, with the other parts on the rail', () => {
    assert.match(page, /only=\{shownPart\}/, 'the page hands the section page the one part to draw');
    assert.match(page, /hasSheets \? 'sheet'/, 'and that part is Needs you and the sheets wherever the function keeps any');
    assert.doesNotMatch(page, /lead=\{/, 'nothing is stacked above the part in view');
    const section = read('components/workspace/SectionPage.tsx');
    assert.match(section, /only \? sections\.filter\(\(section\) => section\.id === only\) : sections/);
  });

  it('draws no quick assessment over a function that keeps sheets: a good standing may never sit above failing lines', () => {
    assert.match(page, /body: hasSheets \? \(\s*\/\/[^\n]*\n\s*<CertifiedPanel/, 'the standing part is the certified reports alone');
    assert.match(page, /\{sheets \? null : <QuickAssessmentCard/, 'and so is the frame of a function with a layout of its own');
  });

  it('folds every sheet and every list of records to one line, and never prints a shared record in full', () => {
    assert.doesNotMatch(sheets, /sheetsInPlay <= 1 \|\|/, 'a function with one sheet does not open on its form');
    assert.match(sheets, /open=\{unfolded\.has\(shared\.set\.id\)\}/, 'a shared record is a count until it is opened');
    assert.doesNotMatch(sheets, /<Badge tone="critical">failing<\/Badge>/, 'no chip repeats the group a line is under');
  });
});

describe('a chat proposal waiting for a person', () => {
  const entry = (over: Partial<WaitingEntry>): WaitingEntry => ({ kind: 'update_project', pane: 'overview', count: 1, title: 'Set the address', proposalId: 'p1', ...over }) as WaitingEntry;
  const sameTab = (a: string, b: string) => a === b || (a === 'workstream' && b === 'overview');

  it('is drawn only on the function it concerns', () => {
    const address = entry({});
    const title = entry({ pane: 'workstream', fn: 'legal.title', proposalId: 'p2', extra: { workstream: 'legal.title' } });
    const entries = [address, title];
    // The address of the project is no function's: it was drawn above every function's page.
    assert.deepEqual(waitingOnPane(entries, { pane: 'workstream', workstream: 'procurement.orders', sameTab }), []);
    assert.deepEqual(waitingOnPane(entries, { pane: 'workstream', workstream: 'legal.title', sameTab }), [title]);
    // Overview is the one page that is every function's: it still lists them all.
    assert.deepEqual(waitingOnPane(entries, { pane: 'overview', sameTab }), [address, title]);
  });

  it('shows the paper it rests on, and never the reason a model gave', () => {
    const card = readFileSync(new URL('../apps/web/src/pages/projects/cockpit/Waiting.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(card, /\{item\.rationale\}/);
    assert.doesNotMatch(card, /\{item\.impact\}/);
    assert.match(card, /item\.citedEvidenceIds/);
  });
});

describe('one way to write each kind of figure', () => {
  const def = (over: Partial<CheckFieldDef>): CheckFieldDef => ({ key: 'k', label: 'K', kind: 'text', ...over }) as CheckFieldDef;
  const held = (value: unknown) => ({ value, at: '', by: 'tester' }) as never;

  it('writes a day as 13 Oct 2026, whatever it was kept as', () => {
    assert.equal(daySaid('2026-10-13'), '13 Oct 2026');
    assert.equal(daySaid('2026-10-09'), '9 Oct 2026');
    assert.equal(daySaid('2026-10-13T08:00:00.000Z'), '13 Oct 2026');
    // A moment late in the evening abroad is the next day in India, where the work is.
    assert.equal(daySaid('2026-10-13T20:00:00.000Z'), '14 Oct 2026');
    assert.equal(daySaid(''), '');
    assert.equal(daySaid('not a date'), 'not a date');
    assert.equal(date('2026-10-09'), '9 Oct 2026');
    assert.equal(formatFieldValue(def({ kind: 'date' }), held('2026-10-09')), '9 Oct 2026');
    assert.equal(formatFieldValue(def({ kind: 'computed', yields: 'date' }), held('2027-05-31')), '31 May 2027');
  });

  it('writes rupees in lakh and crore from one formatter, on a field and on a page', () => {
    assert.equal(formatFieldValue(def({ kind: 'money' }), held(220000000)), '₹22 Cr');
    assert.equal(formatFieldValue(def({ kind: 'money', currency: 'INR' }), held(1215000)), '₹12.15 lakh');
    assert.equal(money(220000000, 'INR'), '₹22 Cr');
    assert.equal(money(1215000, 'INR'), '₹12.15 lakh');
    assert.equal(readingSaid('1215000 INR'), '₹12.15 lakh');
    assert.equal(readingSaid('Rs. 6,40,00,000'), '₹6.4 Cr');
  });

  it('writes a share with at most two decimals and its sign against it', () => {
    assert.equal(percentSaid(45.2381), '45.24%');
    assert.equal(percentSaid(30), '30%');
    assert.equal(formatFieldValue(def({ kind: 'percent' }), held(66.6667)), '66.67%');
    assert.equal(formatFieldValue(def({ kind: 'computed', unit: '%' }), held(45.24)), '45.24%');
    assert.equal(pct(45.238, 2), '45.24%');
    assert.equal(readingSaid('45.24 %'), '45.24%');
  });

  it('never prints an area bare, a raw date off a paper, or a count with “(s)”', () => {
    assert.equal(formatFieldValue(def({ kind: 'area' }), held(6070)), '6,070 sqm');
    assert.equal(readingSaid('6070 sqm'), '6,070 sqm');
    assert.equal(readingSaid('2026-10-09'), '9 Oct 2026');
    assert.equal(readingSaid('Mysuru West'), 'Mysuru West');
    assert.equal(countSaid(1, 'link'), '1 link');
    assert.equal(countSaid(3, 'order'), '3 orders');
    assert.equal(formatFieldValue(def({ kind: 'table', columns: [] }), held([{}])), '1 row');
    assert.equal(formatFieldValue(def({ kind: 'evidence' }), held(['e1', 'e2'])), '2 papers');
  });

  it('makes a rule’s count and its noun agree', () => {
    assert.equal(agreeSaid('1 deed(s) were signed by an attorney after the principal had died.'), '1 deed was signed by an attorney after the principal had died.');
    assert.equal(agreeSaid('3 deed(s) were signed by an attorney after the principal had died.'), '3 deeds were signed by an attorney after the principal had died.');
    assert.equal(agreeSaid('Counsel calls a loss probable in 2 matter(s).'), 'Counsel calls a loss probable in 2 matters.');
    assert.equal(agreeSaid('1 restoration proceeding(s) are pending.'), '1 restoration proceeding is pending.');
    assert.equal(agreeSaid('Nothing to settle here.'), 'Nothing to settle here.');
    // No sentence a rule can say still carries "(s)" once its figure is in.
    for (const set of FIELD_SETS) {
      for (const rule of [...set.rules, ...set.fields.flatMap((field) => (field.cases ?? []).map((option) => option.when))]) {
        const said = agreeSaid((rule.say ?? '').replace(/\{\w+\}/g, '1'));
        assert.doesNotMatch(said, /\(s\)/, `${set.id}: ${rule.say}`);
      }
    }
  });

  it('does not print the local operator’s machine address as a person', () => {
    assert.equal(person('operator@localhost'), 'the local operator');
    assert.equal(person('asha@firm.example'), 'asha@firm.example');
  });
});

describe('a report’s summary line', () => {
  const report = (kinds: string[], status: GeneratedReport['status'] = 'draft') => ({ status, body: { summary: '0 open findings, 0 material · 0 open risks · 113 evidence gaps.', blocks: kinds.map((kind, n) => ({ id: `b${n}`, heading: kind, source: { kind } })) } }) as unknown as GeneratedReport;

  it('is not drawn on a report that prints fields: “0 open findings” may not sit above what the sheets say', () => {
    const p = project();
    assert.equal(reportSummary(p, report(['fields', 'findings'])), '');
    assert.equal(reportSummary(p, report(['fields'], 'issued')), '');
    assert.match(reportSummary(p, report(['findings'])), /open finding/);
    assert.equal(reportSummary(p, report(['findings'], 'issued')), '0 open findings, 0 material · 0 open risks · 113 evidence gaps.');
  });
});

describe('papers dropped and still being read', () => {
  const file = (fileName: string, uploadedAt: string) => ({ id: fileName, fileName, mimeType: 'application/pdf', sizeBytes: 1, storageKey: fileName, uploadedAt, uploadedBy: 'tester' }) as never;
  const row = (id: string, title: string, fileName: string, uploadedAt: string, facts = 0) => ({ id, title, attachments: [file(fileName, uploadedAt)], facts: Array.from({ length: facts }, () => ({})) as never });
  const remembered = { at: '2026-10-13T06:00:00.000Z', names: ['jda.pdf', 'sale-deed.pdf', 'ec.pdf'] };

  it('are found on the project as each lands, after a reload', () => {
    const now = new Date('2026-10-13T06:03:00.000Z');
    const evidence = [row('e0', 'An older deed', 'sale-deed.pdf', '2026-09-01T00:00:00.000Z'), row('e1', 'Joint development agreement', 'jda.pdf', '2026-10-13T06:01:00.000Z', 4)];
    const progress = readingProgress(remembered, evidence, now);
    assert.deepEqual(progress.landed, [{ name: 'jda.pdf', evidenceId: 'e1', title: 'Joint development agreement', facts: 4 }]);
    // A paper of the same name filed before the drop is not this drop's.
    assert.deepEqual(progress.reading, ['sale-deed.pdf', 'ec.pdf']);
    assert.equal(progress.done, false);
    assert.equal(progress.stale, false);
    const later = readingProgress(remembered, [...evidence, row('e2', 'Sale deed', 'sale-deed.pdf', '2026-10-13T06:04:00.000Z'), row('e3', 'Encumbrance certificate', 'ec.pdf', '2026-10-13T06:05:00.000Z')], now);
    assert.equal(later.done, true);
    assert.equal(later.landed.length, 3);
  });

  it('are no longer waited for once too long has passed', () => {
    assert.equal(readingProgress(remembered, [], new Date('2026-10-13T07:00:00.000Z')).stale, true);
  });
});
