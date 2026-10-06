import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { acceptedOneAtATime, factReview, oneAtATimeSaid, paperCarries, proofSaid, type DocumentFact, type FactReview as Review } from '@realytica/shared';
import { cn } from '../ui/kit';
import { AcceptAllButton, DecideButtons, DecidedMark } from '../review/Decide';
import { OtherReading, useTyped } from './FactRow';

export type FactDecision = 'accept' | 'reject' | 'reopen';
export type FactEdit = { value: string | number | boolean; display: string };

/** What a person typed, as the kind of value the page gave. */
function parseEdit(fact: DocumentFact, text: string): FactEdit | null {
  const display = text.trim();
  if (!display) return null;
  if (typeof fact.value === 'number') {
    const n = Number(display.replace(/[,\s]/g, '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? { value: n, display } : null;
  }
  if (typeof fact.value === 'boolean') return { value: /^(y|yes|true|1)$/i.test(display), display };
  return { value: display, display };
}

/**
 * One row per thing the document states.
 *
 * A newer reading of a value the row already accepts waits beside it rather
 * than replacing it, so the same key can be on the row twice. It is shown
 * once: the reading waiting for a decision, with what is on file now beneath.
 */
export function factRows(facts: DocumentFact[]): Array<{ fact: DocumentFact; onFile?: DocumentFact }> {
  const keys = [...new Set(facts.map((f) => f.key))];
  return keys.map((key) => {
    const same = facts.filter((f) => f.key === key);
    const waiting = same.find((f) => factReview(f) === 'proposed');
    const accepted = same.find((f) => factReview(f) === 'accepted');
    const fact = waiting ?? accepted ?? same[same.length - 1]!;
    return { fact, onFile: waiting && accepted ? accepted : undefined };
  });
}

function ReviewRow({
  fact,
  onFile,
  index,
  state,
  active,
  editing,
  revealing,
  busy,
  onActivate,
  onDecide,
  onEdit,
  onEditDone,
}: {
  fact: DocumentFact;
  onFile?: DocumentFact;
  index: number;
  state: Review;
  active: boolean;
  editing: boolean;
  revealing: boolean;
  busy: boolean;
  onActivate: () => void;
  onDecide: (decision: FactDecision, edit?: FactEdit, take?: 'other') => void;
  onEdit: () => void;
  onEditDone: () => void;
}) {
  const delay = index * 170;
  const value = useTyped(fact.display, delay + 120, revealing);
  const [draft, setDraft] = useState(fact.display);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    setDraft(fact.display);
    window.setTimeout(() => input.current?.select(), 0);
  }, [editing, fact.display]);
  const model = fact.source === 'model';
  return (
    <div
      onMouseEnter={onActivate}
      onClick={onActivate}
      data-active={active || undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 ring-inset transition-[box-shadow,background-color] duration-quick ease-state',
        revealing && 'animate-rise-in',
        state === 'accepted' ? 'ring-good/35' : state === 'rejected' ? 'ring-[var(--ring)]' : 'ring-provenance/40',
        active ? 'bg-raised shadow-raised ring-2' : 'bg-surface hover:bg-raised',
        active && state === 'proposed' && 'ring-provenance/80',
        active && state === 'accepted' && 'ring-good/60',
      )}
      style={revealing ? { animationDelay: `${delay}ms` } : undefined}
    >
      {revealing && state === 'proposed' ? (
        <span className="pointer-events-none absolute inset-0 rounded-lg animate-flash-provenance" style={{ animationDelay: `${delay + 120}ms` }} aria-hidden />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">{fact.label}</span>
          <span className="shrink-0 font-mono text-micro text-ink-muted">p.{fact.page}</span>
          {state === 'proposed' ? (
            <Sparkles
              size={11}
              className="shrink-0 text-provenance-ink"
              aria-label={model ? 'Read by the model' : 'Read from the page'}
            />
          ) : null}
        </div>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const edit = parseEdit(fact, draft);
              if (edit) onDecide('accept', edit);
              onEditDone();
            }}
          >
            <input
              ref={input}
              value={draft}
              aria-label={`Correct ${fact.label}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') onEditDone();
              }}
              onBlur={onEditDone}
              className="w-full rounded-md bg-surface px-2 py-1 font-mono text-[13px] text-ink ring-1 ring-inset ring-provenance/60 focus:outline-none focus:ring-2"
            />
          </form>
        ) : (
          <p
            className={cn(
              'min-h-[1.25em] break-words text-[14px] font-medium leading-snug',
              state === 'rejected' ? 'text-ink-muted line-through' : 'text-ink',
              fact.display.length < 40 && 'font-mono text-[13px]',
            )}
          >
            {value}
            {value.length < fact.display.length ? <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-provenance" aria-hidden /> : null}
          </p>
        )}
        {onFile ? (
          <p className="text-micro text-ink-muted">
            On file now: <span className="font-mono">{onFile.display}</span> — accepting this replaces it
          </p>
        ) : null}
        {fact.edited && fact.readAs ? (
          <p className="text-micro text-ink-muted">
            Corrected · the page reads <span className="font-mono">{fact.readAs.display}</span>
          </p>
        ) : null}
        {fact.originalValue ? (
          <p className="text-[12px] text-ink-secondary" lang={fact.originalScript === 'telugu' ? 'te' : 'kn'}>
            {fact.originalValue}
          </p>
        ) : null}
        {model && proofSaid(fact) ? <p className="text-micro text-ink-muted">AI read · {proofSaid(fact)}</p> : null}
        {fact.otherReading ? (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <OtherReading fact={fact} />
            {state === 'proposed' ? (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onDecide('accept', undefined, 'other');
                }}
                className="rounded text-micro font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                aria-label={`Keep ${fact.otherReading.display} for ${fact.label} instead`}
              >
                Keep {fact.otherReading.display} instead
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {state === 'proposed' ? (
        <DecideButtons
          label={fact.label}
          busy={busy}
          size="sm"
          className={cn(!active && 'opacity-80 group-hover:opacity-100')}
          onEdit={onEdit}
          onAccept={() => onDecide('accept')}
          onSetAside={() => onDecide('reject')}
        />
      ) : (
        <DecidedMark state={state} label={fact.label} busy={busy} onUndo={() => onDecide('reopen')} />
      )}
    </div>
  );
}

/**
 * What a document states, decided value by value where it sits.
 *
 * Each value waits, ochre, beside the words it came from; pointing at one
 * marks those words on the page. Accept it, set it aside, or correct it
 * first — the page's own reading is kept beside a correction. The keyboard
 * walks the list: ↑↓ to move, Enter to accept, Backspace to set aside, E to
 * correct. Bound to the list rather than the window, so typing anywhere else
 * on the canvas is never a decision.
 */
export function FactReviewList({
  documentName,
  documentType,
  offered,
  facts: all,
  busy,
  revealing,
  activeKey,
  onPoint,
  onDecide,
}: {
  documentName: string;
  /** What the row is typed as. A value under a key that kind of paper does not carry is not accepted on it. */
  documentType?: string;
  /** A model's offer of what the paper is, still unanswered. */
  offered?: boolean;
  facts: DocumentFact[];
  busy: boolean;
  revealing: boolean;
  activeKey: string | null;
  onPoint: (fact: DocumentFact | null) => void;
  /** Resolves true once the decision is on the file; false if it was refused. */
  onDecide: (keys: string[] | 'all', decision: FactDecision, edit?: FactEdit, take?: 'other') => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const rows = factRows(all);
  const facts = rows.map((r) => r.fact);
  /*
   * A decision shows the moment it is made. The request follows — queued, so
   * a reviewer walking the list at keyboard speed never loses a keystroke —
   * and the row settles into what the file says once it answers.
   */
  const [optimistic, setOptimistic] = useState<Record<string, Review>>({});
  useEffect(() => {
    setOptimistic((prev) => {
      const still = Object.entries(prev).filter(([key, want]) => {
        const fact = all.find((f) => f.key === key && factReview(f) === want);
        return !fact;
      });
      return still.length === Object.keys(prev).length ? prev : Object.fromEntries(still);
    });
  }, [all]);
  const stateOf = (f: DocumentFact): Review => optimistic[f.key] ?? factReview(f);
  const waiting = facts.filter((f) => stateOf(f) === 'proposed');
  const settled = facts.length - waiting.length;
  const at = Math.max(0, facts.findIndex((f) => f.key === activeKey));

  const activate = (i: number) => {
    const fact = facts[Math.max(0, Math.min(facts.length - 1, i))];
    if (fact) onPoint(fact);
  };

  /** After a decision, the next value still waiting — below first, then from the top. */
  const nextWaiting = (from: number): DocumentFact | undefined =>
    facts.slice(from + 1).find((f) => stateOf(f) === 'proposed' && f.key !== facts[from]?.key)
    ?? facts.slice(0, from).find((f) => stateOf(f) === 'proposed');

  const decide = (fact: DocumentFact, decision: FactDecision, edit?: FactEdit, take?: 'other') => {
    const i = facts.findIndex((f) => f.key === fact.key);
    const next = decision === 'reopen' ? fact : nextWaiting(i);
    const shown: Review = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'proposed';
    setOptimistic((prev) => ({ ...prev, [fact.key]: shown }));
    if (next) onPoint(next);
    list.current?.focus({ preventScroll: true });
    void onDecide([fact.key], decision, edit, take).then((ok) => {
      if (ok) return;
      setOptimistic((prev) => {
        const { [fact.key]: _refused, ...rest } = prev;
        return rest;
      });
    });
  };

  // "All" takes what a person need not look at one by one. A value two readers differ on, a model's yes or no, and an
  // exact value only a second model stands behind are left waiting, as the file leaves them.
  // Nor what the row's kind of paper does not carry: the file accepts none of it until a person says what the paper is.
  const offPaper = waiting.filter((f) => !paperCarries(documentType, f.key));
  const together = waiting.filter((f) => !acceptedOneAtATime(f) && !offPaper.includes(f));
  const oneByOne = oneAtATimeSaid(waiting.filter((f) => !offPaper.includes(f)));
  const offPaperSaid = !offPaper.length
    ? ''
    : offered
      ? `${offPaper.length === 1 ? 'One value waits' : `${offPaper.length} values wait`} until you say what this paper is.`
      : `${offPaper.length === 1 ? 'One value is' : `${offPaper.length} values are`} not what this kind of paper carries, and cannot be accepted on it.`;
  const acceptAll = () => {
    setOptimistic((prev) => ({ ...prev, ...Object.fromEntries(together.map((f) => [f.key, 'accepted' as Review])) }));
    void onDecide('all', 'accept').then((ok) => {
      if (!ok) setOptimistic({});
    });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || e.metaKey || e.ctrlKey || e.altKey) return;
    const here = facts[at];
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      activate(at + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      activate(at - 1);
    } else if (here && stateOf(here) === 'proposed' && e.key === 'Enter') {
      e.preventDefault();
      decide(here, 'accept');
    } else if (here && stateOf(here) === 'proposed' && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      decide(here, 'reject');
    } else if (here && stateOf(here) === 'proposed' && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      setEditing(here.key);
    }
  };

  // The active row stays in view as the keyboard walks it.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] font-semibold text-ink">
          What it states · {facts.length}
          {waiting.length ? <span className="font-normal text-ink-muted"> · {waiting.length} waiting</span> : null}
        </p>
        <AcceptAllButton
          count={together.length}
          busy={busy}
          label={`Accept the ${together.length === 1 ? 'value' : `${together.length} values`} on the ${documentName} that can be accepted together`}
          onAccept={acceptAll}
        />
      </div>
      {oneByOne ? <p className="text-micro text-ink-muted">{oneByOne}</p> : null}
      {offPaperSaid ? <p className="text-micro text-ink-muted">{offPaperSaid}</p> : null}
      <div className="flex items-center gap-2.5" aria-hidden={facts.length === 0}>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-good transition-[width] duration-base ease-state"
            style={{ width: `${facts.length ? Math.round((settled / facts.length) * 100) : 0}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-micro text-ink-muted">
          {settled} of {facts.length} settled
        </span>
      </div>
      {waiting.length ? (
        <p className="hidden items-center gap-1.5 text-micro text-ink-muted sm:flex">
          <kbd className="font-mono">↑↓</kbd> move · <kbd className="font-mono">↵</kbd> accept · <kbd className="font-mono">⌫</kbd> set aside ·{' '}
          <kbd className="font-mono">E</kbd> correct
        </p>
      ) : null}
      <div
        ref={list}
        tabIndex={0}
        role="list"
        aria-label={`Values on the ${documentName}`}
        onKeyDown={onKey}
        onFocus={() => {
          if (!activeKey && facts[0]) onPoint(nextWaiting(-1) ?? facts[0]);
        }}
        className="flex flex-col gap-1.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {rows.map(({ fact, onFile }, i) => (
          <div role="listitem" key={fact.key}>
            <ReviewRow
              fact={fact}
              onFile={onFile}
              index={i}
              state={stateOf(fact)}
              active={fact.key === activeKey}
              editing={editing === fact.key}
              revealing={revealing}
              busy={busy}
              onActivate={() => onPoint(fact)}
              onDecide={(decision, edit, take) => decide(fact, decision, edit, take)}
              onEdit={() => setEditing(fact.key)}
              onEditDone={() => setEditing(null)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
