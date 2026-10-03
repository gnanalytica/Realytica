import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createContext, forwardRef, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, ShieldAlert, X, XCircle } from 'lucide-react';
import { AnimatePresence, AnimatedNumber, EASE_ENTER, SPRING, motion, useDragControls } from '../../lib/motion';
import { useMediaQuery } from '../../lib/useMediaQuery';

export const cn = clsx;

/* ------------------------------------------------------------------ */
/* Tone system — status colours are reserved and always ship with text */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'brand' | 'info' | 'good' | 'warning' | 'serious' | 'critical';

/*
 * Amber and orange are fills, not text: each has a darkened counterpart in the
 * token layer that clears 4.5:1 on paper, and that is what a tone's words use.
 */
const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-secondary',
  brand: 'text-brand',
  info: 'text-brand',
  good: 'text-[var(--status-good-text)]',
  warning: 'text-[var(--status-warning-text)]',
  serious: 'text-[var(--status-serious-text)]',
  critical: 'text-critical',
};

/** The solid fill for a tone — dots, rails and segmented bars all use it. */
export const TONE_FILL: Record<Tone, string> = {
  neutral: 'bg-[var(--axis)]',
  brand: 'bg-brand',
  info: 'bg-brand',
  good: 'bg-good',
  warning: 'bg-warning',
  serious: 'bg-serious',
  critical: 'bg-critical',
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-secondary ring-1 ring-inset ring-[var(--ring)]',
  brand: 'bg-brand-soft text-brand ring-1 ring-inset ring-brand/20',
  info: 'bg-brand-soft text-brand ring-1 ring-inset ring-brand/20',
  good: 'bg-good/10 text-[var(--status-good-text)] ring-1 ring-inset ring-good/25',
  warning: 'bg-warning/15 text-[var(--status-warning-text)] ring-1 ring-inset ring-warning/35',
  serious: 'bg-serious/12 text-[var(--status-serious-text)] ring-1 ring-inset ring-serious/35',
  critical: 'bg-critical/10 text-critical ring-1 ring-inset ring-critical/30',
};

export const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  brand: Info,
  info: Info,
  good: Check,
  warning: AlertTriangle,
  serious: ShieldAlert,
  critical: XCircle,
};

export function toneText(tone: Tone): string {
  return TONE_TEXT[tone];
}

/**
 * The chip surface for a tone — soft fill, matching text, inset ring.
 *
 * Exposed alongside `toneText` so anything that needs a tinted, tappable
 * surface (a verdict segment, a status pill) inherits the same tokens as
 * `Badge` rather than re-deriving them and drifting out of step with the
 * palette.
 */
