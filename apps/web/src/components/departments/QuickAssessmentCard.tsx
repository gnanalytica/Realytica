import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
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
import { Badge, Card, CardBody, CardHeader, Disclosure, cn, type Tone } from '../ui/kit';

export const VERDICT_TONE: Record<QuickVerdict, Tone> = {
  clear: 'good',
  conditions: 'warning',
  blockers: 'critical',
  insufficient: 'neutral',
};

const POINT_DOT: Record<'good' | 'warning' | 'critical' | 'neutral', string> = {
  good: 'bg-good',
  warning: 'bg-warning',
  critical: 'bg-critical',
  neutral: 'bg-ink-muted',
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
  return (
    <Card>
      <CardHeader
        icon={<Gauge size={15} />}
        title="Quick assessment"
        subtitle={a.method}
        info="A living estimate built from what is on the file, following the official method for this kind of assessment. It is re-read whenever anything changes and never replaces a certified report."
        action={
          <div className="flex items-center gap-1.5">
            {a.rough ? <Badge tone="warning" title={`More than ${Math.round(ROUGH_ABOVE * 100)}% rests on standard assumptions`}>Rough range</Badge> : null}
            <Badge tone={VERDICT_TONE[a.verdict]}>{QUICK_VERDICT_LABEL[a.verdict]}</Badge>
          </div>
        }
      />
      <CardBody className="space-y-3">
        <p className={cn('font-semibold tracking-tight text-ink', compact ? 'text-[15px]' : 'text-[19px]')}>{a.headline}</p>
        {a.points.length ? (
          <ul className="space-y-1">
            {a.points.slice(0, compact ? 4 : 12).map((p, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink">
                <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', POINT_DOT[p.tone])} aria-hidden />
                <span className="min-w-0">
                  {p.text}
                  {p.source ? <span className="text-ink-muted"> — {p.source}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {!compact && a.inputs.length ? (
          <Disclosure title="What it rests on" count={a.inputs.length}>
            <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-secondary">
              <span>On standard assumptions:</span>
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken">
                <span className={cn('block h-full rounded-full', a.assumptionShare > ROUGH_ABOVE ? 'bg-warning' : 'bg-good')} style={{ width: `${Math.round(a.assumptionShare * 100)}%` }} />
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
          <div className="rounded-lg bg-sunken px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">What would firm it up</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] text-ink-secondary">
              {a.gaps.slice(0, compact ? 2 : 6).map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
