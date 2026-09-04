/**
 * Every valuation input, on one sheet.
 *
 * ## What this is for
 *
 * The four approaches take twenty-three inputs between them, and they were
 * spread across four checks in the assessment tree — so filling them meant
 * opening four modals, and the only way to learn which one was still short was
 * to run a valuation and read "no approach had all of its inputs" four times.
 * Measured on a new project, that is exactly what happens.
 *
 * A valuer's spreadsheet answers this without being asked: every input in one
 * grid, empty cells visible, and the arithmetic recomputing as you type. That
 * is the whole idea here.
 *
 * ## Why the intermediates matter more than the layout
 *
 * The residual takes nine inputs and, before this, showed nothing between them
 * and the answer — fees, the finance charge, the discount back from completion
 * were all computed inside `valuation-run.ts` and invisible until a run. A
 * transposed digit in the construction cost was findable only in the output.
 *
 * Those intermediates are now `computed` fields on the schema, so they
 * evaluate here through `evaluateFormula` — the same tree, the same evaluator,
 * live against what is typed rather than against what was last saved.
 * `test/input-sheet-formulas.test.ts` pins each one against the engine's own
 * arithmetic, because the same quantity now exists in two places.
 *
 * ## What it refuses to do
 *
 * It does not fill anything in. A blank cell is the product's most useful
 * output here — it is the reason the figure below is missing — and a default
 * quietly written into it would be a guess wearing a recorded value's clothes.
 * The same rule the engine follows everywhere else.
 */

import { useMemo, useRef, useState } from 'react';
import { Check, Minus, Sparkles } from 'lucide-react';
import {
  CHECK_FIELDS,
  evaluateFormula,
  type CheckFieldDef,
  type CheckFieldValue,
  type CheckFieldWrite,
  suggestionsFor,
  type CheckInstance,
  type DdProject,
  type FieldSuggestion,
} from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, Meter, Select, Tooltip, cn } from './ui/kit';
import { money } from '../lib/format';

/** The four approaches, in the order IBBI asks for them. */
const APPROACHES: { definitionId: string; label: string; note: string }[] = [
  { definitionId: 'indicative_valuation.comparable_inputs', label: 'Comparable', note: 'Rate × area' },
  { definitionId: 'indicative_valuation.cost_inputs', label: 'Depreciated cost', note: 'Replacement less depreciation, plus land' },
  { definitionId: 'indicative_valuation.income_inputs', label: 'Income', note: 'Net income ÷ cap rate' },
  { definitionId: 'indicative_valuation.residual_inputs', label: 'Residual', note: 'GDV less costs and profit' },
];

/** Every check on the project, indexed by the definition it came from. */
function checksByDefinition(project: DdProject): Map<string, CheckInstance> {
  const out = new Map<string, CheckInstance>();
  for (const assessment of project.assessments ?? []) {
    for (const scope of assessment.scopes ?? []) {
      for (const check of scope.checks ?? []) {
        if (!out.has(check.definitionId)) out.set(check.definitionId, check);
      }
    }
  }
  return out;
}

function isBlank(v: CheckFieldValue | undefined): boolean {
  if (!v || v.value === null || v.value === undefined) return true;
  return typeof v.value === 'string' && v.value.trim() === '';
}

/** How a figure reads in its own unit. Money gets grouping; a rate does not. */
function display(n: number, unit: string | undefined): string {
  if (!unit) return String(Math.round(n * 100) / 100);
  /*
   * Never compact in this column.
   *
   * A threshold meant 60,00,000 printed in full beside 2 Cr, so a reader
   * comparing two cost lines was comparing two notations — and 9.6 Cr for
   * 9,62,00,000 hides the two digits somebody is here to check. A sheet is
   * where exact figures belong; the summary above is where round ones do.
   */
  if (unit.startsWith('INR')) return money(n, 'INR', { compact: false });
  if (unit.includes('%')) return `${Math.round(n * 10) / 10}%`;
  return `${Math.round(n * 100) / 100} ${unit}`;
}

