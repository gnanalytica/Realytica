import {
  Building2,
  CircleDollarSign,
  ClipboardList,
  FileStack,
  FileText,
  GitBranch,
  LayoutDashboard,
  Scale,
  Search,
  Sparkles,
  Waypoints,
  Workflow,
} from 'lucide-react';
import {
  ASSESSMENT_STATUS_LABEL,
  SCOPE_LABEL,
  type DdProject,
  type ProjectCockpitPane,
} from '@realytica/shared';
import { Button, cn } from '../../../components/ui/kit';

export const RAIL: Array<{
  group: string;
  items: Array<{ pane: ProjectCockpitPane; label: string; short: string; icon: typeof Waypoints }>;
}> = [
  {
    group: 'Look',
    items: [
      { pane: 'overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
      { pane: 'assets', label: 'Assets', short: 'Assets', icon: Building2 },
    ],
  },
  {
    group: 'Diligence',
    items: [{ pane: 'dd', label: 'Assessments', short: 'Assess', icon: ClipboardList }],
  },
  {
    group: 'Registers',
    items: [
      { pane: 'evidence', label: 'Evidence', short: 'Evidence', icon: FileStack },
      { pane: 'findings', label: 'Findings', short: 'Findings', icon: Search },
      { pane: 'risks', label: 'Risks & actions', short: 'Risks', icon: GitBranch },
      { pane: 'decisions', label: 'Decisions', short: 'Decisions', icon: Scale },
      { pane: 'reports', label: 'Reports', short: 'Reports', icon: FileText },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { pane: 'graph', label: 'Graph', short: 'Graph', icon: Waypoints },
      { pane: 'valuation', label: 'Valuation', short: 'Value', icon: CircleDollarSign },
      { pane: 'orchestrate', label: 'Orchestrator', short: 'Orchestrate', icon: Workflow },
      { pane: 'drafts', label: 'AI drafts', short: 'Drafts', icon: Sparkles },
    ],
  },
];

const FLAT = RAIL.flatMap((g) => g.items);

export function paneLabel(pane: ProjectCockpitPane): string {
  if (pane === 'scope') return 'Scope';
  if (pane === 'actions') return 'Risks & actions';
  return FLAT.find((i) => i.pane === pane)?.label ?? 'Overview';
}

export function paneActive(current: ProjectCockpitPane, item: ProjectCockpitPane): boolean {
  if (current === item) return true;
  if (item === 'dd' && current === 'scope') return true;
  if (item === 'risks' && current === 'actions') return true;
  return false;
}

const CHIP_SCROLL =
  'flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export function CockpitRailNav({
  pane,
  project,
  ddId,
  scopeId,
  overdue,
  pendingDrafts,
  onGo,
}: {
  pane: ProjectCockpitPane;
  project: DdProject;
  ddId?: string;
  scopeId?: string;
  overdue: number;
  pendingDrafts: number;
  onGo: (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string }) => void;
}) {
  return (
    <nav aria-label="Project views" className="flex w-[200px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-hairline bg-surface py-3">
      {RAIL.map((group) => (
        <div key={group.group}>
          <div className="px-3.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            {group.group}
          </div>
          <ul className="flex flex-col gap-px px-1.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const on = paneActive(pane, item.pane);
              const badge =
                (item.pane === 'risks' || item.pane === 'actions') && overdue > 0
                  ? overdue
                  : item.pane === 'drafts' && pendingDrafts > 0
                    ? pendingDrafts
                    : null;
              return (
                <li key={item.pane}>
                  <button
                    type="button"
                    onClick={() => onGo(item.pane)}
                    aria-current={on ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] coarse:min-h-11',
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
          {group.group === 'Diligence' ? (
            <DiligenceTree project={project} ddId={ddId} scopeId={scopeId} onGo={onGo} variant="tree" />
          ) : null}
        </div>
      ))}
      <div className="mx-3.5 my-2 h-px bg-hairline" />
      <div className="px-3.5">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Chat is wired through agents. They propose; you approve; this pane updates live.
        </p>
        <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => onGo('orchestrate')}>
          Orchestrate
        </Button>
      </div>
    </nav>
  );
}

