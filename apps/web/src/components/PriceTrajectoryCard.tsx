import { History } from 'lucide-react';
import type { EvidenceItem, PriceTrajectory } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader } from './ui/kit';
import { date, money, pct } from '../lib/format';

/**
 * What this parcel's own conveyances recite, over time.
 *
 * Rendered as the record it is — dated rows ending at today's indicative
 * mid — rather than as a market chart, because the levels are recitals of
 * dutiable value, not transactions, and a line chart would lend them a
 * precision the caveat beneath it takes away. The one thing this card must
 * never grow is a point to the right of today.
 */
export function PriceTrajectoryCard({ trajectory }: { trajectory: PriceTrajectory; evidence?: EvidenceItem[] }) {
  const registered = trajectory.points.filter(p => p.kind === 'registered');
  return (
    <Card>
      <CardHeader
        title="This parcel's own price record"
        subtitle="Registered considerations from the title chain, joined to today's indicative mid. No other party's transaction appears here."
        icon={<History size={16} />}
        action={
          trajectory.registeredCagrPct !== undefined ? (
            <Badge tone="neutral" title="Annualised, across the registered record">
              {pct(trajectory.registeredCagrPct, 1, true)}/yr registered
            </Badge>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4">
        <ol className="flex flex-col">
          {trajectory.points.map((point, i) => {
            const previous = i > 0 ? trajectory.points[i - 1] : undefined;
            const changePct = previous && previous.amount > 0 ? ((point.amount - previous.amount) / previous.amount) * 100 : undefined;
            const indicative = point.kind === 'indicative';
            return (
              <li key={`${point.at}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
                <div className="min-w-0">
                  <span className="font-mono text-[11px] tabular-nums text-ink-muted">{date(point.at)}</span>
                  <span className={indicative ? 'ml-2 text-xs font-medium text-ink' : 'ml-2 text-xs text-ink-secondary'}>{point.label}</span>
                </div>
                <div className="flex shrink-0 items-baseline gap-2">
                  {changePct !== undefined ? (
                    <span className="font-mono text-[11px] tabular-nums text-ink-muted">{pct(changePct, 0, true)}</span>
                  ) : null}
                  <span className="font-mono text-sm font-semibold tabular-nums text-ink">{money(point.amount, trajectory.currency)}</span>
                  {indicative ? <Badge tone="brand">today</Badge> : null}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-ink-secondary">
          {trajectory.statements.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        {trajectory.understatementLikely ? (
          <Callout tone="warning" title="Read the levels as a floor">
            A registered deed recites the dutiable value, which tracks the guidance value rather than the price paid. The dates and direction
            are reliable; the amounts likely understate what actually changed hands — {registered.length === 1 ? 'this recital' : 'these recitals'} cannot
            be read as market prices.
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  );
}
