/**
 * The records every department leans on, each entered once: party, parcel,
 * building, unit, drawing, approval, matter,
 * contract, account.
 *
 * Each is a set that repeats under the function `shared`, which is the
 * project itself. A `ref` field names one by its target (`party`, `parcel`,
 * `building`, `unit`, `drawing`, `approval`, `matter`, `contract`, `account`), and a department adds its own
 * facts about one with a field set that `extends` it.
 *
 * What the project already keeps is not kept twice. A person already on the
 * project's list of people, a survey number already on the project, and an
 * approval the register already draws from the papers can each be linked to
 * as they are; a record here is for what those lists do not hold.
 */

import { APPROVAL_KINDS } from '../approvals';
import type { FieldSet } from '../types';

export const SHARED_FN = 'shared';

/** The set each record target is kept in. */
export const SHARED_RECORD_SETS = {
  party: 'shared.parties',
  parcel: 'shared.parcels',
  unit: 'shared.units',
  drawing: 'shared.drawings',
  approval: 'shared.approvals',
  matter: 'shared.matters',
  building: 'shared.buildings',
  contract: 'shared.contracts',
  account: 'shared.accounts',
} as const;

export const SHARED_RECORDS: FieldSet[] = [
  {
    id: SHARED_RECORD_SETS.party,
    fn: SHARED_FN,
    title: 'Parties',
    v: 1,
    records: { of: 'party', titleField: 'name', summaryFields: ['kind', 'roles'] },
    optionSets: [
      {
        id: 'party_kind',
        label: 'Kind of party',
        options: ['individual', 'HUF', 'firm', 'LLP', 'company', 'trust', 'society', 'government body'].map((label) => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label })),
      },
      {
        id: 'party_role',
        label: 'Role',
        options: ['owner', 'vendor', 'developer', 'contractor', 'consultant', 'architect', 'engineer', 'accountant', 'advocate', 'lender', 'authority', 'valuer', 'customer', 'channel partner', 'litigant'].map((label) => ({ key: label.replace(/\s+/g, '_'), label })),
      },
    ],
    fields: [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'kind', label: 'Kind', kind: 'enum', optionSet: 'party_kind', required: false },
      { key: 'roles', label: 'Roles', kind: 'multi_enum', optionSet: 'party_role', required: false },
      { key: 'organisation', label: 'Organisation', kind: 'text', required: false },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.parcel,
    fn: SHARED_FN,
    title: 'Parcels',
    v: 1,
    records: { of: 'parcel', titleField: 'survey_number', summaryFields: ['extent', 'village'] },
    fields: [
      { key: 'survey_number', label: 'Survey number', kind: 'text' },
      { key: 'hissa', label: 'Hissa', kind: 'text', required: false },
      { key: 'extent', label: 'Extent', kind: 'area', dimension: 'area', enterIn: ['acre', 'gunta', 'cent', 'sqm', 'sqft', 'hectare', 'ground'] },
      { key: 'village', label: 'Village', kind: 'text', required: false },
      { key: 'hobli', label: 'Hobli', kind: 'text', required: false },
      { key: 'taluk', label: 'Taluk', kind: 'text', required: false },
      { key: 'district', label: 'District', kind: 'text', required: false },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.unit,
    fn: SHARED_FN,
    title: 'Units',
    v: 1,
    records: { of: 'unit', titleField: 'number', summaryFields: ['tower', 'type', 'carpet_area'] },
    fields: [
      { key: 'number', label: 'Unit number', kind: 'text', fromTypes: ['Allotment letter', 'Agreement for sale'], factKey: 'unit_number' },
      { key: 'tower', label: 'Tower', kind: 'text', required: false },
      { key: 'floor', label: 'Floor', kind: 'number', required: false },
      { key: 'type', label: 'Type', kind: 'text', required: false },
      { key: 'carpet_area', label: 'Carpet area', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], required: false },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.drawing,
    fn: SHARED_FN,
    title: 'Drawings',
    v: 1,
    records: { of: 'drawing', titleField: 'number', summaryFields: ['title', 'revision'] },
    optionSets: [
      {
        id: 'drawing_discipline',
        label: 'Discipline',
        options: ['architecture', 'structure', 'electrical', 'plumbing', 'HVAC', 'fire', 'landscape', 'interior'].map((label) => ({ key: label.toLowerCase(), label })),
      },
    ],
    fields: [
      { key: 'number', label: 'Drawing number', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'discipline', label: 'Discipline', kind: 'enum', optionSet: 'drawing_discipline', required: false },
      { key: 'revision', label: 'Revision', kind: 'text', required: false },
      { key: 'issued_on', label: 'Issued on', kind: 'date', required: false },
      { key: 'file', label: 'Drawing', kind: 'evidence', accepts: 'document', viewer: 'drawing', required: false },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.approval,
    fn: SHARED_FN,
    title: 'Approvals',
    v: 1,
    records: { of: 'approval', titleField: 'reference', summaryFields: ['kind', 'standing', 'valid_until'] },
    optionSets: [
      { id: 'approval_kind', label: 'Approval', options: [...APPROVAL_KINDS.map((kind) => ({ key: kind.key, label: kind.label })), { key: 'other', label: 'Other' }] },
      {
        id: 'approval_standing',
        label: 'Standing',
        options: [
          { key: 'in_hand', label: 'In hand', tone: 'good' },
          { key: 'applied', label: 'Applied', tone: 'info' },
          { key: 'query_raised', label: 'Query raised', tone: 'warning' },
          { key: 'expired', label: 'Expired', tone: 'critical' },
          { key: 'refused', label: 'Refused', tone: 'critical' },
          { key: 'not_required', label: 'Not required', tone: 'neutral' },
        ],
      },
    ],
    fields: [
      { key: 'reference', label: 'Reference number', kind: 'text' },
      { key: 'kind', label: 'Approval', kind: 'enum', optionSet: 'approval_kind' },
      { key: 'authority', label: 'Authority', kind: 'ref', target: 'party', required: false },
      { key: 'standing', label: 'Standing', kind: 'enum', optionSet: 'approval_standing', control: 'segmented' },
      { key: 'applied_on', label: 'Applied on', kind: 'date', required: false },
      { key: 'issued_on', label: 'Issued on', kind: 'date', required: false },
      { key: 'valid_until', label: 'Valid until', kind: 'date', required: false },
      { key: 'paper', label: 'Paper', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [{ kind: 'before', fields: ['applied_on', 'issued_on'], say: 'Issued on {b}, before it was applied for on {a}.', severity: 'medium' }],
  },
  {
    id: SHARED_RECORD_SETS.matter,
    fn: SHARED_FN,
    title: 'Matters',
    v: 1,
    records: { of: 'matter', titleField: 'case_number', summaryFields: ['court', 'next_hearing'] },
    fields: [
      { key: 'case_number', label: 'Case number', kind: 'text' },
      { key: 'court', label: 'Court', kind: 'text' },
      { key: 'subject', label: 'Subject', kind: 'text', required: false },
      { key: 'parcel', label: 'Parcel', kind: 'ref', target: 'parcel', required: false },
      { key: 'next_hearing', label: 'Next hearing', kind: 'date', required: false, expires: { leadDays: 7 } },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.building,
    fn: SHARED_FN,
    title: 'Buildings',
    v: 1,
    records: { of: 'building', titleField: 'name', summaryFields: ['floors', 'built_up_area'] },
    fields: [
      { key: 'name', label: 'Building or wing', kind: 'text' },
      { key: 'floors', label: 'Floors', kind: 'number', required: false },
      { key: 'built_up_area', label: 'Built-up area', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], required: false },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.contract,
    fn: SHARED_FN,
    title: 'Contracts',
    v: 1,
    records: { of: 'contract', titleField: 'title', summaryFields: ['counterparty', 'signed_on'] },
    fields: [
      { key: 'title', label: 'Contract', kind: 'text' },
      { key: 'counterparty', label: 'With', kind: 'ref', target: 'party', fromTypes: ['Work order'], factKey: 'contractor' },
      { key: 'package', label: 'Package', kind: 'ref', target: 'package', required: false },
      { key: 'signed_on', label: 'Signed on', kind: 'date', required: false },
      { key: 'paper', label: 'Paper', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [],
  },
  {
    id: SHARED_RECORD_SETS.account,
    fn: SHARED_FN,
    title: 'Accounts',
    v: 1,
    records: { of: 'account', titleField: 'name', summaryFields: ['purpose', 'bank'] },
    fields: [
      { key: 'name', label: 'Account', kind: 'text', hint: 'A name for it. Not the account number.' },
      { key: 'purpose', label: 'Kept for', kind: 'enum', options: ['collection', 'RERA designated', 'operating', 'escrow'] },
      { key: 'bank', label: 'Bank', kind: 'ref', target: 'party', required: false },
    ],
    rules: [],
  },
];
