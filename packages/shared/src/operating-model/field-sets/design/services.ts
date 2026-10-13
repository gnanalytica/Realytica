/**
 * The services engineer's functions: electrical load, ventilation and
 * cooling, water, sewage treatment, fire fighting and lifts.
 *
 * Each is the same three things. A demand worked out from the architect's
 * unit mix and areas, never typed as a total. A capacity read from a paper:
 * a sanction letter, a data sheet, a drawing. And a headroom that is a
 * standing, which says so where the demand or the limit is not on file.
 * What the technical due diligence already records (sanctioned load, plant
 * capacity, refuge area, staircases) is read from there and set beside the
 * working.
 */

import type { FieldSet } from '../../types';
import { FN, HIGH_RISE, SET, TECHNICAL, against, at, excess, countOf, countWhere, f, minus, over, plus, read, saying, share, sumOf, sumWhere, times } from './kit';

const COMMON_LOADS = 'design.electrical.common_loads';
const EQUIPMENT = 'design.electrical.equipment';
const CAPACITY = 'design.electrical.capacity';
const HVAC_SPACES = 'design.hvac.spaces';
const HVAC_BASEMENTS = 'design.hvac.basements';
const SUPPLY = 'design.water.supply';
const SOURCES = 'design.water.sources';
const LIFTS = 'design.lifts.schedule';
const MEP_CHECK = 'technical.mep_capacity';
const FIRE_CHECK = 'technical.fire_life_safety';

const UNITS_TOTAL = at(FN.brief, SET.brief, 'units_total');

