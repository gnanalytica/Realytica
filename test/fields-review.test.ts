/**
 * The field engine held to what three reviews found it did not do
 * (docs/fields.md, "The rules a field set lives under").
 *
 * - A value somebody offered changes nothing while it waits: not a usual
 *   value standing in, not a record's name, not the graph, not a Missing line.
 * - A value accepted from a paper is not typed away, cleared away or typed
 *   over with itself, and a dispute is settled by a person who may decide.
 * - A model's proposal says nothing of itself that is kept: who read it and
 *   whether its words are on the page are found by the server.
 * - A field that is not in play feeds nothing; a record taken off its list
 *   is read by nothing.
 * - A standing is not drawn over a figure that could not be worked out, nor
 *   over a sum of nothing entered.
 * - "Today" is the day in India.
 * - What is typed is read strictly: a blank is no zero, a percentage stops
 *   at 100, the calendar has no 31 February, and an amount prints one way.
 *
 * Every project, person and paper here is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  NA_REASONS,
  acceptAllFromPaper,
  addEvidence,
  addFieldRecord,
  buildFieldCatalog,
  catalogFaults,
  catalogLimits,
  checkInsights,
  createAssessment,
  createProject,
  decideField,
  decidesIn,
  departmentRole,
  fieldPrinted,
  fieldState,
  formatFieldValue,
  formatMoney,
  parseMeasure,
  proposeFieldValues,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  refChoices,
  removeFieldRecord,
  resolveFields,
  roleCanEdit,
  rupeesSaid,
  setFieldValues,
  setSituation,
  setTeamMember,
  snoozeNeed,
  standingFieldLines,
  validateFieldValue,
  type CheckFieldDef,
  type DdProject,
  type FieldAddress,
  type FieldOrigin,
  type FieldSet,
  type RuleRow,
} from '@realytica/shared';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const OWNERS = 'legal.title.owners';
const PARCEL = 'land_site.parcel_identification';
const LEAD = 'lead@firm.example';
const JUNIOR = 'junior@firm.example';

function project(): DdProject {
  const p = createProject({ name: 'Kere Road plot', type: 'residential', location: 'Kere Road', city: 'Bengaluru' }, 'RYT-FRV');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead', finance: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { legal: 'contributor' } }, 'owner');
  return p;
}

const seat = (p: DdProject, email: string) => ({ mayDecide: decidesIn(p, { email }), mayEdit: (department: Parameters<typeof departmentRole>[2]) => roleCanEdit(departmentRole(p, { email }, department)) });
const checkOf = (p: DdProject, definitionId: string) => p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;

function deed(p: DdProject, title = 'Sale deed 2019') {
  const row = addEvidence(p, { title, kind: 'document' });
  row.documentType = 'Sale deed';
  row.attachments = [{ id: `f-${row.id}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k-${row.id}`, uploadedAt: '2026-10-01T00:00:00.000Z', uploadedBy: 'tester' } as never];
  row.facts = [];
  return row;
}

const at = (field: string, set = HOLDING, record?: string): FieldAddress => ({ fn: FN, set, field, ...(record ? { record } : {}) });
const read = (evidenceId: string, quote = 'measuring 1 acre 22 guntas'): FieldOrigin => ({ kind: 'paper', evidenceId, page: 3, quote, reader: 'parser' });
const stored = (p: DdProject, key: string, set = HOLDING) => p.fieldSheets![set]!.values[key]!;

/* A sheet of the test's own, so each rule is shown on fields that do nothing else. */
const Z = 'legal.title.zz';
const ZR = 'legal.title.zz_things';
const num = (value: number) => ({ op: 'const' as const, value });
const fld = (key: string) => ({ op: 'field' as const, key });
const OWN: FieldSet[] = [
  {
    id: Z,
    fn: FN,
    title: 'Deal',
    v: 1,
    situations: [
      { key: 'zz_shared', label: 'Shared with an owner', scope: 'function' },
      { key: 'zz_share_known', label: 'Share known', scope: 'function', derive: { field: { fn: FN, set: Z, field: 'owner_share' }, is: 'set' } },
    ],
    fields: [
      { key: 'gross', label: 'Gross', kind: 'money', currency: 'INR', required: false },
      { key: 'owner_share', label: 'Owner share', kind: 'percent', tier: 'situational', showWhen: { situation: 'zz_shared' }, required: false },
      { key: 'rate', label: 'Discount rate', kind: 'percent', required: false, defaults: [{ value: 12, from: 'firm' }] },
      { key: 'net', label: 'Net to the developer', kind: 'computed', formula: { op: 'multiply', left: fld('gross'), right: { op: 'subtract', left: num(1), right: { op: 'divide', left: fld('owner_share'), right: num(100) } } } },
      { key: 'discounted', label: 'Discounted', kind: 'computed', formula: { op: 'divide', left: fld('gross'), right: { op: 'add', left: num(1), right: { op: 'divide', left: fld('rate'), right: num(100) } } } },
      { key: 'share_standing', label: 'Share', kind: 'status', cases: [{ when: { kind: 'at_most', fields: ['owner_share'], against: 40, say: 'The owner’s share is {a}.', severity: 'high' }, label: 'Owner share too high', tone: 'critical' }], otherwise: { label: 'In order', tone: 'good' } },
      { key: 'extra', label: 'Asked once the share is known', kind: 'text', tier: 'situational', showWhen: { situation: 'zz_share_known' } },
      { key: 'plot', label: 'Plot area', kind: 'number', unit: 'sqm', required: false },
      { key: 'built', label: 'Built-up area', kind: 'number', unit: 'sqm', required: false },
      { key: 'far_allowed', label: 'FAR allowed', kind: 'number', required: false },
      { key: 'far_proposed', label: 'FAR proposed', kind: 'computed', formula: { op: 'divide', left: fld('built'), right: fld('plot') } },
      { key: 'far_standing', label: 'FAR', kind: 'status', cases: [{ when: { kind: 'at_most', fields: ['far_proposed', 'far_allowed'], say: 'FAR proposed is {a} and {b} is allowed.', severity: 'high' }, label: 'Over the FAR allowed', tone: 'critical' }], otherwise: { label: 'Within the FAR allowed', tone: 'good' } },
      { key: 'minimum', label: 'Minimum the lender asks', kind: 'percent', required: false },
      { key: 'paid_in', label: 'Paid in', kind: 'computed', formula: { op: 'records', set: ZR, reduce: 'sum', field: 'amount' } },
      { key: 'paid_share', label: 'Paid in, of the gross', kind: 'computed', unit: '%', formula: { op: 'multiply', left: { op: 'divide', left: fld('paid_in'), right: fld('gross') }, right: num(100) } },
      { key: 'paid_standing', label: 'Paid in', kind: 'status', cases: [{ when: { kind: 'at_least', fields: ['paid_share', 'minimum'], say: '{a} is paid in and {b} is asked.', severity: 'high' }, label: 'Short of the minimum', tone: 'critical' }], otherwise: { label: 'In step', tone: 'good' } },
      { key: 'cap', label: 'Cap from the table', kind: 'computed', formula: { op: 'rate', table: 'zz_cap' } },
      { key: 'thing', label: 'The thing', kind: 'ref', target: { set: ZR }, required: false },
    ],
    rules: [
      { kind: 'at_least', fields: ['paid_share', 'minimum'], say: '{a} is paid in and {b} is asked.', severity: 'high' },
      { kind: 'at_most', fields: ['owner_share', 'cap'], say: 'The owner’s share is {a}; {b} at most.', severity: 'high' },
    ],
  },
  {
    id: ZR,
    fn: FN,
    title: 'Things',
    v: 1,
    records: { of: 'thing', titleField: 'name', summaryFields: [] },
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money', currency: 'INR', required: false },
      { key: 'living', label: 'Living', kind: 'boolean', required: false, defaults: [{ value: true, from: 'firm' }] },
    ],
    rules: [],
  },
];
const CATALOG = buildFieldCatalog([...FIELD_SETS, ...OWN]);
const ROWS: RuleRow[] = [{ key: 'zz_cap', label: 'Cap on the owner’s share', jurisdiction: {}, value: 40, unit: '%', from: '2020-01-01', source: { regulation: 'An invented circular' }, verified: false }];
const zz = (field: string, record?: string): FieldAddress => ({ fn: FN, set: record ? ZR : Z, field, ...(record ? { record } : {}) });
const sheet = (p: DdProject, at: Date = new Date()) => {
  const reading = readSheet(p, Z, undefined, resolveFields(p, at, CATALOG, ROWS), CATALOG, at)!;
  return { reading, view: (key: string) => reading.fields.find((f) => f.def.key === key)!, value: (key: string) => reading.fields.find((f) => f.def.key === key)!.held?.value ?? null };
};
const write = (p: DdProject, values: Record<string, unknown>, by = LEAD) => assert.deepEqual(setFieldValues(p, { set: Z }, values, by, seat(p, by), CATALOG).rejected, []);

