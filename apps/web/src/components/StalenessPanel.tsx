import { CalendarClock, RefreshCw } from 'lucide-react';
import type { StalenessReport, StaleItem, RiskSeverity } from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';
import { Badge, Card, CardBody, CardHeader, Skeleton } from './ui/kit';
import type { Tone } from './ui/kit';
import { SplitProse } from './ui/prose';

/**
 * What has gone out of date on this case.
 *
 * Fetched rather than read off the screen result, because the answer changes
 * every day and a stored one would be the stalest thing on the page. See
 * `buildStaleness`.
 *
 * The panel renders nothing at all when nothing has aged. A permanently
 * present "everything is current" card is a card people stop seeing, and then
 * they stop seeing it on the day it says something else.
 */

const SEVERITY_TONE: Record<RiskSeverity, Tone> = {
  critical: 'critical',
  serious: 'serious',
  warning: 'warning',
  info: 'neutral',
};

function ageLabel(item: StaleItem): string {
  if (item.ageDays >= 365) {
    const years = Math.floor(item.ageDays / 365);
    return `${years} year${years === 1 ? '' : 's'} old`;
  }
  if (item.ageDays >= 30) {
    const months = Math.floor(item.ageDays / 30);
    return `${months} month${months === 1 ? '' : 's'} old`;
  }
  return `${item.ageDays} days old`;
}

export function StalenessPanel({ caseId }: { caseId: string }) {
  const { data, loading } = useAsync<StalenessReport>(() => api.staleness(caseId), [caseId]);

  if (loading && !data) return <Skeleton className="h-32 w-full" />;
  if (!data || data.items.length === 0) return null;

  const caseItems = data.items.filter(item => item.kind !== 'reference_data');
  const oldestCaseItem = caseItems.slice().sort((a, b) => b.ageDays - a.ageDays)[0];

  return (
    <Card>
      <CardHeader
        title="What needs rechecking"
        /*
         * Derived from case-level items only. `oldestAsOf` includes the
         * deployment's own reference data, which is old on every case here —
         * captioning that as "the oldest thing this case depends on" next to
         * a body saying nothing on the case has aged reads as a contradiction,
         * and the reader is right that it is one.
         */
        subtitle={oldestCaseItem ? `Oldest thing on this case: ${relativeTime(oldestCaseItem.asOf)}` : 'Nothing on the case itself; see the note below'}
        icon={<CalendarClock size={16} />}
      />
      <CardBody className="flex flex-col gap-3">
        <SplitProse text={data.headline} />
        <ul className="m-0 list-none space-y-3 p-0">
          {data.items.map(item => (
            <li key={item.key} className="border-b border-hairline pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{item.label}</span>
                <Badge tone={SEVERITY_TONE[item.severity]}>{ageLabel(item)}</Badge>
              </div>
              <SplitProse text={item.what} className="mt-1" />
              {/*
                * A div, not a p. `SplitProse` renders a `Finding`, which is a
                * block element — nesting it inside a paragraph is invalid
                * HTML, and the browser silently closes the `<p>` early, which
                * drops the flex layout this row depends on.
                */}
              <div className="m-0 mt-1 flex gap-1.5 text-[12px] leading-relaxed text-ink-muted">
                <RefreshCw size={12} className="mt-0.5 shrink-0" />
                {/* The action, split like everything else: what to do, then how. */}
                <span className="min-w-0"><SplitProse text={item.refresh} /></span>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
