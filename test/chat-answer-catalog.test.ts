/**
 * The chat's card over the whole catalog.
 *
 * A model answers by picking addresses, and the card is printed from the
 * record. This holds the card to every field the catalog registers: a
 * sheet's, a record's, a check's, a field a department adds to a shared
 * record, a hard case's. A worked-out figure is said to be worked out, never
 * accepted, and names the rule rows it read with whether a person has
 * verified them. Every name and figure here is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIELD_SETS, addFieldRecord, chatAnswerCard, chatAnswerText, createAssessment, createProject, fieldCatalog, setFieldValues, type ChatAnswerPicks, type DdProject, type FieldAddress } from '@realytica/shared';

const LEAD = 'Lead';
const picks = (fields: FieldAddress[], look: FieldAddress[] = []): ChatAnswerPicks => ({ outcome: 'answered', fields, records: [], memory: [], passages: [], lookAtFields: look, lookAtPapers: [] });

function project(): DdProject {
  const p = createProject({ name: 'Lakeside Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CHC', LEAD);
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Diligence', owner: LEAD, targetType: 'project' });
  return p;
}

describe('the chat’s card over the whole catalog', () => {
  it('can name every registered field: each one either answers or is offered as where to look', () => {
    const p = project();
    const catalog = fieldCatalog();
    // One record of every set that repeats, so a field of a record has a holder to be read on.
    const records = new Map<string, string>();
    for (const set of catalog.sets.values()) if (set.records) records.set(set.id, addFieldRecord(p, set.id, {}, LEAD).record!.id);
    let named = 0;
    for (const set of catalog.sets.values()) {
      const record = records.get(set.id);
      const addresses = set.fields.filter((def) => !def.retired).map((def): FieldAddress => ({ fn: set.fn, set: set.id, field: def.key, ...(record ? { record } : {}) }));
      // The card takes a handful at a time: every field is asked for, eight to a card.
      for (let from = 0; from < addresses.length; from += 8) {
        const asked = addresses.slice(from, from + 8);
        const card = chatAnswerCard(p, picks(asked, asked));
        const answered = new Set(card.rows.map((row) => row.address?.field));
        for (const address of asked) {
          // A field that holds nothing is something to look at; the card lists six of those at most, so each is asked for alone where it was not listed.
          const shown = answered.has(address.field) || card.look.some((held) => held.address?.field === address.field) || chatAnswerCard(p, picks([address], [address])).look.length + chatAnswerCard(p, picks([address], [address])).rows.length === 1;
          assert.ok(shown, `${set.id}/${address.field}`);
          named += 1;
        }
      }
    }
    assert.ok(named > 3000, `${named} fields named`);
    assert.equal(FIELD_SETS.filter((set) => !catalog.sets.has(set.id) && !set.extends).length, 0, 'and no set the departments declare is missing from the catalog');
  });

  it('says a worked-out figure is worked out, with the rule rows it read and that nobody has verified them', () => {
    const p = project();
    const unit = addFieldRecord(p, 'shared.units', { number: 'A-101', carpet_area: '120 sqm', price_for_tax: 9_000_000 }, LEAD).record!;
    setFieldValues(p, { set: 'legal.rera.registration' }, { registration_no: 'PRM/KA/RERA/0000/000/PR/000000/000000' }, LEAD);
    const card = chatAnswerCard(
      p,
      picks([
        { fn: 'shared', set: 'shared.units', field: 'gst_rate', record: unit.id },
        { fn: 'legal.rera', set: 'legal.rera.registration', field: 'registration_no' },
        { fn: 'shared', set: 'shared.units', field: 'price_for_tax', record: unit.id },
      ]),
    );
    const [rate, number, price] = card.rows;
    assert.deepEqual([rate!.label, rate!.value, rate!.standing], ['GST rate on the consideration (Units · A-101)', '5 %', 'worked_out']);
    assert.ok(rate!.rules!.some((rule) => /^GST on any other residential unit/.test(rule.said) && rule.verified === false));
    assert.deepEqual([number!.standing, number!.rules], ['typed', undefined], 'a value a person entered is said to be entered, and reads no rule');
    assert.equal(price!.label, 'Consideration, for GST (Units · A-101)', 'a field Tax adds to the unit is on the unit');
    assert.match(chatAnswerText(card), /GST rate on the consideration \(Units · A-101\): 5 % \(Worked out; .*not verified/);
  });

  it('names nothing that is not there: an address of no set, no field or no record is left out', () => {
    const p = project();
    const card = chatAnswerCard(p, picks([{ fn: 'legal.title', set: 'legal.title.nowhere', field: 'x' }, { fn: 'legal.rera', set: 'legal.rera.registration', field: 'no_such_field' }, { fn: 'shared', set: 'shared.units', field: 'number', record: 'rec_none' }]));
    assert.deepEqual([card.rows, card.look, card.outcome], [[], [], 'not_on_record']);
  });
});
