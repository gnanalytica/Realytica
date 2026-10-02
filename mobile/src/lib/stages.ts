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

export function stageLabel(key: string | undefined | null): string {
  if (!key) return '';
  return LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** The stages where people are actually on site building. */
export function isBuildStage(key: string | undefined | null): boolean {
  return key === 'pre_construction' || key === 'construction' || key === 'testing_commissioning' || key === 'completion';
}
