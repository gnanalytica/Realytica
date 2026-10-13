/**
 * The structural engineer's functions: the soil investigation, the design
 * basis, the independent review and the stability certificates, and the
 * structural set with the engineer's own certificates.
 *
 * Every factor is the engineer of record's. A paper states it, a person
 * accepts it, and where a code gives a figure for it the figure is read from
 * the rule table and set beside it. Nothing here judges a design.
 */

import type { FieldSet } from '../../types';
import { BASEMENT, FN, SET, TECHNICAL, against, at, excess, countOf, countWhere, f, minus, over, read, saying, sumOf } from './kit';

const BOREHOLES = 'design.soil.boreholes';
const BASIS = 'design.structure.basis';
const FOUNDATION = 'design.structure.foundation';
const COMMENTS = 'design.proof.comments';
const STABILITY = 'design.proof.certificates';
const BAR_SCHEDULES = 'design.structural_set.bar_schedules';

const ELEMENTS = ['footing or raft', 'pile', 'column', 'shear wall', 'beam', 'slab', 'retaining wall', 'water tank', 'plain concrete'];

export const STRUCTURE_FIELD_SETS: FieldSet[] = [
  /* ================================================================== */
  /* Soil investigation                                                  */
  /* ================================================================== */
  {
    id: SET.soil,
    fn: FN.soil,
    title: 'Soil investigation',
    v: 1,
    situations: [BASEMENT, { key: 'difficult_ground', label: 'Difficult ground', scope: 'function', hint: 'The report finds fill, low bearing capacity, shallow water or soil that may liquefy.' }],
    optionSets: [
      {
        id: 'design_foundation_type',
        label: 'Foundation',
        options: ['Isolated footing', 'Combined footing', 'Raft', 'Pile', 'Piled raft'].map((label) => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label })),
      },
      {
        id: 'design_soil_type',
        label: 'Soil type for seismic design',
        options: [
          { key: 'hard', label: 'Rock or hard soil' },
          { key: 'medium', label: 'Medium soil' },
          { key: 'soft', label: 'Soft soil' },
        ],
      },
    ],
    sections: [
      { key: 'report', label: 'Report' },
      { key: 'findings', label: 'Findings' },
      { key: 'excavation', label: 'Excavation', showWhen: { situation: 'basement_or_deep_excavation' } },
      { key: 'ground', label: 'Difficult ground', showWhen: { situation: 'difficult_ground' } },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'report', label: 'Soil investigation report', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'report' },
      { key: 'agency', label: 'Investigating agency', kind: 'ref', target: 'party', section: 'report' },
      { key: 'report_date', label: 'Report dated', kind: 'date', section: 'report', from: 'Soil investigation report' },
      { key: 'bore_plan', label: 'Borehole location plan', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'report', required: false },
      { key: 'boreholes', label: 'Boreholes drilled', kind: 'computed', section: 'findings', formula: countOf(BOREHOLES) },
      { key: 'deepest', label: 'Deepest borehole', kind: 'computed', unit: 'm', section: 'findings', formula: { op: 'records', set: BOREHOLES, reduce: 'max', field: 'depth' } },
      { key: 'water_table', label: 'Shallowest groundwater, below ground', kind: 'computed', unit: 'm', section: 'findings', formula: { op: 'records', set: BOREHOLES, reduce: 'min', field: 'water_table_depth' } },
      { key: 'logs_unchecked', label: 'Borehole logs no person has checked', kind: 'computed', section: 'findings', formula: minus(f('boreholes'), countWhere(BOREHOLES, { column: 'log_checked', is: 'true' })) },
      { key: 'foundation_recommended', label: 'Foundation recommended', kind: 'enum', optionSet: 'design_foundation_type', section: 'findings', from: 'Soil investigation report' },
      { key: 'site_class', label: 'Soil type for seismic design', kind: 'enum', control: 'segmented', optionSet: 'design_soil_type', section: 'findings', from: 'Soil investigation report' },
      { key: 'excavation_depth', label: 'Depth of excavation', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'excavation', tier: 'situational', from: 'Section drawing' },
      { key: 'shoring', label: 'Shoring', kind: 'enum', options: ['open cut', 'soldier piles', 'sheet piles', 'diaphragm wall', 'soil nailing'], section: 'excavation', tier: 'situational' },
      { key: 'excavation_advice', label: 'The report advises on excavation and shoring', kind: 'boolean', control: 'switch', section: 'excavation', tier: 'situational', from: 'Soil investigation report' },
      { key: 'neighbour_survey_done', label: 'Neighbouring buildings surveyed before digging', kind: 'boolean', control: 'tick', section: 'excavation', tier: 'situational' },
      { key: 'dewatering_permission_on', label: 'Permission to dewater dated', kind: 'date', section: 'excavation', tier: 'situational', required: false },
      { key: 'liquefaction_assessed', label: 'Liquefaction assessed', kind: 'boolean', control: 'switch', section: 'ground', tier: 'situational', from: 'Soil investigation report' },
      { key: 'fill_depth', label: 'Depth of fill', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'ground', tier: 'situational', required: false, from: 'Soil investigation report' },
      { key: 'pile_tests_required', label: 'Pile load tests asked for', kind: 'number', min: 0, precision: 0, section: 'ground', tier: 'situational', from: 'Soil investigation report' },
      { key: 'pile_tests_done', label: 'Pile load tests done', kind: 'number', min: 0, precision: 0, section: 'ground', tier: 'situational', from: 'Pile load test report' },
      { key: 'lab_accredited', label: 'Laboratory accredited', kind: 'boolean', section: 'more', tier: 'expert', required: false, from: 'The accreditation board’s directory (public)' },
      { key: 'fieldwork_from', label: 'Fieldwork from', kind: 'date', section: 'more', tier: 'expert', required: false, from: 'Soil investigation report' },
      { key: 'sulphate_class', label: 'Sulphate exposure', kind: 'enum', options: ['class one', 'class two', 'class three', 'class four', 'class five'], section: 'more', tier: 'expert', required: false, from: 'Chemical test' },
    ],
    rules: [
      { kind: 'at_most', fields: ['logs_unchecked'], against: 0, say: 'Borehole logs read off the report that no person has checked: {a}.', severity: 'low' },
      { kind: 'require', fields: ['excavation_advice'], when: { situation: 'basement_or_deep_excavation' }, say: 'There is a basement and whether the report advises on excavation is not recorded.', severity: 'medium' },
      { kind: 'at_least', fields: ['pile_tests_done', 'pile_tests_required'], when: { situation: 'difficult_ground' }, say: '{a} pile load tests are done and the report asks for {b}.', severity: 'high' },
    ],
  },
  {
    id: BOREHOLES,
    fn: FN.soil,
    title: 'Boreholes',
    v: 1,
    records: { of: 'borehole', titleField: 'number', summaryFields: ['depth', 'water_table_depth', 'ended_at'] },
    fields: [
      { key: 'number', label: 'Borehole', kind: 'text', from: 'Borehole log' },
      { key: 'depth', label: 'Depth drilled', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], from: 'Borehole log' },
      { key: 'ended_at', label: 'Ended at', kind: 'enum', control: 'segmented', options: ['target depth', 'refusal', 'rock'], from: 'Borehole log' },
      { key: 'water_table_depth', label: 'Groundwater met at', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], required: false, from: 'Borehole log' },
      { key: 'rock_depth', label: 'Rock met at', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], required: false, from: 'Borehole log' },
      {
        key: 'strata',
        label: 'Strata',
        kind: 'table',
        required: false,
        from: 'Borehole log',
        columns: [
          { key: 'from_depth', label: 'From', kind: 'number', unit: 'm' },
          { key: 'to_depth', label: 'To', kind: 'number', unit: 'm' },
          { key: 'description', label: 'Stratum, as logged', kind: 'text' },
          { key: 'blow_count', label: 'Penetration blows', kind: 'number' },
        ],
      },
      { key: 'log', label: 'Log', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
      { key: 'log_checked', label: 'Log checked by a person', kind: 'boolean', control: 'tick', hint: 'Logs are often scanned and marked by hand, so each is checked once.' },
    ],
    rules: [{ kind: 'at_most', fields: ['water_table_depth', 'depth'], say: 'Groundwater is logged at {a} in a hole drilled to {b}.', severity: 'low' }],
  },
  {
    id: SET.bearing,
    fn: FN.soil,
    title: 'Bearing capacity recommended',
    v: 1,
    records: { of: 'recommendation', titleField: 'foundation', summaryFields: ['founding_depth', 'capacity'] },
    fields: [
      { key: 'foundation', label: 'Foundation', kind: 'enum', optionSet: 'design_foundation_type', from: 'Soil investigation report' },
      { key: 'founding_depth', label: 'Founding depth', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], from: 'Soil investigation report' },
      { key: 'capacity', label: 'Safe bearing capacity', kind: 'number', unit: 'kN/sqm', min: 0, from: 'Soil investigation report', proof: 'expected' },
      { key: 'settlement', label: 'Settlement', kind: 'number', dimension: 'length', enterIn: ['mm'], required: false, from: 'Soil investigation report' },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Structural design basis                                             */
  /* ================================================================== */
  {
    id: BASIS,
    fn: FN.structure,
    title: 'Design basis',
    v: 1,
    situations: [
      {
        key: 'seismic_zone_three_or_above',
        label: 'Higher seismic zone',
        scope: 'function',
        hint: 'The seismic zone recorded calls for ductile detailing.',
        derive: { field: at(TECHNICAL, 'technical.structural', 'seismic_zone'), is: 'in', value: ['III', 'IV', 'V'] },
      },
    ],
    optionSets: [
      {
        id: 'design_structural_system',
        label: 'Structural system',
        options: [
          { key: 'omrf', label: 'Concrete moment frame, ordinary' },
          { key: 'smrf', label: 'Concrete moment frame, special' },
          { key: 'shear_wall', label: 'Shear wall' },
          { key: 'dual', label: 'Dual system' },
          { key: 'flat_slab', label: 'Flat slab with walls' },
          { key: 'masonry', label: 'Load-bearing masonry' },
          { key: 'steel', label: 'Steel' },
          { key: 'composite', label: 'Composite' },
          { key: 'precast', label: 'Precast' },
        ],
      },
    ],
    sections: [
      { key: 'basis', label: 'Basis' },
      { key: 'seismic', label: 'Seismic factors' },
      { key: 'detailing', label: 'Higher seismic zone', showWhen: { situation: 'seismic_zone_three_or_above' } },
    ],
    fields: [
      { key: 'design_basis_report', label: 'Design basis report', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'basis' },
      { key: 'design_stage', label: 'Design stage reached', kind: 'enum', options: ['concept', 'scheme', 'detailed', 'GFC'], section: 'basis', sameAs: at(TECHNICAL, 'technical.structural', 'design_stage'), required: false },
      { key: 'structural_system', label: 'Structural system', kind: 'enum', optionSet: 'design_structural_system', section: 'basis', from: 'Design basis report' },
      { key: 'site_class', label: 'Soil type for seismic design', kind: 'enum', optionSet: 'design_soil_type', section: 'basis', sameAs: at(FN.soil, SET.soil, 'site_class'), required: false },
      { key: 'seismic_zone', label: 'Seismic zone', kind: 'enum', options: ['II', 'III', 'IV', 'V'], section: 'seismic', sameAs: at(TECHNICAL, 'technical.structural', 'seismic_zone'), required: false },
      { key: 'zone_factor', label: 'Zone factor used', kind: 'number', min: 0, precision: 2, section: 'seismic', from: 'Design basis report' },
      { key: 'zone_factor_code', label: 'Zone factor in the code', kind: 'computed', precision: 2, section: 'seismic', formula: { op: 'rate', table: 'seismic_zone_factor', where: { zone: { field: 'seismic_zone' } } } },
      {
        key: 'zone_factor_standing',
        label: 'Zone factor',
        kind: 'status',
        section: 'seismic',
        cases: [
          { when: { kind: 'require', fields: ['zone_factor_code'], say: 'Code figure not on file.', severity: 'low' }, label: 'Code figure not on file', tone: 'neutral' },
          { when: { kind: 'require', fields: ['zone_factor'], say: 'Not recorded.', severity: 'low' }, label: 'Not recorded', tone: 'neutral' },
          { when: { kind: 'compare', fields: ['zone_factor', 'zone_factor_code'], tolerance: 0.001, say: 'The design uses {a} and the code gives {b} for the zone.', severity: 'high' }, label: 'Differs from the code', tone: 'critical' },
        ],
        otherwise: { label: 'As the code', tone: 'good' },
      },
      { key: 'importance_factor', label: 'Importance factor used', kind: 'number', min: 0, precision: 2, section: 'seismic', from: 'Design basis report' },
      { key: 'response_reduction', label: 'Response reduction factor used', kind: 'number', min: 0, precision: 1, section: 'seismic', from: 'Design basis report' },
      { key: 'response_reduction_code', label: 'Most the code allows the system', kind: 'computed', precision: 1, section: 'seismic', formula: { op: 'rate', table: 'response_reduction_max', where: { system: { field: 'structural_system' } } } },
      against({
        key: 'response_standing',
        label: 'Response reduction',
        section: 'seismic',
        measure: 'response_reduction',
        limit: 'response_reduction_code',
        must: 'at_most',
        missing: 'Code figure not on file',
        failing: 'Above what the code allows',
        passing: 'Within the code',
        say: 'The design uses {a} and the code allows the system {b}.',
      }),
      { key: 'ductile_detailing', label: 'Ductile detailing adopted', kind: 'boolean', control: 'switch', section: 'detailing', tier: 'situational', from: 'Design basis report' },
      { key: 'irregularities', label: 'Irregularities declared', kind: 'multi_enum', options: ['soft storey', 'torsional', 're-entrant corner', 'mass', 'vertical'], section: 'detailing', tier: 'situational', required: false, from: 'Design basis report' },
      { key: 'site_specific_study', label: 'Site-specific seismic study done', kind: 'boolean', section: 'detailing', tier: 'situational', required: false },
    ],
    rules: [
      { kind: 'compare', fields: ['zone_factor', 'zone_factor_code'], tolerance: 0.001, say: 'The design uses a zone factor of {a} and the code gives {b} for the zone.', severity: 'high' },
      saying('at_most', 'response_reduction', 'response_reduction_code', 'The design uses a response reduction factor of {a} and the code allows the system {b}.'),
      { kind: 'require', fields: ['ductile_detailing'], when: { situation: 'seismic_zone_three_or_above' }, say: 'The seismic zone calls for ductile detailing and it is not recorded.', severity: 'high' },
    ],
  },
  {
    id: 'design.structure.loads',
    fn: FN.structure,
    title: 'Loads and materials',
    v: 1,
    sections: [
      { key: 'loads', label: 'Loads' },
      { key: 'materials', label: 'Materials' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'general_notes', label: 'General notes sheet', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'materials' },
      {
        key: 'imposed_loads',
        label: 'Imposed loads',
        kind: 'table',
        section: 'loads',
        from: 'Design basis report',
        columns: [
          { key: 'area', label: 'Area', kind: 'enum', options: ['residential floor', 'corridor and stair', 'balcony', 'parking', 'accessible terrace', 'inaccessible terrace', 'plant room', 'podium for a fire tender', 'retail', 'office'] },
          { key: 'load', label: 'Load', kind: 'number', unit: 'kN/sqm' },
        ],
      },
      { key: 'basic_wind_speed', label: 'Basic wind speed used', kind: 'number', unit: 'm/s', min: 0, section: 'loads', from: 'Design basis report' },
      { key: 'wind_speed_code', label: 'Basic wind speed on the code’s map', kind: 'computed', unit: 'm/s', section: 'loads', formula: { op: 'rate', table: 'basic_wind_speed_mps' } },
      {
        key: 'concrete_grades',
        label: 'Concrete grade by element',
        kind: 'table',
        section: 'materials',
        from: 'General notes sheet',
        columns: [
          { key: 'element', label: 'Element', kind: 'enum', options: ELEMENTS },
          { key: 'grade', label: 'Grade', kind: 'enum', options: ['M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60'] },
          { key: 'cement_least', label: 'Least cement', kind: 'number', unit: 'kg/cu m' },
          { key: 'water_cement_most', label: 'Most water to cement', kind: 'number' },
        ],
      },
      { key: 'rebar_grade', label: 'Reinforcement grade', kind: 'enum', control: 'segmented', options: ['Fe 415', 'Fe 500', 'Fe 500D', 'Fe 550', 'Fe 550D'], section: 'materials', from: 'General notes sheet' },
      { key: 'exposure', label: 'Exposure condition', kind: 'enum', control: 'segmented', options: ['mild', 'moderate', 'severe', 'very severe', 'extreme'], section: 'materials', from: 'Design basis report' },
      { key: 'terrain_category', label: 'Terrain category', kind: 'enum', control: 'segmented', options: ['one', 'two', 'three', 'four'], section: 'more', tier: 'expert', required: false, from: 'Design basis report' },
      { key: 'fire_rating', label: 'Fire resistance of the structure', kind: 'duration', unit: 'hours', section: 'more', tier: 'expert', required: false, from: 'Design basis report' },
      { key: 'analysis_software', label: 'Analysis software and version', kind: 'text', section: 'more', tier: 'expert', required: false, from: 'Design basis report' },
      { key: 'drift_within_limit', label: 'Storey drift within the code’s limit', kind: 'boolean', section: 'more', tier: 'expert', required: false, from: 'Design basis report' },
    ],
    rules: [{ kind: 'compare', fields: ['basic_wind_speed', 'wind_speed_code'], tolerance: 0.001, say: 'The design uses {a} and the code’s map gives {b} for the city.', severity: 'high' }],
  },
  {
    id: FOUNDATION,
    fn: FN.structure,
    title: 'Foundation',
    v: 1,
    fields: [
      { key: 'foundation_adopted', label: 'Foundation adopted', kind: 'enum', optionSet: 'design_foundation_type', from: 'Design basis report' },
      { key: 'foundation_recommended', label: 'Foundation the soil report recommends', kind: 'enum', optionSet: 'design_foundation_type', sameAs: at(FN.soil, SET.soil, 'foundation_recommended'), required: false },
      { key: 'founding_level', label: 'Founding level, below ground', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], from: 'Foundation drawing' },
      { key: 'bearing_adopted', label: 'Bearing capacity adopted', kind: 'number', unit: 'kN/sqm', min: 0, from: 'Design basis report' },
      { key: 'bearing_recommended', label: 'Highest bearing capacity the soil report recommends', kind: 'computed', unit: 'kN/sqm', formula: { op: 'records', set: SET.bearing, reduce: 'max', field: 'capacity' } },
      against({
        key: 'bearing_standing',
        label: 'Bearing capacity',
        measure: 'bearing_adopted',
        limit: 'bearing_recommended',
        must: 'at_most',
        missing: 'No recommendation on file',
        failing: 'Above the soil report',
        passing: 'Within the soil report',
        say: 'The design adopts {a} and the soil report recommends no more than {b}.',
      }),
      { key: 'water_table', label: 'Shallowest groundwater, below ground', kind: 'computed', unit: 'm', formula: read(at(FN.soil, SET.soil, 'water_table')) },
      { key: 'founding_below_water', label: 'Founding level below the groundwater by', kind: 'computed', unit: 'm', formula: excess(f('founding_level'), f('water_table')) },
      { key: 'uplift_checked', label: 'Uplift against groundwater checked', kind: 'boolean', control: 'switch', tier: 'situational', showWhen: { field: at(FN.structure, FOUNDATION, 'founding_below_water'), is: 'gt', value: 0 }, from: 'Design basis report' },
    ],
    rules: [
      saying('at_most', 'bearing_adopted', 'bearing_recommended', 'The design adopts {a} and the soil report recommends no more than {b}.'),
      { kind: 'require', fields: ['uplift_checked'], when: { field: at(FN.structure, FOUNDATION, 'founding_below_water'), is: 'gt', value: 0 }, say: 'The foundation sits below the groundwater and the uplift check is not recorded.', severity: 'high' },
    ],
  },

  /* ================================================================== */
  /* Peer review and stability                                           */
  /* ================================================================== */
  {
    id: 'design.proof.review',
    fn: FN.proof,
    title: 'Independent review',
    v: 1,
    sections: [
      { key: 'review', label: 'Review' },
      { key: 'stability', label: 'Stability certificates' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'engineer_of_record', label: 'Structural engineer of record', kind: 'ref', target: 'party', section: 'review' },
      { key: 'proof_required', label: 'The authority asks for a proof check', kind: 'boolean', control: 'switch', section: 'review', from: 'Sanction conditions' },
      { key: 'proof_checked', label: 'Proof-checked by a third party', kind: 'boolean', section: 'review', sameAs: at(TECHNICAL, 'technical.structural', 'proof_checked'), required: false },
      { key: 'peer_review', label: 'Peer review report', kind: 'evidence', accepts: 'document', section: 'review', sameAs: at(TECHNICAL, 'technical.structural', 'peer_review'), required: false },
      { key: 'reviewer', label: 'Reviewer', kind: 'ref', target: 'party', section: 'review', requiredWhen: { field: at(FN.proof, 'design.proof.review', 'proof_required'), is: 'true' } },
      { key: 'review_scope', label: 'Scope reviewed', kind: 'multi_enum', options: ['design basis', 'analysis model', 'foundation', 'superstructure', 'detailing', 'drawings', 'construction stage'], section: 'review', required: false, from: 'Peer review report' },
      { key: 'reviewed_revision', label: 'Revision of the set reviewed', kind: 'text', section: 'review', required: false, from: 'Peer review report' },
      { key: 'review_date', label: 'Review dated', kind: 'date', section: 'review', required: false, from: 'Peer review report' },
      { key: 'comments_open', label: 'Review comments open', kind: 'computed', section: 'review', formula: countWhere(COMMENTS, { column: 'response', is: 'equals', value: 'pending' }) },
      { key: 'certificates', label: 'Stability certificates on file', kind: 'computed', section: 'stability', formula: countOf(STABILITY) },
      {
        key: 'stability_cover',
        label: 'Buildings each certificate covers',
        kind: 'table',
        display: 'match',
        section: 'stability',
        required: false,
        columns: [
          { key: 'building', label: 'Building', kind: 'ref', target: 'building' },
          { key: 'certificate', label: 'Certificate', kind: 'ref', target: { set: STABILITY } },
        ],
        match: {
          left: { column: 'building', label: 'Buildings with no stability certificate', of: { target: 'building' } },
          right: { column: 'certificate', label: 'Certificates that name no building', of: { records: STABILITY, field: 'reference' } },
        },
      },
      { key: 'reviewer_kind', label: 'Reviewer is', kind: 'enum', options: ['a national institute', 'a government engineering college', 'an empanelled firm', 'another firm'], section: 'more', tier: 'expert', required: false },
    ],
    rules: [
      { kind: 'at_most', fields: ['comments_open'], against: 0, say: 'Review comments with no response yet: {a}.', severity: 'medium' },
      { kind: 'require_if', fields: ['proof_required', 'reviewer'], whenIn: ['true'], say: 'The authority asks for a proof check and no reviewer is named.', severity: 'high' },
    ],
  },
  {
    id: COMMENTS,
    fn: FN.proof,
    title: 'Review comments',
    v: 1,
    records: { of: 'comment', titleField: 'number', summaryFields: ['element', 'severity', 'response'] },
    optionSets: [
      {
        id: 'design_comment_severity',
        label: 'Severity',
        options: [
          { key: 'critical', label: 'Critical', tone: 'critical' },
          { key: 'major', label: 'Major', tone: 'warning' },
          { key: 'minor', label: 'Minor', tone: 'neutral' },
          { key: 'observation', label: 'Observation', tone: 'neutral' },
        ],
      },
    ],
    fields: [
      { key: 'number', label: 'Comment number', kind: 'text', from: 'Peer review report' },
      { key: 'element', label: 'Element', kind: 'text', from: 'Peer review report' },
      { key: 'comment', label: 'Comment, as written', kind: 'text', hint: 'The reviewer’s own words, quoted.', from: 'Peer review report' },
      { key: 'severity', label: 'Severity', kind: 'enum', control: 'segmented', optionSet: 'design_comment_severity', from: 'Peer review report' },
      { key: 'response', label: 'Response', kind: 'enum', control: 'segmented', options: ['pending', 'accepted', 'rejected with reason'] },
      { key: 'closed_on', label: 'Closed on', kind: 'date', required: false },
      { key: 'closing_drawing', label: 'Drawing that closes it', kind: 'ref', target: 'drawing', required: false },
    ],
    rules: [],
  },
  {
    id: STABILITY,
    fn: FN.proof,
    title: 'Stability certificates',
    v: 1,
    records: { of: 'certificate', titleField: 'reference', summaryFields: ['given_for', 'dated'] },
    fields: [
      { key: 'reference', label: 'Certificate reference', kind: 'text', from: 'Structural stability certificate' },
      { key: 'given_for', label: 'Given for', kind: 'enum', control: 'segmented', options: ['design, for the sanction', 'completion, for occupancy'], from: 'Structural stability certificate' },
      { key: 'dated', label: 'Dated', kind: 'date', from: 'Structural stability certificate' },
      { key: 'signed_by', label: 'Signed by', kind: 'ref', target: 'party' },
      { key: 'paper', label: 'Certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* The structural set and the engineer's certificates                  */
  /* ================================================================== */
  {
    id: 'design.structural_set.issue',
    fn: FN.structuralSet,
    title: 'Structural set',
    v: 1,
    fields: [
      { key: 'structural_drawings', label: 'Structural drawings on the register', kind: 'computed', formula: countWhere('shared.drawings', { column: 'discipline', is: 'equals', value: 'structure' }) },
      { key: 'bar_schedules', label: 'Bar bending schedules', kind: 'computed', formula: countOf(BAR_SCHEDULES) },
      { key: 'steel_total', label: 'Steel scheduled', kind: 'computed', dimension: 'mass', unit: 'kg', precision: 0, formula: sumOf(BAR_SCHEDULES, 'steel') },
      { key: 'steel_per_area', label: 'Steel for each square metre built', kind: 'computed', unit: 'kg/sqm', precision: 1, formula: over(f('steel_total'), read(at(FN.areas, SET.statement, 'total_built_up'))) },
      { key: 'instructions', label: 'Site instructions issued', kind: 'computed', formula: countOf('design.structural_set.instructions') },
      { key: 'certificates', label: 'Engineer’s certificates given', kind: 'computed', formula: countOf('design.structural_set.engineer_certificates') },
    ],
    rules: [],
  },
  {
    id: BAR_SCHEDULES,
    fn: FN.structuralSet,
    title: 'Bar bending schedules',
    v: 1,
    records: { of: 'schedule', titleField: 'number', summaryFields: ['element', 'steel'] },
    fields: [
      { key: 'number', label: 'Schedule number', kind: 'text', from: 'Bar bending schedule' },
      { key: 'drawing', label: 'Drawing', kind: 'ref', target: 'drawing' },
      { key: 'revision', label: 'Drawing revision it is made from', kind: 'text', from: 'Bar bending schedule' },
      { key: 'element', label: 'Element', kind: 'enum', options: ELEMENTS },
      { key: 'steel', label: 'Steel', kind: 'number', dimension: 'mass', enterIn: ['tonne', 'kg'], from: 'Bar bending schedule' },
      { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party', required: false },
      { key: 'approved_on', label: 'Approved on', kind: 'date', required: false },
    ],
    rules: [],
  },
  {
    id: 'design.structural_set.instructions',
    fn: FN.structuralSet,
    title: 'Engineer’s site instructions',
    v: 1,
    records: { of: 'instruction', titleField: 'number', summaryFields: ['issued_on', 'element'] },
    fields: [
      { key: 'number', label: 'Instruction number', kind: 'text', from: 'Site instruction book' },
      { key: 'issued_on', label: 'Issued on', kind: 'date', from: 'Site instruction book' },
      { key: 'element', label: 'Element', kind: 'text', from: 'Site instruction book' },
      { key: 'instruction', label: 'Instruction', kind: 'longtext', maxLength: 300 },
      { key: 'drawing', label: 'Drawing', kind: 'ref', target: 'drawing', required: false },
      { key: 'closes_request', label: 'Request for information it answers', kind: 'ref', target: { set: SET.requests }, required: false },
    ],
    rules: [],
  },
  {
    id: 'design.structural_set.engineer_certificates',
    fn: FN.structuralSet,
    title: 'Engineer’s certificates',
    v: 2,
    records: { of: 'certificate', titleField: 'dated', summaryFields: ['kind', 'building'] },
    // One a quarter for each building, signed by the engineer. A certificate given at registration states no quarter, and is no period.
    periodic: { every: 'quarter', by: 'quarter_ending', per: ['building'], carry: ['kind', 'engineer', 'quantities_by'], due: { rate: 'rera_quarterly_filing_days' }, issuer: 'consultant' },
    fields: [
      { key: 'dated', label: 'Certificate dated', kind: 'date' },
      { key: 'quarter_ending', label: 'Quarter ending', kind: 'date', tier: 'situational', since: 2, showWhen: { field: { fn: FN.structuralSet, set: 'design.structural_set.engineer_certificates', field: 'kind' }, is: 'equals', value: 'for a quarter' } },
      { key: 'kind', label: 'Given', kind: 'enum', control: 'segmented', options: ['at registration', 'for a quarter'], hint: 'The state’s form for each is in its pack.' },
      { key: 'building', label: 'Building or wing', kind: 'ref', target: 'building' },
      { key: 'engineer', label: 'Certifying engineer', kind: 'ref', target: 'party' },
      { key: 'quantities_by', label: 'Quantities worked out by', kind: 'ref', target: 'party', hint: 'The certificate names who.' },
      { key: 'signed', label: 'Signed certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [],
  },
];
