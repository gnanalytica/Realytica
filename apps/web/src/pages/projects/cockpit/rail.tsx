import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
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
 * Navigation in two rows rather than thirteen chips.
 *
 * The first row is the five things a file is: what it looks like, what is
 * being assessed, what has been recorded, what it is worth, what goes out.
 * The second row is where you are inside that — sub-tabs for most sections,
 * and for Assess the actual assessment and its scopes, because "which DD am
 * I in" is a navigation question, not a page.
 *
 * Every pane keeps its route. Consolidation here is about what is on screen
 * at once, not about removing surfaces.
 */

export type CockpitSectionKey = 'overview' | 'assess' | 'records' | 'valuation' | 'report';

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
}

export const SECTIONS: CockpitSection[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    home: 'overview',
    tabs: [
      { pane: 'overview', label: 'Summary', icon: LayoutDashboard },
      { pane: 'graph', label: 'Graph', icon: Waypoints },
      { pane: 'people', label: 'People', icon: Users },
    ],
  },
  {
    key: 'assess',
    label: 'Assess',
    icon: ClipboardList,
    home: 'dd',
    tabs: [{ pane: 'dd', label: 'Assessments', icon: ClipboardList, also: ['scope'] }],
  },
  {
    key: 'records',
    label: 'Records',
    icon: FileStack,
    home: 'evidence',
    tabs: [
      { pane: 'evidence', label: 'Evidence', icon: FileStack },
      { pane: 'visits', label: 'Site', icon: Camera },
      { pane: 'findings', label: 'Findings', icon: Search },
      { pane: 'risks', label: 'Risks', icon: GitBranch, also: ['actions'] },
      { pane: 'decisions', label: 'Decisions', icon: Scale },
      { pane: 'assets', label: 'Assets', icon: Building2 },
    ],
  },
  {
    key: 'valuation',
    label: 'Value',
    icon: CircleDollarSign,
    home: 'valuation',
    tabs: [{ pane: 'valuation', label: 'Valuation', icon: CircleDollarSign }],
  },
  {
    key: 'report',
    label: 'Report',
    icon: FileText,
    home: 'reports',
    tabs: [
      { pane: 'reports', label: 'Reports', icon: FileText },
      { pane: 'drafts', label: 'Drafts', icon: Sparkles },
      { pane: 'orchestrate', label: 'Auto-run', icon: Workflow },
    ],
  },
];

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
  if (pane === 'actions') return 'Risks & actions';
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
  const badges = { overdue, pendingDrafts };
  const me = useMe();
  const here = tabHolding(pane).section;

  // Who else is on a file is the workspace's business. A collaborator asking
  // for it gets a 404, so showing them the tab would only be an invitation to
  // find that out.
  const tabs = here.tabs.filter((t) => t.pane !== 'people' || (me ? reachesEveryProject(me.role) : false));

  return (
    <div className={cn('shrink-0 space-y-1.5 border-b border-hairline bg-surface py-2', wrap ? 'px-4' : 'px-3')}>
      <ChipScroller wrap={wrap}>
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const on = section.key === here.key;
          const count = sectionBadge(section, badges);
          return (
            <button
              key={section.key}
              type="button"
              onClick={() => onGo(section.home)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] coarse:min-h-11',
                on ? 'bg-brand-soft font-semibold text-brand' : 'bg-sunken text-ink-secondary hover:text-ink',
              )}
            >
              <Icon size={13} />
              {section.label}
              {count != null ? <Count n={count} /> : null}
            </button>
          );
        })}
      </ChipScroller>

      {here.key === 'assess' ? (
        <AssessNav project={project} ddId={ddId} scopeId={scopeId} onGo={onGo} wrap={wrap} />
      ) : tabs.length > 1 ? (
        <ChipScroller wrap={wrap}>
          {tabs.map((tab) => {
            const on = paneActive(pane, tab.pane);
            const count = badgeFor(tab.pane, badges);
            return (
              <button
                key={tab.pane}
                type="button"
                onClick={() => onGo(tab.pane)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] coarse:min-h-11',
                  on ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:text-ink',
                )}
              >
                {tab.label}
                {count != null ? <Count n={count} /> : null}
              </button>
            );
          })}
        </ChipScroller>
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
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11.5px] coarse:min-h-11',
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
              'inline-flex max-w-[14rem] shrink-0 items-center truncate rounded-full px-2.5 py-1 text-[11.5px] coarse:min-h-11',
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
          className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[11.5px] text-ink-secondary hover:text-ink coarse:min-h-11"
        >
          <span className="truncate">{current ? current.name : `All assessments (${rows.length})`}</span>
          <ChevronDown size={12} />
        </button>
        {ddId ? (
          <button
            type="button"
            onClick={() => onGo('dd')}
            className="text-[11.5px] text-ink-muted hover:text-ink coarse:min-h-11"
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
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] coarse:min-h-11',
                  on ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:text-ink',
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
