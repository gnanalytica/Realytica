/**
 * The field system, held to what it promises (docs/fields.md).
 *
 * - A value somebody proposed acts on nothing until a lead or signer accepts
 *   it: no formula, no rule, no standing, no line in the graph or in memory.
 * - A model writes no words, and offers nothing without saying where it read
 *   it.
 * - A field that is not showing is never counted as missing, and taking a
 *   situation out of play keeps what its fields hold.
 * - What a person typed prints as they typed it.
 * - A project saved before any of this loads as it did, and its checks read
 *   as they did.
 *
 * The worked example (`field-sets/example-land-holding.ts`) is what most of
 * it runs on.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptAllFromPaper,
  addEvidence,
  addFieldRecord,
  buildProjectGraph,
  checkFieldReading,
  createAssessment,
  createProject,
  decideField,
  decidesIn,
  DecisionRefused,
  departmentRole,
  ensureProjectShape,
  evaluateFormula,
  fieldRecords,
  fieldState,
  fieldsNeeding,
  formatFieldValue,
  formatMeasure,
  memoryFacts,
  offerPaperToSheets,
  parseMeasure,
  projectBrief,
  projectView,
  proposeFieldValues,
  proposeSituations,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  removeFieldRecord,
  resolveFields,
  roleCanEdit,
  rupeesSaid,
  setFieldValues,
  setSectionNotApplicable,
  setSituation,
  setTeamMember,
  validateFieldValue,
  validateProjectGraph,
  type CheckFieldDef,
  type CheckFieldValue,
  type DdProject,
  type DocumentFact,
  type FieldAddress,
  type FieldOrigin,
  type ProjectGrant,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const OWNERS = 'legal.title.owners';
const at = (field: string, record?: string): FieldAddress => ({ fn: FN, set: field.startsWith('@') ? OWNERS : HOLDING, field: field.replace('@', ''), ...(record ? { record } : {}) });

const LEAD = 'lead@firm.example';
const JUNIOR = 'junior@firm.example';

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-FLD');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { legal: 'contributor' } }, 'owner');
  return p;
}

const checkOf = (p: DdProject, definitionId: string) => p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;

/** A paper on file, with one value read off it. */
function deed(p: DdProject, documentType = 'Sale deed', facts: DocumentFact[] = []) {
  const row = addEvidence(p, { title: `${documentType} 2019`, kind: 'document' });
  row.documentType = documentType;
  row.attachments = [{ id: 'f1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k-${row.id}`, uploadedAt: '2026-10-01T00:00:00.000Z', uploadedBy: 'tester' } as never];
  row.facts = facts;
  return row;
}

const paper = (evidenceId: string, quote = 'measuring 1 acre 22 guntas'): FieldOrigin => ({ kind: 'paper', evidenceId, page: 3, quote, reader: 'model', proof: 'page_text' });
const seat = (p: DdProject, email: string) => ({ mayDecide: decidesIn(p, { email }), mayEdit: (department: Parameters<typeof departmentRole>[2]) => roleCanEdit(departmentRole(p, { email }, department)) });

/* ==================================================================== */
/* A. State and provenance                                               */
/* ==================================================================== */

describe('a value that was proposed', () => {
  it('acts on nothing until a person accepts it: no formula, no rule, no standing, no graph node, no memory', () => {
    const p = project();
    const row = deed(p);
    recordCheckFields(p, checkOf(p, 'land_site.parcel_identification').id, { extent_title: 5000 }, 'tester');
    recordCheckFields(p, checkOf(p, 'indicative_valuation.comparable_inputs').id, { rate_per_sqm: 1000 }, 'tester', row.id);

    const [outcome] = proposeFieldValues(p, [{ address: at('extent'), value: '1 acre 22 guntas', origin: paper(row.id) }], 'model');
    assert.equal(outcome!.outcome, 'waiting');

    const held = p.fieldSheets![HOLDING]!.values.extent!;
    assert.equal(fieldState(held), 'proposed');
    const before = readSheet(p, HOLDING)!;
    const view = (key: string, reading = before) => reading.fields.find((f) => f.def.key === key)!;
    assert.equal(view('extent').state, 'proposed', 'the screen shows it, as waiting');
    assert.equal(view('value_at_rate').held?.value ?? null, null, 'the cross-function figure is not worked out from it');
    assert.equal(before.insights.length, 0, 'the rule that compares it with the check is silent');
    assert.equal(view('standing').held?.value ?? null, null, 'and it gives the sheet no standing');
    assert.ok(!buildProjectGraph(p).nodes.some((n) => n.kind === 'field_value' && (n.key === `${HOLDING}::::extent` || n.key === `${HOLDING}::::value_at_rate`)), 'no node in the graph, for it or for what would be worked out from it');
    assert.ok(!memoryFacts(p).held.some((f) => f.id.includes('::field::')), 'no fact in memory');
    assert.equal(view('extent').missing, false, 'it is not counted as empty either: it waits');

    decideField(p, at('extent'), 'accept', LEAD, {}, seat(p, LEAD));
    const after = readSheet(p, HOLDING)!;
    assert.equal(view('extent', after).state, 'accepted');
    assert.equal(view('extent', after).held?.acceptedBy, LEAD);
    assert.equal(view('value_at_rate', after).held?.value, 6272627.5, '6,272.63 sqm at the rate Valuation applied');
    assert.equal(view('standing', after).held?.value, 'Extent differs from the parcel check');
    assert.equal(after.insights.length, 1);
    const graph = buildProjectGraph(p);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.ok(graph.nodes.some((n) => n.kind === 'field_value' && n.key === `${HOLDING}::::extent`), 'one node, keyed by the address');
    assert.ok(graph.edges.some((e) => e.rel === 'same_as'), 'and the mirror of the check’s extent is joined to the check');
    assert.ok(graph.edges.some((e) => e.rel === 'supported_by' && e.to === row.id), 'resting on the paper it was read from');
    assert.ok(memoryFacts(p).held.some((f) => f.id.endsWith(`field::${HOLDING}::::extent`) && f.by !== undefined));
  });

  it('is accepted only by a lead or signer of the function’s department, and typed by anyone who edits there', () => {
    const p = project();
    const row = deed(p);
    proposeFieldValues(p, [{ address: at('extent'), value: 5000, origin: paper(row.id) }], 'model');
    assert.throws(() => decideField(p, at('extent'), 'accept', JUNIOR, {}, seat(p, JUNIOR)), DecisionRefused);
    assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.extent), 'proposed');
    // A contributor types; a person nobody put on the project does not.
    assert.deepEqual(setFieldValues(p, { set: HOLDING }, { tenure: 'freehold' }, JUNIOR, seat(p, JUNIOR)).rejected, []);
    assert.throws(() => setFieldValues(p, { set: HOLDING }, { tenure: 'leasehold' }, 'stranger@else.example', seat(p, 'stranger@else.example')), /does not change it/);
    decideField(p, at('extent'), 'accept', LEAD, {}, seat(p, LEAD));
    assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.extent), 'accepted');
  });

  it('may be accepted with the person’s own figure, set aside, disputed or marked not applicable with one of five reasons', () => {
    const p = project();
    const row = deed(p);
    const offer = (value: unknown) => proposeFieldValues(p, [{ address: at('extent'), value, origin: paper(row.id) }], 'model')[0]!.outcome;

    offer(5000);
    decideField(p, at('extent'), 'accept', LEAD, { value: '5,100 sqm' });
    let held = p.fieldSheets![HOLDING]!.values.extent!;
    assert.equal(held.value, 5100);
    assert.deepEqual(held.origin, { kind: 'person' });
    assert.equal(offer(5000), 'declined', 'the figure they corrected is not offered again');

    // A different reading waits beside the one held, which stays in force until somebody keeps one.
    assert.equal(offer(5200), 'waiting');
    held = p.fieldSheets![HOLDING]!.values.extent!;
    assert.equal(held.value, 5100);
    assert.equal(held.other?.length, 1);
    assert.equal(resolveFields(p).read(at('extent'))?.value, 5100);

    decideField(p, at('extent'), 'dispute', JUNIOR, {}, seat(p, JUNIOR));
    assert.equal(resolveFields(p).read(at('extent')), undefined, 'disputed, neither stands');
    assert.equal(readFunctionFields(p, FN).counts.disputed, 1);
    decideField(p, at('extent'), 'accept', LEAD, { pick: 0 });
    assert.equal(resolveFields(p).read(at('extent'))?.value, 5200);

    assert.throws(() => decideField(p, at('seller'), 'not_applicable', LEAD, { reason: 'because I said so' }), /Pick why/);
    decideField(p, at('tenure'), 'not_applicable', LEAD, { reason: 'exempt' });
    assert.equal(readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'tenure')!.missing, false);
    decideField(p, at('tenure'), 'reopen', LEAD);
    assert.equal(readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'tenure')!.missing, true);
  });

  it('typed over a value accepted from a paper, does not replace it: the two are disputed', () => {
    const p = project();
    const row = deed(p);
    proposeFieldValues(p, [{ address: at('extent'), value: 5000, origin: paper(row.id) }], 'model');
    decideField(p, at('extent'), 'accept', LEAD);
    setFieldValues(p, { set: HOLDING }, { extent: '4,900 sqm' }, JUNIOR);
    const held = p.fieldSheets![HOLDING]!.values.extent!;
    assert.equal(fieldState(held), 'disputed');
    assert.equal(held.value, 5000);
    assert.equal(held.other?.[0]?.value, 4900);
    decideField(p, at('extent'), 'keep', LEAD);
    assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.extent), 'accepted');
  });

  it('on a check, is left out of everything the check works out', () => {
    const p = project();
    const check = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, check.id, { extent_title: 1208, extent_survey: 1161 }, 'tester');
    assert.equal(checkFieldReading(check).insights.length, 1);
    // The same value as a proposal: held, shown, and read by nothing.
    check.fields!.extent_survey = { ...check.fields!.extent_survey!, state: 'proposed', proposedBy: 'model' };
    const reading = checkFieldReading(check);
    assert.equal(reading.insights.length, 0);
    assert.equal(reading.values.extent_survey, undefined);
    assert.equal(reading.held.extent_survey?.value, 1161);
    assert.ok(!reading.missing.some((d) => d.key === 'extent_survey'));
  });
});

