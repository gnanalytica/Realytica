/**
 * The field system's second round, held to what it says (docs/fields.md).
 *
 * - A value waits for a check's field once: on a card of the check's, read
 *   on the field as proposed, and decided from either side.
 * - A check's fields show, fold and hide as a sheet's do, and the valuation
 *   inputs open by approach.
 * - A field is expected from a step of the project or a day, and one another
 *   party owes is listed under that party, never as the reader's to fill.
 * - A hard case opens from the row that needs it as its own small sheet.
 * - A function opens on five lines, in order: Decide, Accept, Failing, Due
 *   soon, Missing. A line under Due soon can be put off until a day.
 * - A firm adds fields and lists to a built-in set and folds a built-in
 *   field, and can do nothing else to one.
 * - A table draws as bars, a line over dates or stacked bars, and a match
 *   pairs more than two lists.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  EMPTY_FIRM_FIELDS,
  NEED_KINDS,
  addEvidence,
  addFieldRecord,
  applyFirmFields,
  buildFieldCatalog,
  catalogFaults,
  catalogLimits,
  checkFieldsAsRead,
  checkFieldsShown,
  createAssessment,
  createProject,
  decideField,
  decidesIn,
  DecisionRefused,
  departmentRole,
  factFillProposals,
  fieldCatalogFor,
  fieldChart,
  fieldState,
  FieldRefused,
  FIELD_SETS,
  firmFieldFaults,
  firmFieldsHeld,
  firmKey,
  installFirmFields,
  papersOwed,
  proposeFieldValues,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  roleCanEdit,
  setFieldValues,
  setSituation,
  setTeamMember,
  snoozeNeed,
  type CheckFieldDef,
  type DdProject,
  type DocumentFact,
  type FieldAddress,
  type FieldOrigin,
  type FieldSet,
  type FirmFieldPack,
} from '@realytica/shared';
import { FIELD_RULE, PROJECT_COPILOT_INSTRUCTION, createProjectTools } from '@realytica/agents';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const OWNERS = 'legal.title.owners';
const PARCEL = 'land_site.parcel_identification';
const VALUATION = 'finance.valuation';
const INCOME = 'indicative_valuation.income_inputs';
const COMPARABLE = 'indicative_valuation.comparable_inputs';

const LEAD = 'lead@firm.example';
const JUNIOR = 'junior@firm.example';

function project(tenantId?: string): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-FC2');
  p.jurisdiction = 'Karnataka';
  if (tenantId) p.tenantId = tenantId;
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead', finance: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { legal: 'contributor' } }, 'owner');
  return p;
}

const checkOf = (p: DdProject, definitionId: string) => p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;
const seat = (p: DdProject, email: string) => ({ mayDecide: decidesIn(p, { email }), mayEdit: (department: Parameters<typeof departmentRole>[2]) => roleCanEdit(departmentRole(p, { email }, department)) });
const holding = (field: string): FieldAddress => ({ fn: FN, set: HOLDING, field });
const onCheck = (set: string, field: string, fn = FN): FieldAddress => ({ fn, set, field });

function deed(p: DdProject, title = 'Sale deed 2019', facts: DocumentFact[] = []) {
  const row = addEvidence(p, { title, kind: 'document' });
  row.documentType = 'Sale deed';
  row.attachments = [{ id: `f-${row.id}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k-${row.id}`, uploadedAt: '2026-10-01T00:00:00.000Z', uploadedBy: 'tester' } as never];
  row.facts = facts;
  return row;
}

const paper = (evidenceId: string, quote = 'measuring 5000 square metres'): FieldOrigin => ({ kind: 'paper', evidenceId, page: 3, quote, reader: 'model', proof: 'page_text' });
const cards = (p: DdProject) => p.chatProposals.filter((card) => card.kind === 'record_check_fields');

/* ==================================================================== */
/* 1. One way a check's value waits                                      */
/* ==================================================================== */

