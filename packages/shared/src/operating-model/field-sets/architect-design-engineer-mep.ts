/**
 * The design department's field sets: the architect's, the interior and
 * landscape designer's, the structural engineer's and the services
 * engineer's. Twenty-two functions, each a workstream of Design.
 *
 * The sets themselves are in `design/`, one file to a profession, with the
 * rule rows they read. They are gathered here so the folder's index names
 * one file for the group.
 */

import type { CheckFieldDef, FieldAddress, FieldReportTemplate, FieldSet, ShowWhen } from '../types';
import { withLinks, type SetLinks } from './builders';
import { ARCHITECT_FIELD_SETS } from './design/architect';
import { INTERIOR_FIELD_SETS } from './design/interiors';
import { SERVICES_FIELD_SETS } from './design/services';
import { STRUCTURE_FIELD_SETS } from './design/structure';

/* ==================================================================== */
/* What Design reads from other departments                              */
/* ==================================================================== */

const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, tier: 'situational', ...more });
const APPROVALS = 'legal.approvals';
const held = (address: FieldAddress): ShowWhen => ({ field: address, is: 'set' });
const VARIATIONS = 'procurement.orders.variations';

const each = (fn: string, set: string, fields: string[]): FieldAddress[] => fields.map((field) => at(fn, set, field));