describe('prose', () => {
  const remarks = { key: 'remarks', label: 'Remarks', kind: 'longtext', maxLength: 300 } as CheckFieldDef;

  it('is never a model’s, is bounded, and is refused past its bound', () => {
    assert.match((validateFieldValue(remarks, 'A sentence.', { proposer: 'model' }) as { error: string }).error, /written by a person/);
    assert.deepEqual(validateFieldValue(remarks, 'A sentence.', { proposer: 'person' }), { value: 'A sentence.' });
    assert.match((validateFieldValue(remarks, 'x'.repeat(301)) as { error: string }).error, /300 characters at most/);
    const p = project();
    const row = deed(p);
    const [refused] = proposeFieldValues(p, [{ address: at('remarks'), value: 'The title is clean.', origin: paper(row.id) }], 'model');
    assert.equal(refused!.outcome, 'refused');
    assert.equal(p.fieldSheets?.[HOLDING]?.values.remarks, undefined);
  });
});

/* ==================================================================== */
/* B. Kinds, controls, units                                             */
/* ==================================================================== */

describe('units', () => {
  it('keep what was typed and work in the base unit: 1 acre 22 guntas in, the same out', () => {
    const parsed = parseMeasure('1 acre 22 guntas', 'area');
    assert.ok('value' in parsed);
    assert.equal(Math.round(parsed.value), 6273);
    assert.equal(formatMeasure(parsed.value, 'area', { entered: parsed.entered }), '1 acre 22 guntas (6,272.63 sqm)');

    const p = project();
    setFieldValues(p, { set: HOLDING }, { extent: '1 acre 22 guntas' }, LEAD);
    const view = readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'extent')!;
    assert.equal(view.held?.entered?.text, '1 acre 22 guntas');
    assert.equal(view.text, '1 acre 22 guntas (6,272.63 sqm)');
    assert.equal(view.held?.value, 6272.6275);
  });

  it('convert every unit of area, and a ground only where the state gives it a size', () => {
    const sqm = (text: string, state?: string) => {
      const parsed = parseMeasure(text, 'area', { state });
      return 'value' in parsed ? parsed.value : parsed.error;
    };
    assert.equal(sqm('1 hectare'), 10000);
    assert.equal(sqm('100 cents'), 4046.8564);
    assert.equal(sqm('40 guntas'), 4046.8564);
    assert.equal(sqm('2,450 sqft'), 227.6124);
    assert.equal(sqm('1 ground', 'Tamil Nadu'), 222.9673);
    assert.match(String(sqm('1 ground', 'Karnataka')), /no settled size in Karnataka/);
    assert.match(String(sqm('12 bananas')), /not a unit of area/);
    assert.deepEqual(parseMeasure('5 ft 6 in', 'length'), { value: 1.6764, entered: { value: 5, unit: 'ft', text: '5 ft 6 in' } });
  });

  it('write lakh and crore in one place, and read them', () => {
    assert.equal(rupeesSaid(42_000_000), 'Rs 4.2 Cr');
    assert.equal(rupeesSaid(4_500_000), 'Rs 45 lakh');
    assert.deepEqual(parseMeasure('4.2 Cr', 'money'), { value: 42_000_000, entered: { value: 4.2, unit: 'crore' } });
    assert.deepEqual(parseMeasure('45 lakh', 'money'), { value: 4_500_000, entered: { value: 45, unit: 'lakh' } });
    assert.equal(formatFieldValue({ key: 'v', label: 'V', kind: 'computed', dimension: 'money', currency: 'INR' }, { value: 42_000_000, at: '', by: '' }), '₹4.2 Cr');
  });

  it('let a check’s own area and amount be typed with a unit, kept in the unit the check names', () => {
    const p = project();
    const check = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, check.id, { extent_title: '1 acre 22 guntas' }, 'tester');
    assert.equal(check.fields!.extent_title!.value, 6272.63);
    assert.equal(check.fields!.extent_title!.entered?.text, '1 acre 22 guntas');
    recordCheckFields(p, check.id, { extent_survey: '1,161' }, 'tester');
    assert.equal(check.fields!.extent_survey!.value, 1161);
    assert.equal(check.fields!.extent_survey!.entered, undefined);
  });
});

