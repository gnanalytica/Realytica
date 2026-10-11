import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { ValueCheck, ValueSummary, ValuationWorking } from '@realytica/shared';
import { Badge, Card, CardBody, cn } from '../ui/kit';

export type SettleTarget = 'approaches' | 'compliance' | 'property' | 'comparables' | 'rule8';

export interface SettleItem {
  key: string;
  label: string;
  detail: string;
  tone: 'critical' | 'warning';
  target: SettleTarget;
}

/**
 * Corners that stop an honest figure — shown before the long check lists.
 *
 * Blockers from compliance, reconciliation failures, and the guideline-only
 * trap. Each line jumps to the surface that fixes it.
 */
export function settleItems(
  checks: ValueCheck[],
  summary: ValueSummary,
  working: ValuationWorking,
): SettleItem[] {
  const out: SettleItem[] = [];

  if (summary.outcome === 'approaches_disagree') {
    out.push({
      key: 'outcome_disagree',
      label: 'Approaches disagree',
      detail: working.reconciliation.spreadBasis || 'No figure until the approaches cross-check each other.',
      tone: 'critical',
      target: 'approaches',
    });
  } else if (summary.outcome === 'no_approach_ran') {
    out.push({
      key: 'outcome_none',
      label: 'No approach could run',
      detail: working.reconciliation.skippedMethods.length
        ? working.reconciliation.skippedMethods.map((m) => m.because).slice(0, 2).join('; ')
        : 'Record the inputs each approach needs, then value again.',
      tone: 'critical',
      target: 'approaches',
    });
  }

  if (!working.area.value) {
    out.push({
      key: 'no_area',
      label: 'No area to value on',
      detail: 'Set the plot or built-up area under The property.',
      tone: 'critical',
      target: 'property',
    });
  }

  if (summary.restsOnGuidance) {
    out.push({
      key: 'guideline_only',
      label: 'Guideline value only',
      detail: 'Add comparables or a recent sale for a market figure.',
      tone: 'warning',
      target: 'comparables',
    });
  }

  for (const c of checks) {
    if (c.verdict !== 'blocker') continue;
    if (out.some((i) => i.key === c.key)) continue;
    out.push({
      key: c.key,
      label: c.headline || c.label,
      detail: c.detail,
      tone: 'critical',
      target: settleTargetFor(c.key),
    });
  }

  return out;
}

function settleTargetFor(key: string): SettleTarget {
  if (key === 'extents_agree' || key === 'plan_deviation' || key === 'far_within') return 'property';
  if (key === 'comparables' || key === 'vs_guideline' || key === 'approaches_agree') return 'approaches';
  if (key === 'prohibited' || key === 'charges') return 'compliance';
  return 'compliance';
}

export function ValueMustSettle({
  items,
  onJump,
}: {
  items: SettleItem[];
  onJump: (target: SettleTarget) => void;
}) {
  if (!items.length) return null;

  return (
    <Card className="ring-critical/25">
      <CardBody className="space-y-1.5 p-2.5">
        <div className="flex items-center gap-2 px-1">
          <AlertTriangle size={13} className="shrink-0 text-critical" aria-hidden />
          <p className="text-[12px] font-semibold text-ink">
            Must settle
            <span className="ml-1 font-mono text-mini tabular-nums font-normal text-ink-muted">{items.length}</span>
          </p>
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                title={item.detail}
                onClick={() => onJump(item.target)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ring-1 ring-inset transition-colors hover:bg-sunken',
                  item.tone === 'critical' ? 'ring-critical/25' : 'ring-warning/35',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    item.tone === 'critical' ? 'bg-critical' : 'bg-warning',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.label}</span>
                <Badge tone={item.tone === 'critical' ? 'critical' : 'warning'} className="shrink-0">
                  {item.tone === 'critical' ? 'Blocker' : 'Look at'}
                </Badge>
                <ChevronRight size={14} className="shrink-0 text-ink-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
