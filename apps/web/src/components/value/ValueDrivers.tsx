import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ValueDriverLine } from '@realytica/shared';
import { Card, CardBody, CardHeader, Why, cn } from '../ui/kit';

function impact(d: ValueDriverLine): string {
  if (!d.impact) return '';
  const f = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}%`;
  return d.impact.low === d.impact.high ? f(d.impact.low) : `${f(d.impact.low)} to ${f(d.impact.high)}`;
}

/**
 * What moves the value, and whether the figure already carries it.
 *
 * Two kinds, kept apart on purpose. What the figure carries — the
 * surroundings it takes off, the building's age the cost approach depreciates
 * for — is arithmetic already on the page. What it does not carry is what the
 * file records that a buyer or a lender prices — a B-khata, a lake buffer the
 * state's map draws, a corner plot — each with the rate this product keeps for
 * it, for the valuer to weigh into the comparables where it belongs. A driver
 * nobody has put a number on is shown without one.
 */
export function ValueDrivers({ drivers, revealed }: { drivers: ValueDriverLine[]; revealed: number | null }) {
  const applied = drivers.filter((d) => d.applied);
  const advisory = drivers.filter((d) => !d.applied);
  const ordered = [...applied, ...advisory];
  return (
    <Card>
      <CardHeader
        title="Drivers"
        subtitle={drivers.length ? `${applied.length} in · ${advisory.length} to weigh` : 'None yet'}
        info="In the figure = already in the arithmetic. To weigh = price into comparables’ net adjustment."
      />
      <CardBody className="p-0">
        {drivers.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-muted">Khata, tenure, plot, map surrounds.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {ordered.map((d, i) =>
              revealed !== null && i >= revealed ? null : (
                <li key={d.key} className="animate-fade-in px-4 py-2">
                  <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-2">
                    <span
                      className={cn(
                        'translate-y-0.5',
                        d.direction === 'up' ? 'text-[var(--status-good-text)]' : d.direction === 'down' ? 'text-critical' : 'text-ink-muted',
                      )}
                      aria-label={d.direction === 'up' ? 'Raises the value' : d.direction === 'down' ? 'Lowers the value' : 'Neutral'}
                    >
                      {d.direction === 'up' ? <ArrowUpRight size={14} /> : d.direction === 'down' ? <ArrowDownRight size={14} /> : <Minus size={14} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink" title={d.label}>
                        {d.label}
                      </p>
                      <Why label={d.source}>
                        <p>{d.basis}</p>
                      </Why>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      {d.impact ? (
                        <span className={cn('font-mono text-[12px] tabular-nums', d.direction === 'down' ? 'text-critical' : d.direction === 'up' ? 'text-[var(--status-good-text)]' : 'text-ink-secondary')}>
                          {impact(d)}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-px text-micro font-medium',
                          d.applied ? 'bg-good/15 text-[var(--status-good-text)]' : 'bg-sunken text-ink-muted ring-1 ring-inset ring-[var(--ring)]',
                        )}
                      >
                        {d.applied ? 'In the figure' : 'To weigh'}
                      </span>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
