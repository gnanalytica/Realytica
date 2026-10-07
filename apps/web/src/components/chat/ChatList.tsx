import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react';
import { CHAT_NAME_MAX } from '@realytica/shared';
import { cn, useToast } from '../ui/kit';
import { AnimatePresence, EASE_ENTER, motion } from '../../lib/motion';
import { SEARCH_CHATS_PAST, chatDay, searchChats, type ChatRow } from './chat-list';

/**
 * The chats of a project, behind one control in the chat's header.
 *
 * Closed, it names the chat on screen. Open, it is a short list: "New chat",
 * then each chat by its name or the question it opened with, with its day and
 * the page it began on. A search field joins it once there are more earlier
 * chats than fit at a glance. A chat is renamed in its own row. For somebody
 * who may, the last line asks to delete them all.
 *
 * It is a small dialog and not a menu, because it holds a field to type in.
 * It takes the keyboard as it opens, the arrow keys move between its rows,
 * Escape closes it and hands focus back to the control, and a press or a Tab
 * that leaves it closes it too.
 */
export function ChatList({
  rows,
  label,
  onPick,
  onNew,
  onRename,
  onDeleteAll,
}: {
  rows: ChatRow[];
  /** What the closed control says: the chat on screen. */
  label: string;
  onPick: (row: ChatRow) => void;
  onNew: () => void;
  /** Absent where chats cannot be renamed; the rows then carry no pencil. */
  onRename?: (id: string, name: string) => Promise<void> | void;
  /** Ask to delete every chat. Absent for somebody who may not; the list then has no such line. The asking is the caller's. */
  onDeleteAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const toast = useToast();

  const earlier = rows.filter((row) => !row.current).length;
  const searchable = earlier > SEARCH_CHATS_PAST;
  const shown = useMemo(() => searchChats(rows, searchable ? query : ''), [rows, searchable, query]);

  /** Closing by the keyboard hands focus back to the control; closing by a press elsewhere leaves it where the press put it. */
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setRenaming(null);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open, close]);

  // Opened, the list takes the keyboard: on the search field when it has one, otherwise on its first row.
  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLElement>('input[type="search"]') ?? panel.current?.querySelector<HTMLElement>('[data-row]'))?.focus();
  }, [open]);

  // A name saved or left as it was hands the keyboard back to the row it belongs to.
  const wasRenaming = useRef<string | null>(null);
  useEffect(() => {
    const was = wasRenaming.current;
    wasRenaming.current = renaming;
    if (!was || renaming || !open) return;
    const rows = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    // Under its new name the chat may no longer answer the search. The keyboard then goes to the search it fell out of.
    (rows.find((row) => row.dataset.chat === was) ?? panel.current?.querySelector<HTMLElement>('input[type="search"]') ?? rows[0])?.focus();
  }, [renaming, open]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    // A field being typed in keeps its own arrow keys, apart from the way down out of the search.
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (typing && !(e.key === 'ArrowDown' && (e.target as HTMLInputElement).type === 'search')) return;
    const stops = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-row]') ?? []);
    if (!stops.length) return;
    e.preventDefault();
    if (typing) {
      // Down out of the search is the first chat under it, not "New chat" above it.
      (stops.find((row) => row.dataset.chat) ?? stops[0])?.focus();
      return;
    }
    // From a row's pencil the keys move from that row, as they do from the row itself.
    const on = document.activeElement as HTMLElement | null;
    const at = stops.indexOf(on?.closest('li')?.querySelector<HTMLElement>('[data-row]') ?? (on as HTMLElement));
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? stops.length - 1 : e.key === 'ArrowDown' ? at + 1 : at - 1;
    stops[(to + stops.length) % stops.length]?.focus();
  };

  async function save(row: ChatRow) {
    if (!onRename) return;
    setSaving(true);
    try {
      await onRename(row.id, draft);
      setRenaming(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The name was not saved', 'critical');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={box}
      className="ml-auto flex min-w-0"
      onBlur={(e) => {
        // Focus that leaves the control and its list closes the list. Focus lost to nothing (a row removed under it) does not.
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            close(true);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Chats on this project. Showing: ${label}`}
        className={cn(
          'inline-flex min-w-0 max-w-[11rem] items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-muted transition-colors duration-quick ease-state hover:text-ink coarse:min-h-11',
          open && 'bg-sunken text-ink',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={12} aria-hidden className={cn('shrink-0 transition-transform duration-base ease-enter', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panel}
            id={id}
            role="dialog"
            aria-label="Chats on this project"
            onKeyDown={onKey}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: EASE_ENTER }}
            /* Hung from the header row, not from the control, so it is never wider than the chat it belongs to. */
            className="absolute inset-x-0 top-[calc(100%+6px)] z-50 ml-auto flex max-h-[min(26rem,60dvh)] max-w-[21rem] origin-top-right flex-col overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]"
          >
            <div className="shrink-0 space-y-1 border-b border-hairline p-1.5">
              <button
                type="button"
                data-row
                onClick={() => {
                  close(true);
                  onNew();
                }}
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-ink transition-colors duration-quick ease-state hover:bg-page focus-visible:bg-page coarse:min-h-11"
              >
                <Plus size={14} aria-hidden className="shrink-0 text-ink-muted" />
                New chat
              </button>
              {searchable ? (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search chats"
                  placeholder="Search chats"
                  className="h-9 w-full rounded-lg bg-sunken px-2.5 text-[13px] text-ink outline-none ring-1 ring-inset ring-[var(--ring)] placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-brand coarse:h-11 coarse:text-base"
                />
              ) : null}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {shown.map((row) => (
                <li key={row.id} className={cn('flex items-center gap-0.5 rounded-lg', row.current ? 'bg-brand-soft' : 'hover:bg-page focus-within:bg-page')}>
                  {renaming === row.id ? (
                    <form
                      className="flex min-w-0 flex-1 items-center gap-1 p-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save(row);
                      }}
                    >
                      <input
                        autoFocus
                        value={draft}
                        maxLength={CHAT_NAME_MAX}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          // Escape leaves the name as it was and keeps the list open.
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        aria-label="Name of this chat"
                        placeholder={row.named ? 'Empty to use its first question' : row.title}
                        className="h-8 min-w-0 flex-1 rounded-md bg-surface px-2 text-[13px] text-ink outline-none ring-1 ring-inset ring-[var(--ring)] focus-visible:ring-2 focus-visible:ring-brand coarse:h-11 coarse:text-base"
                      />
                      <button type="submit" disabled={saving} aria-label="Save the name" className="grid size-8 shrink-0 place-items-center rounded-md text-brand hover:bg-surface disabled:opacity-50 coarse:size-11">
                        <Check size={14} aria-hidden />
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} aria-label="Keep the name as it was" className="grid size-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface hover:text-ink coarse:size-11">
                        <X size={14} aria-hidden />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-row
                        data-chat={row.id}
                        aria-current={row.current ? 'true' : undefined}
                        onClick={() => {
                          close(true);
                          onPick(row);
                        }}
                        className="min-h-11 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left"
                      >
                        <span className={cn('block truncate text-[13px]', row.current ? 'font-semibold text-ink' : 'text-ink')}>{row.title}</span>
                        <span className="block truncate text-[12px] text-ink-muted">{[row.current ? 'This chat' : chatDay(row.at), row.place].filter(Boolean).join(' · ')}</span>
                      </button>
                      {onRename ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(row.named ? row.title : '');
                            setRenaming(row.id);
                          }}
                          aria-label={`Rename “${row.title}”`}
                          title="Rename"
                          className="mr-1 grid size-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors duration-quick ease-state hover:bg-surface hover:text-ink coarse:size-11"
                        >
                          <Pencil size={13} aria-hidden />
                        </button>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
              {shown.length === 0 ? <li className="px-2 py-3 text-[12px] text-ink-muted">{query.trim() ? 'No chat matches.' : 'No earlier chats.'}</li> : null}
            </ul>
            {onDeleteAll ? (
              // The last line, under the chats it is about. It opens a question and deletes nothing by itself.
              <div className="shrink-0 border-t border-hairline p-1.5">
                <button
                  type="button"
                  data-row
                  onClick={() => {
                    close(false);
                    onDeleteAll();
                  }}
                  className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-ink-secondary transition-colors duration-quick ease-state hover:bg-page hover:text-ink focus-visible:bg-page focus-visible:text-ink coarse:min-h-11"
                >
                  <Trash2 size={14} aria-hidden className="shrink-0 text-ink-muted" />
                  Delete all chats…
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
