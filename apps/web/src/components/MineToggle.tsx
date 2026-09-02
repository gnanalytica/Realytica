import { ownedBy, type WorkPerson } from '@realytica/shared';
import { cn } from './ui/kit';
import { useMe } from '../lib/useMe';

/**
 * "Just mine", on any register.
 *
 * One component rather than a toggle written into each register, because the
 * rule for what counts as mine lives in one place (`ownedBy`) and a second
 * hand-written copy of it would be the one that quietly disagrees.
 *
 * It hides itself when the reader owns nothing here. A filter that always
 * reads zero is a control that teaches people it does not work.
 */
export function useMine<T extends { owner?: string }>(rows: readonly T[], on: boolean) {
  const me = useMe();
  const mine = me ? rows.filter((r) => ownedBy(r.owner, me as WorkPerson)) : [];
  return { me, count: mine.length, rows: on ? mine : rows };
}

export function MineToggle({
  count,
  on,
  onChange,
  className,
}: {
  count: number;
  on: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] coarse:min-h-11',
        on ? 'bg-brand-soft font-semibold text-brand' : 'bg-sunken text-ink-secondary hover:text-ink',
        className,
      )}
    >
      Mine <span className="text-ink-muted">{count}</span>
    </button>
  );
}
