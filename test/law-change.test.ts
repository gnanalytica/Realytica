/**
 * A change on a watched page, as fields.
 *
 * That what a model sends is held to the page's own words and to lists: a
 * reference, a day and a figure stand only where a changed line writes
 * them, and what is affected only where it exists. That no sentence a model
 * sends is kept. That the line a person reads and the words an action
 * carries are made from the fields. That a confirmed change of a rate
 * offers a new dated rule row, unverified until a person marks it verified
 * by name. And that a change kept before changes were fields still reads.
 *
 * Every page, circular, figure and project is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RULE_ROWS,
  confirmLawChange,
  createProject,
  lawActionSaid,
  lawChangeSaid,
  lawDayOnPage,
  lawFieldsFrom,
  lawFieldsHeld,
  lawLists,
  lawNumberOnPage,
  lawProposalHeld,
  lawRuleRowRef,
  lawWatchHeld,
  ruleRow,
  ruleRowsWithOffers,
  verifyLawRuleRow,
  type LawChange,
  type LawSource,
  type LawWatchState,
} from '@realytica/shared';

const SOURCE: LawSource = { id: 'gst', title: 'GST rate notifications', url: 'https://tax.example.test/rates', jurisdiction: 'India', governs: 'GST on residential units', departments: ['finance', 'legal'], projectKinds: [], everyDays: 7, addedBy: 'dev@builders.example', addedAt: '2026-10-01T00:00:00.000Z' };
const DIFF = {
  added: ['Notification No. 11/2026-Central Tax (Rate) dated 5th October 2026: the rate on any other residential unit is 6 per cent with effect from 01.11.2026.'],
  removed: ['The rate on any other residential unit is 5 per cent.'],
  addedCount: 1,
  removedCount: 1,
};
const LISTS = lawLists(SOURCE, '2026-10-12');
const mark = (label: RegExp): string => [...LISTS.rows, ...LISTS.fields].find((held) => label.test(held.label))!.mark;

const said = () => ({
  summary: 'GST on ordinary flats goes up by a point next month, so every price list has to be redone.',
  instrument: 'notification',
  reference: 'Notification No. 11/2026-Central Tax (Rate)',
  dated: '2026-10-05',
  effective_from: '2026-11-01',
  change: 'rate_changed',
  was: { number: 5, unit: 'percent', date: '' },
  now: { number: 6, unit: 'percent', date: '' },
  affects: [mark(/GST on any other residential unit/), 'rera', 'r999'],
  quote: 'the rate on any other residential unit is 6 per cent',
  projects: [],
});

describe('a day and a number on a page', () => {
  it('finds a day however an official page writes it, and not a day that is only part of another', () => {
    for (const line of ['dated 5th October 2026', 'w.e.f. 05.10.2026', 'on 5/10/2026', 'October 5, 2026', 'the 5th day of October, 2026', '2026-10-05', '5 Oct 2026']) assert.equal(lawDayOnPage('2026-10-05', [line]), true, line);
    for (const line of ['15.10.2026', 'dated 25th October 2026', '5 October 2025', 'October 2026']) assert.equal(lawDayOnPage('2026-10-05', [line]), false, line);
    assert.equal(lawDayOnPage('next month', ['next month']), false);
  });

  it('finds a number with or without its commas, and not one that is part of another', () => {
    assert.equal(lawNumberOnPage(4000, ['plots above 4,000 square metres']), true);
    assert.equal(lawNumberOnPage(6, ['is 6 per cent']), true);
    assert.equal(lawNumberOnPage(6, ['Circular 16 of 2026']), false);
    assert.equal(lawNumberOnPage(2.25, ['an FAR of 2.25']), true);
  });
});

describe('a model’s fields for a change', () => {
  it('are kept where the changed lines and the lists bear them out', () => {
    const fields = lawFieldsHeld(said(), DIFF, LISTS);
    const row = RULE_ROWS.find((held) => held.key === 'gst_flat_other')!;
    assert.deepEqual(fields, {
      instrument: 'notification',
      reference: 'Notification No. 11/2026-Central Tax (Rate)',
      dated: '2026-10-05',
      effectiveFrom: '2026-11-01',
      change: 'rate_changed',
      was: { n: 5, unit: 'percent' },
      now: { n: 6, unit: 'percent' },
      affects: [{ kind: 'rule_row', row: lawRuleRowRef(row) }, { kind: 'approval', approval: 'rera' }],
    });
    assert.equal(lawChangeSaid(fields), 'Notification Notification No. 11/2026-Central Tax (Rate), dated 5 October 2026: Rate changed, 5% to 6%, in force from 1 November 2026.');
  });

  it('lose a reference, a day or a figure the lines do not write, and a pick that is on no list', () => {
    const fields = lawFieldsHeld({ ...said(), instrument: 'decree', reference: 'Notification No. 12/2026', dated: '2026-10-06', effective_from: '2026-12-01', change: 'everything', was: { number: 6, unit: 'percent', date: '' }, now: { number: 7, unit: 'percent', date: '' }, affects: ['nothing'] }, DIFF, LISTS);
    // "was" is read off the lines that went and "now" off those that came: the two the other way round are on neither.
    assert.deepEqual(fields, { affects: [] });
    assert.equal(lawChangeSaid(fields), '');
  });

  it('keep no sentence: a proposal is fields, a quote the page writes, and actions off lists', () => {
    const project = createProject({ name: 'Mill Lane flats', type: 'residential', location: 'Mill Lane', city: 'Kadamba', currentStage: 'construction' }, 'RYT-LC1', 'dev@builders.example');
    const answer = { ...said(), projects: [{ projectId: project.id, why: 'It sells flats that are not affordable housing.', actions: [{ department: 'finance', next: 'supersede_rule_row', about: mark(/GST on any other residential unit/), title: 'Re-price every unsold flat at the new rate.' }, { department: 'finance', next: 'make_a_plan', about: '' }] }] };
    const proposal = lawProposalHeld(answer, DIFF, SOURCE, [project], '2026-10-12T01:30:00.000Z', LISTS)!;
    assert.deepEqual(Object.keys(proposal).sort(), ['at', 'fields', 'projects', 'quote']);
    assert.equal(proposal.quote, 'the rate on any other residential unit is 6 per cent');
    assert.deepEqual(proposal.projects.map((row) => row.actions.map((action) => [action.department, action.next, action.about?.kind])), [[['finance', 'supersede_rule_row', 'rule_row']]]);
    const kept = JSON.stringify(proposal);
    for (const written of ['goes up by a point', 'It sells flats', 'Re-price every unsold flat']) assert.ok(!kept.includes(written), written);
    assert.equal(lawActionSaid(proposal.projects[0]!.actions[0]!), 'Check the new rate and mark its row verified: GST on any other residential unit, on the whole consideration');
    // Sentences alone are nothing usable.
    assert.equal(lawProposalHeld({ summary: 'Nothing of substance changed.', quote: 'not on the page', projects: [] }, DIFF, SOURCE, [project], '2026-10-12T01:30:00.000Z', LISTS), undefined);
  });
});

describe('a person’s fields', () => {
  it('are checked for shape and for what they name, and not held to the page', () => {
    assert.deepEqual(lawFieldsFrom({ change: 'clarification', reference: '  GO 45  of 2026 ', dated: '2026-09-30', affects: [{ kind: 'approval', approval: 'fire' }] }), { reference: 'GO 45 of 2026', dated: '2026-09-30', change: 'clarification', affects: [{ kind: 'approval', approval: 'fire' }] });
    assert.throws(() => lawFieldsFrom({ change: 'a rewrite' }), /kind of change is not one on the list/);
    assert.throws(() => lawFieldsFrom({ change: 'clarification', dated: 'last week' }), /not a day/);
    assert.throws(() => lawFieldsFrom({ change: 'clarification', affects: [{ kind: 'approval', approval: 'a licence nobody issues' }] }), /that exists/);
  });
});

describe('a confirmed change of a rate', () => {
  const admin = { email: 'dev@builders.example', name: 'Dev', role: 'owner' as const };
  const waiting = (): LawWatchState => ({ v: 1, sources: [SOURCE], changes: [{ id: 'chg1', sourceId: SOURCE.id, sourceTitle: SOURCE.title, url: SOURCE.url, seenAt: '2026-10-12T01:30:00.000Z', diff: DIFF, state: 'waiting' }] });

  it('offers a new dated rule row, unverified, and the table reads it from the day it takes effect', () => {
    const state = waiting();
    const fields = lawFieldsHeld(said(), DIFF, LISTS);
    const { offered, change } = confirmLawChange(state, 'chg1', { fields, projects: [] }, admin, [], '2026-10-13T09:00:00.000Z');
    assert.equal(change.state, 'confirmed');
    assert.deepEqual(change.fields, fields);
    assert.deepEqual(offered!.row, {
      key: 'gst_flat_other',
      label: 'GST on any other residential unit, on the whole consideration',
      jurisdiction: {},
      value: 6,
      unit: '%',
      from: '2026-11-01',
      source: { regulation: 'Notification Notification No. 11/2026-Central Tax (Rate)', url: SOURCE.url },
      verified: false,
    });
    assert.deepEqual(state.offeredRows!.map((held) => held.id), ['lrr_chg1']);
    const table = ruleRowsWithOffers(state.offeredRows!);
    assert.equal(ruleRow(table, 'gst_flat_other', {}, '2026-10-31')!.value, 5);
    const after = ruleRow(table, 'gst_flat_other', {}, '2026-11-01')!;
    assert.deepEqual([after.value, after.verified], [6, false]);
    // The table itself is as it was.
    assert.equal(ruleRow(RULE_ROWS, 'gst_flat_other', {}, '2026-12-01')!.value, 5);
  });

  it('is verified only by a person, by name, once', () => {
    const state = waiting();
    confirmLawChange(state, 'chg1', { fields: lawFieldsHeld(said(), DIFF, LISTS), projects: [] }, admin, [], '2026-10-13T09:00:00.000Z');
    assert.throws(() => verifyLawRuleRow(state.offeredRows!, 'lrr_none', 'Dev', '2026-10-14T09:00:00.000Z'), /No offered rule row/);
    const offer = verifyLawRuleRow(state.offeredRows!, 'lrr_chg1', 'Dev (dev@builders.example)', '2026-10-14T09:00:00.000Z');
    assert.deepEqual([offer.row.verified, offer.row.verifiedBy, offer.row.verifiedOn], [true, 'Dev (dev@builders.example)', '2026-10-14']);
    assert.throws(() => verifyLawRuleRow(state.offeredRows!, 'lrr_chg1', 'Dev', '2026-10-15T09:00:00.000Z'), /verified already/);
    // What was kept reads back with its offered rows.
    assert.equal(lawWatchHeld(JSON.parse(JSON.stringify(state)))!.offeredRows!.length, 1);
  });

  it('offers nothing where the change names no row, gives no figure, or is no change of a rate', () => {
    for (const fields of [{ ...lawFieldsHeld(said(), DIFF, LISTS), affects: [] }, { ...lawFieldsHeld(said(), DIFF, LISTS), now: undefined }, { ...lawFieldsHeld(said(), DIFF, LISTS), change: 'clarification' as const }]) {
      const state = waiting();
      assert.equal(confirmLawChange(state, 'chg1', { fields, projects: [] }, admin, [], '2026-10-13T09:00:00.000Z').offered, undefined);
      assert.equal(state.offeredRows, undefined);
    }
  });
});

describe('a change kept before changes were fields', () => {
  it('still opens, with the summary and the actions a model wrote then', () => {
    const before: LawChange = {
      id: 'old',
      sourceId: SOURCE.id,
      sourceTitle: SOURCE.title,
      url: SOURCE.url,
      seenAt: '2026-09-01T01:30:00.000Z',
      diff: DIFF,
      state: 'waiting',
      proposal: { summary: 'The rate on ordinary flats rises to 6%.', quote: '', projects: [{ projectId: 'p1', why: 'It sells flats.', actions: [{ department: 'finance', title: 'Re-price the unsold flats' }] }], at: '2026-09-01T01:30:00.000Z' },
    };
    const kept = lawWatchHeld({ v: 1, sources: [SOURCE], changes: [before, { ...before, id: 'older', state: 'confirmed', summary: 'The rate rises to 6%.' }] })!;
    assert.deepEqual(kept.changes[0], before);
    assert.equal(kept.changes[0]!.proposal!.fields, undefined);
    assert.equal(kept.changes[1]!.summary, 'The rate rises to 6%.');
    // An action written then has its title and no next step; it says what was written.
    assert.equal(lawActionSaid(before.proposal!.projects[0]!.actions[0]!), 'Re-price the unsold flats');
  });
});
