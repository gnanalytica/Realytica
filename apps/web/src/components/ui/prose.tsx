import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { emphasise, quantityDensity, splitLead } from '@realytica/shared';
import { cn } from './kit';

/**
 * How this product renders what it has to say.
 *
 * The problem these replace, measured rather than felt: one case carried
 * 14,760 words of body text — 67 minutes of reading — across 89 paragraphs of
 * thirty words or more, and every one of them rendered identically. A
 * currency figure, a statutory deadline and a hedge all looked the same, so
 * finding the number you came for meant reading the paragraph. That is what
 * makes a screen feel like somebody's notes.
 *
 * Nothing here shortens the text. The content is the product — a finding
 * without its consequence is a rumour, and this codebase has spent a lot of
 * effort making sure the consequence is stated. What changes is the *shape*:
 * quantities are weighted, the claim is separated from the working, and the
 * working starts folded.
 */

/**
 * Body text with the numbers weighted.
 *
 * Skips the emphasis entirely above a density threshold: a line that is
 * mostly figures gains nothing from bolding all of them, and a wall of bold
 * is harder to scan than a wall of plain.
 */
export function Prose({
  children,
  className,
  size = 'md',
}: {
  children: string | undefined | null;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (!children) return null;
  const base = size === 'sm' ? 'text-[12.5px] leading-relaxed' : 'text-[13px] leading-relaxed';
  const dense = quantityDensity(children) > 0.45;
  return (
    <p className={cn(base, 'text-ink-secondary', className)}>
      {dense
        ? children
        : emphasise(children).map((span, i) =>
            span.quantity ? (
              <span key={i} className="font-medium tabular-nums text-ink">
                {span.text}
              </span>
            ) : (
              <span key={i}>{span.text}</span>
            ),
          )}
    </p>
  );
}

/**
 * A claim you can scan, with the working one click away.
 *
 * The default is folded. That is the whole change: a reader meeting fourteen
 * compliance checks sees fourteen claims, not fourteen paragraphs, and opens
 * the two they care about. `alwaysOpen` exists for the findings nobody may
 * scroll past — a blocker, a critical risk — where hiding the consequence
 * behind a click would be the interface's fault.
 */
export function Finding({
  claim,
  detail,
  soWhat,
  tone,
  lead,
  alwaysOpen,
  className,
}: {
  /** The scannable line. Rendered whole, always. */
  claim: string;
  /** The working. Folded unless `alwaysOpen`. */
  detail?: string;
  /** What it means for the decision — shown beside the claim, not folded. */
  soWhat?: string;
  tone?: 'critical' | 'serious' | 'warning' | 'good' | 'neutral';
  /** Rendered before the claim: a badge, an icon, a figure. */
  lead?: ReactNode;
  alwaysOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(Boolean(alwaysOpen));
  const expanded = alwaysOpen || open;
  const hasDetail = Boolean(detail && detail.trim());

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {lead}
        <span className={cn('text-[13px] font-medium leading-snug', tone === 'critical' ? 'text-critical' : 'text-ink')}>
          {emphasise(claim).map((span, i) =>
            span.quantity ? (
              <span key={i} className="tabular-nums font-semibold">
                {span.text}
              </span>
            ) : (
              <span key={i}>{span.text}</span>
            ),
          )}
        </span>
      </div>

      {soWhat && <Prose size="sm">{soWhat}</Prose>}

      {hasDetail && expanded && <Prose size="sm" className="border-l-2 border-[var(--ring)] pl-3">{detail}</Prose>}

      {hasDetail && !alwaysOpen && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex w-fit items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
        >
          {open ? 'Less' : 'Why'}
          <ChevronDown size={11} className={cn('transition-transform duration-base', open && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

/**
 * A paragraph reshaped into a claim plus its working, without touching the
 * string.
 *
 * For the engine prose there is no budget to rewrite: `splitLead` takes the
 * first sentence as the claim and folds the rest. Where a string is one
 * sentence it renders as one line and the control does not appear, so this is
 * safe to apply everywhere rather than case by case.
 */
export function SplitProse({ text, tone, lead, alwaysOpen, className }: {
  text: string | undefined | null;
  tone?: 'critical' | 'serious' | 'warning' | 'good' | 'neutral';
  lead?: ReactNode;
  alwaysOpen?: boolean;
  className?: string;
}) {
  if (!text) return null;
  const { lead: claim, rest } = splitLead(text);
  return <Finding claim={claim} detail={rest} tone={tone} lead={lead} alwaysOpen={alwaysOpen} className={className} />;
}

/**
 * A short label-and-value row, for facts that are not sentences.
 *
 * Most of what a paragraph in this product was carrying is a pair: a name and
 * a figure. Rendering those as prose is what turned a table into notes.
 */
export function FactRow({ label, value, tone }: { label: string; value: ReactNode; tone?: 'critical' | 'warning' | 'good' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 last:border-0">
      <span className="text-[12.5px] text-ink-secondary">{label}</span>
      <span
        className={cn(
          'shrink-0 font-mono text-[12.5px] tabular-nums font-medium',
          tone === 'critical' ? 'text-critical' : tone === 'warning' ? 'text-ink' : tone === 'good' ? 'text-good' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
