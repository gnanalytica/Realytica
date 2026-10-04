import { Badge, Button, cn, useToast } from '../../../components/ui/kit';
import { fmt, num, targets, tone, type BlockAt } from '../engine';
import { Bar, FIGURE, Group, GroupFoot } from '../parts';
import { useOpen } from '../place';
import type { TableBlock as Spec, TableSource } from '../types';

/** How the rows got here, said in the corner of the card. Rows typed by the team need no saying. */
const ARRIVED: Record<TableSource, (from: string) => string> = {
  typed: () => '',
  import: () => 'Imported from a sheet',
  phone: () => 'From the phone',
  link: (from) => `Arrives from ${from || 'another function'}`,
  message: (from) => `Sent in by ${from || 'another party'}`,
  fetched: (from) => `Fetched from ${from || 'a public record'}`,
};

const HEAD = 'whitespace-nowrap border-t border-hairline bg-page px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-ink-muted';
const PAD = 'border-t px-3 py-[9px] align-top';
const CELL = `${PAD} min-w-[72px] border-hairline`;
const BAR = `${PAD} min-w-[120px] border-hairline`;
const TOTAL = `${PAD} min-w-[72px] border-[var(--axis)]`;

/** What an amount is counted in: "₹ 42 L" is in "₹L", "10.5%" in "%". */
const unit = (cell: string): string => cell.replace(/[-\d.,\s]/g, '');

/**
 * In a comparison, the columns of a row that hold its lowest amount.
 *
 * Every amount column is compared except the first, which names the item,
 * and the estimate the others are set against, when the table has one. Two
 * columns that tie are both the lowest. A row has none when its amounts are
 * all the same, or are not counted in the same unit.
 */
function lowest(row: string[], block: Spec): Set<number> {
  const amounts = block.money.length ? block.money : block.cols.map((_, i) => i);
  const compared = amounts
    .filter((i) => i !== 0 && i !== block.estimate)
    .map((i) => ({ i, cell: row[i] ?? '', n: num(row[i] ?? '') }))
    .filter((x): x is { i: number; cell: string; n: number } => x.n !== null);
  if (new Set(compared.map((x) => unit(x.cell))).size > 1) return new Set();
  const least = Math.min(...compared.map((x) => x.n));
  const low = compared.filter((x) => x.n === least);
  return new Set(low.length < compared.length ? low.map((x) => x.i) : []);
}

/** The sum of an amount column, in the unit its first row is written in. */
function total(rows: string[][], col: number): string {
  const unit = rows[0]?.[col]?.match(/(Cr|L)\b/)?.[0] ?? '';
  const sum = rows.reduce((n, row) => n + (num(row[col] ?? '') ?? 0), 0);
  return `₹ ${fmt(sum)}${unit ? ` ${unit}` : ''}`;
}

/**
 * A register or ledger: kept by the team, or arriving from somewhere else.
 *
 * A table whose rows arrive from another function says so and opens it. One
 * column may be a status chip, one a bar, and amount columns sit right and
 * add up. In a comparison the lowest amount of each row is tinted and says
 * "Lowest", so it does not rest on colour alone.
 */
export function TableBlock({ at, block }: { at: BlockAt; block: Spec }) {
  const open = useOpen();
  const toast = useToast();
  const money = new Set(block.money);
  const origins = block.source === 'link' ? targets(block.from, at.dept).filter((to) => to.fn !== at.fn) : [];

  return (
    <Group title={block.title ?? 'Register'} note={ARRIVED[block.source](block.from)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] text-ink">
          <thead>
            <tr>
              {block.cols.map((col, i) => (
                <th key={i} scope="col" className={cn(HEAD, money.has(i) ? 'text-right' : 'text-left')}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.length ? (
              block.rows.map((row, r) => {
                const low = block.low ? lowest(row, block) : null;
                return (
                  <tr key={r}>
                    {row.map((cell, i) =>
                      i === block.status ? (
                        <td key={i} className={CELL}>
                          <Badge tone={tone(cell)}>{cell}</Badge>
                        </td>
                      ) : i === block.bar ? (
                        <td key={i} className={BAR}>
                          <span className="flex items-center gap-2">
                            <Bar value={num(cell) ?? 0} className="flex-1" />
                            <span className={FIGURE}>{cell}</span>
                          </span>
                        </td>
                      ) : (
                        <td key={i} className={cn(CELL, money.has(i) && FIGURE, low?.has(i) && 'bg-brand-soft font-medium text-brand-strong')}>
                          {cell}
                          {low?.has(i) ? <span className="block font-sans text-[11px]">Lowest</span> : null}
                        </td>
                      ),
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={block.cols.length} className="border-t border-hairline p-4 text-center text-ink-muted">
                  No rows yet
                </td>
              </tr>
            )}
            {block.total && block.rows.length ? (
              <tr className="bg-page font-semibold">
                {block.cols.map((_, i) => (
                  <td key={i} className={cn(TOTAL, money.has(i) && FIGURE)}>
                    {i === 0 ? 'Total' : money.has(i) ? total(block.rows, i) : null}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {block.add || block.source === 'import' || origins.length ? (
        <GroupFoot>
          {block.add ? (
            <Button size="sm" onClick={() => toast('Adds a row.')}>
              {block.add}
            </Button>
          ) : null}
          {block.source === 'import' ? (
            <Button size="sm" onClick={() => toast('Imports the sheet.')}>
              Import a sheet
            </Button>
          ) : null}
          {origins.map((to) => (
            <Button key={`${to.dept.key}/${to.fn?.name ?? ''}`} size="sm" onClick={() => open.to(to.dept, to.fn)}>
              Open {to.fn ? to.fn.name : to.dept.label}
            </Button>
          ))}
        </GroupFoot>
      ) : null}
    </Group>
  );
}
