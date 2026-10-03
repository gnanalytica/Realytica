import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Plus, XCircle } from 'lucide-react';
import {
  QUICK_VERDICT_LABEL,
  ROUGH_ABOVE,
  SOURCE_TIER_LABEL,
  quickAssessment,
  type DdProject,
  type QuickAssessment,
  type QuickVerdict,
  type SourceTier,
} from '@realytica/shared';
import { Badge, Disclosure, InfoTip, cn, toneChip, type Tone } from '../ui/kit';
import { EASE_ENTER, Stagger, StaggerItem, motion } from '../../lib/motion';

export const VERDICT_TONE: Record<QuickVerdict, Tone> = {
  clear: 'good',
  conditions: 'warning',
  blockers: 'critical',
  insufficient: 'neutral',
};

/** Each point carries its own verdict as a mark, so a list of eight can be scanned by colour and shape. */
const POINT_ICON: Record<'good' | 'warning' | 'critical' | 'neutral', { icon: typeof XCircle; tone: Tone }> = {
  good: { icon: CheckCircle2, tone: 'good' },
  warning: { icon: AlertTriangle, tone: 'warning' },
  critical: { icon: XCircle, tone: 'critical' },
  neutral: { icon: CircleDashed, tone: 'neutral' },
};

const VERDICT_ICON: Record<QuickVerdict, typeof XCircle> = {
  clear: CheckCircle2,
  conditions: AlertTriangle,
  blockers: XCircle,
  insufficient: CircleDashed,
};

/** The faint wash of the verdict behind the headline: where the eye lands first, it already knows. */
const VERDICT_WASH: Record<QuickVerdict, string> = {
  clear: 'bg-grad-good',
  conditions: 'bg-grad-warning',
  blockers: 'bg-grad-critical',
  insufficient: '',
};

/** Higher sources in a stronger ink: the file's own word outranks an assumption. */
function TierBadge({ tier }: { tier: SourceTier }) {
  return (
    <span
      title={SOURCE_TIER_LABEL[tier]}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-medium',
        tier <= 2 ? 'bg-good/15 text-ink' : tier <= 4 ? 'bg-brand-soft text-brand' : tier <= 7 ? 'bg-sunken text-ink-secondary' : 'bg-warning/20 text-ink',
      )}
    >
      <span className="font-mono">{tier}</span>
      {SOURCE_TIER_LABEL[tier]}
    </span>
  );
}

export function useQuickAssessment(project: DdProject, workstream: string): QuickAssessment {
  return useMemo(() => quickAssessment(project, workstream), [project, workstream]);
}

/**
 * A workstream's living estimate: what it says now, what decides it, what
 * every input rests on, and what would firm it up. Re-read from the file on
 * every change, so it moves as documents, site entries and other departments'
 * work arrive.
 */
export function QuickAssessmentCard({ assessment, compact = false }: { assessment: QuickAssessment; compact?: boolean }) {
  const a = assessment;
  const tone = VERDICT_TONE[a.verdict];
  const VerdictIcon = VERDICT_ICON[a.verdict];
  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-[var(--ring)] print-block">
      <div className={cn('px-4 pb-4 pt-4', VERDICT_WASH[a.verdict])}>
        <div className="flex items-start gap-3">
          <motion.span
            className={cn('grid size-10 shrink-0 place-items-center rounded-xl', toneChip(tone))}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            aria-hidden
          >
            <VerdictIcon size={19} />
          </motion.span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-medium text-ink-muted">Quick assessment</span>
              <InfoTip label="A living estimate from what is on the file. It never replaces a certified report." />
              <Badge tone={tone}>{QUICK_VERDICT_LABEL[a.verdict]}</Badge>
              {a.rough ? <Badge tone="warning" title={`More than ${Math.round(ROUGH_ABOVE * 100)}% rests on standard assumptions`}>Rough range</Badge> : null}
            </div>
            <p className={cn('mt-1 font-semibold leading-tight tracking-tight text-ink', compact ? 'text-[16px]' : 'text-[21px]')}>{a.headline}</p>
            {compact ? null : <p className="mt-1 text-[12px] leading-snug text-ink-muted">{a.method}</p>}
          </div>
        </div>
      </div>
      <div className="space-y-3 border-t border-hairline px-4 py-3.5">
        {a.points.length ? (
          <Stagger as="ul" className="space-y-1.5">
            {a.points.slice(0, compact ? 4 : 12).map((p, i) => {
              const mark = POINT_ICON[p.tone];
              return (
                <StaggerItem as="li" key={i} className="flex gap-2.5 text-[13px] leading-snug text-ink">
                  <span className={cn('mt-px grid size-[18px] shrink-0 place-items-center rounded-full', toneChip(mark.tone))} aria-hidden>
                    <mark.icon size={11} />
                  </span>
                  <span className="min-w-0">
                    {p.text}
                    {p.source ? <span className="text-ink-muted"> — {p.source}</span> : null}
                  </span>
                </StaggerItem>
              );
            })}
          </Stagger>
        ) : null}
        {!compact && a.inputs.length ? (
          <Disclosure title="What it rests on" count={a.inputs.length}>
            <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-secondary">
              <span>On standard assumptions:</span>
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]">
                <motion.span
                  className={cn('block h-full rounded-full', a.assumptionShare > ROUGH_ABOVE ? 'bg-warning' : 'bg-good')}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(a.assumptionShare * 100)}%` }}
                  transition={{ duration: 0.6, ease: EASE_ENTER }}
                />
              </span>
              <span className="font-mono tabular-nums">{Math.round(a.assumptionShare * 100)}%</span>
            </div>
            <ul className="divide-y divide-hairline">
              {a.inputs.map((input, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                  <span className="min-w-[10rem] flex-1 text-[13px] text-ink-secondary">{input.label}</span>
                  <span className="text-[13px] font-medium text-ink tabular-nums">{input.value}</span>
                  <TierBadge tier={input.tier} />
                  <span className="w-full text-micro text-ink-muted">{input.source}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
        {a.gaps.length ? (
          <div className="rounded-xl bg-brand-soft/60 px-3 py-2.5 ring-1 ring-inset ring-brand/15">
            <p className="text-[12px] font-semibold text-brand">What would firm it up</p>
            <ul className="mt-1.5 space-y-1">
              {a.gaps.slice(0, compact ? 2 : 6).map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-ink">
                  <Plus size={13} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
