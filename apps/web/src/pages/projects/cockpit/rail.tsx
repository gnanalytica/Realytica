import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Building2,
  ChevronDown,
  ClipboardList,
  FileStack,
  FileText,
  GitBranch,
  LayoutDashboard,
  Scale,
  Search,
  Sparkles,
  Users,
  Waypoints,
  Workflow,
} from 'lucide-react';
import {
  DEPARTMENTS,
  SCOPE_LABEL,
  departmentDefinition,
  projectDepartments,
  reachesEveryProject,
  scopeCompleteness,
  workstreamDefinition,
  type DdProject,
  type DepartmentKey,
  type ProjectCockpitPane,
} from '@realytica/shared';
import { cn } from '../../../components/ui/kit';
import { useMe } from '../../../lib/useMe';

/**
 * How a person moves around a project: Overview, then the departments the
 * project uses, then the shared places — the document vault, the registers,
 * reports, people and the graph.
 *
 * Inside a department the second row is its workstreams. A workstream that is
 * not built yet is still listed, marked as coming, because knowing it will be
 * there is part of knowing what the department is for. Every pane keeps its
 * route, so the chat can still take a person anywhere by name.
 */

export type CockpitSectionKey = 'overview' | DepartmentKey | 'documents' | 'registers' | 'reports' | 'people' | 'graph';

export interface CockpitTab {
  pane: ProjectCockpitPane;
  label: string;
  icon: typeof Waypoints;
  /** Panes that light this tab without being it. */
  also?: ProjectCockpitPane[];
}

export interface CockpitSection {
  key: CockpitSectionKey;
  label: string;
  icon: typeof Waypoints;
  /** Where the section opens. */
  home: ProjectCockpitPane;
  tabs: CockpitTab[];
  /** Only for staff; a collaborator asking for it gets a 404. */
  staffOnly?: boolean;
}

/** The shared places, after the departments. */
export const SECTIONS: CockpitSection[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, home: 'overview', tabs: [{ pane: 'overview', label: 'Overview', icon: LayoutDashboard }] },
  { key: 'documents', label: 'Documents', icon: FileStack, home: 'evidence', tabs: [{ pane: 'evidence', label: 'Documents', icon: FileStack }] },
  {
    key: 'registers',
    label: 'Registers',
    icon: ClipboardList,
    home: 'dd',
    tabs: [
      { pane: 'dd', label: 'Checks', icon: ClipboardList, also: ['scope'] },
      { pane: 'findings', label: 'Findings', icon: Search },
      { pane: 'risks', label: 'Risks and actions', icon: GitBranch, also: ['actions'] },
      { pane: 'decisions', label: 'Decisions', icon: Scale },
      { pane: 'assets', label: 'Phases and assets', icon: Building2 },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: FileText,
    home: 'reports',
    tabs: [
      { pane: 'reports', label: 'Reports', icon: FileText },
      { pane: 'drafts', label: 'AI drafts', icon: Sparkles },
      { pane: 'orchestrate', label: 'Auto-run', icon: Workflow },
    ],
  },
  { key: 'people', label: 'People', icon: Users, home: 'people', staffOnly: true, tabs: [{ pane: 'people', label: 'People', icon: Users }] },
  { key: 'graph', label: 'Graph', icon: Waypoints, home: 'graph', tabs: [{ pane: 'graph', label: 'Graph', icon: Waypoints }] },
];

/** A department's name in the tab row: one word. */
export const DEPARTMENT_SHORT: Record<DepartmentKey, string> = {
  finance: 'Finance',
  legal: 'Legal',
  design: 'Design',
  construction: 'Construction',
  procurement: 'Procurement',
  commercial: 'Commercial',
};

/** The two workstreams whose page is an existing pane rather than the workstream page. */
export const WORKSTREAM_PANE: Record<string, ProjectCockpitPane> = {
  'finance.valuation': 'valuation',
  'construction.site': 'visits',
};

