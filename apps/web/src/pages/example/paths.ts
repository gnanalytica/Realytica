/**
 * Where a page of the example project lives.
 *
 * `/example` is the project as a whole, `/example/engineering` one
 * department's summary and `/example/engineering/site` one function. The
 * stage being looked at and the section to open ride in the query, so a link
 * from anywhere in the app lands on the exact part it means.
 */

export type ExampleStage = 'land' | 'pre' | 'build' | 'done';

/** The stage the example project is in. A link that names no stage means this one. */
export const EXAMPLE_STAGE_NOW: ExampleStage = 'build';

export const EXAMPLE_HOME = '/example';

export function examplePath(department?: string, fn?: string, at: { stage?: ExampleStage; part?: string } = {}): string {
  const path = [EXAMPLE_HOME, department, department && fn ? fn.toLowerCase() : undefined].filter(Boolean).join('/');
  const query = new URLSearchParams();
  if (at.stage && at.stage !== EXAMPLE_STAGE_NOW) query.set('stage', at.stage);
  if (at.part) query.set('part', at.part);
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * The example's page for each of the product's workstreams.
 *
 * The product names a workstream by a key (`finance.budget`); the example
 * names a function by its department and its word on the tab. Design's four
 * workstreams are one function there, inside Engineering.
 */
const EXAMPLE_FUNCTION: Record<string, readonly [department: string, fn: string]> = {
  'finance.valuation': ['finance', 'Valuation'],
  'finance.feasibility': ['finance', 'Feasibility'],
  'finance.budget': ['finance', 'Budget'],
  'finance.funding': ['finance', 'Funding'],
  'finance.tax': ['finance', 'Tax'],
  'legal.title': ['legal', 'Title'],
  'legal.approvals': ['legal', 'Approvals'],
  'legal.rera': ['legal', 'RERA'],
  'legal.contracts': ['legal', 'Contracts'],
  'legal.handover': ['legal', 'Handover'],
  'design.drawings': ['engineering', 'Design'],
  'design.compliance': ['engineering', 'Design'],
  'design.rfis': ['engineering', 'Design'],
  'design.coordination': ['engineering', 'Design'],
  'construction.progress': ['engineering', 'Progress'],
  'construction.quality': ['engineering', 'Technical'],
  'construction.site': ['engineering', 'Site'],
  'construction.safety': ['engineering', 'Safety'],
  'procurement.boq': ['procurement', 'Tenders'],
  'procurement.orders': ['procurement', 'Orders'],
  'procurement.vendors': ['procurement', 'Vendors'],
  'procurement.deliveries': ['procurement', 'Deliveries'],
  'commercial.market': ['commercial', 'Market'],
  'commercial.inventory': ['commercial', 'Sales'],
  'commercial.buyers': ['commercial', 'Collections'],
  'commercial.handover': ['commercial', 'Handover'],
  'commercial.operations': ['commercial', 'Operations'],
};

/** The example's department for one of the product's departments. Design is worked inside Engineering. */
const EXAMPLE_DEPARTMENT: Record<string, string> = {
  finance: 'finance',
  legal: 'legal',
  design: 'engineering',
  construction: 'engineering',
  procurement: 'procurement',
  commercial: 'commercial',
};

/** Where the example project shows the page a workstream will be. */
export function exampleOfWorkstream(key: string): string | undefined {
  const at = EXAMPLE_FUNCTION[key];
  return at ? examplePath(at[0], at[1]) : undefined;
}

/** Where the example project shows a department as a whole; its Design function for the Design department. */
export function exampleOfDepartment(key: string): string | undefined {
  if (key === 'design') return examplePath('engineering', 'Design');
  const department = EXAMPLE_DEPARTMENT[key];
  return department ? examplePath(department) : undefined;
}
