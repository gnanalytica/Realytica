import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
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
  critical: 'bg-critical/12 text-critical ring-1 ring-inset ring-critical/40',
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
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">{children}</h3>
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

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
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
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</div>
      <div className={cn('mt-1 truncate text-2xl font-semibold leading-tight tracking-tight', TONE_TEXT[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-secondary">{sub}</div> : null}
    </div>
  );
}

export function KeyValue({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-1.5 last:border-0">
      <dt className="shrink-0 text-xs text-ink-secondary">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[13px] font-medium text-ink', mono && 'tabular')}>{value}</dd>
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

const CONTROL =
  'w-full rounded-lg bg-surface px-2.5 text-[13px] text-ink ring-1 ring-inset ring-[var(--ring)] ' +
  'placeholder:text-ink-muted focus:ring-2 focus:ring-brand disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL, 'h-9', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL, 'min-h-[76px] py-2 leading-relaxed', className)} />;
}

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
      className="inline-flex items-center gap-2 text-[13px] text-ink"
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
    <label className={cn('inline-flex cursor-pointer items-start gap-2 text-[13px] text-ink', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-[var(--axis)] text-brand focus:ring-brand"
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
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
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

export function Callout({ tone = 'info', title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
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
          <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" aria-label="Close">
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
          className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max max-w-[16rem] -translate-x-1/2 rounded-md bg-[var(--text-primary)] px-2 py-1 text-[11px] leading-snug text-[var(--text-inverse)] shadow-pop"
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
