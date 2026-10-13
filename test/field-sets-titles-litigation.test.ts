/**
 * Titles and Litigation as fields (`field-sets/titles-litigation.ts`), held to
 * what a person sees.
 *
 * Each case builds a project with invented land, people and papers and reads
 * the function's page the way the screen does: what shows with nothing
 * recorded, what a row or a value brings into play, what is worked out, which
 * rule speaks and when it stops, and which figure of the law is shown as not
 * yet verified.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  RULE_ROWS,
  addFieldRecord,
  catalogFaults,
  catalogLimits,
  createAssessment,
  createProject,
  fieldCatalog,
  fieldSetsOf,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  ruleRowFaults,
  setFieldValues,
  workstreamDefinition,
  type DdProject,
  type FieldView,
  type FunctionFields,
} from '@realytica/shared';

const TITLE = 'legal.title';
const LITIGATION = 'legal.litigation';
const NOW = new Date('2026-10-12T00:00:00Z');
const LEAD = 'lead@example.com';

/** The worked example's two sets sit on Title as well. Everything else there, and all of Litigation, is this file's. */
const EXAMPLE = new Set(['legal.title.holding', 'legal.title.owners']);
const OURS = FIELD_SETS.filter((set) => (set.fn === TITLE || set.fn === LITIGATION) && !EXAMPLE.has(set.id));

function project(): DdProject {
  const p = createProject({ name: 'Kere Layout', type: 'residential', location: 'Tank Road', city: 'Mysuru' }, 'RYT-TL1', LEAD);
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land diligence', owner: LEAD, targetType: 'project' });
  p.stakeholders.push(
    { id: 'stk_seller', name: 'A. Vendor', role: 'Vendor' },
    { id: 'stk_buyer', name: 'Tank Road Homes LLP', role: 'Developer' },
    { id: 'stk_bank', name: 'Tank Road Co-operative Bank', role: 'Lender' },
    { id: 'stk_adv', name: 'K. Advocate', role: 'Advocate' },
    { id: 'stk_first', name: 'B. Grantee', role: 'Owner' },
  );
  return p;
}

/** A record added, with nothing refused. */
function add(p: DdProject, set: string, values: Record<string, unknown>): string {
  const out = addFieldRecord(p, set, values, LEAD);
  assert.deepEqual(out.rejected, [], `${set}: ${JSON.stringify(out.rejected)}`);
  return out.record!.id;
}

function write(p: DdProject, set: string, values: Record<string, unknown>, record?: string): void {
  assert.deepEqual(setFieldValues(p, { set, ...(record ? { record } : {}) }, values, LEAD).rejected, [], set);
}

/** A check's own fields, recorded on the check that holds them. */
function onCheck(p: DdProject, definitionId: string, values: Record<string, unknown>): void {
  const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;
  assert.deepEqual(recordCheckFields(p, check.id, values as never, LEAD).rejected, [], definitionId);
}

const page = (p: DdProject, fn: string): FunctionFields => readFunctionFields(p, fn, NOW);
const views = (p: DdProject, set: string, record?: string): FieldView[] => readSheet(p, set, record, undefined, undefined, NOW)!.fields;
const view = (p: DdProject, set: string, key: string, record?: string): FieldView => views(p, set, record).find((f) => f.def.key === key)!;
const value = (p: DdProject, set: string, key: string, record?: string) => view(p, set, key, record).held?.value ?? null;
const showing = (p: DdProject, set: string, record?: string): string[] => views(p, set, record).filter((f) => f.shown === 'shown').map((f) => f.def.key);
const said = (p: DdProject, fn: string): string[] => page(p, fn).exceptions.filter((e) => e.kind === 'rule').map((e) => e.text);
const leftovers = (p: DdProject, fn: string): string[] => page(p, fn).exceptions.filter((e) => e.kind === 'unmatched').map((e) => e.text);
const situations = (p: DdProject, fn: string): string[] => page(p, fn).situations.filter((s) => s.state === 'on').map((s) => s.situation.key);

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