describe('a value offered for a check’s field', () => {
  it('waits once: on a card of the check’s, and read on the field as proposed with its page and words', () => {
    const p = project();
    const row = deed(p);
    const address = onCheck(PARCEL, 'extent_title');
    const out = proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model');
    assert.equal(out[0]!.outcome, 'waiting');
    assert.equal(cards(p).length, 1);
    assert.equal(checkOf(p, PARCEL).fields?.extent_title, undefined, 'nothing is written to the check until a person accepts');

    const view = readSheet(p, PARCEL)!.fields.find((f) => f.def.key === 'extent_title')!;
    assert.equal(view.state, 'proposed');
    assert.equal(view.source?.evidenceId, row.id);
    assert.equal(view.source?.page, 3);
    assert.equal(view.source?.quote, 'measuring 5000 square metres');
    assert.equal(fieldState(checkFieldsAsRead(p, checkOf(p, PARCEL)).extent_title), 'proposed');
  });

  it('is not offered twice: not by the same door, not by a paper’s reading, and not once a person has set it aside', () => {
    const p = project();
    const row = deed(p, 'Sale deed 2019', [{ key: 'extent_title', label: 'Extent per title', value: 5000, display: '5,000 sqm', page: 3, quote: 'measuring 5000 square metres', source: 'parser' }]);
    const address = onCheck(PARCEL, 'extent_title');
    proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model');
    assert.equal(proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model')[0]!.outcome, 'waiting');
    assert.equal(cards(p).length, 1, 'the same value offered again makes no second card');
    assert.equal(proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }, { address, value: 5000, origin: paper(row.id) }], 'model').length, 2);
    assert.equal(cards(p).length, 1);

    // The paper's own reading states the same value: the card that waits is the one, and the reading raises none for this check.
    const fromReading = factFillProposals(p, row.facts!, { fileName: 'deed.pdf', evidenceId: row.id }, 'operator');
    assert.equal(fromReading.filter((card) => card.payload.checkId === checkOf(p, PARCEL).id).length, 0);

    decideField(p, address, 'set_aside', LEAD, {}, seat(p, LEAD));
    assert.equal(cards(p)[0]!.status, 'rejected');
    assert.equal(readSheet(p, PARCEL)!.fields.find((f) => f.def.key === 'extent_title')!.state, 'empty');
    assert.equal(proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model')[0]!.outcome, 'declined');
    assert.equal(cards(p).length, 1);
  });

  it('is decided from the field: accepting it records what the card would, and a lead or signer does it', () => {
    const p = project();
    const row = deed(p);
    const address = onCheck(PARCEL, 'extent_title');
    proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model');
    assert.throws(() => decideField(p, address, 'accept', JUNIOR, {}, seat(p, JUNIOR)), DecisionRefused);
    assert.equal(checkOf(p, PARCEL).fields?.extent_title, undefined);

    const stood = decideField(p, address, 'accept', LEAD, {}, seat(p, LEAD));
    assert.equal(stood?.value, 5000);
    assert.equal(stood?.sourceEvidenceId, row.id);
    assert.equal(stood?.page, 3);
    assert.equal(cards(p)[0]!.status, 'committed', 'the card is the same value seen from the chat, and is settled with it');
    assert.equal(readSheet(p, PARCEL)!.fields.find((f) => f.def.key === 'extent_title')!.state, 'accepted');
    assert.equal(proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model')[0]!.outcome, 'held');
  });

  it('waits beside a value the check holds, and a person keeps one', () => {
    const p = project();
    const row = deed(p);
    const address = onCheck(PARCEL, 'extent_title');
    recordCheckFields(p, checkOf(p, PARCEL).id, { extent_title: 4800 }, 'tester');
    proposeFieldValues(p, [{ address, value: 5000, origin: paper(row.id) }], 'model');
    const view = readSheet(p, PARCEL)!.fields.find((f) => f.def.key === 'extent_title')!;
    assert.equal(view.state, 'typed', 'what is held still stands');
    assert.equal(view.waiting.length, 1);
    decideField(p, address, 'accept', LEAD, { pick: 0 }, seat(p, LEAD));
    assert.equal(checkOf(p, PARCEL).fields!.extent_title!.value, 5000);
    assert.equal(cards(p)[0]!.status, 'committed');

    // And the other way: what is held is kept, and the card's value is set aside.
    const q = project();
    const other = deed(q);
    recordCheckFields(q, checkOf(q, PARCEL).id, { extent_title: 4800 }, 'tester');
    proposeFieldValues(q, [{ address, value: 5000, origin: paper(other.id) }], 'model');
    decideField(q, address, 'keep', LEAD, {}, seat(q, LEAD));
    assert.equal(checkOf(q, PARCEL).fields!.extent_title!.value, 4800);
    assert.equal(cards(q)[0]!.status, 'rejected');
  });

  it('may come from a named public source with the day it was read, and keeps both when accepted; a field that needs a paper refuses one', () => {
    const p = project();
    const origin: FieldOrigin = { kind: 'external', source: 'Registration department guidance values', asOf: '2026-10-01' };
    const count = onCheck(COMPARABLE, 'comparable_count', VALUATION);
    const out = proposeFieldValues(p, [{ address: count, value: 6, origin }, { address: onCheck(COMPARABLE, 'rate_per_sqm', VALUATION), value: 21500, origin }], 'model');
    assert.deepEqual(out.map((o) => o.outcome), ['waiting', 'refused']);
    assert.match(out[1]!.error ?? '', /cite a paper/);
    const view = readSheet(p, COMPARABLE)!.fields.find((f) => f.def.key === 'comparable_count')!;
    assert.equal(view.state, 'proposed');
    assert.equal(view.source?.kind, 'external');
    const stood = decideField(p, count, 'accept', LEAD, {}, seat(p, LEAD));
    assert.equal(stood?.origin?.kind, 'external');
    assert.equal(fieldState(stood), 'accepted');
  });

  it('through the copilot’s tool, is a card of the turn and reads as proposed in get_fields', async () => {
    const p = project();
    const row = deed(p);
    const bag = { proposals: [] as Array<{ kind: string; payload: Record<string, unknown> }>, navigations: [], toolCalls: [], choices: [] };
    const all = createProjectTools(p, 'tester', bag as never) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    const run = async (name: string, args: unknown) => JSON.parse(await all.find((t) => t.name === name)!.run(args as never, undefined as never));
    const address = onCheck(PARCEL, 'extent_title');
    const first = await run('propose_field_values', { values: [{ address, value: 5000, origin: paper(row.id) }] });
    const again = await run('propose_field_values', { values: [{ address, value: 5000, origin: paper(row.id) }] });
    assert.equal(first.outcomes[0].outcome, 'waiting');
    assert.equal(again.outcomes[0].outcome, 'waiting');
    assert.equal(bag.proposals.length, 1, 'offered twice in a turn, it is one card');
    p.chatProposals.push(...(bag.proposals as never[]));
    const read = await run('get_fields', { set: PARCEL });
    assert.equal(read.sheets[0].fields.find((f: { address: FieldAddress }) => f.address.field === 'extent_title').state, 'proposed');
  });
});

