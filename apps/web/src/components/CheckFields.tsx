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
  type CheckFieldDef,
  type CheckFieldValue,
  type CheckInsight,
  type FindingSeverity,
} from '@realytica/shared';
import { Badge, cn } from './ui/kit';

interface Props {
  defs: CheckFieldDef[];
  values: Record<string, CheckFieldValue>;
  insights: CheckInsight[];
  disabled?: boolean;
  /** Called with only the fields that changed, so a save never rewrites what it did not touch. */
  onCommit: (values: Record<string, string | number | boolean | null>) => void;
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

  const filled = defs.filter((d) => !isBlank(values[d.key])).length;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[12px] font-semibold text-ink">What this check records</h4>
        <span className="text-[11px] tabular-nums text-ink-muted">
          {filled}/{defs.length}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {defs.map((def) => {
          const blank = isBlank(values[def.key]);
          return (
            <label key={def.key} className="block">
              <span className="flex items-baseline gap-1.5 text-[11.5px] text-ink-secondary">
                {def.label}
                {def.unit ? <span className="text-ink-muted">({def.unit})</span> : null}
                {def.from ? <span className="ml-auto truncate text-[10.5px] text-ink-muted">from {def.from}</span> : null}
              </span>
              {def.kind === 'enum' ? (
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