export function CockpitPaneStrip({
  pane,
  project,
  ddId,
  scopeId,
  overdue,
  pendingDrafts,
  onGo,
  wrap = false,
}: {
  pane: ProjectCockpitPane;
  project: DdProject;
  ddId?: string;
  scopeId?: string;
  overdue: number;
  pendingDrafts: number;
  onGo: (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string }) => void;
  wrap?: boolean;
}) {
  return (
    <div className={cn('shrink-0 space-y-1.5 border-b border-hairline bg-surface py-2', wrap ? 'px-4' : 'px-3')}>
      <div className={wrap ? 'flex flex-wrap gap-1.5' : CHIP_SCROLL}>
        {FLAT.map((item) => {
          const Icon = item.icon;
          const on = paneActive(pane, item.pane);
          const badge =
            (item.pane === 'risks' || item.pane === 'actions') && overdue > 0
              ? overdue
              : item.pane === 'drafts' && pendingDrafts > 0
                ? pendingDrafts
                : null;
          return (
            <button
              key={item.pane}
              type="button"
              onClick={() => onGo(item.pane)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] coarse:min-h-11',
                on ? 'bg-brand-soft font-semibold text-brand' : 'bg-sunken text-ink-secondary',
              )}
            >
              <Icon size={12} />
              {item.short}
              {badge != null ? (
                <span className="tabular rounded-full bg-warning/25 px-1.5 text-[10px] text-ink">{badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <DiligenceTree project={project} ddId={ddId} scopeId={scopeId} onGo={onGo} variant="chips" />
    </div>
  );
}

function DiligenceTree({
  project,
  ddId,
  scopeId,
  onGo,
  variant,
}: {
  project: DdProject;
  ddId?: string;
  scopeId?: string;
  onGo: (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string }) => void;
  variant: 'tree' | 'chips';
}) {
  const rows = project.assessments.filter((a) => a.status !== 'archived').slice(0, 8);
  if (rows.length === 0) return null;
  const current = rows.find((a) => a.id === ddId);

  if (variant === 'chips') {
    return (
      <>
        <div className={CHIP_SCROLL}>
          {rows.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onGo('dd', { ddId: a.id })}
              className={cn(
                'inline-flex max-w-[14rem] shrink-0 truncate rounded-full px-2.5 py-1 text-[11.5px] coarse:min-h-11',
                ddId === a.id ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted',
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
        {current && current.scopes.length > 0 ? (
          <div className={CHIP_SCROLL}>
            {current.scopes.map((scope) => (
              <button
                key={scope.id}
                type="button"
                onClick={() => onGo('scope', { ddId: current.id, scopeId: scope.id })}
                className={cn(
                  'inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11.5px] coarse:min-h-11',
                  scopeId === scope.id ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted',
                )}
              >
                {SCOPE_LABEL[scope.scopeKey]}
              </button>
            ))}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <ul className="mt-0.5 flex flex-col gap-px px-1.5">
      {rows.map((a) => {
        const on = ddId === a.id;
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onGo('dd', { ddId: a.id })}
              className={cn(
                'flex w-full flex-col rounded-lg px-2.5 py-1.5 pl-7 text-left coarse:min-h-11',
                on ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:text-ink',
              )}
            >
              <span className="truncate text-[12px] font-medium">{a.name}</span>
              <span className="font-mono text-[10px] text-ink-muted">{ASSESSMENT_STATUS_LABEL[a.status]}</span>
            </button>
            {on && a.scopes.length > 0 ? (
              <ul className="mt-0.5 flex flex-col gap-px">
                {a.scopes.map((scope) => (
                  <li key={scope.id}>
                    <button
                      type="button"
                      onClick={() => onGo('scope', { ddId: a.id, scopeId: scope.id })}
                      className={cn(
                        'w-full truncate rounded-lg px-2.5 py-1 pl-9 text-left text-[11.5px] coarse:min-h-11',
                        scopeId === scope.id ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:text-ink',
                      )}
                    >
                      {SCOPE_LABEL[scope.scopeKey]}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