/* ==================================================================== */
/* 2. A check's fields show as a sheet's do                              */
/* ==================================================================== */

describe('a check’s fields', () => {
  it('are not drawn while their situation is out of play, and the valuation inputs open by approach', () => {
    const p = project();
    const income = checkOf(p, INCOME);
    assert.ok(income, 'the acquisition assessment carries the income inputs');
    const before = checkFieldsShown(p, income);
    assert.deepEqual([...new Set(Object.values(before.shown))], ['hidden']);
    assert.deepEqual(before.situations.map((s) => [s.situation.key, s.state]), [['income_approach', 'off']]);
    assert.equal(before.fn, VALUATION);

    setSituation(p, VALUATION, 'income_approach', true, LEAD, seat(p, LEAD));
    const after = checkFieldsShown(p, income);
    assert.equal(after.shown.achievable_rent, 'shown');
    assert.equal(after.shown.inc_noi, 'shown');
    // The other approaches stay as they were.
    assert.deepEqual([...new Set(Object.values(checkFieldsShown(p, checkOf(p, 'indicative_valuation.residual_inputs')).shown))], ['hidden']);
  });

  it('are in play with nobody asked once one of an approach’s inputs is recorded, and stay in play while it is', () => {
    const p = project();
    const row = deed(p);
    recordCheckFields(p, checkOf(p, COMPARABLE).id, { rate_per_sqm: 21500 }, 'tester', row.id);
    const shown = checkFieldsShown(p, checkOf(p, COMPARABLE));
    assert.equal(shown.shown.rate_per_sqm, 'shown');
    assert.equal(shown.shown.rate_basis, 'shown');
    assert.equal(shown.situations[0]!.state, 'on');
    assert.equal(shown.situations[0]!.implied, true);
    assert.throws(() => setSituation(p, VALUATION, 'comparable_approach', false, LEAD, seat(p, LEAD)), FieldRefused);
  });

  it('with no condition on any field read as they always did: every field shown', () => {
    const p = project();
    const shown = checkFieldsShown(p, checkOf(p, PARCEL));
    assert.ok(Object.keys(shown.shown).length > 3);
    assert.deepEqual([...new Set(Object.values(shown.shown))], ['shown']);
    assert.deepEqual(shown.situations, []);
  });
});

/* ==================================================================== */
/* 3. Due from, and owed by                                              */
/* ==================================================================== */

