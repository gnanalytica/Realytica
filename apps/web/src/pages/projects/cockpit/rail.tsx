import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Building2,
  Camera,
  ChevronDown,
  CircleDollarSign,
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
  SCOPE_LABEL,
  reachesEveryProject,
  scopeCompleteness,
  type DdProject,
  type ProjectCockpitPane,
} from '@realytica/shared';
import { cn } from '../../../components/ui/kit';
import { useMe } from '../../../lib/useMe';

/**
 * Eight views, one row.
 *
 * The workspace is a conversation beside a canvas, and the canvas has eight
 * views: what the file is, its documents, the site, its value, the technical
 * DD, the people on it, the report, and the graph behind all of them. Only
 * Technical DD and Report carry a second row, for the registers and drafts
 * that belong to them.
 *
 * Every pane keeps its route. Auto-run is still reachable by address and from
 * the command bar; it is not a view a firm opens during an engagement.
 */

export type CockpitSectionKey = 'overview' | 'documents' | 'site' | 'value' | 'tdd' | 'people' | 'report' | 'graph';

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

export const SECTIONS: CockpitSection[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, home: 'overview', tabs: [{ pane: 'overview', label: 'Overview', icon: LayoutDashboard }] },
  { key: 'documents', label: 'Documents', icon: FileStack, home: 'evidence', tabs: [{ pane: 'evidence', label: 'Documents', icon: FileStack }] },
  { key: 'site', label: 'Site', icon: Camera, home: 'visits', tabs: [{ pane: 'visits', label: 'Site', icon: Camera }] },
  { key: 'value', label: 'Value', icon: CircleDollarSign, home: 'valuation', tabs: [{ pane: 'valuation', label: 'Value', icon: CircleDollarSign }] },
  {
    key: 'tdd',
    label: 'Technical DD',
    icon: ClipboardList,
    home: 'dd',
    tabs: [
      { pane: 'dd', label: 'Checks', icon: ClipboardList, also: ['scope'] },
      { pane: 'findings', label: 'Findings', icon: Search },
      { pane: 'risks', label: 'Risks and actions', icon: GitBranch, also: ['actions'] },
      { pane: 'decisions', label: 'Decisions', icon: Scale },
      { pane: 'assets', label: 'Assets', icon: Building2 },
    ],
  },
  { key: 'people', label: 'People', icon: Users, home: 'people', staffOnly: true, tabs: [{ pane: 'people', label: 'People', icon: Users }] },
  {
    key: 'report',
    label: 'Report',
    icon: FileText,
    home: 'reports',
    tabs: [
      { pane: 'reports', label: 'Reports', icon: FileText },
      { pane: 'drafts', label: 'AI drafts', icon: Sparkles },
      { pane: 'orchestrate', label: 'Auto-run', icon: Workflow },
    ],
  },
  { key: 'graph', label: 'Graph', icon: Waypoints, home: 'graph', tabs: [{ pane: 'graph', label: 'Graph', icon: Waypoints }] },
];

/** Tabs a section shows in its second row: Auto-run is reachable, not listed. */
const HIDDEN_TABS: ReadonlySet<ProjectCockpitPane> = new Set(['orchestrate']);

const TABS = SECTIONS.flatMap((s) => s.tabs.map((t) => ({ section: s, tab: t })));

export function tabHolding(pane: ProjectCockpitPane): { section: CockpitSection; tab: CockpitTab } {
  return (
    TABS.find((r) => r.tab.pane === pane || r.tab.also?.includes(pane)) ??
    (TABS[0] as { section: CockpitSection; tab: CockpitTab })
  );
}

export function sectionOf(pane: ProjectCockpitPane): CockpitSectionKey {
  return tabHolding(pane).section.key;
}