describe('the new kinds', () => {
  it('a choice from a shared list takes its key or its label, refuses anything else and a retired one', () => {
    const p = project();
    assert.deepEqual(setFieldValues(p, { set: HOLDING }, { tenure: 'Freehold' }, LEAD).rejected, []);
    assert.equal(p.fieldSheets![HOLDING]!.values.tenure!.value, 'freehold');
    assert.match(setFieldValues(p, { set: HOLDING }, { tenure: 'allodial' }, LEAD).rejected[0]!.error, /one of: Freehold, Leasehold/);
    assert.match(setFieldValues(p, { set: HOLDING }, { tenure: 'unknown' }, LEAD).rejected[0]!.error, /one of/);
    const row = deed(p);
    assert.equal(proposeFieldValues(p, [{ address: at('tenure'), value: 'allodial', origin: paper(row.id) }], 'model')[0]!.outcome, 'refused');
  });

  it('a link names something on the project, and nothing else', () => {
    const p = project();
    p.stakeholders.push({ id: 'stk_1', name: 'R. Gowda', role: 'Vendor' });
    assert.deepEqual(setFieldValues(p, { set: HOLDING }, { seller: 'stk_1' }, LEAD).rejected, []);
    assert.match(setFieldValues(p, { set: HOLDING }, { seller: 'nobody' }, LEAD).rejected[0]!.error, /not on this project/);
    // A party entered as a shared record is linked to the same way, beside the people the project already lists.
    const { record } = addFieldRecord(p, 'shared.parties', { name: 'Kaveri Estates', kind: 'company', roles: ['vendor'] }, LEAD);
    assert.deepEqual(setFieldValues(p, { set: HOLDING }, { seller: record!.id }, LEAD).rejected, []);
    const shared = readFunctionFields(p, FN).shared.find((s) => s.set.id === 'shared.parties')!;
    assert.deepEqual(shared.records.map((r) => r.title), ['Kaveri Estates']);
    assert.deepEqual(shared.records[0]!.chips, ['Kind company', 'Roles vendor']);
  });

  it('a status is worked out by the rules, is nobody’s to write, and says nothing of an untouched sheet', () => {
    const p = project();
    const standing = () => readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'standing')!;
    assert.equal(standing().held?.value ?? null, null);
    assert.match(setFieldValues(p, { set: HOLDING }, { standing: 'In order' }, LEAD).rejected[0]!.error, /worked out by rule/);
    setFieldValues(p, { set: HOLDING }, { extent: 5000 }, LEAD);
    assert.equal(standing().held?.value, 'Tenure not recorded');
    assert.equal(standing().tone, 'warning');
    setFieldValues(p, { set: HOLDING }, { tenure: 'freehold' }, LEAD);
    assert.equal(standing().held?.value, 'In order');
    assert.equal(standing().tone, 'good');
  });

  it('a mirror reads the field it is entered on, with where that came from, and cannot be written', () => {
    const p = project();
    const row = deed(p);
    recordCheckFields(p, checkOf(p, 'land_site.parcel_identification').id, { extent_title: 5000 }, 'tester', row.id);
    const mirror = readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'extent_on_check')!;
    assert.equal(mirror.held?.value, 5000);
    assert.equal(mirror.source?.kind, 'field');
    assert.match(setFieldValues(p, { set: HOLDING }, { extent_on_check: 1 }, LEAD).rejected[0]!.error, /read here, not written/);
  });
});