describe('Titles and Litigation, as a catalog', () => {
  it('has no fault and breaks no limit, set by set', () => {
    const ids = new Set(OURS.map((set) => set.id));
    assert.equal(OURS.length, 23);
    assert.deepEqual(catalogFaults().filter((fault) => [...ids].some((id) => fault.includes(id))), []);
    assert.deepEqual(catalogLimits().filter((breach) => ids.has(breach.set)), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
  });

  it('keeps every record small, the shared ones with what is added to them', () => {
    const catalog = fieldCatalog();
    for (const id of ['shared.parcels', 'shared.matters', 'legal.title.owners', ...OURS.filter((set) => set.records).map((set) => set.id)]) {
      // A depth sheet’s fields are not the record’s own: they open as a sheet of their own.
      const own = catalog.sets.get(id)!.fields.filter((def) => !def.sheet);
      assert.ok(own.length <= 20, `${id} has ${own.length} fields`);
    }
  });

  it('makes Litigation a function of Legal, with a page of its sheets', () => {
    assert.equal(workstreamDefinition(LITIGATION)?.department, 'legal');
    assert.deepEqual(fieldSetsOf(LITIGATION).map((set) => set.title), ['Matters and what is at stake', 'Hearings and orders', 'Orders', 'Court and registry searches', 'Search log', 'Search hits', 'Notices and claims']);
  });

  it('marks every figure it reads from the law or from practice as not yet verified', () => {
    const keys = ['title_search_years', 'search_fresh_days', 'title_opinion_refresh_days', 'age_of_majority_years', 'minor_sale_challenge_years', 'written_statement_days', 'appeal_days', 'award_challenge_months', 'rera_appeal_deposit_share'];
    for (const key of keys) {
      const rows = RULE_ROWS.filter((row) => row.key === key);
      assert.ok(rows.length > 0, key);
      for (const row of rows) assert.equal(row.verified, false, key);
    }
  });

  it('holds no prose a model could write: one capped note, the advocate’s', () => {
    const prose = OURS.flatMap((set) => set.fields.filter((def) => def.kind === 'longtext').map((def) => `${set.id}/${def.key}:${def.maxLength}`));
    assert.deepEqual(prose, ['legal.title.opinion/verdict_note:800']);
  });
});

/* ==================================================================== */
/* With nothing recorded                                                 */
/* ==================================================================== */

describe('a project nobody has started', () => {
  it('shows a handful of fields a sheet, asks for none of them, and says nothing', () => {
    const p = project();
    const counts = Object.fromEntries(OURS.filter((set) => !set.records && !set.extends).map((set) => [set.id, showing(p, set.id).length]));
    assert.deepEqual(counts, {
      'legal.title.records': 5,
      'legal.title.ownership': 2,
      'legal.title.chain': 7,
      'legal.title.encumbrance': 5,
      'legal.title.character': 4,
      'legal.title.opinion': 6,
      'legal.litigation.register': 3,
      'legal.litigation.diary': 3,
      'legal.litigation.search': 8,
    });
    // Nothing of ours is counted as still to fill, and no rule speaks.
    const ours = page(p, TITLE).exceptions.filter((e) => !['Land holding'].includes(e.sheet));
    assert.deepEqual(ours, []);
    assert.equal(page(p, LITIGATION).counts.total, 0);
    assert.deepEqual(situations(p, TITLE), []);
    assert.equal(value(p, 'legal.title.chain', 'chain_standing'), 'Not started');
    assert.equal(value(p, 'legal.title.opinion', 'title_standing'), 'Not started');
  });
});

/* ==================================================================== */
/* T1 and T2: parcels, owners, and who signs                             */
/* ==================================================================== */

describe('Titles: a holding of two survey numbers and three owners, one dead and one a minor', () => {
  function holding() {
    const p = project();
    const first = add(p, 'shared.parcels', { survey_number: '41/2', extent: '1 acre 20 guntas', kharab_a: '2 guntas', kharab_b: '1 gunta' });
    const second = add(p, 'shared.parcels', { survey_number: '41/3', extent: '30 guntas' });
    const a = add(p, 'legal.title.owners', { name: 'A. Vendor', share_pct: 50, capacity: 'individual' });
    const b = add(p, 'legal.title.owners', { name: 'B. Vendor', share_pct: 30, capacity: 'individual' });
    const c = add(p, 'legal.title.owners', { name: 'C. Vendor', share_pct: 10, capacity: 'individual' });
    return { p, first, second, a, b, c };
  }

  it('adds up what the records say of each parcel, and says where they part from the title', () => {
    const { p, first, second } = holding();
    assert.equal(view(p, 'shared.parcels', 'net_extent', first).text, '5,766.77 sqm');
    assert.equal(value(p, 'legal.title.records', 'records_standing'), 'A parcel has no land record');
    onCheck(p, 'land_site.parcel_identification', { extent_title: 9105 });
    add(p, 'legal.title.land_records', { parcel: first, rtc_year: '2026-27', rtc_fetched_on: '2026-09-01', rtc_extent: '1 acre 20 guntas', rtc_owner: 'stk_seller', mutation: 'settled', sketch: 'tippani' });
    const record = add(p, 'legal.title.land_records', { parcel: second, rtc_year: '2026-27', rtc_fetched_on: '2026-10-05', rtc_extent: '28 guntas', rtc_owner: 'stk_seller', mutation: 'pending', sketch: 'pre_mutation' });

    // Worked out: the RTCs summed, 1 acre 20 guntas and 28 guntas, against the 9,105 sqm the title recites.
    assert.equal(value(p, 'legal.title.records', 'extent_rtc'), 8903.08);
    assert.equal(value(p, 'legal.title.records', 'records_standing'), 'RTC extent differs from the title');
    assert.ok(said(p, TITLE).includes('The RTCs add up to 8,903.08 sqm and the title recites 9,105 sqm: 2.2% apart, outside 1.0%.'));
    assert.ok(said(p, TITLE).includes('1 mutation(s) are pending or disputed.'));

    // A record fetched 41 days ago has run out; one fetched a week ago has not. The 30 days are practice, shown as not verified.
    const old = page(p, TITLE).exceptions.filter((e) => e.label === 'Fetch again by').map((e) => `${e.tone}: ${e.text}`);
    assert.deepEqual(old, ['critical: Ran out on 2026-10-01']);
    assert.deepEqual(view(p, 'legal.title.land_records', 'refresh_by', record).cites?.map((c) => [c.key, c.value, c.verified]), [['search_fresh_days', 30, false]]);

    // The rule passes once the RTC of the second parcel is read as the title has it.
    write(p, 'legal.title.land_records', { rtc_extent: '30 guntas', mutation: 'settled' }, record);
    assert.equal(value(p, 'legal.title.records', 'records_standing'), 'Records agree');
    assert.ok(!said(p, TITLE).some((text) => text.startsWith('The RTCs add up')));
  });

  it('brings in what each owner’s case needs, on that owner alone, and counts nothing that is not showing', () => {
    const { p, a, b, c } = holding();
    assert.deepEqual(situations(p, TITLE), ['multiple_owners']);
    assert.deepEqual(showing(p, 'legal.title.owners', a), ['name', 'share_pct', 'capacity', 'joins_as', 'heir_of', 'living']);

    // B has died: his succession comes into play on his record, and on the sheet. A's stays out of sight and is not asked for.
    write(p, 'legal.title.owners', { living: false }, b);
    assert.deepEqual(situations(p, TITLE), ['multiple_owners', 'owner_deceased']);
    assert.deepEqual(showing(p, 'legal.title.owners', b), ['name', 'share_pct', 'capacity', 'heir_of', 'living', 'date_of_death', 'succession_by', 'property_character', 'daughters_listed'], 'and nobody asks how a dead man joins the deed');
    assert.equal(view(p, 'legal.title.owners', 'living', a).state, 'assumed', 'an owner is taken to be living until somebody says otherwise');
    assert.equal(view(p, 'legal.title.owners', 'date_of_death', a).shown, 'hidden');
    assert.equal(view(p, 'legal.title.owners', 'date_of_death', a).missing, false);
    assert.equal(view(p, 'legal.title.owners', 'date_of_death', b).missing, true);
    assert.equal(view(p, 'legal.title.owners', 'daughters_listed', b).missing, false, 'asked only of ancestral property');
    write(p, 'legal.title.owners', { property_character: 'ancestral' }, b);
    assert.equal(view(p, 'legal.title.owners', 'daughters_listed', b).missing, true);

    // No heir is recorded: the rule speaks. An heir who does not join keeps the standing red; once she joins it clears.
    assert.ok(said(p, TITLE).includes('An owner has died and no heir is recorded.'));
    const heir = add(p, 'legal.title.owners', { name: 'D. Vendor', share_pct: 10, capacity: 'individual', heir_of: 'B. Vendor', relation: 'daughter', joins_as: 'not_joining' });
    assert.ok(!said(p, TITLE).includes('An owner has died and no heir is recorded.'));
    assert.equal(value(p, 'legal.title.ownership', 'heirs'), 1);
    assert.equal(value(p, 'legal.title.ownership', 'shares_total'), 100);
    assert.equal(value(p, 'legal.title.ownership', 'ownership_standing'), 'An owner is not joining');
    assert.ok(said(p, TITLE).includes('1 owner(s) with a share join the deed as neither vendor nor confirming party.'));
    write(p, 'legal.title.owners', { joins_as: 'confirming_party' }, heir);
    assert.equal(value(p, 'legal.title.ownership', 'ownership_standing'), 'Every owner accounted for');

    // C is a minor: the day she comes of age and the days a sale stays open are worked out from two rows of the law, both unverified.
    write(p, 'legal.title.owners', { capacity: 'minor through a guardian', date_of_birth: '2015-06-01' }, c);
    assert.ok(situations(p, TITLE).includes('minor_owner'));
    assert.equal(value(p, 'legal.title.owners', 'majority_on', c), '2033-06-01');
    assert.equal(value(p, 'legal.title.owners', 'challenge_days_left', c), 3520);
    assert.deepEqual(view(p, 'legal.title.owners', 'challenge_days_left', c).cites?.map((cite) => [cite.key, cite.verified, cite.source.clause]), [
      ['age_of_majority_years', false, 'section 3'],
      ['minor_sale_challenge_years', false, 'Schedule, article 60'],
    ]);
    assert.ok(said(p, TITLE).includes('A sale for this minor stays open to challenge for another 3,520 days.'));
    assert.equal(view(p, 'legal.title.owners', 'court_permission_no', c).missing, true);
    assert.equal(view(p, 'legal.title.owners', 'court_permission_no', a).missing, false);
  });

  it('pairs survey numbers with owners, and lists whatever of either has no partner', () => {
    const { p, first, second, a, b, c } = holding();
    write(p, 'legal.title.ownership', { owners_by_parcel: [{ parcel: first, owner: a }, { parcel: first, owner: b }] });
    assert.deepEqual(leftovers(p, TITLE), ['Survey numbers: 41/3', 'Owners: C. Vendor']);
    write(p, 'legal.title.ownership', { owners_by_parcel: [{ parcel: first, owner: a }, { parcel: first, owner: b }, { parcel: second, owner: c }] });
    assert.deepEqual(leftovers(p, TITLE), []);
    // Shares that do not come to a hundred.
    assert.ok(said(p, TITLE).includes('The owners’ shares add up to 90 %, not 100.'));
    write(p, 'legal.title.owners', { share_pct: 20 }, c);
    assert.ok(!said(p, TITLE).some((text) => text.startsWith('The owners’ shares')));
  });
});

/* ==================================================================== */
/* T2, T3 and T5: the chain, the search, and the opinion over them       */
/* ==================================================================== */

describe('Titles: a chain with an unregistered partition and a deed signed by an attorney', () => {
  function chain() {
    const p = project();
    const parcel = add(p, 'shared.parcels', { survey_number: '41/2', extent: '1 acre 20 guntas' });
    onCheck(p, 'legal.title_chain', { root_year: '1994-03-11', as_at: '2026-10-01', years_required: 30 });
    const root = add(p, 'legal.title.instruments', { name: 'Sale deed 811 of 1994', kind: 'sale_deed', executed_on: '1994-03-11', from_party: 'stk_first', to_party: 'stk_seller', registered: true, doc_no: '811/1993-94', registered_on: '1994-03-14' });
    const sale = add(p, 'legal.title.instruments', { name: 'Sale deed 2317 of 2019', kind: 'sale_deed', executed_on: '2019-08-23', from_party: 'stk_seller', to_party: 'stk_buyer', registered: true, doc_no: '2317/2019-20', registered_on: '2019-08-23' });
    return { p, parcel, root, sale };
  }

  it('reads the span from the chain check, and cites the lender’s usual thirty years as unverified', () => {
    const { p } = chain();
    assert.equal(value(p, 'legal.title.chain', 'years_established'), 32.56);
    assert.equal(value(p, 'legal.title.chain', 'years_usual'), 30);
    assert.equal(value(p, 'legal.title.chain', 'chain_standing'), 'Chain established');
    const cite = view(p, 'legal.title.chain', 'years_usual').cites![0]!;
    assert.deepEqual([cite.key, cite.value, cite.unit, cite.verified], ['title_search_years', 30, 'years', false]);
    assert.equal(view(p, 'legal.title.chain', 'chain_standing').cites?.[0]?.verified, false, 'the standing that reads it says so too');
    // A chain that starts later is short of what is required.
    onCheck(p, 'legal.title_chain', { root_year: '2004-03-11' });
    assert.equal(value(p, 'legal.title.chain', 'chain_standing'), 'Shorter than required');
    assert.ok(said(p, TITLE).includes('The chain is established for 22.56 years and 30 years are required.'));
  });

  it('opens nothing for a clean chain, and the right fields for the two hard links', () => {
    const { p, parcel, root, sale } = chain();
    assert.deepEqual(situations(p, TITLE), []);
    assert.deepEqual(showing(p, 'legal.title.instruments', sale), ['name', 'kind', 'executed_on', 'from_party', 'to_party', 'extent', 'registered', 'doc_no', 'registered_on', 'deed', 'held_as', 'signed_through']);

    // The 2019 deed was signed by an attorney, after the principal had died.
    write(p, 'legal.title.instruments', { signed_through: 'attorney' }, sale);
    assert.deepEqual(situations(p, TITLE), ['sale_through_attorney']);
    assert.deepEqual(showing(p, 'legal.title.instruments', sale).slice(12), ['attorney', 'poa_registered', 'principal_alive_on_deed', 'poa']);
    assert.equal(view(p, 'legal.title.instruments', 'attorney', root).shown, 'hidden');
    assert.equal(view(p, 'legal.title.instruments', 'attorney', root).missing, false);
    write(p, 'legal.title.instruments', { attorney: 'stk_adv', poa_registered: true, principal_alive_on_deed: false }, sale);
    assert.equal(value(p, 'legal.title.chain', 'principal_not_living'), 1);
    assert.equal(value(p, 'legal.title.chain', 'chain_standing'), 'An attorney signed after the principal died');
    assert.ok(said(p, TITLE).includes('1 deed(s) were signed by an attorney after the principal had died.'));

    // A family partition of 2004 was never registered.
    const partition = add(p, 'legal.title.instruments', { name: 'Family partition of 2004', kind: 'partition_deed', executed_on: '2004-05-02', from_party: 'stk_seller', to_party: 'stk_seller', registered: false, partition_form: 'unregistered_deed', all_sharers_joined: false });
    assert.deepEqual(situations(p, TITLE), ['sale_through_attorney', 'unregistered_partition']);
    assert.equal(view(p, 'legal.title.instruments', 'doc_no', partition).missing, false, 'a paper that was never registered has no document number to give');
    assert.equal(value(p, 'legal.title.chain', 'unregistered'), 1);
    assert.equal(value(p, 'legal.title.chain', 'chain_standing'), 'A link is not registered');
    for (const text of ['1 link(s) in the chain have no registered instrument.', '1 partition(s) rest on an unregistered deed.', '1 partition(s) were not joined by every sharer.']) assert.ok(said(p, TITLE).includes(text), text);

    // Each survey number is paired with the instruments that convey it.
    write(p, 'legal.title.chain', { chain_by_parcel: [{ parcel, instrument: root }, { parcel, instrument: sale }] });
    assert.deepEqual(leftovers(p, TITLE), ['Instruments: Family partition of 2004']);
  });

  it('works out what the certificates leave uncovered, and pairs their entries with the chain', () => {
    const { p } = chain();
    onCheck(p, 'legal.encumbrances', { ec_from: '1994-01-01', ec_to: '2026-09-30', ec_nil: false, subsisting_charges: 1 });
    add(p, 'legal.title.ec_certificates', { certificate_no: 'EC/1001', sro: 'Mysuru North', from: '1994-01-01', to: '2009-12-31', result: 'entries' });
    add(p, 'legal.title.ec_certificates', { certificate_no: 'EC/1002', sro: 'Mysuru West', from: '2011-01-01', to: '2026-09-30', result: 'entries' });
    assert.equal(value(p, 'legal.title.encumbrance', 'years_covered'), 32.7);
    assert.equal(value(p, 'legal.title.encumbrance', 'gap_days'), 365);
    assert.ok(said(p, TITLE).includes('The certificates leave 365 days of the search period uncovered.'));

    // Three entries on the certificates, two of them deeds in the chain. The third is a mortgage nobody has recorded as an instrument.
    const e1 = add(p, 'legal.title.ec_entries', { doc_no: '811/1993-94', registered_on: '1994-03-14', nature: 'sale_deed', treated_as: 'transfer' });
    const e2 = add(p, 'legal.title.ec_entries', { doc_no: '2317/2019-20', registered_on: '2019-08-23', nature: 'sale_deed', treated_as: 'transfer' });
    add(p, 'legal.title.ec_entries', { doc_no: '455/2008-09', registered_on: '2008-07-02', nature: 'mortgage', treated_as: 'charge' });
    const [root, sale] = page(p, TITLE).sheets.find((s) => s.set.id === 'legal.title.instruments')!.records!.map((r) => r.recordId!);
    write(p, 'legal.title.encumbrance', { ec_to_chain: [{ entry: e1, instrument: root }, { entry: e2, instrument: sale }] });
    assert.deepEqual(leftovers(p, TITLE).filter((text) => !text.startsWith('Survey numbers') && !text.startsWith('Instruments')), ['Certificate entries: 455/2008-09']);

    // The mortgage is a charge on the land, not released: the situation follows, and the standing turns.
    assert.deepEqual(situations(p, TITLE), ['subsisting_charge'], 'the check already says the certificate is not nil');
    const mortgage = add(p, 'legal.title.charges', { holder: 'stk_bank', kind: 'registered_mortgage', amount: '85 lakh', created_on: '2008-07-02', found_in: ['encumbrance certificate'], released: false });
    assert.equal(value(p, 'legal.title.encumbrance', 'charges_open'), 1);
    assert.equal(value(p, 'legal.title.encumbrance', 'encumbrance_standing'), 'A charge is not released');
    assert.ok(said(p, TITLE).includes('1 charge(s) on the land are not released.'));
    assert.equal(view(p, 'legal.title.charges', 'release_deed', mortgage).shown, 'hidden');
    write(p, 'legal.title.charges', { released: true, released_on: '2016-01-19' }, mortgage);
    assert.equal(view(p, 'legal.title.charges', 'release_deed', mortgage).missing, true, 'a release needs its deed');
    assert.equal(value(p, 'legal.title.encumbrance', 'encumbrance_standing'), 'The search period has a gap');
    assert.ok(!said(p, TITLE).some((text) => text.endsWith('are not released.')));
  });

  it('assembles the opinion from the sheets before it: the advocate gives a verdict, and cannot call a defect clear', () => {
    const { p, sale } = chain();
    // With a chain on file the opinion is owed: its five inputs, and nothing else, are asked for.
    assert.deepEqual(views(p, 'legal.title.opinion').filter((f) => f.missing).map((f) => f.def.key), ['verdict', 'opinion_for', 'opinion_by', 'opinion_date', 'opinion_doc']);
    assert.equal(value(p, 'legal.title.opinion', 'documents'), 2);
    assert.equal(value(p, 'legal.title.opinion', 'defects_open'), 0);
    assert.equal(value(p, 'legal.title.opinion', 'title_standing'), 'No open point');

    write(p, 'legal.title.instruments', { signed_through: 'attorney', attorney: 'stk_adv', poa_registered: true, principal_alive_on_deed: false }, sale);
    add(p, 'legal.title.charges', { holder: 'stk_bank', kind: 'deposit_of_title_deeds', created_on: '2021-02-01', found_in: ['security-interest registry'], released: false });
    assert.equal(value(p, 'legal.title.opinion', 'defects_open'), 2);
    assert.equal(value(p, 'legal.title.opinion', 'title_standing'), 'A defect is open');

    write(p, 'legal.title.opinion', { verdict: 'clear_marketable', opinion_for: 'lender', opinion_by: 'stk_adv', opinion_date: '2026-07-01' });
    assert.ok(said(p, TITLE).includes('The verdict is clear and marketable while 2 defect(s) are open in the records, chain, search or restrictions.'));
    // Ninety days on, the opinion is stale: a house rule, shown as one nobody has verified.
    assert.equal(value(p, 'legal.title.opinion', 'refresh_by'), '2026-09-29');
    assert.equal(view(p, 'legal.title.opinion', 'refresh_by').cites?.[0]?.verified, false);
    assert.ok(page(p, TITLE).exceptions.some((e) => e.label === 'Bring up to date by' && e.text === 'Ran out on 2026-09-29'));

    write(p, 'legal.title.opinion', { verdict: 'clear_subject_to' });
    assert.ok(!said(p, TITLE).some((text) => text.startsWith('The verdict is clear and marketable')));

    // A requisition past its reply date, then waived by the advocate.
    const asked = add(p, 'legal.title.requisitions', { about: 'Release deed for the 2021 deposit of title deeds', kind: 'requisition', category: 'encumbrance', raised_on: '2026-09-01', to: 'stk_seller', reply_due: '2026-10-02', state: 'open' });
    assert.equal(value(p, 'legal.title.opinion', 'requisitions_open'), 1);
    assert.ok(said(p, TITLE).includes('The reply was due 10 days ago.'));
    write(p, 'legal.title.requisitions', { state: 'waived' }, asked);
    assert.equal(view(p, 'legal.title.requisitions', 'waived_by', asked).missing, true, 'a waiver names who gave it');
    assert.equal(value(p, 'legal.title.opinion', 'waived'), 1);
    assert.ok(!said(p, TITLE).includes('The reply was due 10 days ago.'));
  });
});

/* ==================================================================== */
/* T4: granted land                                                      */
/* ==================================================================== */

describe('Titles: land that was granted, sold inside the bar and without permission', () => {
  it('stays out of sight until a grant is recorded, then says what is wrong with it', () => {
    const p = project();
    const parcel = add(p, 'shared.parcels', { survey_number: '77', extent: '2 acres' });
    onCheck(p, 'land_site.parcel_identification', { extent_title: 8093.71 });
    assert.deepEqual(showing(p, 'legal.title.character'), ['origin', 'zoning', 'conversion', 'restriction_standing']);
    assert.equal(view(p, 'legal.title.character', 'origin').missing, true, 'asked once there is a parcel');

    const grant = add(p, 'legal.title.restrictions', { restriction: 'grant_to_scheduled_caste_or_tribe', parcel, applies: 'applies', extent: '2 acres', order_no: 'LND/SR/118/1981-82', order_date: '1982-04-10', grantee: 'stk_first', bar_years: 15, first_transfer_on: '1994-03-11', permission: 'not_held' });
    assert.deepEqual(situations(p, TITLE), ['granted_land']);
    // On the record: the bar ended in 1997, and the land was sold 1,126 days before that.
    assert.equal(value(p, 'legal.title.restrictions', 'bar_ends', grant), '1997-04-10');
    assert.equal(value(p, 'legal.title.restrictions', 'days_inside_bar', grant), 1126);
    assert.equal(view(p, 'legal.title.restrictions', 'stage', grant).shown, 'hidden', 'an acquisition’s fields are not a grant’s');
    assert.equal(view(p, 'legal.title.restrictions', 'stage', grant).missing, false);

    // On the sheet: the whole extent is under restriction, and the standing names the worst of it.
    assert.equal(view(p, 'legal.title.character', 'restricted_extent').text, '8,093.71 sqm');
    assert.equal(value(p, 'legal.title.character', 'clear_extent'), 0);
    assert.equal(value(p, 'legal.title.character', 'restriction_standing'), 'Granted land sold without permission');
    for (const text of ['1 grant(s) were transferred without the government’s permission.', '1 grant(s) were first transferred before the bar on transfer ended.']) assert.ok(said(p, TITLE).includes(text), text);
    assert.equal(value(p, 'legal.title.opinion', 'defects_open'), 2);

    // Permission is produced, and the first transfer turns out to be the 1998 one.
    write(p, 'legal.title.restrictions', { permission: 'held', first_transfer_on: '1998-01-05' }, grant);
    assert.equal(value(p, 'legal.title.character', 'restriction_standing'), 'A restriction applies');
    assert.ok(!said(p, TITLE).some((text) => text.includes('grant(s)')));
    assert.equal(value(p, 'legal.title.opinion', 'defects_open'), 0);
  });
});

/* ==================================================================== */
/* Litigation                                                            */
/* ==================================================================== */

describe('Litigation: a partition suit over one parcel and a buyer’s complaint', () => {
  function matters() {
    const p = project();
    const first = add(p, 'shared.parcels', { survey_number: '41/2', extent: '1 acre 20 guntas' });
    add(p, 'shared.parcels', { survey_number: '41/3', extent: '30 guntas' });
    const suit = add(p, 'shared.matters', { case_number: 'O.S. 214/2024', court: 'City Civil Court', forum: 'civil_court', subject_kind: 'partition', our_role: 'not_a_party', stage: 'issues', case_state: 'pending', schedule_recited: 'Sy. No. 41/2', likelihood: 'possible', claim_amount: '40 lakh' });
    const complaint = add(p, 'shared.matters', { case_number: 'CMP 2291/2026', court: 'RERA authority', forum: 'rera_authority', subject_kind: 'buyer_delay_or_refund', our_role: 'defendant', stage: 'written_statement', case_state: 'pending', claim_amount: '6.5 lakh', likelihood: 'remote' });
    return { p, first, suit, complaint };
  }

  it('counts what is pending and what is claimed, and turns the project’s situation on for Title to read', () => {
    const { p } = matters();
    assert.equal(value(p, 'legal.litigation.register', 'pending'), 2);
    assert.equal(view(p, 'legal.litigation.register', 'claims_in_court').text, '₹46.5 lakh');
    assert.equal(view(p, 'legal.litigation.register', 'contingent').text, '₹40 lakh');
    assert.equal(value(p, 'legal.litigation.register', 'litigation_standing'), 'Matters are pending');
    assert.deepEqual(situations(p, LITIGATION), ['litigation_pending', 'partition_suit']);
    // Title's opinion shows the matters only now.
    assert.ok(situations(p, TITLE).includes('litigation_pending'));
    assert.equal(view(p, 'legal.title.opinion', 'matters_pending').shown, 'shown');
    assert.equal(value(p, 'legal.title.opinion', 'matters_pending'), 2);
    // The search report named three matters; two are recorded.
    onCheck(p, 'legal.litigation', { matters_found: 3 });
    assert.ok(said(p, LITIGATION).includes('The search report names 3 matters and 2 are recorded here.'));
    onCheck(p, 'legal.litigation', { matters_found: 2 });
    assert.ok(!said(p, LITIGATION).some((text) => text.startsWith('The search report names')));
  });

  it('places a suit’s schedule on the parcels it covers; a parcel in no suit is left alone', () => {
    const { p, first, suit } = matters();
    assert.deepEqual(leftovers(p, LITIGATION), ['Suit schedules: Sy. No. 41/2']);
    write(p, 'legal.litigation.register', { suits_to_parcels: [{ matter: suit, parcel: first }] });
    assert.deepEqual(leftovers(p, LITIGATION), [], 'survey number 41/3 is in no suit, and that is in order');
  });

  it('opens the partition suit’s own fields, and says a preliminary decree divides nothing', () => {
    const { p, suit } = matters();
    const partition = ['partition_matter', 'share_claimed', 'our_vendor_is', 'all_sharers_impleaded', 'preliminary_decree_on', 'final_decree_on'];
    assert.deepEqual(showing(p, 'legal.litigation.register').filter((key) => partition.includes(key)), partition);
    assert.equal(view(p, 'legal.litigation.register', 'their_agreement_on').shown, 'hidden', 'nobody is suing on an earlier agreement');
    assert.equal(view(p, 'legal.litigation.register', 'their_agreement_on').missing, false);
    write(p, 'legal.litigation.register', { partition_matter: suit, share_claimed: 33.33, our_vendor_is: 'defendant', all_sharers_impleaded: true, preliminary_decree_on: '2026-08-14' });
    const rule = 'A preliminary decree of 2026-08-14 declares shares and divides nothing: no final decree is recorded.';
    assert.ok(said(p, LITIGATION).includes(rule));
    write(p, 'legal.litigation.register', { final_decree_on: '2027-02-01' });
    assert.ok(!said(p, LITIGATION).includes(rule));
  });

  it('works out the day to appeal and the deposit from the forum’s own rows, and says an order in force restrains the work', () => {
    const { p, first, suit, complaint } = matters();
    assert.deepEqual(showing(p, 'legal.litigation.diary'), ['hearings', 'orders', 'order_standing']);
    // The authority orders a refund to the buyer.
    const refund = add(p, 'legal.litigation.orders', { matter: complaint, order_date: '2026-09-01', passed_by: 'rera_authority', kind: 'final', effect: 'directs_payment', in_force: true, ordered_as: 'payment_to_allottee', amount_ordered: '6.5 lakh', comply_by: '2026-10-01', compliance: 'to_comply', disposal: 'allowed' });
    assert.equal(value(p, 'legal.litigation.orders', 'appeal_by', refund), '2026-10-31');
    const cite = view(p, 'legal.litigation.orders', 'appeal_by', refund).cites![0]!;
    assert.deepEqual([cite.key, cite.value, cite.verified, cite.source.clause], ['appeal_days', 60, false, 'section 44(2)']);
    assert.equal(view(p, 'legal.litigation.orders', 'pre_deposit', refund).shown, 'hidden');
    write(p, 'legal.litigation.orders', { we_appeal: true }, refund);
    assert.equal(view(p, 'legal.litigation.orders', 'pre_deposit', refund).text, '₹6.5 lakh', 'the whole of a payment to an allottee');
    write(p, 'legal.litigation.orders', { ordered_as: 'penalty' }, refund);
    assert.equal(view(p, 'legal.litigation.orders', 'pre_deposit', refund).text, '₹1.95 lakh', 'three-tenths of a penalty');
    assert.equal(view(p, 'legal.litigation.orders', 'pre_deposit', refund).cites?.[0]?.verified, false);
    assert.equal(view(p, 'legal.litigation.diary', 'ordered_unpaid').text, '₹6.5 lakh');
    assert.ok(said(p, LITIGATION).includes('The order was to be complied with 11 days ago.'));
    assert.ok(!page(p, LITIGATION).exceptions.some((e) => e.label === 'Appeal or challenge to be filed by'), 'nineteen days off is outside the fifteen it warns at');
    write(p, 'legal.litigation.orders', { compliance: 'complied' }, refund);
    assert.ok(!said(p, LITIGATION).includes('The order was to be complied with 11 days ago.'));

    // The civil court orders status quo over the parcel in the partition suit.
    const stay = add(p, 'legal.litigation.orders', { matter: suit, order_date: '2026-09-20', passed_by: 'civil_court', kind: 'interim', effect: 'status_quo', in_force: true, covers: first });
    assert.deepEqual(situations(p, LITIGATION), ['litigation_pending', 'partition_suit', 'interim_order_in_force']);
    assert.equal(value(p, 'legal.litigation.diary', 'construction_restraints'), 1);
    assert.equal(value(p, 'legal.litigation.diary', 'sale_restraints'), 1);
    assert.equal(value(p, 'legal.litigation.diary', 'order_standing'), 'An order restrains construction');
    assert.ok(said(p, LITIGATION).includes('1 order(s) in force restrain construction.'));
    // Title's opinion reads the restraint from here.
    assert.ok(said(p, TITLE).includes('1 order(s) in force restrain a sale of the land.'));
    // Vacated: nothing binds the project.
    write(p, 'legal.litigation.orders', { in_force: false }, stay);
    assert.equal(value(p, 'legal.litigation.diary', 'construction_restraints'), 0);
    assert.ok(!said(p, LITIGATION).includes('1 order(s) in force restrain construction.'));
    assert.ok(!said(p, TITLE).includes('1 order(s) in force restrain a sale of the land.'));
  });

  it('keeps a hearing diary in date order, a search log with every hit placed, and notices by their reply date', () => {
    const { p, suit, complaint } = matters();
    write(p, 'legal.litigation.diary', { hearings: [{ held_on: '2026-09-20', matter: suit, purpose: 'issues', outcome: 'order passed', next_step: 'obtain certified copy' }, { held_on: '2026-08-02', matter: complaint, purpose: 'summons', outcome: 'adjourned', next_step: 'file written statement' }] });
    assert.equal(view(p, 'legal.litigation.diary', 'hearings').def.display, 'timeline');
    assert.equal(view(p, 'legal.litigation.diary', 'hearings').text, '2 row(s)');

    // A search is logged, so the search sheet is owed; a hit that is ours waits for its matter.
    assert.deepEqual(views(p, 'legal.litigation.search').filter((f) => f.missing).map((f) => f.def.key), []);
    add(p, 'legal.litigation.registry_searches', { term: 'A. Vendor', registry: 'district_courts', hits: 1 });
    assert.deepEqual(views(p, 'legal.litigation.search').filter((f) => f.missing).map((f) => f.def.key), ['search_for', 'searched_on', 'searched_by']);
    write(p, 'legal.litigation.search', { search_for: 'acquisition', searched_on: '2026-08-20', searched_by: 'stk_adv' });
    assert.equal(value(p, 'legal.litigation.search', 'refresh_by'), '2026-09-19');
    assert.ok(page(p, LITIGATION).exceptions.some((e) => e.label === 'Search again by' && e.text === 'Ran out on 2026-09-19'));
    const hit = add(p, 'legal.litigation.search_hits', { case_ref: 'O.S. 214/2024', registry: 'district_courts', relevant: 'ours' });
    assert.equal(value(p, 'legal.litigation.search', 'unlinked'), 1);
    assert.equal(value(p, 'legal.litigation.search', 'search_standing'), 'A hit is ours and has no matter');
    assert.equal(view(p, 'legal.litigation.search_hits', 'matter', hit).missing, true);
    write(p, 'legal.litigation.search_hits', { matter: suit }, hit);
    assert.equal(value(p, 'legal.litigation.search', 'search_standing'), 'Every hit is placed');
    const namesake = add(p, 'legal.litigation.search_hits', { case_ref: 'O.S. 77/2019', registry: 'district_courts', relevant: 'namesake' });
    assert.equal(view(p, 'legal.litigation.search_hits', 'matter', namesake).shown, 'hidden');
    assert.equal(view(p, 'legal.litigation.search_hits', 'matter', namesake).missing, false);

    // A legal notice with ₹3.4 Cr claimed, its reply eleven days late.
    const notice = add(p, 'legal.litigation.notices', { reference: 'LN/2026/09', direction: 'received', kind: 'legal_notice', dated: '2026-09-15', counterparty: 'stk_bank', amount: '3.4 Cr', state: 'open', reply_due: '2026-10-01' });
    assert.equal(view(p, 'legal.litigation.register', 'claims_against_us').text, '₹3.87 Cr');
    assert.ok(said(p, LITIGATION).includes('The reply was due 11 days ago.'));
    write(p, 'legal.litigation.notices', { state: 'replied', replied_on: '2026-10-11' }, notice);
    assert.ok(!said(p, LITIGATION).includes('The reply was due 11 days ago.'));
    assert.equal(view(p, 'legal.litigation.register', 'claims_against_us').text, '₹46.5 lakh');
  });
});
