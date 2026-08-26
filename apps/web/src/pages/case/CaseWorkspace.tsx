import { useCallback, useMemo, useState } from 'react';
import UnitToggle from '../../components/UnitToggle';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckSquare,
  FileBarChart2,
  Files,
  FolderSearch,
  GitBranch,
  Landmark,
  LayoutDashboard,
  ListChecks,
  MapPinned,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import {
  CASE_STATUS_LABEL,
  PROPERTY_TYPE_LABEL,
  VERDICT_LABEL,
  confidenceTone,
  money,
  relativeTime,
  titleCase,
  verdictTone,
} from '../../lib/format';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Skeleton,
  Tabs,
  useToast,
  type TabDef,
} from '../../components/ui/kit';
import type { TabProps } from './tab-props';

import SnapshotTab from './tabs/SnapshotTab';
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
import IntelligenceTab from './tabs/IntelligenceTab';

const TAB_KEYS = [
  'snapshot',
  'documents',
  'valuation',
  'drivers',
  'risks',
  'title',
  'compliance',
  'planning',
  'completeness',
  'evidence',
  'actions',
  'report',
  'intelligence',
] as const;

type TabKey = (typeof TAB_KEYS)[number];

/** Tabs whose content is meaningless before the case has been screened at least once. */
const ANALYSIS_TABS = new Set<TabKey>([
  'valuation',
  'drivers',
  'risks',
  'title',
  'compliance',
  'planning',
  'completeness',
  'evidence',
  'actions',
  'report',
]);

/**
 * Shared "not screened yet" state for every analysis tab. Explains what running
 * the screen produces and offers the same primary action as the header button —
 * a user should never land on a dead end.
 */
function NotScreenedYet({ running, onRun }: { running: boolean; onRun: () => void }) {
  return (
    <div className="flex items-center justify-center py-16">
      <EmptyState
        icon={<LayoutDashboard size={28} />}
        title="Not screened yet"
        description="Run the screen to generate an indicative value range, value drivers, market comparables, risk flags, planning position, completeness and confidence scoring, evidence traceability and recommended actions — all built from the documents and identity captured for this case."
        action={
          <Button variant="primary" icon={<RefreshCw size={14} />} loading={running} onClick={onRun}>
            Run screen
          </Button>
        }
      />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="border-b border-hairline px-6 py-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-72" />
      <Skeleton className="mt-2 h-3 w-96" />
    </div>
  );
}