/* ==================================================================== */
/* D and E. Records, situations, tiers                                   */
/* ==================================================================== */

describe('records', () => {
  it('are rows with a title and chips, each a sheet of its own, counted by the parent', () => {
    const p = project();
    const a = addFieldRecord(p, OWNERS, { name: 'A. Rao', share_pct: 60, capacity: 'individual' }, LEAD).record!;
    addFieldRecord(p, OWNERS, { name: 'B. Rao', share_pct: 40, capacity: 'minor through a guardian' }, LEAD);
    const page = readFunctionFields(p, FN);
    const owners = page.sheets.find((s) => s.set.id === OWNERS)!.records!;
    assert.deepEqual(owners.map((r) => r.title), ['A. Rao', 'B. Rao']);
    assert.deepEqual(owners[0]!.chips, ['Share 60%', 'Holds as individual']);
    assert.equal(page.sheets.find((s) => s.set.id === HOLDING)!.reading!.fields.find((f) => f.def.key === 'owners_count')!.held?.value, 2);

    // A field that shows by what its own record holds: the guardian of the minor, and of nobody else.
    const guardian = (i: number) => owners[i]!.fields.find((f) => f.def.key === 'guardian')!;
    assert.equal(guardian(0).shown, 'hidden');
    assert.equal(guardian(0).missing, false);
    assert.equal(guardian(1).shown, 'shown');
    assert.equal(guardian(1).missing, true);

    removeFieldRecord(p, OWNERS, a.id, LEAD);
    assert.equal(fieldRecords(p, OWNERS).length, 1);
    assert.equal(p.fieldSheets![OWNERS]!.records!.length, 2, 'taken off the list, and kept');
  });
});

