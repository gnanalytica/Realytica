/**
 * The design department's field sets (the architect's, the interior and
 * landscape designer's, the structural engineer's and the services
 * engineer's), held to what a person sees.
 *
 * Each test builds a project with invented values and reads a function's
 * sheets the way its page does: how little shows before anything is known,
 * what a situation brings into play, what is worked out and from what, what
 * a rule says when it fails and that it stops saying it, which rule row a
 * limit came from and that it shows as unverified, and that a limit nobody
 * has loaded is said to be not on file and is never a pass.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEPARTMENTS,
  FIELD_SETS,
  RULE_ROWS,
  RULE_SHAPES,
  addEvidence,
  addFieldRecord,
  catalogFaults,
  catalogLimits,
  createProject,
  ensureWorkstreamChecks,
  functionHasSheets,
  functionSections,
  menuFunctions,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  ruleRowFaults,
  setFieldValues,
  setSituation,
  type DdProject,
} from '@realytica/shared';

const NOW = new Date('2026-10-13T00:00:00Z');
const BY = 'architect@example.com';

/** An invented apartment project in Bengaluru, with the checks the design sheets read already on it. */
function project(): DdProject {
  const p = createProject({ name: 'Lakeside Court', type: 'residential', location: 'Lakeside Road', city: 'Bengaluru' }, 'RYT-DSN');
  p.jurisdiction = 'Karnataka';
  ensureWorkstreamChecks(p, ['construction.quality', 'design.drawings', 'legal.approvals', 'legal.title'], BY);
  return p;
}

/** A value recorded on one of the checks that already exist, as its own function would record it. */
function onCheck(p: DdProject, definitionId: string, values: Record<string, unknown>): void {
  const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;
  const paper = addEvidence(p, { title: `Paper for ${definitionId}`, kind: 'document' }, BY);
  assert.deepEqual(recordCheckFields(p, check.id, values as never, BY, paper.id).rejected, []);
}

const write = (p: DdProject, set: string, values: Record<string, unknown>) => assert.deepEqual(setFieldValues(p, { set }, values, BY).rejected, [], set);
const add = (p: DdProject, set: string, values: Record<string, unknown>) => {
  const made = addFieldRecord(p, set, values, BY);
  assert.deepEqual(made.rejected ?? [], [], set);
  return made.record!;
};

/** One sheet, or one record of a set that repeats, as the page reads it. */
function sheet(p: DdProject, set: string, record?: string) {
  const reading = readSheet(p, set, record, undefined, undefined, NOW)!;
  const view = (key: string) => reading.fields.find((f) => f.def.key === key)!;
  return {
    reading,
    view,
    text: (key: string) => view(key).text,
    value: (key: string) => view(key).held?.value ?? null,
    shown: reading.fields.filter((f) => f.shown === 'shown').map((f) => f.def.key),
    said: reading.insights.map((i) => i.text),
  };
}

/** Two unit types and a tower: the unit mix every services sheet works from. */
function unitMix(p: DdProject): void {
  add(p, 'shared.buildings', { name: 'Tower A', floors: 8, basements: 1, height: '24 m' });
  add(p, 'design.brief.unit_types', { name: '2BHK East', kind: '2bhk', count: 40, carpet_area: 70, balcony_area: 6, wall_area: 8, common_share_area: 21, connected_kw_each: 5 });
  add(p, 'design.brief.unit_types', { name: '3BHK', kind: '3bhk', count: 24, carpet_area: 95, balcony_area: 8, wall_area: 10, common_share_area: 28, connected_kw_each: 7 });
}

const DESIGN = DEPARTMENTS.find((d) => d.key === 'design')!;
const MINE = FIELD_SETS.filter((set) => set.fn.startsWith('design.'));

