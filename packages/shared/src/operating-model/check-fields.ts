/**
 * Typed fields on a check, and the observations that fall out of them.
 *
 * A check today says what to compare and gives you a box to type prose into:
 *
 *   acceptanceCriteria: "Survey numbers, extents and coordinates in the title
 *                        match the latest survey without unexplained remainder."
 *   comments:           "extent looks a bit off vs the khata, need to confirm"
 *
 * Everything the product wants to do next is blocked on that second line being
 * a sentence instead of two numbers. You cannot compute a divergence from it,
 * cite it in a report, put it in the graph, chart it, or let an agent read it
 * without a model guessing at what it meant. The prose is not the record — it
 * is a description of a record nobody kept.
 *
 * So a check declares the fields it is actually about, and a person (or an
 * extraction, or an accepted proposal) fills them in. Once the numbers exist:
 *
 * - **Insights are computed, not generated.** `checkInsights` is arithmetic
 *   over declared fields against declared tolerances. "The deed recites 1,208
 *   sqm and the khata records 1,161 — 3.9% apart, outside the 1% tolerance"
 *   is a calculation, and calculations belong to the engine, not to a model.
 *   A model may READ an insight and reason about it; it may not author one.
 * - **A chart becomes possible** because there is finally something to plot.
 * - **The graph gets facts** rather than a paragraph.
 * - **An agent can read and write** through a schema that can refuse it.
 *
 * The shape is deliberately one system, not fourteen. A per-scope bespoke
 * panel for each of the 14 scopes would be fourteen half-finished surfaces
 * inside a year; a declared schema per check is one renderer and N lines of
 * data, and a new check costs a declaration rather than a component.
 */

import type { CheckFieldDef, CheckFieldValue, CheckFormula, CheckInsight, CheckInsightRule, CheckInstance, CheckTableRow, FindingSeverity } from './types';

/* ==================================================================== */
/* Reading and writing a value                                           */
/* ==================================================================== */

/** Nothing recorded yet — distinct from a recorded zero, which is a finding. */
export function isBlank(value: CheckFieldValue | undefined): boolean {
  if (!value || value.value === null || value.value === '') return true;
  // An empty table or an empty multi-select is nothing recorded, not a
  // recorded nothing — the same distinction a blank number box carries.
  return Array.isArray(value.value) && value.value.length === 0;
}

export function fieldNumber(value: CheckFieldValue | undefined): number | null {
  if (isBlank(value)) return null;
  const raw = value!.value;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;
  const parsed = Number(String(raw).replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Coerce and check one value against its declaration.
 *
 * Returns the reason rather than throwing, because both callers want to say
 * it rather than crash: the API returns it as a 400, and the agent tool hands
 * it back to the model so the next attempt is right instead of a retry loop.
 */
export function validateFieldValue(
  def: CheckFieldDef,
  raw: unknown,
): { value: CheckFieldValue['value'] } | { error: string } {
  // A computed field is worked out, never written. Refused rather than
  // ignored, so a caller that thought it was setting one is told.
  if (def.kind === 'computed') {
    return { error: `${def.label} is worked out from the other values on this check. It is not written directly.` };
  }
  if (raw === null || raw === undefined || raw === '') return { value: null };

  switch (def.kind) {
    case 'multi_enum': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
      if (!def.options?.length) return { value: list };
      const unknown = list.filter((item) => !def.options!.some((o) => o.toLowerCase() === item.toLowerCase()));
      if (unknown.length) return { error: `${def.label}: "${unknown.join('", "')}" is not on the list. Choose from: ${def.options.join(', ')}.` };
      return { value: def.options.filter((o) => list.some((i) => i.toLowerCase() === o.toLowerCase())) };
    }
    case 'table': {
      if (!Array.isArray(raw)) return { error: `${def.label} is a table — send an array of rows.` };
      const columns = def.columns ?? [];
      const rows: CheckTableRow[] = [];
      for (const [index, entry] of raw.entries()) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          return { error: `${def.label} row ${index + 1} is not a row object.` };
        }
        const row: CheckTableRow = {};
        for (const [key, cell] of Object.entries(entry as Record<string, unknown>)) {
          const column = columns.find((c) => c.key === key);
          if (!column) return { error: `${def.label} has no column "${key}". It has: ${columns.map((c) => c.key).join(', ')}.` };
          const parsed = validateFieldValue(column, cell);
          if ('error' in parsed) return { error: `${def.label} row ${index + 1}: ${parsed.error}` };
          row[key] = parsed.value as CheckTableRow[string];
        }
        rows.push(row);
      }
      return { value: rows };
    }
    case 'evidence': {
      const s = String(raw).trim();
      if (!s) return { value: null };
      return { value: s };
    }
    case 'duration':
    case 'number':
    case 'money':
    case 'area':
    case 'percent': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: `${def.label} is a number${def.unit ? ` in ${def.unit}` : ''}. "${String(raw)}" is not one.` };
      if (n < 0 && def.kind !== 'number' && def.kind !== 'duration') return { error: `${def.label} cannot be negative.` };
      if (def.min !== undefined && n < def.min) return { error: `${def.label} cannot be below ${def.min}${def.unit ? ` ${def.unit}` : ''}.` };
      if (def.max !== undefined && n > def.max) return { error: `${def.label} cannot be above ${def.max}${def.unit ? ` ${def.unit}` : ''}.` };
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      const s = String(raw).toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(s)) return { value: true };
      if (['false', 'no', 'n', '0'].includes(s)) return { value: false };
      return { error: `${def.label} is yes or no.` };
    }
    case 'date': {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `${def.label} is a date as YYYY-MM-DD.` };
      if (Number.isNaN(Date.parse(s))) return { error: `"${s}" is not a real date.` };
      return { value: s };
    }
    case 'enum': {
      const s = String(raw).trim();
      if (!def.options?.length) return { value: s };
      const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (!hit) return { error: `${def.label} is one of: ${def.options.join(', ')}.` };
      return { value: hit };
    }
    case 'text':
    case 'longtext':
    default:
      return { value: String(raw).slice(0, def.kind === 'longtext' ? 20000 : 2000) };
  }
}

