import { useId, useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import type { TurnChanged } from '@realytica/shared';
import { Button, cn } from '../ui/kit';

/**
 * What a reply changed on the record, under the reply.
 *
 * One line that opens to the list: each thing the message changed, as the
 * server wrote it down when the message was done. The list ends with Undo,
 * which puts back what that one message changed and nothing else, however
 * long ago it was. It is a second step on purpose: undoing a drop takes the
 * dropped files out of storage, and that should not be one stray click away.
 *
 * Undo sends a message of its own, so what it put back, and what it left
 * with why, is said in the chat and stays there. A reply that was undone
 * says so here and keeps its list.
 */
export function TurnChanges({ changed, busy, onUndo }: { changed: TurnChanged; busy?: boolean; onUndo?: () => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const n = changed.lines.length + (changed.more ?? 0);
  const undone = changed.undone;
  const day = undone ? new Date(undone.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const summary = undone
    ? undone.back < undone.of
      ? `Partly undone on ${day}: ${undone.back} of ${undone.of}`
      : `Undone on ${day}`
    : n === 1
      ? `Changed: ${changed.lines[0]}`
      : `Changed ${n} things`;

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'inline-flex max-w-full items-start gap-1 rounded-md py-0.5 pr-1.5 text-left text-mini coarse:min-h-11 coarse:items-center',
          undone ? 'text-ink-muted hover:text-ink-secondary' : 'text-ink-secondary hover:text-ink',
        )}
      >
        <ChevronRight size={12} aria-hidden className={cn('mt-[3px] shrink-0 transition-transform duration-quick coarse:mt-0', open && 'rotate-90')} />
        <span className="min-w-0">{summary}</span>
      </button>
      {open ? (
        <div id={listId} className="mt-1 rounded-lg bg-sunken px-2.5 py-2 ring-1 ring-inset ring-[var(--ring)]">
          {undone ? <p className="mb-1 text-mini text-ink-muted">What this message had changed:</p> : null}
          <ul className="flex flex-col gap-0.5">
            {changed.lines.map((line, i) => (
              <li key={i} className={cn('text-[12px] leading-snug', undone ? 'text-ink-secondary' : 'text-ink')}>
                {line}
              </li>
            ))}
            {changed.more ? <li className="text-[12px] leading-snug text-ink-secondary">and {changed.more} more</li> : null}
          </ul>
          {undone ? null : changed.kept && onUndo ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Button type="button" size="sm" disabled={busy} icon={<Undo2 size={13} aria-hidden />} onClick={onUndo}>
                Undo this message
              </Button>
              <span className="min-w-0 flex-1 text-mini leading-snug text-ink-secondary">
                Puts back what still stands as this message left it. Later work is not touched.
              </span>
            </div>
          ) : !changed.kept ? (
            <p className="mt-1.5 text-mini leading-snug text-ink-secondary">This cannot be undone from here: what it takes to put it back was not kept.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