describe('the design department’s catalog', () => {
  it('has no fault and breaks no limit, set by set', () => {
    assert.deepEqual(catalogFaults().filter((fault) => fault.includes('design.')), []);
    assert.deepEqual(catalogLimits().filter((breach) => breach.set.startsWith('design.')), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
  });

  it('gives every function of Design a sheet, so Design is a page of its functions and no longer muted', () => {
    assert.equal(DESIGN.workstreams.length, 22);
    for (const ws of DESIGN.workstreams) {
      assert.ok(functionHasSheets(ws.key), `${ws.key} has no sheet`);
      assert.deepEqual(functionSections(ws.key), ['sheet', 'documents'], ws.key);
      assert.deepEqual(ws.stages, ['pre_development', 'design_tender', 'construction'], `${ws.key} has work at the stages Design has`);
      assert.ok(ws.group, `${ws.key} is under no profession`);
    }
    assert.equal(menuFunctions('construction').find((fn) => fn.key === 'design')!.built, true);
  });

  it('shows a dozen fields at most on any sheet before anything is known, and twenty at most on a record', () => {
    const p = project();
    for (const set of MINE) {
      if (set.extends) continue;
      if (set.records) {
        assert.ok(set.fields.length <= 20, `${set.id} has ${set.fields.length} fields`);
        continue;
      }
      const { shown } = sheet(p, set.id);
      assert.ok(shown.length <= 12, `${set.id} opens on ${shown.length} fields: ${shown.join(', ')}`);
    }
  });

  it('keeps every figure a code sets in the rule table, unverified, and names the limits nobody has read as shapes with no figure', () => {
    const read = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const formula = node as { op?: string; table?: string };
      if (formula.op === 'rate' && formula.table) read.add(formula.table);
      for (const part of Object.values(node)) walk(part);
    };
    for (const set of MINE) for (const def of set.fields) walk(def.formula);
    const rows = new Set(RULE_ROWS.map((row) => row.key));
    const shapes = new Set(RULE_SHAPES.map((shape) => shape.key));
    for (const key of read) assert.ok(rows.has(key) !== shapes.has(key), `${key} is a row with a figure or a shape without one, not both and not neither`);
    for (const shape of RULE_SHAPES) {
      assert.ok(read.has(shape.key), `no field reads the shape ${shape.key}`);
      assert.ok(shape.source.regulation && shape.source.clause, `${shape.key} says where it is written`);
    }
    const mine = RULE_ROWS.filter((row) => read.has(row.key));
    assert.ok(mine.length >= 15);
    for (const row of mine) assert.equal(row.verified, false, `${row.key} was not read in the instrument and says so`);
    // No option is a way of saying nothing, and no model writes prose: a longtext is a person's and is capped.
    for (const set of MINE) for (const def of set.fields) if (def.kind === 'longtext') assert.ok((def.maxLength ?? 0) <= 400, `${set.id}/${def.key}`);
  });
});

