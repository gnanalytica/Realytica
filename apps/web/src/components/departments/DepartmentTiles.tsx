import { Check } from 'lucide-react';
import { DEPARTMENTS, type DepartmentKey } from '@realytica/shared';
import { AnimatePresence, SPRING, motion } from '../../lib/motion';
import { cn } from '../ui/kit';
import { DEPARTMENT_ICON } from './icons';

/**
 * The departments as tiles that toggle: a department is a choice with a
 * shape, not a line of small print beside a box. A project keeps at least
 * one, so the last one on cannot be switched off.
 */
export function DepartmentTiles({ value, onChange, disabled = false }: { value: DepartmentKey[]; onChange: (next: DepartmentKey[]) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
    {DEPARTMENTS.map((d) => {
      const on = value.includes(d.key);
      const last = value.length === 1 && on;
      const Icon = DEPARTMENT_ICON[d.key];
      return (
        <button
          key={d.key}
          type="button"
          role="checkbox"
          aria-checked={on}
          disabled={last || disabled}
          onClick={() => onChange(on ? value.filter((k) => k !== d.key) : [...value, d.key])}
          className={cn(
            'group relative flex items-start gap-3 rounded-xl p-3 text-left ring-1 ring-inset transition-[background-color,box-shadow,transform] duration-quick ease-state active:scale-[0.99]',
            on ? 'bg-brand-soft/60 ring-brand/40' : 'bg-surface ring-[var(--ring)] hover:bg-sunken/60',
            last && 'cursor-not-allowed',
          )}
        >
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset transition-colors duration-quick', on ? 'bg-brand text-[var(--brand-ink)] ring-brand' : 'bg-sunken text-ink-secondary ring-[var(--ring)]')}>
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              {d.label}
              {d.status === 'coming_soon' ? <span className="rounded px-1 font-mono text-[9px] uppercase tracking-wide text-ink-muted ring-1 ring-inset ring-[var(--ring)]">Soon</span> : null}
            </span>
            <span className="mt-0.5 block text-micro leading-snug text-ink-muted">{d.purpose}</span>
          </span>
          <span className={cn('grid size-5 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-colors duration-quick', on ? 'bg-brand text-[var(--brand-ink)] ring-brand' : 'ring-[var(--axis)]')} aria-hidden>
            <AnimatePresence initial={false}>
              {on ? (
                <motion.span key="tick" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING.snappy}>
                  <Check size={12} strokeWidth={3} />
                </motion.span>
              ) : null}
            </AnimatePresence>
          </span>
        </button>
      );
    })}
    </div>
  );
}
