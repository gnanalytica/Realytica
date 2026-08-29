import type { ComponentType } from 'react';
import type { TabProps } from './tab-props';
import SnapshotTab from './tabs/SnapshotTab';
import OfferTab from './tabs/OfferTab';
import LocationTab from './tabs/LocationTab';
import DocumentsTab from './tabs/DocumentsTab';
import ValuationTab from './tabs/ValuationTab';
import DriversTab from './tabs/DriversTab';
import RisksTab from './tabs/RisksTab';
import ComplianceTab from './tabs/ComplianceTab';
import TitleTab from './tabs/TitleTab';
import PlanningTab from './tabs/PlanningTab';
import CompletenessTab from './tabs/CompletenessTab';
import EvidenceTab from './tabs/EvidenceTab';
import ActionsTab from './tabs/ActionsTab';
import ReportTab from './tabs/ReportTab';
import ConstraintsTab from './tabs/ConstraintsTab';
import CostsTab from './tabs/CostsTab';
import ResearchTab from './tabs/ResearchTab';
import TechnicalDiligenceTab from './tabs/TechnicalDiligenceTab';

/**
 * Five places instead of fourteen.
 *
 * The fourteen tabs were named after the parts of the engine that produced
 * them — Drivers, Completeness, Evidence — which is a map of our own
 * architecture rather than of anything the person reading it wants to know.
 * These five are named after the questions a buyer actually asks, and each one
 * groups the views that answer it.
 *
 * Nothing was rewritten. Every panel is the component that already existed;
 * only the grouping and the words changed. A group with more than one view
 * shows a secondary control, so the top level stays at five while nothing
 * becomes unreachable and no page turns into a two-thousand-line scroll.
 */
export interface CaseView {
  key: string;
  label: string;
  component: ComponentType<TabProps>;
}

export interface CaseGroup {
  key: string;
  label: string;
  /** The question this group answers, for the empty state and the chat's own links. */
  question: string;
  views: CaseView[];
}

export const CASE_GROUPS: CaseGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    question: 'Is this worth pursuing, and what is wrong with it?',
    views: [
      { key: 'summary', label: 'Summary', component: SnapshotTab },
      { key: 'risks', label: 'Risk register', component: RisksTab },
      { key: 'missing', label: "What's missing", component: CompletenessTab },
      // Location sits under Overview rather than in a group of its own: it is
      // context for "is this worth pursuing", not an answer in itself. It is
      // also the one view here that does not need a screen — a case with an
      // address can be placed on a map before anything has been run against
      // it, so it is deliberately absent from NEEDS_SCREEN below.
      { key: 'location', label: 'Location', component: LocationTab },
      // What has been looked for outside Realytica, and what we are allowed
      // to look for. Under Overview because "is this worth pursuing" is
      // exactly the question an outside record answers or ruins.
      { key: 'research', label: 'Outside record', component: ResearchTab },
      // Building condition is a different axis from title/value/planning —
      // it does not fit Legal, Value or Documents — but it is squarely
      // "what is wrong with it", so it lands here rather than earning a
      // sixth group. Opt-in: most cases have nothing here, which is why it
      // is not in NEEDS_SCREEN below — it does not depend on a screen run.
      { key: 'technical', label: 'Building condition', component: TechnicalDiligenceTab },
    ],
  },
  {
    key: 'value',
    label: 'Value',
    question: 'What is it worth, and what moves that?',
    views: [
      { key: 'range', label: 'Range', component: ValuationTab },
      // "What to offer" sits second, not last. A range is the input to a
      // decision and this is the decision; burying it behind the drivers
      // would put the working above the answer.
      { key: 'offer', label: 'What to offer', component: OfferTab },
      // Acquisition costs used to sit at the bottom of the compliance view,
      // thirteen thousand pixels of title checks below the fold. A reader
      // asking what this costs all-in is asking a money question.
      { key: 'costs', label: 'Costs to buy', component: CostsTab },
      { key: 'movers', label: 'What moves it', component: DriversTab },
    ],
  },
  {
    key: 'legal',
    /*
     * "Title & use", not "Legal" — Legal is also one of the eight DD
     * departments, and while the two shells were separate that collision was
     * invisible. In one rail they sit eight rows apart with the same word
     * meaning two different things: this is the screening analysis of the
     * title and what may lawfully be built on it; the department is where
     * legal diligence is worked. The KEY stays `legal` so every link already
     * pasted somewhere still resolves.
     */
    label: 'Title & use',
    question: 'Is the title clean and the use lawful?',
    views: [
      { key: 'title', label: 'Title', component: TitleTab },
      { key: 'compliance', label: 'Lawful use', component: ComplianceTab },
      // Answering the constraint declarations and reading the findings they
      // produce are two different activities. Stacked in one view, a reader
      // browsing findings scrolled through a form and a reader filling in the
      // form scrolled through findings.
      { key: 'constraints', label: 'Site constraints', component: ConstraintsTab },
      { key: 'planning', label: 'Planning', component: PlanningTab },
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    question: 'What do I have, and what does it prove?',
    views: [
      { key: 'files', label: 'Files', component: DocumentsTab },
      { key: 'evidence', label: 'Evidence', component: EvidenceTab },
    ],
  },
  {
    key: 'report',
    label: 'Report',
    question: 'What do I send, and what do I do next?',
    views: [
      { key: 'report', label: 'Report', component: ReportTab },
      { key: 'actions', label: 'Next steps', component: ActionsTab },
    ],
  },
];

/** Views whose content is meaningless before the case has been screened once. */
export const NEEDS_SCREEN = new Set(['risks', 'missing', 'range', 'offer', 'costs', 'movers', 'title', 'compliance', 'constraints', 'planning', 'evidence', 'report', 'actions']);

export function findGroup(key: string | undefined): CaseGroup | undefined {
  return CASE_GROUPS.find(g => g.key === key);
}

/**
 * Old links keep working.
 *
 * Every one of the fourteen tab keys was a real URL people may have open in a
 * tab or pasted into a message, so each maps to the group and view that
 * absorbed it rather than 404ing or silently landing on the overview.
 */
export const LEGACY_TAB_REDIRECT: Record<string, { group: string; view: string }> = {
  snapshot: { group: 'overview', view: 'summary' },
  risks: { group: 'overview', view: 'risks' },
  completeness: { group: 'overview', view: 'missing' },
  valuation: { group: 'value', view: 'range' },
  drivers: { group: 'value', view: 'movers' },
  title: { group: 'legal', view: 'title' },
  compliance: { group: 'legal', view: 'compliance' },
  research: { group: 'overview', view: 'research' },
  // Split out of Compliance; the bare keys are what in-app links pass to
  // `goToTab`, and they resolve here rather than 404ing to the overview.
  constraints: { group: 'legal', view: 'constraints' },
  costs: { group: 'value', view: 'costs' },
  planning: { group: 'legal', view: 'planning' },
  documents: { group: 'documents', view: 'files' },
  evidence: { group: 'documents', view: 'evidence' },
  report: { group: 'report', view: 'report' },
  actions: { group: 'report', view: 'actions' },
};