describe('Design › Design compliance: the planning limits of a tower that turns out to be high-rise', () => {
  const HEIGHT = 'design.compliance.height';
  const FAR = 'design.compliance.far';

  it('opens on eight fields, reads the high-rise line from an unverified row, and brings the fire access in only once the height crosses it', () => {
    const p = project();
    const empty = sheet(p, HEIGHT);
    assert.deepEqual(empty.shown, ['section_drawing', 'building_height', 'high_rise_from', 'height_class', 'airport_height_allowed', 'height_allowed', 'height_standing', 'setbacks_short']);
    assert.equal(empty.view('fire_access_width').shown, 'hidden');
    assert.equal(empty.reading.total, 2, 'only the drawing and the height are asked for');

    // The high-rise line is the state's row, not the national one, and nobody has checked it against the Act.
    assert.equal(empty.text('high_rise_from'), '21 m');
    assert.deepEqual(empty.view('high_rise_from').cites?.map((c) => [c.key, c.value, c.verified]), [['high_rise_height_m', 21, false]]);
    assert.match(empty.view('high_rise_from').cites![0]!.source.regulation, /Karnataka Fire Force/);

    write(p, HEIGHT, { building_height: '19.5 m' });
    const low = sheet(p, HEIGHT);
    assert.equal(low.text('height_class'), 'Below the high-rise line');
    assert.equal(low.view('height_class').cites?.[0]?.verified, false, 'the standing carries the row it was read from');
    assert.equal(low.text('height_standing'), 'Limit not on file', 'no height limit is loaded, and that is not a pass');
    assert.equal(low.view('fire_access_width').shown, 'hidden');
    assert.equal(readFunctionFields(p, 'design.compliance', NOW).situations.find((s) => s.situation.key === 'high_rise')!.state, 'off');

    write(p, HEIGHT, { building_height: 24 });
    const high = sheet(p, HEIGHT);
    assert.equal(high.text('height_class'), 'High-rise');
    assert.equal(high.view('fire_access_width').shown, 'shown');
    assert.equal(high.view('fire_access_width').missing, true);
    assert.deepEqual(high.said, ['The building is high-rise and the fire tender’s way is not measured.']);
    assert.equal(readFunctionFields(p, 'design.compliance', NOW).situations.find((s) => s.situation.key === 'high_rise')!.state, 'on', 'nobody set it: it follows from the height');
    // And the services engineer's fire sheet answers to the same fact without being told.
    assert.equal(sheet(p, 'design.fire.escape').view('fire_command_centre').shown, 'shown');
    assert.equal(sheet(p, 'design.electrical.capacity').view('life_safety_on_generator').shown, 'shown');

    write(p, HEIGHT, { fire_access_width: '6 m' });
    assert.deepEqual(sheet(p, HEIGHT).said, []);
    // A building exactly at the line is high-rise.
    write(p, HEIGHT, { building_height: 21 });
    assert.equal(sheet(p, HEIGHT).text('height_class'), 'High-rise');
  });

  it('works a setback out from the height, cites the band it read, and says nothing is on file outside the bands that were read', () => {
    const p = project();
    write(p, HEIGHT, { building_height: '19.5 m' });
    const front = add(p, 'design.compliance.setbacks', { side: 'front', provided: '5 m' });
    const short = sheet(p, 'design.compliance.setbacks', front.id);
    assert.equal(short.text('required'), '7 m');
    assert.equal(short.text('shortfall'), '2 m');
    assert.equal(short.text('standing'), 'Short of the setback');
    assert.deepEqual(short.view('standing').cites?.map((c) => [c.key, c.value, c.verified]), [['setback_all_round_m', 7, false]]);
    assert.equal(sheet(p, HEIGHT).value('setbacks_short'), 1);
    assert.deepEqual(sheet(p, HEIGHT).said, ['Sides short of the setback the height calls for: 1.']);

    assert.deepEqual(setFieldValues(p, { set: 'design.compliance.setbacks', record: front.id }, { provided: '7.5 m' }, BY).rejected, []);
    assert.equal(sheet(p, 'design.compliance.setbacks', front.id).text('standing'), 'Meets the setback');
    assert.deepEqual(sheet(p, HEIGHT).said, []);

    // At 24 m no band that was read applies: the setback is not on file, and that is said.
    write(p, HEIGHT, { building_height: 24 });
    const tall = sheet(p, 'design.compliance.setbacks', front.id);
    assert.equal(tall.value('required'), null);
    assert.equal(tall.text('standing'), 'Limit not on file');
  });

  it('works FAR out from the floors and the plot, fails it, and passes it once premium FAR is in play with its fields', () => {
    const p = project();
    onCheck(p, 'land_site.parcel_identification', { extent_title: 4000 });
    onCheck(p, 'regulatory.sanction', { permissible_far: 2.25, sanctioned_area: 9000 });
    for (const level of ['B1', 'Ground', '1', '2', '3', '4']) add(p, 'design.areas.floors', { level, built_up: 2400, ...(level === 'B1' ? { far_exempt: 2400 } : {}) });

    // The area statement: six floors of 2,400 sqm, the basement left out of FAR.
    const areas = sheet(p, 'design.areas.statement');
    assert.equal(areas.text('total_built_up'), '14,400 sqm');
    assert.equal(areas.text('far_area_total'), '12,000 sqm');
    assert.equal(areas.text('area_standing'), 'Over the sanctioned area');
    assert.deepEqual(areas.said, ['The floors add to 14,400 sqm and 9,000 sqm is sanctioned.']);

    const over = sheet(p, FAR);
    assert.equal(over.text('plot_extent'), '4,000 sqm');
    assert.equal(over.value('far_allowed'), 2.25, 'read from the zoning certificate on Approvals, not typed again');
    assert.equal(over.value('far_achieved'), 3);
    assert.equal(over.text('far_standing'), 'Over the limit');
    assert.deepEqual(over.said, ['FAR achieved is 3 and the ceiling is 2.25.']);
    // The premium FAR fields are there and not in play: not shown, and not counted as missing.
    for (const key of ['far_premium', 'far_premium_kind', 'far_premium_order']) {
      assert.equal(over.view(key).shown, 'hidden');
      assert.equal(over.view(key).missing, false);
    }
    assert.equal(over.reading.total, 3, 'the authority, the regulations and the zone are all it asks for');
    const before = readFunctionFields(p, 'design.compliance', NOW);
    assert.ok(!before.exceptions.some((e) => e.kind === 'missing' && /premium|Added by|Order/.test(e.label)));

    setSituation(p, 'design.compliance', 'tdr_or_premium_far', true, BY);
    write(p, FAR, { far_premium: 0.9, far_premium_kind: 'premium FAR' });
    const within = sheet(p, FAR);
    assert.equal(within.view('far_premium').shown, 'shown');
    assert.equal(within.value('far_ceiling'), 3.15);
    assert.equal(within.text('far_standing'), 'Within the limit');
    assert.deepEqual(within.said, ['Premium FAR or development rights are counted and the order is not on file.']);
    assert.equal(within.view('far_premium_order').missing, true);

    // Ground coverage has no figure loaded for any zone: it is worked out and held against nothing.
    write(p, 'design.compliance.coverage', { footprint_area: 2400 });
    write(p, FAR, { zone_class: 'residential main' });
    const coverage = sheet(p, 'design.compliance.coverage');
    assert.equal(coverage.view('zone_class').source?.kind, 'field', 'the zone is entered once, on the FAR sheet');
    assert.equal(coverage.text('zone_class'), 'residential main');
    assert.equal(coverage.text('coverage_achieved'), '60%');
    assert.equal(coverage.value('coverage_allowed'), null);
    assert.equal(coverage.text('coverage_standing'), 'Limit not on file');
    assert.equal(coverage.view('coverage_standing').tone, 'neutral');
  });
});

