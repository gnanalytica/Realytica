/**
 * The interior and landscape designer's functions: the finishes schedule,
 * landscape and external works, samples and mock-ups, and the register of
 * design changes.
 *
 * A design change is the designer's record of what changed and why. The
 * priced variation and the claim for time it may lead to are Procurement's,
 * and what buyers were promised is Sales's: those are read, not kept here.
 */

import type { FieldSet } from '../../types';
import { FN, SET, against, at, countOf, countWhere, excess, f, read, saying, share, sumWhere } from './kit';

const MOCKUPS = 'design.samples.mockups';
const DECIDED = ['approved', 'approved_with_comments', 'revise', 'rejected'];

export const INTERIOR_FIELD_SETS: FieldSet[] = [
  /* ================================================================== */
  /* Finishes schedule                                                   */
  /* ================================================================== */
  {
    id: 'design.finishes.schedule',
    fn: FN.finishes,
    title: 'Finishes schedule',
    v: 1,
    optionSets: [
      {
        id: 'design_schedule_stage',
        label: 'Schedule stands at',
        options: [
          { key: 'draft', label: 'Draft', tone: 'neutral' },
          { key: 'for_tender', label: 'Issued for tender', tone: 'info' },
          { key: 'for_construction', label: 'Issued for construction', tone: 'info' },
          { key: 'frozen', label: 'Frozen', tone: 'good' },
        ],
      },
    ],
    fields: [
      { key: 'schedule', label: 'Schedule', kind: 'evidence', accepts: 'document', viewer: 'pdf', from: 'Specification sheet' },
      { key: 'schedule_revision', label: 'Schedule revision', kind: 'text', from: 'Specification sheet' },
      { key: 'stage', label: 'Schedule stands at', kind: 'enum', control: 'tiles', optionSet: 'design_schedule_stage', hint: 'Once frozen, a change goes through the design change register.' },
      { key: 'items', label: 'Finishes specified', kind: 'computed', formula: countOf(SET.finishItems) },
      { key: 'promised', label: 'Of them, named in the agreement for sale', kind: 'computed', formula: countWhere(SET.finishItems, { column: 'promised', is: 'true' }) },
      { key: 'samples_awaited', label: 'Samples still to be approved', kind: 'computed', formula: countWhere(SET.finishItems, { column: 'sample', is: 'equals', value: 'awaited' }) },
      { key: 'long_lead', label: 'Long-lead items', kind: 'computed', formula: countWhere(SET.finishItems, { column: 'lead_weeks', is: 'gt', value: 0 }) },
      { key: 'makes', label: 'Approved makes', kind: 'computed', formula: countOf(SET.makes) },
    ],
    rules: [
      {
        kind: 'at_most',
        fields: ['samples_awaited'],
        against: 0,
        when: { field: at(FN.finishes, 'design.finishes.schedule', 'stage'), is: 'equals', value: 'frozen' },
        say: 'The schedule is frozen. Samples still to be approved: {a}.',
        severity: 'medium',
      },
    ],
  },
  {
    id: SET.finishItems,
    fn: FN.finishes,
    title: 'Finishes',
    v: 1,
    records: { of: 'finish', titleField: 'code', summaryFields: ['space', 'element', 'make'] },
    optionSets: [
      {
        id: 'design_sample_standing',
        label: 'Sample',
        options: [
          { key: 'not_needed', label: 'Not needed', tone: 'neutral' },
          { key: 'awaited', label: 'Awaited', tone: 'warning' },
          { key: 'approved', label: 'Approved', tone: 'good' },
        ],
      },
    ],
    fields: [
      { key: 'code', label: 'Specification code', kind: 'text', from: 'Specification sheet' },
      {
        key: 'space',
        label: 'Space',
        kind: 'enum',
        options: ['living', 'dining', 'bedroom', 'master bedroom', 'kitchen', 'toilet', 'balcony', 'utility', 'lobby', 'corridor', 'staircase', 'lift lobby', 'basement', 'façade', 'terrace'],
        from: 'Specification sheet',
      },
      {
        key: 'element',
        label: 'Element',
        kind: 'enum',
        options: ['floor', 'skirting', 'wall', 'ceiling', 'dado', 'door', 'window', 'counter', 'railing', 'sanitaryware', 'taps and fittings', 'switches', 'paint'],
        from: 'Specification sheet',
      },
      { key: 'material', label: 'Material', kind: 'text', from: 'Specification sheet' },
      { key: 'make', label: 'Make', kind: 'ref', target: { set: SET.makes }, required: false },
      { key: 'promised', label: 'Named in the agreement for sale', kind: 'boolean', control: 'switch', hint: 'A change to it alters what buyers were promised.' },
      { key: 'sample', label: 'Sample', kind: 'enum', control: 'segmented', optionSet: 'design_sample_standing' },
      { key: 'lead_weeks', label: 'Lead time', kind: 'duration', unit: 'weeks', required: false, from: 'Vendor quotation' },
      { key: 'size', label: 'Size', kind: 'text', tier: 'expert', required: false, from: 'Specification sheet' },
      { key: 'finish', label: 'Finish', kind: 'text', tier: 'expert', required: false, from: 'Specification sheet' },
    ],
    rules: [],
  },
  {
    id: SET.makes,
    fn: FN.finishes,
    title: 'Approved makes',
    v: 1,
    records: { of: 'make', titleField: 'make', summaryFields: ['item', 'basis'] },
    fields: [
      { key: 'make', label: 'Make', kind: 'text', hint: 'The maker’s name, as the list prints it.', from: 'Tender specification' },
      { key: 'item', label: 'For', kind: 'text', hint: 'The item it is approved for.', from: 'Tender specification' },
      { key: 'standard', label: 'Standard cited', kind: 'text', required: false, from: 'Tender specification' },
      { key: 'basis', label: 'Approved by', kind: 'enum', control: 'segmented', options: ['owner’s list', 'contract', 'consultant'] },
    ],
    rules: [],
  },
  {
    id: 'design.finishes.doors',
    fn: FN.finishes,
    title: 'Doors and windows',
    v: 1,
    records: { of: 'door or window', titleField: 'mark', summaryFields: ['kind', 'count'] },
    fields: [
      { key: 'mark', label: 'Mark', kind: 'text', from: 'Door and window schedule' },
      { key: 'kind', label: 'Kind', kind: 'enum', control: 'segmented', options: ['door', 'window', 'ventilator'] },
      { key: 'width', label: 'Width', kind: 'number', dimension: 'length', enterIn: ['mm', 'm', 'ft'], from: 'Door and window schedule' },
      { key: 'height', label: 'Height', kind: 'number', dimension: 'length', enterIn: ['mm', 'm', 'ft'], from: 'Door and window schedule' },
      { key: 'material', label: 'Material', kind: 'text', from: 'Door and window schedule' },
      { key: 'count', label: 'Count', kind: 'number', min: 0, precision: 0, from: 'Door and window schedule' },
      { key: 'fire_rating', label: 'Fire rating', kind: 'duration', unit: 'minutes', required: false, from: 'Door and window schedule' },
      { key: 'rating_certificate', label: 'Test certificate for the rating', kind: 'evidence', accepts: 'document', viewer: 'pdf', tier: 'situational', showWhen: { field: at(FN.finishes, 'design.finishes.doors', 'fire_rating'), is: 'gt', value: 0 } },
    ],
    rules: [],
  },
  {
    id: 'design.finishes.waterproofing',
    fn: FN.finishes,
    title: 'Waterproofing',
    v: 1,
    records: { of: 'area', titleField: 'area', summaryFields: ['system', 'warranty'] },
    fields: [
      { key: 'area', label: 'Area', kind: 'enum', options: ['basement raft', 'retaining wall', 'toilet', 'balcony', 'terrace', 'podium', 'water tank', 'lift pit'] },
      { key: 'system', label: 'System', kind: 'text', from: 'Specification sheet' },
      { key: 'make', label: 'Make', kind: 'ref', target: { set: SET.makes }, required: false },
      { key: 'warranty', label: 'Warranty', kind: 'duration', unit: 'years', from: 'Specification sheet' },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Landscape and external works                                        */
  /* ================================================================== */
  {
    id: 'design.landscape.statement',
    fn: FN.landscape,
    title: 'Landscape',
    v: 1,
    situations: [
      { key: 'trees_to_be_cut', label: 'Trees to be cut', scope: 'function', derive: { field: at(FN.landscape, 'design.landscape.statement', 'trees_to_cut'), is: 'gt', value: 0 } },
      { key: 'landscape_on_slab', label: 'Landscape on a podium slab', scope: 'function', hint: 'Soil and planting sit on a structural slab.' },
    ],
    sections: [
      { key: 'areas', label: 'Areas' },
      { key: 'trees', label: 'Trees' },
      { key: 'permission', label: 'Tree-cutting permission', showWhen: { situation: 'trees_to_be_cut' } },
      { key: 'water', label: 'Water' },
      { key: 'slab', label: 'On the podium', showWhen: { situation: 'landscape_on_slab' } },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'landscape_plan', label: 'Landscape plan', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'areas', hint: 'Filed beside what is typed from it.' },
      { key: 'soft_area', label: 'Soft landscape', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'areas', from: 'Landscape area statement' },
      { key: 'hard_area', label: 'Hard landscape', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'areas', from: 'Landscape area statement' },
      { key: 'green_cover', label: 'Green cover', kind: 'computed', unit: '%', section: 'areas', formula: share(f('soft_area'), read(at(FN.brief, SET.brief, 'plot_extent'))) },
      { key: 'trees_existing', label: 'Existing trees', kind: 'number', min: 0, precision: 0, section: 'trees', from: 'Tree survey' },
      { key: 'trees_to_cut', label: 'Trees to be cut', kind: 'number', min: 0, precision: 0, section: 'trees', from: 'Tree survey' },
      { key: 'trees_to_plant', label: 'Trees to be planted', kind: 'number', min: 0, precision: 0, section: 'trees', from: 'Landscape plan' },
      { key: 'tree_permission', label: 'Tree-cutting permission', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'permission', tier: 'situational' },
      { key: 'trees_required', label: 'Trees the permission asks to be planted', kind: 'number', min: 0, precision: 0, section: 'permission', tier: 'situational', from: 'Tree-cutting permission', proof: 'expected' },
      against({
        key: 'tree_standing',
        label: 'Planting against the permission',
        section: 'permission',
        measure: 'trees_to_plant',
        limit: 'trees_required',
        must: 'at_least',
        missing: 'The permission’s number is not on file',
        failing: 'Fewer than the permission asks',
        passing: 'Meets the permission',
        say: '{a} trees are to be planted and the permission asks for {b}.',
        more: { tier: 'situational' },
      }),
      { key: 'irrigation_demand', label: 'Water for the landscape', kind: 'number', unit: 'KLD', min: 0, section: 'water', from: 'Landscape consultant' },
      { key: 'irrigation_source', label: 'Watered from', kind: 'enum', control: 'segmented', options: ['treated water', 'borewell', 'tanker', 'municipal supply'], section: 'water' },
      { key: 'on_slab_area', label: 'Landscape on the slab', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'slab', tier: 'situational', from: 'Landscape area statement' },
      { key: 'soil_depth', label: 'Soil depth on the slab', kind: 'number', dimension: 'length', enterIn: ['mm', 'm'], section: 'slab', tier: 'situational', hint: 'The structural engineer’s loads carry it.', from: 'Landscape section' },
      { key: 'pool_volume', label: 'Swimming pool volume', kind: 'number', dimension: 'volume', enterIn: ['cum', 'litre'], section: 'more', tier: 'expert', required: false, from: 'Pool drawing' },
    ],
    rules: [
      saying('at_least', 'trees_to_plant', 'trees_required', '{a} trees are to be planted and the permission asks for {b}.'),
      { kind: 'at_most', fields: ['trees_to_cut', 'trees_existing'], say: '{a} trees are to be cut and {b} stand on the plot.', severity: 'low' },
      { kind: 'require', fields: ['tree_permission'], when: { situation: 'trees_to_be_cut' }, say: 'Trees are to be cut and the permission is not on file.', severity: 'high' },
    ],
  },
  {
    id: 'design.landscape.external_works',
    fn: FN.landscape,
    title: 'External works',
    v: 1,
    records: { of: 'item', titleField: 'item', summaryFields: ['quantity', 'measured_in'] },
    fields: [
      { key: 'item', label: 'Item', kind: 'enum', options: ['internal roads', 'footpaths', 'compound wall', 'gates', 'street lights', 'storm drains', 'rain pits', 'play equipment', 'water body', 'signage'] },
      { key: 'quantity', label: 'Quantity', kind: 'number', min: 0, hint: 'Typed by a person where it is only drawn.', from: 'External works drawing' },
      { key: 'measured_in', label: 'Measured in', kind: 'enum', control: 'segmented', options: ['m', 'sqm', 'number'] },
      { key: 'drawing', label: 'Drawing', kind: 'ref', target: 'drawing', required: false },
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Samples and mock-ups                                                */
  /* ================================================================== */
  {
    id: 'design.samples.standing',
    fn: FN.samples,
    title: 'Approvals',
    v: 1,
    fields: [
      { key: 'submitted', label: 'Submittals', kind: 'computed', formula: countOf(SET.submittals) },
      { key: 'pending', label: 'Awaiting a decision', kind: 'computed', formula: countWhere(SET.submittals, { column: 'standing', is: 'in', value: ['Pending', 'Overdue'] }) },
      { key: 'overdue', label: 'Past the day a decision was due', kind: 'computed', formula: countWhere(SET.submittals, { column: 'standing', is: 'equals', value: 'Overdue' }) },
      { key: 'to_resubmit', label: 'To revise and resubmit', kind: 'computed', formula: countWhere(SET.submittals, { column: 'decision', is: 'equals', value: 'revise' }) },
      { key: 'deviating', label: 'Approved though they deviate from the schedule', kind: 'computed', formula: countWhere(SET.submittals, { column: 'deviates', is: 'true' }) },
      { key: 'mockups', label: 'Mock-ups', kind: 'computed', formula: countOf(MOCKUPS) },
      { key: 'mockups_decided', label: 'Mock-ups decided', kind: 'computed', formula: countWhere(MOCKUPS, { column: 'decision', is: 'in', value: DECIDED }) },
      { key: 'sample_flat_approved', label: 'Sample flat approved', kind: 'boolean', control: 'tick', required: false },
    ],
    rules: [{ kind: 'at_most', fields: ['overdue'], against: 0, say: 'Submittals past the day a decision was due: {a}.', severity: 'medium' }],
  },
  {
    id: SET.submittals,
    fn: FN.samples,
    title: 'Material and sample submittals',
    v: 1,
    records: { of: 'submittal', titleField: 'number', summaryFields: ['item', 'decision', 'standing'] },
    optionSets: [
      {
        id: 'design_review_decision',
        label: 'Decision',
        options: [
          { key: 'approved', label: 'Approved', tone: 'good' },
          { key: 'approved_with_comments', label: 'Approved with comments', tone: 'info' },
          { key: 'revise', label: 'Revise and resubmit', tone: 'warning' },
          { key: 'rejected', label: 'Rejected', tone: 'critical' },
        ],
      },
    ],
    sections: [
      { key: 'submittal', label: 'Submittal' },
      { key: 'review', label: 'Review' },
      { key: 'more', label: 'More', tier: 'expert' },
    ],
    fields: [
      { key: 'number', label: 'Submittal number', kind: 'text', section: 'submittal', from: 'Material approval request' },
      { key: 'submitted_on', label: 'Submitted on', kind: 'date', section: 'submittal', from: 'Material approval request' },
      { key: 'contractor', label: 'Submitted by', kind: 'ref', target: 'party', section: 'submittal' },
      { key: 'package', label: 'Work package', kind: 'ref', target: 'package', section: 'submittal', required: false },
      { key: 'finish', label: 'Finish on the schedule', kind: 'ref', target: { set: SET.finishItems }, section: 'submittal', required: false },
      { key: 'item', label: 'Item', kind: 'text', section: 'submittal', from: 'Material approval request' },
      { key: 'make', label: 'Make offered', kind: 'text', section: 'submittal', from: 'Material approval request' },
      { key: 'test_certificate', label: 'Test certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'submittal', required: false },
      { key: 'certificate_valid_until', label: 'Certificate valid until', kind: 'date', section: 'submittal', required: false, expires: { leadDays: 30 }, from: 'Test certificate' },
      { key: 'reviewer', label: 'Reviewer', kind: 'ref', target: 'party', section: 'review' },
      { key: 'decide_by', label: 'Decision due by', kind: 'date', section: 'review', hint: 'The review period is the contract’s.', from: 'Contract' },
      { key: 'decision', label: 'Decision', kind: 'enum', control: 'tiles', optionSet: 'design_review_decision', section: 'review', required: false },
      { key: 'decided_on', label: 'Decided on', kind: 'date', section: 'review', required: false },
      {
        key: 'days_overdue',
        label: 'Days past the day due',
        kind: 'computed',
        precision: 0,
        section: 'review',
        formula: { op: 'if', when: { field: 'decision', is: 'set' }, then: { op: 'const', value: 0 }, else: excess({ op: 'today' }, { op: 'date', key: 'decide_by' }) },
      },
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        section: 'review',
        cases: [
          { when: { kind: 'at_most', fields: ['days_overdue'], against: 0, say: 'Undecided, and past the day a decision was due by {a} days.', severity: 'medium' }, label: 'Overdue', tone: 'critical' },
          { when: { kind: 'require', fields: ['decision'], say: 'Not decided yet.', severity: 'low' }, label: 'Pending', tone: 'info' },
        ],
        otherwise: { label: 'Decided', tone: 'good' },
      },
      { key: 'deviates', label: 'Deviates from the finishes schedule', kind: 'boolean', control: 'switch', section: 'review' },
      { key: 'change', label: 'Design change that records it', kind: 'ref', target: { set: SET.changes }, section: 'review', tier: 'situational', showWhen: { field: at(FN.samples, SET.submittals, 'deviates'), is: 'true' } },
      { key: 'comments', label: 'Reviewer’s comments', kind: 'longtext', maxLength: 300, section: 'more', tier: 'expert', required: false },
    ],
    rules: [
      { kind: 'before', fields: ['submitted_on', 'decided_on'], say: 'Decided on {b}, before it was submitted on {a}.', severity: 'low' },
      { kind: 'require_if', fields: ['deviates', 'change'], whenIn: ['true'], say: 'It deviates from the finishes schedule and no design change records it.', severity: 'medium' },
    ],
  },
  {
    id: MOCKUPS,
    fn: FN.samples,
    title: 'Mock-ups',
    v: 1,
    records: { of: 'mock-up', titleField: 'mockup', summaryFields: ['inspected_on', 'decision'] },
    fields: [
      { key: 'mockup', label: 'Mock-up', kind: 'enum', options: ['sample flat', 'toilet', 'kitchen', 'façade panel', 'waterproofing', 'flooring', 'railing', 'door set', 'services first fix'] },
      { key: 'location', label: 'Where', kind: 'text' },
      { key: 'built_on', label: 'Built on', kind: 'date', required: false },
      { key: 'inspected_on', label: 'Inspected on', kind: 'date', from: 'Mock-up inspection sheet' },
      { key: 'decision', label: 'Decision', kind: 'enum', control: 'tiles', optionSet: 'design_review_decision', required: false },
      { key: 'punch_items', label: 'Punch items', kind: 'number', min: 0, precision: 0, required: false, from: 'Mock-up inspection sheet' },
      { key: 'closed_on', label: 'Punch items closed on', kind: 'date', required: false },
      { key: 'photos', label: 'Photographs', kind: 'evidence', accepts: 'image', viewer: 'image', required: false },
    ],
    rules: [{ kind: 'before', fields: ['built_on', 'inspected_on'], say: 'Inspected on {b}, before it was built on {a}.', severity: 'low' }],
  },

  /* ================================================================== */
  /* Design changes                                                      */
  /* ================================================================== */
  {
    id: 'design.changes.summary',
    fn: FN.changes,
    title: 'Changes',
    v: 1,
    fields: [
      { key: 'raised', label: 'Changes raised', kind: 'computed', formula: countOf(SET.changes) },
      { key: 'open', label: 'Not yet decided', kind: 'computed', formula: countWhere(SET.changes, { column: 'stage', is: 'in', value: ['proposed', 'costed'] }) },
      {
        key: 'approved_cost',
        label: 'Estimated cost of approved changes',
        kind: 'computed',
        dimension: 'money',
        currency: 'INR',
        formula: sumWhere(SET.changes, 'cost_estimate', { column: 'stage', is: 'in', value: ['approved', 'issued', 'built'] }),
      },
      { key: 'approved_days', label: 'Time of approved changes, added up', kind: 'computed', unit: 'days', precision: 0, hint: 'A plain sum. Changes that overlap in time add to less.', formula: sumWhere(SET.changes, 'time_effect', { column: 'stage', is: 'in', value: ['approved', 'issued', 'built'] }) },
      { key: 'needing_sanction', label: 'Needing a modified sanction', kind: 'computed', formula: countWhere(SET.changes, { column: 'needs_modified_sanction', is: 'true' }) },
      { key: 'altering_promise', label: 'Altering what buyers were promised', kind: 'computed', formula: countWhere(SET.changes, { column: 'alters_promise', is: 'true' }) },
      { key: 'built_first', label: 'Built before approval', kind: 'computed', formula: countWhere(SET.changes, { column: 'built_before_approval', is: 'true' }) },
    ],
    rules: [{ kind: 'at_most', fields: ['built_first'], against: 0, say: 'Changes built on site before they were approved: {a}.', severity: 'high' }],
  },
  {
    id: SET.changes,
    fn: FN.changes,
    title: 'Design changes',
    v: 1,
    records: { of: 'change', titleField: 'number', summaryFields: ['origin', 'stage', 'cost_estimate'] },
    optionSets: [
      {
        id: 'design_change_stage',
        label: 'Stage',
        options: [
          { key: 'proposed', label: 'Proposed', tone: 'neutral' },
          { key: 'costed', label: 'Costed', tone: 'info' },
          { key: 'approved', label: 'Approved', tone: 'good' },
          { key: 'rejected', label: 'Rejected', tone: 'critical' },
          { key: 'issued', label: 'Issued', tone: 'good' },
          { key: 'built', label: 'Built', tone: 'good' },
        ],
      },
    ],
    sections: [
      { key: 'change', label: 'Change' },
      { key: 'effect', label: 'Effect' },
      { key: 'approval', label: 'Approval' },
    ],
    // Two hard cases, each a sheet of the change that has it: one that alters what buyers were promised, and one that needs the sanctioned plan revised.
    sheets: [
      {
        id: 'buyers',
        title: 'What buyers were promised',
        showWhen: { field: at(FN.changes, SET.changes, 'alters_promise'), is: 'true' },
        fields: [
          { key: 'units_affected', label: 'Units it affects', kind: 'number', min: 0, precision: 0 },
          { key: 'consent_route', label: 'Buyers are', kind: 'enum', control: 'segmented', options: ['told of it', 'asked to consent'], hint: 'Which the law asks for, and of how many, is Legal’s to say.' },
          { key: 'finish_replaced', label: 'Finish on the schedule it replaces', kind: 'ref', target: { set: SET.finishItems }, required: false },
          { key: 'equivalence_certified_by', label: 'Equal or better, certified by', kind: 'ref', target: 'party', required: false },
          { key: 'buyers_told_on', label: 'Buyers told on', kind: 'date', required: false, from: 'Letter to allottees' },
          { key: 'buyers_letter', label: 'Letter to allottees', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
        ],
        rules: [{ kind: 'before', fields: ['buyers_told_on', 'approved_on'], say: 'Approved on {b}, and buyers were told only on {a}.', severity: 'medium' }],
      },
      {
        id: 'modified_sanction',
        title: 'Modified sanction',
        showWhen: { field: at(FN.changes, SET.changes, 'needs_modified_sanction'), is: 'true' },
        fields: [
          // The revision is Liaison's record: linked, with its dates read from there.
          { key: 'revision', label: 'Plan revision, as Liaison records it', kind: 'ref', target: { set: 'legal.approvals.revisions' }, required: false },
          { key: 'revision_applied_on', label: 'Revision applied for on', kind: 'computed', yields: 'date', formula: { op: 'date', key: 'applied_on', at: at('legal.approvals', 'legal.approvals.revisions', 'applied_on'), via: 'revision' } },
          { key: 'revision_sanctioned_on', label: 'Revision sanctioned on', kind: 'computed', yields: 'date', formula: { op: 'date', key: 'sanctioned_on', at: at('legal.approvals', 'legal.approvals.revisions', 'sanctioned_on'), via: 'revision' } },
          {
            key: 'ahead_of_sanction',
            label: 'Issued or built ahead of the revised sanction',
            kind: 'computed',
            precision: 0,
            tier: 'expert',
            formula: { op: 'if', when: { all: [{ field: 'stage', is: 'in', value: ['issued', 'built'] }, { field: 'needs_modified_sanction', is: 'true' }] }, then: { op: 'if', when: { field: 'revision_sanctioned_on', is: 'set' }, then: { op: 'const', value: 0 }, else: { op: 'const', value: 1 } }, else: { op: 'const', value: 0 } },
          },
        ],
        rules: [
          { kind: 'require', fields: ['revision'], when: { records: 'legal.approvals.revisions', is: 'any' }, say: 'The change needs a modified sanction and no plan revision is linked to it.', severity: 'medium' },
          { kind: 'at_most', fields: ['ahead_of_sanction'], against: 0, say: 'The change is issued or built, and the revision of the sanction it needs is not sanctioned.', severity: 'high' },
        ],
      },
    ],
    fields: [
      { key: 'number', label: 'Change number', kind: 'text', section: 'change', from: 'Change request form' },
      { key: 'raised_on', label: 'Raised on', kind: 'date', section: 'change', from: 'Change request form' },
      { key: 'raised_by', label: 'Raised by', kind: 'ref', target: 'party', section: 'change' },
      { key: 'origin', label: 'Arises from', kind: 'enum', options: ['owner', 'architect', 'structural engineer', 'services engineer', 'authority', 'site condition', 'buyer', 'value engineering', 'request for information'], section: 'change', from: 'Change request form' },
      { key: 'description', label: 'What changes', kind: 'longtext', maxLength: 400, section: 'change' },
      { key: 'request', label: 'Change request form', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'change', required: false },
      {
        key: 'drawings',
        label: 'Drawings it touches',
        kind: 'table',
        section: 'change',
        required: false,
        columns: [{ key: 'drawing', label: 'Drawing', kind: 'ref', target: 'drawing' }],
      },
      { key: 'stage', label: 'Stage', kind: 'enum', control: 'tiles', optionSet: 'design_change_stage', section: 'approval' },
      { key: 'cost_effect', label: 'Effect on cost', kind: 'enum', control: 'segmented', options: ['no effect', 'saving', 'extra'], section: 'effect' },
      { key: 'cost_estimate', label: 'Estimate of the cost', kind: 'money', dimension: 'money', currency: 'INR', min: -1e12, section: 'effect', required: false, hint: 'The designer’s estimate, a saving as a minus. The priced variation is Procurement’s.', from: 'Quantity surveyor’s estimate' },
      { key: 'time_effect', label: 'Effect on time', kind: 'duration', unit: 'days', section: 'effect', required: false, from: 'Planner’s estimate' },
      { key: 'needs_modified_sanction', label: 'Needs a modified sanction', kind: 'boolean', control: 'switch', section: 'effect' },
      { key: 'alters_promise', label: 'Alters what buyers were promised', kind: 'boolean', control: 'switch', section: 'effect' },
      { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party', section: 'approval', required: false },
      { key: 'approved_on', label: 'Approved on', kind: 'date', section: 'approval', required: false },
      { key: 'built_before_approval', label: 'Built on site before approval', kind: 'boolean', control: 'switch', section: 'approval', required: false, from: 'Site log' },
    ],
    rules: [
      { kind: 'before', fields: ['raised_on', 'approved_on'], say: 'Approved on {b}, before it was raised on {a}.', severity: 'low' },
      { kind: 'require_if', fields: ['stage', 'approved_by'], whenIn: ['approved', 'issued', 'built'], say: 'The change is {a} and nobody is named as approving it.', severity: 'high' },
      { kind: 'require_if', fields: ['cost_effect', 'cost_estimate'], whenIn: ['saving', 'extra'], say: 'The change is said to be a {a} and carries no estimate.', severity: 'medium' },
      { kind: 'require', fields: ['approved_on'], when: { field: at(FN.changes, SET.changes, 'built_before_approval'), is: 'true' }, say: 'Built on site with no approval recorded.', severity: 'high' },
    ],
  },
];
