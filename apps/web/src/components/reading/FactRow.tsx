import { useEffect, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { otherReadingSaid, proofSaid, type DocumentFact } from '@realytica/shared';
import { cn } from '../ui/kit';

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A value typed in a character at a time, once — the reading arriving rather
 * than appearing. Whole at once for anyone who has asked for less motion, and
 * for anything long enough that typing it would be a wait.
 */
export function useTyped(text: string, delayMs: number, enabled: boolean): string {
  const [shown, setShown] = useState(enabled && !reducedMotion() && text.length <= 80 ? '' : text);
  useEffect(() => {
    if (!enabled || reducedMotion() || text.length > 80) {
      setShown(text);
      return;
    }
    setShown('');
    let i = 0;
    let timer: number | undefined;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        i += Math.max(1, Math.ceil(text.length / 24));
        setShown(text.slice(0, i));
        if (i >= text.length) window.clearInterval(timer);
      }, 28);
    }, delayMs);
    return () => {
      window.clearTimeout(start);
      if (timer) window.clearInterval(timer);
    };
  }, [text, delayMs, enabled]);
  return shown;
}

export type FactState = 'proposed' | 'filed' | 'skipped';

/**
 * One thing a document states, as it comes off the page.
 *
 * Ochre while it is a reading nobody has accepted; green once its card is
 * approved and it is on the file. Pointing at it — hover or focus — shows its
 * words on the page; the page chip says which page before anybody points.
 */
export function FactRow({
  fact,
  index,
  revealing,
  state,
  active,
  onPoint,
}: {
  fact: DocumentFact;
  /** Its place in the list, which staggers the reveal. */
  index: number;
  /** True the first time it is shown, so it types in; false when it is merely re-rendered. */
  revealing: boolean;
  state: FactState;
  active: boolean;
  onPoint: (fact: DocumentFact | null) => void;
}) {
  const delay = index * 170;
  const value = useTyped(fact.display, delay + 120, revealing);
  const model = fact.source === 'model';
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => onPoint(fact)}
      onFocus={() => onPoint(fact)}
      onMouseLeave={() => onPoint(null)}
      onBlur={() => onPoint(null)}
      className={cn(
        'group relative flex flex-col gap-0.5 rounded-lg px-3 py-2 ring-1 ring-inset transition-[box-shadow,background-color] duration-quick ease-state',
        revealing && 'animate-rise-in',
        state === 'filed'
          ? 'ring-good/30'
          : state === 'skipped'
            ? 'opacity-60 ring-[var(--ring)]'
            : 'ring-provenance/35',
        active ? 'bg-raised shadow-raised ring-2' : 'bg-surface hover:bg-raised',
        active && state !== 'filed' && 'ring-provenance/70',
        active && state === 'filed' && 'ring-good/60',
      )}
      style={revealing ? { animationDelay: `${delay}ms` } : undefined}
    >
      {state === 'filed' ? <span className="pointer-events-none absolute inset-0 rounded-lg animate-flash-good" style={{ animationDelay: `${index * 90}ms` }} aria-hidden /> : null}
      {revealing && state === 'proposed' ? (
        <span className="pointer-events-none absolute inset-0 rounded-lg animate-flash-provenance" style={{ animationDelay: `${delay + 120}ms` }} aria-hidden />
      ) : null}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">{fact.label}</span>
        <span className="shrink-0 font-mono text-micro text-ink-muted">p.{fact.page}</span>
        {state === 'filed' ? (
          <span className="inline-flex shrink-0 animate-scale-in items-center gap-0.5 rounded-full bg-good/15 px-1.5 py-px text-micro font-medium text-[var(--status-good-text)]" style={{ animationDelay: `${index * 90}ms` }}>
            <Check size={10} aria-hidden />
            Filed
          </span>
        ) : (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-provenance/10 px-1.5 py-px text-micro font-medium text-provenance-ink"
            title={model ? `Read by the model${proofSaid(fact) ? `; ${proofSaid(fact)}` : ''}` : 'Read from the page by Realytica'}
          >
            <Sparkles size={10} aria-hidden />
            {model ? 'AI' : 'Read'}
          </span>
        )}
      </div>
      <p className={cn('min-h-[1.25em] break-words text-[14px] font-medium leading-snug text-ink', fact.display.length < 40 && 'font-mono text-[13px]')}>
        {value}
        {value.length < fact.display.length ? <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-provenance" aria-hidden /> : null}
      </p>
      {fact.originalValue ? (
        <p className="text-[12px] text-ink-secondary" lang={fact.originalScript === 'telugu' ? 'te' : 'kn'}>
          {fact.originalValue}
        </p>
      ) : null}
      {model && proofSaid(fact) ? <p className="text-micro text-ink-muted">AI read · {proofSaid(fact)}</p> : null}
      {fact.otherReading ? <OtherReading fact={fact} /> : null}
    </div>
  );
}

/** The other reader's value for the same thing, where the two differ: shown beside it, taken by nobody. */
export function OtherReading({ fact }: { fact: DocumentFact }) {
  const other = fact.otherReading;
  if (!other) return null;
  const said = proofSaid(other);
  return (
    <span className="block text-micro text-provenance-ink">
      {other.source === 'model' ? 'A model read' : 'The page was read here as'} <span className="font-mono">{other.display}</span>
      {other.page ? ` on p.${other.page}` : ''}
      {said ? ` (${said})` : ''}. {otherReadingSaid(fact)}
    </span>
  );
}
