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
      { key: 'risks', label: 'Risks', component: RisksTab },
      { key: 'missing', label: "What's missing", component: CompletenessTab },
      // Location sits under Overview rather than in a group of its own: it is
      // context for "is this worth pursuing", not an answer in itself. It is
      // also the one view here that does not need a screen — a case with an
      // address can be placed on a map before anything has been run against
      // it, so it is deliberately absent from NEEDS_SCREEN below.
      { key: 'location', label: 'Location', component: LocationTab },
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
      { key: 'movers', label: 'What moves it', component: DriversTab },
    ],
  },
  {
    key: 'legal',
    label: 'Legal',
    question: 'Is the title clean and the use lawful?',
    views: [
      { key: 'title', label: 'Title', component: TitleTab },
      { key: 'compliance', label: 'Compliance', component: ComplianceTab },
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
export const NEEDS_SCREEN = new Set(['risks', 'missing', 'range', 'offer', 'movers', 'title', 'compliance', 'planning', 'evidence', 'report', 'actions']);

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
  planning: { group: 'legal', view: 'planning' },
  documents: { group: 'documents', view: 'files' },
  evidence: { group: 'documents', view: 'evidence' },
  report: { group: 'report', view: 'report' },
  actions: { group: 'report', view: 'actions' },
};