export function paneLabel(pane: ProjectCockpitPane): string {
  // Where a tab label only makes sense next to its siblings ("Summary" under
  // Overview), the standalone name is the section's.
  if (pane === 'overview') return 'Overview';
  if (pane === 'scope') return 'Scope';
  if (pane === 'actions') return 'Risks and actions';
  if (pane === 'dd') return 'Technical DD';
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

export function CockpitPaneStrip({
  pane,
  project,
  ddId,
  scopeId,
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
  overdue: number;
  pendingDrafts: number;
  onGo: (pane: ProjectCockpitPane, extra?: { ddId?: string; scopeId?: string }) => void;
  /** What waits for a decision, by pane: counted on its tab, and summed on the pill that walks them. */
  waiting?: { total: number; byPane: WaitingByPane };
  /** Go to the next thing waiting. */
  onReview?: () => void;
  wrap?: boolean;
}) {
  const badges = { overdue, pendingDrafts };
  const me = useMe();
  const here = tabHolding(pane).section;

  // Who else is on a file is the workspace's business. A collaborator asking
  // for it gets a 404, so showing them the tab would only be an invitation to
  // find that out.
  const staff = me ? reachesEveryProject(me.role) : false;
  const sections = SECTIONS.filter((section) => !section.staffOnly || staff);
  const tabs = here.tabs.filter((t) => !HIDDEN_TABS.has(t.pane) || t.pane === pane);

  return (
    <div className={cn('shrink-0 border-b border-hairline bg-surface', wrap ? 'px-4' : 'px-3')}>
      {/* The rule the tabs sit on. The active one joins it; the rest stop short. */}
      <div className="flex items-center gap-2 border-b border-hairline pt-1">
      <div className="min-w-0 flex-1">
      <ChipScroller wrap={wrap}>
        {sections.map((section) => {
          const on = section.key === here.key;
          const count = sectionBadge(section, badges);
          const toDecide = waiting ? section.tabs.reduce((n, t) => n + waitingOnTab(t, waiting.byPane), 0) : 0;
          return (
            <button
              key={section.key}
              type="button"
              onClick={() => onGo(section.home)}
              aria-current={on ? 'true' : undefined}
              /*
                Sections are tabs; the row under them is not.

                Both rows were pills, at two sizes, so the primary divisions of
                a file and the panes inside one of them read as a single blurry
                mass of the same control. A tab is the right shape for "which
                part of this am I in" — it sits on a rule, it marks the current
                one by joining it, and nothing else in the product looks like
                it. The row beneath can then be plain text, because it no
                longer has to compete for a shape.
              */
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] -mb-px coarse:min-h-11',
                on
                  ? 'border-brand font-semibold text-brand'
                  : 'border-transparent text-ink-secondary hover:border-hairline hover:text-ink',
              )}
            >
              {/* Words only: eight icons beside eight words wrapped the row
                  onto two lines beside a wide conversation. */}
              {section.label}
              {toDecide > 0 ? <WaitingCount n={toDecide} label="waiting for you" /> : null}
              {count != null ? <Count n={count} /> : null}
            </button>
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

      {tabs.length > 1 ? (
        <div className="py-1.5">
        <ChipScroller wrap={wrap}>
          {tabs.map((tab) => {
            const on = paneActive(pane, tab.pane);
            const count = badgeFor(tab.pane, badges);
            const toDecide = waiting ? waitingOnTab(tab, waiting.byPane) : 0;
            return (
              <button
                key={tab.pane}
                type="button"
                onClick={() => onGo(tab.pane)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] coarse:min-h-11',
                  on ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink-secondary',
                )}
              >
                {tab.label}
                {toDecide > 0 ? <WaitingCount n={toDecide} label="waiting for you" /> : null}
                {count != null ? <Count n={count} /> : null}
              </button>
            );
          })}
        </ChipScroller>
        </div>
      ) : null}
      {/* Inside Checks, which assessment and which scope. */}
      {here.key === 'tdd' && (pane === 'dd' || pane === 'scope') && project.assessments.length > 0 ? (
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