/* ==================================================================== */
/* Formulas                                                              */
/* ==================================================================== */

/**
 * Work out a computed field from its siblings.
 *
 * Returns null rather than 0 whenever any input is missing, and that
 * propagates: a variance against a figure nobody has recorded is not zero
 * variance, it is an unanswered question, and the two must never render the
 * same. Division by zero is null for the same reason.
 *
 * No parser and no eval — the formula is a tree, every leaf is a field key or
 * a literal, and there is nothing here that could execute a string.
 */
export function evaluateFormula(formula: CheckFormula, values: Record<string, CheckFieldValue>): number | null {
  switch (formula.op) {
    case 'const':
      return formula.value;
    case 'field':
      return fieldNumber(values[formula.key]);
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      const left = evaluateFormula(formula.left, values);
      const right = evaluateFormula(formula.right, values);
      if (left === null || right === null) return null;
      if (formula.op === 'add') return left + right;
      if (formula.op === 'subtract') return left - right;
      if (formula.op === 'multiply') return left * right;
      return right === 0 ? null : left / right;
    }
    case 'variance_pct': {
      const left = evaluateFormula(formula.left, values);
      const right = evaluateFormula(formula.right, values);
      if (left === null || right === null || right === 0) return null;
      return ((left - right) / right) * 100;
    }
    case 'sum': {
      const rows = tableRows(values[formula.table]);
      if (rows === null) return null;
      let total = 0;
      for (const row of rows) {
        const cell = row[formula.column];
        const n = typeof cell === 'number' ? cell : Number(String(cell ?? '').replace(/[,\s]/g, ''));
        if (Number.isFinite(n)) total += n;
      }
      return total;
    }
    case 'count': {
      const rows = tableRows(values[formula.table]);
      return rows === null ? null : rows.length;
    }
    case 'days_between': {
      const left = values[formula.left]?.value;
      const right = values[formula.right]?.value;
      if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return null;
      const a = Date.parse(left);
      const b = Date.parse(right);
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      return Math.round((a - b) / 86_400_000);
    }
  }
}

/** The rows of a table field, or null when nothing has been entered. */
export function tableRows(value: CheckFieldValue | undefined): CheckTableRow[] | null {
  if (!value || !Array.isArray(value.value)) return null;
  const rows = value.value as (string | CheckTableRow)[];
  return rows.filter((r): r is CheckTableRow => typeof r === 'object' && r !== null);
}

/** The values a check holds, with every computed field worked out. */
export function withComputed(defs: CheckFieldDef[], values: Record<string, CheckFieldValue>): Record<string, CheckFieldValue> {
  const out = { ...values };
  for (const def of defs) {
    if (def.kind !== 'computed' || !def.formula) continue;
    const result = evaluateFormula(def.formula, out);
    out[def.key] = { value: result === null ? null : Math.round(result * 100) / 100, at: '', by: 'computed' };
  }
  return out;
}