describe('a value that waits changes nothing', () => {
  it('leaves a usual value standing in behind it, so what is worked out does not move until a person accepts', () => {
    const p = project();
    write(p, { gross: '112 lakh' });
    assert.equal(sheet(p).value('discounted'), 10_000_000, 'at the usual 12%');
    assert.deepEqual(proposeFieldValues(p, [{ address: zz('rate'), value: 14, origin: { kind: 'external', source: 'A named index', asOf: '2026-10-01' } }], 'model', CATALOG).map((o) => o.outcome), ['waiting']);
    const waiting = sheet(p);
    assert.equal(waiting.value('discounted'), 10_000_000, 'the offer has not switched the usual value off');
    assert.equal(waiting.view('rate').state, 'proposed', 'and the page shows the offer, to be accepted');
    decideField(p, zz('rate'), 'accept', LEAD, {}, seat(p, LEAD), CATALOG);
    assert.equal(sheet(p).value('discounted'), 9_824_561.4, 'accepted, it is the rate');
  });

  it('gives a record no name, no place in the graph, no link to it and no Missing line until one of its values is accepted', () => {
    const p = project();
    const row = deed(p);
    const [offer] = proposeFieldValues(p, [{ address: { fn: FN, set: ZR, field: 'name' }, value: 'A name off a paper', origin: read(row.id, 'A name off a paper') }], 'model', CATALOG);
    const made = offer!.address.record!;
    const reading = readSheet(p, ZR, made, undefined, CATALOG)!;
    assert.equal(reading.pending, true);
    assert.equal(reading.title, 'New thing', 'a name somebody offered is not its name');
    assert.deepEqual(reading.fields.filter((f) => f.missing).map((f) => f.def.key), []);
    assert.deepEqual(refChoices(p, { set: ZR }, CATALOG), [], 'nothing links to it');
    assert.match(setFieldValues(p, { set: Z }, { thing: made }, LEAD, seat(p, LEAD), CATALOG).rejected[0]!.error, /not on this project/);
    assert.deepEqual(standingFieldLines(p, new Date(), CATALOG).filter((line) => line.address.set === ZR), [], 'not its usual value, and not the name offered');
    const page = readFunctionFields(p, FN, new Date(), CATALOG);
    assert.deepEqual(page.exceptions.filter((e) => e.record === made).map((e) => e.need), ['accept'], 'what was offered is still there to accept, and nothing else is asked');

    // A person types another field of it while the name still waits: it is a record now, and still not called by the name offered.
    assert.deepEqual(setFieldValues(p, { set: ZR, record: made }, { amount: '5 lakh' }, JUNIOR, seat(p, JUNIOR), CATALOG).rejected, []);
    const lines = standingFieldLines(p, new Date(), CATALOG).filter((line) => line.address.set === ZR);
    assert.ok(lines.length > 0 && lines.every((line) => line.where === 'Things · New thing'), JSON.stringify(lines.map((line) => line.where)));
    decideField(p, { fn: FN, set: ZR, field: 'name', record: made }, 'accept', LEAD, {}, seat(p, LEAD), CATALOG);
    assert.equal(readSheet(p, ZR, made, undefined, CATALOG)!.title, 'A name off a paper');
    assert.deepEqual(refChoices(p, { set: ZR }, CATALOG).map((choice) => choice.id), [made]);
  });
});