export const SERVICES_FIELD_SETS: FieldSet[] = [
  /* ================================================================== */
  /* Electrical load, transformers and generators                        */
  /* ================================================================== */
  {
    id: SET.electricalDemand,
    fn: FN.electrical,
    title: 'Electrical demand',
    v: 1,
    sections: [
      { key: 'papers', label: 'Papers' },
      { key: 'load', label: 'Connected load' },
      { key: 'demand', label: 'Maximum demand' },
    ],
    fields: [
      { key: 'load_schedule', label: 'Load schedule', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'papers' },
      { key: 'single_line_diagram', label: 'Single line diagram', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'papers' },
      { key: 'unit_load', label: 'Load of the units', kind: 'computed', unit: 'kW', section: 'load', formula: sumOf(SET.unitTypes, 'load_kw') },
      { key: 'common_load', label: 'Load of the common areas', kind: 'computed', unit: 'kW', section: 'load', formula: sumOf(COMMON_LOADS, 'connected_kw') },
      { key: 'connected_load', label: 'Connected load', kind: 'computed', unit: 'kW', section: 'load', formula: plus(f('unit_load'), f('common_load')) },
      { key: 'diversity_factor', label: 'Diversity factor', kind: 'number', min: 0, max: 1, precision: 2, section: 'demand', hint: 'The consultant’s figure. No code sets one.', from: 'Load schedule' },
      { key: 'power_factor', label: 'Power factor assumed', kind: 'number', min: 0.5, max: 1, precision: 2, section: 'demand', from: 'Load schedule' },
      { key: 'max_demand_kw', label: 'Maximum demand', kind: 'computed', unit: 'kW', section: 'demand', formula: times(f('connected_load'), f('diversity_factor')) },
      { key: 'max_demand_kva', label: 'Maximum demand, apparent', kind: 'computed', unit: 'kVA', section: 'demand', formula: over(f('max_demand_kw'), f('power_factor')) },
    ],
    rules: [
      {
        kind: 'compare',
        fields: ['connected_load', 'load_on_check'],
        at: { load_on_check: at(TECHNICAL, MEP_CHECK, 'connected_load_kw') },
        say: 'The load schedule adds to {a} and the technical due diligence records {b}: {divergence} apart.',
        severity: 'medium',
      },
    ],
  },
  {
    id: CAPACITY,
    fn: FN.electrical,
    title: 'Capacity and headroom',
    v: 1,
    situations: [
      HIGH_RISE,
      { key: 'own_substation', label: 'Own sub-station', scope: 'function', hint: 'The project has a transformer of its own.', derive: { records: EQUIPMENT, is: 'any', where: { column: 'kind', is: 'equals', value: 'transformer' } } },
    ],
    sections: [
      { key: 'supply', label: 'Supply' },
      { key: 'transformers', label: 'Transformers' },
      { key: 'substation', label: 'Sub-station', showWhen: { situation: 'own_substation' } },
      { key: 'backup', label: 'Backup' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'supply_voltage', label: 'Supply voltage', kind: 'enum', control: 'segmented', options: ['low tension', '11 kV', '33 kV', '66 kV'], section: 'supply', from: 'Sanction letter' },
      { key: 'demand_kw', label: 'Maximum demand', kind: 'computed', unit: 'kW', section: 'supply', formula: read(at(FN.electrical, SET.electricalDemand, 'max_demand_kw')) },
      { key: 'sanctioned_load', label: 'Sanctioned load', kind: 'number', unit: 'kW', section: 'supply', sameAs: at(TECHNICAL, MEP_CHECK, 'sanctioned_load_kw'), required: false },
      { key: 'sanction_headroom', label: 'Headroom on the sanctioned load', kind: 'computed', unit: '%', section: 'supply', formula: { op: 'variance_pct', left: f('sanctioned_load'), right: f('demand_kw') } },
      {
        key: 'sanction_standing',
        label: 'Sanctioned load',
        kind: 'status',
        section: 'supply',
        cases: [
          { when: { kind: 'require', fields: ['demand_kw'], say: 'Demand not worked out.', severity: 'low' }, label: 'Demand not worked out', tone: 'neutral' },
          { when: { kind: 'require', fields: ['sanctioned_load'], say: 'Sanctioned load not on file.', severity: 'low' }, label: 'Sanctioned load not on file', tone: 'neutral' },
          { when: { kind: 'at_least', fields: ['sanctioned_load', 'demand_kw'], say: '{a} is sanctioned and maximum demand is {b}.', severity: 'high' }, label: 'Demand over the sanctioned load', tone: 'critical' },
        ],
        otherwise: { label: 'Within the sanctioned load', tone: 'good' },
      },
      { key: 'demand_kva', label: 'Maximum demand, apparent', kind: 'computed', unit: 'kVA', section: 'transformers', formula: read(at(FN.electrical, SET.electricalDemand, 'max_demand_kva')) },
      { key: 'transformer_capacity', label: 'Transformer capacity', kind: 'computed', unit: 'kVA', section: 'transformers', formula: sumWhere(EQUIPMENT, 'capacity', { column: 'kind', is: 'equals', value: 'transformer' }) },
      { key: 'transformer_loading', label: 'Transformer loading at maximum demand', kind: 'computed', unit: '%', section: 'transformers', formula: share(f('demand_kva'), f('transformer_capacity')) },
      against({
        key: 'transformer_standing',
        label: 'Transformers',
        section: 'transformers',
        measure: 'transformer_capacity',
        limit: 'demand_kva',
        must: 'at_least',
        missing: 'Demand not worked out',
        failing: 'Transformers smaller than the demand',
        passing: 'Transformers cover the demand',
        say: 'Transformers add to {a} and maximum demand is {b}.',
      }),
      { key: 'inspectorate_approval', label: 'Electrical inspectorate’s approval', kind: 'ref', target: 'approval', section: 'substation', tier: 'situational' },
      { key: 'energised_on', label: 'Supply energised on', kind: 'date', section: 'substation', tier: 'situational', required: false, from: 'Supply company' },
      { key: 'generator_capacity', label: 'Generator capacity', kind: 'computed', unit: 'kVA', section: 'backup', formula: sumWhere(EQUIPMENT, 'capacity', { column: 'kind', is: 'equals', value: 'generator' }) },
      { key: 'generator_backup', label: 'Generator backup of maximum demand', kind: 'computed', unit: '%', precision: 0, section: 'backup', formula: share(f('generator_capacity'), f('demand_kva')) },
      { key: 'life_safety_on_generator', label: 'Fire and life-safety loads are on the generator', kind: 'boolean', control: 'switch', section: 'backup', tier: 'situational', showWhen: { situation: 'high_rise' }, from: 'Single line diagram' },
      { key: 'solar_capacity', label: 'Rooftop solar', kind: 'number', unit: 'kWp', min: 0, section: 'more', tier: 'expert', required: false },
      { key: 'ev_points', label: 'EV charging points', kind: 'number', min: 0, precision: 0, section: 'more', tier: 'expert', required: false },
      { key: 'earthing_pits', label: 'Earthing pits', kind: 'number', min: 0, precision: 0, section: 'more', tier: 'expert', required: false, from: 'Earthing layout' },
    ],
    rules: [
      saying('at_least', 'transformer_capacity', 'demand_kva', 'Transformers add to {a} and maximum demand is {b}.'),
      { kind: 'at_least', fields: ['sanctioned_load', 'demand_kw'], say: '{a} is sanctioned and maximum demand is {b}.', severity: 'high' },
      { kind: 'require', fields: ['life_safety_on_generator'], when: { situation: 'high_rise' }, say: 'The building is high-rise and whether the fire and life-safety loads are on the generator is not recorded.', severity: 'high' },
      { kind: 'require', fields: ['inspectorate_approval'], when: { field: at(FN.electrical, CAPACITY, 'energised_on'), is: 'set' }, say: 'The supply is energised and the electrical inspectorate’s approval is not linked.', severity: 'high' },
    ],
  },
  {
    id: COMMON_LOADS,
    fn: FN.electrical,
    title: 'Common area loads',
    v: 1,
    records: { of: 'load', titleField: 'item', summaryFields: ['connected_kw', 'on_generator'] },
    fields: [
      { key: 'item', label: 'Load', kind: 'enum', options: ['lifts', 'water pumps', 'sewage treatment plant', 'fire pumps', 'common lighting', 'clubhouse', 'cooling and ventilation', 'EV charging', 'basement ventilation', 'other common load'], from: 'Load schedule' },
      { key: 'connected_kw', label: 'Connected load', kind: 'number', unit: 'kW', min: 0, from: 'Load schedule' },
      { key: 'on_generator', label: 'On the generator', kind: 'boolean', control: 'switch', required: false },
      { key: 'on_fire_supply', label: 'On the fire supply', kind: 'boolean', control: 'switch', required: false },
    ],
    rules: [],
  },
  {
    id: EQUIPMENT,
    fn: FN.electrical,
    title: 'Transformers and generators',
    v: 1,
    records: { of: 'machine', titleField: 'tag', summaryFields: ['kind', 'capacity', 'location'] },
    fields: [
      { key: 'tag', label: 'Tag', kind: 'text', hint: 'As the single line diagram labels it.', from: 'Single line diagram' },
      { key: 'kind', label: 'Kind', kind: 'enum', control: 'segmented', options: ['transformer', 'generator'] },
      { key: 'rating', label: 'Rating of each', kind: 'number', unit: 'kVA', min: 0, from: 'Data sheet', proof: 'expected' },
      { key: 'count', label: 'Number', kind: 'number', min: 0, precision: 0, defaults: [{ value: 1, from: 'catalog', cite: 'A tag stands for one machine unless the diagram says more.' }] },
      { key: 'capacity', label: 'Capacity', kind: 'computed', unit: 'kVA', formula: times(f('rating'), f('count')) },
      { key: 'location', label: 'Where', kind: 'enum', control: 'segmented', options: ['outdoor yard', 'ground floor, indoors', 'basement', 'terrace'] },
      { key: 'cooling', label: 'Cooled by', kind: 'enum', control: 'segmented', options: ['oil', 'dry type'], tier: 'situational', showWhen: { field: at(FN.electrical, EQUIPMENT, 'kind'), is: 'equals', value: 'transformer' } },
      { key: 'acoustic_enclosure', label: 'In an acoustic enclosure', kind: 'boolean', tier: 'situational', showWhen: { field: at(FN.electrical, EQUIPMENT, 'kind'), is: 'equals', value: 'generator' } },
      { key: 'data_sheet', label: 'Data sheet', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Cooling and ventilation                                             */
  /* ================================================================== */
  {
    id: 'design.hvac.provision',
    fn: FN.hvac,
    title: 'Cooling and ventilation',
    v: 1,
    situations: [HIGH_RISE],
    optionSets: [
      {
        id: 'design_cooling_in_flats',
        label: 'Provision in the flats',
        options: [
          { key: 'no_provision', label: 'No provision', tone: 'neutral' },
          { key: 'points_only', label: 'Drain and power points', tone: 'neutral' },
          { key: 'sleeves_and_ledges', label: 'Sleeves and ledges', tone: 'info' },
          { key: 'split_units', label: 'Split units supplied', tone: 'good' },
          { key: 'central', label: 'Central system supplied', tone: 'good' },
        ],
      },
    ],
    sections: [
      { key: 'flats', label: 'In the flats' },
      { key: 'common', label: 'Common areas' },
      { key: 'basements', label: 'Basements' },
      { key: 'smoke', label: 'Smoke control', showWhen: { situation: 'high_rise' } },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'provision_in_flats', label: 'Provision in the flats', kind: 'enum', control: 'tiles', optionSet: 'design_cooling_in_flats', section: 'flats', hint: 'What buyers were promised is Sales’s; this is what is specified.', from: 'Specification sheet' },
      { key: 'design_basis', label: 'Design basis', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'common', required: false },
      { key: 'cooling_load', label: 'Cooling load', kind: 'computed', unit: 'TR', section: 'common', formula: sumOf(HVAC_SPACES, 'load') },
      { key: 'installed_capacity', label: 'Installed capacity', kind: 'number', unit: 'TR', min: 0, section: 'common', from: 'Equipment schedule' },
      against({
        key: 'cooling_standing',
        label: 'Cooling',
        section: 'common',
        measure: 'installed_capacity',
        limit: 'cooling_load',
        must: 'at_least',
        missing: 'Load not worked out',
        failing: 'Installed below the load',
        passing: 'Installed covers the load',
        say: '{a} is installed against a load of {b}.',
      }),
      { key: 'basements_short', label: 'Basements ventilated below the code', kind: 'computed', section: 'basements', formula: countWhere(HVAC_BASEMENTS, { column: 'standing', is: 'equals', value: 'Below the code' }) },
      {
        key: 'pressurisation',
        label: 'Pressurised stairs and lift lobbies',
        kind: 'table',
        section: 'smoke',
        tier: 'situational',
        from: 'Ventilation schedule',
        columns: [
          { key: 'shaft', label: 'Shaft', kind: 'text' },
          { key: 'pressure', label: 'Pressure', kind: 'number', unit: 'Pa' },
          { key: 'fan', label: 'Fan', kind: 'number', unit: 'cu m/h' },
        ],
      },
      { key: 'smoke_control_tested', label: 'Smoke extract and pressurisation tested', kind: 'boolean', control: 'tick', section: 'smoke', tier: 'situational', from: 'Commissioning report' },
      { key: 'outdoor_units_drawn', label: 'Outdoor unit positions drawn', kind: 'boolean', section: 'more', tier: 'expert', required: false, from: 'Elevations' },
      { key: 'refrigerant', label: 'Refrigerant', kind: 'enum', options: ['R32', 'R410A', 'R134a', 'another refrigerant'], section: 'more', tier: 'expert', required: false, from: 'Data sheet' },
    ],
    rules: [
      saying('at_least', 'installed_capacity', 'cooling_load', '{a} is installed against a cooling load of {b}.'),
      { kind: 'at_most', fields: ['basements_short'], against: 0, say: 'Basements ventilated below the code in a fire: {a}.', severity: 'high' },
    ],
  },
  {
    id: HVAC_SPACES,
    fn: FN.hvac,
    title: 'Conditioned spaces',
    v: 1,
    records: { of: 'space', titleField: 'space', summaryFields: ['load', 'system'] },
    fields: [
      { key: 'space', label: 'Space', kind: 'text', from: 'Heat load sheet' },
      { key: 'area', label: 'Area', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], required: false, from: 'Heat load sheet' },
      { key: 'load', label: 'Cooling load', kind: 'number', unit: 'TR', min: 0, from: 'Heat load sheet' },
      { key: 'system', label: 'System', kind: 'enum', options: ['split', 'variable refrigerant flow', 'chilled water', 'packaged'] },
    ],
    rules: [],
  },
  {
    id: HVAC_BASEMENTS,
    fn: FN.hvac,
    title: 'Basement ventilation',
    v: 1,
    records: { of: 'basement', titleField: 'basement', summaryFields: ['fire_air_changes', 'standing'] },
    fields: [
      { key: 'basement', label: 'Basement', kind: 'text', from: 'Ventilation schedule' },
      { key: 'area', label: 'Area', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], required: false, from: 'Ventilation schedule' },
      { key: 'normal_air_changes', label: 'Air changes an hour, normally', kind: 'number', min: 0, from: 'Ventilation schedule' },
      { key: 'fire_air_changes', label: 'Air changes an hour, in a fire', kind: 'number', min: 0, from: 'Ventilation schedule' },
      { key: 'fire_air_changes_code', label: 'Air changes the code asks for in a fire', kind: 'computed', formula: { op: 'rate', table: 'basement_fire_air_changes' } },
      against({
        key: 'standing',
        label: 'Ventilation in a fire',
        measure: 'fire_air_changes',
        limit: 'fire_air_changes_code',
        must: 'at_least',
        missing: 'Limit not on file',
        failing: 'Below the code',
        passing: 'Meets the code',
        say: '{a} air changes are designed and the code asks for {b}.',
      }),
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Water demand, sources and storage                                   */
  /* ================================================================== */
  {
    id: SET.waterDemand,
    fn: FN.water,
    title: 'Water demand',
    v: 1,
    sections: [
      { key: 'people', label: 'People' },
      { key: 'norm', label: 'Demand a person' },
      { key: 'demand', label: 'Demand' },
    ],
    fields: [
      { key: 'design_basis', label: 'Plumbing design basis', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'people' },
      { key: 'residents', label: 'Residents', kind: 'computed', precision: 0, section: 'people', formula: sumOf(SET.unitTypes, 'persons') },
      { key: 'staff_and_visitors', label: 'Staff and visitors', kind: 'number', min: 0, precision: 0, section: 'people', from: 'Plumbing design basis', defaults: [{ value: 0, from: 'catalog', cite: 'None are counted until the plumbing design basis gives a figure.' }] },
      { key: 'population', label: 'Design population', kind: 'computed', precision: 0, section: 'people', formula: plus(f('residents'), f('staff_and_visitors')) },
      { key: 'supply_class', label: 'The supply norm is for', kind: 'enum', control: 'segmented', options: ['metro', 'other city'], section: 'norm' },
      { key: 'per_capita_norm', label: 'Supply norm a person a day', kind: 'computed', unit: 'cu m', precision: 3, section: 'norm', formula: { op: 'rate', table: 'water_per_capita_cum', where: { city_class: { field: 'supply_class' } } } },
      { key: 'per_capita_adopted', label: 'Demand a person a day, where the consultant departs from the norm', kind: 'number', dimension: 'volume', enterIn: ['litre', 'cum'], section: 'norm', required: false, from: 'Plumbing design basis' },
      { key: 'per_capita', label: 'Demand a person a day, applied', kind: 'computed', unit: 'cu m', precision: 3, section: 'norm', formula: { op: 'if', when: { field: 'per_capita_adopted', is: 'set' }, then: f('per_capita_adopted'), else: f('per_capita_norm') } },
      { key: 'domestic_demand', label: 'Domestic demand', kind: 'computed', unit: 'KLD', precision: 1, section: 'demand', formula: times(f('population'), f('per_capita')) },
      {
        key: 'other_uses',
        label: 'Other demand',
        kind: 'table',
        section: 'demand',
        required: false,
        from: 'Water balance chart',
        columns: [
          { key: 'use', label: 'Use', kind: 'enum', options: ['landscape', 'pool top-up', 'clubhouse', 'car wash', 'cooling make-up'] },
          { key: 'demand', label: 'Demand', kind: 'number', unit: 'KLD' },
        ],
      },
      {
        key: 'total_demand',
        label: 'Total water demand',
        kind: 'computed',
        unit: 'KLD',
        precision: 1,
        section: 'demand',
        formula: { op: 'if', when: { field: 'other_uses', is: 'set' }, then: plus(f('domestic_demand'), { op: 'sum', table: 'other_uses', column: 'demand' }), else: f('domestic_demand') },
      },
    ],
    rules: [
      {
        kind: 'compare',
        fields: ['total_demand', 'demand_on_check'],
        at: { demand_on_check: at(TECHNICAL, MEP_CHECK, 'water_demand_kld') },
        say: 'The water balance adds to {a} and the technical due diligence records {b}: {divergence} apart.',
        severity: 'medium',
      },
    ],
  },
  {
    id: SUPPLY,
    fn: FN.water,
    title: 'Sources and storage',
    v: 1,
    situations: [{ key: 'no_piped_water', label: 'No piped water', scope: 'function', hint: 'The water board does not supply the site, or not all it needs.' }],
    sections: [
      { key: 'sources', label: 'Sources' },
      { key: 'ground', label: 'Borewells and tankers', showWhen: { situation: 'no_piped_water' } },
      { key: 'storage', label: 'Storage' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      {
        key: 'fresh_demand',
        label: 'Fresh water demand, after reuse',
        kind: 'computed',
        unit: 'KLD',
        precision: 1,
        section: 'sources',
        formula: {
          op: 'if',
          when: { field: 'reuse_total', at: at(FN.sewage, SET.plant, 'reuse_total'), is: 'set' },
          then: minus(read(at(FN.water, SET.waterDemand, 'total_demand')), read(at(FN.sewage, SET.plant, 'reuse_total'))),
          else: read(at(FN.water, SET.waterDemand, 'total_demand')),
        },
      },
      { key: 'sources_total', label: 'Supply from every source', kind: 'computed', unit: 'KLD', precision: 1, section: 'sources', formula: sumOf(SOURCES, 'supply') },
      { key: 'shortfall', label: 'Demand no source covers', kind: 'computed', unit: 'KLD', precision: 1, section: 'sources', formula: excess(f('fresh_demand'), f('sources_total')) },
      against({
        key: 'supply_standing',
        label: 'Sources',
        section: 'sources',
        measure: 'sources_total',
        limit: 'fresh_demand',
        must: 'at_least',
        missing: 'Demand not worked out',
        failing: 'Sources fall short of the demand',
        passing: 'Sources cover the demand',
        say: 'Sources add to {a} and fresh water demand is {b}.',
      }),
      { key: 'borewells', label: 'Borewells', kind: 'number', min: 0, precision: 0, section: 'ground', tier: 'situational' },
      { key: 'groundwater_permission', label: 'Groundwater authority’s permission', kind: 'ref', target: 'approval', section: 'ground', tier: 'situational', required: false },
      { key: 'tanker_share', label: 'Share of supply by tanker', kind: 'computed', unit: '%', precision: 0, section: 'ground', tier: 'situational', formula: share(sumWhere(SOURCES, 'supply', { column: 'source', is: 'equals', value: 'tanker' }), f('sources_total')) },
      { key: 'domestic_storage', label: 'Domestic storage', kind: 'computed', unit: 'cu m', precision: 1, section: 'storage', formula: sumWhere(SET.tanks, 'capacity', { column: 'use', is: 'equals', value: 'domestic' }) },
      { key: 'storage_days', label: 'Days of domestic demand stored', kind: 'computed', unit: 'days', precision: 1, section: 'storage', formula: over(f('domestic_storage'), read(at(FN.water, SET.waterDemand, 'domestic_demand'))) },
      { key: 'dual_piping', label: 'Dual piping for treated water', kind: 'boolean', control: 'switch', section: 'storage', from: 'Plumbing drawings' },
      { key: 'rainwater_capacity', label: 'Rainwater harvesting capacity', kind: 'number', dimension: 'volume', enterIn: ['cum', 'litre'], section: 'more', tier: 'expert', required: false, from: 'Rainwater harvesting drawing' },
      { key: 'unit_meters', label: 'A water meter for each unit', kind: 'boolean', section: 'more', tier: 'expert', required: false, from: 'Specification sheet' },
      { key: 'hot_water', label: 'Hot water', kind: 'enum', options: ['individual geysers', 'solar', 'heat pump', 'central'], section: 'more', tier: 'expert', required: false, from: 'Specification sheet' },
    ],
    rules: [
      saying('at_least', 'sources_total', 'fresh_demand', 'Sources add to {a} and fresh water demand is {b}.'),
      { kind: 'require', fields: ['groundwater_permission'], when: { field: at(FN.water, SUPPLY, 'borewells'), is: 'gt', value: 0 }, say: 'There are borewells and the groundwater authority’s permission is not linked.', severity: 'high' },
    ],
  },
  {
    id: SOURCES,
    fn: FN.water,
    title: 'Water sources',
    v: 1,
    records: { of: 'source', titleField: 'source', summaryFields: ['supply', 'valid_until'] },
    fields: [
      { key: 'source', label: 'Source', kind: 'enum', options: ['water board', 'borewell', 'tanker', 'rainwater'] },
      { key: 'supply', label: 'Supply it can be counted on for', kind: 'number', unit: 'KLD', min: 0, from: 'Sanction letter', proof: 'expected' },
      { key: 'sanction', label: 'Sanction or permission', kind: 'ref', target: 'approval', required: false },
      { key: 'valid_until', label: 'Valid until', kind: 'date', required: false, expires: { leadDays: 60 }, from: 'Sanction letter' },
      { key: 'paper', label: 'Paper', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [],
  },
  {
    id: SET.tanks,
    fn: FN.water,
    title: 'Storage tanks',
    v: 1,
    records: { of: 'tank', titleField: 'name', summaryFields: ['use', 'capacity'] },
    fields: [
      { key: 'name', label: 'Tank', kind: 'text', hint: 'As the tank drawing labels it.', from: 'Tank drawings' },
      { key: 'use', label: 'Holds', kind: 'enum', options: ['domestic', 'flushing', 'fire, underground static', 'fire, terrace', 'rainwater'] },
      { key: 'position', label: 'Where', kind: 'enum', control: 'segmented', options: ['underground', 'overhead or terrace'] },
      { key: 'building', label: 'Building or wing', kind: 'ref', target: 'building', required: false },
      { key: 'capacity', label: 'Capacity', kind: 'number', dimension: 'volume', enterIn: ['cum', 'litre'], hint: 'A kilolitre is a cubic metre.', from: 'Tank drawings' },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Sewage treatment and reuse                                          */
  /* ================================================================== */
  {
    id: 'design.sewage.need',
    fn: FN.sewage,
    title: 'Whether a treatment plant is needed',
    v: 1,
    fields: [
      { key: 'units', label: 'Units in the scheme', kind: 'computed', precision: 0, formula: read(UNITS_TOTAL) },
      { key: 'units_from', label: 'A plant is needed from this many units', kind: 'computed', precision: 0, formula: { op: 'rate', table: 'sewage_plant_units_from' } },
      {
        key: 'plant_need',
        label: 'Treatment plant',
        kind: 'status',
        cases: [
          { when: { kind: 'require', fields: ['units_from'], say: 'Limit not on file.', severity: 'low' }, label: 'Limit not on file', tone: 'neutral' },
          // A scheme exactly at the figure needs one, so the test is the other way about: below it, or not.
          { when: { kind: 'at_most', fields: ['units_from', 'units'], say: 'The scheme has {b} units and a plant is needed from {a}.', severity: 'low' }, label: 'Below the board’s figure', tone: 'neutral' },
        ],
        otherwise: { label: 'Treatment plant needed', tone: 'info' },
      },
    ],
    rules: [],
  },
  {
    id: SET.plant,
    fn: FN.sewage,
    title: 'Treatment plant',
    v: 1,
    sections: [
      { key: 'sizing', label: 'Sizing' },
      { key: 'reuse', label: 'Treated water' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'domestic_demand', label: 'Domestic water demand', kind: 'computed', unit: 'KLD', precision: 1, section: 'sizing', formula: read(at(FN.water, SET.waterDemand, 'domestic_demand')) },
      { key: 'sewage_share', label: 'Sewage as a share of water supplied', kind: 'computed', unit: '%', section: 'sizing', formula: { op: 'rate', table: 'sewage_share_of_supply' } },
      { key: 'sewage_generated', label: 'Sewage generated', kind: 'computed', unit: 'KLD', precision: 1, section: 'sizing', formula: times(f('domestic_demand'), over(f('sewage_share'), { op: 'const', value: 100 })) },
      { key: 'plant_capacity', label: 'Plant capacity', kind: 'number', unit: 'KLD', section: 'sizing', sameAs: at(TECHNICAL, MEP_CHECK, 'stp_capacity_kld'), required: false },
      {
        key: 'plant_standing',
        label: 'Plant',
        kind: 'status',
        section: 'sizing',
        cases: [
          { when: { kind: 'require', fields: ['sewage_generated'], say: 'Sewage not worked out.', severity: 'low' }, label: 'Sewage not worked out', tone: 'neutral' },
          { when: { kind: 'require', fields: ['plant_capacity'], say: 'Capacity not on file.', severity: 'low' }, label: 'Capacity not on file', tone: 'neutral' },
          { when: { kind: 'at_least', fields: ['plant_capacity', 'sewage_generated'], say: 'The plant treats {a} and {b} is generated.', severity: 'high' }, label: 'Plant smaller than the sewage generated', tone: 'critical' },
        ],
        otherwise: { label: 'Plant covers the sewage generated', tone: 'good' },
      },
      { key: 'technology', label: 'Technology', kind: 'enum', options: ['sequencing batch reactor', 'moving bed biofilm reactor', 'membrane bioreactor', 'extended aeration'], section: 'sizing', from: 'Vendor data sheet' },
      { key: 'recovery', label: 'Share of sewage recovered as treated water', kind: 'percent', section: 'reuse', from: 'Treatment plant design basis', defaults: [{ value: 90, from: 'catalog', cite: 'Common design practice; the plant designer’s figure replaces it.' }] },
      { key: 'treated_available', label: 'Treated water available', kind: 'computed', unit: 'KLD', precision: 1, section: 'reuse', formula: times(f('sewage_generated'), over(f('recovery'), { op: 'const', value: 100 })) },
      {
        key: 'reuse',
        label: 'Treated water reused',
        kind: 'table',
        section: 'reuse',
        from: 'Water balance chart',
        columns: [
          { key: 'use', label: 'Use', kind: 'enum', options: ['flushing', 'landscape', 'car wash', 'cooling make-up', 'construction'] },
          { key: 'reused', label: 'Reused', kind: 'number', unit: 'KLD' },
        ],
      },
      { key: 'reuse_total', label: 'Treated water reused, in all', kind: 'computed', unit: 'KLD', precision: 1, section: 'reuse', formula: { op: 'sum', table: 'reuse', column: 'reused' } },
      { key: 'excess_treated', label: 'Treated water left over', kind: 'computed', unit: 'KLD', precision: 1, section: 'reuse', formula: excess(f('treated_available'), f('reuse_total')) },
      { key: 'excess_route', label: 'The rest goes to', kind: 'enum', control: 'segmented', options: ['the sewer, with the board’s consent', 'tanker', 'no route yet'], section: 'reuse', tier: 'situational', showWhen: { field: at(FN.sewage, SET.plant, 'excess_treated'), is: 'gt', value: 0 } },
      { key: 'location', label: 'Where the plant sits', kind: 'enum', options: ['basement', 'ground', 'outside the building line'], section: 'more', tier: 'expert', required: false, from: 'Drawings' },
      { key: 'commissioned_on', label: 'Commissioned on', kind: 'date', section: 'more', tier: 'expert', required: false, from: 'Commissioning report' },
      { key: 'sludge_route', label: 'Sludge goes to', kind: 'enum', options: ['filter press and manure', 'tanker'], section: 'more', tier: 'expert', required: false },
    ],
    rules: [
      { kind: 'at_least', fields: ['plant_capacity', 'sewage_generated'], say: 'The plant treats {a} and {b} is generated.', severity: 'high' },
      { kind: 'at_most', fields: ['reuse_total', 'treated_available'], say: 'Reuse adds to {a} and only {b} is treated.', severity: 'medium' },
    ],
  },
  {
    id: 'design.sewage.outlet_tests',
    fn: FN.sewage,
    title: 'Treated water tests',
    v: 1,
    records: { of: 'test', titleField: 'parameter', summaryFields: ['sampled_on', 'result', 'standing'] },
    fields: [
      { key: 'parameter', label: 'Parameter', kind: 'enum', options: ['pH', 'BOD', 'COD', 'suspended solids', 'ammoniacal nitrogen', 'total nitrogen', 'faecal coliform'], from: 'Laboratory report' },
      { key: 'sampled_on', label: 'Sampled on', kind: 'date', from: 'Laboratory report' },
      { key: 'laboratory', label: 'Laboratory', kind: 'ref', target: 'party', required: false },
      { key: 'result', label: 'Result', kind: 'number', from: 'Laboratory report', proof: 'expected' },
      { key: 'limit', label: 'Limit in the consent', kind: 'number', hint: 'As the pollution control board’s consent states it.', from: 'Consent conditions', proof: 'expected' },
      against({
        key: 'standing',
        label: 'Against the consent',
        measure: 'result',
        limit: 'limit',
        must: 'at_most',
        missing: 'Limit not on file',
        failing: 'Over the consent’s limit',
        passing: 'Within the consent’s limit',
        say: 'The result is {a} and the consent allows {b}.',
      }),
      { key: 'report', label: 'Laboratory report', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Fire fighting and escape                                            */
  /* ================================================================== */
  {
    id: 'design.fire.water',
    fn: FN.fire,
    title: 'Fire water and pumps',
    v: 1,
    sections: [
      { key: 'basis', label: 'What the code row is read for' },
      { key: 'tanks', label: 'Tanks' },
      { key: 'pumps', label: 'Pumps' },
    ],
    fields: [
      { key: 'occupancy_group', label: 'Occupancy group', kind: 'enum', optionSet: 'design_occupancy_group', section: 'basis', sameAs: at(FN.brief, SET.brief, 'occupancy_group'), required: false },
      { key: 'building_height', label: 'Building height', kind: 'number', unit: 'm', section: 'basis', sameAs: at(FN.compliance, SET.height, 'building_height'), required: false },
      { key: 'fire_drawings', label: 'Fire fighting drawings', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'basis' },
      { key: 'underground_required', label: 'Underground static tank the code asks for', kind: 'computed', unit: 'cu m', section: 'tanks', formula: { op: 'rate', table: 'fire_underground_tank_cum', where: { occupancy: { field: 'occupancy_group' }, height_m: { field: 'building_height' } } } },
      { key: 'underground_provided', label: 'Underground static tank provided', kind: 'computed', unit: 'cu m', section: 'tanks', formula: sumWhere(SET.tanks, 'capacity', { column: 'use', is: 'equals', value: 'fire, underground static' }) },
      against({ key: 'underground_standing', label: 'Underground tank', section: 'tanks', measure: 'underground_provided', limit: 'underground_required', must: 'at_least', missing: 'Limit not on file', failing: 'Below the code', passing: 'Meets the code', say: '{a} is provided and the code asks for {b}.' }),
      { key: 'terrace_required', label: 'Terrace tank the code asks for', kind: 'computed', unit: 'cu m', section: 'tanks', formula: { op: 'rate', table: 'fire_terrace_tank_cum', where: { occupancy: { field: 'occupancy_group' }, height_m: { field: 'building_height' } } } },
      { key: 'terrace_provided', label: 'Terrace tanks provided', kind: 'computed', unit: 'cu m', section: 'tanks', formula: sumWhere(SET.tanks, 'capacity', { column: 'use', is: 'equals', value: 'fire, terrace' }) },
      against({ key: 'terrace_standing', label: 'Terrace tank', section: 'tanks', measure: 'terrace_provided', limit: 'terrace_required', must: 'at_least', missing: 'Limit not on file', failing: 'Below the code', passing: 'Meets the code', say: '{a} is provided and the code asks for {b}.' }),
      { key: 'pump_required', label: 'Pump flow the code asks for', kind: 'computed', unit: 'lpm', section: 'pumps', formula: { op: 'rate', table: 'fire_pump_lpm', where: { occupancy: { field: 'occupancy_group' }, height_m: { field: 'building_height' } } } },
      { key: 'pump_provided', label: 'Main fire pump flow', kind: 'number', unit: 'lpm', min: 0, section: 'pumps', from: 'Pump data sheet', proof: 'expected' },
      against({ key: 'pump_standing', label: 'Main pump', section: 'pumps', measure: 'pump_provided', limit: 'pump_required', must: 'at_least', missing: 'Limit not on file', failing: 'Below the code', passing: 'Meets the code', say: 'The pump gives {a} and the code asks for {b}.' }),
    ],
    rules: [
      saying('at_least', 'underground_provided', 'underground_required', 'The underground fire tank holds {a} and the code asks for {b}.'),
      saying('at_least', 'terrace_provided', 'terrace_required', 'The terrace fire tanks hold {a} and the code asks for {b}.'),
      saying('at_least', 'pump_provided', 'pump_required', 'The main fire pump gives {a} and the code asks for {b}.'),
    ],
  },
  {
    id: 'design.fire.escape',
    fn: FN.fire,
    title: 'Escape and life safety',
    v: 1,
    situations: [HIGH_RISE],
    sections: [
      { key: 'plans', label: 'Plans' },
      { key: 'stairs', label: 'Staircases' },
      { key: 'travel', label: 'Travel distance' },
      { key: 'high', label: 'High-rise', showWhen: { situation: 'high_rise' } },
    ],
    fields: [
      { key: 'floor_plans', label: 'Floor plans', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'plans', hint: 'Filed beside what is typed from them.' },
      { key: 'occupancy_group', label: 'Occupancy group', kind: 'enum', optionSet: 'design_occupancy_group', section: 'plans', sameAs: at(FN.brief, SET.brief, 'occupancy_group'), required: false },
      { key: 'staircases', label: 'Escape staircases', kind: 'number', section: 'stairs', sameAs: at(TECHNICAL, FIRE_CHECK, 'staircases'), required: false },
      { key: 'stair_width', label: 'Staircase clear width', kind: 'number', dimension: 'length', enterIn: ['m', 'mm', 'ft'], section: 'stairs', hint: 'Typed by a person from the plan. Nothing measures a width off a drawing dependably.', from: 'Floor plans' },
      { key: 'stair_width_least', label: 'Least width the code allows', kind: 'computed', unit: 'm', section: 'stairs', formula: { op: 'rate', table: 'stair_width_min_m', where: { occupancy: { field: 'occupancy_group' } } } },
      against({ key: 'stair_standing', label: 'Staircase width', section: 'stairs', measure: 'stair_width', limit: 'stair_width_least', must: 'at_least', missing: 'Limit not on file', failing: 'Narrower than the code', passing: 'Meets the code', say: 'The staircase is {a} wide and the code asks for {b}.' }),
      { key: 'travel_distance', label: 'Longest travel distance to an exit', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'travel', hint: 'Typed by a person from the plan, along the route a person would walk.', from: 'Floor plans' },
      { key: 'travel_distance_most', label: 'Most the code allows', kind: 'computed', unit: 'm', section: 'travel', formula: { op: 'rate', table: 'travel_distance_max_m', where: { occupancy: { field: 'occupancy_group' } } } },
      against({ key: 'travel_standing', label: 'Travel distance', section: 'travel', measure: 'travel_distance', limit: 'travel_distance_most', must: 'at_most', missing: 'Limit not on file', failing: 'Longer than the code allows', passing: 'Within the code', say: 'The longest route is {a} and the code allows {b}.' }),
      { key: 'refuge_required', label: 'Refuge area required', kind: 'area', unit: 'sqm', section: 'high', tier: 'situational', sameAs: at(TECHNICAL, FIRE_CHECK, 'refuge_area_required'), required: false },
      { key: 'refuge_provided', label: 'Refuge area provided', kind: 'area', unit: 'sqm', section: 'high', tier: 'situational', sameAs: at(TECHNICAL, FIRE_CHECK, 'refuge_area_provided'), required: false },
      { key: 'fire_lifts', label: 'Fire lifts scheduled', kind: 'computed', precision: 0, section: 'high', tier: 'situational', formula: countWhere(LIFTS, { column: 'kind', is: 'equals', value: 'fire' }) },
      { key: 'fire_command_centre', label: 'Fire command centre drawn', kind: 'boolean', control: 'switch', section: 'high', tier: 'situational', from: 'Floor plans' },
      { key: 'fire_approval', label: 'Fire service’s approval', kind: 'ref', target: 'approval', section: 'high', tier: 'situational' },
    ],
    rules: [
      saying('at_least', 'stair_width', 'stair_width_least', 'The staircase is {a} wide and the code asks for {b}.'),
      saying('at_most', 'travel_distance', 'travel_distance_most', 'The longest route to an exit is {a} and the code allows {b}.'),
      { kind: 'at_least', fields: ['refuge_provided', 'refuge_required'], when: { situation: 'high_rise' }, say: '{a} of refuge area is provided and {b} is required.', severity: 'high' },
      { kind: 'at_least', fields: ['fire_lifts'], against: 1, when: { situation: 'high_rise' }, say: 'The building is high-rise. Fire lifts scheduled: {a}.', severity: 'high' },
    ],
  },
  {
    id: 'design.fire.installations',
    fn: FN.fire,
    title: 'Fire installations',
    v: 1,
    records: { of: 'installation', titleField: 'system', summaryFields: ['required', 'standing'] },
    fields: [
      { key: 'system', label: 'System', kind: 'enum', options: ['fire extinguishers', 'first aid hose reel', 'wet riser', 'down comer', 'yard hydrant', 'automatic sprinklers', 'manual fire alarm', 'automatic detection and alarm'] },
      { key: 'required', label: 'The code asks for it', kind: 'boolean', control: 'switch', hint: 'From the code’s table for the occupancy and the height, with the clause.', from: 'National Building Code, Part 4 (public)', proof: 'expected' },
      { key: 'drawing', label: 'Drawing that shows it', kind: 'ref', target: 'drawing', required: false },
      {
        key: 'standing',
        label: 'Provision',
        kind: 'status',
        cases: [{ when: { kind: 'require_if', fields: ['required', 'drawing'], whenIn: ['true'], say: 'The code asks for it and no drawing shows it.', severity: 'high' }, label: 'Asked for, on no drawing', tone: 'critical' }],
        otherwise: { label: 'In order', tone: 'good' },
      },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Lifts                                                               */
  /* ================================================================== */
  {
    id: 'design.lifts.provision',
    fn: FN.lifts,
    title: 'Lift provision',
    v: 1,
    situations: [HIGH_RISE],
    sections: [
      { key: 'provision', label: 'Provision' },
      { key: 'need', label: 'Whether a lift is needed' },
      { key: 'high', label: 'High-rise', showWhen: { situation: 'high_rise' } },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'lifts', label: 'Lifts scheduled', kind: 'computed', precision: 0, section: 'provision', formula: countOf(LIFTS) },
      { key: 'passenger_lifts', label: 'Passenger lifts', kind: 'computed', precision: 0, section: 'provision', formula: countWhere(LIFTS, { column: 'kind', is: 'equals', value: 'passenger' }) },
      { key: 'fire_lifts', label: 'Fire lifts', kind: 'computed', precision: 0, section: 'provision', formula: countWhere(LIFTS, { column: 'kind', is: 'equals', value: 'fire' }) },
      { key: 'dwellings_per_lift', label: 'Dwellings to a passenger lift', kind: 'computed', precision: 0, section: 'provision', formula: over(read(UNITS_TOTAL), f('passenger_lifts')) },
      { key: 'lift_load', label: 'Connected load of the lifts', kind: 'computed', unit: 'kW', section: 'provision', formula: sumOf(LIFTS, 'connected_kw') },
      { key: 'licensed', label: 'Lifts with a licence to use', kind: 'computed', precision: 0, section: 'provision', formula: countWhere('legal.approvals.lifts', { column: 'licence_no', is: 'set' }) },
      { key: 'tallest', label: 'Tallest building', kind: 'computed', unit: 'm', section: 'need', formula: { op: 'records', set: 'shared.buildings', reduce: 'max', field: 'height' } },
      { key: 'lift_from', label: 'A lift is needed from this height', kind: 'computed', unit: 'm', section: 'need', formula: { op: 'rate', table: 'lift_required_height_m' } },
      {
        key: 'lift_need',
        label: 'Lift',
        kind: 'status',
        section: 'need',
        cases: [
          { when: { kind: 'require', fields: ['lift_from'], say: 'Limit not on file.', severity: 'low' }, label: 'Limit not on file', tone: 'neutral' },
          { when: { kind: 'require', fields: ['tallest'], say: 'Building height not recorded.', severity: 'low' }, label: 'Building height not recorded', tone: 'neutral' },
          { when: { kind: 'at_most', fields: ['lift_from', 'tallest'], say: 'The tallest building is {b} and a lift is needed from {a}.', severity: 'low' }, label: 'Below the height that needs a lift', tone: 'neutral' },
        ],
        otherwise: { label: 'Lift needed', tone: 'info' },
      },
      { key: 'stretcher_lift', label: 'A stretcher lift is scheduled', kind: 'boolean', control: 'switch', section: 'high', tier: 'situational', from: 'Lift schedule' },
      { key: 'traffic_analysis', label: 'Traffic analysis', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'more', tier: 'expert', required: false },
      { key: 'handling_capacity', label: 'Share of the population carried in the peak interval', kind: 'percent', section: 'more', tier: 'expert', required: false, from: 'Traffic analysis' },
      { key: 'waiting_interval', label: 'Interval between cars', kind: 'duration', unit: 'seconds', section: 'more', tier: 'expert', required: false, from: 'Traffic analysis' },
    ],
    rules: [{ kind: 'at_least', fields: ['fire_lifts'], against: 1, when: { situation: 'high_rise' }, say: 'The building is high-rise. Fire lifts scheduled: {a}.', severity: 'high' }],
  },
  {
    id: LIFTS,
    fn: FN.lifts,
    title: 'Lifts',
    v: 1,
    records: { of: 'lift', titleField: 'tag', summaryFields: ['building', 'kind', 'commissioned_on'] },
    sections: [
      { key: 'lift', label: 'Lift' },
      // The permission to erect and the licence to use are Liaison's records of this lift (legal.approvals.lifts), linked to it from there.
      { key: 'licence', label: 'Commissioning' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'tag', label: 'Lift', kind: 'text', section: 'lift', hint: 'As the lift schedule labels it.', from: 'Vendor data sheet' },
      { key: 'building', label: 'Building or wing', kind: 'ref', target: 'building', section: 'lift' },
      { key: 'kind', label: 'Kind', kind: 'enum', options: ['passenger', 'service', 'fire', 'stretcher', 'car', 'goods'], section: 'lift', from: 'Vendor data sheet' },
      { key: 'capacity_persons', label: 'Carries', kind: 'number', unit: 'persons', min: 0, precision: 0, section: 'lift', from: 'Vendor data sheet' },
      { key: 'stops', label: 'Stops', kind: 'number', min: 0, precision: 0, section: 'lift', from: 'Vendor data sheet' },
      { key: 'connected_kw', label: 'Connected load', kind: 'number', unit: 'kW', min: 0, section: 'lift', required: false, from: 'Vendor data sheet' },
      { key: 'on_generator', label: 'On the generator', kind: 'boolean', control: 'switch', section: 'lift', required: false },
      { key: 'commissioned_on', label: 'Commissioned on', kind: 'date', section: 'licence', required: false, from: 'Vendor’s test certificate' },
      { key: 'speed', label: 'Speed', kind: 'number', unit: 'm/s', min: 0, section: 'more', tier: 'expert', required: false, from: 'Vendor data sheet' },
      { key: 'make', label: 'Make', kind: 'text', suggest: 'party', section: 'more', tier: 'expert', required: false, from: 'Vendor data sheet' },
    ],
    rules: [
    ],
  },
];
