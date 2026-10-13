/**
 * What a field held before (docs/fields.md, History).
 *
 * - Only what stood enters a value's history: a value somebody offered, one
 *   in dispute and a usual value standing in never do.
 * - Every way a value starts or stops standing goes through one writer: a
 *   sheet, a record, a check, an acceptance, an edit made while accepting, a
 *   field marked not applicable and asked again, a mirror's owner.
 * - The history is bounded at twenty-four, thinned to month-ends.
 * - A field is read as at a day in India, and a day the record does not
 *   reach reads as now and says so.
 * - The trail says what a field held and what it holds.
 * - A project saved before any of this reads as it did.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HISTORY_MOST,
  addEvidence,
  addFieldRecord,
  createAssessment,
  createProject,
  decideField,
  decidesIn,
  departmentRole,
  fieldAsAt,
  fieldHistorySaid,
  fieldMoved,
  historySince,
  proposeFieldValues,
  readSheet,
  recordCheckFields,
  resolveFields,
  roleCanEdit,
  setFieldValues,
  setTeamMember,
  stand,
  thinHistory,
  type CheckFieldDef,
  type CheckFieldValue,
  type DdProject,
  type FieldAddress,
  type FieldOrigin,
  type FieldPast,
} from '@realytica/shared';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const OWNERS = 'legal.title.owners';
const LEAD = 'lead@firm.example';
const JUNIOR = 'junior@firm.example';
const at = (field: string, record?: string): FieldAddress => ({ fn: FN, set: record ? OWNERS : HOLDING, field, ...(record ? { record } : {}) });

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-HIS');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  setTeamMember(p, { email: LEAD, name: 'A. Rao', departments: { legal: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { legal: 'contributor' } }, 'owner');
  return p;
}

const seat = (p: DdProject, email: string) => ({ mayDecide: decidesIn(p, { email }), mayEdit: (department: Parameters<typeof departmentRole>[2]) => roleCanEdit(departmentRole(p, { email }, department)) });
const held = (p: DdProject, key: string): CheckFieldValue | undefined => p.fieldSheets?.[HOLDING]?.values[key];
const paper = (p: DdProject): FieldOrigin => {
  const row = addEvidence(p, { title: 'Sale deed 2019', kind: 'document' });
  row.documentType = 'Sale deed';
  return { kind: 'paper', evidenceId: row.id, page: 3, quote: 'measuring in all six thousand and seventy square metres, more or less, bounded on the east by the road and on the west by the tank', reader: 'model', proof: 'page_text' };
};
const typed = (value: CheckFieldValue['value'], when: string, by = LEAD): CheckFieldValue => ({ value, at: when, by, state: 'typed', origin: { kind: 'person' } });

describe('what enters a field’s history', () => {
  it('a typed value that gives way to another is kept, with who made it stand and from when until when', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { access_confidence: 2 }, JUNIOR, seat(p, JUNIOR));
    assert.equal(held(p, 'access_confidence')!.history, undefined, 'a first value has nothing behind it');
    setFieldValues(p, { set: HOLDING }, { access_confidence: 4 }, LEAD, seat(p, LEAD));
    const now = held(p, 'access_confidence')!;
    assert.equal(now.value, 4);
    assert.equal(now.history!.length, 1);
    const [past] = now.history!;
    assert.deepEqual({ value: past!.value, state: past!.state, by: past!.by }, { value: 2, state: 'typed', by: JUNIOR });
    assert.equal(past!.until, now.at, 'it stopped standing the moment the next began');
    assert.ok(past!.at <= past!.until);
  });

  it('the value a field already holds, typed again, adds nothing', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { access_confidence: 3 }, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: HOLDING }, { access_confidence: 3 }, LEAD, seat(p, LEAD));
    assert.equal(held(p, 'access_confidence')!.history, undefined);
  });

  it('a value somebody offered never enters: not while it waits, not when it is set aside, and not beside a value held', () => {
    const p = project();
    const origin = paper(p);
    proposeFieldValues(p, [{ address: at('extent'), value: 6070, origin }], 'model');
    assert.equal(held(p, 'extent')!.history, undefined, 'waiting on an empty field');
    decideField(p, at('extent'), 'set_aside', LEAD, {}, seat(p, LEAD));
    assert.equal(held(p, 'extent')?.history, undefined, 'set aside');
    setFieldValues(p, { set: HOLDING }, { extent: '5000 sqm' }, LEAD, seat(p, LEAD));
    proposeFieldValues(p, [{ address: at('extent'), value: 6100, origin }], 'model');
    assert.equal(held(p, 'extent')!.history, undefined, 'offered beside a value that stands: the value held still stands');
    assert.equal(held(p, 'extent')!.value, 5000);
  });

  it('accepting a value offered beside the one held keeps the one it replaced, and an edit made while accepting keeps nothing of the offer', () => {
    const p = project();
    const origin = paper(p);
    setFieldValues(p, { set: HOLDING }, { extent: '5000 sqm' }, JUNIOR, seat(p, JUNIOR));
    proposeFieldValues(p, [{ address: at('extent'), value: 6070, origin }], 'model');
    decideField(p, at('extent'), 'accept', LEAD, { pick: 0 }, seat(p, LEAD));
    const now = held(p, 'extent')!;
    assert.equal(now.value, 6070);
    assert.deepEqual(now.history!.map((entry) => [entry.value, entry.state]), [[5000, 'typed']]);

    const q = project();
    proposeFieldValues(q, [{ address: at('extent'), value: 6070, origin: paper(q) }], 'model');
    decideField(q, at('extent'), 'accept', LEAD, { value: '6075 sqm' }, seat(q, LEAD));
    assert.equal(held(q, 'extent')!.value, 6075, 'the person’s own figure stands');
    assert.equal(held(q, 'extent')!.history, undefined, 'the offer never stood, so it is not history');
  });

  it('a value accepted from a paper keeps its source, the paper’s words cut to eighty characters', () => {
    const p = project();
    proposeFieldValues(p, [{ address: at('extent'), value: 6070, origin: paper(p) }], 'model');
    decideField(p, at('extent'), 'accept', LEAD, {}, seat(p, LEAD));
    // Typed over a value accepted from a paper: the two are in dispute, and neither stands.
    setFieldValues(p, { set: HOLDING }, { extent: '6100 sqm' }, JUNIOR, seat(p, JUNIOR));
    const disputed = held(p, 'extent')!;
    assert.equal(disputed.state, 'disputed');
    assert.equal(disputed.history!.length, 1, 'the accepted value stopped standing when the dispute began');
    const [past] = disputed.history!;
    assert.equal(past!.state, 'accepted');
    assert.equal(past!.by, LEAD, 'who made it stand: the person who accepted it');
    assert.equal(past!.origin?.kind, 'paper');
    assert.equal((past!.origin as { quote: string }).quote.length, 80);
    // Kept: it stands again from now, and the dispute itself added nothing more.
    decideField(p, at('extent'), 'keep', LEAD, {}, seat(p, LEAD));
    const kept = held(p, 'extent')!;
    assert.equal(kept.state, 'accepted');
    assert.equal(kept.history!.length, 1, 'a value in dispute was not standing, so keeping one adds no entry');
  });

  it('marking a field not applicable keeps what it held, and asking again keeps that it did not apply', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { access_confidence: 4 }, LEAD, seat(p, LEAD));
    decideField(p, at('access_confidence'), 'not_applicable', LEAD, { reason: 'not_at_this_stage' }, seat(p, LEAD));
    const na = held(p, 'access_confidence')!;
    assert.deepEqual(na.history!.map((entry) => entry.value), [4]);
    assert.equal((na.was as CheckFieldValue | undefined)?.history, undefined, 'what it held is kept once, not a second time inside what is put back');
    decideField(p, at('access_confidence'), 'reopen', LEAD, {}, seat(p, LEAD));
    const back = held(p, 'access_confidence')!;
    assert.equal(back.value, 4);
    assert.deepEqual(back.history!.map((entry) => entry.state), ['not_applicable', 'typed']);
    assert.ok((back.since ?? back.at) >= na.at, 'it stands again from the moment it was asked again');
  });

  it('clearing a field keeps its past on the empty field', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { access_confidence: 4 }, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: HOLDING }, { access_confidence: null }, LEAD, seat(p, LEAD));
    const cleared = held(p, 'access_confidence')!;
    assert.equal(cleared.value, null);
    assert.deepEqual(cleared.history!.map((entry) => entry.value), [4]);
    const view = readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'access_confidence')!;
    assert.equal(view.state, 'empty', 'and it reads as empty');
    const q = project();
    setFieldValues(q, { set: HOLDING }, { remarks: null }, LEAD, seat(q, LEAD));
    assert.equal(held(q, 'remarks'), undefined, 'a field with no past is still simply not there');
  });

  it('a usual value standing in never enters, and nor does a table’s rows: a table keeps how many it had', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { chain: [{ on: '2019-03-01', event: 'sale', from: 'A', to: 'B' }] }, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: HOLDING }, { chain: [{ on: '2019-03-01', event: 'sale', from: 'A', to: 'B' }, { on: '2021-06-01', event: 'gift', from: 'B', to: 'C' }] }, LEAD, seat(p, LEAD));
    const [past] = held(p, 'chain')!.history!;
    assert.equal(past!.value, null);
    assert.equal(past!.rows, 1);
    for (const sheet of Object.values(p.fieldSheets ?? {})) for (const value of Object.values(sheet.values)) for (const entry of value.history ?? []) assert.notEqual((entry as { state: string }).state, 'assumed');
  });

  it('a record’s field and a check’s field keep their past the same way', () => {
    const p = project();
    const { record } = addFieldRecord(p, OWNERS, { name: 'R. Gowda', share_pct: 40 }, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: OWNERS, record: record!.id }, { share_pct: 60 }, LEAD, seat(p, LEAD));
    const share = p.fieldSheets![OWNERS]!.records![0]!.values.share_pct!;
    assert.deepEqual(share.history!.map((entry) => entry.value), [40]);

    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'land_site.parcel_identification')!;
    recordCheckFields(p, check.id, { extent_title: 5000 }, JUNIOR);
    recordCheckFields(p, check.id, { extent_title: 5200 }, LEAD);
    assert.deepEqual(check.fields!.extent_title!.history!.map((entry) => [entry.value, entry.by]), [[5000, JUNIOR]]);
    const trail = p.audit.filter((event) => event.action === 'record_check_fields').at(-1)!;
    assert.match(trail.oldValue ?? '', /extent_title: 5,000/);
    assert.match(trail.newValue ?? '', /extent_title: 5,200/);
  });

  it('a mirror says its owner’s past, and holds none of its own', () => {
    const p = project();
    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'land_site.parcel_identification')!;
    recordCheckFields(p, check.id, { extent_title: 5000 }, JUNIOR);
    recordCheckFields(p, check.id, { extent_title: 5200 }, LEAD);
    const mirror = readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'extent_on_check')!;
    assert.ok(mirror.def.sameAs, 'the field is a mirror');
    assert.match(mirror.past?.line ?? '', /^Was 5,000 .* on .*; now 5,200/);
    assert.equal(held(p, 'extent_on_check'), undefined);
  });
});

describe('the trail', () => {
  it('says what a typed field held and what it holds, as the field prints them', () => {
    const p = project();
    setFieldValues(p, { set: HOLDING }, { extent: '5000 sqm' }, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: HOLDING }, { extent: '1 acre 20 guntas' }, LEAD, seat(p, LEAD));
    const event = p.audit.filter((line) => line.action === 'set_field_values').at(-1)!;
    assert.match(event.oldValue ?? '', /^extent: 5,000 sqm/);
    assert.match(event.newValue ?? '', /^extent: 1 acre 20 guntas/);
    proposeFieldValues(p, [{ address: at('extent'), value: 6070, origin: paper(p) }], 'model');
    decideField(p, at('extent'), 'accept', LEAD, { pick: 0 }, seat(p, LEAD));
    const decided = p.audit.filter((line) => line.action === 'field_accept').at(-1)!;
    assert.match(decided.oldValue ?? '', /1 acre 20 guntas/);
    assert.equal(decided.newValue, '6070');
  });
});

describe('the bound on a field’s history', () => {
  const entry = (n: number, from: string, until: string): FieldPast => ({ value: n, state: 'typed', by: LEAD, at: from, until });
  /** One change a week from 1 January 2026, newest first. */
  const weekly = (count: number): FieldPast[] =>
    Array.from({ length: count }, (_, index) => {
      const from = new Date(Date.UTC(2026, 0, 1 + index * 7, 6));
      const until = new Date(Date.UTC(2026, 0, 8 + index * 7, 6));
      return entry(index, from.toISOString(), until.toISOString());
    }).reverse();

  it('keeps everything up to twenty-four', () => {
    assert.equal(thinHistory(weekly(HISTORY_MOST)).length, HISTORY_MOST);
  });

  it('past that keeps the first, the latest twelve, and of the rest the ones that stood at a month’s end', () => {
    const all = weekly(40);
    const thinned = thinHistory(all);
    assert.ok(thinned.length <= HISTORY_MOST);
    assert.equal(thinned.at(-1)!.value, 0, 'the first');
    assert.deepEqual(thinned.slice(0, 12).map((e) => e.value), all.slice(0, 12).map((e) => e.value), 'the latest twelve');
    const between = thinned.slice(12, -1);
    assert.ok(between.length > 0);
    for (const kept of between) assert.notEqual(kept.at.slice(0, 7), kept.until.slice(0, 7), `entry ${String(kept.value)} stood over a month’s end`);
    // Whatever was dropped left a hole, and the entry before the hole says so.
    const marked = thinned.filter((e) => e.thinnedAfter);
    assert.ok(marked.length > 0);
    for (const e of marked) {
      const next = thinned[thinned.indexOf(e) - 1]!;
      assert.ok(next.at > e.until, 'what followed it is gone');
    }
  });

  it('holds through the writer: a field changed forty times keeps at most twenty-four', () => {
    const holder: Record<string, CheckFieldValue> = {};
    for (let index = 0; index < 41; index += 1) {
      const when = new Date(Date.UTC(2026, 0, 1 + index * 7, 6)).toISOString();
      stand(holder, 'rate', typed(index, when), { at: when, by: LEAD });
    }
    assert.equal(holder.rate!.value, 40);
    assert.ok(holder.rate!.history!.length <= HISTORY_MOST);
    assert.equal(holder.rate!.history!.at(-1)!.value, 0);
    assert.equal(holder.rate!.history![0]!.value, 39);
  });
});