describe('a value accepted from a paper', () => {
  const accepted = () => {
    const p = project();
    const row = deed(p);
    proposeFieldValues(p, [{ address: at('extent'), value: '1 acre 22 guntas', origin: read(row.id) }], 'parser');
    decideField(p, at('extent'), 'accept', LEAD, {}, seat(p, LEAD));
    return { p, row };
  };

  it('is not typed away: a second figure typed while two are disputed is a third beside them', () => {
    const { p, row } = accepted();
    setFieldValues(p, { set: HOLDING }, { extent: '5000 sqm' }, JUNIOR, seat(p, JUNIOR));
    assert.equal(fieldState(stored(p, 'extent')), 'disputed');
    setFieldValues(p, { set: HOLDING }, { extent: '4000 sqm' }, JUNIOR, seat(p, JUNIOR));
    const held = stored(p, 'extent');
    assert.equal(fieldState(held), 'disputed', 'typing again settles nothing');
    assert.equal(held.sourceEvidenceId, row.id, 'the deed’s value, page and words are still the field’s');
    assert.deepEqual(held.other!.map((other) => other.value), [5000, 4000]);
    assert.equal(resolveFields(p).read(at('extent')), undefined, 'and nothing stands until a lead keeps one');
    decideField(p, at('extent'), 'keep', LEAD, {}, seat(p, LEAD));
    assert.equal(resolveFields(p).read(at('extent'))?.value, 6272.6275);
  });

  it('is not cleared by somebody who may not decide, and is kept among what was set aside when a lead clears it', () => {
    const { p } = accepted();
    assert.match(setFieldValues(p, { set: HOLDING }, { extent: '' }, JUNIOR, seat(p, JUNIOR)).rejected[0]!.error, /lead or signer clears it/);
    assert.equal(fieldState(stored(p, 'extent')), 'accepted');
    setFieldValues(p, { set: HOLDING }, { extent: '5000 sqm' }, JUNIOR, seat(p, JUNIOR));
    assert.match(setFieldValues(p, { set: HOLDING }, { extent: '' }, LEAD, seat(p, LEAD)).rejected[0]!.error, /in dispute/, 'a dispute is settled, never cleared');
    decideField(p, at('extent'), 'keep', LEAD, {}, seat(p, LEAD));
    assert.deepEqual(setFieldValues(p, { set: HOLDING }, { extent: '' }, LEAD, seat(p, LEAD)).rejected, []);
    assert.ok(stored(p, 'extent').declined!.some((declined) => declined.value === 6272.6275), 'nothing is thrown away');
  });

  it('keeps its source when the same figure is typed over it', () => {
    const { p, row } = accepted();
    setFieldValues(p, { set: HOLDING }, { extent: '6272.6275 sqm' }, JUNIOR, seat(p, JUNIOR));
    const held = stored(p, 'extent');
    assert.deepEqual([fieldState(held), held.origin?.kind, held.sourceEvidenceId, held.page], ['accepted', 'paper', row.id, 3]);
  });

  it('comes back as it was when a field marked not applicable is asked again, with what waited beside it', () => {
    const { p, row } = accepted();
    const second = deed(p, 'Mother deed 2004');
    proposeFieldValues(p, [{ address: at('extent'), value: '6000 sqm', origin: read(second.id, 'measuring 6000 square metres') }], 'parser');
    decideField(p, at('extent'), 'not_applicable', LEAD, { reason: NA_REASONS[0] }, seat(p, LEAD));
    assert.equal(fieldState(stored(p, 'extent')), 'not_applicable');
    decideField(p, at('extent'), 'reopen', LEAD, {}, seat(p, LEAD));
    const held = stored(p, 'extent');
    assert.deepEqual([fieldState(held), held.value, held.sourceEvidenceId], ['accepted', 6272.6275, row.id]);
    assert.deepEqual(held.other!.map((other) => other.value), [6000], 'the other paper’s figure still waits');
    assert.deepEqual(proposeFieldValues(p, [{ address: at('extent'), value: '1 acre 22 guntas', origin: read(row.id) }], 'parser').map((o) => o.outcome), ['held'], 'and its own paper is not told it was set aside');
  });
});

