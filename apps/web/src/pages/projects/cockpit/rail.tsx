import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Building2,
  ChevronDown,
  ClipboardList,
  FileStack,
  FileText,
  GitBranch,
  LayoutDashboard,
  Scale,
  Search,
  Send,
  Sparkles,
  Table2,
  Users,
  Waypoints,
  Workflow,
} from 'lucide-react';
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_SHORT,
  MENU_DEPARTMENTS,
  SCOPE_LABEL,
  departmentDefinition,
  menuAt,
  menuDepartment,
  menuDepartmentsOf,
  menuFunctions,
  projectDepartments,
  reachesEveryProject,
  scopeCompleteness,
  workstreamDefinition,
  type DdProject,
  type DepartmentKey,
  type MenuPlace,
  type MenuStage,
  type ProjectCockpitPane,
  type StageKey,
} from '@realytica/shared';
import { cn } from '../../../components/ui/kit';
import { DepartmentPicker, FunctionTabs, type FunctionTab, type PickerItem } from '../../../components/workspace/WorkspaceBar';
import { SPRING, motion } from '../../../lib/motion';
import { useEdges } from '../../../lib/useEdges';
import { useMe } from '../../../lib/useMe';

/**
 * How a person moves around a project.
 *
 * One selector says where you are: Overview, one of the five departments, or
 * a place the whole project shares — the document vault, the registers,
 * reports, people and the graph. Inside a department the row under it is its
 * functions, one tab each, with a Summary first for what belongs to the
 * department as a whole.
 *
 * Both follow the stage being looked at: a department is listed while one of
 * its functions shows at that stage, and a function has a tab while it does.
 * The two lists come from `menuDepartmentsOf` and `menuFunctions`, the same
 * two the graph is drawn from, so the menu and the graph cannot disagree
 * about what a department holds.
 *
 * A function that is not built yet is still listed, in a quieter ink, because
 * knowing it will be there is part of knowing what the department is for.
 * Every pane keeps its route, so the chat can still take a person anywhere by
 * name.
 */

export type CockpitSectionKey = 'overview' | DepartmentKey | 'documents' | 'review' | 'registers' | 'reports' | 'people' | 'graph';

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

/**
 * Overview, and the places the whole project shares.
 *
 * A department's own documents, records and reports sit on its pages; these
 * are the same things across every department. They are listed under the
 * departments in the selector, and Overview links to them too.
 */
export const SECTIONS: CockpitSection[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, home: 'overview', tabs: [{ pane: 'overview', label: 'Overview', icon: LayoutDashboard }] },
  { key: 'documents', label: 'Documents', icon: FileStack, home: 'evidence', tabs: [{ pane: 'evidence', label: 'Documents', icon: FileStack }] },
  { key: 'review', label: 'Review', icon: Table2, home: 'review', staffOnly: true, tabs: [{ pane: 'review', label: 'Review', icon: Table2 }] },
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
      { pane: 'outgoing', label: 'Outgoing', icon: Send },
      { pane: 'drafts', label: 'AI drafts', icon: Sparkles },
      { pane: 'orchestrate', label: 'Auto-run', icon: Workflow },
    ],
  },
  { key: 'people', label: 'People', icon: Users, home: 'people', staffOnly: true, tabs: [{ pane: 'people', label: 'People', icon: Users }] },
  { key: 'graph', label: 'Graph', icon: Waypoints, home: 'graph', tabs: [{ pane: 'graph', label: 'Graph', icon: Waypoints }] },
];

/*
 * The menu's own words (the five departments, a department's one word, a
 * function's one word, and which menu department a department sits under)
 * are in `@realytica/shared`, beside the departments themselves, because the
 * graph draws the same five departments and the same functions.
 */

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
  // An address can name anything. One that names no department is none: its page sends the reader to Overview, and the bar must not fall over first.
  if (pane === 'department') return DEPARTMENT_KEYS.find((key) => key === at.department);
  const ws = workstreamOfPane(pane, at.workstream);
  return ws ? workstreamDefinition(ws)?.department : undefined;
}

/**
 * Where a pane is in the menu: its department there, and its function when
 * the page is one function's. Design's own pages are the function Design,
 * under Engineering. Overview and the shared places are neither.
 */