describe('Design › Electrical load: demand from the unit mix, capacity from papers, headroom a standing', () => {
  it('adds the load up from unit types and common loads, and says where transformers and the sanctioned load fall short', () => {
    const p = project();
    const empty = sheet(p, 'design.electrical.capacity');
    assert.ok(empty.shown.length <= 11);
    assert.equal(empty.value('sanction_standing'), null, 'no standing before anything is known');

    unitMix(p);
    add(p, 'design.electrical.common_loads', { item: 'lifts', connected_kw: 60 });
    write(p, 'design.electrical.demand', { diversity_factor: 0.6, power_factor: 0.9 });
    const demand = sheet(p, 'design.electrical.demand');
    assert.equal(demand.text('unit_load'), '368 kW', '40 flats at 5 kW and 24 at 7 kW');
    assert.equal(demand.text('connected_load'), '428 kW');
    assert.equal(demand.text('max_demand_kw'), '256.8 kW');
    assert.equal(demand.text('max_demand_kva'), '285.33 kVA');

    // Nothing on file to hold it against yet: said, and not a pass.
    assert.equal(sheet(p, 'design.electrical.capacity').text('sanction_standing'), 'Sanctioned load not on file');
    assert.equal(sheet(p, 'design.electrical.capacity').text('transformer_standing'), 'Transformers smaller than the demand');

    onCheck(p, 'technical.mep_capacity', { sanctioned_load_kw: 200, connected_load_kw: 400 });
    const transformer = add(p, 'design.electrical.equipment', { tag: 'TR-1', kind: 'transformer', rating: 250, location: 'outdoor yard' });
    assert.equal(sheet(p, 'design.electrical.equipment', transformer.id).view('count').state, 'assumed', 'a tag is one machine until the diagram says more');
    const short = sheet(p, 'design.electrical.capacity');
    assert.equal(short.text('sanctioned_load'), '200 kW');
    assert.equal(short.view('sanctioned_load').source?.kind, 'field', 'read from the technical due diligence, where it is entered');
    assert.equal(short.text('sanction_standing'), 'Demand over the sanctioned load');
    assert.equal(short.text('transformer_loading'), '114.13%');
    assert.equal(short.text('transformer_standing'), 'Transformers smaller than the demand');
    assert.ok(short.said.includes('Transformers add to 250 kVA and maximum demand is 285.33 kVA.'));
    assert.ok(short.said.includes('200 kW is sanctioned and maximum demand is 256.8 kW.'));
    assert.deepEqual(sheet(p, 'design.electrical.demand').said, ['The load schedule adds to 428 kW and the technical due diligence records 400 kW: 6.5% apart.']);
    // A transformer on the list is a sub-station of its own: nobody is asked, and its approval comes into play.
    assert.equal(short.view('inspectorate_approval').shown, 'shown');

    onCheck(p, 'technical.mep_capacity', { sanctioned_load_kw: 300, connected_load_kw: 428 });
    assert.deepEqual(setFieldValues(p, { set: 'design.electrical.equipment', record: transformer.id }, { count: 2 }, BY).rejected, []);
    const enough = sheet(p, 'design.electrical.capacity');
    assert.equal(enough.text('transformer_capacity'), '500 kVA');
    assert.equal(enough.text('sanction_standing'), 'Within the sanctioned load');
    assert.equal(enough.text('transformer_standing'), 'Transformers cover the demand');
    assert.deepEqual(enough.said, []);
    assert.deepEqual(sheet(p, 'design.electrical.demand').said, []);
  });
});