describe('what a model says of its own proposal', () => {
  it('is not kept: who read it is the proposer, and its words are unverified until the server finds them on the page', () => {
    const p = project();
    const row = deed(p);
    const sent = { kind: 'paper', evidenceId: row.id, page: 1, quote: 'absolute owner in fee simple', reader: 'parser', proof: 'page_text', extra: 'x' } as unknown as FieldOrigin;
    proposeFieldValues(p, [{ address: at('tenure'), value: 'freehold', origin: sent }, { address: at('possession_verified'), value: true, origin: { kind: 'paper', evidenceId: row.id, page: 3, quote: 'vacant possession delivered' } as unknown as FieldOrigin }], 'model');
    assert.deepEqual(stored(p, 'tenure').origin, { kind: 'paper', evidenceId: row.id, page: 1, quote: 'absolute owner in fee simple', reader: 'model', proof: 'unverified' });
    const accept = readFunctionFields(p, FN).needs.accept;
    assert.deepEqual(accept.map((line) => [line.address!.field, line.oneAtATime, line.source?.reader, line.source?.proof]), [['tenure', true, 'model', 'unverified'], ['possession_verified', true, 'model', 'unverified']]);
    assert.deepEqual(acceptAllFromPaper(p, FN, row.id, LEAD, seat(p, LEAD)).accepted, [], '"accept all" takes neither');
    assert.equal(fieldState(stored(p, 'possession_verified')), 'proposed');
  });

  it('is proven by the page where the words are found there, on the page that holds them', () => {
    const p = project();
    const row = deed(p);
    const looked: Array<[string, number, string]> = [];
    proposeFieldValues(p, [{ address: at('tenure'), value: 'freehold', origin: { kind: 'paper', evidenceId: row.id, page: 1, quote: 'absolute owner in fee simple' } as unknown as FieldOrigin }], 'model', undefined, { placed: (evidenceId, page, quote) => (looked.push([evidenceId, page, quote]), 4) });
    assert.deepEqual(looked, [[row.id, 1, 'absolute owner in fee simple']]);
    const origin = stored(p, 'tenure').origin as Extract<FieldOrigin, { kind: 'paper' }>;
    assert.deepEqual([origin.page, origin.proof, origin.reader], [4, 'page_text', 'model'], 'the page that holds the words, whichever was named');
    assert.equal(readFunctionFields(p, FN).needs.accept[0]!.oneAtATime, false);
  });

  it('is cut to its bounds, refused where it is no source, and keeps a link only as https', () => {
    const p = project();
    const row = deed(p);
    const external = (more: Record<string, unknown>) => ({ kind: 'external', source: 'A registry', asOf: '2026-10-01', ...more }) as unknown as FieldOrigin;
    const out = proposeFieldValues(
      p,
      [
        { address: at('tenure'), value: 'freehold', origin: { kind: 'paper', evidenceId: row.id, page: '3', quote: 12 } as unknown as FieldOrigin },
        { address: at('tenure'), value: 'freehold', origin: external({ asOf: '2026-02-31' }) },
        { address: at('tenure'), value: 'freehold', origin: external({ source: `Registry ${'x'.repeat(7000)}`, url: 'javascript:alert(1)', note: 'kept nowhere' }) },
      ],
      'model',
    );
    assert.deepEqual(out.map((o) => o.outcome), ['refused', 'refused', 'waiting'], 'a quote that is not words is refused, not thrown on; so is a day the calendar does not have');
    const origin = stored(p, 'tenure').origin as Extract<FieldOrigin, { kind: 'external' }>;
    assert.deepEqual(Object.keys(origin).sort(), ['asOf', 'kind', 'source']);
    assert.equal(origin.source.length, 120);
    decideField(p, at('tenure'), 'set_aside', LEAD, {}, seat(p, LEAD));
    proposeFieldValues(p, [{ address: at('tenure'), value: 'leasehold', origin: external({ url: 'https://registry.example/entry/41' }) }], 'model');
    assert.equal((stored(p, 'tenure').origin as Extract<FieldOrigin, { kind: 'external' }>).url, 'https://registry.example/entry/41');
    assert.match(proposeFieldValues(p, [{ address: at('name', OWNERS), value: `A. Owner\n${'and more '.repeat(60)}`, origin: external({}) }], 'model')[0]!.error ?? '', /one line of 300 characters at most/, 'a one-line field takes a value, never a passage');
  });
});

