import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListChecks, Maximize2, PanelRight, Send, ShieldQuestion, Waypoints } from 'lucide-react';
import {
  DD_DOMAIN_KEYS,
  DD_DOMAIN_PROFILES,
  REFERENCE_DATA,
  domainForCheck,
  domainForRiskCategory,
  domainForSystem,
  summariseRequests,
} from '@realytica/shared';
import type { DdDomain } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { agentAvailable } from '../../lib/agent-availability';
import { CopilotPanel } from '../../components/CopilotPanel';
import { Badge, Callout, Skeleton, cn, useToast } from '../../components/ui/kit';
import { money } from '../../lib/format';
import { DossierPane } from './cockpit/DossierPane';
import { RequestsPane } from './cockpit/RequestsPane';
import { ReviewQueue, pendingReviewCount } from './cockpit/ReviewQueue';
import { ProceduresPane, blockedStepCount } from './cockpit/ProceduresPane';
import { SCREENING_GROUPS, ScreeningPane, screeningBadge } from './cockpit/ScreeningPane';
import { LEGACY_TAB_REDIRECT, findGroup } from './groups';
import { ProofPane } from './cockpit/ProofPane';
import GraphExplorerTab from './tabs/GraphExplorerTab';
import { CommandBar } from './cockpit/CommandBar';
import { LAYOUTS, LAYOUT_LABEL, clampChatWidth, readChatWidth, writeChatWidth } from './cockpit/layout';
import type { CockpitLayout } from './cockpit/layout';

/**
 * The diligence cockpit — the second shell over the same engine.
 *
 * Three columns: the department rail keeps engagement health in peripheral
 * vision, chat holds the centre because in diligence the thread is a record,
 * and the right pane is whatever that department's work currently is. The
 * Property Screen's buyer-question layout is untouched and still lives at
 * `/cases/:id`; this is the surface a DD engagement is run from.
 *
 * Everything addressable sits in the URL — department, pane, open document —
 * so a colleague can be sent exactly what you are looking at.
 */