/** The area statement with the limits it is held to: what is designed, what is sold, and where the design stands against the code. */
const AREA_REPORT: FieldReportTemplate = {
  id: 'design.areas.report',
  title: 'Area statement and code compliance',
  sections: [
    { heading: 'Built-up area', fields: ['statement_revision', 'total_built_up', 'far_area_total', 'far_exemptions', 'sanctioned_area', 'area_standing'] },
    { heading: 'Floors', records: 'design.areas.floors', columns: ['level', 'building', 'use', 'built_up', 'far_area'] },
    { heading: 'Unit mix', records: 'design.brief.unit_types', columns: ['name', 'kind', 'count', 'carpet_area', 'saleable_area'] },
    { heading: 'Units by type', chart: { of: { records: 'design.brief.unit_types' }, x: 'name', y: 'count' } },
    { heading: 'Area sold', fields: ['carpet_total', 'saleable_total', 'efficiency', 'target_efficiency', 'efficiency_standing', 'loading'] },
    { heading: 'Plot, zone and FAR', fields: each('design.compliance', 'design.compliance.far', ['plot_extent', 'clear_extent', 'zone', 'road_width', 'far_allowed', 'far_ceiling', 'far_achieved', 'far_standing']) },
    { heading: 'Ground coverage', fields: each('design.compliance', 'design.compliance.coverage', ['footprint_area', 'coverage_achieved', 'coverage_allowed', 'coverage_standing']) },
    { heading: 'Height and setbacks', fields: each('design.compliance', 'design.compliance.height', ['building_height', 'height_class', 'height_allowed', 'airport_height_allowed', 'height_standing', 'setbacks_short']) },
    { heading: 'Parking', fields: each('design.compliance', 'design.compliance.parking', ['parking_required', 'parking_provided', 'parking_standing']) },
    { heading: 'Deviations sought', records: 'design.compliance.deviations', columns: ['limit', 'required', 'provided', 'standing'] },
    { heading: 'Architect’s remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

/** The drawing and query position: what is issued for construction, what is open, and what has changed. */
const DESIGN_STATUS_REPORT: FieldReportTemplate = {
  id: 'design.drawings.report',
  title: 'Design status report',
  sections: [
    { heading: 'Drawings', fields: ['drawings', 'at_construction_issue', 'construction_issue_share', 'revisions', 'transmittals', 'transmittals_open'] },
    { heading: 'Requests for information', fields: each('design.rfis', 'design.rfis.log', ['raised', 'open', 'overdue', 'with_cost_effect', 'with_time_effect', 'log_standing']) },
    { heading: 'Requests open', records: 'design.rfis.requests', columns: ['number', 'raised_on', 'discipline', 'needed_by', 'answered_on', 'standing'] },
    { heading: 'Design changes', fields: each('design.changes', 'design.changes.summary', ['raised', 'open', 'approved_cost', 'approved_days', 'needing_sanction', 'altering_promise', 'built_first']) },
    { heading: 'Changes, one by one', records: 'design.changes.register', columns: ['number', 'raised_on', 'origin', 'stage', 'cost_estimate', 'time_effect'] },
    { heading: 'Samples and mock-ups', fields: each('design.samples', 'design.samples.standing', ['submitted', 'pending', 'overdue', 'to_resubmit', 'deviating']) },
    { heading: 'Remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

const LINKS: SetLinks[] = [
  {
    set: 'design.areas.statement',
    reports: [AREA_REPORT],
    // The sanction the statement is held to is Liaison's, as last revised: a revision that is sanctioned moves the limit here with nobody typing it.
    repoint: { sanctioned_area: at(APPROVALS, 'legal.approvals.sanction', 'built_up_in_force') },
    fields: [
      mirror('units_sanctioned', 'Units sanctioned, as last revised', 'number', at(APPROVALS, 'legal.approvals.sanction', 'units_in_force'), { precision: 0, section: 'sold', tier: 'situational', showWhen: { situation: 'revised_sanction' } }),
      { key: 'units_designed', label: 'Units in the unit mix', kind: 'computed', precision: 0, section: 'sold', tier: 'situational', showWhen: { situation: 'revised_sanction' }, formula: { op: 'records', set: 'design.brief.unit_types', reduce: 'sum', field: 'count' } },
      mirror('revised_on', 'Last revision sanctioned on', 'date', at(APPROVALS, 'legal.approvals.sanction', 'revised_on'), { section: 'statement', tier: 'situational', showWhen: { situation: 'revised_sanction' } }),
    ],
    rules: [
      // After a revision the statement has to be drawn again: said while the floors and the unit mix still differ from what the revision sanctioned.
      { kind: 'compare', fields: ['total_built_up', 'sanctioned_area'], when: { all: [{ situation: 'revised_sanction' }, { records: 'design.areas.floors', is: 'any' }] }, tolerance: 0.01, say: 'The floors add to {a} and the sanction, as last revised, gives {b}: the area statement has not followed the revision.', severity: 'medium' },
      { kind: 'compare', fields: ['units_designed', 'units_sanctioned'], when: { all: [{ situation: 'revised_sanction' }, { records: 'design.brief.unit_types', is: 'any' }] }, tolerance: 0, say: 'The unit mix comes to {a} units and the sanction, as last revised, allows {b}.', severity: 'medium' },
    ],
  },
  {
    set: 'design.areas.unit',
    // What a unit measures once built is the Architect's to certify; Sales holds the agreement to it.
    fields: [{ key: 'carpet_area_as_built', label: 'Carpet area as built', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], required: false, tier: 'expert', from: 'As-built measurement', proof: 'expected' }],
    rules: [{ kind: 'compare', fields: ['carpet_area_as_built', 'carpet_area'], tolerance: 0, say: 'This unit measures {a} of carpet area as built and the register holds {b}: {divergence} apart.', severity: 'medium' }],
  },
  { set: 'design.drawings.register', reports: [DESIGN_STATUS_REPORT] },
  {
    set: 'design.compliance.far',
    // The land that can be built on is what Title finds clear of restriction: the plot the design takes is held to it.
    fields: [mirror('clear_extent', 'Extent clear of restriction, per Title', 'area', at('legal.title', 'legal.title.character', 'clear_extent'), { unit: 'sqm', section: 'basis', tier: 'expert' })],
    rules: [{ kind: 'at_most', fields: ['plot_extent', 'clear_extent'], say: 'The design takes a plot of {a} and Title finds {b} clear of restriction.', severity: 'high' }],
  },
  {
    set: 'design.compliance.height',
    // The height the aerodrome's clearance allows is Liaison's to work out from the clearance; the figure read off the paper here is held to it.
    fields: [mirror('airport_height_per_liaison', 'Height the clearance allows, per Liaison', 'number', at(APPROVALS, 'legal.approvals.height_fire', 'height_allowed_by_airport'), { dimension: 'length', section: 'height', tier: 'expert' })],
    rules: [{ kind: 'compare', fields: ['airport_height_allowed', 'airport_height_per_liaison'], say: 'The design takes {a} as the height the airport clearance permits and Liaison works out {b}.', severity: 'high' }],
  },
  {
    set: 'design.sanction.reference',
    // The sanction, the commencement certificate and the plinth certificate are Liaison's records: the certificates the Architect signs cite them from there.
    fields: [
      { key: 'sanction', label: 'Sanction, as Liaison records it', kind: 'ref', target: 'approval', sameAs: at(APPROVALS, 'legal.approvals.sanction', 'sanction'), required: false, section: 'sanction', tier: 'situational', showWhen: held(at(APPROVALS, 'legal.approvals.sanction', 'sanction')) },
      mirror('commencement_on', 'Commencement certificate on', 'date', at(APPROVALS, 'legal.approvals.occupancy', 'commencement_on'), { section: 'sanction', showWhen: held(at(APPROVALS, 'legal.approvals.occupancy', 'commencement_on')) }),
      mirror('plinth_certificate_on', 'Plinth-stage certificate on', 'date', at(APPROVALS, 'legal.approvals.occupancy', 'plinth_certificate_on'), { section: 'sanction', showWhen: held(at(APPROVALS, 'legal.approvals.occupancy', 'plinth_certificate_on')) }),
    ],
  },
  {
    set: 'design.certificates.architect',
    fields: [mirror('rera_registration_no', 'RERA registration number', 'text', at('legal.rera', 'legal.rera.registration', 'registration_no'), { section: 'certificate', showWhen: { situation: 'rera_registered' } })],
  },
  {
    set: 'design.rfis.requests',
    // A query that changes cost or time opens a variation, which is Procurement's record.
    fields: [{ key: 'variation', label: 'Variation it opened', kind: 'ref', target: { set: VARIATIONS }, required: false, tier: 'situational', showWhen: { records: VARIATIONS, is: 'any' } }],
  },
  {
    set: 'design.changes.summary',
    // A design change that costs money or time is paired with the variation Procurement raised for it. Neither list must pair in full: a change may cost nothing, a variation may come from the site.
    fields: [
      {
        key: 'changes_to_variations',
        label: 'Design changes to variations',
        kind: 'table',
        display: 'match',
        required: false,
        tier: 'situational',
        showWhen: { all: [{ records: 'design.changes.register', is: 'any' }, { records: VARIATIONS, is: 'any' }] },
        columns: [
          { key: 'change', label: 'Design change', kind: 'ref', target: { set: 'design.changes.register' } },
          { key: 'variation', label: 'Variation', kind: 'ref', target: { set: VARIATIONS } },
        ],
        match: {
          left: { column: 'change', label: 'Design changes', of: { records: 'design.changes.register', field: 'number' }, optional: true },
          right: { column: 'variation', label: 'Variations', of: { records: VARIATIONS, field: 'ref' }, optional: true },
        },
      },
    ],
  },
  {
    set: 'design.structural_set.issue',
    fields: [{ key: 'concrete_poured', label: 'Concrete poured, per the site', kind: 'computed', dimension: 'volume', tier: 'situational', showWhen: { records: 'construction.quality.pours', is: 'any' }, formula: { op: 'records', set: 'construction.quality.pours', reduce: 'sum', field: 'volume' } }],
  },
  {
    set: 'design.sewage.plant',
    // The pollution control board's consents are Liaison's approval records.
    fields: [
      { key: 'consent_to_establish', label: 'Consent for establishment, as Liaison records it', kind: 'ref', target: 'approval', sameAs: at(APPROVALS, 'legal.approvals.environment', 'consent_to_establish'), required: false, section: 'sizing', tier: 'situational', showWhen: held(at(APPROVALS, 'legal.approvals.environment', 'consent_to_establish')) },
      { key: 'consent_to_operate', label: 'Consent for operation, as Liaison records it', kind: 'ref', target: 'approval', sameAs: at(APPROVALS, 'legal.approvals.environment', 'consent_to_operate'), required: false, section: 'sizing', tier: 'situational', showWhen: held(at(APPROVALS, 'legal.approvals.environment', 'consent_to_operate')) },
    ],
  },
  {
    set: 'design.fire.escape',
    // The fire service's approval is one record, Liaison's: it is read here, not chosen a second time.
    replace: [{ key: 'fire_approval', label: 'Fire service’s approval', kind: 'ref', target: 'approval', sameAs: at(APPROVALS, 'legal.approvals.height_fire', 'fire_noc'), required: false, section: 'high', tier: 'situational' }],
  },
  {
    set: 'design.brief.building',
    // What the Architect designs is held to what Liaison records as sanctioned, on the one building.
    rules: [{ kind: 'at_most', fields: ['height', 'sanctioned_height'], say: 'The building is designed to {a} and sanctioned to {b}.', severity: 'high' }],
  },
];

export const DESIGN_FIELD_SETS: FieldSet[] = withLinks([...ARCHITECT_FIELD_SETS, ...INTERIOR_FIELD_SETS, ...STRUCTURE_FIELD_SETS, ...SERVICES_FIELD_SETS], LINKS);

export { DESIGN_RULE_ROWS, DESIGN_RULE_SHAPES } from './design/rule-rows';