describe('a field with a step it is due from and a party who owes it', () => {
  it('is not counted or listed before its step, and after it is listed under the party, never as the reader’s to fill', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { tenure: 'freehold' }, LEAD);
    const early = readFunctionFields(p, FN);
    const opinion = () => readFunctionFields(p, FN).sheets[0]!.reading!.fields.find((f) => f.def.key === 'title_opinion')!;
    assert.equal(opinion().due, false);
    assert.equal(opinion().expected, false);
    assert.deepEqual(early.waitingOn, []);
    assert.ok(!early.needs.missing.some((line) => line.address?.field === 'title_opinion'));

    p.currentStage = 'acquisition';
    const page = readFunctionFields(p, FN);
    assert.equal(opinion().due, true);
    assert.equal(opinion().awaited, true);
    assert.equal(opinion().expected, false, 'what another party owes is never counted against the reader');
    assert.equal(page.expected, early.expected);
    assert.ok(!page.needs.missing.some((line) => ['title_opinion', 'possession_letter'].includes(line.address?.field ?? '')));
    assert.deepEqual(page.waitingOn.map((group) => [group.label, group.fields.map((f) => f.label)]), [['The advocate', ['Title opinion']], ['Seller', ['Possession letter']]]);
  });

  it('names the party a link on the same sheet points to, and feeds the department’s papers-owed list', () => {
    const p = project();
    p.currentStage = 'acquisition';
    p.stakeholders.push({ id: 'stk_vendor', name: 'M. Shetty', role: 'Vendor' });
    setFieldValues(p, { set: HOLDING }, { seller: 'stk_vendor' }, LEAD);
    const page = readFunctionFields(p, FN);
    assert.deepEqual(page.waitingOn.map((group) => group.label), ['The advocate', 'M. Shetty']);
    assert.equal(page.waitingOn[1]!.partyId, 'stk_vendor');

    const owed = papersOwed(p, { department: 'legal' });
    const fromFields = owed.parties.flatMap((party) => party.lines).filter((line) => line.from === 'fields');
    assert.deepEqual(fromFields.map((line) => [line.party, line.title]).sort(), [['M. Shetty', 'Possession letter'], ['The advocate', 'Title opinion']]);
    assert.ok(fromFields.every((line) => line.standing === 'not_asked' && line.department === 'legal'));
    assert.equal(papersOwed(p, { department: 'finance' }).parties.flatMap((party) => party.lines).filter((line) => line.from === 'fields').length, 0);
  });
});

/* ==================================================================== */
/* 4. Depth sheets                                                       */
/* ==================================================================== */

describe('a depth sheet', () => {
  it('opens from the row that needs it and from no other, keeps its values on that row, and rolls its trouble up to the function', () => {
    const p = project();
    const company = addFieldRecord(p, OWNERS, { name: 'Riverbend Homes LLP', share_pct: 75, capacity: 'company' }, LEAD).record!;
    const minor = addFieldRecord(p, OWNERS, { name: 'S. Shetty', share_pct: 25, capacity: 'minor through a guardian' }, LEAD).record!;
    assert.equal(readSheet(p, OWNERS, company.id)!.depth[0]!.shown, false);
    const read = () => readSheet(p, OWNERS, minor.id)!;
    assert.equal(read().depth[0]!.shown, true);
    assert.equal(read().depth[0]!.sheet.title, 'Guardianship');
    assert.deepEqual([read().depth[0]!.filled, read().depth[0]!.total], [0, 3]);
    assert.ok(read().sections.every((section) => section.fields.every((view) => !view.def.sheet)), 'the row’s own sheet does not grow by the hard case’s fields');

    setFieldValues(p, { set: OWNERS, record: minor.id }, { guardian_kind: 'court-appointed', date_of_birth: '2014-05-02' }, LEAD);
    assert.equal(p.fieldSheets![OWNERS]!.records!.find((r) => r.id === minor.id)!.values.guardian_kind!.value, 'court-appointed');
    assert.deepEqual([read().depth[0]!.filled, read().depth[0]!.total, read().depth[0]!.failing], [2, 3, 1]);

    const failing = readFunctionFields(p, FN).needs.failing;
    assert.equal(failing.length, 1);
    assert.equal(failing[0]!.depth, 'guardianship');
    assert.equal(failing[0]!.record, minor.id);
    assert.equal(failing[0]!.label, 'Guardianship');
    assert.match(failing[0]!.text, /court-appointed/);
  });

  it('is held to twenty fields in four sections, and to keys that are not the row’s own', () => {
    const field = (key: string): CheckFieldDef => ({ key, label: key, kind: 'text', required: false });
    const base: FieldSet = { id: 'legal.title.cases', fn: FN, title: 'Cases', v: 1, records: { of: 'case', titleField: 'case_no', summaryFields: [] }, fields: [field('case_no'), { key: 'relief', label: 'Relief', kind: 'enum', options: ['partition', 'injunction'] }], rules: [] };
    const when = { field: { fn: FN, set: 'legal.title.cases', field: 'relief' }, is: 'equals' as const, value: 'partition' };
    const big: FieldSet = { ...base, sheets: [{ id: 'partition', title: 'Partition suit', showWhen: when, sections: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, label: key })), fields: Array.from({ length: 21 }, (_, i) => ({ ...field(`f${i}`), section: 'a' })), rules: [] }] };
    assert.deepEqual(catalogLimits([big]).map((breach) => breach.limit), ['depth_fields', 'depth_sections']);
    assert.equal(catalogLimits([big]).some((breach) => breach.limit === 'record_fields'), false, 'a depth sheet’s fields are not the record’s own');

    const clash: FieldSet = { ...base, sheets: [{ id: 'partition', title: 'Partition suit', showWhen: when, fields: [field('relief')], rules: [] }] };
    assert.ok(catalogFaults([clash], []).some((fault) => /relief: declared twice/.test(fault)));
    assert.deepEqual(catalogFaults([{ ...base, sheets: [{ id: 'partition', title: 'Partition suit', showWhen: when, fields: [field('share_claimed')], rules: [] }] }], []), []);
  });
});