describe('a field that is not in play', () => {
  it('feeds no formula, no standing and no situation, and reads again the moment it is back', () => {
    const p = project();
    setSituation(p, FN, 'zz_shared', true, LEAD, seat(p, LEAD), CATALOG);
    write(p, { gross: '10 Cr', owner_share: 45 });
    const on = sheet(p);
    assert.deepEqual([on.value('net'), on.value('share_standing'), on.view('extra').shown], [55_000_000, 'Owner share too high', 'shown']);

    setSituation(p, FN, 'zz_shared', false, LEAD, seat(p, LEAD), CATALOG);
    const off = sheet(p);
    assert.equal(off.view('owner_share').shown, 'hidden');
    assert.equal(off.view('owner_share').notInPlay, true, 'what it holds is kept, and shown as not asked for now');
    assert.deepEqual([off.value('net'), off.value('share_standing'), off.view('extra').shown], [null, null, 'hidden'], 'and nothing is worked out from it');
    const page = readFunctionFields(p, FN, new Date(), CATALOG);
    assert.deepEqual(page.exceptions.filter((e) => e.sheet === 'Deal').map((e) => e.label), []);

    setSituation(p, FN, 'zz_shared', true, LEAD, seat(p, LEAD), CATALOG);
    assert.equal(sheet(p).value('net'), 55_000_000);
  });
});

describe('a record taken off its list', () => {
  it('is read by nothing, and a link to it says so under Failing', () => {
    const p = project();
    const { record } = addFieldRecord(p, ZR, { name: 'Shed', amount: '5 lakh' }, LEAD, seat(p, LEAD), CATALOG);
    write(p, { gross: '1 Cr', thing: record!.id });
    assert.equal(sheet(p).value('paid_in'), 500_000);
    removeFieldRecord(p, ZR, record!.id, LEAD, seat(p, LEAD), CATALOG);
    const resolution = resolveFields(p, new Date(), CATALOG);
    assert.equal(resolution.read(zz('amount', record!.id)), undefined, 'not by its address either');
    assert.deepEqual(resolution.holder(ZR, record!.id), {});
    const after = sheet(p);
    assert.equal(after.view('thing').text, 'Shed (taken off Things)', 'never its bare id');
    assert.equal(after.view('thing').removedLink, true);
    const failing = readFunctionFields(p, FN, new Date(), CATALOG).needs.failing.filter((line) => line.address?.field === 'thing');
    assert.deepEqual(failing.map((line) => line.text), ['Shed (taken off Things)']);
  });
});

