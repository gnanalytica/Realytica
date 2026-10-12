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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import {
  EVIDENCE_STATUS_LABEL,
  NA_REASONS,
  NA_REASON_LABEL,
  fieldDimension,
  fieldOptions,
  fieldTone,
  formatFieldValue,
  isBlank,
  longtextCap,
  optionSetById,
  ruleSourceSaid,
  tableRows,
  type FieldSource,
  type FieldValueDecision,
  type FieldView,
  type OptionDef,
  type RefTarget,
  type Tone as FieldTone,
  type CheckFieldDef,
  type CheckFieldValue,
  type CheckInsight,
  type CheckFieldWrite,
  type CheckTableRow,
  type EvidenceRecord,
  type FindingSeverity,
} from '@realytica/shared';
import { AiMark, Badge, cn } from './ui/kit';
import { ChartSvg, DirectedBar, scaleLinear, useMeasure } from './charts/primitives';

/** Statuses that mean the document is not actually on the file yet. */
const GAP_STATUS = new Set(['expected', 'requested', 'missing']);

interface Props {
  defs: CheckFieldDef[];
  values: Record<string, CheckFieldValue>;
  insights: CheckInsight[];
  disabled?: boolean;
  /**
   * The evidence register, so a citation can be picked rather than typed.
   *
   * Passed in rather than fetched here: this component renders inside a modal
   * that already holds the project, and a second fetch would be a second
   * version of the register that can disagree with the one behind it.
   */
  evidence?: EvidenceRecord[];
  /** Files dropped straight onto a field. Resolves to the evidence ids created. */
  onAttachEvidence?: (def: CheckFieldDef, files: File[]) => Promise<string[]>;
  /** Called with only the fields that changed, so a save never rewrites what it did not touch. */
  onCommit: (values: Record<string, CheckFieldWrite>) => void;
  /**
   * The heading over the fields. Absent, it is the check's own ("What this
   * check records" and its count); null draws none, for a sheet whose section
   * is already titled.
   */
  heading?: ReactNode | null;
  /**
   * Each field as its sheet reads it: where its value stands, where it came
   * from, what waits beside it. Absent on a check, where every value is one a
   * person recorded and nothing is marked.
   */
  views?: Record<string, FieldView>;
  /** What a link field can link to on this project, and what a text field completes from. */
  choices?: (target: RefTarget | undefined) => Array<{ id: string; label: string }>;
  /** A person's decision on one field. Absent, the reader may not decide and the controls are not drawn. */
  onDecide?: (def: CheckFieldDef, decision: FieldValueDecision, input?: { value?: unknown; pick?: number; reason?: string }) => void;
  /** Opens a paper at a page, where a value says it was read from one. */
  onOpenPaper?: (evidenceId: string, page?: number) => void;
}

/** The app's tone for a field's tone: the two lists share every word but `info`, which the kit draws as its brand tint. */
const toneOf = (tone: FieldTone | undefined): 'good' | 'warning' | 'critical' | 'neutral' | 'info' => tone ?? 'neutral';

/** What was typed for a measure, to type over: its own words where they were kept, else the figure and its unit. */
function typedFor(def: CheckFieldDef, value: CheckFieldValue | undefined): string {
  if (isBlank(value)) return '';
  const entered = value!.entered;
  if (def.dimension && entered) return entered.text ?? `${entered.value} ${entered.unit}`;
  return String(value!.value);
}

const SEVERITY_TONE: Record<FindingSeverity, 'critical' | 'serious' | 'warning' | 'neutral'> = {
  critical: 'critical',
  high: 'serious',
  medium: 'warning',
  low: 'neutral',
};

