/**
 * What a report block that reads fields adds to a table: the chart drawn
 * from it, the footnotes saying where each value came from, and the dialog a
 * person names the fields in.
 *
 * One set of components for the editor and the printed page, so what is
 * arranged is what prints. Nothing here writes a word: the values, their
 * standing and their footnotes are worked out by `resolveFieldBlock`.
 */

import { useMemo, useState } from 'react';
import {
  DEPARTMENT_SHORT,
  fieldCatalog,
  fieldSourceFault,
  fieldSourceHeading,
  workstreamDefinition,
  type CheckFieldDef,
  type FieldAddress,
  type FieldSet,
  type ReportBoundSource,
  type ReportChart,
  type ReportFootnote,
} from '@realytica/shared';
import { Button, Checkbox, Field, Modal, Select, cn } from '../ui/kit';

/** Where each value in the section above came from, numbered as the values mark them. */
export function ReportFootnotes({ footnotes, print = false }: { footnotes?: ReportFootnote[]; print?: boolean }) {
  if (!footnotes?.length) return null;
  return (
    <ol className={cn('mt-2 space-y-0.5 text-[11px] leading-snug', print ? 'text-neutral-700' : 'text-ink-muted')} aria-label="Where these values came from">
      {footnotes.map((note) => (
        <li key={note.n} className="flex gap-1.5">
          <span className="shrink-0 font-mono tabular-nums">[{note.n}]</span>
          <span className="min-w-0">{note.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** A chart of one column: bars, or a line where the order along the foot is the point. The figures are in the table under it. */
export function ReportChartView({ chart, print = false }: { chart: ReportChart; print?: boolean }) {
  const most = Math.max(...chart.points.map((point) => Math.abs(point.value)), 0) || 1;
  const said = `${chart.y} by ${chart.x}: ${chart.points.map((point) => `${point.label} ${point.said}`).join('; ')}`;
  if (chart.mark === 'line' && chart.points.length > 1) {
    const low = Math.min(...chart.points.map((point) => point.value), 0);
    const high = Math.max(...chart.points.map((point) => point.value), 0);
    const span = high - low || 1;
    const at = (index: number, value: number) => `${(index / (chart.points.length - 1)) * 100},${38 - ((value - low) / span) * 36}`;
    return (
      <figure className="mb-3 break-inside-avoid">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={said} className="h-28 w-full">
          <polyline points={chart.points.map((point, index) => at(index, point.value)).join(' ')} fill="none" stroke={print ? '#111' : 'var(--brand)'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={cn('flex justify-between gap-2 text-[11px]', print ? 'text-neutral-700' : 'text-ink-muted')}>
          <span className="truncate">{chart.points[0]!.label}</span>
          <span className="truncate">{chart.points.at(-1)!.label}</span>
        </div>
      </figure>
    );
  }
  return (
    <figure className="mb-3 space-y-1 break-inside-avoid" role="img" aria-label={said}>
      {chart.points.map((point, index) => (
        <div key={index} className="grid grid-cols-[minmax(4rem,10rem)_minmax(0,1fr)] items-center gap-2 text-[12px]">
          <span className={cn('truncate text-right', print ? 'text-neutral-700' : 'text-ink-secondary')}>{point.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('h-3 shrink-0 rounded-sm', print ? 'bg-neutral-700' : 'bg-brand')} style={{ width: `${Math.max(1, (Math.abs(point.value) / most) * 70)}%` }} aria-hidden />
            <span className={cn('min-w-0 truncate font-mono tabular-nums', print ? 'text-black' : 'text-ink')}>{point.said.replace(/( \[\d+\])+$/, '')}</span>
          </span>
        </div>
      ))}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Naming the fields a section reads                                   */
/* ------------------------------------------------------------------ */

type Shape = 'fields' | 'field_table' | 'field_chart';

const SHAPE_LABEL: Record<Shape, string> = { fields: 'Fields', field_table: 'A table', field_chart: 'A chart' };
const FIGURES = new Set(['number', 'money', 'area', 'percent', 'duration', 'computed']);
const same = (a: FieldAddress, b: FieldAddress) => a.set === b.set && a.field === b.field && (a.record ?? '') === (b.record ?? '');

/** What a table or a chart may read in a set: the set's own records where it repeats, and each of its table fields. */
function tablesOf(set: FieldSet | undefined): Array<{ key: string; label: string; columns: CheckFieldDef[] }> {
  if (!set) return [];
  return [
    ...(set.records ? [{ key: '', label: `Every ${set.records.of}`, columns: set.fields.filter((def) => !def.retired && def.kind !== 'table' && def.kind !== 'evidence') }] : []),
    ...set.fields.filter((def) => def.kind === 'table' && !def.retired).map((def) => ({ key: def.key, label: def.label, columns: def.columns ?? [] })),
  ];
}

/**
 * The dialog a person names fields in: which function, which sheet, and then
 * the fields to print, or the table to print or draw. Fields may be chosen
 * from several sheets into one section.
 */
export function FieldBlockDialog({
  open,
  initial,
  busy,
  onClose,
  onDone,
}: {
  open: boolean;
  /** The section being changed. Absent when one is being added. */
  initial?: ReportBoundSource;
  busy?: boolean;
  onClose: () => void;
  onDone: (source: ReportBoundSource, heading: string | undefined) => void;
}) {
  const catalog = useMemo(() => fieldCatalog(), []);
  const functions = useMemo(() => {
    const keys = [...new Set([...catalog.sets.values()].map((set) => set.fn))];
    return keys
      .map((fn) => {
        const workstream = workstreamDefinition(fn);
        return { fn, label: workstream ? `${DEPARTMENT_SHORT[workstream.department]} › ${workstream.label}` : 'Shared records' };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  const firstSet = initial?.addresses?.[0]?.set ?? initial?.address?.set ?? initial?.records;
  const [shape, setShape] = useState<Shape>((initial?.kind as Shape | undefined) ?? 'fields');
  const [fn, setFn] = useState(catalog.sets.get(firstSet ?? '')?.fn ?? functions[0]?.fn ?? '');
  const setsOfFn = useMemo(() => [...catalog.sets.values()].filter((set) => set.fn === fn), [catalog, fn]);
  const [setId, setSetId] = useState(firstSet ?? '');
  const set = setsOfFn.find((held) => held.id === setId) ?? setsOfFn[0];
  const [picked, setPicked] = useState<FieldAddress[]>(initial?.addresses ?? []);
  const [table, setTable] = useState(initial?.records ? '' : (initial?.address?.field ?? ''));
  const [columns, setColumns] = useState<string[]>(initial?.columns ?? []);
  const [x, setX] = useState(initial?.x ?? '');
  const [y, setY] = useState(initial?.y ?? '');
  const [mark, setMark] = useState<'bar' | 'line'>(initial?.mark ?? 'bar');

  const tables = tablesOf(set);
  const read = tables.find((held) => held.key === table) ?? tables[0];
  const what = set && read ? (read.key === '' ? { records: set.id } : { address: { fn: set.fn, set: set.id, field: read.key } }) : undefined;
  const source: ReportBoundSource | undefined =
    shape === 'fields'
      ? { kind: 'fields', addresses: picked }
      : what
        ? shape === 'field_table'
          ? { kind: 'field_table', ...what, ...(columns.length ? { columns: columns.filter((key) => read!.columns.some((column) => column.key === key)) } : {}) }
          : { kind: 'field_chart', ...what, x, y, mark }
        : undefined;
  const fault = !source ? 'This sheet has no table and does not repeat.' : shape === 'fields' && !picked.length ? 'Tick the fields to print.' : fieldSourceFault(source);

  const toggle = (address: FieldAddress) => setPicked((was) => (was.some((held) => same(held, address)) ? was.filter((held) => !same(held, address)) : [...was, address]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={initial ? 'Change what this section reads' : 'Add a section that reads fields'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || Boolean(fault)} onClick={() => source && onDone(source, fieldSourceHeading(source))}>
            {initial ? 'Change it' : 'Add it'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          The section prints what the fields hold, with where each value came from. Nobody types into it. A value nobody has accepted prints as waiting.
        </p>
        <div className="inline-flex rounded-md bg-sunken p-0.5" role="group" aria-label="What the section shows">
          {(Object.keys(SHAPE_LABEL) as Shape[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={shape === key}
              onClick={() => setShape(key)}
              className={cn('rounded px-3 py-1 text-[12px] coarse:min-h-11', shape === key ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-muted hover:text-ink')}
            >
              {SHAPE_LABEL[key]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Function">
            <Select
              value={fn}
              onChange={(e) => {
                setFn(e.target.value);
                setSetId('');
                setTable('');
              }}
            >
              {functions.map((row) => (
                <option key={row.fn} value={row.fn}>
                  {row.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sheet or check">
            <Select
              value={set?.id ?? ''}
              onChange={(e) => {
                setSetId(e.target.value);
                setTable('');
              }}
            >
              {setsOfFn.map((held) => (
                <option key={held.id} value={held.id}>
                  {held.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {shape === 'fields' && set ? (
          <div>
            <p className="mb-1 text-[12px] font-medium text-ink">
              Fields{picked.length ? <span className="font-normal text-ink-muted"> · {picked.length} chosen, printed in the order ticked</span> : null}
            </p>
            <div className="grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto rounded-lg p-2 ring-1 ring-inset ring-[var(--ring)] sm:grid-cols-2">
              {set.fields
                .filter((def) => !def.retired)
                .map((def) => {
                  const address: FieldAddress = { fn: set.fn, set: set.id, field: def.key };
                  return <Checkbox key={def.key} checked={picked.some((held) => same(held, address))} onChange={() => toggle(address)} label={def.label} />;
                })}
            </div>
          </div>
        ) : null}

        {shape !== 'fields' && read ? (
          <div className="space-y-3">
            <Field label={shape === 'field_chart' ? 'Drawn from' : 'The table'}>
              <Select value={read.key} onChange={(e) => setTable(e.target.value)}>
                {tables.map((held) => (
                  <option key={held.key} value={held.key}>
                    {held.label}
                  </option>
                ))}
              </Select>
            </Field>
            {shape === 'field_table' ? (
              <div>
                <p className="mb-1 text-[12px] font-medium text-ink">
                  Columns <span className="font-normal text-ink-muted">· none ticked prints the usual ones</span>
                </p>
                <div className="grid grid-cols-1 gap-x-4 rounded-lg p-2 ring-1 ring-inset ring-[var(--ring)] sm:grid-cols-2">
                  {read.columns.map((column) => (
                    <Checkbox
                      key={column.key}
                      checked={columns.includes(column.key)}
                      onChange={(on) => setColumns((was) => (on ? [...was, column.key] : was.filter((key) => key !== column.key)))}
                      label={column.label}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Along the foot">
                  <Select value={x} onChange={(e) => setX(e.target.value)}>
                    <option value="">Choose a column</option>
                    {read.columns.map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Drawn">
                  <Select value={y} onChange={(e) => setY(e.target.value)}>
                    <option value="">Choose a figure</option>
                    {read.columns
                      .filter((column) => FIGURES.has(column.kind))
                      .map((column) => (
                        <option key={column.key} value={column.key}>
                          {column.label}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="As">
                  <Select value={mark} onChange={(e) => setMark(e.target.value as 'bar' | 'line')}>
                    <option value="bar">Bars</option>
                    <option value="line">A line</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        ) : null}

        {fault ? <p className="text-[12px] text-ink-muted">{fault}</p> : null}
      </div>
    </Modal>
  );
}