describe('a standing', () => {
  it('is not read as its good "otherwise" while the figure its limit is on cannot be worked out', () => {
    const p = project();
    write(p, { far_allowed: 2.25, built: 9000 });
    assert.equal(sheet(p).value('far_proposed'), null, 'no plot area, so no FAR proposed');
    assert.equal(sheet(p).value('far_standing'), null, 'and nothing is said to be within the limit');
    write(p, { plot: 5000 });
    assert.deepEqual([sheet(p).value('far_proposed'), sheet(p).value('far_standing')], [1.8, 'Within the FAR allowed']);
    write(p, { built: 12000 });
    assert.equal(sheet(p).value('far_standing'), 'Over the FAR allowed');
  });

  it('and a rule are silent over a sum of nothing entered, and speak once something is', () => {
    const p = project();
    write(p, { gross: '1 Cr', minimum: 30 });
    const empty = sheet(p);
    assert.deepEqual([empty.value('paid_in'), empty.value('paid_share')], [0, 0], 'the arithmetic still gives nought');
    assert.equal(empty.view('paid_share').held?.overNothing, true);
    assert.equal(empty.value('paid_standing'), null, 'neither "short" nor "in step" is true of nothing entered');
    assert.deepEqual(empty.reading.insights, []);
    assert.deepEqual(readFunctionFields(p, FN, new Date(), CATALOG).needs.failing.filter((line) => line.sheet === 'Deal'), []);

    addFieldRecord(p, ZR, { name: 'First tranche', amount: '10 lakh' }, LEAD, seat(p, LEAD), CATALOG);
    const some = sheet(p);
    assert.deepEqual([some.value('paid_share'), some.value('paid_standing')], [10, 'Short of the minimum']);
    assert.deepEqual(some.reading.insights.map((insight) => insight.text), ['10% is paid in and 30% is asked.']);
  });

  it('carries "rule not checked" where it rests on a rule row nobody has verified, and says what was assumed', () => {
    const p = project();
    setSituation(p, FN, 'zz_shared', true, LEAD, seat(p, LEAD), CATALOG);
    write(p, { gross: '112 lakh', owner_share: 45 });
    const page = (() => {
      // The page read with the test's own rule row, as a firm's project reads its own.
      const reading = sheet(p).reading;
      return reading;
    })();
    const found = page.findings.find((one) => one.insight.text.startsWith('The owner’s share'))!;
    assert.equal(found.ruleUnchecked, true, 'the cap is a row nobody verified');
    assert.equal(sheet(p).view('cap').ruleUnchecked, true);
    assert.deepEqual(sheet(p).view('discounted').assumes, ['Discount rate'], 'a figure worked out from a usual value names it');
    const printed = fieldPrinted(p, sheet(p).view('discounted'));
    assert.equal(printed.standing, 'worked out, on an assumed value');
    assert.ok(printed.notes.includes('Rests on a usual value nobody entered: Discount rate.'));
    write(p, { rate: 12 });
    assert.equal(sheet(p).view('discounted').assumes, undefined, 'typed, it is nobody’s assumption');
    assert.equal(fieldPrinted(p, sheet(p).view('discounted')).standing, 'worked out');
  });
});

describe('today', () => {
  const early = new Date('2026-10-14T01:00:00+05:30');

  it('is the day in India: a date that ran out yesterday there has run out, and a rule row in force from today is read', () => {
    const p = project();
    setSituation(p, FN, 'agricultural_land', true, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: HOLDING }, { conversion_build_by: '2026-10-13' }, LEAD, seat(p, LEAD));
    const page = readFunctionFields(p, FN, early);
    assert.deepEqual([...page.needs.failing, ...page.needs.due_soon].filter((line) => line.key.endsWith('::runs_out')).map((line) => line.need), ['failing']);

    const rows: RuleRow[] = [
      { ...ROWS[0]!, value: 12, to: '2026-10-13' },
      { ...ROWS[0]!, value: 5, from: '2026-10-14' },
    ];
    assert.equal(resolveFields(p, early, CATALOG, rows).read(zz('cap'))?.value, 5);
    const due: FieldSet = { id: 'legal.title.zz_due', fn: FN, title: 'Due', v: 1, fields: [{ key: 'by_then', label: 'By then', kind: 'date', dueFrom: '2026-10-14' }], rules: [] };
    const catalog = buildFieldCatalog([...FIELD_SETS, due]);
    assert.equal(readSheet(p, due.id, undefined, undefined, catalog, early)!.fields[0]!.due, true);
    assert.throws(() => snoozeNeed(p, FN, 'no such line', '2026-10-14', LEAD, seat(p, LEAD), undefined, early), /Only a line under Due soon/);
  });

  it('and a row of a table runs out the day after the day it names', () => {
    const defs: CheckFieldDef[] = [{ key: 'nocs', label: 'NOCs', kind: 'table', columns: [{ key: 'noc', label: 'NOC', kind: 'text' }, { key: 'valid_to', label: 'Valid to', kind: 'date' }] }];
    const values = { nocs: { value: [{ noc: 'Fire', valid_to: '2026-10-13' }], at: '', by: 'tester' } };
    const rule = { kind: 'row_expired' as const, fields: ['nocs'], column: 'valid_to', say: '{row} ran out {days} days ago.', severity: 'high' as const };
    assert.deepEqual(checkInsights(defs, values, [rule], new Date('2026-10-13T23:00:00+05:30')), [], 'still good on its last day');
    assert.deepEqual(checkInsights(defs, values, [rule], early).map((insight) => insight.text), ['Fire ran out 1 days ago.']);
  });
});

