import { Check, Loader2, X } from 'lucide-react';
import { cn } from '../ui/kit';
import type { FillPhase } from './useValueFill';

export interface ReadingStep {
  label: string;
  state: 'waiting' | 'active' | 'done';
}

/**
 * What "Value this property" is doing, step by step, while it does it — and
 * then, in one line, what it did.
 */
export function ValueReading({
  phase,
  steps,
  summary,
  onDismiss,
}: {
  phase: FillPhase;
  steps: ReadingStep[];
  /** Said once the fill is done. */
  summary: string;
  onDismiss: () => void;
}) {
  if (phase === 'done') {
    return (
      <div className="flex animate-fade-in items-start justify-between gap-3 rounded-xl bg-surface px-4 py-2.5 ring-1 ring-inset ring-[var(--ring)]">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink">
          <Check size={14} className="mt-0.5 shrink-0 text-[var(--status-good-text)]" aria-hidden />
          <span>{summary}</span>
        </p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-ink">
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-inset ring-provenance/30" aria-live="polite">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px]',
              step.state === 'done' && 'text-ink-secondary',
              step.state === 'active' && 'bg-provenance/10 font-medium text-provenance-ink',
              step.state === 'waiting' && 'text-ink-muted',
            )}
          >
            {step.state === 'done' ? (
              <Check size={12} className="text-[var(--status-good-text)]" aria-hidden />
            ) : step.state === 'active' ? (
              <Loader2 size={12} className="animate-spin" aria-hidden />
            ) : (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ring)]" aria-hidden />
            )}
            {step.label}
          </span>
          {i < steps.length - 1 ? <span className="text-ink-muted" aria-hidden>·</span> : null}
        </li>
      ))}
    </ol>
  );
}