export function toneChip(tone: Tone): string {
  return TONE_CHIP[tone];
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({ className, children, as: As = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return (
    <As className={cn('rounded-2xl bg-surface ring-1 ring-[var(--ring)] shadow-card print-block', className)}>
      {children}
    </As>
  );
}

/**
 * `subtitle` occupies a line of the screen forever; `info` occupies none until
 * asked. A caveat that a reader must not miss belongs in `subtitle`; one that
 * only matters when they wonder belongs in `info`.
 */
export function CardHeader({
  title,
  subtitle,
  info,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  info?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-hairline px-4 py-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {/* The icon sits in a small tile, so a column of cards reads as a set of
            labelled things rather than a run of headings. */}
        {icon ? <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-sunken text-ink-secondary ring-1 ring-inset ring-[var(--ring)] [&_svg]:size-[15px]">{icon}</span> : null}
        <div className="min-w-0 self-center">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="truncate text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
            {info ? <InfoTip label={info} /> : null}
          </div>
          {subtitle ? <p className="mt-0.5 text-xs leading-snug text-ink-secondary">{subtitle}</p> : null}
        </div>
      </div>
      {/* Beside the title when there is room. When it wraps under it, it is
          held to the card's width so its own contents wrap rather than run
          past the card's edge on a phone. */}
      {action ? <div className="max-w-full shrink-0">{action}</div> : null}
    </header>
  );
}

/** The affordance that says "there is a caveat here" without spending a line on it. */
export function InfoTip({ label, className }: { label: ReactNode; className?: string }) {
  return (
    <Tooltip label={label} className={className}>
      <button
        type="button"
        aria-label="About this"
        /* 16px, and it appears on nearly every card header. An icon button has
           no typography to protect, so it simply grows on a touch pointer. */
        className="grid shrink-0 place-items-center rounded-full p-0.5 text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand coarse:min-h-11 coarse:min-w-11"
      >
        <Info size={12} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/**
 * The sentence behind a row, out of the way until it is wanted.
 *
 * The engine writes real prose — why a risk matters, what a compliance finding
 * means, what to do next — and every register printed all of it inline. On the
 * Risks pane that was four paragraphs a row; on Compliance, four per check
 * across thirteen checks. A list where each entry is a paragraph is a list
 * nobody scans, and scanning is what a register is for.
 *
 * So the row carries the facts and this carries the sentence. Two rules make
 * that safe rather than merely tidier:
 *
 *  - `print-open` is the same class `StatutoryProvenance` uses, and the report
 *    stylesheet forces it open. Nothing is lost from the document that leaves
 *    the building — the prose simply stops competing with the figures on the
 *    screen somebody works in.
 *  - It is a `<details>`, so it is keyboard-reachable and findable by the
 *    browser's own find-in-page. A tooltip would have hidden the text from
 *    both, which is the wrong trade for content this substantive.
 */
export function Why({
  label = 'Why',
  children,
  className,
}: {
  /** What the reveal is called. Name the content, not the act of opening it. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <details className={cn('print-open group mt-1', className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-mini text-ink-muted hover:text-ink-secondary">
        <ChevronDown size={11} className="no-print transition-transform duration-base group-open:rotate-180" />
        {label}
      </summary>
      <div className="mt-1 space-y-1 border-l-2 border-[var(--ring)] pl-2.5 text-xs leading-relaxed text-ink-secondary">
        {children}
      </div>
    </details>
  );
}

/**
 * A 0..1 number as a length, beside the number.
 *
 * For the values a sentence was carrying: an anchor's weight and its
 * confidence are both fractions, both computed on every run, and only one of
 * them was ever drawn — so a locality median and seven inspected comparables
 * looked identical in the list, and the difference lived in a paragraph.
 *
 * The figure stays: a bar answers "more or less than its neighbour" at a
 * glance and "how much" never, and this is a document people quote from.
 */
export function Meter({
  label,
  value,
  className,
}: {
  label: string;
  /** 0..1. Clamped, because a confidence over one is a bug in the caller, not a wider bar. */
  value: number;
  className?: string;
}) {
  const fraction = Math.max(0, Math.min(1, value));
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-mini text-ink-muted', className)}>
      {label}
      <span
        className="h-1 w-10 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]"
        role="img"
        aria-label={`${label} ${Math.round(fraction * 100)} percent`}
      >
        <span className="block h-full rounded-full bg-brand" style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="font-mono tabular-nums text-ink-secondary">{Math.round(fraction * 100)}%</span>
    </span>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      {/*
        Sentence case, not micro-caps.

        Uppercase at eleven pixels with letter-spacing is the house style of
        every generated dashboard, and it costs something real: capitals remove
        the word-shape a reader recognises without spelling out, so the label
        that was meant to be skimmed is the one that has to be read. Weight and
        colour separate a heading from its content perfectly well at this size.
      */}
      <h3 className="text-[12px] font-semibold text-ink-secondary">{children}</h3>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}

/**
 * The top of a page outside a project: where you are, what this is, and the
 * one or two things to do here. One component so every page opens the same
 * way — the size of a title is not something each page decides.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[12px] font-medium text-ink-muted">{eyebrow}</p> : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-ink-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
}

/**
 * What an interactive thing does when you touch it.
 *
 * Three states, defined once. Before this the app had 73 hover declarations
 * against 35 transitions — so most hovers snapped — two `active:` states in
 * the entire codebase, meaning almost nothing acknowledged being pressed, and
 * one `focus-visible`, meaning a keyboard user could not see where they were.
 *
 * `focus-visible` rather than `focus` deliberately: a mouse user clicking a
 * button should not be left with a ring on it, but a keyboard user tabbing
 * through must be able to see what they are on. The browser knows the
 * difference and this is how you ask it.
 *
 * The press is a scale rather than a colour shift because colour is already
 * carrying meaning everywhere in this product — verdicts, severities,
 * provenance — and borrowing it for "you are pressing this" would be one more
 * thing competing with a critical risk badge for the same signal.
 */
export const INTERACTIVE =
  'transition-[color,background-color,border-color,box-shadow,transform] duration-quick ease-state ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page ' +
  'active:scale-[0.98] disabled:active:scale-100';

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium',
        INTERACTIVE,
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        // Visual height stays as designed; a coarse pointer gets a 44px hit
        // area instead. See the `coarse:` note in tailwind.config.js.
        'coarse:min-h-11',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-action text-action-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_1px_2px_rgb(var(--shadow-tint)/0.18)] hover:bg-action-hover',
        variant === 'secondary' &&
          'bg-surface text-ink ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken',
        variant === 'ghost' && 'text-ink-secondary hover:bg-sunken hover:text-ink',
        variant === 'danger' && 'bg-critical text-white hover:opacity-90',
        className,
      )}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** "Title", "Cause" → "Title and Cause"; three or more get commas. */
export function andList(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The button that commits a form, which says what it is waiting for.
 *
 * A submit that is disabled and silent is the single most common way this
 * application looked broken: the reader fills a dialog in, the button stays
 * grey, and nothing anywhere says which field is still empty. So the reason
 * is named, in the same words as the labels above it, and it is wired to the
 * button with `aria-describedby` so a screen reader reads it as part of the
 * button rather than as loose text in the footer.
 *
 * `busy` is separate from `needs` on purpose. "Nothing is missing but the
 * save has not come back yet" and "you still owe me a title" are different
 * states and they looked identical before: both were a grey button.
 */
export function SubmitButton({
  needs = [],
  busy = false,
  variant = 'primary',
  onClick,
  children,
}: {
  /** Labels of the fields still required, exactly as the fields are labelled. */
  needs?: string[];
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const blocked = needs.length > 0;
  return (
    <>
      {blocked ? (
        // `mr-auto` in a footer that lays out `justify-end`: the reason sits
        // at the far left, against the button it explains.
        <span id={id} className="mr-auto min-w-0 text-[12px] text-ink-secondary">
          Needs {andList(needs)}
        </span>
      ) : null}
      <Button
        variant={variant}
        loading={busy}
        disabled={blocked}
        aria-describedby={blocked ? id : undefined}
        onClick={onClick}
      >
        {children}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Badges, dots, stats                                                 */
/* ------------------------------------------------------------------ */

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-mini font-medium leading-4 whitespace-nowrap',
        TONE_CHIP[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * The mark on anything a model wrote.
 *
 * Rose, square, and the two letters, the same everywhere: beside a copilot
 * answer, on a proposal that waits for a person, on a value read off a page.
 * A reader learns it once and can then tell, at a glance and at any size,
 * which parts of a screen are the file and which are a machine's suggestion
 * about it.
 */
export function AiMark({ size = 'sm', busy = false, className }: { size?: 'xs' | 'sm' | 'md'; busy?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-grid shrink-0 place-items-center rounded-md bg-ai font-semibold tracking-[0.02em] text-white',
        size === 'xs' && 'size-4 text-[8px]',
        size === 'sm' && 'size-5 text-[9px]',
        size === 'md' && 'size-7 rounded-lg text-[11px]',
        className,
      )}
    >
      {busy ? <span className="absolute inset-0 animate-ping rounded-md bg-ai/40" /> : null}
      <span className="relative">AI</span>
    </span>
  );
}

export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TONE_FILL[tone], className)} />;
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

/**
 * The tone wash for each register, as a class.
 *
 * A tile's tone is the fastest signal on a dense screen — before any label is
 * read, the colour says which register this belongs to. Kept weak on purpose
 * (see the token layer): these are here to group and orient, not to decorate.
 * A diligence tool whose surfaces shout competes with its own findings, and
 * the findings have to win.
 */
const TILE_WASH: Record<Tone, string> = {
  neutral: '',
  brand: 'bg-grad-brand',
  info: 'bg-grad-brand',
  good: 'bg-grad-good',
  warning: 'bg-grad-warning',
  serious: 'bg-grad-serious',
  critical: 'bg-grad-critical',
};

/** The accent rail colour, matching the wash. */
const TILE_RAIL: Record<Tone, string> = {
  neutral: 'bg-hairline',
  brand: 'bg-brand',
  info: 'bg-brand',
  good: 'bg-good',
  warning: 'bg-warning',
  serious: 'bg-serious',
  critical: 'bg-critical',
};

/**
 * A surface with presence.
 *
 * `Card` remains the plain container for dense reading — tables, long prose,
 * anything where a gradient would be noise behind text. `Tile` is for the
 * things a reader's eye should land on first: a figure, a status, a case in a
 * grid, a section opener.
 *
 * Three layers make it read as a surface rather than a rectangle of colour: a
 * base gradient from the lighter surface to the darker one, the tone wash
 * over it, and a sheen on the top edge. Drop any one and it flattens.
 *
 * `interactive` adds the lift. It is opt-in rather than automatic because a
 * tile that rises under the cursor is promising it can be clicked, and one
 * that lifts without a destination is a small lie the whole interface pays
 * for.
 */
export function Tile({
  tone = 'neutral',
  rail,
  interactive,
  className,
  children,
  as: As = 'div',
}: {
  tone?: Tone;
  /** Draws an accent rail down the leading edge in the tone's colour. */
  rail?: boolean;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <As
      className={cn(
        'relative isolate overflow-hidden rounded-xl bg-tile shadow-tile ring-1 ring-[var(--ring)] print-block',
        interactive &&
          'transition-[box-shadow,transform,background-color] duration-base ease-enter hover:-translate-y-0.5 hover:shadow-raised motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {/* Wash and sheen are painted as siblings rather than on the tile
          itself: a single element cannot carry three background layers and
          still let a caller override the base with a className. */}
      {tone !== 'neutral' && <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 -z-10', TILE_WASH[tone])} />}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-16 bg-sheen" />
      {rail && <span aria-hidden="true" className={cn('pointer-events-none absolute inset-y-0 left-0 w-[3px]', TILE_RAIL[tone])} />}
      {children}
    </As>
  );
}

/**
 * A figure, in a tile, with its tone.
 *
 * The plain `Stat` is still the right thing inside a dense card. This is for
 * the top of a page, where four figures are the first thing a reader sees and
 * the difference between them should be visible before any of them is read.
 */
/**
 * One row of a register.
 *
 * Findings, Risks and Decisions are the same shape of thing — a title, the
 * sentence behind it, a line of facts, and one control on the right — and each
 * had built that shape separately. They had already drifted: Risks carries a
 * comment explaining why the owner belongs inline in the meta line ("a whole
 * line per risk spent on a constant"), and Findings, which was never changed,
 * still spent that line. A shared row is how that stops happening a third
 * time.
 *
 * The trailing slot does not wrap and does not move. A long title must not
 * relocate the status dropdown, because a register is read by running down a
 * column, and a column that jogs left and right is not one.
 */
export function RegisterRow({
  title,
  why,
  meta,
  trailing,
  className,
}: {
  title: ReactNode;
  /** The engine's own prose, behind a disclosure. Absent is normal. */
  why?: ReactNode;
  /** The facts a reader scans: category, counts, owner. One line. */
  meta?: ReactNode;
  /** The control that acts on this row. Right-aligned and fixed. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {why ? <Why>{why}</Why> : null}
        {meta ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">{meta}</div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
  pending = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  /**
   * The figure has not arrived yet.
   *
   * Not the same as zero, and the difference is the whole point: a tile that
   * renders "0 projects" while the request is still in flight tells the
   * reader their workspace is empty, and they believe it. The tile keeps its
   * size and its label and withholds only the number.
   */
  pending?: boolean;
}) {
  if (pending) {
    return (
      <Tile tone={tone} className={cn('p-4', className)} aria-busy="true">
        <span className="text-[12px] font-medium text-ink-muted">{label}</span>
        <Skeleton className="mt-1.5 h-[26px] w-16" />
        {hint ? <Skeleton className="mt-1.5 h-[15px] w-24" /> : null}
      </Tile>
    );
  }
  return (
    <Tile tone={tone} className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-medium text-ink-muted">{label}</span>
        {icon ? <span className={cn('shrink-0', TONE_TEXT[tone])}>{icon}</span> : null}
      </div>
      {/*
        * The value sizes itself down rather than truncating.
        *
        * A fixed 26px with `truncate` clipped "1,96,172 sq ft" to
        * "1,96,172 s…" — a stat tile whose whole job is to carry one figure,
        * hiding the end of it. Indian digit grouping and a unit suffix make
        * long values ordinary here, not exceptional, so the size steps down
        * to fit instead. `truncate` stays as the backstop for a value no size
        * would fit, with the full text on the element for hover.
        */}
      <div
        className={cn('mt-1.5 truncate font-semibold leading-none tracking-tight tabular-nums', valueSizeClass(value), TONE_TEXT[tone])}
        title={typeof value === 'string' ? value : undefined}
      >
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </div>
      {hint ? <div className="mt-1.5 text-[12px] leading-snug text-ink-secondary">{hint}</div> : null}
    </Tile>
  );
}

/**
 * How big a headline figure can be and still fit one line of its box.
 *
 * Both `Stat` and `StatTile` truncated at a fixed size, which clipped exactly
 * the values that matter most here: "1,96,172 sq ft" and "₹4,069/sq ft" lost
 * their tails, and a figure with its end hidden is worse than a smaller one.
 * Indian digit grouping plus a unit suffix makes long values the ordinary
 * case in this product, not the exception, so the size steps down to fit.
 */
function valueSizeClass(value: ReactNode, scale: 'tile' | 'stat' = 'tile'): string {
  const steps =
    scale === 'stat'
      ? ['text-2xl', 'text-[20px]', 'text-[17px]', 'text-[15px]']
      : ['text-[26px]', 'text-[21px]', 'text-[18px]', 'text-[16px]'];
  if (typeof value !== 'string' && typeof value !== 'number') return steps[0];
  const len = String(value).length;
  if (len <= 8) return steps[0];
  if (len <= 12) return steps[1];
  if (len <= 16) return steps[2];
  return steps[3];
}

export function KeyValue({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  /*
   * Wraps rather than truncates.
   *
   * This row used to pin the label and truncate the value, which turned
   * "₹4,069/sq ft" into "₹4,069/sq…" and the registering authority's name
   * into a fragment. Truncating the label instead just moved the damage:
   * these rows sit in grid columns as narrow as 36px in the report, where
   * any fixed split clips one side or the other.
   *
   * So neither side is cut. Label and value sit on one line where they fit
   * and the value drops to its own full-width line where they do not —
   * every character of both, at every width.
   */
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-hairline py-1.5 last:border-0">
      <dt className="text-xs text-ink-secondary">{label}</dt>
      <dd className={cn('min-w-0 flex-1 text-right text-[13px] font-medium text-ink [overflow-wrap:anywhere]', mono && 'tabular')}>
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress / meters                                                   */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  value,
  tone = 'brand',
  label,
  showValue = true,
  className,
}: {
  value: number;
  tone?: Tone;
  label?: ReactNode;
  showValue?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-secondary">{label}</span>
          {showValue ? <span className="tabular font-medium text-ink">{Math.round(v)}</span> : null}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]">
        {/* Fills from nothing the first time, then travels to each new value. */}
        <motion.div
          className={cn('h-full rounded-full', TONE_FILL[tone])}
          initial={{ width: 0 }}
          animate={{ width: `${v}%` }}
          transition={{ duration: 0.7, ease: EASE_ENTER }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

/**
 * The id a `Field` minted, for whichever control ends up inside it.
 *
 * Through context rather than `cloneElement` because a field's child is often
 * a wrapper — `OwnerInput`, a picker, anything composed — and cloning would
 * put the id on the wrapper while the actual `<input>` stayed nameless. Every
 * control below reads this and uses it only when it has no id of its own, so
 * a caller who wants to manage the id still can.
 *
 * Until this existed, `Field` took an `htmlFor` that almost no call site
 * passed, which meant a screen reader announced most of this app's inputs with
 * no name at all — and the failure was invisible to anyone not using one.
 */
const FieldIdContext = createContext<string | undefined>(undefined);

/**
 * The id this control should carry, if any.
 *
 * A control that names itself — `aria-label` on one of several inputs inside a
 * composite — does not take the field's id, and that rule is what stops a
 * `Field` wrapping a condition editor from stamping one id onto six inputs.
 * Duplicate ids are invalid, and worse here than merely invalid: they undo the
 * association this context exists to create, so every input in the group
 * points at the same label and the group's own labels stop being announced.
 */
export function useFieldId(own?: string, selfLabelled?: unknown): string | undefined {
  const inherited = useContext(FieldIdContext);
  if (own) return own;
  return selfLabelled ? undefined : inherited;
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 flex items-baseline gap-1 text-xs font-medium text-ink-secondary">
        {label}
        {required ? <span className="text-critical">*</span> : null}
      </label>
      <FieldIdContext.Provider value={id}>{children}</FieldIdContext.Provider>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-critical">
          <XCircle size={12} /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/*
 * `focus:` and not `focus-visible:` here, unlike buttons — a text field should
 * show it has the caret however you got to it, because the ring is telling you
 * where your typing will go rather than where the keyboard is.
 */
/*
 * `coarse:text-base` is not a size preference — it is what stops iOS Safari
 * zooming the whole page the moment a field takes focus. Safari does that for
 * any input under 16px and does not zoom back out, so a valuer filling a form
 * on a phone ends up panning a magnified page between every field. 13px is
 * right under a mouse and unusable on a phone for that one reason.
 */
const CONTROL =
  'w-full rounded-lg bg-surface px-2.5 text-[13px] coarse:text-base coarse:min-h-11 text-ink ring-1 ring-inset ring-[var(--ring)] ' +
  'transition-[box-shadow,border-color] duration-quick ease-state ' +
  'hover:ring-[var(--text-muted)] ' +
  'placeholder:text-ink-muted focus:ring-2 focus:ring-brand focus:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.12)] disabled:opacity-60 disabled:hover:ring-[var(--ring)]';

export function Input({ className, id, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} id={useFieldId(id, rest['aria-label'])} className={cn(CONTROL, 'h-9', className)} />;
}

/*
 * Ref-forwarding, because an auto-growing composer has to measure its own
 * scrollHeight and there is no way to do that through a wrapper that swallows
 * the ref. Input and Select do not forward one because nothing needs it yet;
 * add it when something does rather than on principle.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, id, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        {...rest}
        id={useFieldId(id, rest['aria-label'])}
        className={cn(CONTROL, 'min-h-[76px] py-2 leading-relaxed', className)}
      />
    );
  },
);

export function Select({ className, id, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select {...rest} id={useFieldId(id, rest['aria-label'])} className={cn(CONTROL, 'h-9 appearance-none pr-8', className)}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-start gap-2 py-0.5 text-[13px] text-ink coarse:min-h-11 coarse:items-center coarse:py-2', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:mt-0 coarse:h-5 coarse:w-5"
      />
      {label ? <span className="min-w-0">{label}</span> : null}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-ink-muted', className)} />;
}

/** A shape holding a place, with a sheen crossing it so it reads as on its way rather than empty. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-sunken', className)} aria-hidden="true">
      <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-[var(--sheen-soft)] to-transparent" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex animate-fade-in flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {icon ? <div className="mb-1 grid size-11 place-items-center rounded-full bg-sunken text-ink-muted ring-1 ring-inset ring-[var(--ring)]">{icon}</div> : null}
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-xs leading-relaxed text-ink-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * `collapsible` is for exposition, never for a finding.
 *
 * A callout that states something true about THIS case — a risk, a gap, a
 * result — has to be visible the moment the page opens, or it has failed at
 * the one thing it exists to do. A callout that explains background ("why
 * there is no fetch button", "this describes the locality, not the parcel")
 * is read once and then re-explains itself on every visit; `collapsible`
 * lets that kind collapse to its title, with the reasoning a click away.
 * Requires a `title` — a collapsed callout with nothing to summarise it by
 * is a row that says nothing, so without one this renders open regardless.
 */
export function Callout({
  tone = 'info',
  title,
  children,
  collapsible = false,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
}) {
  const Icon = TONE_ICON[tone];
  const [open, setOpen] = useState(false);
  const canCollapse = collapsible && title !== undefined;

  if (!canCollapse) {
    return (
      <div className={cn('flex gap-2.5 rounded-lg p-3 text-xs leading-relaxed', TONE_CHIP[tone])}>
        <Icon size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
          <div className="text-ink-secondary">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg text-xs leading-relaxed', TONE_CHIP[tone])}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 p-3 text-left" aria-expanded={open}>
        <Icon size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 font-semibold">{title}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE_ENTER }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pl-[34px] text-ink-secondary">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layers — what sits above the application, and what that costs it     */
/* ------------------------------------------------------------------ */

/**
 * Everything that paints over the application renders into `document.body`
 * marked `data-layer`, not into the page that opened it.
 *
 * Two reasons, and the second is the one that matters. A dialog nested in
 * the tree inherits every `overflow: hidden` and stacking context between
 * it and the root, so where it appears depends on where it was declared.
 * And a dialog that cannot be distinguished from the page behind it cannot
 * make that page inert — which is the actual defect this was written for:
 * a screen reader tabbing straight past an open dialog into the controls
 * underneath it, and changing them.
 */
function useLayer(kind: 'modal' | 'toast') {
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.dataset.layer = kind;
    return el;
  });
  useEffect(() => {
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host]);
  return host;
}

/**
 * How many dialogs are open. A dialog opened from a dialog must not
 * un-inert the page when the inner one closes, so the background is only
 * released by the last one out.
 */
let openDialogs = 0;

/** Marks everything that is not a layer as `inert` for as long as a dialog is open. */
function useInertBackground() {
  useEffect(() => {
    openDialogs += 1;
    const marked: Element[] = [];
    if (openDialogs === 1) {
      for (const child of [...document.body.children]) {
        // Toasts keep working over a dialog: a failed save has to be able to
        // say so while the form the reader is still looking at stays open.
        if (child instanceof HTMLElement && child.dataset.layer) continue;
        if (child.hasAttribute('inert')) continue;
        child.setAttribute('inert', '');
        marked.push(child);
      }
    }
    return () => {
      openDialogs -= 1;
      for (const child of marked) child.removeAttribute('inert');
    };
  }, []);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  // The frame is a separate component so its effects run on open and clean up
  // on close. A hook inside `Modal` itself would live for as long as the page
  // that declares the dialog, which is not the same lifetime at all. The
  // presence wrapper holds it a moment longer on close, for its way out.
  return <AnimatePresence>{props.open ? <ModalFrame key="dialog" {...props} /> : null}</AnimatePresence>;
}

/** Below this the dialog is a sheet from the bottom edge, where a thumb is. */
const SHEET_QUERY = '(max-width: 639px)';

function ModalFrame({
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  const host = useLayer('modal');
  const panel = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const sheet = useMediaQuery(SHEET_QUERY);
  // The sheet is dragged by its handle and header only: a drag anywhere would
  // take the gesture from a long form that needs to scroll.
  const drag = useDragControls();
  const grab = sheet ? (e: React.PointerEvent) => drag.start(e) : undefined;
  useInertBackground();

  // Focus goes in on open and comes back out on close. Coming back matters
  // more than going in: a reader who opened a dialog from a row in a register
  // of two hundred should not be returned to the top of it.
  useEffect(() => {
    const returnTo = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, []);

  // `inert` on the background stops the pointer and the accessibility tree,
  // but Tab is a document-order walk that would still leave through the end
  // of the dialog. Cycle it back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (stops.length === 0) {
        e.preventDefault();
        panel.current.focus();
        return;
      }
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge || !panel.current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <motion.div
        className="absolute inset-0 bg-[rgb(var(--shadow-tint)/0.42)] backdrop-blur-[2px]"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        /*
         * On a phone it is a sheet: it rises from the bottom edge and goes back
         * down when dragged there, the way every sheet on the phone does. On
         * anything wider it is a dialog that settles into the middle.
         */
        initial={sheet ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 10 }}
        animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
        exit={sheet ? { y: '100%' } : { opacity: 0, scale: 0.98, y: 6, transition: { duration: 0.16 } }}
        transition={SPRING.layer}
        drag={sheet ? 'y' : false}
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
        className={cn(
          'relative z-10 flex w-full flex-col overflow-hidden bg-surface shadow-pop outline-none ring-1 ring-[var(--ring)]',
          'max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:max-h-[min(92dvh,40rem)] sm:rounded-2xl sm:pb-0',
          width === 'sm' && 'sm:max-w-sm',
          width === 'md' && 'sm:max-w-lg',
          width === 'lg' && 'sm:max-w-3xl',
        )}
      >
        {sheet ? (
          <div onPointerDown={grab} className="flex shrink-0 touch-none justify-center pb-1 pt-2" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-[var(--axis)]" />
          </div>
        ) : null}
        <header onPointerDown={grab} className={cn('flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3', sheet && 'touch-none')}>
          <h2 id={labelId} className="min-w-0 truncate text-[13px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="shrink-0 rounded p-1 coarse:p-3 text-ink-muted hover:bg-sunken hover:text-ink" aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-hairline px-4 py-3">{footer}</footer>
        ) : null}
      </motion.div>
    </div>,
    host,
  );
}

/** Lightweight hover/focus tooltip — no portal, positioned above the trigger. */
export function Tooltip({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // A pointer passing over on its way somewhere else should not set off a
  // tooltip; a pointer that stops should get one at once. Focus is immediate.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => show(140)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      <AnimatePresence>
        {open ? (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: 3, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.14, ease: EASE_ENTER }}
            style={{ x: '-50%' }}
            className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max max-w-[16rem] origin-bottom rounded-md bg-[var(--text-primary)] px-2 py-1 text-mini leading-snug text-[var(--text-inverse)] shadow-pop"
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

interface ToastMsg { id: number; tone: Tone; text: string }
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const seq = useRef(0);
  const host = useLayer('toast');

  const push = (text: string, tone: Tone = 'neutral') => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4200);
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* Into the toast layer rather than here in the tree: an open dialog
          marks the application inert, and a save that failed has to be able
          to say so over the form the reader is still looking at. */}
      {createPortal(
      <div className="no-print pointer-events-none fixed bottom-[max(4.75rem,env(safe-area-inset-bottom))] left-3 right-3 z-[70] flex max-w-sm flex-col gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:w-80">
        <AnimatePresence initial={false}>
          {items.map((i) => {
            const Icon = TONE_ICON[i.tone];
            return (
              <motion.div
                key={i.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 28, transition: { duration: 0.18 } }}
                transition={SPRING.layer}
                className="pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-xl bg-surface p-3 text-[13px] shadow-pop ring-1 ring-[var(--ring)]"
              >
                <span className={cn('mt-px grid size-5 shrink-0 place-items-center rounded-full', TONE_CHIP[i.tone])}>
                  <Icon size={11} />
                </span>
                <span className="min-w-0 flex-1 leading-snug text-ink">{i.text}</span>
                <button onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))} className="rounded p-0.5 text-ink-muted hover:bg-sunken hover:text-ink coarse:p-2" aria-label="Dismiss">
                  <X size={12} />
                </button>
                {/* How long it will stay, drawn rather than guessed at. */}
                <motion.span
                  aria-hidden="true"
                  className={cn('absolute bottom-0 left-0 h-0.5', TONE_FILL[i.tone])}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 4.2, ease: 'linear' }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>,
      host,
      )}
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Disclosure                                                          */
/* ------------------------------------------------------------------ */

/**
 * A section that folds.
 *
 * A `<details>` rather than conditional rendering, for the same reason the
 * report's sections are: the browser's own find-in-page and the print
 * stylesheet can both reach inside a closed one, and neither can reach
 * content React never rendered. A folded section is still in the document,
 * still findable, still printed — folded, not filtered, which is the rule
 * everywhere in this application that hides anything.
 *
 * `count` is on the summary on purpose. A fold that does not say how much is
 * behind it makes the reader open it to find out, which costs more than the
 * fold saved.
 */
export function Disclosure({
  title,
  count,
  icon,
  defaultOpen = false,
  tone,
  children,
}: {
  title: ReactNode;
  count?: number;
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** Colours the count, for a section whose contents are a problem. */
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl bg-surface ring-1 ring-inset ring-[var(--ring)] print-open">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium text-ink coarse:min-h-11',
          'hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronDown
          size={14}
          className="shrink-0 text-ink-muted transition-transform duration-quick ease-state group-open:rotate-180"
        />
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count !== undefined ? (
          <span className={cn('tabular shrink-0 rounded-full px-1.5 text-mini', count > 0 ? toneChip(tone ?? 'neutral') : 'text-ink-muted')}>
            {count}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-hairline px-3 py-3">{children}</div>
    </details>
  );
}