export default function Cockpit() {
  const { caseId, tab: tabParam } = useParams<{ caseId: string; tab?: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: caseData, error, loading, refresh } = useAsync(() => api.getCase(caseId as string), [caseId]);
  const { data: capability } = useAsync(() => api.agentCapability(), []);

  const domainParam = searchParams.get('dept');
  const domain: DdDomain = (DD_DOMAIN_KEYS as readonly string[]).includes(domainParam ?? '')
    ? (domainParam as DdDomain)
    : 'land';
  const openDocumentId = searchParams.get('doc');
  const paneParam = searchParams.get('pane');
  /*
   * A screening group is addressed as `pane=<group>` rather than through a
   * separate parameter, so every surface in the cockpit is reachable by one
   * name and a pasted link means one thing.
   */
  const legacyTab = tabParam && tabParam !== 'cockpit' ? (LEGACY_TAB_REDIRECT[tabParam]?.group ?? tabParam) : null;
  const requestedPane = paneParam ?? legacyTab;
  const screeningGroup = (SCREENING_GROUPS as readonly string[]).includes(requestedPane ?? '') ? requestedPane : null;
  const paneMode = screeningGroup
    ? 'screening'
    : paneParam === 'review'
      ? 'review'
      : paneParam === 'procedures'
        ? 'procedures'
      : paneParam === 'graph'
      ? 'graph'
      : paneParam === 'requests'
        ? 'requests'
        : openDocumentId
          ? 'document'
          : 'dossier';

  /*
   * The layout follows the task: opening a document or the graph narrows the
   * chat by itself. `focus` is the only one a person chooses, so it is the
   * only one held in state rather than derived.
   */

  const [focusMode, setFocusMode] = useState(false);
  const layout: CockpitLayout =
    focusMode ? 'focus' : paneMode === 'dossier' || paneMode === 'requests' ? 'cockpit' : 'study';

  const [chatWidth, setChatWidth] = useState<number>(() => readChatWidth() ?? LAYOUTS.cockpit.chat ?? 520);
  const draggingRef = useRef(false);

  useEffect(() => {
    // A preset sets the width; a drag overrides it and is remembered.
    const preset = LAYOUTS[layout].chat;
    if (preset !== null && !draggingRef.current) setChatWidth(readChatWidth() ?? preset);
  }, [layout]);

  const [commandOpen, setCommandOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(v => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setFocusMode(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setParam = useCallback(
    (next: Record<string, string | null>) => {
      setSearchParams(
        prev => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(next)) {
            if (v === null) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const goDomain = useCallback(
    (next: DdDomain) => {
      setFocusMode(false);
      setParam({ dept: next, doc: null, pane: null });
    },
    [setParam],
  );

  const openProof = useCallback(
    (documentId: string, page?: number) => {
      setFocusMode(false);
      setParam({ doc: documentId, page: page ? String(page) : null, pane: null });
    },
    [setParam],
  );

  const handleAsk = useCallback(
    async (question: string) => {
      if (!caseData) return;
      setAsking(true);
      try {
        const response = await api.askCopilot(caseData.id, question, `${DD_DOMAIN_PROFILES[domain].label} · cockpit`);
        await refresh();
        const target = response.navigations?.[0]?.target;
        const asDomain = target?.replace('diligence?view=', '');
        if (asDomain && (DD_DOMAIN_KEYS as readonly string[]).includes(asDomain)) goDomain(asDomain as DdDomain);
        if (response.appliedCommands && response.appliedCommands.length > 0) {
          toast(response.appliedCommands.join(' · '), 'good');
        }
      } finally {
        setAsking(false);
      }
    },
    [caseData, domain, refresh, goDomain, toast],
  );

  // A question handed over by the command bar runs once the bar has closed.
  useEffect(() => {
    if (!pendingQuestion) return;
    const q = pendingQuestion;
    setPendingQuestion(null);
    void handleAsk(q);
  }, [pendingQuestion, handleAsk]);

  const badges = useMemo(() => {
    const out = new Map<DdDomain, { count: number; blocking: boolean }>();
    if (!caseData) return out;
    const bump = (d: DdDomain, blocking: boolean) => {
      const prev = out.get(d) ?? { count: 0, blocking: false };
      out.set(d, { count: prev.count + 1, blocking: prev.blocking || blocking });
    };
    for (const check of caseData.result?.stateCompliance?.checks ?? []) {
      if (check.verdict === 'blocker') bump(domainForCheck(check.key), true);
    }
    for (const risk of caseData.result?.risks ?? []) {
      if (risk.status === 'open' && (risk.severity === 'critical' || risk.severity === 'serious')) {
        bump(domainForRiskCategory(risk.category), risk.severity === 'critical');
      }
    }
    for (const f of caseData.technicalFindings ?? []) {
      if (f.reviewState === 'accepted' && f.status === 'open' && (f.severity === 'critical' || f.severity === 'serious')) {
        bump(domainForSystem(f.system), f.severity === 'critical');
      }
    }
    return out;
  }, [caseData]);

  const pendingReviews = caseData ? pendingReviewCount(caseData) : 0;
  const blockedSteps = caseData ? blockedStepCount(caseData) : 0;

  const requestSummary = useMemo(
    () => summariseRequests(caseData?.requests ?? [], new Date().toISOString()),
    [caseData],
  );

  if (loading && !caseData) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-96 w-full" />
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <Callout tone="critical" title="Could not open this case">
          {error ?? 'This case does not exist, or may have been deleted.'}
        </Callout>
        <Link to="/cases" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
          <ArrowLeft size={14} /> Back to your cases
        </Link>
      </div>
    );
  }

  const canAnswer = agentAvailable(capability, 'analyst_copilot');
  const openDocument = openDocumentId ? caseData.documents.find(d => d.id === openDocumentId) ?? null : null;
  const citedPage = searchParams.get('page');
  const spec = LAYOUTS[layout];

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col">
      {/* case bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-hairline px-5 py-2.5">
        <Link to="/cases" className="text-[11.5px] text-ink-secondary hover:text-ink">
          Your cases
        </Link>
        <span className="text-ink-muted">·</span>
        <span className="text-[13.5px] font-semibold text-ink">{caseData.reference}</span>
        <span className="truncate text-[12.5px] text-ink-secondary">{caseData.identity.label}</span>
        {caseData.result ? (
          <span className="tabular text-[12.5px] text-ink">
            {money(caseData.result.indicativeValue.low, caseData.result.indicativeValue.currency, { compact: true })}–
            {money(caseData.result.indicativeValue.high, caseData.result.indicativeValue.currency, { compact: true })}
          </span>
        ) : (
          <Badge tone="neutral">Not screened</Badge>
        )}
        <div className="flex-grow" />
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="rounded-lg border border-[var(--ring)] bg-surface px-2.5 py-1 text-[11.5px] text-ink-muted hover:text-ink"
        >
          Run a command <span className="font-mono">⌘K</span>
        </button>
        <button
          type="button"
          onClick={() => setFocusMode(v => !v)}
          title={focusMode ? 'Leave focus' : 'Focus the conversation (⌘.)'}
          aria-pressed={focusMode}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px]',
            focusMode ? 'border-brand bg-brand-soft text-brand' : 'border-[var(--ring)] bg-surface text-ink-secondary hover:text-ink',
          )}
        >
          {focusMode ? <PanelRight size={13} /> : <Maximize2 size={13} />}
          {LAYOUT_LABEL[layout]}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* rail */}
        <nav aria-label="Case navigation" className="flex w-[180px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline bg-surface-1 py-3">
          <div className="px-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-muted">Screening</div>
          <ul className="flex flex-col gap-px px-1.5">
            {SCREENING_GROUPS.map(key => {
              const group = findGroup(key);
              if (!group) return null;
              const badge = screeningBadge(key, caseData, caseData.result ?? null);
              const on = screeningGroup === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusMode(false);
                      setParam({ pane: key, doc: null, view: null });
                    }}
                    aria-current={on ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12.5px]',
                      on ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:text-ink',
                    )}
                  >
                    <span>{group.label}</span>
                    {badge ? (
                      <span
                        className={cn(
                          'tabular rounded-full px-1.5 text-[10.5px]',
                          badge.blocking ? 'bg-critical text-white' : 'bg-warning/25 text-ink',
                        )}
                      >
                        {badge.count}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mx-3.5 my-2 h-px bg-hairline" />
          <ul className="flex flex-col gap-px px-1.5">
            <li>
              <button
                type="button"
                onClick={() => {
                  setFocusMode(false);
                  setParam({ pane: 'procedures', doc: null, view: null });
                }}
                aria-current={paneMode === 'procedures' ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                  paneMode === 'procedures' ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:text-ink',
                )}
              >
                <ListChecks size={13} /> Procedures
                {blockedSteps > 0 ? (
                  <span className="tabular ml-auto rounded-full bg-warning/25 px-1.5 text-[10.5px] text-ink">
                    {blockedSteps}
                  </span>
                ) : null}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setFocusMode(false);
                  setParam({ pane: 'review', doc: null, view: null });
                }}
                aria-current={paneMode === 'review' ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                  paneMode === 'review' ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:text-ink',
                )}
              >
                <ShieldQuestion size={13} /> Review
                {pendingReviews > 0 ? (
                  <span className="tabular ml-auto rounded-full bg-brand px-1.5 text-[10.5px] text-[var(--brand-ink)]">
                    {pendingReviews}
                  </span>
                ) : null}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setFocusMode(false);
                  setParam({ pane: 'requests', doc: null });
                }}
                aria-current={paneMode === 'requests' ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                  paneMode === 'requests' ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:text-ink',
                )}
              >
                <Send size={13} /> Requests
                {requestSummary.outstanding > 0 ? (
                  <span
                    className={cn(
                      'tabular ml-auto rounded-full px-1.5 text-[10.5px]',
                      requestSummary.overdue > 0 ? 'bg-critical text-white' : 'bg-surface-3 text-ink-secondary',
                    )}
                  >
                    {requestSummary.overdue > 0 ? `${requestSummary.overdue} late` : requestSummary.outstanding}
                  </span>
                ) : null}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setFocusMode(false);
                  setParam({ pane: 'graph', doc: null });
                }}
                aria-current={paneMode === 'graph' ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                  paneMode === 'graph' ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:text-ink',
                )}
              >
                <Waypoints size={13} /> Knowledge graph
              </button>
            </li>
          </ul>
        </nav>

        {/* chat — the centre */}
        <section
          aria-label="Conversation"
          className="flex min-w-0 flex-col border-r border-hairline"
          style={spec.chat === null ? { flexGrow: 1 } : { width: chatWidth, flexShrink: 0 }}
        >
          <div className="flex-1 overflow-y-auto p-4">
            <CopilotPanel
              conversation={caseData.intelligence?.conversation ?? []}
              evidence={caseData.result?.evidence ?? []}
              suggestions={
                canAnswer === false ? [] : [`What is worst in ${DD_DOMAIN_PROFILES[domain].label.toLowerCase()} right now?`]
              }
              onAsk={handleAsk}
              busy={asking}
              disabled={canAnswer === false}
              disabledReason={canAnswer === false ? 'No model is configured for this deployment.' : undefined}
              verification={caseData.intelligence?.verification}
              onOpenNode={nodeId => setParam({ pane: 'graph', doc: null, node: nodeId })}
              onOpenDocument={id => openProof(id)}
              fallback={
                <div className="flex flex-col gap-2 py-2">
                  <p className="text-[12.5px] font-medium text-ink">Next steps on this case</p>
                  {(caseData.result?.actions ?? []).filter(a => !a.done).slice(0, 6).map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setParam({ pane: 'report', view: 'actions', doc: null })}
                      className="rounded-lg bg-surface px-3 py-2 text-left ring-1 ring-inset ring-[var(--ring)] hover:ring-brand/40"
                    >
                      <span className="block text-[12.5px] text-ink">{a.title}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-muted">
                        {a.priority.replace(/_/g, ' ')} · {a.owner}
                      </span>
                    </button>
                  ))}
                  {(caseData.result?.actions ?? []).filter(a => !a.done).length === 0 ? (
                    <p className="text-[12px] text-ink-muted">
                      Nothing outstanding from the screen. Run a department review once a model is configured.
                    </p>
                  ) : null}
                </div>
              }
            />
          </div>
        </section>

        {/* the divider only exists when there is something to divide */}
        {spec.rightPane ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the conversation"
            tabIndex={0}
            onPointerDown={e => {
              draggingRef.current = true;
              const startX = e.clientX;
              const startW = chatWidth;
              const move = (ev: PointerEvent) => setChatWidth(clampChatWidth(startW + (ev.clientX - startX)));
              const up = () => {
                draggingRef.current = false;
                writeChatWidth(chatWidth);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const next = clampChatWidth(chatWidth + (e.key === 'ArrowLeft' ? -24 : 24));
                setChatWidth(next);
                writeChatWidth(next);
              }
            }}
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-brand-soft"
          />
        ) : null}

        {/* right pane */}
        {spec.rightPane ? (
          <section aria-label="Work surface" className="flex min-w-0 flex-1 flex-col bg-surface-1">
            {paneMode === 'procedures' ? (
              <ProceduresPane caseData={caseData} />
            ) : paneMode === 'review' ? (
              <ReviewQueue caseData={caseData} onChanged={refresh} />
            ) : paneMode === 'screening' && screeningGroup ? (
              <ScreeningPane
                groupKey={screeningGroup}
                viewKey={searchParams.get('view') ?? (tabParam ? LEGACY_TAB_REDIRECT[tabParam]?.view ?? null : null)}
                onSelectView={v => setParam({ view: v })}
                caseData={caseData}
                result={caseData.result ?? null}
                refresh={refresh}
                runScreen={async () => { await api.runScreen(caseData.id); await refresh(); }}
                running={false}
                goToTab={key => setParam({ pane: key, doc: null, view: null })}
              />
            ) : paneMode === 'requests' ? (
              <RequestsPane caseData={caseData} onChanged={refresh} onOpenDocument={(id) => openProof(id)} />
            ) : paneMode === 'graph' ? (
              /* The explorer is the same component the Diligence view uses —
                 the cockpit gives it the Study width rather than a second
                 implementation. It takes TabProps, so the cockpit supplies the
                 same contract every other view gets. */
              <div className="h-full overflow-y-auto p-4">
                <GraphExplorerTab
                  caseData={caseData}
                  result={caseData.result ?? null}
                  refresh={refresh}
                  runScreen={async () => { await api.runScreen(caseData.id); await refresh(); }}
                  running={false}
                  goToTab={(key) => navigate(`/cases/${caseData.id}/${key}`)}
                />
              </div>
            ) : openDocument ? (
              <ProofPane
                caseId={caseData.id}
                document={openDocument}
                citedPage={citedPage ? Number(citedPage) : undefined}
                onClose={() => setParam({ doc: null, page: null })}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                {/*
                  The department strip.

                  These eight were rail rows until they were the middle third
                  of a seventeen-row column that also held case sections and
                  whole-case surfaces — three different kinds of destination
                  separated only by a hairline. They are a facet of one case
                  rather than places to go: you switch department the way you
                  switch a filter on a table, repeatedly and while looking at
                  the thing it changes. So they sit directly above what they
                  scope, and only while a dossier is what is on screen.
                */}
                <nav
                  aria-label="Engagement department"
                  className="flex shrink-0 flex-wrap items-center gap-1 border-b border-hairline px-4 py-2"
                >
                  {DD_DOMAIN_KEYS.map(d => {
                    const badge = badges.get(d);
                    const on = d === domain;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => goDomain(d)}
                        aria-current={on ? 'true' : undefined}
                        title={DD_DOMAIN_PROFILES[d].question}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] transition-colors duration-base',
                          on ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink',
                        )}
                      >
                        {DD_DOMAIN_PROFILES[d].label}
                        {badge ? (
                          <span
                            className={cn(
                              'tabular rounded-full px-1.5 text-[10.5px]',
                              badge.blocking ? 'bg-critical text-white' : 'bg-warning/25 text-ink',
                            )}
                          >
                            {badge.count}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </nav>
                <div className="min-h-0 flex-1">
                  <DossierPane
                    caseData={caseData}
                    domain={domain}
                    refData={REFERENCE_DATA}
                    onOpenProof={openProof}
                    onAddDocument={() => navigate(`/cases/${caseData.id}/documents`)}
                    onRunReview={(question) => void handleAsk(question)}
                    reviewBusy={asking}
                    reviewDisabled={canAnswer === false}
                    work={{
                      caseData,
                      result: caseData.result ?? null,
                      refresh,
                      runScreen: async () => { await api.runScreen(caseData.id); await refresh(); },
                      running: false,
                      goToTab: key => setParam({ pane: key, doc: null, view: null }),
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>

      <CommandBar
        open={commandOpen}
        caseData={caseData}
        onClose={() => setCommandOpen(false)}
        onGo={goDomain}
        onAsk={q => setPendingQuestion(q)}
        onChanged={refresh}
      />
    </div>
  );
}