describe('situations', () => {
  it('bring fields into play; a field not in play is never missing; turning one off keeps what was recorded', () => {
    const p = project();
    // The section's must-fields: the day to build by is asked with them and can be left empty.
    const conversion = () => readSheet(p, HOLDING)!.fields.filter((f) => f.def.section === 'conversion' && f.def.required !== false);
    assert.ok(conversion().every((f) => f.shown === 'hidden' && !f.missing));
    assert.equal(readFunctionFields(p, FN).exceptions.filter((e) => e.kind === 'missing' && e.address?.field.startsWith('conversion')).length, 0);

    setSituation(p, FN, 'agricultural_land', true, LEAD, seat(p, LEAD));
    assert.ok(conversion().every((f) => f.shown === 'shown' && f.missing));
    setFieldValues(p, { set: HOLDING }, { conversion_order_no: 'ALN/SR/41/2018', conversion_date: '2018-06-12' }, LEAD);

    setSituation(p, FN, 'agricultural_land', false, LEAD);
    const off = conversion();
    assert.ok(off.every((f) => f.shown === 'hidden' && !f.missing && f.notInPlay), 'not asked, and what was recorded is kept as not in play');
    assert.equal(p.fieldSheets![HOLDING]!.values.conversion_order_no!.value, 'ALN/SR/41/2018');
    assert.equal(readFunctionFields(p, FN).situations[0]!.keptValues, 2);

    setSituation(p, FN, 'agricultural_land', true, LEAD);
    assert.equal(conversion().find((f) => f.def.key === 'conversion_date')!.held?.value, '2018-06-12', 'and it comes back as it was');
  });

  it('are proposed by a paper of the kind that suggests them, and bring nothing into play until a person says yes', () => {
    const p = project();
    const order = deed(p, 'DC conversion order', [{ key: 'conversion_date', label: 'Converted on', value: '2018-06-12', display: '12 Jun 2018', page: 2, quote: 'dated 12.06.2018', source: 'parser' }]);
    assert.deepEqual(proposeSituations(p), ['agricultural_land']);
    assert.equal(p.situations!.agricultural_land!.state, 'proposed');
    assert.equal(p.situations!.agricultural_land!.suggestedBy?.evidenceId, order.id);
    assert.equal(p.situations!.agricultural_land!.suggestedBy?.page, 2);
    const page = readFunctionFields(p, FN);
    assert.equal(page.counts.situation, 1);
    assert.equal(page.sheets[0]!.reading!.fields.find((f) => f.def.key === 'conversion_date')!.shown, 'hidden');
    assert.throws(() => setSituation(p, FN, 'agricultural_land', true, JUNIOR, seat(p, JUNIOR)), DecisionRefused);
    setSituation(p, FN, 'agricultural_land', false, LEAD, seat(p, LEAD));
    assert.deepEqual(proposeSituations(p), [], 'answered, it is not proposed again');
  });

  it('fold expert fields until one holds a value, and never count them', () => {
    const p = project();
    const remarks = () => readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'remarks')!;
    assert.equal(remarks().shown, 'folded');
    assert.equal(remarks().missing, false);
    setFieldValues(p, { set: HOLDING }, { remarks: 'Boundary stones seen on three sides.' }, LEAD);
    assert.equal(remarks().shown, 'shown');
  });

  it('a section marked not applicable asks for none of its fields', () => {
    const p = project();
    setSituation(p, FN, 'agricultural_land', true, LEAD);
    setSectionNotApplicable(p, HOLDING, 'conversion', 'no_such_paper', LEAD);
    const reading = readSheet(p, HOLDING)!;
    assert.ok(reading.fields.filter((f) => f.def.section === 'conversion').every((f) => !f.missing));
    assert.equal(reading.sections.find((s) => s.key === 'conversion')!.na?.reason, 'no_such_paper');
  });
});

