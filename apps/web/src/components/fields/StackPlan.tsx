/**
 * The units of a project as a stack plan: a tile for each unit, tower by
 * tower and floor by floor, coloured by the unit's status.
 *
 * The status is the unit record's own status field, which is read from the
 * papers on file and never typed (docs/fields.md). This draws it and nothing
 * more: pressing a tile opens the unit's record, where its sale is.
 */

import { useMemo } from 'react';
import { type SheetReading, type Tone } from '@realytica/shared';
import { Card, CardBody, CardHeader, cn } from '../ui/kit';

const TILE: Record<Tone, string> = {
  good: 'border-good bg-good/10 text-ink',
  warning: 'border-warning bg-warning/10 text-ink',
  critical: 'border-critical bg-critical/10 text-ink',
  info: 'border-brand bg-brand-soft text-ink',
  neutral: 'border-hairline bg-sunken text-ink-secondary',
};
const DOT: Record<Tone, string> = { good: 'bg-good', warning: 'bg-warning', critical: 'bg-critical', info: 'bg-brand', neutral: 'bg-[var(--axis)]' };

interface Tile {
  id: string;
  number: string;
  tower: string;
  floor: number | null;
  label: string;
  tone: Tone;
}

/** A unit's standing: its first status field, or what that field says of a unit nothing is recorded for. */
function tileOf(record: SheetReading): Tile {
  const held = (key: string) => record.fields.find((view) => view.def.key === key)?.held?.value;
  const status = record.fields.find((view) => view.def.kind === 'status');
  const standing = typeof status?.held?.value === 'string' ? status.held.value : undefined;
  const floor = Number(held('floor'));
  return {
    id: record.recordId ?? '',
    number: record.title,
    tower: typeof held('tower') === 'string' ? (held('tower') as string) : '',
    floor: held('floor') === undefined || held('floor') === null || Number.isNaN(floor) ? null : floor,
    label: standing ?? status?.def.otherwise?.label ?? '',
    tone: standing ? (status?.tone ?? 'neutral') : (status?.def.otherwise?.tone ?? 'neutral'),
  };
}

/** Whether a set of records can be drawn as a stack plan: units, with a status to colour them by. */
export function drawsAsStackPlan(records: SheetReading[]): boolean {
  return records.length > 0 && records[0]!.set.records?.of === 'unit' && records[0]!.fields.some((view) => view.def.kind === 'status');
}

export function StackPlan({ records, onOpen }: { records: SheetReading[]; onOpen: (record: string) => void }) {
  const tiles = useMemo(() => records.map(tileOf), [records]);
  // The legend lists each standing in the order a sale passes through them: what is said of an untouched unit, then the cases from last to first.
  const status = records[0]?.fields.find((view) => view.def.kind === 'status')?.def;
  const order = [...(status?.otherwise ? [status.otherwise] : []), ...[...(status?.cases ?? [])].reverse()];
  const legend = order.flatMap((entry) => {
    const count = tiles.filter((tile) => tile.label === entry.label).length;
    return count ? [{ ...entry, count }] : [];
  });
  const towers = [...new Set(tiles.map((tile) => tile.tower))].sort();

  return (
    <Card>
      <CardHeader title="Stack plan" subtitle={`${tiles.length} ${tiles.length === 1 ? 'unit' : 'units'}, coloured by the papers on file for each`} />
      <CardBody className="space-y-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[entry.tone])} />
              {entry.label}
              <span className="font-mono text-[11px] text-ink-muted">{entry.count}</span>
            </li>
          ))}
        </ul>
        {towers.map((tower) => {
          const inTower = tiles.filter((tile) => tile.tower === tower);
          const floors = [...new Set(inTower.map((tile) => tile.floor))].sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity));
          return (
            <section key={tower} aria-label={tower ? `Tower ${tower}` : 'Units with no tower recorded'} className="space-y-1.5">
              {towers.length > 1 || tower ? <h4 className="text-[12px] font-medium text-ink-secondary">{tower ? `Tower ${tower}` : 'No tower recorded'}</h4> : null}
              {floors.map((floor) => (
                <div key={String(floor)} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                  <span className="shrink-0 text-[11px] text-ink-muted sm:w-14 sm:pt-2.5">{floor === null ? 'No floor' : `Floor ${floor}`}</span>
                  <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
                    {inTower
                      .filter((tile) => tile.floor === floor)
                      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
                      .map((tile) => (
                        <button
                          key={tile.id}
                          type="button"
                          onClick={() => onOpen(tile.id)}
                          aria-label={`${tile.number}: ${tile.label}`}
                          title={`${tile.number}: ${tile.label}`}
                          className={cn('flex min-h-11 min-w-0 flex-col justify-center rounded-lg border px-2 py-1 text-left transition-colors hover:border-axis', TILE[tile.tone])}
                        >
                          <span className="truncate text-[13px] font-medium tabular-nums">{tile.number}</span>
                          <span className="truncate text-[11px] text-ink-secondary">{tile.label}</span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </CardBody>
    </Card>
  );
}
