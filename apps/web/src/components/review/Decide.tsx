import { Check, CheckCheck, Pencil, Undo2, X } from 'lucide-react';
import { cn } from '../ui/kit';

/**
 * The two decisions, as icons.
 *
 * Everything a reader or the model proposes is decided where it lands, with
 * the same pair of buttons: accept it onto the file, or set it aside. Icons
 * rather than words, because a review is dozens of these in a row and the
 * words were the noise — every button still names what it decides for a
 * screen reader and on hover.
 */
export function DecideButtons({
  label,
  busy,
  onAccept,
  onSetAside,
  onEdit,
  size = 'md',
  className,
}: {
  /** What is being decided, in the reader's words — "Extent per khata". */
  label: string;
  busy?: boolean;
  onAccept: () => void;
  onSetAside: () => void;
  /** Correct it first. Absent where there is nothing to type. */
  onEdit?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-7' : 'size-8';
  const icon = size === 'sm' ? 14 : 16;
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5', className)}>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          aria-label={`Correct ${label}`}
          title={`Correct ${label}`}
          className={cn(
            box,
            'flex items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-50 coarse:size-11',
          )}
        >
          <Pencil size={icon - 3} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onAccept}
        disabled={busy}
        aria-label={`Accept ${label}`}
        title={`Accept ${label}`}
        className={cn(
          box,
          'flex items-center justify-center rounded-lg bg-surface text-[var(--status-good-text)] ring-1 ring-inset ring-good/40 transition-colors duration-quick hover:bg-good/10 disabled:opacity-50 coarse:size-11',
        )}
      >
        <Check size={icon} strokeWidth={2.6} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onSetAside}
        disabled={busy}
        aria-label={`Set aside ${label}`}
        title={`Set aside ${label}`}
        className={cn(
          box,
          'flex items-center justify-center rounded-lg bg-surface text-ink-muted ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick hover:bg-sunken hover:text-ink disabled:opacity-50 coarse:size-11',
        )}
      >
        <X size={icon} strokeWidth={2.4} aria-hidden />
      </button>
    </span>
  );
}

/** Where a decided thing stands, and the way back. */
export function DecidedMark({
  state,
  label,
  busy,
  onUndo,
}: {
  state: 'accepted' | 'rejected';
  label: string;
  busy?: boolean;
  onUndo?: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        role="img"
        aria-label={state === 'accepted' ? `${label}: accepted` : `${label}: set aside`}
        className={cn(
          'flex size-6 animate-scale-in items-center justify-center rounded-full',
          state === 'accepted' ? 'bg-good/15 text-[var(--status-good-text)]' : 'bg-sunken text-ink-muted',
        )}
      >
        {state === 'accepted' ? <Check size={13} strokeWidth={3} aria-hidden /> : <X size={13} strokeWidth={2.6} aria-hidden />}
      </span>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          aria-label={`Undo ${label}`}
          title="Undo"
          className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-50 coarse:size-11"
        >
          <Undo2 size={14} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** Everything left on one thing, accepted at once — after a person has looked it over. */
export function AcceptAllButton({ count, label, busy, onAccept }: { count: number; label: string; busy?: boolean; onAccept: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onAccept}
      disabled={busy}
      aria-label={label}
      title={label}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[13px] font-semibold text-[var(--status-good-text)] ring-1 ring-inset ring-good/40 hover:bg-good/10 disabled:opacity-50 coarse:min-h-11"
    >
      <CheckCheck size={16} strokeWidth={2.4} aria-hidden />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