describe('what is typed', () => {
  const figure: CheckFieldDef = { key: 'n', label: 'Figure', kind: 'number' };
  const share: CheckFieldDef = { key: 's', label: 'Share', kind: 'percent' };
  const day: CheckFieldDef = { key: 'd', label: 'Day', kind: 'date' };

  it('is no zero where it is blank, a comma or a list of nothing, and no sixteen where it is "0x10"', () => {
    assert.deepEqual(validateFieldValue(figure, ' '), { value: null });
    for (const raw of [',', [], '0x10', '1e5']) assert.ok('error' in validateFieldValue(figure, raw), JSON.stringify(raw));
    assert.deepEqual(validateFieldValue(figure, ' 4,20,000.5 '), { value: 420000.5 });
    assert.deepEqual(validateFieldValue(figure, -3), { value: -3 });
  });

  it('is a percentage up to 100 unless the field says further, and a day the calendar has', () => {
    assert.match((validateFieldValue(share, 250) as { error: string }).error, /cannot be above 100%/);
    assert.deepEqual(validateFieldValue({ ...share, max: 400 }, 250), { value: 250 });
    for (const impossible of ['2026-02-31', '2026-04-31', '2025-02-29']) assert.match((validateFieldValue(day, impossible) as { error: string }).error, /not a real date/, impossible);
    assert.deepEqual(validateFieldValue(day, '2024-02-29'), { value: '2024-02-29' });
  });

  it('is read in a unit the field allows, and "m2" is square metres', () => {
    const acres = parseMeasure('5', 'area', { enterIn: ['acre', 'gunta'] });
    assert.ok(!('error' in acres) && acres.entered.unit === 'acre' && Math.round(acres.value) === 20234, JSON.stringify(acres));
    const typed = parseMeasure(5, 'area', { enterIn: ['acre', 'gunta'] });
    assert.ok(!('error' in typed) && typed.entered.unit === 'acre');
    assert.deepEqual(parseMeasure('100 m2', 'area'), { value: 100, entered: { value: 100, unit: 'sqm' } });
    assert.deepEqual(parseMeasure('2 m3', 'volume'), { value: 2, entered: { value: 2, unit: 'cum' } });
    assert.deepEqual(parseMeasure('1 acre 22 guntas', 'area'), { value: 6272.6275, entered: { value: 1, unit: 'acre', text: '1 acre 22 guntas' } });
  });

  it('prints an amount one way: the band chosen after rounding, rupees where no currency is named, and in full where two would read the same', () => {
    assert.equal(rupeesSaid(9_999_999), 'Rs 1 Cr');
    assert.equal(rupeesSaid(99_999.999), 'Rs 1 lakh');
    assert.equal(formatMoney(12345.678, 'INR', 0), '₹12,346');
    const plain: CheckFieldDef = { key: 'm', label: 'Amount', kind: 'money' };
    assert.equal(formatFieldValue(plain, { value: 42_000_000, at: '', by: '' }), '₹4.2 Cr');
    assert.equal(formatFieldValue({ ...plain, unit: 'INR/sqm' }, { value: 45_000, at: '', by: '' }), '₹45,000/sqm', 'a rate in rupees carries the rupee sign and its measure');
    const defs: CheckFieldDef[] = [{ key: 'sources', label: 'Sources', kind: 'money', currency: 'INR' }, { key: 'need', label: 'Need', kind: 'money', currency: 'INR' }];
    const values = { sources: { value: 42_290_000, at: '', by: '' }, need: { value: 42_345_678, at: '', by: '' } };
    const [said] = checkInsights(defs, values, [{ kind: 'at_least', fields: ['sources', 'need'], say: 'Sources of {a} are planned and the appraisal needs {b}.', severity: 'high' }]);
    assert.equal(said!.text, 'Sources of ₹4,22,90,000 are planned and the appraisal needs ₹4,23,45,678.');
  });
});

