/**
 * How a project is organised: four stages, six departments, and the
 * workstreams inside each department.
 *
 * - A **stage** is when: Pre-development, Design & Tender, Construction,
 *   Operations, each made of the finer lifecycle stages the project moves
 *   through.
 * - A **department** is what kind of work: Finance, Legal, Design,
 *   Construction, Procurement, Commercial. A firm switches departments on by
 *   default and a project can override that.
 * - A **workstream** is one ongoing piece of work inside a department, with a
 *   quick assessment, certified reports from named professionals, its checks
 *   and its records.
 *
 * Every check in the library belongs to exactly one workstream, so the same
 * title check serves every engagement that needs it.
 */

import type { DdProject, LifecycleStage } from './types';

/* ==================================================================== */
/* Stages                                                                */
/* ==================================================================== */

export type StageKey = 'pre_development' | 'design_tender' | 'construction' | 'operations';

export interface StageDefinition {
  key: StageKey;
  label: string;
  subStages: LifecycleStage[];
}

export const STAGES: readonly StageDefinition[] = [
  { key: 'pre_development', label: 'Pre-development', subStages: ['opportunity_site', 'feasibility', 'acquisition'] },
  { key: 'design_tender', label: 'Design & Tender', subStages: ['design', 'approvals', 'procurement'] },
  { key: 'construction', label: 'Construction', subStages: ['pre_construction', 'construction', 'testing_commissioning', 'completion'] },
  { key: 'operations', label: 'Operations', subStages: ['handover', 'operations'] },
];