describe('Design › Water and Sewage treatment: people from the unit mix, a norm from the rule table, a plant against what is generated', () => {
  it('counts people with a usual figure said to be assumed, applies the unverified norm, and sizes the plant against the sewage', () => {
    const p = project();
    unitMix(p);
    const demand = sheet(p, 'design.water.demand');
    assert.equal(demand.value('residents'), 320, '64 dwellings at the usual five');
    assert.equal(demand.view('staff_and_visitors').state, 'assumed');
    assert.equal(demand.value('per_capita_norm'), null, 'the norm waits to be told which city it is for');
    assert.equal(demand.reading.filled, 1, 'the usual figure stands in');
    assert.equal(demand.reading.total, 3, 'the design basis, staff and visitors, and the city class are all it asks for');

    write(p, 'design.water.demand', { supply_class: 'metro' });
    const metro = sheet(p, 'design.water.demand');
    assert.equal(metro.text('per_capita_norm'), '0.15 cu m');
    assert.deepEqual(metro.view('per_capita_norm').cites?.map((c) => [c.key, c.verified]), [['water_per_capita_cum', false]]);
    assert.equal(metro.text('domestic_demand'), '48 KLD');
    assert.equal(metro.view('domestic_demand').cites?.[0]?.verified, false, 'what is worked out from an unverified norm says so');
    // The consultant's own figure replaces the norm, typed as the design basis writes it.
    write(p, 'design.water.demand', { per_capita_adopted: '135 litre' });
    assert.equal(sheet(p, 'design.water.demand').text('domestic_demand'), '43.2 KLD');
    write(p, 'design.water.demand', { per_capita_adopted: null, other_uses: [{ use: 'landscape', demand: 6 }] });
    assert.equal(sheet(p, 'design.water.demand').text('total_demand'), '54 KLD');

    const need = sheet(p, 'design.sewage.need');
    assert.equal(need.text('plant_need'), 'Treatment plant needed', '64 units against the board’s figure');
    assert.deepEqual(need.view('units_from').cites?.map((c) => [c.value, c.verified]), [[50, false]]);

    const noCapacity = sheet(p, 'design.sewage.plant');
    assert.equal(noCapacity.text('sewage_generated'), '38.4 KLD', 'four fifths of the domestic demand');
    assert.equal(noCapacity.text('plant_standing'), 'Capacity not on file');
    onCheck(p, 'technical.mep_capacity', { stp_capacity_kld: 30 });
    const small = sheet(p, 'design.sewage.plant');
    assert.equal(small.text('plant_standing'), 'Plant smaller than the sewage generated');
    assert.deepEqual(small.said, ['The plant treats 30 KLD and 38.4 KLD is generated.']);
    assert.equal(small.view('recovery').state, 'assumed');
    assert.equal(small.view('excess_route').shown, 'hidden');

    onCheck(p, 'technical.mep_capacity', { stp_capacity_kld: 45 });
    write(p, 'design.sewage.plant', { reuse: [{ use: 'flushing', reused: 14 }, { use: 'landscape', reused: 6 }] });
    const sized = sheet(p, 'design.sewage.plant');
    assert.equal(sized.text('plant_standing'), 'Plant covers the sewage generated');
    assert.equal(sized.text('reuse_total'), '20 KLD');
    assert.equal(sized.text('excess_treated'), '14.6 KLD');
    assert.equal(sized.view('excess_route').shown, 'shown', 'treated water is left over, so where it goes is asked');
    assert.deepEqual(sized.said, []);

    // Fresh water is what is left after reuse, and no source covers it yet.
    const supply = sheet(p, 'design.water.supply');
    assert.equal(supply.text('fresh_demand'), '34 KLD');
    assert.equal(supply.text('supply_standing'), 'Sources fall short of the demand');
    assert.equal(supply.view('borewells').shown, 'hidden');
    add(p, 'design.water.sources', { source: 'water board', supply: 40 });
    assert.equal(sheet(p, 'design.water.supply').text('supply_standing'), 'Sources cover the demand');
  });
});

