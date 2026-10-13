/**
 * Law and Liaison's field sets, as a person meets them (docs/fields.md).
 *
 * The catalog is held to its limits, and three functions are walked through
 * on an invented project: a joint development whose allocation does not
 * match the agreement, a RERA registration with a filing calendar, and a
 * plan sanction under revision. Each asserts what shows with no situation
 * in play, what a situation brings in, a worked-out value and a standing
 * with their inputs, a rule failing and then passing, and the rule row a
 * figure came from, said to be unverified.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  addFieldRecord,
  catalogFaults,
  catalogLimits,
  createAssessment,
  createProject,
  fieldCatalog,
  fieldRecords,
  fieldSetsOf,
  offerPaperToSheets,
  proposeSituations,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  ruleRowFaults,
  setFieldValues,
  setSituation,
  addEvidence,
  type DdProject,
} from '@realytica/shared';
import { LAW_LIAISON_FIELD_SETS } from '../packages/shared/src/operating-model/field-sets/law-liaison';
import { LAW_LIAISON_RULE_ROWS } from '../packages/shared/src/operating-model/field-sets/rules/law-liaison';

const NOW = new Date('2026-10-12T00:00:00Z');

function project(): DdProject {
  const p = createProject({ name: 'Lakeside Residences', type: 'residential', location: 'Lakeside Road', city: 'Bengaluru' }, 'RYT-LAW');
  p.jurisdiction = 'Karnataka';
  p.stakeholders.push(
    { id: 'stk_owner', name: 'R. Hegde', role: 'Land owner' },
    { id: 'stk_dev', name: 'Lakeside Homes LLP', role: 'Developer' },
    { id: 'stk_auth', name: 'Planning authority', role: 'Authority' },
  );
  createAssessment(p, { ddType: 'acquisition', name: 'Land diligence', owner: 'Lead', targetType: 'project' });
  return p;
}

/** A value on a check's own fields, where a sheet's is not: Liaison mirrors what the approvals checks already keep. */
const onCheck = (p: DdProject, definitionId: string, values: Record<string, unknown>) => {
  const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;
  recordCheckFields(p, check.id, values, 'tester');
};
const write = (p: DdProject, set: string, values: Record<string, unknown>, record?: string) => {
  if (fieldCatalog().checks.has(set)) return onCheck(p, set, values);
  assert.deepEqual(setFieldValues(p, { set, ...(record ? { record } : {}) }, values, 'tester').rejected, []);
};
const add = (p: DdProject, set: string, values: Record<string, unknown>) => {
  const made = addFieldRecord(p, set, values, 'tester');
  assert.deepEqual(made.rejected, []);
  return made.record!;
};
const sheet = (p: DdProject, set: string, record?: string) => {
  const reading = readSheet(p, set, record, undefined, fieldCatalog(), NOW)!;
  const view = (key: string) => reading.fields.find((f) => f.def.key === key)!;
  return {
    reading,
    view,
    value: (key: string) => view(key).held?.value ?? null,
    text: (key: string) => view(key).text,
    shown: reading.fields.filter((f) => f.shown === 'shown').map((f) => f.def.key),
    missing: reading.fields.filter((f) => f.missing).map((f) => f.def.key),
    said: reading.insights.map((i) => i.text),
  };
};
const page = (p: DdProject, fn: string) => readFunctionFields(p, fn, NOW);

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

describe('Law and Liaison’s catalog', () => {
  const mine = new Set(LAW_LIAISON_FIELD_SETS.map((set) => set.id));

  it('has no fault and breaks no limit, set by set', () => {
    assert.deepEqual(catalogFaults().filter((fault) => [...mine].some((id) => fault.startsWith(id))), []);
    assert.deepEqual(catalogFaults(), []);
    assert.deepEqual(catalogLimits().filter((breach) => mine.has(breach.set)), []);
    assert.deepEqual(ruleRowFaults(LAW_LIAISON_RULE_ROWS), []);
  });

  it('covers every function of the two departments, inside Legal’s own workstreams', () => {
    const byFn = (fn: string) => fieldSetsOf(fn).map((set) => set.id).filter((id) => mine.has(id));
    assert.deepEqual(byFn('legal.contracts'), [
      'legal.contracts.land',
      'legal.contracts.purchases',
      'legal.contracts.obligations',
      'legal.contracts.jda',
      'legal.contracts.jda_delivery',
      'legal.contracts.attorneys',
      'legal.contracts.sale_agreement',
    ]);
    assert.deepEqual(byFn('legal.rera'), ['legal.rera.registration', 'legal.rera.phases', 'legal.rera.compliance', 'legal.rera.filings']);
    assert.deepEqual(byFn('legal.handover'), ['legal.handover.conveyance']);
    assert.deepEqual(byFn('legal.approvals'), [
      'legal.approvals.register',
      'legal.approvals.stop_orders',
      'legal.approvals.land_use',
      'legal.approvals.sanction',
      'legal.approvals.revisions',
      'legal.approvals.deviations',
      'legal.approvals.occupancy',
      'legal.approvals.height_fire',
      'legal.approvals.environment',
      'legal.approvals.utilities',
      'legal.approvals.lifts',
    ]);
  });

  it('keeps one approval record for every authority, and one building and one unit, by adding to the shared ones', () => {
    const catalog = fieldCatalog();
    const approval = catalog.sets.get('shared.approvals')!;
    for (const key of ['depends_on', 'fees', 'fees_total', 'queries', 'follow_ups', 'decision_due', 'days_left', 'renew_by']) assert.ok(approval.fields.some((f) => f.key === key), key);
    assert.ok(approval.fields.length <= 20, `an approval has ${approval.fields.length} fields`);
    assert.equal(approval.fields.find((f) => f.key === 'follow_ups')!.display, 'timeline');
    assert.ok(catalog.sets.get('shared.buildings')!.fields.some((f) => f.key === 'sanctioned_height'));
    assert.ok(catalog.sets.get('shared.units')!.fields.some((f) => f.key === 'allotted_to'));
    assert.equal(catalog.sets.has('legal.approvals.approval'), false, 'it is not a second register');
  });

  it('declares every rule row unverified, with the regulation it is written in', () => {
    assert.ok(LAW_LIAISON_RULE_ROWS.length >= 15);
    for (const row of LAW_LIAISON_RULE_ROWS) {
      assert.equal(row.verified, false, row.key);
      assert.ok(row.source.regulation.length > 10, row.key);
    }
  });

  it('holds no prose a model could write: at most one bounded note a sheet, and none here', () => {
    for (const set of LAW_LIAISON_FIELD_SETS) assert.deepEqual(set.fields.filter((f) => f.kind === 'longtext').map((f) => f.key), [], set.id);
  });

  it('types no RERA figure: what a filing reports is read from the function that keeps it', () => {
    const catalog = fieldCatalog();
    const position = catalog.sets.get('legal.rera.compliance')!.fields.filter((f) => f.section === 'position');
    assert.ok(position.length >= 4);
    for (const def of position) assert.ok(def.sameAs || def.kind === 'computed', `${def.key} is typed in Law`);
    const filing = catalog.sets.get('legal.rera.filings')!;
    assert.deepEqual(filing.fields.filter((f) => ['number', 'money', 'percent', 'area'].includes(f.kind)).map((f) => f.key), []);
  });
});

