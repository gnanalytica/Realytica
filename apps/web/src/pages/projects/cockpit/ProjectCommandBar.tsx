import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import {
  DEPARTMENT_SHORT,
  FIRM_ONLY_PANES,
  MENU_DEPARTMENTS,
  SEARCH_KIND_LABEL,
  STAGES,
  menuAt,
  menuDepartmentsOf,
  menuFunctions,
  openPlace,
  projectDepartments,
  reachesEveryProject,
  searchProject,
  stageOf,
  withDepartment,
  type ChatPlace,
  type CockpitPathExtra,
  type DdProject,
  type DepartmentKey,
  type ProjectCockpitPane,
  type StageKey,
} from '@realytica/shared';
import { api } from '../../../lib/api';
import { composing } from '../../../components/chat/carried-question';
import { cn, useToast } from '../../../components/ui/kit';
import { SPRING, motion } from '../../../lib/motion';
import { useMe } from '../../../lib/useMe';
import { SECTIONS } from './rail';

/** A page of the menu, or a stage to look at. `name` is its own word, which typing finds first. */
type Place =
  | { kind: 'go'; id: string; label: string; hint: string; name: string; pane: ProjectCockpitPane; extra?: CockpitPathExtra }
  | { kind: 'stage'; id: string; label: string; hint: string; name: string; stage: StageKey };

type Command =
  | Place
  /** A record on this project, opened where a link to it in the chat opens it. */
  | { kind: 'open'; id: string; label: string; hint: string; recordId: string }
  | { kind: 'do'; id: string; label: string; hint: string; run: () => Promise<void> }
  | { kind: 'ask'; id: string; label: string; hint: string };

/**
 * Where a person can go, by the menu's own names.
 *
 * `top` is what the selector lists: Overview, the departments that show at
 * the stage being looked at, and the places the whole project shares. `more`
 * is what sits under those and is found by typing: each function, written
 * with its department ("Legal › Title"), each tab of a shared place that has
 * a word of its own (Findings, Outgoing), a department with no work at this
 * stage, and the other stages.
 *
 * A department and a function open as they do when the chat is asked for
 * them by name: at the stage being looked at where they show there. One that
 * is switched off is left out, and so is what only the firm's own people may
 * open.
 */
function placesOf(project: DdProject, here: ChatPlace, staff: boolean): { top: Place[]; more: Place[] } {
  const page = (id: string, label: string, name: string, want: { department?: DepartmentKey; fn?: string }): Place[] => {
    const reading = openPlace(project, want, undefined, here);
    return reading.kind === 'go' ? [{ kind: 'go', id, label, hint: 'Go', name, pane: reading.open.pane, extra: reading.open.extra }] : [];
  };
  const mine = (pane: ProjectCockpitPane): boolean => staff || !FIRM_ONLY_PANES.has(pane);
  const shared = SECTIONS.filter((section) => mine(section.home)).map((section): Place => ({ kind: 'go', id: `go:${section.key}`, label: section.label, hint: 'Go', name: section.label, pane: section.home }));
  const tabs = SECTIONS.flatMap((section) =>
    section.tabs
      .filter((tab) => tab.label !== section.label && mine(tab.pane))
      .map((tab): Place => ({ kind: 'go', id: `go:tab:${tab.pane}`, label: tab.label, hint: 'Go', name: tab.label, pane: tab.pane })),
  );
  const listed = menuDepartmentsOf(projectDepartments(project), menuAt(project, here.stage ?? stageOf(project.currentStage)));
  const department = (menu: DepartmentKey): Place[] => page(`go:d:${menu}`, DEPARTMENT_SHORT[menu], DEPARTMENT_SHORT[menu], { department: menu });
  const shown = MENU_DEPARTMENTS.filter((menu) => listed.includes(menu) || menu === here.department);
  const functions = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu).flatMap((fn) => page(`go:w:${fn.key}`, withDepartment(fn.key, fn.label), fn.label, { fn: fn.key })));
  const stages = STAGES.filter((stage) => stage.key !== here.stage).map((stage): Place => ({ kind: 'stage', id: `stage:${stage.key}`, label: `${stage.label} stage`, hint: 'Go', name: stage.label, stage: stage.key }));
  return {
    top: [...shared.slice(0, 1), ...shown.flatMap(department), ...shared.slice(1)],
    more: [...functions, ...tabs, ...MENU_DEPARTMENTS.filter((menu) => !shown.includes(menu)).flatMap(department), ...stages],
  };
}

/** Whether a place's own name is what was typed: the name, or a word of it, begins with it. */
function namedBy(name: string, typed: string): boolean {
  const words = name.toLowerCase();
  return words.startsWith(typed) || words.split(/[\s-]+/).some((word) => word.startsWith(typed));
}

/**
 * The ids the input and the list point at.
 *
 * `aria-activedescendant` is a pointer, so both halves have to agree on the
 * name of every row. Derived rather than generated so they cannot drift: one
 * palette is open at a time, and the index is what the keyboard is moving.
 */
const LIST_ID = 'command-bar-matches';
const optionId = (index: number): string => `command-bar-option-${index}`;