describe('Design › Peer review & stability, and RFIs', () => {
  it('lists a building no stability certificate covers, and a certificate that names none, as needing a person', () => {
    const p = project();
    const a = add(p, 'shared.buildings', { name: 'Tower A', floors: 8 });
    add(p, 'shared.buildings', { name: 'Tower B', floors: 8 });
    const certificate = add(p, 'design.proof.certificates', { reference: 'SC-01', given_for: 'design, for the sanction', dated: '2026-05-01' });
    const unmatched = () => readFunctionFields(p, 'design.proof', NOW).exceptions.filter((e) => e.kind === 'unmatched').map((e) => e.text);
    assert.deepEqual(unmatched(), ['Buildings with no stability certificate: Tower A', 'Buildings with no stability certificate: Tower B', 'Certificates that name no building: SC-01']);
    write(p, 'design.proof.review', { stability_cover: [{ building: a.id, certificate: certificate.id }] });
    assert.deepEqual(unmatched(), ['Buildings with no stability certificate: Tower B']);
    assert.deepEqual(sheet(p, 'design.proof.review').view('stability_cover').match!.pairs.map((pair) => [pair.leftLabel, pair.rightLabel]), [['Tower A', 'SC-01']]);
  });

  it('calls a request open, overdue or answered from its dates, and counts them on the log', () => {
    const p = project();
    const late = add(p, 'design.rfis.requests', { number: 'RFI-07', raised_on: '2026-09-20', needed_by: '2026-10-01', cost_effect: true, time_effect: false });
    add(p, 'design.rfis.requests', { number: 'RFI-08', raised_on: '2026-10-05', needed_by: '2026-10-20', cost_effect: false, time_effect: false });
    assert.equal(sheet(p, 'design.rfis.requests', late.id).value('days_overdue'), 12);
    assert.equal(sheet(p, 'design.rfis.requests', late.id).text('standing'), 'Overdue');
    assert.equal(sheet(p, 'design.rfis.requests', late.id).view('holds_up').shown, 'shown');
    const log = sheet(p, 'design.rfis.log');
    assert.deepEqual([log.value('raised'), log.value('open'), log.value('overdue'), log.value('with_cost_effect')], [2, 2, 1, 1]);
    assert.equal(log.text('log_standing'), 'Answers overdue');
    assert.deepEqual(log.said, ['Requests past the day their answer was needed: 1.']);

    assert.deepEqual(setFieldValues(p, { set: 'design.rfis.requests', record: late.id }, { answered_on: '2026-10-12' }, BY).rejected, []);
    assert.equal(sheet(p, 'design.rfis.requests', late.id).text('standing'), 'Answered');
    assert.equal(sheet(p, 'design.rfis.requests', late.id).view('holds_up').shown, 'hidden');
    assert.equal(sheet(p, 'design.rfis.log').text('log_standing'), 'No answer overdue');
    assert.deepEqual(sheet(p, 'design.rfis.log').said, []);
  });
});
