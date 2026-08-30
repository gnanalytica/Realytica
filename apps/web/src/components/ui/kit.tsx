import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createContext, forwardRef, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, ShieldAlert, X, XCircle } from 'lucide-react';

export const cn = clsx;

/* ------------------------------------------------------------------ */
/* Tone system — status colours are reserved and always ship with text */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'brand' | 'info' | 'good' | 'warning' | 'serious' | 'critical';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-secondary',
  brand: 'text-brand',
  info: 'text-brand',
  good: 'text-[var(--status-good-text)]',
  warning: 'text-ink',
  serious: 'text-ink',
  critical: 'text-critical',
};

const TONE_DOT: Record<Tone, string> = {
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
  brand: 'bg-brand-soft text-brand ring-1 ring-inset ring-brand/25',
  info: 'bg-brand-soft text-brand ring-1 ring-inset ring-brand/25',
  good: 'bg-good/10 text-[var(--status-good-text)] ring-1 ring-inset ring-good/35',
  warning: 'bg-warning/15 text-ink ring-1 ring-inset ring-warning/45',
  serious: 'bg-serious/15 text-ink ring-1 ring-inset ring-serious/45',
  critical: 'bg-critical/10 text-critical ring-1 ring-inset ring-critical/40',
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
    <As className={cn('rounded-xl bg-surface ring-1 ring-[var(--ring)] shadow-card print-block', className)}>
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start justify-between gap-4 border-b border-hairline px-4 py-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-snug text-ink-secondary">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-mini font-semibold uppercase tracking-[0.07em] text-ink-muted">{children}</h3>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
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

/**
 * A surface that rises to meet the pointer.
 *
 * Only for things that genuinely go somewhere when clicked. A lift on a
 * non-interactive card is a promise the interface does not keep, and users
 * learn very quickly to stop trusting the cue.
 */
export const LIFT =
  'transition-[transform,box-shadow,border-color] duration-base ease-enter ' +
  'hover:-translate-y-0.5 hover:shadow-pop active:translate-y-0 active:shadow-none ' +
  'motion-reduce:hover:translate-y-0';

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
        variant === 'primary' && 'bg-brand text-[var(--brand-ink)] hover:bg-brand-strong',
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

export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone], className)} />;
}

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)} title={hint}>
      <div className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</div>
      <div
        className={cn('mt-1 truncate font-semibold leading-tight tracking-tight', valueSizeClass(value, 'stat'), TONE_TEXT[tone])}
        title={hint ?? (typeof value === 'string' ? value : undefined)}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-ink-secondary">{sub}</div> : null}
    </div>
  );
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
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Tile tone={tone} className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</span>
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
        className={cn('mt-1.5 truncate font-semibold leading-none tracking-tight', valueSizeClass(value), TONE_TEXT[tone])}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
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

/**
 * A full-bleed band behind a section.
 *
 * Long pages in this app run for thousands of pixels on one flat ground, and
 * a reader loses their place in it. Alternating the ground gives the page a
 * rhythm and makes "where does this section end" answerable without reading
 * anything.
 */
export function SectionBand({
  ground = 'page',
  className,
  children,
}: {
  ground?: 'page' | 'surface' | 'sunken' | 'brand';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative',
        ground === 'surface' && 'bg-surface',
        ground === 'sunken' && 'bg-sunken',
        className,
      )}
    >
      {ground === 'brand' && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-band" />}
      <div className="relative">{children}</div>
    </div>
  );
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
        <div className={cn('h-full rounded-full transition-[width] duration-500', TONE_DOT[tone])} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

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
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1 flex items-baseline gap-1 text-xs font-medium text-ink-secondary">
        {label}
        {required ? <span className="text-critical">*</span> : null}
      </label>
      {children}
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
  'placeholder:text-ink-muted focus:ring-2 focus:ring-brand disabled:opacity-60 disabled:hover:ring-[var(--ring)]';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL, 'h-9', className)} />;
}

/*
 * Ref-forwarding, because an auto-growing composer has to measure its own
 * scrollHeight and there is no way to do that through a wrapper that swallows
 * the ref. Input and Select do not forward one because nothing needs it yet;
 * add it when something does rather than on principle.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} {...rest} className={cn(CONTROL, 'min-h-[76px] py-2 leading-relaxed', className)} />;
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...rest} className={cn(CONTROL, 'h-9 appearance-none pr-8', className)}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[13px] text-ink coarse:min-h-11"
    >
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full transition-colors',
          size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
          checked ? 'bg-brand' : 'bg-[var(--axis)]',
        )}
      >
        <span
          className={cn(
            'absolute rounded-full bg-white transition-transform',
            size === 'sm' ? 'h-3 w-3 translate-x-0.5' : 'h-4 w-4 translate-x-0.5',
            checked && (size === 'sm' ? 'translate-x-[14px]' : 'translate-x-[18px]'),
          )}
        />
      </span>
      {label}
    </button>
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

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export function Tabs({ tabs, active, onChange, className }: { tabs: TabDef[]; active: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div className={cn('flex gap-0.5 overflow-x-auto border-b border-hairline', className)} role="tablist">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium coarse:min-h-11',
              // No `active:scale` on a tab: the underline is the feedback, and
              // a shrinking tab in a fixed row nudges its neighbours.
              'transition-[color,border-color] duration-quick ease-state',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
              on ? 'border-brand text-ink' : 'border-transparent text-ink-secondary hover:border-[var(--axis)] hover:text-ink',
            )}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-ink-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('relative overflow-hidden rounded-md bg-sunken', className)} />;
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
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {icon ? <div className="text-ink-muted">{icon}</div> : null}
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
        <ChevronDown size={13} className={cn('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-3 pb-3 pl-[34px] text-ink-secondary">{children}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 w-full animate-fade-in rounded-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]',
          width === 'sm' && 'max-w-sm',
          width === 'md' && 'max-w-lg',
          width === 'lg' && 'max-w-3xl',
        )}
      >
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded p-1 coarse:p-3 text-ink-muted hover:bg-sunken hover:text-ink" aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-hairline px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** Lightweight hover/focus tooltip — no portal, positioned above the trigger. */
export function Tooltip({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max max-w-[16rem] -translate-x-1/2 rounded-md bg-[var(--text-primary)] px-2 py-1 text-mini leading-snug text-[var(--text-inverse)] shadow-pop"
        >
          {label}
        </span>
      ) : null}
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

  const push = (text: string, tone: Tone = 'neutral') => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4200);
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((i) => {
          const Icon = TONE_ICON[i.tone];
          return (
            <div key={i.id} className="pointer-events-auto flex animate-fade-in items-start gap-2 rounded-lg bg-surface p-3 text-xs shadow-pop ring-1 ring-[var(--ring)]">
              <Icon size={14} className={cn('mt-0.5 shrink-0', TONE_TEXT[i.tone])} />
              <span className="min-w-0 flex-1 text-ink">{i.text}</span>
              <button onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))} className="text-ink-muted hover:text-ink" aria-label="Dismiss">
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
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
          'flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-medium text-ink coarse:min-h-11',
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
