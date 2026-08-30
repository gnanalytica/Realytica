import type { PlaybookRun, PlaybookStepState } from '@realytica/shared';
import { cn } from '../ui/kit';

export interface PlaybookTrackProps {
  run: PlaybookRun;
  onSelectStep?: (key: string) => void;
  selectedKey?: string | null;
}

/*
 * The gate is the product, so the gate is what this draws.
 *
 * A Bengaluru title lawyer establishes the chain before reconciling areas,
 * because an area reconciled against a chain nobody has established is a
 * number with no referent. The runner enforces that: a step whose prerequisite
 * is not clear is never evaluated, it reports `blocked` and names what is
 * holding it. In a table that ordering is invisible — seven rows, one of them
 * saying "blocked", and no sense that the blockage is why the four after it
 * are empty.
 *
 * As a track it is obvious: progress stops at a wall, and the wall has a
 * reason.
 */
const STATE_STYLE: Record<PlaybookStepState, { dot: string; label: string }> = {
  clear: { dot: 'bg-good', label: 'Clear' },
  attention: { dot: 'bg-warning', label: 'Attention' },
  blocked: { dot: 'bg-critical', label: 'Blocked' },
  not_started: { dot: 'bg-[var(--text-muted)]', label: 'Not started' },
  not_applicable: { dot: 'bg-hairline', label: 'N/A' },
};

export default function PlaybookTrack({ run, onSelectStep, selectedKey }: PlaybookTrackProps) {
  const firstBlocked = run.steps.find(s => s.state === 'blocked');

  return (
    <div>
      <ol className="flex flex-wrap items-stretch gap-0" role="list" aria-label={`${run.label}: ${run.steps.length} steps`}>
        {run.steps.map((step, i) => {
          const style = STATE_STYLE[step.state];
          const on = selectedKey === step.key;
          const isNext = run.nextStepKey === step.key;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 basis-[104px] items-stretch" data-step={step.key} data-state={step.state}>
              <button
                type="button"
                onClick={onSelectStep ? () => onSelectStep(step.key) : undefined}
                aria-label={`${step.label}: ${style.label}. ${step.finding}`}
                className={cn(
                  'group flex w-full flex-col gap-1.5 rounded-lg px-1.5 py-2 text-left transition-colors',
                  onSelectStep && 'cursor-pointer hover:bg-sunken',
                  on && 'bg-sunken',
                )}
              >
                <div className="flex items-center gap-1">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', style.dot)} />
                  {/* The connector carries the state of the step it leads INTO,
                      so the track visibly stops at the wall rather than running
                      through it in a neutral colour. */}
                  {i < run.steps.length - 1 ? (
                    <span
                      className={cn(
                        'h-px min-w-0 flex-1',
                        run.steps[i + 1].state === 'blocked' || run.steps[i + 1].state === 'not_started'
                          ? 'bg-hairline'
                          : 'bg-[var(--text-muted)]',
                      )}
                    />
                  ) : null}
                </div>
                <span
                  className={cn(
                    'line-clamp-2 text-mini leading-snug',
                    step.state === 'not_applicable' ? 'text-ink-muted' : 'text-ink-secondary',
                    isNext && 'font-semibold text-ink',
                  )}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {firstBlocked ? (
        <p className="mt-2 text-mini leading-relaxed text-ink-secondary">
          <span className="font-medium text-ink">Stops at &ldquo;{firstBlocked.label}&rdquo;.</span> {firstBlocked.finding}
        </p>
      ) : null}
    </div>
  );
}
