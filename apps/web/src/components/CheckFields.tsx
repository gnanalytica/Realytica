/**
 * The facts a check records, as inputs rather than a comment box.
 *
 * One renderer for every check, driven by the declared schema. The alternative
 * — a bespoke panel per scope — is fourteen surfaces to build and then keep in
 * step with fourteen sets of criteria, which is how a product ends up with
 * four good panels and ten stale ones.
 *
 * Three things the design is careful about:
 *
 * - **A blank field is blank, not zero.** An empty box means nobody has looked
 *   yet, and it produces no insight. Showing "0 sqm — 100% divergence" for an
 *   unanswered question would be the confident wrong answer the whole product
 *   is built against.
 * - **The insight is the engine's, and says so.** It is arithmetic over the
 *   two values with the tolerance named, so a reader can disagree by checking
 *   the inputs. It never claims a result — what the numbers mean and whether
 *   the check passes are different questions with different authors.
 * - **Where each value comes from is on the label.** "Extent per title ·
 *   Title extract" tells somebody which document to open, which is most of
 *   the work of filling one of these in.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatFieldValue,
  isBlank,
  tableRows,
  type CheckFieldDef,
  type CheckFieldValue,
  type CheckInsight,
  type CheckFieldWrite,
  type CheckTableRow,
  type FindingSeverity,
} from '@realytica/shared';
import { Badge, cn } from './ui/kit';

interface Props {
  defs: CheckFieldDef[];
  values: Record<string, CheckFieldValue>;
  insights: CheckInsight[];
  disabled?: boolean;
  /** Called with only the fields that changed, so a save never rewrites what it did not touch. */
  onCommit: (values: Record<string, CheckFieldWrite>) => void;
}

const SEVERITY_TONE: Record<FindingSeverity, 'critical' | 'serious' | 'warning' | 'neutral'> = {
  critical: 'critical',
  high: 'serious',
  medium: 'warning',
  low: 'neutral',
};