/** Which workstream a pane is, when it is one. */
export function workstreamOfPane(pane: ProjectCockpitPane, workstream?: string): string | undefined {
  if (pane === 'workstream') return workstream;
  return Object.entries(WORKSTREAM_PANE).find(([, p]) => p === pane)?.[0];
}

/** Which department a pane belongs to, when it belongs to one. */
export function departmentOfPane(pane: ProjectCockpitPane, at: { department?: string; workstream?: string }): DepartmentKey | undefined {
  if (pane === 'department') return at.department as DepartmentKey | undefined;
  const ws = workstreamOfPane(pane, at.workstream);
  return ws ? workstreamDefinition(ws)?.department : undefined;
}

/** Tabs a section shows in its second row: Auto-run is reachable, not listed. */
const HIDDEN_TABS: ReadonlySet<ProjectCockpitPane> = new Set(['orchestrate']);

const TABS = SECTIONS.flatMap((s) => s.tabs.map((t) => ({ section: s, tab: t })));

/** The section and tab a pane sits under, for the shared places. Department panes sit under Overview here. */
export function tabHolding(pane: ProjectCockpitPane): { section: CockpitSection; tab: CockpitTab } {
  return (
    TABS.find((r) => r.tab.pane === pane || r.tab.also?.includes(pane)) ??
    (TABS[0] as { section: CockpitSection; tab: CockpitTab })
  );
}

export function paneLabel(pane: ProjectCockpitPane, at: { department?: string; workstream?: string } = {}): string {
  if (pane === 'overview') return 'Overview';
  if (pane === 'scope') return 'Scope';
  if (pane === 'actions') return 'Risks and actions';
  if (pane === 'dd') return 'Checks';
  if (pane === 'valuation') return 'Valuation';
  if (pane === 'visits') return 'Site record';
  if (pane === 'department') return at.department ? departmentDefinition(at.department as DepartmentKey)?.label ?? 'Department' : 'Department';
  if (pane === 'workstream') return (at.workstream && workstreamDefinition(at.workstream)?.label) || 'Workstream';
  return tabHolding(pane).tab.label;
}

export function paneActive(current: ProjectCockpitPane, item: ProjectCockpitPane): boolean {
  if (current === item) return true;
  return tabHolding(current).tab.pane === item;
}

/** Counts that a person should not have to open a section to learn. */
export interface RailBadges {
  overdue: number;
  pendingDrafts: number;
}

function badgeFor(pane: ProjectCockpitPane, badges: RailBadges): number | null {
  if ((pane === 'risks' || pane === 'actions') && badges.overdue > 0) return badges.overdue;
  if (pane === 'drafts' && badges.pendingDrafts > 0) return badges.pendingDrafts;
  return null;
}

function sectionBadge(section: CockpitSection, badges: RailBadges): number | null {
  const total = section.tabs.reduce((sum, t) => sum + (badgeFor(t.pane, badges) ?? 0), 0);
  return total > 0 ? total : null;
}

const CHIP_SCROLL =
  'flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** Wide enough to wrap; narrow enough that a row has to scroll. */
function chipRow(wrap: boolean): string {
  return wrap ? 'flex flex-wrap gap-1.5' : CHIP_SCROLL;
}

/**
 * Whether a scroller has more to show, on each side.
 *
 * The chip row hides its scrollbar on purpose — a visible one across a
 * five-item tab strip is uglier than the problem it solves — but hiding it
 * removed the only thing saying the row scrolled at all. On a phone that put
 * Report off the right edge of Overview / Assess / Records / Value with
 * nothing to suggest it was there, so the last tab in the product's own
 * workflow order was invisible unless you happened to swipe.
 *
 * Measured rather than assumed: a fade painted unconditionally would sit at
 * the edge of a row that fits, implying content that does not exist.
 */
function useEdges(): [React.RefObject<HTMLDivElement>, { start: boolean; end: boolean }] {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // A couple of pixels of slack: sub-pixel widths otherwise leave a fade
      // showing at a scroll position that is visually the end.
      const maxScroll = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft < maxScroll - 2 });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  return [ref, edges];
}