/* ==================================================================== */
/* F. What needs a person                                                */
/* ==================================================================== */

describe('a function’s page', () => {
  it('opens on what needs a person, in the order they take it, and feeds the Overview’s line', () => {
    const p = project();
    const row = deed(p);
    assert.deepEqual(fieldsNeeding(p), [], 'an untouched sheet needs nothing of anybody');
    proposeFieldValues(
      p,
      [
        { address: at('extent'), value: 5000, origin: paper(row.id) },
        { address: at('tenure'), value: 'freehold', origin: paper(row.id, 'absolute owner in fee simple') },
        { address: at('possession_verified'), value: true, origin: paper(row.id, 'in vacant possession') },
      ],
      'model',
      undefined,
      // The words of each were found on the page the model named: the server looked, the model did not say so.
      { placed: (_paper, pageNamed) => pageNamed },
    );
    const page = readFunctionFields(p, FN);
    assert.deepEqual([...new Set(page.exceptions.map((e) => e.kind))], ['proposed'], 'what waits is not also counted as empty');
    assert.equal(page.counts.proposed, 3);
    assert.equal(page.exceptions[0]!.source?.page, 3);
    assert.equal(fieldsNeeding(p)[0]!.counts.proposed, 3);
    const needs = projectBrief(p, new Date('2026-10-12T00:00:00Z')).find((line) => line.key === 'needs')!;
    assert.ok(needs.parts.some((part) => part.text === '3 values to accept'));

    // One press takes a paper's values, but for the ones a person has to name: a model's yes or no among them.
    const out = acceptAllFromPaper(p, FN, row.id, LEAD, seat(p, LEAD));
    assert.equal(out.accepted.length, 2);
    assert.deepEqual(out.left.map((a) => a.field), ['possession_verified']);
    assert.throws(() => acceptAllFromPaper(p, FN, row.id, JUNIOR, seat(p, JUNIOR)), DecisionRefused);
  });
});

/* ==================================================================== */
/* H. The tools and the intake                                           */
/* ==================================================================== */

describe('the tools', () => {
  const tools = (p: DdProject) => {
    const bag = { proposals: [] as Array<{ kind: string; payload: Record<string, unknown> }>, navigations: [], toolCalls: [], choices: [] };
    const all = createProjectTools(p, 'tester', bag as never) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    const run = async (name: string, args: unknown) => JSON.parse(await all.find((t) => t.name === name)!.run(args as never, undefined as never));
    return { bag, run };
  };

  it('get_fields describes a function’s fields by address, and says which may be offered a value', async () => {
    const out = await tools(project()).run('get_fields', { fn: FN });
    const holding = out.sheets.find((s: { set: string }) => s.set === HOLDING);
    const field = (key: string) => holding.fields.find((f: { address: FieldAddress }) => f.address.field === key);
    assert.deepEqual(field('extent').address, { fn: FN, set: HOLDING, field: 'extent' });
    assert.deepEqual(field('tenure').options, ['freehold', 'leasehold', 'government_grant', 'inam']);
    assert.equal(field('extent').mayPropose, true);
    for (const key of ['value_at_rate', 'standing', 'extent_on_check', 'remarks']) assert.equal(field(key).mayPropose, false, key);
  });

  it('propose_field_values refuses a value with no source, a field nobody writes, and a paper not on the project', async () => {
    const p = project();
    const row = deed(p);
    const { run } = tools(p);
    const out = await run('propose_field_values', {
      values: [
        { address: at('extent'), value: 5000, origin: { kind: 'paper', evidenceId: row.id, page: 2 } },
        { address: at('extent'), value: 5000, origin: { kind: 'paper', evidenceId: 'ev_nowhere', page: 2, quote: 'measuring' } },
        { address: at('tenure'), value: 'freehold', origin: { kind: 'external', source: 'Kaveri online' } },
        { address: at('value_at_rate'), value: 1, origin: paper(row.id) },
        { address: at('standing'), value: 'In order', origin: paper(row.id) },
        { address: at('extent_on_check'), value: 1, origin: paper(row.id) },
        { address: at('remarks'), value: 'Fine.', origin: paper(row.id) },
        { address: at('tenure'), value: 'leasehold', origin: { kind: 'external', source: 'Kaveri online', asOf: '2026-10-10' } },
        { address: at('extent'), value: 5000, origin: paper(row.id) },
      ],
    });
    assert.deepEqual(out.outcomes.map((o: { outcome: string }) => o.outcome), ['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'waiting', 'waiting']);
    assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.tenure), 'proposed');
    assert.equal(p.fieldSheets![HOLDING]!.values.tenure!.origin?.kind, 'external');
  });

  it('a check’s field is offered as the card a paper’s reading makes, and written by nobody until it is approved', async () => {
    const p = project();
    const row = deed(p);
    const { bag, run } = tools(p);
    const address = { fn: FN, set: 'land_site.parcel_identification', field: 'extent_title' };
    const out = await run('propose_field_values', { values: [{ address, value: 5000, origin: paper(row.id) }] });
    assert.equal(out.outcomes[0].outcome, 'waiting');
    assert.equal(bag.proposals.length, 1);
    assert.equal(bag.proposals[0]!.kind, 'record_check_fields');
    assert.deepEqual(bag.proposals[0]!.payload.values, { extent_title: 5000 });
    assert.equal(checkOf(p, 'land_site.parcel_identification').fields?.extent_title, undefined);
  });
});