export function CheckFields({ defs, values, insights, disabled, onCommit }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const def of defs) {
      const value = values[def.key];
      out[def.key] = isBlank(value) ? '' : String(value!.value);
    }
    return out;
  }, [defs, values]);

  // The stored values win whenever they change underneath, except on the field
  // being typed into — a save re-reads the project, and a naively controlled
  // input would fight the cursor.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...initial };
      if (focused.current && focused.current in prev) next[focused.current] = prev[focused.current]!;
      return next;
    });
  }, [initial]);

  if (!defs.length) return null;

  const commit = (key: string) => {
    const was = initial[key] ?? '';
    const now = draft[key] ?? '';
    if (now === was) return;
    onCommit({ [key]: now === '' ? null : now });
  };

  // Computed fields are excluded from both halves: nobody fills one in, so
  // counting them would make a complete check look unfinished forever.
  const answerable = defs.filter((d) => d.kind !== 'computed');
  const filled = answerable.filter((d) => !isBlank(values[d.key])).length;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[12px] font-semibold text-ink">What this check records</h4>
        <span className="text-[11px] tabular-nums text-ink-muted">
          {filled}/{answerable.length}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {defs.map((def) => {
          const blank = isBlank(values[def.key]);
          return (
            <label key={def.key} className={cn('block', (def.kind === 'table' || def.kind === 'longtext') && 'sm:col-span-2')}>
              <span className="flex items-baseline gap-1.5 text-[11.5px] text-ink-secondary">
                {def.label}
                {def.unit ? <span className="text-ink-muted">({def.unit})</span> : null}
                {def.proof === 'required' ? (
                  <span
                    className="rounded bg-sunken px-1 text-[9.5px] uppercase tracking-wide text-ink-muted"
                    title="This value has to cite something on the evidence register. File the document first, then record it against that row."
                  >
                    proof
                  </span>
                ) : null}
                {def.from ? <span className="ml-auto truncate text-[10.5px] text-ink-muted">from {def.from}</span> : null}
              </span>
              {def.kind === 'computed' ? (
                // Worked out, so there is nothing to type into. Shown as a
                // read-out rather than a disabled input, because a greyed box
                // reads as "you may not", and this is "nobody may".
                <output className={cn(inputCls, 'block border-dashed bg-sunken text-ink-secondary')}>
                  {formatFieldValue(def, values[def.key])}
                </output>
              ) : def.kind === 'longtext' ? (
                <textarea
                  value={draft[def.key] ?? ''}
                  disabled={disabled}
                  rows={3}
                  placeholder={blank ? 'not recorded' : ''}
                  onFocus={() => (focused.current = def.key)}
                  onBlur={() => {
                    focused.current = null;
                    commit(def.key);
                  }}
                  onChange={(e) => setDraft((p) => ({ ...p, [def.key]: e.target.value }))}
                  className={cn(inputCls, 'resize-y', blank && 'border-dashed')}
                />
              ) : def.kind === 'multi_enum' ? (
                <MultiSelect
                  options={def.options ?? []}
                  selected={Array.isArray(values[def.key]?.value) ? (values[def.key]!.value as string[]) : []}
                  disabled={disabled}
                  onChange={(next) => onCommit({ [def.key]: next.length ? next : null })}
                />
              ) : def.kind === 'table' ? (
                <TableField def={def} value={values[def.key]} disabled={disabled} onChange={(rows) => onCommit({ [def.key]: rows })} />
              ) : def.kind === 'boolean' && def.control === 'switch' ? (
                <Switch
                  value={isBlank(values[def.key]) ? null : Boolean(values[def.key]!.value)}
                  disabled={disabled}
                  onChange={(next) => onCommit({ [def.key]: next })}
                />
              ) : def.kind === 'enum' && (def.control === 'radio' || def.control === 'segmented') ? (
                <Segmented
                  options={def.options ?? []}
                  value={isBlank(values[def.key]) ? '' : String(values[def.key]!.value)}
                  disabled={disabled}
                  onChange={(next) => onCommit({ [def.key]: next || null })}
                />
              ) : def.kind === 'enum' ? (
                <select
                  value={draft[def.key] ?? ''}
                  disabled={disabled}
                  onFocus={() => (focused.current = def.key)}
                  onBlur={() => {
                    focused.current = null;
                    commit(def.key);
                  }}
                  onChange={(e) => setDraft((p) => ({ ...p, [def.key]: e.target.value }))}
                  className={cn(inputCls, blank && 'border-dashed')}
                >
                  <option value="">—</option>
                  {def.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : def.kind === 'boolean' ? (
                <select
                  value={draft[def.key] ?? ''}
                  disabled={disabled}
                  onFocus={() => (focused.current = def.key)}
                  onBlur={() => {
                    focused.current = null;
                    commit(def.key);
                  }}
                  onChange={(e) => setDraft((p) => ({ ...p, [def.key]: e.target.value }))}
                  className={cn(inputCls, blank && 'border-dashed')}
                >
                  <option value="">—</option>
                  <option value="true">yes</option>
                  <option value="false">no</option>
                </select>
              ) : (
                <input
                  value={draft[def.key] ?? ''}
                  disabled={disabled}
                  type={def.kind === 'date' ? 'date' : 'text'}
                  inputMode={def.kind === 'number' || def.kind === 'money' || def.kind === 'area' || def.kind === 'percent' ? 'decimal' : undefined}
                  // Blank is blank. No zero, no placeholder that reads as a value.
                  placeholder={blank ? 'not recorded' : ''}
                  onFocus={() => (focused.current = def.key)}
                  onBlur={() => {
                    focused.current = null;
                    commit(def.key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  onChange={(e) => setDraft((p) => ({ ...p, [def.key]: e.target.value }))}
                  className={cn(inputCls, blank && 'border-dashed placeholder:text-ink-muted')}
                />
              )}
              {def.hint && blank ? <span className="mt-0.5 block text-[10.5px] text-ink-muted">{def.hint}</span> : null}
            </label>
          );
        })}
      </div>

      {insights.length ? (
        <div className="space-y-1.5 rounded-lg border border-hairline bg-sunken p-2.5">
          <p className="text-[10.5px] uppercase tracking-wider text-ink-muted">
            Computed from these values — not a conclusion about the check
          </p>
          {insights.map((insight) => (
            <div key={insight.text} className="flex items-start gap-2">
              <Badge tone={SEVERITY_TONE[insight.severity]}>{insight.severity}</Badge>
              <p className="text-[12.5px] leading-snug text-ink-secondary">{insight.text}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The controls the vocabulary needs                                     */
/* ------------------------------------------------------------------ */

/** Checkboxes. Several of a fixed list — searched registries, NOCs held. */
function MultiSelect({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: string[];
  selected: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((s) => s !== option) : [...selected, option])}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50',
              on ? 'border-brand bg-brand-soft text-brand' : 'border-hairline text-ink-secondary hover:border-axis',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A switch with three states, because a diligence answer has three.
 *
 * Yes, no, and nobody has looked. A two-state toggle would make the third
 * indistinguishable from "no", which on a question like "is the site within a
 * rajakaluve buffer" is the difference between a clean file and one nobody
 * has checked.
 */
function Switch({ value, disabled, onChange }: { value: boolean | null; disabled?: boolean; onChange: (next: boolean | null) => void }) {
  return (
    <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-hairline">
      {[
        { label: 'yes', v: true as const },
        { label: 'no', v: false as const },
        { label: 'not looked', v: null },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.v}
          onClick={() => onChange(option.v)}
          className={cn(
            'border-r border-hairline px-2.5 py-1 text-[12px] last:border-r-0 disabled:opacity-50',
            value === option.v ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-sunken',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Radio or segmented — one of a short list, all visible at once. */
function Segmented({ options, value, disabled, onChange }: { options: string[]; value: string; disabled?: boolean; onChange: (next: string) => void }) {
  return (
    <div className="mt-1 inline-flex flex-wrap overflow-hidden rounded-lg border border-hairline">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          aria-pressed={value === option}
          onClick={() => onChange(value === option ? '' : option)}
          className={cn(
            'border-r border-hairline px-2.5 py-1 text-[12px] last:border-r-0 disabled:opacity-50',
            value === option ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-sunken',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * Repeating rows — the thing people otherwise keep in a spreadsheet beside
 * the system, which is where a DD fact goes to die.
 *
 * A chain of title, a variation register, a schedule of tests. Rows commit on
 * blur like every other field, and the whole set goes at once so a half-typed
 * row cannot land as a real one.
 */
function TableField({
  def,
  value,
  disabled,
  onChange,
}: {
  def: CheckFieldDef;
  value: CheckFieldValue | undefined;
  disabled?: boolean;
  onChange: (rows: CheckTableRow[]) => void;
}) {
  const columns = def.columns ?? [];
  const rows = tableRows(value) ?? [];

  const setCell = (index: number, key: string, cell: string | boolean) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [key]: cell === '' ? null : cell } : row));
    onChange(next);
  };

  return (
    <div className="mt-1 space-y-1.5">
      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-hairline bg-sunken">
              {columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-ink-muted">
                  {column.label}
                  {column.unit ? <span className="ml-1 font-normal">({column.unit})</span> : null}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-3 text-center text-ink-muted">
                  Nothing recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index} className="border-b border-hairline last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.key} className="px-1 py-0.5">
                      {column.kind === 'boolean' ? (
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={row[column.key] === true}
                          onChange={(e) => setCell(index, column.key, e.target.checked)}
                        />
                      ) : column.kind === 'enum' ? (
                        <select
                          disabled={disabled}
                          value={row[column.key] === null || row[column.key] === undefined ? '' : String(row[column.key])}
                          onChange={(e) => setCell(index, column.key, e.target.value)}
                          className="w-full min-w-[7rem] bg-transparent px-1 py-1 text-ink outline-none"
                        >
                          <option value="">—</option>
                          {column.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          disabled={disabled}
                          type={column.kind === 'date' ? 'date' : 'text'}
                          defaultValue={row[column.key] === null || row[column.key] === undefined ? '' : String(row[column.key])}
                          onBlur={(e) => setCell(index, column.key, e.target.value)}
                          className="w-full min-w-[6rem] bg-transparent px-1 py-1 tabular-nums text-ink outline-none"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() => onChange(rows.filter((_, i) => i !== index))}
                      className="px-1 text-ink-muted hover:text-status-critical disabled:opacity-40"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, null]))])}
        className="rounded px-1 text-[12px] text-brand hover:underline disabled:opacity-40"
      >
        + Add a row
      </button>
    </div>
  );
}

const inputCls =
  'mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-brand disabled:opacity-60';

/** One value, read-only — for the report, the sitting peek, anywhere not editing. */
export function CheckFieldSummary({ defs, values }: { defs: CheckFieldDef[]; values: Record<string, CheckFieldValue> }) {
  const recorded = defs.filter((d) => !isBlank(values[d.key]));
  if (!recorded.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
      {recorded.map((def) => (
        <div key={def.key} className="contents">
          <dt className="truncate text-ink-muted">{def.label}</dt>
          <dd className="tabular-nums text-ink">{formatFieldValue(def, values[def.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