export const SUB_STAGE_LABEL: Record<LifecycleStage, string> = {
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

const STAGE_OF: Record<LifecycleStage, StageKey> = Object.fromEntries(
  STAGES.flatMap((s) => s.subStages.map((sub) => [sub, s.key])),
) as Record<LifecycleStage, StageKey>;

/** The macro stage a lifecycle stage sits in. */
export function stageOf(subStage: LifecycleStage): StageKey {
  return STAGE_OF[subStage] ?? 'pre_development';
}

export function stageDefinition(key: StageKey): StageDefinition {
  return STAGES.find((s) => s.key === key)!;
}

/** Every lifecycle stage, in order. */
export const SUB_STAGES: readonly LifecycleStage[] = STAGES.flatMap((s) => s.subStages);

/** The project's own stage changes, oldest first. */
function projectStageHistory(project: DdProject) {
  return (project.stageHistory ?? [])
    .filter((s) => s.subject === 'project')
    .slice()
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
}

/** The lifecycle stage the project was at at a moment. Before its first recorded change, the first stage it had. */
export function stageAt(project: DdProject, at: string): LifecycleStage {
  const history = projectStageHistory(project);
  let stage = history[0]?.previousStage ?? history[0]?.stage ?? project.currentStage;
  for (const entry of history) {
    if (entry.effectiveAt <= at) stage = entry.stage;
    else break;
  }
  return stage;
}

export type TimelineStatus = 'done' | 'current' | 'ahead';

export interface TimelineSubStage {
  key: LifecycleStage;
  label: string;
  status: TimelineStatus;
  /** When the project last entered it. */
  since?: string;
}

export interface TimelineStage {
  key: StageKey;
  label: string;
  status: TimelineStatus;
  subStages: TimelineSubStage[];
}

/** A phase or block of the project sitting at its own stage. */
export interface TimelineMarker {
  assetId: string;
  name: string;
  stage: LifecycleStage;
}

export interface StageTimeline {
  current: LifecycleStage;
  currentStage: StageKey;
  stages: TimelineStage[];
  markers: TimelineMarker[];
}

/** The four stages and their steps, with where the project and each of its phases stand. */
export function stageTimeline(project: DdProject): StageTimeline {
  const current = project.currentStage;
  const at = SUB_STAGES.indexOf(current);
  const entered = new Map<LifecycleStage, string>();
  for (const entry of projectStageHistory(project)) entered.set(entry.stage, entry.effectiveAt);
  if (!entered.has(current)) entered.set(current, project.createdAt);
  const statusOf = (i: number): TimelineStatus => (i < at ? 'done' : i === at ? 'current' : 'ahead');
  const stages = STAGES.map((stage) => {
    const subStages = stage.subStages.map((key) => ({
      key,
      label: SUB_STAGE_LABEL[key],
      status: statusOf(SUB_STAGES.indexOf(key)),
      ...(entered.has(key) ? { since: entered.get(key)! } : {}),
    }));
    const status: TimelineStatus = subStages.some((s) => s.status === 'current') ? 'current' : subStages.every((s) => s.status === 'done') ? 'done' : 'ahead';
    return { key: stage.key, label: stage.label, status, subStages };
  });
  const markers = (project.assets ?? [])
    .filter((a) => !a.parentId && a.currentStage)
    .map((a) => ({ assetId: a.id, name: a.name, stage: a.currentStage }));
  return { current, currentStage: stageOf(current), stages, markers };
}

/* ==================================================================== */
/* Departments and workstreams                                           */
/* ==================================================================== */

export type DepartmentKey = 'finance' | 'legal' | 'design' | 'construction' | 'procurement' | 'commercial';

export const DEPARTMENT_KEYS: readonly DepartmentKey[] = ['finance', 'legal', 'design', 'construction', 'procurement', 'commercial'];

/** Built and in use, or listed with what it will hold. */
export type BuildStatus = 'live' | 'coming_soon';

export interface WorkstreamDefinition {
  key: string;
  department: DepartmentKey;
  label: string;
  /** One line: what this workstream is for. */
  purpose: string;
  /** What it produces, stage by stage. */
  deliverables: Array<{ stage: StageKey; title: string }>;
  /** The professions that sign its certified reports. */
  signers: string[];
  status: BuildStatus;
}

export interface DepartmentDefinition {
  key: DepartmentKey;
  label: string;
  purpose: string;
  professions: string[];
  status: BuildStatus;
  workstreams: WorkstreamDefinition[];
}

function ws(
  department: DepartmentKey,
  slug: string,
  label: string,
  purpose: string,
  status: BuildStatus,
  signers: string[],
  deliverables: Array<[StageKey, string]>,
): WorkstreamDefinition {
  return { key: `${department}.${slug}`, department, label, purpose, status, signers, deliverables: deliverables.map(([stage, title]) => ({ stage, title })) };
}

export const DEPARTMENTS: readonly DepartmentDefinition[] = [
  {
    key: 'finance',
    label: 'Finance & Investment',
    purpose: 'Whether the project pays: what it is worth, what it costs, how it is funded and taxed.',
    professions: ['CFO', 'Chartered Accountant', 'Underwriter', 'Investment Analyst', 'Registered Valuer'],
    status: 'live',
    workstreams: [
      ws('finance', 'valuation', 'Valuation', 'What the site, the project or a phase is worth, and what moves it.', 'live', ['Registered Valuer'], [
        ['pre_development', 'Indicative valuation and screening'],
        ['design_tender', 'As-completed value'],
        ['construction', 'As-is value'],
        ['operations', 'Market value as is'],
      ]),
      ws('finance', 'feasibility', 'Feasibility & underwriting', 'Land cost, construction outlay, revenue and returns.', 'coming_soon', ['Chartered Accountant', 'Underwriter'], [
        ['pre_development', 'Techno-economic feasibility report'],
        ['operations', 'Realised return reconciliation'],
      ]),
      ws('finance', 'budget', 'Budget & cost to complete', 'Budget against committed and actual cost, and what is left to spend.', 'coming_soon', ['Quantity Surveyor', 'Chartered Accountant'], [
        ['design_tender', 'Approved budget'],
        ['construction', 'Cost-to-complete statement'],
      ]),
      ws('finance', 'funding', 'Funding & escrow', 'Capital calls, loans and the RERA escrow account.', 'coming_soon', ['Chartered Accountant'], [
        ['design_tender', 'Drawdown plan'],
        ['construction', 'Escrow utilisation statement'],
      ]),
      ws('finance', 'tax', 'Tax', 'GST and input tax credit.', 'coming_soon', ['Chartered Accountant'], [['construction', 'GST reconciliation']]),
    ],
  },
  {
    key: 'legal',
    label: 'Legal & Compliance',
    purpose: 'Whether the land is owned clean and the project is allowed: title, approvals and RERA.',
    professions: ['Real Estate Advocate', 'RERA Consultant', 'Liaison Officer', 'Environmental Consultant'],
    status: 'live',
    workstreams: [
      ws('legal', 'title', 'Title & land records', 'Who owns the land, how they came to, and what is charged against it.', 'live', ['Advocate'], [
        ['pre_development', 'Title search and opinion'],
        ['operations', 'Conveyance to the society'],
      ]),
      ws('legal', 'approvals', 'Approvals & NOCs', 'Every sanction, clearance and NOC the project needs, with its validity.', 'live', ['Liaison Officer', 'Architect'], [
        ['design_tender', 'Approvals and NOC status'],
        ['construction', 'Commencement and conditions log'],
        ['operations', 'Occupancy certificate'],
      ]),
      ws('legal', 'rera', 'RERA', 'Registration, quarterly progress reports and escrow compliance.', 'coming_soon', ['RERA Consultant', 'Chartered Accountant'], [
        ['design_tender', 'RERA registration'],
        ['construction', 'Quarterly progress report'],
      ]),
      ws('legal', 'contracts', 'Contracts & disputes', 'JDAs, agreements for sale and litigation.', 'coming_soon', ['Advocate'], [['pre_development', 'Development agreement review']]),
      ws('legal', 'handover', 'Handover & society', 'Conveying common areas and the land to the owners’ society.', 'coming_soon', ['Advocate'], [['operations', 'Deed of conveyance']]),
    ],
  },
  {
    key: 'design',
    label: 'Design & Architecture',
    purpose: 'What will be built: drawings, their versions, and whether they fit the approvals.',
    professions: ['Architect', 'Structural Engineer', 'MEP Engineer', 'BIM Coordinator'],
    status: 'coming_soon',
    workstreams: [
      ws('design', 'drawings', 'Drawings & versions', 'The drawing register and what is issued for construction.', 'coming_soon', ['Architect'], [['construction', 'Drawing release log']]),
      ws('design', 'compliance', 'Design compliance', 'FAR, setbacks and height against the approvals.', 'coming_soon', ['Architect'], [['design_tender', 'FAR and setback compliance']]),
      ws('design', 'rfis', 'RFIs', 'Questions from site and their answers.', 'coming_soon', ['Architect', 'Structural Engineer'], [['construction', 'RFI log']]),
      ws('design', 'coordination', 'Coordination', 'Structure and services fitting together.', 'coming_soon', ['Structural Engineer', 'MEP Engineer'], [['design_tender', 'Clash log']]),
    ],
  },
  {
    key: 'construction',
    label: 'Construction & Execution',
    purpose: 'What is being built on site: progress, quality and safety.',
    professions: ['Project Manager', 'Site Engineer', 'Quantity Surveyor', 'Safety Officer'],
    status: 'live',
    workstreams: [
      ws('construction', 'progress', 'Progress & schedule', 'Milestones, the site log and how far along the work is.', 'live', ['Project Manager', 'Independent Engineer'], [
        ['design_tender', 'Baseline schedule'],
        ['construction', 'Progress report'],
      ]),
      ws('construction', 'quality', 'Quality & inspections', 'Inspections, tests, defects and the technical due diligence.', 'live', ['Structural Engineer', 'Independent Engineer'], [
        ['pre_development', 'Geotechnical and site assessment'],
        ['construction', 'Technical due diligence'],
        ['operations', 'Snag list'],
      ]),
      ws('construction', 'site', 'Site record', 'Visits, photographs and what the site is next to.', 'live', ['Site Engineer'], [['construction', 'Site visit record']]),
      ws('construction', 'safety', 'Safety & environment', 'Permits, incidents, training, waste and complaints.', 'coming_soon', ['Safety Officer'], [['construction', 'Safety log']]),
    ],
  },
  {
    key: 'procurement',
    label: 'Procurement & Supply Chain',
    purpose: 'What is bought for the project, from whom, and when it arrives.',
    professions: ['Purchase Manager', 'Quantity Surveyor', 'Logistics Coordinator'],
    status: 'coming_soon',
    workstreams: [
      ws('procurement', 'boq', 'BOQ & tenders', 'Quantities and the bids against them.', 'coming_soon', ['Quantity Surveyor'], [['design_tender', 'Tender comparison']]),
      ws('procurement', 'orders', 'Purchase orders & commitments', 'Orders placed and the money they commit.', 'coming_soon', ['Purchase Manager'], [['construction', 'Commitment ledger']]),
      ws('procurement', 'vendors', 'Vendors', 'Who supplies the project, their contracts and securities.', 'coming_soon', ['Purchase Manager'], [['design_tender', 'Vendor register']]),
      ws('procurement', 'deliveries', 'Deliveries & materials', 'What is due on site and when.', 'coming_soon', ['Logistics Coordinator'], [['construction', 'Delivery tracker']]),
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial & Operations',
    purpose: 'Selling or leasing the units, handing them over, and running the property.',
    professions: ['Head of Sales', 'Leasing Broker', 'Property Manager', 'Facility Manager'],
    status: 'coming_soon',
    workstreams: [
      ws('commercial', 'market', 'Market & pricing', 'The micro-market, comparables and the price list.', 'coming_soon', ['Registered Valuer'], [['pre_development', 'Market and pricing benchmark']]),
      ws('commercial', 'inventory', 'Sales & leasing inventory', 'Every unit and where it stands.', 'coming_soon', [], [['construction', 'Inventory status']]),
      ws('commercial', 'buyers', 'Buyers & collections', 'Bookings, demands and what has been collected.', 'coming_soon', ['Chartered Accountant'], [['construction', 'Collections ageing']]),
      ws('commercial', 'handover', 'Handover & defects', 'Walkthroughs, handover and the defect liability period.', 'coming_soon', [], [['operations', 'Handover and defect log']]),
      ws('commercial', 'operations', 'Property management', 'Running the finished property: maintenance, tenants and condition.', 'coming_soon', ['Facility Manager'], [['operations', 'Condition and maintenance report']]),
    ],
  },
];

export const WORKSTREAMS: readonly WorkstreamDefinition[] = DEPARTMENTS.flatMap((d) => d.workstreams);

const WORKSTREAM_BY_KEY = new Map(WORKSTREAMS.map((w) => [w.key, w]));
const DEPARTMENT_BY_KEY = new Map(DEPARTMENTS.map((d) => [d.key, d]));

export function departmentDefinition(key: DepartmentKey): DepartmentDefinition {
  return DEPARTMENT_BY_KEY.get(key)!;
}

export function workstreamDefinition(key: string): WorkstreamDefinition | undefined {
  return WORKSTREAM_BY_KEY.get(key);
}

/* ==================================================================== */
/* Which workstream a check belongs to                                   */
/* ==================================================================== */

/**
 * Every check in the library, placed in its workstream. A check belongs to
 * one workstream; an engagement that needs it draws on that one copy.
 */
const CHECK_WORKSTREAM: Record<string, string> = {
  'land_site.parcel_identification': 'legal.title',
  'land_site.boundary_match': 'legal.title',
  'land_site.access': 'legal.title',
  'legal.title_chain': 'legal.title',
  'legal.encumbrances': 'legal.title',
  'legal.litigation': 'legal.title',
  'legal.third_party_rights': 'legal.title',
  'legal.development_rights': 'legal.contracts',
  'regulatory.land_use': 'legal.approvals',
  'regulatory.sanction': 'legal.approvals',
  'regulatory.conditions': 'legal.approvals',
  'regulatory.nocs': 'legal.approvals',
  'regulatory.occupancy': 'legal.approvals',
  'esg.clearance': 'legal.approvals',
  'technical.drawing_register': 'design.drawings',
  'technical.fire_life_safety': 'design.compliance',
  'technical.structural': 'design.coordination',
  'technical.mep_capacity': 'design.coordination',
  'technical.constructability': 'design.coordination',
  'schedule_progress.baseline': 'construction.progress',
  'schedule_progress.milestones': 'construction.progress',
  'schedule_progress.planned_vs_actual': 'construction.progress',
  'schedule_progress.delays': 'construction.progress',
  'schedule_progress.forecast_completion': 'construction.progress',
  'quality.inspections': 'construction.quality',
  'quality.testing': 'construction.quality',
  'quality.ncrs': 'construction.quality',
  'quality.recurrence': 'construction.quality',
  'land_site.geotech': 'construction.quality',
  'land_site.flood_drainage': 'construction.site',
  'land_site.constraints': 'construction.site',
  'land_site.utilities': 'construction.site',
  'hse.permits': 'construction.safety',
  'hse.incidents': 'construction.safety',
  'hse.training': 'construction.safety',
  'hse.emergency': 'construction.safety',
  'esg.waste': 'construction.safety',
  'esg.community': 'construction.safety',
  'cost_quantity.budget_current': 'finance.budget',
  'cost_quantity.commitments': 'finance.budget',
  'cost_quantity.variations': 'finance.budget',
  'cost_quantity.forecast': 'finance.budget',
  'cost_quantity.boq_alignment': 'procurement.boq',
  'procurement.award_completeness': 'procurement.orders',
  'procurement.claims': 'procurement.orders',
  'procurement.security': 'procurement.vendors',
  'financial_appraisal.revenue_assumptions': 'finance.feasibility',
  'financial_appraisal.cost_assumptions': 'finance.feasibility',
  'financial_appraisal.margin': 'finance.feasibility',
  'financial_appraisal.sensitivity': 'finance.feasibility',
  'commercial_market.comps': 'commercial.market',
  'commercial_market.product_fit': 'commercial.market',
  'commercial_market.absorption': 'commercial.market',
  'commercial_market.location': 'commercial.market',
  'condition_operations.survey': 'commercial.operations',
  'condition_operations.maintenance': 'commercial.operations',
  'condition_operations.warranties': 'commercial.handover',
};

/** The workstream a check definition belongs to. Valuation checks all sit in Finance › Valuation. */
export function workstreamOfCheck(definitionId: string): string {
  if (definitionId.startsWith('indicative_valuation.')) return 'finance.valuation';
  return CHECK_WORKSTREAM[definitionId] ?? 'legal.title';
}

/** The library scopes holding any check in these workstreams. */
export function scopesOfWorkstreams(workstreams: readonly string[]): string[] {
  const scopes = new Set<string>();
  for (const id of Object.keys(CHECK_WORKSTREAM)) {
    if (workstreams.includes(workstreamOfCheck(id))) scopes.add(id.split('.')[0]!);
  }
  if (workstreams.includes('finance.valuation')) scopes.add('indicative_valuation');
  return [...scopes].sort();
}

/** The library scopes whose checks sit in any of these departments. */
export function scopesOfDepartments(departments: readonly DepartmentKey[]): string[] {
  const scopes = new Set<string>();
  for (const id of Object.keys(CHECK_WORKSTREAM)) {
    const ws = workstreamOfCheck(id);
    if (departments.includes(ws.split('.')[0] as DepartmentKey)) scopes.add(id.split('.')[0]!);
  }
  if (departments.includes('finance')) scopes.add('indicative_valuation');
  return [...scopes].sort();
}

export function checkDefinitionsIn(workstream: string, definitionIds: readonly string[]): string[] {
  return definitionIds.filter((id) => workstreamOfCheck(id) === workstream);
}

/* ==================================================================== */
/* Roles                                                                 */
/* ==================================================================== */

/**
 * What a person may do in one department of one project.
 *
 * - lead: runs the department here — edits, accepts proposals, owns deadlines
 * - contributor: adds documents, records and site entries
 * - signer: a named professional who certifies the department's reports
 * - viewer: reads
 */
export type DepartmentRole = 'lead' | 'contributor' | 'signer' | 'viewer';

export const DEPARTMENT_ROLES: readonly DepartmentRole[] = ['lead', 'contributor', 'signer', 'viewer'];

export const DEPARTMENT_ROLE_LABEL: Record<DepartmentRole, string> = {
  lead: 'Lead',
  contributor: 'Contributor',
  signer: 'Signer',
  viewer: 'Viewer',
};

export const DEPARTMENT_ROLE_HINT: Record<DepartmentRole, string> = {
  lead: 'Runs the department on this project: edits, accepts what is proposed, owns its deadlines.',
  contributor: 'Adds documents, records and site entries.',
  signer: 'A named professional who certifies this department’s reports.',
  viewer: 'Reads.',
};

/** Whether a role may change the department's records. */
export function roleCanEdit(role: DepartmentRole | undefined): boolean {
  return role === 'lead' || role === 'contributor' || role === 'signer';
}

/** Whether a role may accept proposals and settle disagreements. */
export function roleCanDecide(role: DepartmentRole | undefined): boolean {
  return role === 'lead' || role === 'signer';
}

/** The departments a firm switches on for a new project, unless it says otherwise. */
export const DEFAULT_DEPARTMENTS: readonly DepartmentKey[] = DEPARTMENT_KEYS;