describe('a field as at a day', () => {
  // 4.10 from 12 August, 4.25 from 30 September 23:59:59 in India, 4.32 from 1 October 00:00:00 in India.
  const holder: Record<string, CheckFieldValue> = {};
  const moments = ['2026-08-12T05:00:00.000Z', '2026-09-30T18:29:59.000Z', '2026-09-30T18:30:00.000Z'];
  [41000000, 42500000, 43200000].forEach((value, index) => stand(holder, 'budget', typed(value, moments[index]!), { at: moments[index]!, by: LEAD }));
  const value = holder.budget!;

  it('reads what stood when the day ended in India, to the second', () => {
    assert.equal(fieldAsAt(value, '2026-08-12').value?.value, 41000000);
    assert.equal(fieldAsAt(value, '2026-09-29').value?.value, 41000000);
    assert.equal(fieldAsAt(value, '2026-09-30').value?.value, 42500000, 'typed a second before midnight in India: it stood when 30 September ended');
    assert.equal(fieldAsAt(value, '2026-10-01').value?.value, 43200000, 'typed at midnight in India: 1 October’s');
    assert.equal(fieldAsAt(value, '2026-10-01').how, 'now');
    assert.equal(fieldAsAt(value, '2026-09-30').how, 'past');
  });

  it('before the record holds anything of it, reads as now and says from when history is kept', () => {
    const before = fieldAsAt(value, '2026-08-11');
    assert.equal(before.how, 'as_now');
    assert.equal(before.value?.value, 43200000);
    assert.equal(before.since, '2026-08-12');
    assert.equal(historySince(value), moments[0]);
  });

  it('where the project’s history is whole that far back, a day before the first value is a day the field was empty', () => {
    assert.deepEqual(fieldAsAt(value, '2026-08-11', '2026-07-01T00:00:00.000Z'), { how: 'none' });
    const earlier = fieldAsAt(value, '2026-06-30', '2026-07-01T00:00:00.000Z');
    assert.equal(earlier.how, 'as_now', 'before the project’s history begins nothing can be said');
    assert.equal(earlier.since, '2026-07-01');
  });

  it('a day between a value cleared and the next typed is a day nothing stood', () => {
    const gap: Record<string, CheckFieldValue> = {};
    stand(gap, 'k', typed(1, '2026-07-01T06:00:00.000Z'), { at: '2026-07-01T06:00:00.000Z', by: LEAD });
    stand(gap, 'k', null, { at: '2026-07-10T06:00:00.000Z', by: LEAD });
    stand(gap, 'k', typed(2, '2026-07-20T06:00:00.000Z'), { at: '2026-07-20T06:00:00.000Z', by: LEAD });
    assert.equal(fieldAsAt(gap.k, '2026-07-05').value?.value, 1);
    assert.equal(fieldAsAt(gap.k, '2026-07-15').how, 'none');
    assert.equal(fieldAsAt(gap.k, '2026-07-20').value?.value, 2);
  });

  it('says how a field moved since a day, and that nothing can be said where the record does not reach', () => {
    assert.deepEqual({ moved: fieldMoved(value, '2026-08-31').moved, by: fieldMoved(value, '2026-08-31').by }, { moved: true, by: 2200000 });
    assert.equal(fieldMoved(value, '2026-10-01').moved, false);
    assert.equal(fieldMoved(value, '2026-08-01').unknown, true);
  });

  it('is said in the popover as one line put together from the record, with the figures for a small line where there are three', () => {
    const def: CheckFieldDef = { key: 'budget', label: 'Budget', kind: 'money', currency: 'INR' };
    const said = fieldHistorySaid(def, value, undefined, (by) => (by === LEAD ? 'A. Rao' : by))!;
    assert.equal(said.line, 'Was ₹4.25 Cr on 30 Sep 2026 (A. Rao); now ₹4.32 Cr');
    assert.deepEqual(said.spark, [41000000, 42500000, 43200000]);
    assert.equal(said.earlier, 2);
    assert.equal(said.since, '2026-08-12');
    const two: Record<string, CheckFieldValue> = {};
    stand(two, 'b', typed(1, moments[0]!), { at: moments[0]!, by: LEAD });
    stand(two, 'b', typed(2, moments[1]!), { at: moments[1]!, by: LEAD });
    assert.equal(fieldHistorySaid(def, two.b)!.spark, undefined, 'two figures are not a line');
    assert.equal(fieldHistorySaid(def, typed(1, moments[0]!)), undefined, 'and a field that held nothing before says nothing');
  });
});

describe('a project saved before history was kept', () => {
  it('reads as it did: no field has a past, nothing is counted differently, and its first change is where its history begins', () => {
    const p = project();
    p.fieldSheets = { [HOLDING]: { values: { access_confidence: { value: 3, at: '2026-05-01T06:00:00.000Z', by: LEAD } } } };
    delete p.historyFrom;
    const view = readSheet(p, HOLDING)!.fields.find((f) => f.def.key === 'access_confidence')!;
    assert.equal(view.past, undefined);
    assert.equal(view.text, '3');
    assert.equal(resolveFields(p).read(at('access_confidence'))?.value, 3);
    assert.equal(fieldAsAt(held(p, 'access_confidence'), '2026-04-01').how, 'as_now');
    setFieldValues(p, { set: HOLDING }, { access_confidence: 5 }, LEAD, seat(p, LEAD));
    assert.ok(p.historyFrom, 'the project’s history begins at its first change');
    assert.deepEqual(held(p, 'access_confidence')!.history!.map((entry) => [entry.value, entry.at]), [[3, '2026-05-01T06:00:00.000Z']]);
  });
});
