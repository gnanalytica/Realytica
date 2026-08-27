import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import UnitToggle from '../../components/UnitToggle';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  MessageSquare,
  MapPinned,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Waypoints,
  Workflow,
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
  cn,
  EmptyState,
  Skeleton,
  Tabs,
  useToast,
  type TabDef,
  type Tone,
} from '../../components/ui/kit';
import type { RunGraph } from '@realytica/shared';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import type { TabProps } from './tab-props';
import { CASE_GROUPS, NEEDS_SCREEN, LEGACY_TAB_REDIRECT, findGroup, groupsForLens, viewState } from './groups';
import { LensBar } from '../../components/LensBar';
import { resolveLens } from '@realytica/shared';
import type { LensKey } from '@realytica/shared';

import ChatTab from './tabs/ChatTab';
import { CopilotDock } from '../../components/CopilotDock';



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

/**
 * The wash behind the workspace header, keyed to the verdict.
 *
 * A separate table from `Tile`'s because this one fades downward into the
 * page rather than filling a rounded rectangle — the header has no bottom
 * edge to stop at, and a wash that ended abruptly halfway down a sticky bar
 * would read as a rendering fault.
 */
const HEADER_WASH: Record<Tone, string> = {
  neutral: '',
  brand: 'bg-grad-brand',
  info: 'bg-grad-brand',
  good: 'bg-grad-good',
  warning: 'bg-grad-warning',
  serious: 'bg-grad-serious',
  critical: 'bg-grad-critical',
};

