/**
 * How a project is organised: four stages, six departments, and the
 * workstreams inside each department.
 *
 * - A **stage** is the state of the property: Land, Pre-construction, Under
 *   construction, Completed. The menu shows these four and nothing under
 *   them; the finer lifecycle steps a project moves through are kept on its
 *   record and in its stage history.
 * - A **department** is what kind of work: Finance, Legal, Design,
 *   Construction, Procurement, Commercial. A firm switches departments on by
 *   default and a project can override that.
 * - A **workstream** is one ongoing piece of work inside a department, with a
 *   quick assessment, certified reports from named professionals, its checks
 *   and its records.
 * - The **menu** shows five of the six departments, by one word each, and
 *   calls a workstream a function. Design is one function inside Engineering.
 *   The graph draws the same five and the same functions.
 *
 * Every check in the library belongs to exactly one workstream, so the same
 * title check serves every engagement that needs it.
 */

import { LIFECYCLE_STAGE_LABEL } from './catalogs';
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
  { key: 'pre_development', label: 'Land', subStages: ['opportunity_site', 'feasibility', 'acquisition'] },
  { key: 'design_tender', label: 'Pre-construction', subStages: ['design', 'approvals', 'procurement'] },
  { key: 'construction', label: 'Under construction', subStages: ['pre_construction', 'construction', 'testing_commissioning', 'completion'] },
  { key: 'operations', label: 'Completed', subStages: ['handover', 'operations'] },
];

/** A step's name. One set of names for the twelve steps, kept with the steps themselves. */
export const SUB_STAGE_LABEL: Record<LifecycleStage, string> = LIFECYCLE_STAGE_LABEL;

/**
 * The step a project enters a stage by.
 *
 * People name stages ("move it to pre-construction"); the record keeps the
 * finer step. So a stage's name means this step of it: the first, except for
 * Under construction, which means the work itself and not the mobilising
 * before it.
 */
const STAGE_ENTRY: Record<StageKey, LifecycleStage> = {
  pre_development: 'opportunity_site',
  design_tender: 'design',
  construction: 'construction',
  operations: 'handover',
};

export function stageEntryStep(key: StageKey): LifecycleStage {
  return STAGE_ENTRY[key];
}

const STAGE_OF: Record<LifecycleStage, StageKey> = Object.fromEntries(
  STAGES.flatMap((s) => s.subStages.map((sub) => [sub, s.key])),
) as Record<LifecycleStage, StageKey>;

/** The macro stage a lifecycle stage sits in. */
export function stageOf(subStage: LifecycleStage): StageKey {
  return STAGE_OF[subStage] ?? 'pre_development';
}