/** The chip row, with a fade wherever it continues past the edge. */
function ChipScroller({ wrap, children }: { wrap: boolean; children: ReactNode }) {
  const [ref, edges] = useEdges();

  /*
   * The row scrolls to whichever chip is current.
   *
   * The fade says the row continues; it does not say the tab you are ON is
   * the one out of sight. Measured at 390px: standing on the report, the
   * Report tab sat at x=401 in a strip ending at 378, so the strip showed
   * four tabs none of which was marked — the reader's own position in the
   * file, off the edge, behind a swipe they had no reason to make.
   */
  useEffect(() => {
    const el = ref.current;
    const current = el?.querySelector<HTMLElement>('[aria-current]');
    if (!el || !current) return;
    const strip = el.getBoundingClientRect();
    const chip = current.getBoundingClientRect();
    if (chip.left >= strip.left - 1 && chip.right <= strip.right + 1) return;
    el.scrollTo({
      left: el.scrollLeft + (chip.left - strip.left) - (strip.width - chip.width) / 2,
      behavior: 'smooth',
    });
  });

  if (wrap) return <div className={chipRow(true)}>{children}</div>;
  return (
    <div className="relative min-w-0">
      <div ref={ref} className={chipRow(false)}>
        {children}
      </div>
      {/* `from-surface` because that is what the strip is painted on — a fade
          to transparent would show whatever is behind it instead. */}
      {edges.start ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent" />
      ) : null}
      {edges.end ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" />
      ) : null}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tabular rounded-full bg-warning/25 px-1.5 text-[10px] text-ink">{n}</span>;
}

/** Things waiting for a person's decision — the reader's ochre, not the warning amber of what is overdue. */
function WaitingCount({ n, label }: { n: number; label: string }) {
  return (
    <span className="tabular rounded-full bg-provenance/15 px-1.5 text-[10px] font-medium text-provenance-ink" aria-label={`${n} ${label}`}>
      {n}
    </span>
  );
}

type WaitingByPane = Partial<Record<ProjectCockpitPane, number>>;

function waitingOnTab(tab: CockpitTab, byPane: WaitingByPane): number {
  return [tab.pane, ...(tab.also ?? [])].reduce((n, p) => n + (byPane[p] ?? 0), 0);
}

type Go = (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string; department?: string; workstream?: string }) => void;

function SoonTag() {
  return <span className="rounded-full bg-sunken px-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">Soon</span>;
}

