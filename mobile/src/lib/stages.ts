/**
 * Plain names for the lifecycle stages the API reports by key. Mirrors
 * SUB_STAGE_LABEL in packages/shared/src/operating-model/departments.ts; an
 * unknown key (a newer server) is shown tidied up rather than raw.
 */
const LABEL: Record<string, string> = {
  opportunity_site: 'Opportunity',
  feasibility: 'Feasibility',
  acquisition: 'Acquisition',
  design: 'Design',
  approvals: 'Approvals',
  procurement: 'Tender & procurement',
  pre_construction: 'Pre-construction',
  construction: 'Construction',
  testing_commissioning: 'Testing & commissioning',
  completion: 'Completion',
  handover: 'Handover',
  operations: 'Operations',
};

/**
 * The lifecycle in order, in its four phases. Mirrors STAGES in the same
 * shared file: pre-development, design & tender, construction, operations.
 */
export const STAGE_PHASES: readonly (readonly string[])[] = [
  ['opportunity_site', 'feasibility', 'acquisition'],
  ['design', 'approvals', 'procurement'],
  ['pre_construction', 'construction', 'testing_commissioning', 'completion'],
  ['handover', 'operations'],
];

const ORDER = STAGE_PHASES.flat();

export function stageLabel(key: string | undefined | null): string {
  if (!key) return '';
  return LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Where a stage falls in the lifecycle: the 8th of 12, say. Null for a stage this app does not know. */
export function stagePosition(key: string | undefined | null): { index: number; of: number } | null {
  const index = key ? ORDER.indexOf(key) : -1;
  return index < 0 ? null : { index, of: ORDER.length };
}

/** The stages where people are actually on site building. */
export function isBuildStage(key: string | undefined | null): boolean {
  return key === 'pre_construction' || key === 'construction' || key === 'testing_commissioning' || key === 'completion';
}