/** "Pre-construction · Approvals", or just "Under construction" for the step that is the stage itself. */
export function stageAndStep(subStage: LifecycleStage): string {
  const stage = stageDefinition(stageOf(subStage)).label;
  if (subStage === 'construction') return stage;
  return `${stage} · ${SUB_STAGE_LABEL[subStage]}`;
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
    label: 'Engineering & Construction',
    purpose: 'The technical work: what is built or being built, its condition, progress, quality and safety.',
    professions: ['Project Manager', 'Site Engineer', 'Quantity Surveyor', 'Safety Officer'],
    status: 'live',
    workstreams: [
      ws('construction', 'progress', 'Progress & schedule', 'Milestones, the site log and how far along the work is.', 'live', ['Project Manager', 'Independent Engineer'], [
        ['design_tender', 'Baseline schedule'],
        ['construction', 'Progress report'],
      ]),
      ws('construction', 'quality', 'Technical due diligence', 'The documents, the questions, the site inspection and the observations: structure, services, fire safety and quality.', 'live', ['Structural Engineer', 'Independent Engineer'], [
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
/* The menu: five departments, and the functions inside each            */
/* ==================================================================== */

/** A department's name in the menu: one word. */
export const DEPARTMENT_SHORT: Record<DepartmentKey, string> = {
  finance: 'Finance',
  legal: 'Legal',
  design: 'Design',
  construction: 'Engineering',
  procurement: 'Procurement',
  commercial: 'Commercial',
};

/**
 * The departments of the menu, in the order a property is worked: is it
 * owned and allowed, does it pay, can it be built, will it sell, what is
 * bought for it.
 *
 * Five, not six: drawings and their compliance are engineering work, so
 * Design is a function inside Engineering rather than a department beside it.
 * The record underneath still keeps Design as its own department, with its
 * own people and roles.
 */
export const MENU_DEPARTMENTS: readonly DepartmentKey[] = ['legal', 'finance', 'construction', 'commercial', 'procurement'];

/** The menu department a department's pages sit under. */
export function menuDepartment(key: DepartmentKey): DepartmentKey {
  return key === 'design' ? 'construction' : key;
}

/**
 * The menu departments that stand for a set of switched-on departments.
 * Engineering is one of them while either it or Design is on, since Design
 * is reached through it. The graph draws these; the menu applies the same
 * rule in its own selector and is to be moved onto this.
 */
export function menuDepartmentsOf(enabled: readonly DepartmentKey[]): DepartmentKey[] {
  return MENU_DEPARTMENTS.filter((menu) => enabled.some((key) => menuDepartment(key) === menu));
}

/** A function's name on its tab: one word. */
export const FUNCTION_SHORT: Record<string, string> = {
  'finance.valuation': 'Valuation',
  'finance.feasibility': 'Feasibility',
  'finance.budget': 'Budget',
  'finance.funding': 'Funding',
  'finance.tax': 'Tax',
  'legal.title': 'Title',
  'legal.approvals': 'Approvals',
  'legal.rera': 'RERA',
  'legal.contracts': 'Contracts',
  'legal.handover': 'Handover',
  'construction.progress': 'Progress',
  'construction.quality': 'Technical',
  'construction.site': 'Site',
  'construction.safety': 'Safety',
  'procurement.boq': 'Tenders',
  'procurement.orders': 'Orders',
  'procurement.vendors': 'Vendors',
  'procurement.deliveries': 'Deliveries',
  'commercial.market': 'Market',
  'commercial.inventory': 'Sales',
  'commercial.buyers': 'Collections',
  'commercial.handover': 'Handover',
  'commercial.operations': 'Operations',
};

/** The key of the Design function: the design workstreams, together. */
const DESIGN_FUNCTION = 'design';

/**
 * The function a workstream belongs to in the menu.
 *
 * Every design workstream is the one function Design, under the key
 * `design`. Any other workstream is a function by itself, under its own key.
 */
export function functionKey(workstreamKey: string): string {
  return workstreamKey.startsWith('design.') ? DESIGN_FUNCTION : workstreamKey;
}

/**
 * The menu department a function sits under, from the function's key or the
 * key of a workstream it stands for: Engineering for Design, a workstream's
 * own department otherwise.
 *
 * It is what tells two functions apart where they are named side by side.
 * Legal and Commercial each have a Handover, so the one word is not a name
 * until the department is said with it ("Legal › Handover").
 */
export function functionDepartment(key: string): DepartmentKey | undefined {
  const own = key === DESIGN_FUNCTION ? 'design' : workstreamDefinition(key)?.department;
  return own ? menuDepartment(own) : undefined;
}

/** A function's word with its department's in front, the way the app writes a place: "Legal › Handover". */
export function withDepartment(key: string, word: string): string {
  const department = functionDepartment(key);
  return department ? `${DEPARTMENT_SHORT[department]} › ${word}` : word;
}

/**
 * One function of a menu department, as the graph draws it: one node each.
 * The menu shows the same functions as tabs from its own list in `rail.tsx`
 * and is to be moved onto this one.
 */
export interface MenuFunction {
  /** A workstream's own key, or `design` for the design workstreams together. */
  key: string;
  /** Its one word. */
  label: string;
  /** Its name in full, as the record has it. */
  name: string;
  /** One line: what it is for. */
  purpose: string;
  /** The department of the record its work is kept under. */
  department: DepartmentKey;
  /** The workstreams it stands for. */
  workstreams: string[];
  /** Whether any of it is built. */
  built: boolean;
}

/**
 * A menu department's functions, in menu order: for Engineering, Design
 * first and then its own. Asked of Design itself, it answers for Engineering,
 * the department its pages sit under.
 */
export function menuFunctions(menu: DepartmentKey): MenuFunction[] {
  const under = menuDepartment(menu);
  const own = departmentDefinition(under).workstreams.map((w) => ({
    key: w.key,
    label: FUNCTION_SHORT[w.key] ?? w.label,
    name: w.label,
    purpose: w.purpose,
    department: w.department,
    workstreams: [w.key],
    built: w.status === 'live',
  }));
  if (under !== menuDepartment('design')) return own;
  const design = departmentDefinition('design');
  return [
    {
      key: DESIGN_FUNCTION,
      label: DEPARTMENT_SHORT.design,
      name: design.label,
      purpose: design.purpose,
      department: design.key,
      workstreams: design.workstreams.map((w) => w.key),
      built: design.workstreams.some((w) => w.status === 'live'),
    },
    ...own,
  ];
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
  // The technical due diligence is engineering's own work: structure,
  // services and fire safety are inspected on the building, whoever drew it.
  'technical.fire_life_safety': 'construction.quality',
  'technical.structural': 'construction.quality',
  'technical.mep_capacity': 'construction.quality',
  'technical.constructability': 'construction.quality',
  'technical.as_built_architecture': 'construction.quality',
  'technical.structural_condition': 'construction.quality',
  'technical.services_condition': 'construction.quality',
  'technical.statutory_record': 'construction.quality',
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

/**
 * The workstream a department's questionnaires and observations are filed
 * under. Engineering's is the technical due diligence; every other
 * department's is its first live workstream.
 */
export function departmentHomeWorkstream(department: DepartmentKey): string | undefined {
  if (department === 'construction') return 'construction.quality';
  return DEPARTMENTS.find((d) => d.key === department)?.workstreams.find((w) => w.status === 'live')?.key;
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