export function menuPlaceOf(pane: ProjectCockpitPane, at: { department?: string; workstream?: string }): MenuPlace {
  const department = departmentOfPane(pane, at);
  if (!department) return {};
  return { department: menuDepartment(department), fn: department === 'design' ? 'design' : workstreamOfPane(pane, at.workstream) };
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
  if (pane === 'department') return (at.department && DEPARTMENT_SHORT[at.department as DepartmentKey]) || 'Department';
  if (pane === 'workstream') return (at.workstream && workstreamDefinition(at.workstream)?.label) || 'Function';
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

const CHIP_SCROLL =
  'flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** Wide enough to wrap; narrow enough that a row has to scroll. */
function chipRow(wrap: boolean): string {
  return wrap ? 'flex flex-wrap gap-1.5' : CHIP_SCROLL;
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
  return <span className="tabular min-w-[1.25rem] rounded-full bg-warning/20 px-1.5 text-center font-mono text-[10px] font-medium leading-4 text-[var(--status-warning-text)]">{n}</span>;
}

/** Things waiting for a person's decision — the reader's blue, not the warning amber of what is overdue. */
function WaitingCount({ n, label }: { n: number; label: string }) {
  return (
    <span className="tabular min-w-[1.25rem] rounded-full bg-ai/12 px-1.5 text-center font-mono text-[10px] font-medium leading-4 text-ai-ink" aria-label={`${n} ${label}`}>
      {n}
    </span>
  );
}

type WaitingByPane = Partial<Record<ProjectCockpitPane, number>>;

function waitingOnTab(tab: CockpitTab, byPane: WaitingByPane): number {
  return [tab.pane, ...(tab.also ?? [])].reduce((n, p) => n + (byPane[p] ?? 0), 0);
}

type Go = (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string; department?: string; workstream?: string }) => void;

/**
 * A shared place's own tabs (Checks, Findings, Risks and actions…): a
 * segmented control whose selection slides.
 *
 * They are siblings of one thing — the pill travelling between them says
 * that, where a row of separately-highlighted words did not.
 */
function Segments({
  items,
  wrap,
}: {
  items: Array<{ key: string; label: ReactNode; on: boolean; go: () => void; extra?: ReactNode }>;
  wrap: boolean;
}) {
  const group = useId();
  return (
    <ChipScroller wrap={wrap}>
      <div className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-sunken p-0.5 ring-1 ring-inset ring-[var(--ring)]">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.go}
            aria-current={item.on ? 'true' : undefined}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-[12px] coarse:min-h-11',
              'transition-colors duration-quick ease-state',
              item.on ? 'font-semibold text-ink' : 'text-ink-secondary hover:text-ink',
            )}
          >
            {item.on ? (
              <motion.span
                layoutId={`seg-${group}`}
                aria-hidden
                className="absolute inset-0 rounded-[10px] bg-surface shadow-card ring-1 ring-[var(--ring)]"
                transition={SPRING.snappy}
              />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">
              {item.label}
              {item.extra}
            </span>
          </button>
        ))}
      </div>
    </ChipScroller>
  );
}

/** Which entry of the selector a pane is under: Overview, a department of the menu, or a shared place. */
function placeOf(pane: ProjectCockpitPane, at: { department?: string; workstream?: string }): string {
  const department = departmentOfPane(pane, at);
  return department ? menuDepartment(department) : tabHolding(pane).section.key;
}

/**
 * The selector that says where in the project you are, and takes you
 * anywhere else in it.
 *
 * It lives in the app's top bar on a wide screen, after the project's name,
 * and under the project's name in the header on a phone.
 */
export function ProjectPicker({
  pane,
  project,
  stage,
  department,
  workstream,
  onGo,
  waiting,
  dense = false,
}: {
  pane: ProjectCockpitPane;
  project: DdProject;
  /** The stage being looked at. */
  stage: StageKey;
  department?: string;
  workstream?: string;
  onGo: Go;
  waiting?: { byPane: WaitingByPane };
  /** In a phone's header, under the project's name. */
  dense?: boolean;
}) {
  const me = useMe();
  // Who else is on a file is the workspace's business. A collaborator asking
  // for it gets a 404, so listing People would only be an invitation to find
  // that out.
  const staff = me ? reachesEveryProject(me.role) : false;
  const listed = useMemo(() => menuDepartmentsOf(projectDepartments(project), menuAt(project, stage)), [project, stage]);
  const current = placeOf(pane, { department, workstream });
  const overview = SECTIONS[0]!;
  // The department you are standing in is listed too, switched off or with nothing at this stage, so the selector
  // never names somewhere else.
  const departments: PickerItem[] = MENU_DEPARTMENTS.filter((key) => listed.includes(key) || key === current).map((key) => {
    const soon = departmentDefinition(key).status === 'coming_soon';
    // A department is marked for what waits on a page of its own: Valuation's, or the Site record's.
    const holds = waiting ? departmentDefinition(key).workstreams.some((w) => WORKSTREAM_PANE[w.key] && waiting.byPane[WORKSTREAM_PANE[w.key]!]) : false;
    return { key, label: DEPARTMENT_SHORT[key], note: soon ? 'Coming soon' : undefined, muted: soon, waiting: holds };
  });
  const shared: PickerItem[] = SECTIONS.filter((section) => section.key !== 'overview' && (!section.staffOnly || staff)).map((section) => ({
    key: section.key,
    label: section.label,
    icon: section.icon,
    waiting: waiting ? section.tabs.some((t) => waitingOnTab(t, waiting.byPane) > 0) : false,
  }));
  const label = departments.find((d) => d.key === current)?.label ?? shared.find((p) => p.key === current)?.label ?? overview.label;

  return (
    <DepartmentPicker
      label={label}
      current={current}
      waiting={waiting ? Object.values(waiting.byPane).some((n) => (n ?? 0) > 0) : false}
      dense={dense}
      groups={[[{ key: overview.key, label: overview.label, icon: overview.icon }], departments, shared]}
      onPick={(key) => {
        const section = SECTIONS.find((x) => x.key === key);
        if (section) onGo(section.home);
        else onGo('department', { department: key });
      }}
    />
  );
}