/** Render a value the way it should read in a report or a graph node. */
export function formatFieldValue(def: CheckFieldDef, value: CheckFieldValue | undefined): string {
  if (isBlank(value)) return '—';
  const raw = value!.value;
  if (Array.isArray(raw)) {
    if (def.kind === 'table') return `${raw.length} row(s)`;
    return (raw as string[]).join(', ');
  }
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
  if (def.kind === 'money' || def.kind === 'area' || def.kind === 'number' || def.kind === 'computed' || def.kind === 'duration') {
    const n = fieldNumber(value);
    if (n === null) return String(raw);
    return `${n.toLocaleString('en-IN')}${def.unit ? ` ${def.unit}` : ''}`;
  }
  if (def.kind === 'percent') return `${fieldNumber(value) ?? raw}%`;
  return String(raw);
}

/* ==================================================================== */
/* Observations, computed                                                */
/* ==================================================================== */

const DEFAULT_TOLERANCE = 0.01;

function fill(template: string, parts: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => parts[key] ?? `{${key}}`);
}

/**
 * What the recorded values say, on their own terms.
 *
 * Every rule is arithmetic against a declared tolerance, and every insight
 * names the two numbers it is about — so a reader can disagree with the
 * conclusion by checking the inputs, which is the only kind of automated
 * observation worth putting in front of a valuer.
 *
 * A field that has not been filled in produces NO insight. Silence about an
 * unknown is correct; "0 sqm, a 100% divergence" from an empty box is the
 * confident wrong answer this whole product exists to avoid.
 */
export function checkInsights(defs: CheckFieldDef[], values: Record<string, CheckFieldValue>, rules: CheckInsightRule[]): CheckInsight[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: CheckInsight[] = [];

  for (const rule of rules) {
    if (rule.kind === 'compare') {
      const [aKey, bKey] = rule.fields;
      const a = fieldNumber(values[aKey!]);
      const b = fieldNumber(values[bKey!]);
      if (a === null || b === null) continue;
      const base = Math.max(Math.abs(a), Math.abs(b));
      if (base === 0) continue;
      const divergence = Math.abs(a - b) / base;
      const tolerance = rule.tolerance ?? DEFAULT_TOLERANCE;
      if (divergence <= tolerance) continue;
      out.push({
        severity: rule.severity,
        text: fill(rule.say, {
          a: formatFieldValue(byKey.get(aKey!)!, values[aKey!]),
          b: formatFieldValue(byKey.get(bKey!)!, values[bKey!]),
          divergence: `${(divergence * 100).toFixed(1)}%`,
          tolerance: `${(tolerance * 100).toFixed(1)}%`,
        }),
        fields: [aKey!, bKey!],
        computed: true,
      });
      continue;
    }

    if (rule.kind === 'before') {
      const [aKey, bKey] = rule.fields;
      const a = values[aKey!]?.value;
      const b = values[bKey!]?.value;
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) continue;
      if (a <= b) continue;
      out.push({ severity: rule.severity, text: fill(rule.say, { a, b }), fields: [aKey!, bKey!], computed: true });
      continue;
    }

    if (rule.kind === 'require') {
      const [aKey] = rule.fields;
      const value = values[aKey!];
      // Only fires once SOMETHING has been recorded on this check. A wholly
      // untouched check is not a finding, it is work not yet done, and the
      // progress figures already say so.
      if (Object.keys(values).length === 0) continue;
      if (!isBlank(value)) continue;
      out.push({ severity: rule.severity, text: fill(rule.say, {}), fields: [aKey!], computed: true });
      continue;
    }

    if (rule.kind === 'require_if') {
      // The gate has to have been answered before its consequence can be
      // demanded. An unanswered gate is a question, not a shortfall.
      const [gateKey, needKey] = rule.fields;
      const gate = values[gateKey!];
      if (isBlank(gate)) continue;
      const answer = String(gate!.value);
      if (rule.whenIn && !rule.whenIn.includes(answer)) continue;
      if (!isBlank(values[needKey!])) continue;
      out.push({
        severity: rule.severity,
        text: fill(rule.say, { a: formatFieldValue(byKey.get(gateKey!)!, gate) }),
        fields: [gateKey!, needKey!],
        computed: true,
      });
    }
  }

  return out;
}

/* ==================================================================== */
/* Divergence against the line it was judged by                          */
/* ==================================================================== */