export default function CaseWorkspace() {
  const { caseId, tab } = useParams<{ caseId: string; tab?: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  const { data: caseData, error, loading, refresh } = useAsync(() => api.getCase(caseId as string), [caseId]);

  const [searchParams, setSearchParams] = useSearchParams();
  /*
   * A legacy key only counts when it is not also a group key.
   *
   * Two of the old tab names — `documents` and `report` — are also names of
   * the groups that absorbed them. Without this guard the redirect fired on
   * the group itself and rewrote `?view=evidence` to `?view=files`, so every
   * deep link into those two groups silently landed on their first view.
   * The chat's own "N sources cited" link is one of them.
   */
  const isGroup = CASE_GROUPS.some((g) => g.key === tab);
  const legacy = tab && !isGroup ? LEGACY_TAB_REDIRECT[tab] : undefined;
  const activeTab: string =
    tab === 'chat' || isGroup ? (tab as string) : legacy?.group ?? 'chat';

  /*
   * An old tab URL is rewritten rather than merely tolerated.
   *
   * `/cases/:id/completeness` was a real address; people have it in tabs and
   * in messages. It now resolves to the group and view that absorbed it, and
   * the address bar is corrected so the next reload is not a redirect too.
   */
  useEffect(() => {
    if (!legacy || !caseId) return;
    navigate(`/cases/${caseId}/${legacy.group}?view=${legacy.view}`, { replace: true });
  }, [legacy, caseId, navigate]);

  /** Chip colours for a view's state, matched to the tones used everywhere else. */
  const VIEW_STATE_CHIP: Record<string, string> = {
    critical: 'bg-critical/12 text-critical',
    warning: 'bg-warning/20 text-ink',
    brand: 'bg-brand-soft text-brand',
    neutral: 'bg-surface-2 text-ink-secondary',
  };

  const goToTab = useCallback(
    (key: string) => {
      if (!caseId) return;
      // `key` may carry a view — "documents?view=evidence" — so the chat can
      // link at a panel rather than only at a group.
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

  /*
   * The run graph, fetched only when its tab is open.
   *
   * Not folded into the case aggregate: the graph is derived server-side from
   * the same runs the case already carries, so shipping it with every
   * `getCase` would send the whole thing on every tab, every refresh, for the
   * one tab that draws it.
   *
   * Keyed on `caseData.updatedAt` as well as the case id, so a graph fetched
   * before an agent run does not stay on screen after it — a stale canvas is
   * worse than a spinner here, because it looks like a finished answer.
   * `null` graph and `loading` are kept distinct: "nothing has been
   * orchestrated" and "we have not asked yet" need different words.
   */
  const [flow, setFlow] = useState<{ graph: RunGraph | null; loading: boolean; error: string | null }>({
    graph: null,
    loading: false,
    error: null,
  });
  const flowStamp = caseData?.updatedAt;
  const [wantsGraph, setWantsGraph] = useState(false);
  useEffect(() => {
    if (!wantsGraph || !caseId) return;
    let live = true;
    setFlow((f) => ({ ...f, loading: true, error: null }));
    api
      .caseFlow(caseId)
      .then((graph) => {
        if (live) setFlow({ graph, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (live) {
          setFlow({ graph: null, loading: false, error: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      live = false;
    };
  }, [wantsGraph, caseId, flowStamp]);

  /*
   * Who this case is being read by.
   *
   * Held locally so the picker responds immediately rather than after a round
   * trip, and written back through the API so it survives a reload. The
   * fallback chain is in `resolveLens`: the reader's choice, then the
   * assessment profile's default for this kind of project, then the legacy
   * persona for cases that predate all of it.
   */
  const [lensOverride, setLensOverride] = useState<LensKey | null>(null);
  const lens: LensKey = lensOverride ?? resolveLens({
    lens: caseData?.lens,
    defaultLens: result?.assessment?.defaultLens,
    persona: caseData?.persona,
  });
  const [lensBusy, setLensBusy] = useState(false);

  const chooseLens = useCallback(
    async (next: LensKey) => {
      setLensOverride(next);
      if (!caseId) return;
      setLensBusy(true);
      try {
        await api.setLens(caseId, next);
      } catch {
        /* the lens is a presentation choice — a failed save is not worth
           interrupting the reader over, and it still applies for this view */
      } finally {
        setLensBusy(false);
      }
    },
    [caseId],
  );

  /*
   * Five groups, badged with the number that would make someone open them.
   *
   * The badges are the same counts the fourteen tabs carried; they just moved
   * up to the group that absorbed them, so nothing that used to be visible at
   * a glance stopped being visible.
   */
  const tabDefs: TabDef[] = useMemo(() => {
    const openCriticalRisks = result?.risks.filter((r) => r.severity === 'critical' && r.status === 'open').length ?? 0;
    const openActions = result?.actions.filter((a) => !a.done).length ?? 0;
    const titleFindings = result?.titleGraph
      ? result.titleGraph.contradictions.length
        + result.titleGraph.chains.reduce((n, c) => n + c.breaks.length, 0)
      : 0;
    const blockerCount = result?.stateCompliance?.checks.filter((c) => c.verdict === 'blocker').length ?? 0;
    const legalFindings = titleFindings + blockerCount;

    const badge: Record<string, ReactNode> = {
      overview: openCriticalRisks > 0 ? <Badge tone="critical">{openCriticalRisks}</Badge> : undefined,
      legal: legalFindings > 0 ? <Badge tone="warning">{legalFindings}</Badge> : undefined,
      documents: caseData ? <Badge tone="neutral">{caseData.documents.length}</Badge> : undefined,
      report: openActions > 0 ? <Badge tone="brand">{openActions}</Badge> : undefined,
    };
    const icon: Record<string, ReactNode> = {
      overview: <LayoutDashboard size={13} />,
      value: <Landmark size={13} />,
      legal: <ScrollText size={13} />,
      documents: <Files size={13} />,
      report: <FileBarChart2 size={13} />,
    };
    return [
      { key: 'chat', label: 'Chat', icon: <MessageSquare size={13} /> },
      ...groupsForLens(lens).map((g) => ({ key: g.key, label: g.label, icon: icon[g.key], badge: badge[g.key] })),
    ];
  }, [caseData, result, lens]);

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
          to="/cases"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
        >
          <ArrowLeft size={14} /> Back to your cases
        </Link>
      </div>
    );
  }

  if (!caseData) return null;

  const { identity } = caseData;

  const tabProps: TabProps = { caseData, result, refresh, runScreen, running, goToTab, lens };

  /*
   * Which view inside the group is showing.
   *
   * Carried in the query string rather than in component state so that a link
   * to a specific view survives being pasted — every one of the fourteen old
   * tab URLs redirects to a group plus a view, and those redirects would be
   * pointless if the view could not be addressed.
   */
  const group = findGroup(activeTab) ?? CASE_GROUPS[0];
  const requestedView = searchParams.get('view');
  const view = group.views.find((v) => v.key === requestedView) ?? group.views[0];

  const renderTab = () => {
    if (activeTab === 'chat') {
      return (
        <ChatTab
          {...tabProps}
          graph={flow.graph}
          graphLoading={flow.loading}
          graphError={flow.error}
          onNeedGraph={() => setWantsGraph(true)}
        />
      );
    }
    if (NEEDS_SCREEN.has(view.key) && !result) {
      return <NotScreenedYet running={running} onRun={runScreen} />;
    }
    const View = view.component;
    return (
      <>
        {group.views.length > 1 ? (
          <div className="mx-auto mb-4 max-w-5xl">
            {/*
              * The group's own question, above its views.
              *
              * The five groups are named after the questions a reader asks;
              * the names had to fit in a tab, so they lost the question. It
              * belongs here, where the reader has already committed to the
              * group and is choosing which part of the answer to read.
              */}
            <p className="mb-2 text-[12.5px] text-ink-muted">{group.question}</p>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={group.label}>
              {group.views.map((v) => {
                const state = viewState(v.key, caseData, result);
                const active = v.key === view.key;
                return (
                  <button
                    key={v.key}
                    role="tab"
                    aria-selected={active}
                    title={state.note}
                    onClick={() => setSearchParams(v.key === group.views[0].key ? {} : { view: v.key }, { replace: true })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
                      active ? 'bg-brand text-ink-inverse' : 'bg-sunken text-ink-secondary hover:text-ink',
                    )}
                  >
                    {v.label}
                    {state.count !== undefined && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-[11px] tabular-nums',
                          active ? 'bg-white/25 text-ink-inverse' : VIEW_STATE_CHIP[state.tone ?? 'neutral'],
                        )}
                      >
                        {state.count}
                      </span>
                    )}
                    {/* An empty view says so with a hollow dot, because "nothing
                        here" and "nothing wrong" look identical from a tab. */}
                    {state.empty && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-1.5 w-1.5 rounded-full border',
                          active ? 'border-white/60' : 'border-ink-faint',
                        )}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <View {...tabProps} />
      </>
    );
  };

  // Neutral until screened: a case with no verdict must not wear one.
  const headerTone: Tone = result ? verdictTone(result.recommendation.verdict) : 'neutral';

  return (
    <div className="flex min-h-full flex-col">
      {/*
        * The header carries the case's verdict as a wash behind it.
        *
        * A workspace is a long scroll across five groups and a dozen views,
        * and the one fact a reader needs held in view throughout is what this
        * case actually came back as. It was a badge among four other badges.
        * Now it is the ground the whole header sits on — visible in
        * peripheral vision, gone the moment the verdict changes, and neutral
        * until a screen has actually produced one.
        */}
      <div className="no-print sticky top-0 z-20 bg-page/95 backdrop-blur">
        <span aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 top-0 h-32', HEADER_WASH[headerTone])} />
        <div className="relative flex flex-wrap items-start justify-between gap-4 px-6 pb-3 pt-4">
          <div className="min-w-0">
            <Link
              to="/cases"
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink"
            >
              <ArrowLeft size={12} /> Your cases
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
            {/*
              * The headline range counts to a new value rather than jumping.
              *
              * Re-running a screen after a document lands is the moment this
              * number is most likely to move and least likely to be watched —
              * the eye is on the button that was just pressed. `tabular` keeps
              * the digits fixed-width so counting does not shove the header
              * around.
              */}
            <div className="tabular text-right text-[17px] font-semibold leading-tight tracking-tight text-ink">
              {result ? (
                <>
                  <AnimatedNumber
                    value={result.indicativeValue.low}
                    format={(v) => money(v, result.indicativeValue.currency)}
                  />
                  {' – '}
                  <AnimatedNumber
                    value={result.indicativeValue.high}
                    format={(v) => money(v, result.indicativeValue.currency)}
                  />
                </>
              ) : (
                '—'
              )}
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
        <div className="flex flex-wrap items-center gap-3 px-6 pb-2.5">
          <LensBar lens={lens} onChange={chooseLens} busy={lensBusy} />
        </div>
        <Tabs tabs={tabDefs} active={activeTab} onChange={goToTab} className="px-6" />
      </div>

      {/*
        * The content row: whatever group is open, with the copilot docked at
        * its right on wide screens. The chat tab IS the copilot at full
        * width, so the dock stands down there rather than showing the same
        * conversation twice.
        */}
      <div className="flex flex-1 items-stretch">
        <div className="min-w-0 flex-1 p-6">{renderTab()}</div>
        {activeTab !== 'chat' ? (
          <CopilotDock
            caseData={caseData}
            result={result}
            refresh={refresh}
            viewContext={group.views.length > 1 ? `${group.label} → ${view.label}` : group.label}
            className="hidden xl:flex"
          />
        ) : null}
      </div>
    </div>
  );
}