export function ProjectCommandBar({
  open,
  project,
  here,
  onClose,
  onGo,
  onStage,
  onOpen,
  onAsk,
  onChanged,
}: {
  open: boolean;
  project: DdProject;
  /** The page on screen and the stage it is looked at in: a function opens at that stage where it shows there. */
  here: ChatPlace;
  onClose: () => void;
  onGo: (pane: ProjectCockpitPane, extra?: CockpitPathExtra) => void;
  /** Look at another stage, as the stage track does. */
  onStage: (stage: StageKey) => void;
  /** Open a record where a link to it in the chat opens it. */
  onOpen: (id: string) => void;
  onAsk: (text: string) => void;
  onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  // Review, Outgoing and People are the firm's own people's: somebody working from a grant is not offered them.
  const me = useMe();
  const staff = me ? reachesEveryProject(me.role) : false;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  /*
   * The `do` command that has been chosen but not yet confirmed.
   *
   * A palette is a place people move fast, and four of the verbs in this one
   * write to the file — "Run property screen" raises findings, risks and a
   * valuation; "Mark risk mitigated" changes a register a report is built
   * from. Enter ran them outright, so a mistyped query plus a reflex Enter
   * was a write nobody looked at. Arming rather than a dialog: the second
   * Enter is one keystroke, it keeps the palette's speed for the reader who
   * meant it, and it costs the reader who did not exactly nothing.
   *
   * `go`, `open` and `ask` are untouched — navigating somewhere by accident
   * is undone by navigating back.
   */
  const [armed, setArmed] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const places = useMemo(() => placesOf(project, here, staff), [project, here, staff]);

  const commands: Command[] = useMemo(() => {
    const out: Command[] = [...places.top, ...places.more];
    out.push({
      kind: 'do',
      id: 'do:orchestrate',
      label: 'Run orchestrator (propose drafts from registers)',
      hint: 'Do',
      run: async () => {
        await api.orchestrateProject(project.id);
      },
    });
    out.push({
      kind: 'do',
      id: 'do:drafts',
      label: 'Propose AI drafts from registers',
      hint: 'Do',
      run: async () => {
        await api.proposeAiDrafts(project.id);
      },
    });
    out.push({
      kind: 'do',
      id: 'do:screen',
      label: 'Run property screen (write findings, risks and actions from the documents)',
      hint: 'Do',
      run: async () => {
        await api.runProjectScreen(project.id);
      },
    });
    out.push({
      kind: 'do',
      id: 'do:valuation',
      label: 'Run indicative valuation',
      hint: 'Do',
      run: async () => {
        await api.runValuation(project.id);
      },
    });
    for (const action of project.actions.filter((a) => a.status !== 'closed').slice(0, 8)) {
      out.push({
        kind: 'do',
        id: `do:action:${action.id}`,
        label: `Close action “${action.title}”`,
        hint: 'Do',
        run: async () => {
          await api.patchAction(project.id, action.id, 'closed');
        },
      });
    }
    for (const risk of project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted').slice(0, 6)) {
      out.push({
        kind: 'do',
        id: `do:risk:${risk.id}`,
        label: `Mark risk “${risk.title}” mitigated`,
        hint: 'Do',
        run: async () => {
          await api.patchRisk(project.id, risk.id, 'mitigated');
        },
      });
    }
    return out;
  }, [project, places]);

  const records: Command[] = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    return searchProject(project, q, 6).map((hit) => ({
      kind: 'open' as const,
      id: `open:${hit.id}`,
      label: hit.label,
      // A paper is a document in the menu's words.
      hint: `${hit.kind === 'evidence' ? 'Document' : SEARCH_KIND_LABEL[hit.kind]} · ${hit.detail}`,
      recordId: hit.id,
    }));
  }, [project, query]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Nothing typed: where a person can go, as the selector lists it.
    if (q.length === 0) return places.top;
    // A page named by what was typed comes first: "Title" is the page, and its papers and checks follow.
    const named = [...places.top, ...places.more].filter((place) => namedBy(place.name, q)).slice(0, 4);
    // The other commands whose words hold what was typed. They follow the records: somebody who typed a title wants
    // that record, not a command that happens to share a word with it.
    const verbs = commands.filter((c) => !named.some((place) => place.id === c.id) && c.label.toLowerCase().includes(q)).slice(0, 4);
    // The way to ask is the last row, however many were found.
    return [...[...named, ...records, ...verbs].slice(0, 9), { kind: 'ask' as const, id: 'ask', label: `Ask: “${query.trim()}”`, hint: 'Ask' }];
  }, [commands, places, query, records]);

  /*
   * A new query is a new list, so the highlight goes back to the top.
   *
   * This used to clamp the old index to the new length, keyed on the length
   * alone — so typing a letter that happened to return the same number of
   * matches left the highlight on a row that was now a different command
   * entirely. Arrow down to the third result, type one more character, press
   * Enter, and you ran something you never looked at. The palette runs `do`
   * commands that write to the file, so that is not only surprising.
   *
   * Keyed on the query, with the clamp kept for the other way the list can
   * change — records arriving from a refresh while the palette is open.
   */
  useEffect(() => {
    setActive(0);
    setArmed(null);
  }, [query]);

  // Moving off a command disarms it: what is armed must be what is highlighted,
  // or the confirmation is confirming something the reader is no longer on.
  useEffect(() => {
    setArmed(null);
  }, [active]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  // The keyboard's row stays in view: the list can be longer than its box.
  const move = (to: number): void => {
    setActive(to);
    document.getElementById(optionId(to))?.scrollIntoView({ block: 'nearest' });
  };

  async function run(command: Command): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (command.kind === 'go') {
        onGo(command.pane, command.extra);
        onClose();
      } else if (command.kind === 'stage') {
        onStage(command.stage);
        onClose();
      } else if (command.kind === 'open') {
        onOpen(command.recordId);
        onClose();
      } else if (command.kind === 'ask') {
        onAsk(query.trim());
        onClose();
      } else if (armed !== command.id) {
        setArmed(command.id);
        setBusy(false);
        return;
      } else {
        await command.run();
        await onChanged();
        toast(command.label, 'good');
        onClose();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That command did not go through.', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(var(--shadow-tint)/0.32)] px-3 pt-[max(1.5rem,env(safe-area-inset-top))] backdrop-blur-[2px] sm:px-4 sm:pt-[16vh]"
      onClick={onClose}
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Project command bar"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING.layer}
        className="flex max-h-[min(32rem,85dvh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-[var(--ring)]"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3.5">
          <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // While an input method is composing, Enter picks a candidate and the arrows move among them: none of it is a command.
              if (composing(e.nativeEvent)) return;
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(Math.min(matches.length - 1, active + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(Math.max(0, active - 1));
              } else if (e.key === 'Enter' && matches[active]) {
                e.preventDefault();
                void run(matches[active]);
              }
            }}
            placeholder="Find a page, a check or a document, or run a command"
            aria-label="Run a command"
            /*
              The combobox pattern, which this was missing.

              Arrowing down moved a background colour and nothing else: the
              list was a plain <ul> of buttons, so a screen reader announced
              the input and then silence, however far down the matches you
              travelled. `aria-activedescendant` is what makes the highlight
              audible — it points at the option the keyboard is on, so the
              same keystroke that moves the highlight reads the row out.

              `aria-expanded` is bound to whether there is anything to expand
              into. Hard-coding it true would announce a list to somebody the
              filter has just emptied.
            */
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={LIST_ID}
            aria-activedescendant={matches[active] ? optionId(active) : undefined}
            aria-autocomplete="list"
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted coarse:text-base"
          />
          <kbd className="hidden shrink-0 rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-muted ring-1 ring-inset ring-[var(--ring)] sm:inline">esc</kbd>
        </div>
        <ul id={LIST_ID} role="listbox" aria-label="Matches" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-ink-muted">Nothing on this project matches that.</li>
          ) : (
            matches.map((c, i) => (
              <li key={c.id} id={optionId(i)} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void run(c)}
                  className="relative flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left coarse:min-h-11"
                >
                  {/* The highlight travels with the keyboard rather than jumping. */}
                  {i === active ? (
                    <motion.span layoutId="command-active" aria-hidden className="absolute inset-0 rounded-xl bg-sunken ring-1 ring-inset ring-[var(--ring)]" transition={SPRING.snappy} />
                  ) : null}
                  <span
                    className={cn(
                      'relative mt-px w-9 shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-medium',
                      c.kind === 'do' ? 'bg-action text-action-ink' : c.kind === 'ask' ? 'bg-ai/12 text-ai-ink' : 'bg-brand-soft text-brand',
                    )}
                  >
                    {c.kind === 'ask' ? 'Ask' : c.kind === 'do' ? 'Do' : 'Go'}
                  </span>
                  <span className="relative min-w-0 flex-grow">
                    <span className="block truncate text-[13px] text-ink">{c.label}</span>
                    {/* A record's provenance is where it lives; a verb's is just
                        its own kind, which the badge already said. */}
                    {c.kind === 'open' ? (
                      <span className="block truncate text-[11px] text-ink-muted">{c.hint}</span>
                    ) : null}
                    {armed === c.id ? (
                      <span className="block text-[11px] font-medium text-brand">
                        This writes to the file — press Enter again to run it.
                      </span>
                    ) : null}
                  </span>
                  {i === active ? <CornerDownLeft size={13} className="relative mt-1 shrink-0 text-ink-muted" aria-hidden /> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="hidden items-center gap-4 border-t border-hairline bg-sunken/50 px-4 py-2 text-[11px] text-ink-muted sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded bg-surface px-1 font-mono ring-1 ring-inset ring-[var(--ring)]">↑</kbd>
            <kbd className="rounded bg-surface px-1 font-mono ring-1 ring-inset ring-[var(--ring)]">↓</kbd>
            to move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded bg-surface px-1 font-mono ring-1 ring-inset ring-[var(--ring)]">↵</kbd>
            to run
          </span>
          <span className="ml-auto">Writes ask twice before they run</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