/* ==================================================================== */
/* Law: a joint development                                              */
/* ==================================================================== */

describe('Contracts: a joint development whose allocation does not match the agreement', () => {
  const JDA = 'legal.contracts.jda';
  const DELIVERY = 'legal.contracts.jda_delivery';

  it('shows a project with no agreement on file seven fields, and asks for none of them', () => {
    const p = project();
    const fields = page(p, 'legal.contracts');
    const shown = fields.sheets.flatMap((s) => (s.reading ? s.reading.fields.filter((f) => f.shown === 'shown').map((f) => `${s.set.id}/${f.def.key}`) : []));
    assert.deepEqual(shown.filter((key) => key.startsWith('legal.contracts.jda')), [], 'nothing of the joint development shows');
    assert.deepEqual(sheet(p, 'legal.contracts.land').shown, ['purchases_count', 'land_bought', 'land_secured', 'land_on_parcel_check', 'consideration_total', 'obligations_open', 'obligations_overdue']);
    assert.deepEqual(sheet(p, 'legal.contracts.land').missing, [], 'every one of them is worked out or read from Title');
    assert.deepEqual(sheet(p, JDA).missing, [], 'a hidden field is not counted missing');
    assert.equal(sheet(p, JDA).reading.total, 0);
    assert.deepEqual(sheet(p, 'legal.contracts.sale_agreement').shown, ['template', 'version', 'follows_model', 'possession_promised', 'declared_completion', 'delay_interest_spread', 'agreement_standing']);
  });

  it('is proposed by the agreement on file, and brings nothing in until a person accepts it', () => {
    const p = project();
    const paper = addEvidence(p, { title: 'Joint development agreement 2025', kind: 'document' }, 'tester');
    paper.documentType = 'Joint development agreement';
    paper.attachments = [{ id: 'f_jda', fileName: 'jda.pdf', mimeType: 'application/pdf', sizeBytes: 2048, storageKey: 'test-jda', uploadedAt: '2026-10-08T00:00:00.000Z', uploadedBy: 'tester' } as never];
    assert.ok(proposeSituations(p).includes('joint_development'));
    assert.equal(page(p, 'legal.contracts').situations.find((s) => s.at === 'joint_development')!.state, 'proposed');
    assert.equal(sheet(p, JDA).shown.length, 0);
    setSituation(p, 'legal.contracts', 'joint_development', true, 'tester');
    const terms = sheet(p, JDA);
    assert.deepEqual(terms.shown, ['developer', 'jda_date', 'jda_doc_no', 'jda_model', 'owner_share', 'developer_share', 'share_basis', 'land_extent', 'land_on_parcel_check', 'agreement', 'jda_standing', 'refundable_deposit', 'non_refundable_deposit', 'deposit_refund_on', 'delay_compensation']);
    assert.equal(terms.reading.fields.filter((f) => f.shown === 'folded').length, 5, 'duty, the FAR assumed, mortgage, termination and disputes stay folded');
    assert.equal(terms.view('jda_model').def.control, 'tiles');
    assert.ok(terms.missing.includes('owner_share'));
  });

  it('works the developer’s share and the dates out, and says when the agreement is not registered', () => {
    const p = project();
    setSituation(p, 'legal.contracts', 'joint_development', true, 'tester');
    write(p, JDA, { developer: 'stk_dev', jda_date: '2025-01-15', jda_model: 'area_share', owner_share: 40, share_basis: 'carpet_area', land_extent: '2 acres' });
    const unregistered = sheet(p, JDA);
    assert.equal(unregistered.value('developer_share'), 60);
    assert.equal(unregistered.value('jda_standing'), 'Not registered');
    assert.equal(unregistered.view('jda_standing').tone, 'critical');
    assert.deepEqual(unregistered.said, ['The agreement dated 2025-01-15 has no registration number recorded.']);
    write(p, JDA, { jda_doc_no: 'BNG-1-01234-2024-25' });
    assert.equal(sheet(p, JDA).value('jda_standing'), 'Registered');
    assert.deepEqual(sheet(p, JDA).said, []);
    // A folded field that holds a value shows, and its rule reads the sanction Liaison's check keeps.
    write(p, JDA, { far_assumed: 2.5 });
    write(p, 'regulatory.sanction', { sanctioned_far: 2.25 });
    assert.equal(sheet(p, JDA).view('far_assumed').shown, 'shown');
    assert.deepEqual(sheet(p, JDA).said, ['The agreement assumes an FAR of 2.5 and 2.25 is sanctioned. Both shares are worked on the first.']);
    write(p, JDA, { far_assumed: 2.25 });
    assert.deepEqual(sheet(p, JDA).said, []);

    // The dates the agreement sets, against the sanction Liaison records and the forecast Construction keeps.
    write(p, DELIVERY, { sanction_due_months: 9, build_months: 36, grace_months: 6 });
    write(p, 'regulatory.sanction', { sanction_date: '2025-12-01' });
    const dates = sheet(p, DELIVERY);
    assert.equal(dates.value('sanction_due'), '2025-10-15');
    assert.equal(dates.value('completion_due'), '2029-06-01');
    assert.equal(dates.value('delivery_standing'), 'Sanction came late');
    assert.deepEqual(dates.said, ['The plan was sanctioned on 2025-12-01, after the 2025-10-15 the agreement allows.']);
    write(p, 'regulatory.sanction', { sanction_date: '2025-09-20' });
    assert.equal(sheet(p, DELIVERY).value('delivery_standing'), 'Within the agreement');
    assert.equal(sheet(p, DELIVERY).value('completion_due'), '2029-03-20');
  });

  it('compares the units allotted with the share agreed, failing and then passing', () => {
    const p = project();
    setSituation(p, 'legal.contracts', 'joint_development', true, 'tester');
    write(p, JDA, { jda_model: 'area_share', owner_share: 40 });
    const unit = (number: string, carpet: number, to: string) => add(p, 'shared.units', { number, carpet_area: `${carpet} sqm`, allotted_to: to });
    unit('A-101', 100, 'owner');
    unit('A-102', 100, 'developer');
    unit('A-103', 100, 'developer');
    const last = unit('A-104', 100, 'developer');
    const short = sheet(p, DELIVERY);
    assert.equal(short.value('owner_units'), 1);
    assert.equal(short.value('developer_units'), 3);
    assert.equal(short.value('owner_area_share'), 25);
    assert.equal(short.value('owner_share_agreed'), 40);
    assert.deepEqual(short.said, ['The units allotted give the owners 25 % of the carpet area and the agreement gives them 40%: 37.5% apart, outside 1.0%.']);
    assert.equal(page(p, 'legal.contracts').exceptions.filter((e) => e.kind === 'rule' && /units allotted/.test(e.text)).length, 1);

    write(p, 'shared.units', { allotted_to: 'owner', carpet_area: '166.67 sqm' }, last.id);
    const even = sheet(p, DELIVERY);
    assert.equal(even.value('owner_area_share'), 57.14);
    write(p, 'shared.units', { carpet_area: '33.33 sqm' }, last.id);
    assert.equal(sheet(p, DELIVERY).value('owner_area_share'), 40);
    assert.deepEqual(sheet(p, DELIVERY).said, []);
  });

  it('keeps a purchase as a record: an agreement to sell carries the day a suit must be brought by, from an unverified row', () => {
    const p = project();
    const deal = add(p, 'legal.contracts.purchases', { deal: 'North parcel', instrument: 'agreement_to_sell', purchaser: 'stk_dev', agreement_date: '2025-03-01', extent_conveyed: '1 acre', consideration: '4.2 Cr', long_stop_date: '2025-09-01', possession_date: '2025-04-10' });
    const record = sheet(p, 'legal.contracts.purchases', deal.id);
    assert.equal(record.value('suit_by'), '2028-09-01');
    assert.deepEqual(record.view('suit_by').cites?.map((c) => [c.key, c.value, c.verified, c.source.clause]), [['specific_performance_suit_years', 3, false, 'Schedule, article 54']]);
    assert.equal(record.value('standing'), 'Possession without registration');
    assert.deepEqual(record.missing, ['vendors', 'deed', 'schedule'], 'registration is not asked of an agreement to sell');
    const land = sheet(p, 'legal.contracts.land');
    assert.equal(land.value('purchases_count'), 1);
    assert.equal(land.text('consideration_total'), '₹4.2 Cr');
    assert.equal(land.value('agreements_to_complete'), 1);
    assert.equal(land.view('agreements_to_complete').shown, 'shown', 'the situation follows from the record');

    write(p, 'legal.contracts.purchases', { instrument: 'sale_deed', doc_no: 'BNG-4-00771-2025-26', registration_date: '2025-10-05' }, deal.id);
    const conveyed = sheet(p, 'legal.contracts.purchases', deal.id);
    assert.equal(conveyed.value('standing'), 'In order');
    assert.equal(conveyed.view('suit_by').shown, 'hidden');
    assert.equal(sheet(p, 'legal.contracts.land').view('agreements_to_complete').shown, 'hidden');
  });

  it('is offered a sale deed’s own figures as a purchase that is nothing until a person accepts one, and never twice', () => {
    const p = project();
    const deed = addEvidence(p, { title: 'Sale deed 2025', kind: 'document' }, 'tester');
    deed.documentType = 'Sale deed';
    const fact = (key: string, value: string | number) => ({ key, label: key, value, display: String(value), page: 3, quote: `the ${key} is ${value}`, source: 'parser' as const });
    const facts = [fact('extent_title', 4047), fact('consideration', 42_000_000), fact('document_number', 'BNG-4-00771-2025-26')];
    const mine = (o: { address: { set: string } }) => o.address.set === 'legal.contracts.purchases';
    assert.deepEqual(offerPaperToSheets(p, deed.id, facts).filter(mine).map((o) => `${o.address.field}:${o.outcome}`), ['doc_no:waiting', 'extent_conveyed:waiting', 'consideration:waiting']);
    assert.equal(fieldRecords(p, 'legal.contracts.purchases').length, 1);
    assert.equal(sheet(p, 'legal.contracts.land').value('purchases_count'), 0, 'a purchase nobody has accepted a value of is not one yet');
    const offered = page(p, 'legal.contracts').exceptions.filter((e) => e.kind === 'proposed');
    assert.deepEqual(offered.map((e) => [e.label, e.source?.label, e.source?.page]), [['Document number', 'Sale deed 2025', 3], ['Extent conveyed', 'Sale deed 2025', 3], ['Consideration', 'Sale deed 2025', 3]]);
    assert.equal(offerPaperToSheets(p, deed.id, facts).filter(mine).some((o) => o.outcome === 'waiting'), false);
    assert.equal(fieldRecords(p, 'legal.contracts.purchases').length, 1);
  });

  it('counts an obligation overdue from its day, and done once it is', () => {
    const p = project();
    const owed = add(p, 'legal.contracts.obligations', { kind: 'plan_sanction', arises_under: 'joint_development', owed_by: 'stk_dev', due_on: '2026-09-30' });
    assert.equal(sheet(p, 'legal.contracts.obligations', owed.id).value('days_overdue'), 12);
    assert.equal(sheet(p, 'legal.contracts.obligations', owed.id).value('standing'), 'Overdue');
    assert.equal(sheet(p, 'legal.contracts.land').value('obligations_overdue'), 1);
    assert.deepEqual(page(p, 'legal.contracts').exceptions.filter((e) => e.kind === 'rule').map((e) => `${e.sheet}: ${e.text}`), ['Conditions and obligations · Obtain plan sanction: Overdue'], 'said once, on the obligation');
    write(p, 'legal.contracts.obligations', { done_on: '2026-10-10' }, owed.id);
    assert.equal(sheet(p, 'legal.contracts.obligations', owed.id).value('standing'), 'Done');
    assert.equal(sheet(p, 'legal.contracts.land').value('obligations_overdue'), 0);
  });
});