export default function CaseWorkspace() {
  const { caseId, tab } = useParams<{ caseId: string; tab?: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  const { data: caseData, error, loading, refresh } = useAsync(() => api.getCase(caseId as string), [caseId]);

  const activeTab: TabKey = (TAB_KEYS as readonly string[]).includes(tab ?? '') ? (tab as TabKey) : 'snapshot';

  const goToTab = useCallback(
    (key: string) => {
      if (!caseId) return;
      navigate(`/cases/${caseId}/${key}`, { replace: true });
    },
    [caseId, navigate],
  );

  const runScreen = useCallback(async () => {
    if (!caseId) return;
    setRunning(true);
    try {
      await api.runScreen(caseId);
      await refresh();
      toast('Screen completed — results updated.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to run the screen.', 'critical');
    } finally {
      setRunning(false);
    }
  }, [caseId, refresh, toast]);

  const result = caseData?.result ?? null;

  const tabDefs: TabDef[] = useMemo(() => {
    const openCriticalRisks = result?.risks.filter((r) => r.severity === 'critical' && r.status === 'open').length ?? 0;
    const openActions = result?.actions.filter((a) => !a.done).length ?? 0;
    // Unknown until screened (show the tab so it isn't a hidden surprise); once
    // screened, hide it when no State Pack covers this property's state.
    const showCompliance = !result || Boolean(result.stateCompliance);
    const blockerCount = result?.stateCompliance?.checks.filter((c) => c.verdict === 'blocker').length ?? 0;
    // Chain breaks and contradictions together: both are title defects, and a
    // user deciding whether to open the tab does not care which kind they are.
    const titleFindings = result?.titleGraph
      ? result.titleGraph.contradictions.length
        + result.titleGraph.chains.reduce((n, c) => n + c.breaks.length, 0)
      : 0;
    return [
      { key: 'snapshot', label: 'Snapshot', icon: <LayoutDashboard size={13} /> },
      {
        key: 'documents',
        label: 'Documents',
        icon: <Files size={13} />,
        badge: caseData ? <Badge tone="neutral">{caseData.documents.length}</Badge> : undefined,
      },
      { key: 'valuation', label: 'Valuation', icon: <Landmark size={13} /> },
      { key: 'drivers', label: 'Drivers', icon: <Waypoints size={13} /> },
      {
        key: 'risks',
        label: 'Risks',
        icon: <ShieldAlert size={13} />,
        badge: openCriticalRisks > 0 ? <Badge tone="critical">{openCriticalRisks}</Badge> : undefined,
      },
      {
        key: 'title',
        label: 'Title',
        icon: <GitBranch size={13} />,
        badge: titleFindings > 0 ? <Badge tone="warning">{titleFindings}</Badge> : undefined,
      },
      ...(showCompliance
        ? [
            {
              key: 'compliance',
              label: 'Compliance',
              icon: <ScrollText size={13} />,
              badge: blockerCount > 0 ? <Badge tone="critical">{blockerCount}</Badge> : undefined,
            },
          ]
        : []),
      { key: 'planning', label: 'Planning', icon: <MapPinned size={13} /> },
      {
        key: 'completeness',
        label: 'Completeness',
        icon: <ListChecks size={13} />,
        badge: result ? <Badge tone="neutral">{result.completeness.score}</Badge> : undefined,
      },
      {
        key: 'evidence',
        label: 'Evidence',
        icon: <FolderSearch size={13} />,
        badge: result ? <Badge tone="neutral">{result.evidence.length}</Badge> : undefined,
      },
      {
        key: 'actions',
        label: 'Actions',
        icon: <CheckSquare size={13} />,
        badge: openActions > 0 ? <Badge tone="brand">{openActions}</Badge> : undefined,
      },
      { key: 'report', label: 'Report', icon: <FileBarChart2 size={13} /> },
      {
        key: 'intelligence',
        label: 'Intelligence',
        icon: <Sparkles size={13} />,
        badge: caseData?.intelligence?.runs.length ? <Badge tone="neutral">{caseData.intelligence.runs.length}</Badge> : undefined,
      },
    ];
  }, [caseData, result]);

  if (loading && !caseData) {
    return (
      <div>
        <HeaderSkeleton />
        <div className="p-6">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    const notFound = error.toLowerCase().includes('not found');
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <Callout tone="critical" title={notFound ? 'Case not found' : 'Could not load this case'}>
          {notFound
            ? "This case doesn't exist, or may have been deleted."
            : error}
        </Callout>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
        >
          <ArrowLeft size={14} /> Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!caseData) return null;

  const { identity } = caseData;

  const tabProps: TabProps = { caseData, result, refresh, runScreen, running, goToTab };

  const renderTab = () => {
    if (ANALYSIS_TABS.has(activeTab) && !result) {
      return <NotScreenedYet running={running} onRun={runScreen} />;
    }
    switch (activeTab) {
      case 'snapshot':
        return <SnapshotTab {...tabProps} />;
      case 'documents':
        return <DocumentsTab {...tabProps} />;
      case 'valuation':
        return <ValuationTab {...tabProps} />;
      case 'drivers':
        return <DriversTab {...tabProps} />;
      case 'risks':
        return <RisksTab {...tabProps} />;
      case 'title':
        return <TitleTab {...tabProps} />;
      case 'compliance':
        return <ComplianceTab {...tabProps} />;
      case 'planning':
        return <PlanningTab {...tabProps} />;
      case 'completeness':
        return <CompletenessTab {...tabProps} />;
      case 'evidence':
        return <EvidenceTab {...tabProps} />;
      case 'actions':
        return <ActionsTab {...tabProps} />;
      case 'report':
        return <ReportTab {...tabProps} />;
      case 'intelligence':
        return <IntelligenceTab {...tabProps} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="no-print sticky top-0 z-20 bg-page/95 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pb-3 pt-4">
          <div className="min-w-0">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink"
            >
              <ArrowLeft size={12} /> Dashboard
            </Link>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">{caseData.reference}</h1>
              <span className="text-ink-muted">·</span>
              <span className="truncate text-[13px] text-ink-secondary">{identity.label}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-ink-secondary">
                {identity.city} · {identity.locality} · {identity.country}
              </span>
              <Badge>{PROPERTY_TYPE_LABEL[identity.propertyType]}</Badge>
              <Badge>{titleCase(identity.tenure)}</Badge>
              <Badge tone={caseData.status === 'screened' ? 'good' : 'neutral'}>
                {CASE_STATUS_LABEL[caseData.status]}
              </Badge>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {result ? (
                <>
                  <Badge tone={verdictTone(result.recommendation.verdict)}>
                    {VERDICT_LABEL[result.recommendation.verdict]}
                  </Badge>
                  <Badge tone={confidenceTone(result.confidence.band)}>
                    {titleCase(result.confidence.band)} confidence
                  </Badge>
                </>
              ) : (
                <Badge tone="neutral">Not screened</Badge>
              )}
            </div>
            <div className="text-right text-[17px] font-semibold leading-tight tracking-tight text-ink">
              {result
                ? `${money(result.indicativeValue.low, result.indicativeValue.currency)} – ${money(
                    result.indicativeValue.high,
                    result.indicativeValue.currency,
                  )}`
                : '—'}
            </div>
            <div className="flex items-center gap-2">
              {result ? (
                <span className="text-[11px] text-ink-muted">Screened {relativeTime(result.generatedAt)}</span>
              ) : null}
              <UnitToggle />
              <Button
                variant="primary"
                size="sm"
                icon={<RefreshCw size={13} />}
                loading={running}
                onClick={runScreen}
              >
                {result ? 'Re-run screen' : 'Run screen'}
              </Button>
            </div>
          </div>
        </div>
        <Tabs tabs={tabDefs} active={activeTab} onChange={goToTab} className="px-6" />
      </div>

      <div className="flex-1 p-6">{renderTab()}</div>
    </div>
  );
}
