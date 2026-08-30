import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  CircleDollarSign,
  FileStack,
  GitBranch,
  ListChecks,
  Maximize2,
  PanelRight,
  Sparkles,
  Waypoints,
  Workflow,
} from 'lucide-react';
import {
  PROJECT_COCKPIT_PANES,
  PROJECT_HEALTH_LABEL,
  type ChatProposal,
  type CopilotTurn,
  type DdProject,
  type EvidenceItem,
  type ProjectChatResult,
  type ProjectCockpitPane,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { CopilotPanel } from '../../components/CopilotPanel';
import { Badge, Button, cn, useToast } from '../../components/ui/kit';
import { LAYOUTS, LAYOUT_LABEL, clampChatWidth, readChatWidth, writeChatWidth } from '../case/cockpit/layout';
import type { CockpitLayout } from '../case/cockpit/layout';
import { healthTone } from './shared';
import type { ProjectOutlet } from './ProjectLayout';
import { ProjectCommandBar } from './cockpit/ProjectCommandBar';
import {
  ActionsPane,
  DraftsPane,
  EvidencePane,
  GraphPane,
  OrchestratePane,
  ValuationPane,
  WorkPane,
} from './cockpit/panes';

const RAIL: Array<{ pane: ProjectCockpitPane; label: string; icon: typeof Waypoints }> = [
  { pane: 'work', label: 'Work', icon: ListChecks },
  { pane: 'graph', label: 'Knowledge graph', icon: Waypoints },
  { pane: 'actions', label: 'Actions', icon: GitBranch },
  { pane: 'orchestrate', label: 'Orchestrator', icon: Workflow },
  { pane: 'drafts', label: 'AI drafts', icon: Sparkles },
  { pane: 'evidence', label: 'Evidence', icon: FileStack },
  { pane: 'valuation', label: 'Valuation', icon: CircleDollarSign },
];

function isPane(value: string | null): value is ProjectCockpitPane {
  return Boolean(value && (PROJECT_COCKPIT_PANES as readonly string[]).includes(value));
}

function ProposalCards({
  turn,
  proposals,
  busy,
  onApprove,
  onSkip,
}: {
  turn: CopilotTurn;
  proposals: ChatProposal[];
  busy: boolean;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const rows = (turn.proposalIds ?? [])
    .map((id) => proposals.find((p) => p.id === id))
    .filter((p): p is ChatProposal => Boolean(p));
  if (!rows.length) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {rows.map((item) => {
        const open = item.status === 'proposed';
        return (
          <div key={item.id} className="rounded-lg bg-surface px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
            <p className="text-[12.5px] font-medium text-ink">{item.title}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{item.rationale}</p>
            <p className="mt-1 text-[11px] text-ink-muted">{item.impact}</p>
            {typeof item.payload.url === 'string' && item.payload.url ? (
              <a
                href={item.payload.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11.5px] text-brand underline-offset-2 hover:underline"
              >
                Open portal
              </a>
            ) : null}
            {open ? (
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="primary" disabled={busy} onClick={() => onApprove(item.id)}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSkip(item.id)}>
                  Skip
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] font-medium text-ink-muted">
                {item.status === 'committed' ? 'Written to the project' : item.status}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function evidenceForChat(project: ProjectOutlet['project']): EvidenceItem[] {
  return project.evidence.map((e) => ({
    id: e.id,
    statement: e.title,
    sourceType: 'document',
    sourceRef: e.attachments[0]?.id ?? e.id,
    sourceLabel: e.title,
    confidence: e.status === 'validated' || e.status === 'used' ? 0.9 : 0.55,
    capturedAt: e.updatedAt,
  }));
}

export default function ProjectCockpit() {
  const { project, refresh, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const pane: ProjectCockpitPane = isPane(searchParams.get('pane')) ? (searchParams.get('pane') as ProjectCockpitPane) : 'work';
  const nodeId = searchParams.get('node');

  const [focusMode, setFocusMode] = useState(false);
  const layout: CockpitLayout = focusMode ? 'focus' : pane === 'graph' ? 'study' : 'cockpit';
  const [chatWidth, setChatWidth] = useState<number>(() => readChatWidth() ?? LAYOUTS.cockpit.chat ?? 520);
  const draggingRef = useRef(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [liveLabel, setLiveLabel] = useState<string | null>(null);

  useEffect(() => {
    const preset = LAYOUTS[layout].chat;
    if (preset !== null && !draggingRef.current) setChatWidth(readChatWidth() ?? preset);
  }, [layout]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setParam = useCallback(
    (next: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
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

  const goPane = useCallback(
    (next: ProjectCockpitPane) => {
      setFocusMode(false);
      setParam({ pane: next, node: next === 'graph' ? searchParams.get('node') : null });
    },
    [setParam, searchParams],
  );

  const applyResult = useCallback(
    (response: ProjectChatResult & { project: DdProject }) => {
      setProject(response.project);
      const ids = response.highlightIds ?? [];
      setHighlightIds(ids);
      setLiveLabel(
        response.commands[0]
          ?? (response.proposals.length ? `Proposed ${response.proposals.length} update(s) — approve to write` : null),
      );
      const target = response.navigations.at(-1)?.target ?? null;
      if (isPane(target)) {
        if (target === 'graph' && ids[0]) setParam({ pane: 'graph', node: ids[0] });
        else goPane(target);
      }
      if (response.commands.length > 0) toast(response.commands.join(' · '), 'good');
    },
    [setProject, goPane, setParam, toast],
  );

  const handleAsk = useCallback(
    async (question: string, files?: File[]) => {
      setAsking(true);
      try {
        const response = files?.length
          ? await api.projectChatFiles(project.id, { question, viewContext: pane, files })
          : await api.projectChat(project.id, { question, viewContext: pane });
        applyResult(response);
      } finally {
        setAsking(false);
      }
    },
    [project.id, pane, applyResult],
  );

  const handleProposal = useCallback(
    async (id: string, action: 'commit' | 'reject') => {
      setAsking(true);
      try {
        const response =
          action === 'commit' ? await api.commitChatProposal(project.id, id) : await api.rejectChatProposal(project.id, id);
        applyResult(response);
      } finally {
        setAsking(false);
      }
    },
    [project.id, applyResult],
  );

  useEffect(() => {
    if (!pendingQuestion) return;
    const q = pendingQuestion;
    setPendingQuestion(null);
    void handleAsk(q);
  }, [pendingQuestion, handleAsk]);

  const overdue = project.actions.filter((a) => a.status === 'overdue').length;
  const pendingDrafts = (project.aiDrafts ?? []).filter((d) => d.status === 'draft' || d.status === 'accepted' || d.status === 'in_review').length;
  const conversation = (project.conversation ?? []) as CopilotTurn[];
  const spec = LAYOUTS[layout];

  const suggestions = useMemo(
    () => [
      'Guide me',
      'Set owner to Priya Shah',
      'Land area is 12 acres',
      'Add Tower D',
      'What proofs are missing?',
    ],
    [],
  );

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-hairline px-5 py-2.5">
        <Link to=".." className="text-[11.5px] text-ink-secondary hover:text-ink">
          Overview
        </Link>
        <span className="text-ink-muted">·</span>
        <span className="font-mono text-[11px] text-ink-muted">{project.reference}</span>
        <span className="truncate text-[13.5px] font-semibold text-ink">{project.name}</span>
        <Badge tone={healthTone(project.health)}>{PROJECT_HEALTH_LABEL[project.health]}</Badge>
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
          onClick={() => setFocusMode((v) => !v)}
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
        <nav aria-label="Project cockpit" className="flex w-[188px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline bg-surface-1 py-3">
          <div className="px-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-muted">Project</div>
          <ul className="flex flex-col gap-px px-1.5">
            {RAIL.map((item) => {
              const Icon = item.icon;
              const on = pane === item.pane && !focusMode;
              const badge =
                item.pane === 'actions' && overdue > 0
                  ? overdue
                  : item.pane === 'drafts' && pendingDrafts > 0
                    ? pendingDrafts
                    : null;
              return (
                <li key={item.pane}>
                  <button
                    type="button"
                    onClick={() => goPane(item.pane)}
                    aria-current={on ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                      on ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-secondary hover:text-ink',
                    )}
                  >
                    <Icon size={13} />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    {badge != null ? (
                      <span className="tabular rounded-full bg-warning/25 px-1.5 text-[10.5px] text-ink">{badge}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mx-3.5 my-2 h-px bg-hairline" />
          <div className="px-3.5">
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Type facts or commands. Chat proposes the update; approve and the pane on the right shows it live.
            </p>
            <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => goPane('orchestrate')}>
              Orchestrate
            </Button>
          </div>
        </nav>

        <section
          aria-label="Conversation"
          className="flex min-h-0 min-w-0 flex-col border-r border-hairline"
          style={spec.chat === null ? { flexGrow: 1 } : { width: chatWidth, flexShrink: 0 }}
        >
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <CopilotPanel
              fill
              conversation={conversation}
              evidence={evidenceForChat(project)}
              suggestions={suggestions}
              onAsk={handleAsk}
              busy={asking}
              disabled={false}
              allowAttach
              emptyTitle="Talk to this project"
              emptyHint="Add or edit in plain language — owner, areas, assets, DDs, findings. Chat will propose the write, then the right pane updates live when you approve."
              placeholder="Set owner to … · Add Tower D · Land is 12 acres"
              renderTurnExtras={(turn) => (
                <ProposalCards
                  turn={turn}
                  proposals={project.chatProposals ?? []}
                  busy={asking}
                  onApprove={(id) => void handleProposal(id, 'commit')}
                  onSkip={(id) => void handleProposal(id, 'reject')}
                />
              )}
              onOpenNode={(id) => {
                setFocusMode(false);
                setParam({ pane: 'graph', node: id });
              }}
              onOpenDocument={() => goPane('evidence')}
              onClear={
                conversation.length > 0
                  ? async () => {
                      await api.clearProjectChat(project.id);
                      await refresh();
                    }
                  : undefined
              }
            />
          </div>
        </section>

        {spec.rightPane ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the conversation"
            tabIndex={0}
            onPointerDown={(e) => {
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
            onKeyDown={(e) => {
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

        {spec.rightPane ? (
          <section aria-label="Work surface" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
            {liveLabel ? (
              <div className="shrink-0 border-b border-brand/25 bg-brand-soft px-4 py-2 text-[12px] text-ink">
                <span className="font-medium">Live</span>
                <span className="text-ink-muted"> · {liveLabel}</span>
              </div>
            ) : null}
            {pane === 'graph' ? (
              <div className="min-h-0 flex-1">
                <GraphPane
                  project={project}
                  focusId={nodeId ?? highlightIds[0]}
                  onSelect={(id) => setParam({ pane: 'graph', node: id })}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {pane === 'actions' ? (
                  <ActionsPane project={project} onChanged={refresh} highlightIds={highlightIds} />
                ) : pane === 'orchestrate' ? (
                  <OrchestratePane project={project} onChanged={refresh} />
                ) : pane === 'drafts' ? (
                  <DraftsPane project={project} onChanged={refresh} />
                ) : pane === 'evidence' ? (
                  <EvidencePane project={project} highlightIds={highlightIds} />
                ) : pane === 'valuation' ? (
                  <ValuationPane project={project} onChanged={refresh} />
                ) : (
                  <WorkPane project={project} highlightIds={highlightIds} />
                )}
              </div>
            )}
          </section>
        ) : null}
      </div>

      <ProjectCommandBar
        open={commandOpen}
        project={project}
        onClose={() => setCommandOpen(false)}
        onGo={goPane}
        onAsk={(q) => setPendingQuestion(q)}
        onChanged={refresh}
      />
    </div>
  );
}
