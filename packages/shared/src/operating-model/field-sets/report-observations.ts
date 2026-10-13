/**
 * Engineering › Technical: what an engineer's report observed.
 *
 * A technical due diligence, condition or structural audit report is a list
 * of observations. Each is a record here: the part of the building and the
 * risk are picks, what was seen and what is recommended are the report's own
 * words in a line each, and a person adds who is to act and by when. A report
 * filed on the project offers its observations to this set as it is read
 * (`report-observations.ts`); a person may also add one by hand.
 */

import type { FieldSet } from '../types';

export const REPORT_OBSERVATION_FIELD_SETS: FieldSet[] = [
  {
    id: 'construction.quality.observations',
    fn: 'construction.quality',
    title: 'Report observations',
    v: 1,
    records: { of: 'observation', titleField: 'seen', summaryFields: ['risk', 'element', 'standing'] },
    optionSets: [
      {
        id: 'observed_element',
        label: 'Part of the building',
        options: [
          { key: 'structure', label: 'Structure' },
          { key: 'foundation', label: 'Foundation and basement' },
          { key: 'waterproofing', label: 'Waterproofing and damp' },
          { key: 'masonry', label: 'Masonry and plaster' },
          { key: 'facade', label: 'Facade and envelope' },
          { key: 'roof', label: 'Roof and terrace' },
          { key: 'electrical', label: 'Electrical' },
          { key: 'plumbing', label: 'Plumbing and drainage' },
          { key: 'fire', label: 'Fire and life safety' },
          { key: 'lifts', label: 'Lifts' },
          { key: 'hvac', label: 'Cooling and ventilation' },
          { key: 'finishes', label: 'Finishes' },
          { key: 'external', label: 'External works' },
          { key: 'statutory', label: 'Approvals and documents' },
          { key: 'other', label: 'Other' },
        ],
      },
      {
        id: 'observation_risk',
        label: 'Risk',
        options: [
          { key: 'critical', label: 'Critical', tone: 'critical' },
          { key: 'high', label: 'High', tone: 'critical' },
          { key: 'medium', label: 'Medium', tone: 'warning' },
          { key: 'low', label: 'Low', tone: 'neutral' },
        ],
      },
      {
        id: 'observation_standing',
        label: 'Standing',
        options: [
          { key: 'open', label: 'Open', tone: 'warning' },
          { key: 'action_agreed', label: 'Action agreed', tone: 'info' },
          { key: 'closed', label: 'Closed', tone: 'good' },
        ],
      },
    ],
    sections: [
      { key: 'observed', label: 'As the report states it' },
      { key: 'action', label: 'What is done about it' },
    ],
    fields: [
      { key: 'seen', label: 'What was seen', kind: 'text', section: 'observed', from: 'Technical due diligence report' },
      { key: 'report_no', label: 'Number in the report', kind: 'text', section: 'observed', required: false, from: 'Technical due diligence report' },
      { key: 'subject', label: 'Of what, as the report heads it', kind: 'text', section: 'observed', required: false, from: 'Technical due diligence report' },
      { key: 'element', label: 'Part of the building', kind: 'enum', optionSet: 'observed_element', section: 'observed' },
      { key: 'risk', label: 'Risk', kind: 'enum', control: 'tiles', optionSet: 'observation_risk', section: 'observed', from: 'Technical due diligence report' },
      { key: 'action', label: 'Recommended action', kind: 'text', section: 'observed', required: false, from: 'Technical due diligence report' },
      { key: 'report', label: 'The report', kind: 'ref', target: 'document', section: 'observed', required: false },
      { key: 'owner', label: 'Who is to act', kind: 'ref', target: 'party', section: 'action', required: false },
      { key: 'action_due', label: 'Action due', kind: 'date', section: 'action', required: false },
      { key: 'standing', label: 'Standing', kind: 'enum', control: 'segmented', optionSet: 'observation_standing', section: 'action', required: false },
      { key: 'closed_on', label: 'Closed on', kind: 'date', section: 'action', tier: 'situational', required: false, showWhen: { field: { fn: 'construction.quality', set: 'construction.quality.observations', field: 'standing' }, is: 'equals', value: 'closed' } },
    ],
    rules: [
      { kind: 'require_if', fields: ['standing', 'closed_on'], whenIn: ['closed'], say: 'This observation is marked closed and no day is recorded for it.', severity: 'low' },
    ],
  },
];
