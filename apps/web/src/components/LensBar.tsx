import { HardHat, PencilRuler, TrendingUp, CalendarClock } from 'lucide-react';
import { LENS_KEYS, LENS_PROFILES } from '@realytica/shared';
import type { LensKey } from '@realytica/shared';
import { cn } from './ui/kit';
import type { ReactNode } from 'react';

/**
 * Who this case is being read by.
 *
 * The same analysis, four deliverables. Picking a reader reorders what leads
 * and folds the rest away — it never changes a finding, and never hides a
 * critical one. That distinction is why this sits in the header as a stated
 * choice rather than as a settings toggle: the reader should know the case is
 * being arranged for them, and that arrangement is all it is.
 */

const LENS_ICON: Record<LensKey, ReactNode> = {
  developer: <TrendingUp size={13} />,
  engineering: <HardHat size={13} />,
  architect: <PencilRuler size={13} />,
  project_manager: <CalendarClock size={13} />,
};

export function LensBar({
  lens,
  onChange,
  busy,
  className,
}: {
  lens: LensKey;
  onChange: (next: LensKey) => void | Promise<void>;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="mr-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-faint">Reading as</span>
      <div role="radiogroup" aria-label="Reader" className="flex flex-wrap gap-1">
        {LENS_KEYS.map((key) => {
          const profile = LENS_PROFILES[key];
          const active = key === lens;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              title={`${profile.who} ${profile.question}`}
              onClick={() => !active && void onChange(key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors duration-base disabled:opacity-50',
                active
                  ? 'bg-brand text-white shadow-card'
                  : 'bg-surface text-ink-secondary ring-1 ring-[var(--ring)] hover:bg-surface-2 hover:text-ink',
              )}
            >
              {LENS_ICON[key]}
              {profile.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The one-line statement of what this reader is asking, for the top of a view. */
export function LensQuestion({ lens, className }: { lens: LensKey; className?: string }) {
  const profile = LENS_PROFILES[lens];
  return (
    <p className={cn('text-[13px] leading-relaxed text-ink-muted', className)}>
      <span className="font-medium text-ink-secondary">{profile.label}:</span> {profile.question}
    </p>
  );
}