/* ==================================================================== */
/* 5. Needs you                                                          */
/* ==================================================================== */

const LEASES = 'legal.title.leases';
const leases: FieldSet = {
  id: LEASES,
  fn: FN,
  title: 'Lease',
  v: 1,
  fields: [
    { key: 'lessor', label: 'Lessor', kind: 'text' },
    { key: 'build_by', label: 'Build by', kind: 'date', expires: { leadDays: 60 } },
    { key: 'ground_rent', label: 'Ground rent', kind: 'money', currency: 'INR', required: false },
    { key: 'rent_paid', label: 'Rent paid', kind: 'money', currency: 'INR', required: false },
  ],
  rules: [{ kind: 'at_least', fields: ['rent_paid', 'ground_rent'], say: 'Rent paid is {a} against a ground rent of {b}.', severity: 'medium' }],
};

describe('what a function opens on', () => {
  const catalog = buildFieldCatalog([...FIELD_SETS, leases]);
  const now = new Date('2026-10-13T06:00:00Z');

  it('is five lines in one order: decide, accept, failing, due soon, missing', () => {
    assert.deepEqual([...NEED_KINDS], ['decide', 'accept', 'failing', 'due_soon', 'missing']);
    const p = project();
    const row = deed(p);
    // To accept, then a dispute to decide: a value accepted from a paper, and a person stating another.
    proposeFieldValues(p, [{ address: holding('tenure'), value: 'freehold', origin: paper(row.id, 'absolute owner') }, { address: holding('extent'), value: 5000, origin: paper(row.id) }], 'model', catalog);
    decideField(p, holding('extent'), 'accept', LEAD, {}, seat(p, LEAD), catalog);
    decideField(p, holding('extent'), 'dispute', LEAD, { value: 4800 }, seat(p, LEAD), catalog);
    setFieldValues(p, { set: LEASES }, { build_by: '2026-11-20', ground_rent: 100000, rent_paid: 40000 }, LEAD, {}, catalog);

    const page = readFunctionFields(p, FN, now, catalog);
    assert.deepEqual(page.needs.decide.map((line) => line.kind), ['disputed']);
    assert.deepEqual(page.needs.accept.map((line) => line.address?.field), ['tenure']);
    assert.deepEqual(page.needs.due_soon.map((line) => line.text).sort(), ['Rent paid is ₹40,000 against a ground rent of ₹1 lakh.', 'Runs out on 20 Nov 2026'].sort());
    assert.ok(page.needs.missing.some((line) => line.address?.field === 'lessor'));
    assert.deepEqual(page.exceptions.map((line) => line.need), [...page.needs.decide, ...page.needs.accept, ...page.needs.failing, ...page.needs.due_soon, ...page.needs.missing].map((line) => line.need), 'one list, in the order of the five lines');
    assert.equal(page.counts.total, NEED_KINDS.reduce((n, kind) => n + page.needs[kind].length, 0));
    assert.equal(new Set(page.exceptions.map((line) => line.key)).size, page.exceptions.length, 'every line has a key of its own');
  });

  it('lets a lead put a line under Due soon off until a day, and brings it back that day or when it starts failing', () => {
    const p = project();
    setFieldValues(p, { set: LEASES }, { lessor: 'Riverbend Development Authority', build_by: '2026-11-20' }, LEAD, {}, catalog);
    const line = readFunctionFields(p, FN, now, catalog).needs.due_soon[0]!;
    assert.match(line.key, /build_by::runs_out$/);

    assert.throws(() => snoozeNeed(p, FN, line.key, '2026-10-30', JUNIOR, seat(p, JUNIOR), catalog, now), DecisionRefused);
    assert.throws(() => snoozeNeed(p, FN, line.key, '2026-10-13', LEAD, seat(p, LEAD), catalog, now), /after today/);
    assert.throws(() => snoozeNeed(p, FN, line.key, '2027-06-01', LEAD, seat(p, LEAD), catalog, now), /90 days/);
    assert.throws(() => snoozeNeed(p, FN, `${HOLDING}::tenure::missing`, '2026-10-30', LEAD, seat(p, LEAD), catalog, now), /Only a line under Due soon/);

    snoozeNeed(p, FN, line.key, '2026-10-30', LEAD, seat(p, LEAD), catalog, now);
    assert.deepEqual(p.fieldSnoozes![line.key]!.by, LEAD);
    const off = readFunctionFields(p, FN, now, catalog);
    assert.equal(off.needs.due_soon.length, 0);
    assert.deepEqual(off.snoozed.map((s) => s.snoozedUntil), ['2026-10-30']);
    assert.equal(off.counts.total, readFunctionFields(p, FN, now, catalog).exceptions.length);

    assert.equal(readFunctionFields(p, FN, new Date('2026-10-30T06:00:00Z'), catalog).needs.due_soon.length, 1, 'it is back on its day');
    // Put off past the day it runs out, it is failing by then, and a failing line is never held back.
    snoozeNeed(p, FN, line.key, '2026-12-15', LEAD, seat(p, LEAD), catalog, now);
    const late = readFunctionFields(p, FN, new Date('2026-11-25T06:00:00Z'), catalog);
    assert.deepEqual(late.needs.failing.map((f) => f.text), ['Ran out on 20 Nov 2026']);
    assert.equal(late.snoozed.length, 0);

    snoozeNeed(p, FN, line.key, null, LEAD, seat(p, LEAD), catalog, now);
    assert.equal(readFunctionFields(p, FN, now, catalog).needs.due_soon.length, 1);
  });
});

