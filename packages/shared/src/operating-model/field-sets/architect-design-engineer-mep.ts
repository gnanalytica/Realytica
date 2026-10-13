/**
 * The design department's field sets: the architect's, the interior and
 * landscape designer's, the structural engineer's and the services
 * engineer's. Twenty-two functions, each a workstream of Design.
 *
 * The sets themselves are in `design/`, one file to a profession, with the
 * rule rows they read. They are gathered here so the folder's index names
 * one file for the group.
 */

import type { CheckFieldDef, FieldAddress, FieldSet, ShowWhen } from '../types';
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

const LINKS: SetLinks[] = [
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
