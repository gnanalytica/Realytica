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

import type { CheckFieldDef, CheckFieldValue, CheckInsight, CheckInsightRule, CheckInstance, FindingSeverity } from './types';

/* ==================================================================== */
/* Reading and writing a value                                           */
/* ==================================================================== */

/** Nothing recorded yet — distinct from a recorded zero, which is a finding. */
export function isBlank(value: CheckFieldValue | undefined): boolean {
  return !value || value.value === null || value.value === '';
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
export function validateFieldValue(def: CheckFieldDef, raw: unknown): { value: string | number | boolean | null } | { error: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };

  switch (def.kind) {
    case 'number':
    case 'money':
    case 'area':
    case 'percent': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
      if (!Number.isFinite(n)) return { error: `${def.label} is a number${def.unit ? ` in ${def.unit}` : ''}. "${String(raw)}" is not one.` };
      if (n < 0 && def.kind !== 'number') return { error: `${def.label} cannot be negative.` };
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
    default:
      return { value: String(raw).slice(0, 2000) };
  }
}

/** Render a value the way it should read in a report or a graph node. */
export function formatFieldValue(def: CheckFieldDef, value: CheckFieldValue | undefined): string {
  if (isBlank(value)) return '—';
  const raw = value!.value;
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
  if (def.kind === 'money' || def.kind === 'area' || def.kind === 'number') {
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
    }
  }

  return out;
}

/** Everything a check's fields say, ready for the panel, the report or a tool. */
export interface CheckFieldReading {
  defs: CheckFieldDef[];
  values: Record<string, CheckFieldValue>;
  insights: CheckInsight[];
  /** Declared fields still blank. What the panel nudges toward, and what an agent should ask for. */
  missing: CheckFieldDef[];
  filled: number;
  total: number;
}

export function readCheckFields(check: CheckInstance, defs: CheckFieldDef[], rules: CheckInsightRule[]): CheckFieldReading {
  const values = check.fields ?? {};
  const missing = defs.filter((d) => d.required !== false && isBlank(values[d.key]));
  return {
    defs,
    values,
    insights: checkInsights(defs, values, rules),
    missing,
    filled: defs.filter((d) => !isBlank(values[d.key])).length,
    total: defs.length,
  };
}

/** The worst thing the numbers say, for a badge. */
export function worstInsight(insights: CheckInsight[]): FindingSeverity | null {
  const order: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];
  for (const level of order) if (insights.some((i) => i.severity === level)) return level;
  return null;
}