/* ==================================================================== */
/* Law: RERA                                                             */
/* ==================================================================== */

describe('RERA: a registration and its filing calendar', () => {
  const REG = 'legal.rera.registration';

  it('opens on eleven fields to fill and one standing, with the complex cases out of sight', () => {
    const p = project();
    const reg = sheet(p, REG);
    assert.deepEqual(reg.shown, ['promoter', 'application_no', 'applied_on', 'registration_no', 'registered_on', 'registration_valid_to', 'declared_completion', 'validity_days_left', 'designated_account', 'professionals', 'certificate', 'registration_standing']);
    assert.equal(reg.reading.total, 10);
    for (const key of ['extension_applied_on', 'extended_to', 'landowner_promoters']) assert.equal(reg.view(key).shown, 'hidden', key);
    for (const key of ['project_kind', 'development_works', 'past_projects']) assert.equal(reg.view(key).shown, 'folded', key);
    assert.equal(sheet(p, 'legal.rera.compliance').shown.length, 0, 'nothing of compliance shows before a registration number is recorded');
  });

  it('says a registration is running out, opens the extension, and holds the extension to the Act’s limit', () => {
    const p = project();
    write(p, REG, { application_no: 'ACK/KA/RERA/1251/308/PR/090124/006543', registration_no: 'PRM/KA/RERA/1251/308/PR/150324/006712', registered_on: '2024-03-15', registration_valid_to: '2027-01-31', declared_completion: '2027-06-30' });
    const first = sheet(p, REG);
    assert.equal(first.value('validity_days_left'), 111);
    assert.equal(first.value('registration_standing'), 'Ends before the declared completion');
    assert.deepEqual(first.said, ['Completion is declared for 2027-06-30, after the registration ends on 2027-01-31.']);
    assert.equal(first.view('extended_to').shown, 'shown', 'under 181 days the extension fields are in play');
    assert.equal(first.value('extension_limit'), '2028-01-31');
    assert.equal(first.view('extension_limit').cites?.[0]?.verified, false);

    write(p, REG, { extended_to: '2028-06-30', declared_completion: '2026-12-31' });
    assert.deepEqual(sheet(p, REG).said, ['Extended to 2028-06-30, past the 2028-01-31 the Act allows in all.']);
    write(p, REG, { extended_to: '2027-12-31' });
    const extended = sheet(p, REG);
    assert.deepEqual(extended.said, []);
    assert.equal(extended.value('registration_standing'), 'Registered');
    assert.equal(extended.value('validity_days_left'), 445);
    assert.equal(extended.view('extended_to').shown, 'shown', 'an extension granted stays in view');
  });

  it('works out whether registration is needed from two floors in the rule table, both unverified', () => {
    const p = project();
    write(p, 'land_site.parcel_identification', { extent_title: 450 });
    write(p, 'commercial_market.absorption', { units_total: 12 });
    assert.equal(sheet(p, REG).value('registration_needed'), 'Not needed at this size');
    write(p, 'land_site.parcel_identification', { extent_title: 4200 });
    const needed = sheet(p, REG);
    assert.equal(needed.value('units_over_floor'), 4);
    assert.equal(needed.value('registration_needed'), 'Needed');
    assert.deepEqual(needed.view('registration_needed').cites?.map((c) => [c.key, c.value, c.verified]).sort(), [['rera_registration_land_floor', 500, false], ['rera_registration_units_floor', 8, false]]);
  });

  it('dates each filing from the rule table, and counts what is overdue', () => {
    const p = project();
    write(p, REG, { registration_no: 'PRM/KA/RERA/1251/308/PR/150324/006712' });
    const q2 = add(p, 'legal.rera.filings', { period_end: '2026-06-30', kind: 'quarterly', filed_on: '2026-07-10' });
    const q3 = add(p, 'legal.rera.filings', { period_end: '2026-09-30', kind: 'quarterly' });
    const year = add(p, 'legal.rera.filings', { period_end: '2026-03-31', kind: 'annual', filed_on: '2026-10-05' });
    assert.equal(sheet(p, 'legal.rera.filings', q2.id).value('filing_due'), '2026-07-15');
    assert.equal(sheet(p, 'legal.rera.filings', q2.id).value('standing'), 'Filed in time');
    assert.deepEqual(sheet(p, 'legal.rera.filings', q2.id).view('filing_due').cites?.map((c) => [c.key, c.verified]), [['rera_quarterly_filing_days', false]]);
    assert.equal(sheet(p, 'legal.rera.filings', q3.id).value('filing_due'), '2026-10-15');
    assert.equal(sheet(p, 'legal.rera.filings', q3.id).value('standing'), 'Open');
    assert.equal(sheet(p, 'legal.rera.filings', year.id).value('filing_due'), '2026-09-30');
    assert.equal(sheet(p, 'legal.rera.filings', year.id).value('days_late'), 5);
    assert.equal(sheet(p, 'legal.rera.filings', year.id).value('standing'), 'Filed late');
    assert.equal(sheet(p, 'legal.rera.filings', year.id).view('architect_certificate').shown, 'hidden', 'the yearly statement is the accountant’s alone');

    const later = new Date('2026-10-20T00:00:00Z');
    const reading = readSheet(p, 'legal.rera.compliance', undefined, undefined, fieldCatalog(), later)!;
    const held = (key: string) => reading.fields.find((f) => f.def.key === key)!.held?.value;
    assert.equal(held('filings_made'), 2);
    assert.equal(held('filings_overdue'), 1);
    assert.deepEqual(readFunctionFields(p, 'legal.rera', later).exceptions.filter((e) => e.kind === 'rule' && e.tone === 'critical').map((e) => `${e.sheet}: ${e.text}`), ['Filings · 2026-09-30: Overdue']);
    write(p, 'legal.rera.filings', { filed_on: '2026-10-19' }, q3.id);
    assert.equal(readSheet(p, 'legal.rera.compliance', undefined, undefined, fieldCatalog(), later)!.fields.find((f) => f.def.key === 'filings_overdue')!.held?.value, 0);
  });

  it('reads what the next filing will say from Sales, Finance and Construction, and cites the deposit share', () => {
    const p = project();
    write(p, REG, { registration_no: 'PRM/KA/RERA/1251/308/PR/150324/006712' });
    write(p, 'commercial_market.absorption', { units_total: 96 });
    const position = sheet(p, 'legal.rera.compliance');
    assert.equal(position.value('units_total'), 96);
    assert.equal(position.view('units_total').source?.kind, 'field');
    assert.equal(position.value('deposit_share'), 70);
    assert.equal(position.view('deposit_share').cites?.[0]?.source.clause, 'section 4(2)(l)(D)');
    assert.deepEqual(position.missing, [], 'none of it is asked of Law');
  });

  it('dates the conveyance from the occupancy certificate, and says when it is late', () => {
    const p = project();
    assert.equal(sheet(p, 'legal.handover.conveyance').value('conveyance_standing'), null, 'no standing before there is a certificate');
    write(p, 'regulatory.occupancy', { oc_issued: true, oc_date: '2026-05-20' });
    const due = sheet(p, 'legal.handover.conveyance');
    assert.equal(due.value('conveyance_due'), '2026-08-20');
    assert.equal(due.view('conveyance_due').cites?.[0]?.verified, false);
    assert.equal(due.value('conveyance_days_late'), 53);
    assert.equal(due.value('conveyance_standing'), 'Late');
    write(p, 'legal.handover.conveyance', { conveyed_on: '2026-08-11' });
    assert.equal(sheet(p, 'legal.handover.conveyance').value('conveyance_standing'), 'In time');
    assert.deepEqual(sheet(p, 'legal.handover.conveyance').said, ['The common areas are recorded as conveyed on 2026-08-11, with no deed filed.']);
  });
});

