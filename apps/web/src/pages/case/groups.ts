import type { ComponentType } from 'react';
import { LENS_PROFILES, SITE_CONSTRAINT_KEYS, openTechnicalFindingCounts } from '@realytica/shared';
import type { LensKey, LensSection, PropertyCase, ScreenResult } from '@realytica/shared';
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
      { key: 'risks', label: 'Risks', component: RisksTab },
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
      { key: 'technical', label: 'Technical DD', component: TechnicalDiligenceTab },
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
    label: 'Legal',
    question: 'Is the title clean and the use lawful?',
    views: [
      { key: 'title', label: 'Title', component: TitleTab },
      { key: 'compliance', label: 'Compliance', component: ComplianceTab },
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
 * What a view has waiting in it, without opening it.
 *
 * The view rail was a row of unlabelled pills: nothing on it told a reader
 * that Site constraints had five unanswered questions or that Costs had
 * nothing in it at all, so finding out meant clicking through every view in
 * every group. A case is a document with sections, and the sections should
 * say what state they are in.
 *
 * `count` is a number worth acting on, never a total for its own sake — five
 * unanswered constraints is a prompt, fourteen compliance checks is
 * furniture. `empty` marks a view with genuinely nothing to show, which is
 * different from a view with nothing wrong: the first is a gap, the second is
 * an answer.
 */
export interface ViewState {
  count?: number;
  tone?: 'critical' | 'warning' | 'brand' | 'neutral';
  /** Shown as the chip's title attribute — the reason the count is there. */
  note?: string;
  empty?: boolean;
}

export function viewState(viewKey: string, caseData: PropertyCase, result: ScreenResult | null): ViewState {
  if (!result) return {};
  switch (viewKey) {
    case 'risks': {
      const open = result.risks.filter(r => r.status === 'open');
      const critical = open.filter(r => r.severity === 'critical').length;
      if (critical > 0) return { count: critical, tone: 'critical', note: `${critical} open critical risk${critical === 1 ? '' : 's'}` };
      return open.length > 0 ? { count: open.length, tone: 'warning', note: `${open.length} open risks` } : {};
    }
    case 'missing': {
      const n = result.completeness.missingCritical.length;
      return n > 0 ? { count: n, tone: 'warning', note: `${n} critical document${n === 1 ? '' : 's'} missing` } : {};
    }
    case 'location':
      return caseData.siteContext ? {} : { empty: true, note: 'No mapping provider has placed this property yet' };
    case 'technical': {
      const findings = caseData.technicalFindings ?? [];
      const proposed = findings.filter(f => f.reviewState === 'proposed').length;
      if (proposed > 0) return { count: proposed, tone: 'brand', note: `${proposed} drafted finding${proposed === 1 ? '' : 's'} awaiting review` };
      const counts = openTechnicalFindingCounts(findings);
      if (counts.openCritical > 0) return { count: counts.openCritical, tone: 'critical', note: `${counts.openCritical} open critical technical finding${counts.openCritical === 1 ? '' : 's'}` };
      if (counts.open > 0) return { count: counts.open, tone: 'warning', note: `${counts.open} open technical finding${counts.open === 1 ? '' : 's'}` };
      return {};
    }
    case 'costs':
      return result.transactionCosts
        ? {}
        : { empty: true, note: 'No State Pack could price the duty on this property' };
    case 'constraints': {
      const n = result.stateCompliance
        ? result.stateCompliance.checks.filter(c => c.verdict === 'unknown' && (SITE_CONSTRAINT_KEYS as string[]).includes(c.key)).length
        : 0;
      return n > 0 ? { count: n, tone: 'warning', note: `${n} constraint${n === 1 ? '' : 's'} nobody has answered` } : {};
    }
    case 'compliance': {
      const n = result.stateCompliance?.checks.filter(c => c.verdict === 'blocker').length ?? 0;
      return n > 0 ? { count: n, tone: 'critical', note: `${n} blocker${n === 1 ? '' : 's'}` } : {};
    }
    case 'title': {
      // Contradictions and chain breaks are both findings on the title, and
      // counting only contradictions left a case showing two chain breaks
      // wearing a clean chip. A break is the more common of the two and the
      // one more likely to stop a transaction, so it cannot be the one that
      // goes unbadged.
      const graph = result.titleGraph;
      if (!graph) return {};
      const contradictions = graph.contradictions.length;
      const breaks = graph.chains.reduce((sum, chain) => sum + chain.breaks.length, 0);
      const total = contradictions + breaks;
      if (total === 0) return {};
      const parts = [
        contradictions > 0 ? `${contradictions} contradiction${contradictions === 1 ? '' : 's'}` : null,
        breaks > 0 ? `${breaks} chain break${breaks === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      return { count: total, tone: contradictions > 0 ? 'critical' : 'warning', note: parts.join(' and ') };
    }
    case 'files':
      return caseData.documents.length === 0
        ? { empty: true, note: 'Nothing uploaded yet' }
        : { count: caseData.documents.length, tone: 'neutral', note: `${caseData.documents.length} on file` };
    case 'actions': {
      const n = result.actions.filter(a => !a.done).length;
      return n > 0 ? { count: n, tone: 'brand', note: `${n} still open` } : {};
    }
    default:
      return {};
  }
}

/**
 * Which group answers each lens section, so a lens's section order becomes a
 * group order. Several sections land in one group — that is expected: the
 * first of a lens's sections to name a group is what pulls that group
 * forward, and the rest are already there.
 */
const SECTION_GROUP: Record<LensSection, string> = {
  value: 'value',
  offer: 'value',
  costs: 'value',
  title: 'legal',
  compliance: 'legal',
  planning: 'legal',
  site: 'overview',
  constraints: 'legal',
  documents: 'documents',
  actions: 'report',
  risks: 'overview',
  evidence: 'documents',
};

/**
 * The five groups, ordered for one reader.
 *
 * Chat always leads and Overview always comes second, whatever the lens: the
 * conversation is the way into the case, and the overview is where a critical
 * finding is visible to everyone regardless of whose category it falls in.
 * Ordering those away would let a lens bury the one thing no lens may bury.
 * Everything after them follows the lens.
 */
export function groupsForLens(lens: LensKey): CaseGroup[] {
  const wanted = LENS_PROFILES[lens].sections.map(s => SECTION_GROUP[s]);
  const rest = CASE_GROUPS.filter(g => g.key !== 'overview');
  const ordered: CaseGroup[] = [];
  for (const key of wanted) {
    const group = rest.find(g => g.key === key);
    if (group && !ordered.includes(group)) ordered.push(group);
  }
  for (const g of rest) if (!ordered.includes(g)) ordered.push(g);
  const overview = CASE_GROUPS.find(g => g.key === 'overview');
  return overview ? [overview, ...ordered] : ordered;
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
