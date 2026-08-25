import { cn } from './ui/kit';
import { useAreaUnit, type AreaUnit } from '../lib/units';

const OPTIONS: { value: AreaUnit; label: string }[] = [
  { value: 'sqft', label: 'sq ft' },
  { value: 'sqm', label: 'm²' },
];

/**
 * Compact segmented control for the area display unit.
 *
 * Uncontrolled (no props): wired straight to the shared `useAreaUnit()`
 * preference — drop it in a toolbar (case-workspace header, dashboard) and it
 * reads/writes the same persisted choice every other screen sees.
 *
 * Controlled (`value`/`onChange` passed): ignores the shared preference and
 * defers entirely to the caller. Use this where a unit choice is local and
 * transient rather than a standing preference — e.g. the new-case wizard,
 * which defaults the unit from the country being entered rather than from
 * whatever the user last viewed a dashboard in.
 *
 * Either way it never affects what is stored, only how areas and rates render.
 */
export function UnitToggle({
  className,
  value,
  onChange,
}: {
  className?: string;
  value?: AreaUnit;
  onChange?: (next: AreaUnit) => void;
}) {
  const shared = useAreaUnit();
  const unit = value ?? shared.unit;
  const setUnit = onChange ?? shared.setUnit;

  return (
    <div
      role="group"
      aria-label="Area unit"
      className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-[var(--ring)]', className)}
    >
      {OPTIONS.map((opt) => {
        const active = unit === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => setUnit(opt.value)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium leading-4 transition-colors focus-visible:outline-none',
              active ? 'bg-surface text-ink shadow-card ring-1 ring-inset ring-[var(--ring)]' : 'text-ink-secondary hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default UnitToggle;