/* ==================================================================== */
/* Liaison: a plan sanction under revision                               */
/* ==================================================================== */

describe('Approvals: a plan sanction that is being revised', () => {
  const SANCTION = 'legal.approvals.sanction';
  const REVISIONS = 'legal.approvals.revisions';
  const HEIGHT = 'legal.approvals.height_fire';
  const ENVIRONMENT = 'legal.approvals.environment';

  function sanctioned(): DdProject {
    const p = project();
    write(p, 'regulatory.sanction', { sanction_date: '2024-03-12', sanction_valid_to: '2028-03-11', sanctioned_area: 19800, sanctioned_far: 2.25, permissible_far: 2.25 });
    add(p, 'shared.buildings', { name: 'Tower A', floors: 14, sanctioned_height: '44.8 m', sanctioned_units: 56 });
    add(p, 'shared.buildings', { name: 'Tower B', floors: 10, sanctioned_height: '32 m', sanctioned_units: 40 });
    return p;
  }

  it('shows no more than twelve fields on any sheet of a project with nothing unusual, and no revision, deviation or renewal field', () => {
    // A low building on converted land: no situation is in play, and no sheet shows more than twelve fields.
    const low = project();
    write(low, 'regulatory.sanction', { sanction_date: '2024-03-12', sanction_valid_to: '2028-03-11', sanctioned_area: 1800 });
    add(low, 'shared.buildings', { name: 'Block A', floors: 4, sanctioned_height: '14.9 m', sanctioned_units: 8 });
    const plain = page(low, 'legal.approvals');
    assert.deepEqual(plain.situations.filter((s) => s.state !== 'off').map((s) => s.at), []);
    for (const { set, reading } of plain.sheets) {
      if (!reading) continue;
      const shown = reading.fields.filter((f) => f.shown === 'shown').length;
      assert.ok(shown <= 12, `${set.id} shows ${shown}`);
    }
    assert.equal(sheet(low, 'legal.approvals.height_fire').value('high_rise'), 'Not a high-rise');
    assert.equal(sheet(low, 'legal.approvals.height_fire').view('fire_noc').shown, 'hidden');
    assert.equal(sheet(low, 'legal.approvals.environment').value('consent_applies'), 'Not needed at this size');
    assert.equal(sheet(low, 'legal.approvals.utilities').value('inspection_applies'), 'Not needed at this height');
    assert.equal(plain.counts.rule, 0, 'and nothing is failing');

    const p = sanctioned();
    const plan = sheet(p, SANCTION);
    assert.deepEqual(plan.shown, ['sanction', 'sanction_date', 'sanction_valid_to', 'sanction_days_left', 'sanctioned_area', 'sanctioned_far', 'plot_area_per_plan', 'land_on_parcel_check', 'tallest', 'units_sanctioned', 'sanctioned_plan', 'sanction_standing']);
    for (const key of ['renewal_applied_on', 'revisions_count', 'deviations_over_limit']) assert.equal(plan.view(key).shown, 'hidden', key);
    assert.deepEqual(plan.missing, ['sanction', 'plot_area_per_plan', 'sanctioned_plan'], 'three things are asked of a person; the rest is read or worked out');
    assert.equal(plan.text('tallest'), '44.8 m');
    assert.equal(plan.value('units_sanctioned'), 96);
    assert.equal(plan.value('sanction_days_left'), 516);
    assert.equal(plan.value('sanction_standing'), 'In force');

    // Inside six months of its end the renewal comes into play, and nobody set that.
    write(p, 'regulatory.sanction', { sanction_valid_to: '2027-03-11' });
    const ending = sheet(p, SANCTION);
    assert.equal(ending.value('sanction_days_left'), 150);
    assert.equal(ending.view('renewal_applied_on').shown, 'shown');
    assert.equal(page(p, 'legal.approvals').situations.find((s) => s.at === 'legal.approvals:sanction_expiring')!.state, 'on');
    write(p, 'regulatory.sanction', { sanction_valid_to: '2026-09-30' });
    assert.equal(sheet(p, SANCTION).value('sanction_standing'), 'Run out');
    assert.ok(sheet(p, SANCTION).said.includes('The sanction has run out.'));
  });

  it('brings the revision in from its record, and counts the consents against the Act’s share', () => {
    const p = sanctioned();
    const revision = add(p, REVISIONS, { revision_no: 'Revision 2', reason: 'more_floors', applied_on: '2026-09-18', standing: 'applied', allottees_at_application: 42, consents_held: 19 });
    const fields = page(p, 'legal.approvals');
    assert.equal(fields.situations.find((s) => s.at === 'revised_sanction')!.state, 'on', 'nobody set it');
    const short = sheet(p, REVISIONS, revision.id);
    assert.equal(short.value('consent_share_held'), 45.24);
    assert.equal(short.value('consent_share_needed'), 66.67);
    assert.deepEqual(short.view('consent_share_needed').cites?.map((c) => [c.key, c.verified, c.source.clause]), [['rera_alteration_consent_share', false, 'section 14(2)(ii)']]);
    assert.equal(short.value('consent_standing'), 'Consents short');
    assert.equal(short.view('consent_standing').cites?.[0]?.verified, false, 'the standing says the share it read is unverified');
    assert.deepEqual(short.said, ['45.24 % of allottees have consented in writing and 66.67 % are needed.']);
    assert.equal(short.view('sanctioned_on').shown, 'hidden', 'not asked until it is sanctioned');
    assert.ok(!short.missing.includes('sanctioned_on'));
    const plan = sheet(p, SANCTION);
    assert.equal(plan.value('revisions_count'), 1);
    assert.equal(plan.value('revisions_short_of_consent'), 1);
    assert.ok(fields.exceptions.some((e) => e.kind === 'rule' && e.sheet === 'Plan revisions · Revision 2' && /45\.24 %/.test(e.text)));

    write(p, REVISIONS, { consents_held: 28 }, revision.id);
    const enough = sheet(p, REVISIONS, revision.id);
    assert.equal(enough.value('consent_share_held'), 66.67);
    assert.equal(enough.value('consent_standing'), 'Consents in hand');
    assert.deepEqual(enough.said, []);
    assert.equal(sheet(p, SANCTION).value('revisions_short_of_consent'), 0);
  });

  it('holds the height after the revision to the airport and fire clearances kept on another sheet', () => {
    const p = sanctioned();
    write(p, HEIGHT, { site_elevation: '905 m', zone_permitted_top: '940 m', height_clearance: 'aviation', permitted_top: '951.2 m', clearance_issued_on: '2024-01-20', fire_noc: 'fire', fire_height_cleared: '45 m' });
    const height = sheet(p, HEIGHT);
    assert.equal(height.text('height'), '44.8 m');
    assert.equal(height.value('high_rise'), 'High-rise');
    assert.deepEqual(height.view('high_rise').cites?.map((c) => [c.key, c.value, c.verified]), [['high_rise_height_m', 21, false]]);
    assert.equal(height.view('fire_noc').shown, 'shown');
    assert.equal(height.value('top_elevation'), 949.8);
    assert.equal(height.value('height_clearance_applies'), 'Needed');
    assert.equal(height.value('headroom'), 1.4);
    assert.equal(height.value('height_allowed_by_airport'), 46.2);
    assert.equal(height.value('clearance_valid_to'), '2032-01-20');
    assert.equal(height.value('height_standing'), 'Within the clearances');

    const revision = add(p, REVISIONS, { revision_no: 'Revision 2', reason: 'more_floors', applied_on: '2026-09-18', standing: 'applied', allottees_at_application: 42, consents_held: 28, height_after: '47.8 m', built_up_area_after: '20450 sqm' });
    assert.deepEqual(sheet(p, REVISIONS, revision.id).said, [
      'Height after the revision is 47.8 m; the height clearance allows 46.2 m above the ground.',
      'Height after the revision is 47.8 m; the fire clearance covers 45 m.',
    ]);
    write(p, REVISIONS, { height_after: '44.8 m' }, revision.id);
    assert.deepEqual(sheet(p, REVISIONS, revision.id).said, []);
  });

  it('turns an environment clearance on at the size the rule table gives, and off under it', () => {
    const p = sanctioned();
    const small = sheet(p, ENVIRONMENT);
    assert.equal(small.value('area_short_of_clearance'), 200);
    assert.equal(small.value('clearance_applies'), 'Not needed at this size');
    assert.equal(small.value('consent_applies'), 'Consent needed');
    assert.equal(small.view('clearance').shown, 'hidden');
    assert.equal(small.view('consent_to_establish').shown, 'shown');
    assert.ok(!small.missing.includes('clearance'), 'a clearance that does not apply is not asked for');

    const revision = add(p, REVISIONS, { revision_no: 'Revision 2', reason: 'more_floors', applied_on: '2026-09-18', standing: 'applied', built_up_area_after: '20450 sqm' });
    const after = sheet(p, REVISIONS, revision.id);
    assert.equal(after.value('clearance_after'), 'Needed at this size');
    assert.deepEqual(after.view('clearance_after').cites?.map((c) => [c.key, c.value, c.unit, c.verified, c.source.clause]), [['environment_clearance_built_up_area', 20000, 'sqm', false, 'Schedule, item 8(a)']]);
    write(p, REVISIONS, { built_up_area_after: '19980 sqm' }, revision.id);
    assert.equal(sheet(p, REVISIONS, revision.id).value('clearance_after'), 'Not needed at this size');

    // Once the larger plan is the sanctioned one, the clearance is in play on the environment sheet, and asked for.
    write(p, 'regulatory.sanction', { sanctioned_area: 20450 });
    const large = sheet(p, ENVIRONMENT);
    assert.equal(large.value('clearance_applies'), 'Needed, as a building project');
    assert.equal(large.view('clearance_applies').cites?.every((c) => c.verified === false), true);
    assert.equal(large.view('clearance').shown, 'shown');
    assert.ok(large.missing.includes('clearance'));
    assert.equal(large.value('environment_standing'), 'Clearance not on file');
    write(p, ENVIRONMENT, { clearance: 'environment', ec_built_up_area: '20000 sqm' });
    assert.equal(sheet(p, ENVIRONMENT).value('environment_standing'), 'Sanctioned over the cleared area');
    write(p, ENVIRONMENT, { ec_built_up_area: '21000 sqm' });
    assert.equal(sheet(p, ENVIRONMENT).value('environment_standing'), 'In order');
  });

  it('keeps every approval in one shape: fees summed, days counted, and the register saying what has run out', () => {
    const p = sanctioned();
    const fire = add(p, 'shared.approvals', { reference: 'GBC(1)/214/2024', kind: 'fire', standing: 'in_hand', issued_on: '2024-02-01', valid_until: '2026-09-30', renewal_lead: 60, fees: [{ head: 'Scrutiny fee', amount: 250000, paid_on: '2024-01-10' }, { head: 'Inspection fee', amount: 50000 }] });
    const sanction = add(p, 'shared.approvals', {
      reference: 'AD/123/2024',
      kind: 'plan_sanction',
      standing: 'applied',
      applied_on: '2026-09-18',
      decision_due: '2026-11-17',
      follow_ups: [{ on: '2026-09-25', with: 'Assistant director', mode: 'visit', outcome: 'query_raised', next_on: '2026-10-05' }],
      queries: [{ raised_on: '2026-09-25', about: 'drawings' }],
    });
    const held = sheet(p, 'shared.approvals', fire.id);
    assert.equal(held.text('fees_total'), '₹3 lakh');
    assert.equal(held.value('days_left'), -12);
    assert.equal(held.value('renew_by'), '2026-08-01');
    assert.equal(held.view('follow_ups').shown, 'hidden', 'an approval in hand does not show its trail');
    assert.deepEqual(held.said, ['Recorded as in hand, with no paper filed against it.', 'Recorded as in hand, and its validity has run out.']);
    const pending = sheet(p, 'shared.approvals', sanction.id);
    assert.equal(pending.view('follow_ups').shown, 'shown');
    assert.equal(pending.view('days_left').shown, 'hidden');

    const register = sheet(p, 'legal.approvals.register');
    assert.equal(register.value('approvals_recorded'), 2);
    assert.equal(register.value('in_hand'), 1);
    assert.equal(register.value('with_authority'), 1);
    assert.equal(register.value('run_out'), 1);
    assert.equal(register.text('fees_demanded'), '₹3 lakh');
    assert.equal(register.value('register_standing'), 'An approval has run out');
    assert.ok(page(p, 'legal.approvals').exceptions.some((e) => e.text === '1 approval(s) are past their validity.'));
    assert.deepEqual(page(p, 'legal.approvals').shared.map((s) => [s.set.id, s.records.length]).filter(([id]) => id === 'shared.approvals'), [['shared.approvals', 2]]);

    write(p, 'shared.approvals', { valid_until: '2028-09-30' }, fire.id);
    assert.equal(sheet(p, 'legal.approvals.register').value('register_standing'), 'In order');
  });

  it('leaves over a survey number no conversion order covers, and the land that is not converted', () => {
    const p = project();
    p.parcelId = 'Sy. No. 73/4, 74/1';
    assert.equal(sheet(p, 'legal.approvals.land_use').view('conversion_orders').shown, 'hidden', 'no conversion is asked about until the land’s status is recorded');
    write(p, 'land_site.parcel_identification', { extent_title: 8094 });
    write(p, 'regulatory.land_use', { conversion_status: 'agricultural' });
    assert.equal(page(p, 'legal.approvals').situations.find((s) => s.at === 'agricultural_needs_conversion')!.state, 'on');
    write(p, 'legal.approvals.land_use', { conversion_orders: [{ order_no: 'ALN(S)SR 112/2023-24', dated: '2024-01-08', extent: 4047, purpose: 'residential' }], parcel_to_order: [{ parcel: '73/4', order: 'ALN(S)SR 112/2023-24' }] });
    const use = sheet(p, 'legal.approvals.land_use');
    assert.equal(use.value('converted_extent'), 4047);
    assert.equal(use.value('unconverted_extent'), 4047);
    assert.equal(use.value('land_use_standing'), 'Part of the land is not converted');
    assert.deepEqual(use.view('parcel_to_order').match!.left.leftover.map((i) => i.label), ['74/1']);
    assert.deepEqual(use.view('parcel_to_order').match!.right.leftover, []);
    const fields = page(p, 'legal.approvals');
    assert.deepEqual(fields.exceptions.filter((e) => e.kind === 'unmatched').map((e) => e.text), ['Survey numbers: 74/1']);

    write(p, 'legal.approvals.land_use', {
      conversion_orders: [{ order_no: 'ALN(S)SR 112/2023-24', dated: '2024-01-08', extent: 4047, purpose: 'residential' }, { order_no: 'ALN(S)SR 208/2024-25', dated: '2025-02-14', extent: 4047, purpose: 'residential' }],
      parcel_to_order: [{ parcel: '73/4', order: 'ALN(S)SR 112/2023-24' }, { parcel: '74/1', order: 'ALN(S)SR 208/2024-25' }],
    });
    const whole = sheet(p, 'legal.approvals.land_use');
    assert.equal(whole.value('unconverted_extent'), 0);
    assert.equal(whole.value('land_use_standing'), 'In order');
    assert.equal(page(p, 'legal.approvals').counts.unmatched, 0);
  });

  it('measures a deviation against the city’s limit, and has no limit to cite where the rule table has no row', () => {
    const p = sanctioned();
    const deviation = add(p, 'legal.approvals.deviations', { kind: 'floor_area', sanctioned: 19800, as_built: 21200, route: 'modified_plan' });
    const over = sheet(p, 'legal.approvals.deviations', deviation.id);
    assert.equal(over.value('deviation_share'), 7.07);
    assert.equal(over.value('limit'), 5);
    assert.equal(over.value('within_limit'), 'Over the limit');
    assert.equal(over.view('within_limit').cites?.[0]?.verified, false);
    assert.equal(sheet(p, 'legal.approvals.sanction').value('deviations_over_limit'), 1);
    write(p, 'legal.approvals.deviations', { as_built: 20400 }, deviation.id);
    assert.equal(sheet(p, 'legal.approvals.deviations', deviation.id).value('within_limit'), 'Within the limit');

    const elsewhere = project();
    elsewhere.city = 'Mysuru';
    const there = add(elsewhere, 'legal.approvals.deviations', { kind: 'floor_area', sanctioned: 19800, as_built: 21200, route: 'fee' });
    assert.equal(sheet(elsewhere, 'legal.approvals.deviations', there.id).value('limit'), null, 'the Bengaluru row does not speak for Mysuru');
  });

  it('turns a stop-work order into a situation every function can read, and off again when it is lifted', () => {
    const p = sanctioned();
    const order = add(p, 'legal.approvals.stop_orders', { issued_by: 'stk_auth', order_date: '2026-10-01', scope: 'whole_site', reason: 'deviation', force: 'in_force', reply_due: '2026-10-08' });
    assert.equal(page(p, 'legal.approvals').situations.find((s) => s.at === 'stop_work_order')!.state, 'on');
    assert.equal(sheet(p, 'legal.approvals.register').value('register_standing'), 'Work is ordered to stop');
    assert.deepEqual(sheet(p, 'legal.approvals.stop_orders', order.id).said, ['A reply was due by 2026-10-08 and none is recorded as filed.']);
    write(p, 'legal.approvals.stop_orders', { force: 'lifted', lifted_on: '2026-10-11' }, order.id);
    assert.equal(page(p, 'legal.approvals').situations.find((s) => s.at === 'stop_work_order')!.state, 'off');
    assert.equal(sheet(p, 'legal.approvals.register').view('stop_orders_in_force').shown, 'hidden');
  });
});

describe('Law and Liaison among the rest', () => {
  it('are registered once, and mirror only what a check or a department’s own set declares', () => {
    assert.ok(LAW_LIAISON_FIELD_SETS.every((set) => FIELD_SETS.includes(set)));
    const catalog = fieldCatalog();
    for (const set of LAW_LIAISON_FIELD_SETS) {
      for (const def of set.fields) {
        if (!def.sameAs) continue;
        // Every department is declared now: a mirror names a field that is there, in a check or in its owner's set.
        assert.ok(catalog.sets.get(def.sameAs.set)?.fields.some((owner) => owner.key === def.sameAs!.field), `${set.id}/${def.key} mirrors ${def.sameAs.set}/${def.sameAs.field}`);
      }
    }
  });
});