/* ==================================================================== */
/* 6. The copilot's rule                                                 */
/* ==================================================================== */

describe('the copilot’s instruction', () => {
  it('names the two field tools and states the rule in one paragraph: a source for every value, a key from the list, and no prose', () => {
    assert.ok(PROJECT_COPILOT_INSTRUCTION.includes(FIELD_RULE));
    assert.equal(FIELD_RULE.includes('\n'), false, 'one paragraph');
    for (const said of ['get_fields', 'propose_field_values', 'the page and the paper\'s exact words', 'named public source', 'the date you read it', 'field key from that list', 'You write no prose into any field']) {
      assert.ok(FIELD_RULE.includes(said), said);
    }
  });
});

/* ==================================================================== */
/* 8. The firm's own fields                                              */
/* ==================================================================== */

describe('a firm’s overlay', () => {
  afterEach(() => {
    installFirmFields('firm_a', undefined);
    installFirmFields('firm_b', undefined);
  });

  const pack = (over: Partial<FirmFieldPack> = {}): FirmFieldPack =>
    firmFieldsHeld({
      v: 1,
      optionSets: [{ id: 'firm_broker_grade', label: 'Broker grade', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }],
      add: [
        { set: HOLDING, field: { key: firmKey('Broker’s name'), label: 'Broker’s name', kind: 'text' } },
        { set: HOLDING, field: { key: 'firm_broker_grade', label: 'Broker grade', kind: 'enum', optionSet: 'firm_broker_grade' } },
      ],
      demote: [{ set: HOLDING, field: 'possession_verified' }],
      ...over,
    });

  it('adds fields and lists to a built-in set and folds a built-in field as expert', () => {
    assert.equal(firmKey('Broker’s name'), 'firm_brokers_name');
    assert.deepEqual(firmFieldFaults(pack()), []);
    const sets = applyFirmFields(FIELD_SETS, pack());
    const set = sets.find((s) => s.id === HOLDING)!;
    const added = set.fields.find((f) => f.key === 'firm_brokers_name')!;
    assert.deepEqual([added.firm, added.required, added.tier], [true, false, 'core']);
    assert.equal(set.fields.find((f) => f.key === 'possession_verified')!.tier, 'expert');
    assert.equal(set.fields.find((f) => f.key === 'tenure')!.kind, 'enum', 'nothing else of a built-in field moves');
    assert.deepEqual(catalogFaults(sets), [], 'the catalog it makes is a whole one');
    assert.equal(applyFirmFields(FIELD_SETS, EMPTY_FIRM_FIELDS), FIELD_SETS);
  });

  it('may not hide or re-type a built-in field, add one nobody fills, or name the field a record is called by', () => {
    const faults = (over: Partial<FirmFieldPack>) => firmFieldFaults(pack(over)).join(' ');
    assert.match(faults({ add: [{ set: HOLDING, field: { key: 'tenure', label: 'Tenure', kind: 'text' } }] }), /starts with "firm_"/);
    assert.match(faults({ add: [{ set: HOLDING, field: { key: 'firm_total', label: 'Total', kind: 'computed' } }] }), /one a person fills/);
    assert.match(faults({ add: [{ set: PARCEL, field: { key: 'firm_note', label: 'Note', kind: 'text' } }] }), /not a set a firm adds to/);
    assert.match(faults({ add: [{ set: HOLDING, field: { key: 'firm_grade', label: 'Grade', kind: 'enum', optionSet: 'land_tenure' } }] }), /needs one of the firm’s lists/);
    assert.match(faults({ demote: [{ set: OWNERS, field: 'name' }] }), /named by/);
    assert.match(faults({ demote: [{ set: HOLDING, field: 'no_such' }] }), /not a built-in field/);
    // A pack sent with more than a firm may say is cut to what it may: no formula, no mirror, no condition.
    const sent = firmFieldsHeld({ v: 1, optionSets: [], demote: [], add: [{ set: HOLDING, field: { key: 'firm_x', label: 'X', kind: 'number', formula: { op: 'const', value: 1 }, sameAs: holding('extent'), showWhen: { situation: 'agricultural_land' }, required: true } }] });
    assert.deepEqual(Object.keys(sent.add[0]!.field).sort(), ['firm', 'key', 'kind', 'label', 'required', 'tier']);
    assert.equal(sent.add[0]!.field.required, false);
  });

  it('is the firm’s alone, and what was saved under a field it later takes away is kept and shown as no longer asked', () => {
    installFirmFields('firm_a', pack());
    const mine = project('firm_a');
    const theirs = project('firm_b');
    assert.ok(fieldCatalogFor(mine).sets.get(HOLDING)!.fields.some((f) => f.key === 'firm_brokers_name'));
    assert.ok(!fieldCatalogFor(theirs).sets.get(HOLDING)!.fields.some((f) => f.key === 'firm_brokers_name'), 'one firm’s fields are never another’s');
    assert.equal(setFieldValues(theirs, { set: HOLDING }, { firm_brokers_name: 'K. Rao' }, LEAD).rejected.length, 1);

    assert.deepEqual(setFieldValues(mine, { set: HOLDING }, { firm_brokers_name: 'K. Rao', firm_broker_grade: 'A', possession_verified: true }, LEAD).rejected, []);
    const reading = readSheet(mine, HOLDING)!;
    assert.equal(reading.fields.find((f) => f.def.key === 'firm_broker_grade')!.text, 'A');
    assert.equal(reading.fields.find((f) => f.def.key === 'possession_verified')!.shown, 'shown', 'a folded field that holds a value is in sight');
    assert.equal(readSheet(project('firm_a'), HOLDING)!.fields.find((f) => f.def.key === 'possession_verified')!.shown, 'folded');
    assert.deepEqual(reading.unasked, []);

    installFirmFields('firm_a', pack({ add: [] }));
    const after = readSheet(mine, HOLDING)!;
    assert.deepEqual(after.unasked, [{ key: 'firm_brokers_name', text: 'K. Rao' }, { key: 'firm_broker_grade', text: 'a' }]);
    setFieldValues(mine, { set: HOLDING }, { tenure: 'freehold' }, LEAD);
    assert.equal(mine.fieldSheets![HOLDING]!.values.firm_brokers_name!.value, 'K. Rao', 'a save of another key keeps it');
  });
});