describe('the catalog guard', () => {
  const base = (fields: CheckFieldDef[], more: Partial<FieldSet> = {}): FieldSet => ({ id: 'legal.title.zz_guard', fn: FN, title: 'Guard', v: 1, fields, rules: [], ...more });
  const limitsOf = (sets: FieldSet[]) => catalogLimits(sets).map((breach) => `${breach.limit}:${breach.field ?? breach.set}`);

  it('finds a figure a law sets after a "%", and in a table’s column', () => {
    const set = base([
      { key: 'tds', label: 'TDS at 1%', kind: 'boolean' },
      { key: 'deposit', label: '70% of receipts deposited', kind: 'boolean' },
      { key: 'rows', label: 'Rows', kind: 'table', columns: [{ key: 'advance', label: 'Advance above 10% of price', kind: 'boolean' }] },
      { key: 'plain', label: 'Share of receipts deposited', kind: 'percent' },
    ]);
    assert.deepEqual(limitsOf([set]), ['statutory_number:tds', 'statutory_number:deposit', 'statutory_number:rows']);
  });

  it('counts what a set adds to a shared record, a wide table that pairs lists, and "not applicable" however it is spelt or wherever its list is declared', () => {
    const many = Array.from({ length: 21 }, (_, i): CheckFieldDef => ({ key: `added_${i}`, label: `Added ${String.fromCharCode(97 + i)}`, kind: 'text' }));
    const adds = base(many, { id: 'legal.title.zz_adds', extends: 'shared.parties' });
    const wide = base([{ key: 'pairs', label: 'Pairs', kind: 'table', display: 'match', columns: Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, label: `Column ${String.fromCharCode(97 + i)}`, kind: 'text' as const })) }]);
    const lists = base([], { id: 'legal.title.zz_lists', optionSets: [{ id: 'zz_reply', label: 'Reply', options: [{ key: 'yes', label: 'Yes' }, { key: 'na', label: 'Not Applicable (NA)' }] }] });
    const uses = base([{ key: 'reply', label: 'Reply', kind: 'enum', optionSet: 'zz_reply' }, { key: 'other', label: 'Other', kind: 'enum', options: ['Yes', 'N.A.'] }], { id: 'legal.title.zz_uses' });
    assert.deepEqual(limitsOf([adds]), ['record_fields:legal.title.zz_adds']);
    assert.deepEqual(limitsOf([wide]), ['wide_table:pairs']);
    assert.deepEqual(limitsOf([lists, uses]), ['option_not_applicable:reply', 'option_not_applicable:other']);
  });

  it('still finds nothing in the product’s own catalog, and the test’s sheets can be used', () => {
    assert.deepEqual(catalogLimits(), []);
    assert.deepEqual(catalogFaults([...FIELD_SETS, ...OWN], ROWS).filter((fault) => fault.includes('zz')), []);
  });
});

describe('whose decision it is', () => {
  it('a situation the whole project shares is decided from a function that declares it or waits on it', () => {
    const p = project();
    setTeamMember(p, { email: 'site@firm.example', departments: { construction: 'lead' } }, 'owner');
    const site = seat(p, 'site@firm.example');
    assert.throws(() => setSituation(p, 'construction.safety', 'joint_development', false, 'site@firm.example', site), /not one of this function’s to decide/);
    assert.equal(p.situations?.joint_development, undefined);
    assert.equal(setSituation(p, 'legal.contracts', 'joint_development', true, LEAD, seat(p, LEAD)).state, 'on');
  });

  it('a value waiting beside a mirror is listed once, and is accepted on the field that holds it in one decision from that line', () => {
    const p = project();
    const row = deed(p);
    recordCheckFields(p, checkOf(p, PARCEL).id, { extent_title: 5000 }, LEAD);
    proposeFieldValues(p, [{ address: { fn: 'legal.title', set: PARCEL, field: 'extent_title' }, value: 6000, origin: read(row.id, 'measuring 6000 square metres') }], 'parser');
    const mirror = readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'extent_on_check')!;
    assert.equal(mirror.waiting.length, 1, 'the mirror shows what waits on the field it reads');
    assert.throws(() => decideField(p, at('extent_on_check'), 'accept', LEAD, { pick: 0 }, seat(p, LEAD)), /worked out, and nobody decides it/);

    const lines = readFunctionFields(p, FN).needs.accept.filter((line) => line.shownAt?.field === 'extent_on_check');
    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.deepEqual([line.address!.set, line.address!.field, line.pick], [PARCEL, 'extent_title', 0], 'the line names the check’s own field, where the server accepts');
    decideField(p, line.address!, 'accept', LEAD, { pick: line.pick }, seat(p, LEAD));
    assert.equal(checkOf(p, PARCEL).fields!.extent_title!.value, 6000);
    assert.equal(readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'extent_on_check')!.held?.value, 6000);
    assert.deepEqual(readFunctionFields(p, FN).needs.accept, []);
  });
});