describe('a paper put on file', () => {
  const fact = (key: string, value: DocumentFact['value'], more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label: key, value, display: String(value), page: 4, quote: `the ${key} is ${String(value)}`, source: 'parser', ...more });

  it('offers its standing values to every set that reads its kind, and a paper read twice offers nothing twice', () => {
    const p = project();
    const facts = [fact('extent_title', 6273), fact('purchaser', 'A. Rao'), fact('consideration', 42_000_000), fact('order_number', 'ALN/SR/118/2018-19')];
    const row = deed(p, 'Sale deed', facts);
    // Every set that reads a sale deed is offered it. This asks after the worked example's two; a department's own are its test's to ask after.
    const here = (o: { address: { set: string } }) => o.address.set === HOLDING || o.address.set === OWNERS;
    const outcomes = offerPaperToSheets(p, row.id, facts).filter(here);
    // One deed conveys one parcel: its extent is the purchase's, and is never offered as the extent of the whole holding.
    assert.deepEqual(outcomes.map((o) => `${o.address.set}/${o.address.field}:${o.outcome}`), [`${OWNERS}/name:waiting`]);
    assert.equal(p.fieldSheets?.[HOLDING]?.values.extent, undefined);
    const [owner] = fieldRecords(p, OWNERS);
    const held = owner!.values.name!;
    assert.equal(fieldState(held), 'proposed');
    assert.deepEqual(held.origin, { kind: 'paper', evidenceId: row.id, page: 4, quote: 'the purchaser is A. Rao', reader: 'parser' });
    // A new owner, who is nobody until the name is accepted.
    assert.equal(fieldRecords(p, OWNERS).length, 1);
    assert.equal(readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'owners_count')!.held?.value, 0);
    assert.deepEqual(offerPaperToSheets(p, row.id, facts).filter(here), [], 'a paper read twice offers nothing twice');
    assert.equal(fieldRecords(p, OWNERS).length, 1);
    // A sheet that is held once takes its paper's value on the sheet itself: the holding, its conversion order's number.
    const order = [fact('order_number', 'ALN/SR/118/2018-19')];
    const conversion = deed(p, 'DC conversion order', order);
    assert.deepEqual(offerPaperToSheets(p, conversion.id, order).filter(here).map((o) => `${o.address.set}/${o.address.field}:${o.outcome}`), [`${HOLDING}/conversion_order_no:waiting`]);
    assert.deepEqual(offerPaperToSheets(p, conversion.id, order).filter(here).map((o) => o.outcome), ['held']);
  });

  it('hands on nothing a model read that nobody has accepted on the paper, and nothing from a paper of another kind', () => {
    const p = project();
    const waiting = [fact('extent_title', 6273, { source: 'model', review: 'proposed' })];
    assert.deepEqual(offerPaperToSheets(p, deed(p, 'Sale deed', waiting).id, waiting), []);
    const khata = [fact('extent_title', 6273)];
    assert.deepEqual(offerPaperToSheets(p, deed(p, 'Khata certificate and extract', khata).id, khata), []);
  });
});

/* ==================================================================== */
/* Roles and reach; old projects                                         */
/* ==================================================================== */