/* ==================================================================== */
/* 9. Charts and a match of three lists                                  */
/* ==================================================================== */

describe('a table’s display', () => {
  const columns: CheckFieldDef[] = [
    { key: 'on', label: 'Date', kind: 'date' },
    { key: 'amount', label: 'Amount', kind: 'money', currency: 'INR' },
    { key: 'head', label: 'Head', kind: 'enum', options: ['land', 'approvals', 'construction'] },
  ];
  const rows = [
    { on: '2026-06-30', amount: 40, head: 'construction' },
    { on: '2026-03-31', amount: 100, head: 'land' },
    { on: '2026-06-30', amount: 15, head: 'approvals' },
    { on: '2026-09-30', amount: null, head: 'construction' },
  ];
  const table = (chart: CheckFieldDef['chart']): CheckFieldDef => ({ key: 'outflow', label: 'Outflow', kind: 'table', display: 'chart', columns, chart });

  it('draws as a bar for each row, a line over dates in date order, or bars stacked by a column', () => {
    const bars = fieldChart(table({ x: 'head', y: 'amount' }), rows)!;
    assert.deepEqual(bars.mark === 'bar' && bars.points.map((p) => [p.x, p.y]), [['construction', 40], ['land', 100], ['approvals', 15]]);

    const line = fieldChart(table({ x: 'on', y: 'amount', mark: 'line' }), rows)!;
    assert.deepEqual(line.mark === 'line' && [line.dated, line.points.map((p) => p.x)], [true, ['2026-03-31', '2026-06-30', '2026-06-30']], 'a row with no figure is left out, never drawn as zero');

    const stacked = fieldChart(table({ x: 'on', y: 'amount', mark: 'stacked', stack: 'head' }), rows)!;
    assert.equal(stacked.mark, 'stacked');
    if (stacked.mark !== 'stacked') return;
    assert.deepEqual(stacked.keys.map((k) => k.key), ['construction', 'land', 'approvals']);
    assert.deepEqual(stacked.bars.map((bar) => [bar.x, bar.total, bar.parts.map((part) => `${part.key}:${part.y}`)]), [['2026-03-31', 100, ['land:100']], ['2026-06-30', 55, ['construction:40', 'approvals:15']]]);
    assert.equal(fieldChart(table({ x: 'on', y: 'amount' }), []), undefined);
    assert.ok(catalogFaults([{ id: 'legal.title.flows', fn: FN, title: 'Flows', v: 1, fields: [table({ x: 'on', y: 'amount', mark: 'stacked' })], rules: [] }], []).some((fault) => /stacked chart names the column/.test(fault)));
  });

  it('pairs more than two lists, and says what no row pairs and which rows disagree', () => {
    const OWNER_MATCH = 'legal.title.owner_records_fixture';
    const set: FieldSet = {
      id: OWNER_MATCH,
      fn: FN,
      title: 'Land records',
      v: 1,
      fields: [
        { key: 'rtc_owners', label: 'Owners per RTC', kind: 'table', required: false, columns: [{ key: 'name', label: 'Name', kind: 'text' }] },
        { key: 'khata_holders', label: 'Khata holders', kind: 'table', required: false, columns: [{ key: 'name', label: 'Name', kind: 'text' }] },
        {
          key: 'owner_match',
          label: 'Owner by record',
          kind: 'table',
          display: 'match',
          required: false,
          columns: [
            { key: 'survey_no', label: 'Survey number', kind: 'ref', target: 'parcel' },
            { key: 'rtc_owner', label: 'RTC owner', kind: 'text' },
            { key: 'purchaser', label: 'Last purchaser', kind: 'ref', target: { set: OWNERS } },
            { key: 'khata_holder', label: 'Khata holder', kind: 'text' },
          ],
          match: {
            left: { column: 'survey_no', label: 'Survey numbers', of: { target: 'parcel' } },
            right: { column: 'rtc_owner', label: 'RTC owners', of: { table: { fn: FN, set: OWNER_MATCH, field: 'rtc_owners' }, column: 'name' } },
            also: [
              { column: 'purchaser', label: 'Purchasers', of: { records: OWNERS, field: 'name' } },
              { column: 'khata_holder', label: 'Khata holders', of: { table: { fn: FN, set: OWNER_MATCH, field: 'khata_holders' }, column: 'name' } },
            ],
            agree: ['rtc_owner', 'purchaser', 'khata_holder'],
          },
        },
      ],
      rules: [],
    };
    assert.deepEqual(catalogFaults([...FIELD_SETS, set]), []);
    const catalog = buildFieldCatalog([...FIELD_SETS, set]);
    const p = project();
    p.parcelId = 'Sy. No. 45/2, 46';
    const owner = addFieldRecord(p, OWNERS, { name: 'M. Shetty', share_pct: 100, capacity: 'individual' }, LEAD, {}, catalog).record!;
    setFieldValues(p, { set: OWNER_MATCH }, { rtc_owners: [{ name: 'M. Shetty' }, { name: 'K. Gowda' }], khata_holders: [{ name: 'M Shetty' }] }, LEAD, {}, catalog);
    const parcels = readSheet(p, OWNER_MATCH, undefined, undefined, catalog)!.fields.find((f) => f.def.key === 'owner_match')!.match!.left.items;
    assert.equal(parcels.length, 2);
    setFieldValues(p, { set: OWNER_MATCH }, { owner_match: [{ survey_no: parcels[0]!.id, rtc_owner: 'M. Shetty', purchaser: owner.id, khata_holder: 'M Shetty' }] }, LEAD, {}, catalog);

    const match = readSheet(p, OWNER_MATCH, undefined, undefined, catalog)!.fields.find((f) => f.def.key === 'owner_match')!.match!;
    assert.deepEqual(match.sides.map((side) => side.label), ['Survey numbers', 'RTC owners', 'Purchasers', 'Khata holders']);
    assert.deepEqual(match.sides.map((side) => side.leftover.map((item) => item.label)), [[parcels[1]!.label], ['K. Gowda'], [], []]);
    assert.equal(match.rows[0]!.differs, true, 'the khata holder is spelt another way');
    assert.deepEqual(match.pairs.length, 1, 'the first two lists still read as a pair');

    const page = readFunctionFields(p, FN, new Date(), catalog);
    assert.ok(page.needs.failing.some((line) => /M\. Shetty \/ M Shetty/.test(line.text)));
    // Of this table's own: Title's real sheets pair lists of their own on the same function.
    assert.deepEqual(page.exceptions.filter((line) => line.kind === 'unmatched' && line.key.startsWith(`${OWNER_MATCH}::`)).map((line) => line.text), [`Survey numbers: ${parcels[1]!.label}`, 'RTC owners: K. Gowda']);
  });
});
