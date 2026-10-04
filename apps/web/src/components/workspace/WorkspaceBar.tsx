import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '../ui/kit';
import { AnimatePresence, EASE_ENTER, SPRING, motion } from '../../lib/motion';
import { useEdges } from '../../lib/useEdges';

/**
 * The menu of a project's workspace, in three pieces.
 *
 * - **Where you are** is one selector: the department, with Overview above
 *   the departments and the places shared by the whole project below them.
 * - **When** is a track of the four stages, always on screen. A stage is the
 *   state of the property, so it has no steps under it.
 * - **What** is a row of tabs, one for each function of the department,
 *   sharing the row equally.
 *
 * The three are separate components because the project screen and the
 * example project lay them out in different rows; neither knows anything
 * about a project, so both can feed them.
 */

/* ==================================================================== */
/* The selector                                                          */
/* ==================================================================== */

export interface PickerItem {
  key: string;
  label: string;
  /** One quiet line under the name. */
  note?: string;
  icon?: LucideIcon;
  /** Something here waits for a person. */
  waiting?: boolean;
  /** Listed, with nothing to work on yet. */
  muted?: boolean;
}

export function DepartmentPicker({
  label,
  groups,
  current,
  onPick,
  waiting = false,
  dense = false,
  className,
}: {
  /** What the closed selector says: the department or place you are in. */
  label: string;
  /** Something in the project waits for a person: a dot on the closed selector, and the menu says where. */
  waiting?: boolean;
  /** Each group is ruled off from the one before. */
  groups: PickerItem[][];
  current: string;
  onPick: (key: string) => void;
  /** For a phone's header, where it sits under the project's name: smaller type, the same press. */
  dense?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /** Closing by keyboard hands focus back to the button; closing by a press elsewhere leaves it where the press put it. */
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  // Opened, the menu takes focus on the place you are in, so the arrow keys start from there.
  useEffect(() => {
    if (!open) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = (index: number) => {
      e.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') to(at + 1);
    else if (e.key === 'ArrowUp') to(at - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    // A block of its own, not an inline one: it takes its column's width, so a long name truncates instead of running under what stands beside it.
    <div ref={box} className={cn('relative flex min-w-0', className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) close(true);
          else if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          // Pulled left by its own padding so the name lines up with what is under it; its width may then pass its box by as much.
          '-ml-[7px] inline-flex min-w-0 max-w-[calc(100%+7px)] items-center gap-[7px] rounded-lg px-[7px] font-semibold tracking-[-0.015em] text-ink',
          'transition-colors duration-quick ease-state hover:bg-sunken',
          // Dense keeps a 44px press without the height: the hit area grows, the button does not.
          dense ? 'relative min-h-7 text-[15px] before:absolute before:-inset-y-2 before:inset-x-0' : 'min-h-8 text-[17px] coarse:min-h-11',
          open && 'bg-sunken',
        )}
      >
        <span className="truncate">{label}</span>
        {waiting ? <WaitDot title="Something in the project waits for you" /> : null}
        <ChevronDown size={13} aria-hidden className={cn('shrink-0 text-ink-muted transition-transform duration-base ease-enter', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menu}
            role="menu"
            aria-label="Where in the project"
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: EASE_ENTER }}
            className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-[min(34rem,calc(100dvh-8rem))] w-max min-w-[15.5rem] max-w-[min(20rem,86vw)] origin-top-left overflow-y-auto rounded-xl bg-surface p-1.5 shadow-pop ring-1 ring-[var(--ring)]"
          >
            {groups
              .filter((g) => g.length)
              .map((group, gi) => (
                <div key={group[0]!.key} className={cn(gi > 0 && 'mt-1 border-t border-hairline pt-1')}>
                  {group.map((item) => {
                    const on = item.key === current;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitemradio"
                        aria-checked={on}
                        onClick={() => {
                          close(true);
                          onPick(item.key);
                        }}
                        className={cn(
                          'grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                          'min-h-11 transition-colors duration-quick ease-state',
                          on ? 'bg-brand-soft' : 'hover:bg-page focus-visible:bg-page',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'grid size-[26px] place-items-center rounded-lg font-mono text-[11px] font-medium',
                            on ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink-secondary',
                          )}
                        >
                          {item.icon ? <item.icon size={14} /> : item.label[0]}
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block truncate text-[13px] font-semibold', item.muted && !on ? 'text-ink-secondary' : 'text-ink')}>{item.label}</span>
                          {item.note ? <span className="block truncate text-[12px] text-ink-muted">{item.note}</span> : null}
                        </span>
                        {item.waiting ? <WaitDot /> : <span />}
                      </button>
                    );
                  })}
                </div>
              ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Something here waits for a person: the copilot's blue, never a count. */
export function WaitDot({ title = 'Something waits for you here' }: { title?: string }) {
  return <span title={title} aria-label={title} role="img" className="inline-block size-[7px] shrink-0 rounded-full bg-ai" />;
}

/* ==================================================================== */
/* The stages                                                            */
/* ==================================================================== */

export interface TrackStage {
  key: string;
  label: string;
  /** Behind the project, where it is now, or still ahead of it. */
  when: 'past' | 'now' | 'future';
}

const WHEN_WORD: Record<TrackStage['when'], string> = { past: 'done', now: 'current stage', future: 'not yet due' };

/**
 * The four stages on one line, joined by a rule that is green as far as the
 * project has come.
 *
 * Every stage can be pressed: what a press does (look at that stage's work,
 * open what was filed in it) is the caller's business.
 *
 * The track measures itself: give it the free space of its row (`flex-1`) and
 * it sits at the right-hand end of it. Where that space is too short for four
 * names, only the stage in view keeps its name; the rings alone still say how
 * far along the project is, and each says its name on hover. It never gets
 * narrower than four rings and the longest name, so it cannot be squeezed
 * onto its neighbours.
 */
export function StageTrack({
  stages,
  picked,
  onPick,
  className,
}: {
  stages: TrackStage[];
  /** The stage being looked at, when one is. */
  picked?: string | null;
  onPick: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('min-w-[16rem] [container-type:inline-size]', className)}>
      <nav aria-label="Stages" className="flex min-w-0 items-center justify-end">
        {stages.map((stage, i) => {
          const on = picked === stage.key;
          const named = on || (!picked && stage.when === 'now');
          const says = `${stage.label}: ${WHEN_WORD[stage.when]}`;
          return (
            <span key={stage.key} className="contents">
              {i > 0 ? (
                <span
                  aria-hidden
                  className={cn('h-[2px] min-w-1.5 shrink grow-0 basis-4 rounded-full', stages[i - 1]!.when === 'past' ? 'bg-good' : 'bg-[var(--axis)]')}
                />
              ) : null}
              <button
                type="button"
                onClick={() => onPick(stage.key)}
                aria-pressed={on}
                aria-label={says}
                title={says}
                className={cn(
                  'inline-flex min-h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-[5px] pr-[9px] text-[12px]',
                  'transition-colors duration-quick ease-state hover:bg-sunken hover:text-ink coarse:min-h-11',
                  on ? 'bg-sunken font-semibold text-ink' : stage.when === 'future' ? 'text-ink-muted' : 'text-ink-secondary',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-full',
                    stage.when === 'past' && 'bg-good text-white',
                    stage.when === 'now' && 'bg-brand ring-[3px] ring-brand-soft',
                    stage.when === 'future' && 'ring-[1.5px] ring-inset ring-[var(--axis)]',
                  )}
                >
                  {stage.when === 'past' ? <Check size={10} strokeWidth={3} /> : null}
                </span>
                <span className={cn(named ? 'inline' : 'hidden [@container(min-width:34rem)]:inline')}>{stage.label}</span>
              </button>
            </span>
          );
        })}
      </nav>
    </div>
  );
}

/* ==================================================================== */
/* The functions                                                         */
/* ==================================================================== */

export interface FunctionTab {
  key: string;
  label: string;
  /** A value here waits to be accepted. */
  waiting?: boolean;
  /** Listed, and not built yet. */
  muted?: boolean;
}

/**
 * One tab for each function, sharing the row edge to edge.
 *
 * The tabs carry no counts: a dot says something waits, and the page says
 * what. When there are more than fit (six on a phone) each keeps its own
 * width, the row scrolls to the one you are on, and a fade at either edge
 * says there is more that way.
 *
 * They are links between pages, not panels of one page, so the one you are on
 * is marked `aria-current` rather than dressed as an ARIA tab.
 */
export function FunctionTabs({
  tabs,
  current,
  onPick,
  label = 'Functions of this department',
  className,
}: {
  tabs: FunctionTab[];
  current: string;
  onPick: (key: string) => void;
  label?: string;
  className?: string;
}) {
  const group = useId();
  const [row, edges] = useEdges(tabs.map((t) => t.key).join('|'));

  // The tab you are on is brought into view when the row has to scroll.
  useEffect(() => {
    const el = row.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !tab) return;
    const strip = el.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.left >= strip.left - 1 && at.right <= strip.right + 1) return;
    el.scrollTo({ left: el.scrollLeft + (at.left - strip.left) - (strip.width - at.width) / 2, behavior: 'smooth' });
  }, [current, row]);

  return (
    <nav aria-label={label} className={cn('relative min-w-0', className)}>
      <div ref={row} className="flex overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const on = tab.key === current;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={on ? 'page' : undefined}
              title={tab.muted ? 'Not built yet' : undefined}
              onClick={() => onPick(tab.key)}
              className={cn(
                'relative inline-flex min-h-9 min-w-max flex-1 basis-0 items-center justify-center gap-1.5 px-2.5 py-2 text-[13px] coarse:min-h-11',
                'transition-colors duration-quick ease-state',
                on ? 'font-semibold text-ink' : tab.muted ? 'text-ink-muted hover:text-ink-secondary' : 'text-ink-secondary hover:text-ink',
              )}
            >
              {tab.label}
              {tab.muted ? <span className="sr-only"> (not built yet)</span> : null}
              {tab.waiting ? <WaitDot /> : null}
              {/* One underline for the row, travelling to whichever tab is current. */}
              {on ? <motion.span layoutId={`fn-${group}`} aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-ink" transition={SPRING.snappy} /> : null}
            </button>
          );
        })}
      </div>
      {/* `from-surface` because that is what the row is painted on. */}
      {edges.start ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent" /> : null}
      {edges.end ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" /> : null}
    </nav>
  );
}