export function ValuationInputSheet({
  project,
  suggestions = [],
  onCommit,
  disabled,
}: {
  project: DdProject;
  /**
   * Values the file could start from, each carrying the basis it came from.
   *
   * Shown in the cell and marked as proposed. They are NOT recorded until
   * somebody accepts them: a proposal that counted toward completeness would
   * let the screen score itself on its own guesses.
   */
  suggestions?: readonly FieldSuggestion[];
  /** Called with one check's changed fields. The page owns the save. */
  onCommit: (
    checkId: string,
    values: Record<string, CheckFieldWrite>,
    sourceEvidenceId?: string,
  ) => Promise<string | null>;
  disabled?: boolean;
}) {
  const checks = useMemo(() => checksByDefinition(project), [project]);

  /*
   * What has been typed but not yet saved, keyed by `checkId.fieldKey`.
   *
   * Held here rather than per row so the computed cells can evaluate against
   * the draft: typing a construction cost has to move the finance charge
   * before anybody presses anything, or the sheet is just a form.
   */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  /*
   * Which evidence record a proof-required cell is being read from.
   *
   * Not a nicety. The API refuses a value on a `proof: 'required'` field
   * unless it cites something on the register — "Gross development value has
   * to cite what it was read from" — and that refusal is the product working
   * as intended. A sheet that could not cite simply could not fill the two
   * inputs the residual most depends on.
   */
  const [cite, setCite] = useState<Record<string, string>>({});
  /** Why a cell would not save, keyed like the draft. */
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const focused = useRef<string | null>(null);
  const evidence = project.evidence ?? [];

  /**
   * Record one field, from a blur or from accepting a proposal.
   *
   * One path rather than two: `Use` and typing must behave identically, and a
   * second copy of "did this change, does it cite anything, what if it is
   * refused" is a second place for those answers to diverge.
   */
  async function commit(
    key: string,
    def: CheckFieldDef,
    checkId: string,
    raw: string,
    before: CheckFieldValue['value'],
  ): Promise<void> {
    const text = raw.trim();
    const n = Number(text.replace(/[,\s]/g, ''));
    const next: CheckFieldWrite = text === '' ? null : Number.isFinite(n) && def.kind !== 'text' ? n : text;
    // Nothing changed — do not spend a write.
    if (String(before ?? '') === String(next ?? '')) {
      setDraft(({ [key]: _drop, ...rest }) => rest);
      return;
    }
    setSaving(key);
    const error = await onCommit(checkId, { [def.key]: next }, cite[key]);
    setSaving(null);
    /*
     * The draft survives a refusal.
     *
     * It used to be dropped unconditionally, so a value the API declined —
     * every proof-required field, until it cites something — vanished out of
     * the cell behind a toast. Typing that will not save beats typing that
     * disappears.
     */
    if (error) {
      setRejected((r) => ({ ...r, [key]: error }));
      return;
    }
    setRejected(({ [key]: _gone, ...rest }) => rest);
    setDraft(({ [key]: _drop, ...rest }) => rest);
  }

  return (
    <div className="space-y-4">
      {APPROACHES.map((approach) => {
        const check = checks.get(approach.definitionId);
        const defs = (CHECK_FIELDS[approach.definitionId] ?? []) as CheckFieldDef[];
        if (defs.length === 0) return null;

        const stored = check?.fields ?? {};
        const proposed = suggestionsFor(suggestions, approach.definitionId);

        // Saved values, overlaid with anything typed. Computed fields resolve
        // in declaration order so a later one can read an earlier one.
        const values: Record<string, CheckFieldValue> = {};
        for (const def of defs) {
          if (def.kind === 'computed') continue;
          const key = check ? `${check.id}.${def.key}` : '';
          const typed = key in draft ? draft[key] : undefined;
          if (typed !== undefined) {
            const n = Number(typed.replace(/[,\s]/g, ''));
            values[def.key] = { value: typed.trim() === '' ? null : Number.isFinite(n) ? n : typed } as CheckFieldValue;
          } else if (stored[def.key]) {
            values[def.key] = stored[def.key]!;
          }
        }
        for (const def of defs) {
          if (def.kind !== 'computed' || !def.formula) continue;
          const n = evaluateFormula(def.formula, values);
          if (n !== null) values[def.key] = { value: n } as CheckFieldValue;
        }

        const answerable = defs.filter((d) => d.kind !== 'computed');
        /*
         * Recorded, not proposed.
         *
         * A suggestion sitting in a cell must not move this meter or turn the
         * badge green — the whole reason a proposal is distinguishable is that
         * nobody has stood behind it yet.
         */
        const filled = answerable.filter((d) => !isBlank(stored[d.key])).length;
        const required = answerable.filter((d) => d.required !== false);
        const runnable = required.every((d) => !isBlank(stored[d.key]));
        // Only where there is a check to record into. A card with no check
        // cannot accept anything, and a badge offering three proposals above
        // a "not instantiated" message is an offer the sheet cannot keep.
        const proposedPending = check
          ? answerable.filter((d) => isBlank(stored[d.key]) && proposed.has(d.key)).length
          : 0;

        return (
          <Card key={approach.definitionId}>
            <CardHeader
              title={approach.label}
              subtitle={approach.note}
              action={
                <div className="flex items-center gap-2">
                  <Meter label="recorded" value={answerable.length ? filled / answerable.length : 0} />
                  {proposedPending > 0 ? (
                    <Badge tone="info" icon={<Sparkles size={10} />}>
                      {proposedPending} proposed
                    </Badge>
                  ) : null}
                  <Badge tone={runnable ? 'good' : 'warning'}>{runnable ? 'Can run' : 'Short'}</Badge>
                </div>
              }
            />
            <CardBody className="p-0">
              {!check ? (
                <div className="space-y-2 px-4 py-3">
                  <p className="text-xs text-ink-secondary">
                    Start an indicative valuation assessment to record these.
                  </p>
                  {/*
                    The proposals still show.
                    A project with no assessment is the coldest possible start
                    and the moment this is worth most: it is the difference
                    between an empty tab and "here is the locality rate we
                    already hold, and here is what it would need beside it".
                    Read-only, because there is nowhere to record them yet.
                  */}
                  {[...suggestionsFor(suggestions, approach.definitionId).values()].map((sug) => (
                    <div key={sug.key} className="flex items-baseline justify-between gap-3 text-mini">
                      <span className="min-w-0 text-ink-secondary">
                        {defs.find((d) => d.key === sug.key)?.label ?? sug.key}
                      </span>
                      <Tooltip label={sug.basis}>
                        <span className="shrink-0 cursor-help font-mono tabular-nums text-brand">
                          {sug.value.toLocaleString('en-IN')}
                        </span>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-hairline text-mini uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-1.5 text-left font-normal">Input</th>
                      <th className="w-32 px-2 py-1.5 text-right font-normal">Value</th>
                      <th className="hidden w-40 px-2 py-1.5 text-left font-normal [@container(min-width:44rem)]:table-cell">
                        From
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {defs.map((def) => {
                      const key = `${check.id}.${def.key}`;
                      const value = values[def.key];
                      const blank = isBlank(value);
                      const computed = def.kind === 'computed';
                      const suggestion = proposed.get(def.key);
                      // A proposal only shows where nothing is recorded and
                      // nothing has been typed — it must never sit on top of
                      // somebody's own value.
                      const showing =
                        !computed && isBlank(stored[def.key]) && !(key in draft) && suggestion !== undefined;
                      const state: 'Recorded' | 'Proposed' | 'Optional' | 'Missing' = !isBlank(stored[def.key])
                        ? 'Recorded'
                        : showing
                          ? 'Proposed'
                          : def.required === false
                            ? 'Optional'
                            : 'Missing';

                      return (
                        <tr
                          key={def.key}
                          className={cn(
                            'border-b border-hairline last:border-b-0',
                            // A computed row is arithmetic, not an input, and
                            // has to look unlike one or somebody will try.
                            computed && 'bg-sunken/50',
                          )}
                        >
                          <td className="px-4 py-1.5">
                            <span className="flex items-center gap-1.5">
                              {/*
                                Three states, not two. A proposed value is
                                neither recorded nor missing, and drawing it as
                                either would be the lie: as recorded it claims
                                somebody stood behind it, as missing it hides
                                that the answer is sitting right there.
                              */}
                              <span
                                title={state}
                                aria-label={state}
                                className={cn(
                                  'shrink-0',
                                  state === 'Recorded'
                                    ? 'text-[var(--status-good-text)]'
                                    : state === 'Proposed'
                                      ? 'text-brand'
                                      : def.required === false
                                        ? 'text-ink-muted'
                                        : 'text-[var(--status-warning-text)]',
                                )}
                              >
                                {state === 'Recorded' ? (
                                  <Check size={11} />
                                ) : state === 'Proposed' ? (
                                  <Sparkles size={11} />
                                ) : (
                                  <Minus size={11} />
                                )}
                              </span>
                              <span className={cn(computed ? 'text-ink-secondary' : 'text-ink')}>{def.label}</span>
                              {def.proof === 'required' ? (
                                <Badge tone="neutral" title="This value has to cite something on the evidence register.">
                                  proof
                                </Badge>
                              ) : null}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {computed ? (
                              <span className="font-mono tabular-nums text-ink">
                                {value && typeof value.value === 'number' ? display(value.value, def.unit) : '—'}
                              </span>
                            ) : (
                              <span className="flex items-baseline justify-end gap-1">
                              <input
                                inputMode={def.kind === 'text' || def.kind === 'enum' ? 'text' : 'decimal'}
                                disabled={disabled}
                                aria-label={def.label}
                                className={cn(
                                  'w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right font-mono tabular-nums text-ink',
                                  'hover:border-[var(--ring)] focus:border-brand focus:outline-none',
                                  showing && 'placeholder:text-brand',
                                  saving === key && 'opacity-60',
                                )}
                                /*
                                  The proposal shows as a placeholder rather
                                  than as the value.
                                  A placeholder is already the browser's own
                                  convention for "not yours yet": it does not
                                  submit, it does not survive a save, and it
                                  cannot be mistaken for something typed. A
                                  proposal written into `value` would be
                                  indistinguishable from a recorded figure the
                                  moment the highlight was missed.
                                */
                                placeholder={showing ? String(suggestion.value) : '—'}
                                value={
                                  key in draft
                                    ? draft[key]
                                    : stored[def.key] && stored[def.key]!.value !== null
                                      ? String(stored[def.key]!.value)
                                      : ''
                                }
                                onFocus={() => {
                                  focused.current = key;
                                }}
                                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                onBlur={async () => {
                                  focused.current = null;
                                  if (!(key in draft)) return;
                                  await commit(key, def, check.id, draft[key]!, stored[def.key]?.value ?? null);
                                }}
                              />
                              {/*
                                The unit, beside the value rather than only in
                                the placeholder. A filled cell showed a bare
                                "10" where an empty one had said "%" — so the
                                moment a rate was recorded you could no longer
                                tell a percentage from a month from a year.
                              */}
                              {def.unit ? (
                                <span className="shrink-0 text-mini text-ink-muted">{def.unit}</span>
                              ) : null}
                              {showing ? (
                                <Tooltip
                                  label={
                                    def.proof === 'required' && !cite[key]
                                      ? `${suggestion.basis} — cite a source to record it.`
                                      : suggestion.basis
                                  }
                                >
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={disabled}
                                    aria-label={`Use proposed ${def.label}`}
                                    onClick={() => {
                                      /*
                                        A proof-required field cannot record
                                        until it cites something, so pressing
                                        Use on one used to buy a guaranteed
                                        refusal — the API declines, the reason
                                        appears, and nothing has moved.

                                        It stages the value instead. The number
                                        is in the cell, the source picker is
                                        beside it, and the save happens on blur
                                        once the citation is chosen. Where no
                                        proof is required it records straight
                                        away, which is what Use should mean.
                                      */
                                      const needsProof = def.proof === 'required' && !cite[key];
                                      if (needsProof) {
                                        setDraft((d) => ({ ...d, [key]: String(suggestion.value) }));
                                        return;
                                      }
                                      void commit(key, def, check.id, String(suggestion.value), null);
                                    }}
                                  >
                                    Use
                                  </Button>
                                </Tooltip>
                              ) : null}
                              </span>
                            )}
                          </td>
                          <td className="hidden px-2 py-1.5 align-top text-mini text-ink-muted [@container(min-width:44rem)]:table-cell">
                            {computed ? (
                              'computed'
                            ) : def.proof === 'required' ? (
                              <Select
                                aria-label={`Source for ${def.label}`}
                                disabled={disabled}
                                value={cite[key] ?? stored[def.key]?.sourceEvidenceId ?? ''}
                                onChange={(e) => setCite((c) => ({ ...c, [key]: e.target.value }))}
                              >
                                <option value="">{def.from ?? 'Cite a document'}…</option>
                                {evidence.map((ev) => (
                                  <option key={ev.id} value={ev.id}>
                                    {ev.title}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              (def.from ?? '')
                            )}
                            {rejected[key] ? (
                              <span className="mt-0.5 block text-[var(--status-warning-text)]">{rejected[key]}</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

export default ValuationInputSheet;
