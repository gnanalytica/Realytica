/**
 * A table field's rows, shaped for the chart its field declares.
 *
 * The field says what is drawn (`chart: { x, y, mark, stack }`); this turns
 * its rows into the marks, so the screen only draws and a test can read what
 * it will draw. Three shapes:
 *
 * - `bar` (the default): a bar for each row, in the rows' own order.
 * - `line`: a point for each row over its `x`, in `x`'s own order. A date
 *   column is put in date order, so a table typed out of order still draws a
 *   line that runs forward.
 * - `stacked`: one bar for each distinct `x`, built of its rows' `y` by their
 *   `stack` column, each part keeping one place and one colour across bars.
 *
 * A row with no figure for `y` or nothing for `x` is left out, never drawn
 * as zero.
 */

import { fieldOptions } from './check-fields';
import type { CheckFieldDef, CheckTableRow, OptionSet } from './types';

export interface ChartPoint {
  /** The `x` as the table holds it. */
  x: string;
  /** As a person reads it: a choice's label, a date as written. */
  label: string;
  y: number;
}

export interface ChartStack {
  x: string;
  label: string;
  total: number;
  /** One part for each stack key that has a figure on this bar, in the keys' own order. */
  parts: Array<{ key: string; label: string; y: number }>;
}

export type FieldChart =
  | { mark: 'bar'; points: ChartPoint[] }
  | { mark: 'line'; points: ChartPoint[]; dated: boolean }
  | { mark: 'stacked'; bars: ChartStack[]; keys: Array<{ key: string; label: string }> };

/** The most parts a stacked bar is cut into. Past it the smallest are drawn as one, "Other": more colours than this cannot be told apart. */
export const CHART_STACK_PARTS_MOST = 6;

const OTHER = '__other';

function labelOf(column: CheckFieldDef | undefined, raw: string, lists?: (id: string) => OptionSet | undefined): string {
  if (!column || (column.kind !== 'enum' && column.kind !== 'multi_enum')) return raw;
  return fieldOptions(column, lists).find((option) => option.key === raw)?.label ?? raw;
}

/** What a chart table draws, or undefined where it has nothing to draw. */
export function fieldChart(def: CheckFieldDef, rows: readonly CheckTableRow[], lists?: (id: string) => OptionSet | undefined): FieldChart | undefined {
  const chart = def.chart;
  if (def.display !== 'chart' || !chart) return undefined;
  const xColumn = def.columns?.find((column) => column.key === chart.x);
  const read = rows.flatMap((row) => {
    const rawX = row[chart.x];
    const rawY = row[chart.y];
    const y = typeof rawY === 'number' ? rawY : rawY === null || rawY === undefined || rawY === '' ? Number.NaN : Number(rawY);
    if (rawX === null || rawX === undefined || rawX === '' || !Number.isFinite(y)) return [];
    return [{ row, x: String(rawX), y }];
  });
  if (!read.length) return undefined;
  const point = (item: (typeof read)[number]): ChartPoint => ({ x: item.x, label: labelOf(xColumn, item.x, lists), y: item.y });

  if (chart.mark === 'line') {
    const dated = xColumn?.kind === 'date';
    const numeric = !dated && read.every((item) => Number.isFinite(Number(item.x)));
    const ordered = dated ? [...read].sort((a, b) => a.x.localeCompare(b.x)) : numeric ? [...read].sort((a, b) => Number(a.x) - Number(b.x)) : read;
    return { mark: 'line', points: ordered.map(point), dated };
  }

  if (chart.mark === 'stacked' && chart.stack) {
    const stackColumn = def.columns?.find((column) => column.key === chart.stack);
    const totals = new Map<string, number>();
    for (const item of read) {
      const key = String(item.row[chart.stack] ?? '');
      totals.set(key, (totals.get(key) ?? 0) + Math.abs(item.y));
    }
    // The parts keep the order they first appear in; past the most, the smallest are folded into one.
    const order = [...totals.keys()];
    const kept = new Set(order.length > CHART_STACK_PARTS_MOST ? [...order].sort((a, b) => totals.get(b)! - totals.get(a)!).slice(0, CHART_STACK_PARTS_MOST - 1) : order);
    const keyOf = (raw: string) => (kept.has(raw) ? raw : OTHER);
    const keys = [...order.filter((key) => kept.has(key)).map((key) => ({ key, label: key ? labelOf(stackColumn, key, lists) : 'Not said' })), ...(kept.size < order.length ? [{ key: OTHER, label: 'Other' }] : [])];
    const bars = new Map<string, ChartStack>();
    for (const item of read) {
      const bar = bars.get(item.x) ?? { x: item.x, label: labelOf(xColumn, item.x, lists), total: 0, parts: [] };
      bars.set(item.x, bar);
      const key = keyOf(String(item.row[chart.stack] ?? ''));
      const part = bar.parts.find((held) => held.key === key);
      if (part) part.y += item.y;
      else bar.parts.push({ key, label: keys.find((held) => held.key === key)!.label, y: item.y });
      bar.total += item.y;
    }
    const sorted = [...bars.values()].map((bar) => ({ ...bar, parts: [...bar.parts].sort((a, b) => keys.findIndex((k) => k.key === a.key) - keys.findIndex((k) => k.key === b.key)) }));
    return { mark: 'stacked', bars: xColumn?.kind === 'date' ? sorted.sort((a, b) => a.x.localeCompare(b.x)) : sorted, keys };
  }

  return { mark: 'bar', points: read.map(point) };
}
