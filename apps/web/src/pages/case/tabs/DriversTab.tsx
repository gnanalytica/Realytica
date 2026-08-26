import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Building2, ClipboardList, LineChart as LineChartIcon, MapPin, Minus, Scale, Users } from 'lucide-react';
import type { DriverCategory, EvidenceItem, ValueDriver } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, cn } from '../../../components/ui/kit';
import { DriverImpactChart } from '../../../components/charts';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { pct, titleCase } from '../../../lib/format';
import type { TabProps } from '../tab-props';

const CATEGORY_ORDER: DriverCategory[] = ['location', 'building', 'legal', 'market', 'planning', 'tenancy'];

const CATEGORY_ICON: Record<DriverCategory, typeof MapPin> = {
  location: MapPin,
  building: Building2,
  legal: Scale,
  market: LineChartIcon,
  planning: ClipboardList,
  tenancy: Users,
};

type Filter = 'all' | 'positive' | 'negative';

export default function DriversTab({ result }: TabProps) {
  const [filter, setFilter] = useState<Filter>('all');

  if (!result) {
    return (
      <EmptyState
        title="Not screened yet"
        description="Run the screen to see what pushes the value up or down, and by roughly how much."
      />
    );
  }

  const drivers = result.drivers;
  const positive = drivers.filter((d) => d.direction === 'positive');
  const negative = drivers.filter((d) => d.direction === 'negative');
  const liftPct = positive.reduce((s, d) => s + d.impactPct, 0);
  const reducePct = negative.reduce((s, d) => s + Math.abs(d.impactPct), 0);

  const filtered = drivers.filter((d) => (filter === 'all' ? true : d.direction === filter));
  const sortedForChart = [...drivers].sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));

  const grouped = CATEGORY_ORDER.map((cat) => ({ category: cat, items: filtered.filter((d) => d.category === cat) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Card>
        <CardHeader title="Value drivers" />
        <CardBody className="flex flex-col gap-3">
          <DriverImpactChart drivers={sortedForChart} />
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink">{positive.length}</span> driver{positive.length === 1 ? '' : 's'} lift the value by{' '}
            <span className="font-medium text-[var(--status-good-text)]">{pct(liftPct, 1)}</span>,{' '}
            <span className="font-medium text-ink">{negative.length}</span> reduce{negative.length === 1 ? 's' : ''} it by{' '}
            <span className="font-medium text-critical">{pct(reducePct, 1)}</span>.
          </p>
        </CardBody>
      </Card>

      <Callout tone="neutral" title="How to read this">
        Each impact is relative to the locality median for a comparable property. They explain direction and rough scale — they are not
        additive to one precise total.
      </Callout>

      <div className="flex items-center gap-1.5">
        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
          All ({drivers.length})
        </FilterButton>
        <FilterButton active={filter === 'positive'} onClick={() => setFilter('positive')}>
          Positive ({positive.length})
        </FilterButton>
        <FilterButton active={filter === 'negative'} onClick={() => setFilter('negative')}>
          Negative ({negative.length})
        </FilterButton>
      </div>

      {grouped.length === 0 ? (
        <EmptyState title="No drivers in this filter" description="Choose a different filter to see more drivers." />
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => {
            const CategoryIcon = CATEGORY_ICON[g.category];
            return (
              <Card key={g.category}>
                <CardHeader
                  title={titleCase(g.category)}
                  icon={<CategoryIcon size={14} />}
                  subtitle={`${g.items.length} driver${g.items.length === 1 ? '' : 's'}`}
                />
                <CardBody className="flex flex-col divide-y divide-hairline">
                  {g.items.map((d) => (
                    <DriverRow key={d.id} driver={d} evidence={result.evidence} />
                  ))}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink-secondary hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function DriverRow({ driver, evidence }: { driver: ValueDriver; evidence: EvidenceItem[] }) {
  const DirIcon = driver.direction === 'positive' ? ArrowUpRight : driver.direction === 'negative' ? ArrowDownRight : Minus;
  const tone =
    driver.direction === 'positive' ? 'text-[var(--status-good-text)]' : driver.direction === 'negative' ? 'text-critical' : 'text-ink-muted';

  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <DirIcon size={14} className={tone} />
          <span className="text-[13px] font-medium text-ink">{driver.label}</span>
          {driver.direction === 'neutral' ? <Badge tone="neutral">Neutral</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('tabular text-[13px] font-semibold', tone)}>{pct(driver.impactPct, 1, true)}</span>
          <EvidenceLink ids={driver.evidenceIds} evidence={evidence} />
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-secondary">{driver.explanation}</p>
    </div>
  );
}