export function CheckFields({ defs, values, insights, disabled, evidence, onAttachEvidence, onCommit, heading, views, choices, onDecide, onOpenPaper }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  // The field whose source is open. Where a value came from is one press on its label away, and on nothing's face.
  const [sourceOf, setSourceOf] = useState<string | null>(null);
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const def of defs) {
      const value = values[def.key];
      out[def.key] = typedFor(def, value);
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
  const answerable = defs.filter((d) => d.kind !== 'computed' && d.kind !== 'status' && !d.sameAs);
  const filled = answerable.filter((d) => !isBlank(values[d.key])).length;

  return (
    <section className="space-y-2">
      {heading === undefined ? (
        <div className="flex items-baseline gap-2">
          <h4 className="text-[12px] font-semibold text-ink">What this check records</h4>
          <span className="text-[11px] tabular-nums text-ink-muted">
            {filled}/{answerable.length}
          </span>
        </div>
      ) : (
        heading
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {defs.map((def) => {
          const blank = isBlank(values[def.key]);
          const view = views?.[def.key];
          const options: OptionDef[] = def.kind === 'enum' || def.kind === 'multi_enum' ? fieldOptions(def, optionSetById).filter((o) => !o.retired || o.key === values[def.key]?.value) : [];
          // A choice once offered and since withdrawn still shows where it is the value held.
          const held = values[def.key]?.value;
          if (def.kind === 'enum' && typeof held === 'string' && held && !options.some((o) => o.key === held)) options.push({ key: held, label: held });
          const waits = view?.state === 'proposed';
          // A field with buttons of its own beside its control is a group, not one labelled control.
          const Wrapper = view ? 'div' : 'label';
          return (
            <Wrapper key={def.key} className={cn('block', (def.kind === 'table' || def.kind === 'longtext' || def.kind === 'evidence') && 'sm:col-span-2')}>
              <span className="flex items-baseline gap-1.5 text-[12px] text-ink-secondary">
                {view && hasMore(def, view, Boolean(onDecide) && !disabled) ? (
                  <button type="button" aria-expanded={sourceOf === def.key} title="Where this came from" onClick={() => setSourceOf(sourceOf === def.key ? null : def.key)} className="text-left hover:text-ink hover:underline">
                    {def.label}
                  </button>
                ) : (
                  def.label
                )}
                {def.unit ? <span className="text-ink-muted">({def.unit})</span> : null}
                {def.proof === 'required' ? (
                  <span
                    className="rounded bg-sunken px-1 text-[12px] font-medium text-ink-muted"
                    title="This value has to cite something on the evidence register. File the document first, then record it against that row."
                  >
                    proof
                  </span>
                ) : null}
                {def.from ? <span className="ml-auto truncate text-[11px] text-ink-muted">from {def.from}</span> : null}
              </span>
              {view?.state === 'not_applicable' ? (
                <p className={cn(inputCls, 'border-dashed bg-sunken text-ink-muted')}>
                  Not applicable: {NA_REASON_LABEL[view.held?.naReason as keyof typeof NA_REASON_LABEL] ?? view.held?.naReason}
                  {view.held?.naNote ? `. ${view.held.naNote}` : ''}
                </p>
              ) : def.kind === 'status' ? (
                // A standing the rules worked out: its label in its tone, and nothing to press.
                <div className="mt-1 flex min-h-8 items-center">
                  {blank ? <span className="text-[12px] text-ink-muted">No standing yet</span> : <Badge tone={toneOf(fieldTone(def, values[def.key], optionSetById))}>{String(values[def.key]!.value)}</Badge>}
                </div>
              ) : def.kind === 'computed' || def.sameAs ? (
                // Worked out, so there is nothing to type into. Shown as a
                // read-out rather than a disabled input, because a greyed box
                // reads as "you may not", and this is "nobody may".
                <output className={cn(inputCls, 'block border-dashed bg-sunken text-ink-secondary')}>
                  {formatFieldValue(def, values[def.key], optionSetById)}
                </output>
              ) : def.kind === 'ref' ? (
                <select
                  value={typeof held === 'string' ? held : ''}
                  disabled={disabled}
                  aria-label={def.label}
                  onChange={(e) => onCommit({ [def.key]: e.target.value || null })}
                  className={cn(inputCls, blank && 'border-dashed', waits && 'border-ai')}
                >
                  <option value="">—</option>
                  {(choices?.(def.target) ?? []).map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                  {typeof held === 'string' && held && !(choices?.(def.target) ?? []).some((c) => c.id === held) ? <option value={held}>{held}</option> : null}
                </select>
              ) : def.kind === 'enum' && def.control === 'tiles' ? (
                <Tiles options={options} value={typeof held === 'string' ? held : ''} disabled={disabled} label={def.label} onChange={(next) => onCommit({ [def.key]: next || null })} />
              ) : def.kind === 'boolean' && def.control === 'tick' ? (
                <Tick value={blank ? null : Boolean(held)} disabled={disabled} label={def.label} onChange={(next) => onCommit({ [def.key]: next })} />
              ) : def.kind === 'number' && def.control === 'scale' && def.min !== undefined && def.max !== undefined ? (
                <Scale min={def.min} max={def.max} value={typeof held === 'number' ? held : null} disabled={disabled} label={def.label} onChange={(next) => onCommit({ [def.key]: next })} />
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
                  maxLength={def.maxLength ? longtextCap(def) : undefined}
                  className={cn(inputCls, 'resize-y', blank && 'border-dashed')}
                />
              ) : def.kind === 'multi_enum' ? (
                <MultiSelect
                  options={options}
                  selected={Array.isArray(values[def.key]?.value) ? (values[def.key]!.value as string[]) : []}
                  disabled={disabled}
                  onChange={(next) => onCommit({ [def.key]: next.length ? next : null })}
                />
              ) : def.kind === 'evidence' ? (
                <EvidenceField
                  def={def}
                  value={values[def.key]}
                  evidence={evidence ?? []}
                  disabled={disabled}
                  onAttach={onAttachEvidence}
                  onChange={(ids) => onCommit({ [def.key]: ids.length ? ids : null })}
                />
              ) : def.kind === 'table' && def.display === 'match' && view?.match ? (
                <MatchField def={def} reading={view.match} rows={tableRows(values[def.key]) ?? []} disabled={disabled} onChange={(rows) => onCommit({ [def.key]: rows })} />
              ) : def.kind === 'table' ? (
                <>
                  {def.display === 'timeline' ? <Timeline def={def} rows={tableRows(values[def.key]) ?? []} /> : null}
                  {def.display === 'chart' ? <TableChart def={def} rows={tableRows(values[def.key]) ?? []} /> : null}
                  {def.display && (tableRows(values[def.key]) ?? []).length ? (
                    // Drawn above; the rows themselves are one press away, to change.
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none text-[12px] font-medium text-brand coarse:min-h-11">Edit rows</summary>
                      <TableField def={def} value={values[def.key]} disabled={disabled} choices={choices} onChange={(rows) => onCommit({ [def.key]: rows })} />
                    </details>
                  ) : (
                    <TableField def={def} value={values[def.key]} disabled={disabled} choices={choices} onChange={(rows) => onCommit({ [def.key]: rows })} />
                  )}
                </>
              ) : def.kind === 'boolean' && def.control === 'switch' ? (
                <Switch
                  value={isBlank(values[def.key]) ? null : Boolean(values[def.key]!.value)}
                  disabled={disabled}
                  onChange={(next) => onCommit({ [def.key]: next })}
                />
              ) : def.kind === 'enum' && (def.control === 'radio' || def.control === 'segmented') ? (
                <Segmented
                  options={options}
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
                  {options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
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
                  // A measure takes its unit with it ("1 acre 22 guntas", "4.2 Cr"), so its keyboard is the full one.
                  inputMode={!fieldDimension(def) && (def.kind === 'number' || def.kind === 'percent') ? 'decimal' : undefined}
                  list={def.suggest && choices ? `suggest-${def.key}` : undefined}
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
                  className={cn(inputCls, blank && 'border-dashed placeholder:text-ink-muted', waits && 'border-ai')}
                />
              )}
              {def.suggest && choices && def.kind === 'text' ? (
                <datalist id={`suggest-${def.key}`}>
                  {choices(def.suggest as RefTarget).map((choice) => (
                    <option key={choice.id} value={choice.label} />
                  ))}
                </datalist>
              ) : null}
              {def.kind === 'evidence' && def.viewer ? <Viewer def={def} value={values[def.key]} evidence={evidence ?? []} onOpen={onOpenPaper} /> : null}
              {def.kind === 'longtext' && !blank && view ? (
                <span className="mt-0.5 block text-[11px] text-ink-muted">
                  Written by {values[def.key]!.by}
                  {values[def.key]!.at ? `, ${values[def.key]!.at.slice(0, 10)}` : ''}
                </span>
              ) : null}
              {view ? <FieldMarks def={def} view={view} open={sourceOf === def.key} disabled={disabled} onDecide={onDecide} onOpenPaper={onOpenPaper} /> : null}
              {def.hint && blank ? <span className="mt-0.5 block text-[11px] text-ink-muted">{def.hint}</span> : null}
              {/* Where the value was read, in the document's own words. */}
              {!view && !blank && values[def.key]?.sourceEvidenceId ? (
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                  {(() => {
                    const cited = values[def.key]!;
                    const row = evidence?.find((e) => e.id === cited.sourceEvidenceId);
                    return (
                      <>
                        {row ? row.title : 'Cited document'}
                        {cited.page ? `, p.${cited.page}` : ''}
                        {cited.quote ? <>: “{cited.quote}”</> : null}
                      </>
                    );
                  })()}
                </span>
              ) : null}
            </Wrapper>
          );
        })}
      </div>

      {insights.length ? (
        <div className="space-y-1.5 rounded-lg border border-hairline bg-sunken p-2.5">
          <p className="text-[12px] font-medium text-ink-muted">
            Computed from these values — not a conclusion about the check
          </p>
          {insights.map((insight) => (
            <div key={insight.text} className="flex items-start gap-2">
              <Badge tone={SEVERITY_TONE[insight.severity]}>{insight.severity}</Badge>
              <p className="text-[13px] leading-snug text-ink-secondary">{insight.text}</p>
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
  options: OptionDef[];
  selected: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {options.map(({ key: option, label }) => {
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
            {label}
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
function Segmented({ options, value, disabled, onChange }: { options: OptionDef[]; value: string; disabled?: boolean; onChange: (next: string) => void }) {
  return (
    <div className="mt-1 inline-flex flex-wrap overflow-hidden rounded-lg border border-hairline">
      {options.map(({ key: option, label }) => (
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
          {label}
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
/**
 * A citation, picked from the register rather than typed.
 *
 * This field kind was declared on five checks — "Site photographs", "Drawing
 * register", "Peer review report" — and fell through the renderer chain to a
 * plain text box, so a person typed a filename into it and nothing pointed at
 * anything. Two consequences, and the second is the one that bites: a check
 * could read as evidenced while citing a document that was never filed, and
 * the field held one string where every label on it is plural.
 *
 * Three things this deliberately does:
 *
 * - **Filters by what the field asks for, and lets you past the filter.** A
 *   photographs field offers photographs first, because scrolling ninety rows
 *   to find one is how people stop citing anything. But the filter is a lens,
 *   never a gate: "show everything" is always one click away, since the
 *   register's own kinds are a person's judgement and this control has no
 *   business overruling them.
 * - **Says when a cited row is still a gap.** An expected-but-not-received
 *   document is a legitimate thing to cite — it is what the check is waiting
 *   for — but a reader must not mistake it for one on the file.
 * - **Takes an upload directly.** The alternative is: leave the check, go to
 *   the evidence register, create a row, upload, come back, find the row. Four
 *   of those five steps are where the citation gets abandoned.
 */
function EvidenceField({
  def,
  value,
  evidence,
  disabled,
  onAttach,
  onChange,
}: {
  def: CheckFieldDef;
  value: CheckFieldValue | undefined;
  evidence: EvidenceRecord[];
  disabled?: boolean;
  onAttach?: (def: CheckFieldDef, files: File[]) => Promise<string[]>;
  onChange: (ids: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => (Array.isArray(value?.value) ? (value!.value as string[]) : []), [value]);

  const wantsImage = def.accepts === 'image';
  const looksRight = (row: EvidenceRecord) =>
    !wantsImage || row.kind === 'photograph' || (row.attachments ?? []).some((a) => a.mimeType.startsWith('image/'));

  const candidates = evidence.filter((row) => !selected.includes(row.id) && (showAll || looksRight(row)));
  const hidden = evidence.filter((row) => !selected.includes(row.id) && !looksRight(row)).length;

  return (
    <div className="mt-0.5 space-y-1.5">
      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const row = evidence.find((e) => e.id === id);
            const gap = row && GAP_STATUS.has(row.status);
            return (
              <li
                key={id}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]',
                  gap ? 'border-warning/40 bg-warning/10 text-ink' : 'border-hairline bg-raised text-ink',
                )}
              >
                <span>{row ? row.title : id}</span>
                {row ? (
                  <span className={cn('text-[11px]', gap ? 'text-[var(--status-warning-text)]' : 'text-ink-muted')}>
                    {gap ? `${EVIDENCE_STATUS_LABEL[row.status]} — not on the file yet` : EVIDENCE_STATUS_LABEL[row.status]}
                  </span>
                ) : (
                  // Only reachable if a row was deleted after being cited; the
                  // API refuses to record one that never existed.
                  <span className="text-[11px] text-critical">no longer on the register</span>
                )}
                {!disabled ? (
                  <button type="button" className="text-ink-muted hover:text-ink" onClick={() => onChange(selected.filter((x) => x !== id))}>
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value=""
            disabled={busy}
            className="h-7 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink"
            onChange={(e) => {
              if (!e.target.value) return;
              onChange([...selected, e.target.value]);
              e.target.value = '';
            }}
          >
            <option value="">Cite a document…</option>
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title} — {EVIDENCE_STATUS_LABEL[row.status]}
              </option>
            ))}
          </select>

          {onAttach ? (
            <label className={cn('cursor-pointer text-[12px] font-medium text-brand', busy && 'opacity-50')}>
              {busy ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                multiple
                className="sr-only"
                accept={wantsImage ? 'image/*' : undefined}
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files?.length) return;
                  setBusy(true);
                  void onAttach(def, [...files])
                    .then((ids) => onChange([...selected, ...ids]))
                    .finally(() => {
                      setBusy(false);
                      e.target.value = '';
                    });
                }}
              />
            </label>
          ) : null}

          {hidden > 0 ? (
            <button type="button" className="text-[11px] text-ink-muted underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `hide ${hidden} that are not photographs` : `show ${hidden} other row(s)`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TableField({
  def,
  value,
  disabled,
  choices,
  onChange,
}: {
  def: CheckFieldDef;
  value: CheckFieldValue | undefined;
  disabled?: boolean;
  choices?: (target: RefTarget | undefined) => Array<{ id: string; label: string }>;
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
                      ) : column.kind === 'enum' || column.kind === 'ref' ? (
                        <select
                          disabled={disabled}
                          aria-label={column.label}
                          value={row[column.key] === null || row[column.key] === undefined ? '' : String(row[column.key])}
                          onChange={(e) => setCell(index, column.key, e.target.value)}
                          className="w-full min-w-[7rem] bg-transparent px-1 py-1 text-ink outline-none"
                        >
                          <option value="">—</option>
                          {(column.kind === 'ref' ? (choices?.(column.target) ?? []).map((c) => ({ key: c.id, label: c.label })) : fieldOptions(column, optionSetById).filter((o) => !o.retired)).map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
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
                      className="px-1 text-ink-muted hover:text-critical disabled:opacity-40"
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

/* ------------------------------------------------------------------ */
/* The controls a sheet adds                                             */
/* ------------------------------------------------------------------ */

const DOT: Record<string, string> = { good: 'bg-good', warning: 'bg-warning', critical: 'bg-critical', info: 'bg-brand', neutral: 'bg-[var(--axis)]' };

/** One of a few, each a tile to press: for the choice a sheet turns on, where every option should be seen at once. */
function Tiles({ options, value, disabled, label, onChange }: { options: OptionDef[]; value: string; disabled?: boolean; label: string; onChange: (next: string) => void }) {
  return (
    <div role="group" aria-label={label} className="mt-1 grid grid-cols-2 gap-1.5 [@container(min-width:30rem)]:grid-cols-4">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.key}
          onClick={() => onChange(value === option.key ? '' : option.key)}
          className={cn(
            'flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-50',
            value === option.key ? 'border-brand bg-brand-soft text-ink' : 'border-hairline text-ink-secondary hover:border-axis',
          )}
        >
          {option.tone ? <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[option.tone])} /> : null}
          <span className="min-w-0">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Yes or no as a tick and a cross. Pressing the one that is set clears it: nobody has looked. */
function Tick({ value, disabled, label, onChange }: { value: boolean | null; disabled?: boolean; label: string; onChange: (next: boolean | null) => void }) {
  return (
    <div role="group" aria-label={label} className="mt-1 inline-flex gap-1.5">
      {([true, false] as const).map((answer) => (
        <button
          key={String(answer)}
          type="button"
          disabled={disabled}
          aria-pressed={value === answer}
          aria-label={answer ? 'Yes' : 'No'}
          onClick={() => onChange(value === answer ? null : answer)}
          className={cn(
            'grid size-9 place-items-center rounded-lg border transition-colors disabled:opacity-50 coarse:size-11',
            value === answer ? (answer ? 'border-good bg-good/10 text-[var(--status-good-text)]' : 'border-critical bg-critical/10 text-critical') : 'border-hairline text-ink-muted hover:border-axis',
          )}
        >
          {answer ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/** A whole number on a short scale, each a button. */
function Scale({ min, max, value, disabled, label, onChange }: { min: number; max: number; value: number | null; disabled?: boolean; label: string; onChange: (next: number | null) => void }) {
  const steps = Array.from({ length: Math.min(11, max - min + 1) }, (_, i) => min + i);
  return (
    <div role="group" aria-label={label} className="mt-1 inline-flex overflow-hidden rounded-lg border border-hairline">
      {steps.map((step) => (
        <button
          key={step}
          type="button"
          disabled={disabled}
          aria-pressed={value === step}
          onClick={() => onChange(value === step ? null : step)}
          className={cn('min-w-9 border-r border-hairline px-2 py-1.5 text-[13px] tabular-nums last:border-r-0 disabled:opacity-50 coarse:min-h-11', value !== null && step <= value ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-sunken')}
        >
          {step}
        </button>
      ))}
    </div>
  );
}

/** A table whose first date column orders it, read as a line of events. The rows are edited in the table under it. */
function Timeline({ def, rows }: { def: CheckFieldDef; rows: CheckTableRow[] }) {
  const columns = def.columns ?? [];
  const date = columns.find((column) => column.kind === 'date');
  if (!date || !rows.length) return null;
  const rest = columns.filter((column) => column.key !== date.key);
  const dated = [...rows].filter((row) => row[date.key]).sort((a, b) => String(a[date.key]).localeCompare(String(b[date.key])));
  return (
    <ol className="mt-1.5 space-y-1.5 border-l border-hairline pl-3">
      {dated.map((row, index) => (
        <li key={index} className="relative text-[12px] text-ink-secondary">
          <span aria-hidden className="absolute -left-[15px] top-1.5 size-1.5 rounded-full bg-brand" />
          <span className="font-mono text-[11px] text-ink-muted">{String(row[date.key])}</span>{' '}
          {rest
            .filter((column) => row[column.key] !== null && row[column.key] !== undefined && row[column.key] !== '')
            .map((column) => formatFieldValue(column, { value: row[column.key]!, at: '', by: '' }, optionSetById))
            .join(' · ')}
        </li>
      ))}
    </ol>
  );
}

/** A table drawn as bars: one for each row, its `y` column against its `x` column's name. */
function TableChart({ def, rows }: { def: CheckFieldDef; rows: CheckTableRow[] }) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const points = rows.flatMap((row) => {
    const y = Number(row[def.chart?.y ?? '']);
    return def.chart && Number.isFinite(y) && row[def.chart.x] !== null && row[def.chart.x] !== undefined ? [{ label: String(row[def.chart.x]), y }] : [];
  });
  if (!points.length) return null;
  const width = Math.max(160, size.width);
  const gutter = Math.min(120, width * 0.35);
  const x = scaleLinear([0, Math.max(...points.map((p) => p.y), 0)], [gutter, width - 48]);
  const height = points.length * 22 + 4;
  return (
    <div ref={ref} className="relative mt-1.5 w-full">
      <ChartSvg width={width} height={height} ariaLabel={def.label} title={def.label} desc={points.map((p) => `${p.label}: ${p.y.toLocaleString('en-IN')}`).join('; ')}>
        {points.map((point, index) => (
          <g key={index}>
            <text x={gutter - 6} y={index * 22 + 14} textAnchor="end" className="fill-[var(--ink-muted)] text-[11px]">
              {point.label.length > 16 ? `${point.label.slice(0, 15)}…` : point.label}
            </text>
            <DirectedBar x0={gutter} x1={x(point.y)} y={index * 22 + 4} height={14} fill="var(--brand)" />
            <text x={x(point.y) + 4} y={index * 22 + 14} className="fill-[var(--ink-secondary)] font-mono text-[11px]">
              {point.y.toLocaleString('en-IN')}
            </text>
          </g>
        ))}
      </ChartSvg>
    </div>
  );
}

/**
 * Two lists paired. The pairs made so far, then what of each list is left
 * with no counterpart: that is what the display is for.
 */
function MatchField({ def, reading, rows, disabled, onChange }: { def: CheckFieldDef; reading: NonNullable<FieldView['match']>; rows: CheckTableRow[]; disabled?: boolean; onChange: (rows: CheckTableRow[]) => void }) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const sides = def.match!;
  const pair = () => {
    if (!left || !right) return;
    onChange([...rows, { [sides.left.column]: left, [sides.right.column]: right }]);
    setLeft('');
    setRight('');
  };
  const leftover = (side: typeof reading.left) =>
    side.leftover.length ? (
      <p className="text-[12px] text-[var(--status-warning-text)]">
        {side.label} with no match: {side.leftover.map((item) => item.label).join(', ')}
      </p>
    ) : null;
  return (
    <div className="mt-1 space-y-1.5">
      {reading.pairs.length ? (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline text-[12px]">
          {reading.pairs.map((made, index) => (
            <li key={index} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-ink">{made.leftLabel}</span>
              <span aria-hidden className="text-ink-muted">
                ↔
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{made.rightLabel}</span>
              {!disabled ? (
                <button type="button" aria-label={`Unpair ${made.leftLabel}`} className="px-1 text-ink-muted hover:text-critical" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-muted">Nothing paired yet.</p>
      )}
      {leftover(reading.left)}
      {leftover(reading.right)}
      {!disabled && reading.left.leftover.length && reading.right.items.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label={reading.left.label} value={left} onChange={(e) => setLeft(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink coarse:h-11">
            <option value="">{reading.left.label}…</option>
            {reading.left.leftover.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select aria-label={reading.right.label} value={right} onChange={(e) => setRight(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink coarse:h-11">
            <option value="">{reading.right.label}…</option>
            {reading.right.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={!left || !right} onClick={pair} className="rounded-md px-2 py-1 text-[12px] font-medium text-brand hover:underline disabled:opacity-40 coarse:min-h-11">
            Pair
          </button>
        </div>
      ) : null}
    </div>
  );
}

const VIEWER_SAID: Record<NonNullable<CheckFieldDef['viewer']>, string> = { pdf: 'Open paper', image: 'Open image', drawing: 'Open drawing', deed: 'Open deed', ifc: '' };

/** The file itself, one press away: the paper's own viewer, opened at the row cited. A model file has no viewer here yet, and says so. */
function Viewer({ def, value, evidence, onOpen }: { def: CheckFieldDef; value: CheckFieldValue | undefined; evidence: EvidenceRecord[]; onOpen?: (evidenceId: string) => void }) {
  const ids = Array.isArray(value?.value) ? (value!.value as string[]) : [];
  if (!ids.length) return null;
  if (def.viewer === 'ifc') return <p className="mt-1 text-[12px] text-ink-muted">IFC models are filed here and are not drawn on screen yet.</p>;
  if (!onOpen) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {ids.map((id) => (
        <button key={id} type="button" onClick={() => onOpen(id)} className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
          {VIEWER_SAID[def.viewer!]}
          {ids.length > 1 ? `: ${evidence.find((e) => e.id === id)?.title ?? ''}` : ''}
        </button>
      ))}
    </div>
  );
}

/** Whether a field has anything behind its label: a source to show, a rule row it read, or a decision the reader may take on it. */
function hasMore(def: CheckFieldDef, view: FieldView, may: boolean): boolean {
  const derived = def.kind === 'computed' || def.kind === 'status' || Boolean(def.sameAs);
  if (view.state === 'proposed' || view.state === 'disputed' || view.state === 'not_applicable') return false;
  return Boolean(view.source?.label || view.cites?.length || (may && !derived));
}

function sourceSaid(source: FieldSource | undefined): string {
  if (!source) return '';
  if (source.kind === 'paper') return `${source.label}${source.page ? `, p. ${source.page}` : ''}`;
  if (source.kind === 'external') return `${source.label}${source.asOf ? `, read ${source.asOf.slice(0, 10)}` : ''}`;
  if (source.kind === 'field') return `from ${source.label}`;
  if (source.kind === 'default') return `usual value${source.label ? `, ${source.label}` : ''}`;
  return source.label ? `typed by ${source.label}` : '';
}

/**
 * What a value carries beyond itself.
 *
 * An accepted or typed value carries nothing on its face: where it came from
 * is one press away, under "Source". Only what needs somebody is marked: a
 * value waiting to be accepted, another waiting beside it, a dispute, a usual
 * value standing in, a figure read from a rule nobody has verified.
 */
function FieldMarks({
  def,
  view,
  open: shown,
  disabled,
  onDecide,
  onOpenPaper,
}: {
  def: CheckFieldDef;
  view: FieldView;
  /** Whether the label was pressed: the source and what may be done with the value. */
  open: boolean;
  disabled?: boolean;
  onDecide?: Props['onDecide'];
  onOpenPaper?: Props['onOpenPaper'];
}) {
  const may = Boolean(onDecide) && !disabled;
  const derived = def.kind === 'computed' || def.kind === 'status' || Boolean(def.sameAs);
  const open = (source: FieldSource | undefined) =>
    source?.evidenceId && onOpenPaper ? (
      <button type="button" className="font-medium text-brand hover:underline" onClick={() => onOpenPaper(source.evidenceId!, source.page)}>
        {sourceSaid(source)}
      </button>
    ) : source?.url ? (
      <a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
        {sourceSaid(source)}
      </a>
    ) : (
      <span>{sourceSaid(source)}</span>
    );
  const act = 'rounded-md px-2 py-1 text-[12px] font-medium hover:underline coarse:min-h-11';
  return (
    <div className="mt-1 space-y-1 text-[11px] leading-snug text-ink-muted">
      {view.state === 'proposed' ? (
        <div className="rounded-lg border border-ai/40 bg-ai/5 px-2 py-1.5">
          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink">
            <AiMark size="xs" />
            <span>Waiting to be accepted</span>
            <span className="text-ink-muted">· {open(view.source)}</span>
          </p>
          {view.source?.quote ? <p className="mt-0.5">“{view.source.quote}”</p> : null}
          {may ? (
            <p className="mt-0.5 flex gap-1">
              <button type="button" className={cn(act, 'text-ink')} onClick={() => onDecide!(def, 'accept')}>
                Accept
              </button>
              <button type="button" className={cn(act, 'text-ink-muted')} onClick={() => onDecide!(def, 'set_aside')}>
                Not this
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {view.state === 'disputed' ? (
        <div className="rounded-lg border border-critical/30 bg-critical/5 px-2 py-1.5">
          <p className="text-[12px] text-critical">Disputed. Neither is used until one is kept.</p>
          {may ? (
            <p className="mt-0.5 flex flex-wrap gap-1">
              <button type="button" className={cn(act, 'text-ink')} onClick={() => onDecide!(def, 'keep')}>
                Keep {view.text}
              </button>
              {view.waiting.map((other) => (
                <button key={other.index} type="button" className={cn(act, 'text-ink')} onClick={() => onDecide!(def, 'accept', { pick: other.index })}>
                  Keep {other.text}
                </button>
              ))}
            </p>
          ) : (
            <p>{view.waiting.map((other) => other.text).join(' / ')}</p>
          )}
        </div>
      ) : (
        view.waiting.map((other) => (
          <div key={other.index} className="rounded-lg border border-ai/40 bg-ai/5 px-2 py-1.5">
            <p className="text-[12px] text-ink">
              Also offered: {other.text} <span className="text-ink-muted">· {open(other.source)}</span>
            </p>
            {may ? (
              <p className="mt-0.5 flex gap-1">
                <button type="button" className={cn(act, 'text-ink')} onClick={() => onDecide!(def, 'accept', { pick: other.index })}>
                  Take this
                </button>
                <button type="button" className={cn(act, 'text-ink-muted')} onClick={() => onDecide!(def, 'keep')}>
                  Keep what is held
                </button>
              </p>
            ) : null}
          </div>
        ))
      )}
      {view.state === 'assumed' ? <p>Assumed: {sourceSaid(view.source)}</p> : null}
      {view.cites?.some((cite) => !cite.verified) ? (
        <p className="text-[var(--status-warning-text)]">
          Read from a rule nobody has verified:{' '}
          {view.cites
            .filter((cite) => !cite.verified)
            .map((cite) => ruleSourceSaid(cite.source))
            .join('; ')}
        </p>
      ) : null}
      {view.notInPlay ? <p>Recorded, not asked for now</p> : null}
      {view.state === 'not_applicable' && may ? (
        <button type="button" className={cn(act, 'px-0 text-brand')} onClick={() => onDecide!(def, 'reopen')}>
          Ask again
        </button>
      ) : null}
      {/* Everything else about a value, shown when its label is pressed. */}
      {shown && hasMore(def, view, may) ? (
        <div className="space-y-1 rounded-lg bg-sunken px-2 py-1.5">
          {view.state !== 'empty' && sourceSaid(view.source) ? <p>{open(view.source)}</p> : null}
          {view.source?.quote ? <p>“{view.source.quote}”</p> : null}
          {view.held?.acceptedBy ? (
            <p>
              Accepted by {view.held.acceptedBy}
              {view.held.acceptedAt ? `, ${view.held.acceptedAt.slice(0, 10)}` : ''}
            </p>
          ) : null}
          {(view.cites ?? []).map((cite) => (
            <p key={`${cite.key}-${cite.from}`}>
              {cite.label}: {cite.value}
              {cite.unit ?? ''}, {ruleSourceSaid(cite.source)}, from {cite.from}. {cite.verified ? 'Verified.' : 'Not verified.'}
            </p>
          ))}
          {may && !derived ? (
            <p className="flex flex-wrap items-center gap-2">
              {view.state !== 'empty' && view.state !== 'assumed' ? (
                <button type="button" className="font-medium text-brand hover:underline coarse:min-h-11" onClick={() => onDecide!(def, 'dispute')}>
                  Dispute
                </button>
              ) : null}
              <select
                aria-label={`Why ${def.label} does not apply`}
                value=""
                onChange={(e) => e.target.value && onDecide!(def, 'not_applicable', { reason: e.target.value })}
                className="h-7 rounded-md border border-hairline bg-surface px-1.5 text-[11px] text-ink coarse:h-11"
              >
                <option value="">Not applicable…</option>
                {NA_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {NA_REASON_LABEL[reason]}
                  </option>
                ))}
              </select>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