describe('somebody working from a grant', () => {
  const grant = (scopeKeys: ProjectGrant['scopeKeys']): ProjectGrant =>
    ({ id: 'g1', tenantId: 't1', projectId: 'p1', email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys, areas: [], createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'owner' }) as ProjectGrant;

  it('is handed a function’s sheets only where their grant reaches the function, and no citation of a paper they cannot see', () => {
    const p = project();
    const row = deed(p);
    proposeFieldValues(p, [{ address: at('extent'), value: 5000, origin: paper(row.id) }], 'model');
    decideField(p, at('extent'), 'accept', LEAD);
    addFieldRecord(p, OWNERS, { name: 'A. Rao' }, LEAD);
    setSituation(p, FN, 'agricultural_land', true, LEAD);

    const outside = projectView(p, { kind: 'granted', grant: grant(['technical']), email: 'sam@site.example' }).project;
    assert.deepEqual(outside.fieldSheets, {});
    assert.deepEqual(outside.situations, {});
    assert.deepEqual(fieldsNeeding(outside), []);

    const inside = projectView(p, { kind: 'granted', grant: grant(['legal']), email: 'sam@site.example' }).project;
    assert.deepEqual(Object.keys(inside.fieldSheets!).sort(), [HOLDING, OWNERS]);
    assert.equal(inside.situations!.agricultural_land!.state, 'on');
    // The deed is linked to no check in their reach, so it is not on their copy: the value is, its citation is not.
    const held = inside.fieldSheets![HOLDING]!.values.extent!;
    assert.equal(held.value, 5000);
    assert.equal(held.origin, undefined);
    assert.equal(held.sourceEvidenceId, undefined);
    assert.equal(held.quote, undefined);
  });
});

describe('a project saved before any of this', () => {
  it('loads, and its checks read as they did', () => {
    const p = project();
    const check = checkOf(p, 'land_site.parcel_identification');
    const row = deed(p);
    // As an older build wrote them: a value with its paper, a value without, and nothing else on either.
    check.fields = {
      extent_title: { value: 1208, at: '2026-08-01T00:00:00.000Z', by: 'tester', sourceEvidenceId: row.id, page: 2, quote: 'measuring 1208 sqm' },
      extent_khata: { value: 1161, at: '2026-08-01T00:00:00.000Z', by: 'tester' },
    };
    const saved = JSON.parse(JSON.stringify(p)) as DdProject;
    assert.equal(saved.fieldSheets, undefined);
    assert.equal(saved.situations, undefined);
    ensureProjectShape(saved);

    const reading = checkFieldReading(checkOf(saved, 'land_site.parcel_identification'));
    assert.equal(fieldState(reading.held.extent_title), 'accepted', 'cited: it reads as accepted');
    assert.equal(fieldState(reading.held.extent_khata), 'typed', 'not cited: it reads as typed');
    assert.deepEqual(reading.values.extent_title, reading.held.extent_title, 'and both stand as they did');
    assert.equal(reading.filled, 2);
    assert.deepEqual(reading.missing.map((d) => d.key), ['survey_numbers', 'extent_survey']);
    assert.equal(formatFieldValue(reading.defs.find((d) => d.key === 'extent_title')!, reading.values.extent_title), '1,208 sqm');

    const page = readFunctionFields(saved, FN);
    assert.equal(page.counts.proposed + page.counts.disputed, 0);
    assert.deepEqual(fieldsNeeding(saved), []);
    assert.deepEqual(validateProjectGraph(buildProjectGraph(saved)), []);
    assert.ok(!buildProjectGraph(saved).nodes.some((n) => n.kind === 'field_value'), 'a project with no sheets draws no field values');
  });

  it('a value under a key nothing declares any more is kept through a save of another key', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { tenure: 'freehold' }, LEAD);
    (p.fieldSheets![HOLDING]!.values as Record<string, CheckFieldValue>).a_key_from_another_build = { value: 7, at: '', by: 'preview' };
    setFieldValues(p, { set: HOLDING }, { tenure: 'leasehold' }, LEAD);
    assert.equal(p.fieldSheets![HOLDING]!.values.a_key_from_another_build!.value, 7);
  });

  it('a choice once offered on a check still reads, and is no longer taken', () => {
    const p = project();
    const check = checkOf(p, 'regulatory.land_use');
    check.fields = { conversion_status: { value: 'not applicable', at: '', by: 'tester' } };
    assert.equal(checkFieldReading(check).values.conversion_status!.value, 'not applicable');
    assert.match(recordCheckFields(p, check.id, { conversion_status: 'unknown' }, 'tester').rejected[0]!.error, /no longer a choice/);
    assert.deepEqual(recordCheckFields(p, check.id, { conversion_status: 'converted' }, 'tester').rejected, []);
  });
});

describe('formulas keep their old answers', () => {
  it('a field of another set reads nothing where the caller cannot reach it', () => {
    const formula = { op: 'field', key: 'x', at: { fn: 'finance.valuation', set: 's', field: 'x' } } as const;
    assert.equal(evaluateFormula(formula, { x: { value: 5, at: '', by: '' } }), null);
  });
});