export function CockpitPaneStrip({
  pane,
  project,
  ddId,
  scopeId,
  department,
  workstream,
  overdue,
  pendingDrafts,
  onGo,
  waiting,
  onReview,
  wrap = false,
}: {
  pane: ProjectCockpitPane;
  project: DdProject;
  ddId?: string;
  scopeId?: string;
  /** From the route, on a department or workstream page. */
  department?: string;
  workstream?: string;
  overdue: number;
  pendingDrafts: number;
  onGo: Go;
  /** What waits for a decision, by pane: counted on its tab, and summed on the pill that walks them. */
  waiting?: { total: number; byPane: WaitingByPane };
  /** Go to the next thing waiting. */
  onReview?: () => void;
  wrap?: boolean;
}) {
  const badges = { overdue, pendingDrafts };
  const me = useMe();
  // Who else is on a file is the workspace's business. A collaborator asking
  // for it gets a 404, so showing them the tab would only be an invitation to
  // find that out.
  const staff = me ? reachesEveryProject(me.role) : false;
  const enabled = projectDepartments(project);
  const departments = DEPARTMENTS.filter((d) => enabled.includes(d.key));
  const activeDepartment = departmentOfPane(pane, { department, workstream });
  const activeWorkstream = workstreamOfPane(pane, workstream);
  const shared = SECTIONS.filter((section) => section.key !== 'overview' && (!section.staffOnly || staff));
  const here = activeDepartment ? null : tabHolding(pane).section;
  const tabs = here ? here.tabs.filter((t) => !HIDDEN_TABS.has(t.pane) || t.pane === pane) : [];

  const tab = (key: string, label: ReactNode, on: boolean, go: () => void, extra?: ReactNode, muted = false) => (
    <button
      key={key}
      type="button"
      onClick={go}
      aria-current={on ? 'true' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] -mb-px coarse:min-h-11',
        on ? 'border-brand font-semibold text-brand' : muted ? 'border-transparent text-ink-muted hover:text-ink-secondary' : 'border-transparent text-ink-secondary hover:border-hairline hover:text-ink',
      )}
    >
      {label}
      {extra}
    </button>
  );

  return (
    <div className={cn('shrink-0 border-b border-hairline bg-surface', wrap ? 'px-4' : 'px-3')}>
      {/* The rule the tabs sit on. The active one joins it; the rest stop short. */}
      <div className="flex items-center gap-2 border-b border-hairline pt-1">
        <div className="min-w-0 flex-1">
          <ChipScroller wrap={wrap}>
            {tab('overview', 'Overview', pane === 'overview', () => onGo('overview'))}
            {departments.map((d) =>
              tab(
                d.key,
                DEPARTMENT_SHORT[d.key],
                activeDepartment === d.key,
                () => onGo('department', { department: d.key }),
                d.status === 'coming_soon' ? <SoonTag /> : null,
                d.status === 'coming_soon',
              ),
            )}
            <span aria-hidden className="mx-1 my-2 w-px shrink-0 self-stretch bg-hairline" />
            {shared.map((section) => {
              const on = here?.key === section.key;
              const count = sectionBadge(section, badges);
              const toDecide = waiting ? section.tabs.reduce((n, t) => n + waitingOnTab(t, waiting.byPane), 0) : 0;
              return tab(
                section.key,
                section.label,
                on,
                () => onGo(section.home),
                <>
                  {toDecide > 0 ? <WaitingCount n={toDecide} label="waiting for you" /> : null}
                  {count != null ? <Count n={count} /> : null}
                </>,
              );
            })}
          </ChipScroller>
        </div>
        {/*
          The way through what is waiting: documents first, then the checks
          they answer, then the rest — one press at a time, wherever it is.
        */}
        {waiting && waiting.total > 0 && onReview ? (
          <button
            type="button"
            onClick={onReview}
            className="mb-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-provenance/10 px-2.5 py-1 text-[12px] font-medium text-provenance-ink ring-1 ring-inset ring-provenance/35 hover:bg-provenance/20 coarse:min-h-11"
          >
            <span className="size-1.5 rounded-full bg-provenance" aria-hidden />
            <span className="tabular-nums">{waiting.total}</span> to review
            <ArrowRight size={12} aria-hidden />
          </button>
        ) : null}
      </div>

      {activeDepartment ? (
        <div className="py-1.5">
          <ChipScroller wrap={wrap}>
            <button
              type="button"
              onClick={() => onGo('department', { department: activeDepartment })}
              aria-current={pane === 'department' ? 'true' : undefined}
              className={cn('inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[12px] coarse:min-h-11', pane === 'department' ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink-secondary')}
            >
              All work
            </button>
            {departmentDefinition(activeDepartment).workstreams.map((w) => {
              const on = activeWorkstream === w.key;
              return (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => onGo(WORKSTREAM_PANE[w.key] ?? 'workstream', { workstream: w.key })}
                  aria-current={on ? 'true' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] coarse:min-h-11',
                    on ? 'font-semibold text-ink' : w.status === 'live' ? 'text-ink-secondary hover:text-ink' : 'text-ink-muted hover:text-ink-secondary',
                  )}
                >
                  {w.label}
                  {w.status === 'coming_soon' ? <SoonTag /> : null}
                </button>
              );
            })}
          </ChipScroller>
        </div>
      ) : tabs.length > 1 ? (
        <div className="py-1.5">
          <ChipScroller wrap={wrap}>
            {tabs.map((t) => {
              const on = paneActive(pane, t.pane);
              const count = badgeFor(t.pane, badges);
              const toDecide = waiting ? waitingOnTab(t, waiting.byPane) : 0;
              return (
                <button
                  key={t.pane}
                  type="button"
                  onClick={() => onGo(t.pane)}
                  aria-current={on ? 'true' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] coarse:min-h-11',
                    on ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink-secondary',
                  )}
                >
                  {t.label}
                  {toDecide > 0 ? <WaitingCount n={toDecide} label="waiting for you" /> : null}
                  {count != null ? <Count n={count} /> : null}
                </button>
              );
            })}
          </ChipScroller>
        </div>
      ) : null}
      {/* Inside Checks, which assessment and which scope. */}
      {here?.key === 'registers' && (pane === 'dd' || pane === 'scope') && project.assessments.length > 0 ? (
        <div className="border-t border-hairline py-1.5">
          <AssessNav project={project} ddId={ddId} scopeId={scopeId} onGo={onGo} wrap={wrap} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Assess navigates a tree, not a list of tabs: which assessment, then which
 * scope. Past a handful of assessments a row of chips stops being scannable,
 * so it becomes a menu that says which one you are in.
 */
const CHIPS_UNTIL = 4;

function AssessNav({
  project,
  ddId,
  scopeId,
  onGo,
  wrap,
}: {
  project: DdProject;
  ddId?: string;
  scopeId?: string;
  onGo: (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string }) => void;
  wrap: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => project.assessments.filter((a) => a.status !== 'archived'), [project.assessments]);
  const current = rows.find((a) => a.id === ddId);
  if (rows.length === 0) return null;

  const picker =
    rows.length <= CHIPS_UNTIL ? (
      <ChipScroller wrap={wrap}>
        <button
          type="button"
          onClick={() => onGo('dd')}
          aria-current={!ddId ? 'true' : undefined}
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[12px] coarse:min-h-11',
            !ddId ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:text-ink',
          )}
        >
          All DDs
        </button>
        {rows.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onGo('dd', { ddId: a.id })}
            aria-current={ddId === a.id ? 'true' : undefined}
            className={cn(
              'inline-flex max-w-[14rem] shrink-0 items-center truncate rounded-full px-2.5 py-1 text-[12px] coarse:min-h-11',
              ddId === a.id ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:text-ink',
            )}
          >
            {a.name}
          </button>
        ))}
      </ChipScroller>
    ) : (
      <div className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[12px] text-ink-secondary hover:text-ink coarse:min-h-11"
        >
          <span className="truncate">{current ? current.name : `All assessments (${rows.length})`}</span>
          <ChevronDown size={12} />
        </button>
        {ddId ? (
          <button
            type="button"
            onClick={() => onGo('dd')}
            className="text-[12px] text-ink-muted hover:text-ink coarse:min-h-11"
          >
            All
          </button>
        ) : null}
        {open ? (
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
            />
            <ul className="absolute left-0 top-full z-40 mt-1 max-h-72 w-[20rem] overflow-y-auto rounded-lg bg-surface p-1 shadow-pop ring-1 ring-[var(--ring)]">
              {rows.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onGo('dd', { ddId: a.id });
                    }}
                    className={cn(
                      'w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-sunken coarse:min-h-11',
                      ddId === a.id ? 'font-medium text-brand' : 'text-ink-secondary',
                    )}
                  >
                    {a.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    );

  return (
    <>
      {picker}
      {current && current.scopes.length > 0 ? (
        <ChipScroller wrap={wrap}>
          {current.scopes.map((scope) => {
            const c = scopeCompleteness(scope);
            const on = scopeId === scope.id;
            return (
              <button
                key={scope.id}
                type="button"
                onClick={() => onGo('scope', { ddId: current.id, scopeId: scope.id })}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] coarse:min-h-11',
                  on ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink-secondary',
                )}
              >
                {SCOPE_LABEL[scope.scopeKey]}
                <span className="tabular text-[10px] text-ink-muted">{c.done}/{c.total}</span>
              </button>
            );
          })}
        </ChipScroller>
      ) : null}
    </>
  );
}
