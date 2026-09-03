/**
 * Where a number came from, on the number.
 *
 * Every figure on this page is the result of an arithmetic somebody should be
 * able to argue with, and until now the only way to see that arithmetic was
 * to find the card that happened to render it — which for the screen's own
 * anchors, drivers, confidence score and cost lines was nowhere. The
 * engine computes the working; the page printed the answer.
 *
 * So a figure that has a derivation carries it, and says so with a dotted
 * underline. Three parts, in the order somebody checks a number:
 *
 *   1. **the formula in symbols** — what kind of calculation this is
 *   2. **the same thing with the numbers in it** — so it can be recomputed
 *   3. **a sentence** — the assumption or the caveat a formula cannot state
 *
 * ## Why not the platform `title` attribute
 *
 * `title` cannot be opened from a keyboard, cannot be read by most screen
 * readers reliably, truncates on some platforms and cannot hold a line break —
 * and a substituted formula is two lines of monospace at minimum. It is also
 * the mechanism this file replaces in two places, where a 900-character rate
 * basis was being stuffed into one.
 *
 * ## Why it flips
 *
 * These live in long scrolling lists inside a pane. A popover pinned above its
 * trigger is clipped for every row near the top of the scroll container, which
 * is exactly where the headline figures are. It measures the trigger and opens
 * downward when there is not room above — so the answer is never the one that
 * cannot be read.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from './ui/kit';

export interface Derivation {
  /** The formula in symbols — "rate × area", "Σ(approach × weight)". */
  formula?: string;
  /** The same arithmetic with the numbers substituted in. */
  substituted?: string;
  /** The result, formatted by the caller in the caller's own units. */
  result?: string;
  /** The assumption, the caveat, or where an input came from. */
  note?: ReactNode;
  /** Ordered intermediate lines, for an arithmetic with more than one step. */
  steps?: { label: string; expression?: string; value: string }[];
}

/** Nothing to show is not the same as an empty tooltip. */
export function hasDerivation(d: Derivation | undefined): d is Derivation {
  if (!d) return false;
  return Boolean(d.formula || d.substituted || d.note || d.steps?.length);
}

/**
 * Room above the trigger, in pixels, before it opens downward.
 *
 * The popover is content-sized, so this is a floor rather than a measurement
 * of the panel: 150px holds a formula, a substitution and two lines of note,
 * which is the common case. Anything taller than its space scrolls inside
 * itself rather than being clipped by the pane.
 */
const ROOM_ABOVE = 150;

/** The popover's own `max-w`, in pixels, for the horizontal room test. */
const MAX_WIDTH = 352;

export function FormulaTip({
  children,
  derivation,
  className,
  label,
}: {
  children: ReactNode;
  derivation: Derivation;
  className?: string;
  /** What the number is, as the popover's own heading. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  /*
   * Which edge the popover hangs from.
   *
   * It was pinned to the trigger's right edge unconditionally, which is
   * correct for the figures in a right-aligned numeric column — where most of
   * these live — and wrong for the one that matters most: the headline value
   * sits at the LEFT edge of its card, so a 352px popover hanging leftward
   * ran 125px outside the pane and was clipped. Measured, not assumed.
   */
  const [alignLeft, setAlignLeft] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  const show = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    /*
     * Measured against the nearest scrolling ancestor, not the viewport.
     * The Value tab renders inside a pane with its own overflow, and a
     * viewport-relative test says "plenty of room" for a row that is in fact
     * two pixels below the top of its clipping box.
     */
    if (box) {
      let ceiling = 0;
      let leftWall = 0;
      let node: HTMLElement | null = trigger.current?.parentElement ?? null;
      while (node) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden)/.test(style.overflowY) || /(auto|scroll|hidden)/.test(style.overflowX)) {
          const b = node.getBoundingClientRect();
          ceiling = b.top;
          leftWall = b.left;
          break;
        }
        node = node.parentElement;
      }
      setBelow(box.top - ceiling < ROOM_ABOVE);
      // Hanging leftward needs the popover's own width of room to the left of
      // the trigger's right edge. Where there isn't, it hangs the other way.
      setAlignLeft(box.right - leftWall < MAX_WIDTH);
    }
    setOpen(true);
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    // Escape closes it without moving focus off the figure — a reader who
    // opened this with a keyboard is mid-scan of a column of numbers.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          // Tap opens it on a touch device, where there is no hover at all.
          e.preventDefault();
          open ? hide() : show();
        }}
        className={cn(
          'cursor-help rounded-sm decoration-dotted underline-offset-[3px]',
          'underline decoration-[var(--axis)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-page',
          open && 'decoration-brand',
        )}
      >
        {children}
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'absolute z-50 w-max min-w-[13rem] max-w-[22rem] rounded-lg p-2.5 text-left shadow-pop',
            'max-h-[60vh] overflow-y-auto',
            'bg-[var(--text-primary)] text-[var(--text-inverse)]',
            below ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            alignLeft ? 'left-0' : 'right-0',
          )}
        >
          {label ? (
            <span className="block text-micro uppercase tracking-wider opacity-60">{label}</span>
          ) : null}

          {derivation.formula ? (
            <span className="mt-0.5 block font-mono text-mini leading-snug opacity-80">
              {derivation.formula}
            </span>
          ) : null}

          {derivation.substituted ? (
            <span className="mt-1 block font-mono text-[11.5px] leading-snug tabular-nums">
              {derivation.substituted}
              {derivation.result ? (
                <>
                  {' = '}
                  <span className="font-semibold">{derivation.result}</span>
                </>
              ) : null}
            </span>
          ) : derivation.result ? (
            <span className="mt-1 block font-mono text-[11.5px] font-semibold tabular-nums">
              {derivation.result}
            </span>
          ) : null}

          {derivation.steps?.length ? (
            <span className="mt-1.5 block space-y-0.5 border-t border-[var(--text-inverse)]/20 pt-1.5">
              {derivation.steps.map((s, i) => (
                <span key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="min-w-0 opacity-75">
                    {s.label}
                    {s.expression ? (
                      <span className="block font-mono text-micro opacity-70">{s.expression}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{s.value}</span>
                </span>
              ))}
            </span>
          ) : null}

          {derivation.note ? (
            <span className="mt-1.5 block text-[11px] leading-relaxed opacity-75">{derivation.note}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The same thing, but silent when there is nothing to explain.
 *
 * A dotted underline that opens an empty box is worse than a plain number: it
 * promises a derivation the page does not have. Callers that build a
 * derivation conditionally use this and stop having to write the ternary.
 */
export function MaybeFormulaTip({
  children,
  derivation,
  className,
  label,
}: {
  children: ReactNode;
  derivation: Derivation | undefined;
  className?: string;
  label?: string;
}) {
  if (!hasDerivation(derivation)) return <>{children}</>;
  return (
    <FormulaTip derivation={derivation} className={className} label={label}>
      {children}
    </FormulaTip>
  );
}