export interface ToleranceReading {
  /** What is being compared, in words. */
  label: string;
  aLabel: string;
  bLabel: string;
  a: number;
  b: number;
  /** Absolute relative difference, 0..1. */
  divergence: number;
  /** What the rule said was close enough, 0..1. */
  tolerance: number;
  /**
   * Divergence as a MULTIPLE of its own tolerance.
   *
   * This is the number that makes different checks comparable, and it is the
   * whole reason a chart of these is worth drawing. A 3% budget variance and
   * a 3% extent variance are not the same fact: one is inside a 5% threshold
   * and the other is triple a 1% one. Plotting raw percentages side by side
   * says they are equal. Plotting multiples of tolerance says which one is a
   * finding.
   *
   * `Infinity` when the tolerance is zero — an FAR above what the plan allows
   * is not "a lot over", it is a breach, and it should sit at the end of the
   * scale rather than be given a finite position that invites comparison.
   */
  overBy: number;
  within: boolean;
  severity: FindingSeverity;
  text: string;
}

/**
 * Every comparison this check makes, with how far past its own line it fell.
 *
 * Only rules with both numbers recorded appear. A comparison missing a side
 * is not a zero divergence, it is an unanswered question, and putting it on a
 * chart at the origin would read as the safest thing on the page.
 */
export function toleranceReadings(
  defs: CheckFieldDef[],
  values: Record<string, CheckFieldValue>,
  rules: CheckInsightRule[],
): ToleranceReading[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: ToleranceReading[] = [];

  for (const rule of rules) {
    if (rule.kind !== 'compare') continue;
    const [aKey, bKey] = rule.fields;
    const aDef = byKey.get(aKey!);
    const bDef = byKey.get(bKey!);
    if (!aDef || !bDef) continue;
    const a = fieldNumber(values[aKey!]);
    const b = fieldNumber(values[bKey!]);
    if (a === null || b === null) continue;
    const base = Math.max(Math.abs(a), Math.abs(b));
    if (base === 0) continue;

    const divergence = Math.abs(a - b) / base;
    const tolerance = rule.tolerance ?? 0.01;
    const overBy = tolerance === 0 ? (divergence === 0 ? 0 : Number.POSITIVE_INFINITY) : divergence / tolerance;
    out.push({
      label: `${aDef.label} vs ${bDef.label}`,
      aLabel: formatFieldValue(aDef, values[aKey!]),
      bLabel: formatFieldValue(bDef, values[bKey!]),
      a,
      b,
      divergence,
      tolerance,
      overBy,
      within: divergence <= tolerance,
      severity: rule.severity,
      text: rule.say,
    });
  }

  return out;
}

/** Everything a check's fields say, ready for the panel, the report or a tool. */
export interface CheckFieldReading {
  defs: CheckFieldDef[];
  /** Stored values, with every computed field worked out. */
  values: Record<string, CheckFieldValue>;
  insights: CheckInsight[];
  /** Every comparison on this check, and how far past its own line it fell. */
  tolerances: ToleranceReading[];
  /** Declared fields still blank. What the panel nudges toward, and what an agent should ask for. */
  missing: CheckFieldDef[];
  /**
   * Recorded, but with nothing on the evidence register behind it.
   *
   * Not an error and not a blocker — plenty of a diligence gets recorded from
   * a phone call before the certificate arrives. It is a distinct state that
   * a report has to be able to see, because a figure with a deed behind it
   * and a figure somebody remembered must never print the same.
   */
  unproven: CheckFieldDef[];
  filled: number;
  total: number;
}

export function readCheckFields(check: CheckInstance, defs: CheckFieldDef[], rules: CheckInsightRule[]): CheckFieldReading {
  const values = withComputed(defs, check.fields ?? {});
  // A computed field is never "missing" — nobody can fill it in, and asking
  // somebody to would be asking for the wrong thing.
  const answerable = defs.filter((d) => d.kind !== 'computed');
  return {
    defs,
    values,
    insights: checkInsights(defs, values, rules),
    tolerances: toleranceReadings(defs, values, rules),
    missing: answerable.filter((d) => d.required !== false && isBlank(values[d.key])),
    unproven: answerable.filter(
      (d) => d.proof && d.proof !== 'none' && !isBlank(values[d.key]) && !values[d.key]?.sourceEvidenceId,
    ),
    filled: answerable.filter((d) => !isBlank(values[d.key])).length,
    total: answerable.length,
  };
}

/** The worst thing the numbers say, for a badge. */
export function worstInsight(insights: CheckInsight[]): FindingSeverity | null {
  const order: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];
  for (const level of order) if (insights.some((i) => i.severity === level)) return level;
  return null;
}