/**
 * A department's functions as tabs: Summary, then each function that shows
 * at the stage being looked at, with Design leading Engineering's.
 *
 * A function has a tab while its own department is switched on: Design's
 * while Design is, Engineering's own while Engineering is. The one you are
 * standing on keeps its tab whatever the stage, so the row never leaves out
 * the page on screen. The dot marks the functions whose page is a pane of
 * its own (Valuation, Site), the only ones the waiting list is kept by today.
 */
function functionTabs(menu: DepartmentKey, enabled: readonly DepartmentKey[], at: MenuStage, standing: string | undefined, byPane: WaitingByPane): FunctionTab[] {
  const shown = new Set(menuFunctions(menu, at).filter((fn) => enabled.includes(fn.department)).map((fn) => fn.key));
  return [
    { key: 'summary', label: 'Summary' },
    ...menuFunctions(menu)
      .filter((fn) => shown.has(fn.key) || fn.key === standing)
      .map((fn) => ({
        key: fn.key,
        label: fn.label,
        muted: !fn.built,
        waiting: Boolean(WORKSTREAM_PANE[fn.key] && byPane[WORKSTREAM_PANE[fn.key]!]),
      })),
  ];
}

export function CockpitPaneStrip({
  pane,
  project,
  stage,
  ddId,
  scopeId,
  department,
  workstream,
  overdue,
  pendingDrafts,
  onGo,
  waiting,
  wrap = false,
}: {
  pane: ProjectCockpitPane;
  project: DdProject;
  /** The stage being looked at. */
  stage: StageKey;
  ddId?: string;
  scopeId?: string;
  /** From the route, on a department or workstream page. */
  department?: string;
  workstream?: string;
  overdue: number;
  pendingDrafts: number;
  onGo: Go;
  /** What waits for a decision, by pane: marked on its tab. */
  waiting?: { total: number; byPane: WaitingByPane };
  wrap?: boolean;
}) {
  const badges = { overdue, pendingDrafts };
  const me = useMe();
  const at = useMemo(() => menuAt(project, stage), [project, stage]);
  const { department: menu, fn } = menuPlaceOf(pane, { department, workstream });
  const here = menu ? null : tabHolding(pane).section;
  // What goes out is the workspace's own people's: somebody working from a grant is not shown the tab.
  const tabs = here ? here.tabs.filter((t) => (!HIDDEN_TABS.has(t.pane) || t.pane === pane) && (t.pane !== 'outgoing' || !me || reachesEveryProject(me.role))) : [];
  const assess = here?.key === 'registers' && (pane === 'dd' || pane === 'scope') && project.assessments.length > 0;

  const second = menu ? (
    <FunctionTabs
      className="min-w-0 flex-1"
      tabs={functionTabs(menu, projectDepartments(project), at, fn, waiting?.byPane ?? {})}
      current={fn ?? 'summary'}
      onPick={(key) => {
        if (key === 'summary') onGo('department', { department: menu });
        else if (key === 'design') onGo('department', { department: 'design' });
        else onGo(WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key });
      }}
    />
  ) : tabs.length > 1 ? (
    <div className="min-w-0 flex-1 py-2">
      <Segments
        wrap={false}
        items={tabs.map((t) => {
          const count = badgeFor(t.pane, badges);
          const toDecide = waiting ? waitingOnTab(t, waiting.byPane) : 0;
          return {
            key: t.pane,
            label: t.label,
            on: paneActive(pane, t.pane),
            go: () => onGo(t.pane),
            extra: (
              <>
                {toDecide > 0 ? <WaitingCount n={toDecide} label="waiting for you" /> : null}
                {count != null ? <Count n={count} /> : null}
              </>
            ),
          };
        })}
      />
    </div>
  ) : null;

  // Overview has nothing to put here: where you are is said in the bar above.
  if (!second && !assess) return null;

  return (
    <div className={cn('shrink-0 border-b border-hairline bg-surface', wrap ? 'px-4' : 'px-3')}>
      {second ? <div className="flex items-center gap-2">{second}</div> : null}
      {/* Inside Checks, which assessment and which scope. */}
      {assess ? (
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
