import { cn } from '../../../components/ui/kit';
import { many } from '../engine';
import { Group, GroupFoot, LegendKey } from '../parts';
import type { GridBlock as Spec } from '../types';

/*
 * The fills, in the order of the legend. A unit moves from open, through
 * held, to more and more settled, so the last three are one colour growing
 * stronger rather than three colours to learn.
 */
const FILL = [
  'bg-surface ring-1 ring-inset ring-[var(--axis)]',
  'bg-warning/15 ring-1 ring-inset ring-warning/40',
  'bg-brand/20 ring-1 ring-inset ring-brand/40',
  'bg-brand/50',
  'bg-brand',
];
const UNKNOWN = 'bg-sunken';

/** Units by floor, coloured by where each stands: a stack plan. The legend gives the count of each. */
export function GridBlock({ block }: { block: Spec }) {
  const all = block.rows.flatMap((row) => row.cells);
  const fill = (status: string) => FILL[block.legend.indexOf(status)] ?? UNKNOWN;
  const counts = block.legend.map((status) => `${status} ${all.filter((v) => v === status).length}`);
  return (
    <Group title={block.title ?? 'Inventory'} note={many(all.length, 'unit shown', 'units shown')}>
      <div role="img" aria-label={`Units by floor: ${counts.join(', ')}`} className="grid gap-1 overflow-x-auto border-t border-hairline px-3.5 py-3">
        {block.rows.map((row) => (
          <div key={row.name} className="flex items-center gap-1">
            <span className="w-[70px] shrink-0 font-mono text-[12px] text-ink-secondary">{row.name}</span>
            {row.cells.map((status, i) => (
              <span key={i} title={`${row.name}, unit ${i + 1}: ${status}`} className={cn('h-[26px] min-w-[22px] flex-1 rounded-[5px]', fill(status))} />
            ))}
          </div>
        ))}
      </div>
      <GroupFoot>
        {block.legend.map((status, i) => (
          <LegendKey key={status} swatch={FILL[i] ?? UNKNOWN}>
            {counts[i]}
          </LegendKey>
        ))}
      </GroupFoot>
    </Group>
  );
}
