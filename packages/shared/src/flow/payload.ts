/**
 * Reading a value out of a run, and putting one into a string.
 *
 * The whole surface a flow has for talking about its own data, and it is small
 * on purpose. There is a dotted path and a `{{path}}` template, and there is
 * no expression language — not because one would be hard, but because the
 * moment a configuration surface can compute, a drawn flow stops being
 * reviewable and "why did it do that" needs a debugger rather than a reading.
 *
 * Both halves live here rather than in the engine so the canvas can render a
 * condition back as a sentence, and preview a template against a sample
 * payload, using exactly the code that will run.
 */

import type { FlowCondition, FlowConditionGroup } from './types';

export type Payload = Record<string, unknown>;

/**
 * Follow a dotted path. `findings.0.title` and `findings.length` both work,
 * the second because "did anything come back" is the commonest test there is
 * and making somebody write a filter for it would be silly.
 */
export function readPath(payload: Payload, path: string): unknown {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let cursor: unknown = payload;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor) && part === 'length') {
      cursor = cursor.length;
      continue;
    }
    if (typeof cursor === 'string' && part === 'length') {
      cursor = cursor.length;
      continue;
    }
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/** Set a dotted path, creating the objects on the way. */
export function writePath(payload: Payload, path: string, value: unknown): void {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return;
  let cursor: Record<string, unknown> = payload;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

/** How a value reads when it has to become text. */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Substitute `{{path}}` from the payload.
 *
 * A path that resolves to nothing becomes an empty string rather than being
 * left as `{{...}}`. Leaving the braces in would send them to a model or an
 * API, where they read as content and are answered as if they meant something.
 */
export function fillTemplate(template: string, payload: Payload): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => asText(readPath(payload, path)));
}

/** Names the template mentions, for showing an operator what a node depends on. */
export function templatePaths(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]!.trim());
}

function emptyish(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Compare, as numbers when both sides are numbers and as text otherwise.
 *
 * `"10" > "9"` is false as text and true as numbers, and an operator writing a
 * threshold means the second. Anything that does not parse falls back to a
 * case-insensitive text comparison rather than to `NaN`, which would make
 * every comparison quietly false.
 */
function compare(left: unknown, right: string): number {
  const l = typeof left === 'number' ? left : Number(asText(left));
  const r = Number(right);
  if (Number.isFinite(l) && Number.isFinite(r)) return l === r ? 0 : l < r ? -1 : 1;
  const ls = asText(left).toLowerCase();
  const rs = right.toLowerCase();
  return ls === rs ? 0 : ls < rs ? -1 : 1;
}

export function evaluateCondition(condition: FlowCondition, payload: Payload): boolean {
  const value = readPath(payload, condition.path);
  const wanted = condition.value ?? '';
  switch (condition.operator) {
    case 'equals':
      return compare(value, wanted) === 0;
    case 'not_equals':
      return compare(value, wanted) !== 0;
    case 'contains':
      return asText(value).toLowerCase().includes(wanted.toLowerCase());
    case 'greater_than':
      return compare(value, wanted) > 0;
    case 'less_than':
      return compare(value, wanted) < 0;
    case 'is_empty':
      return emptyish(value);
    case 'is_not_empty':
      return !emptyish(value);
    case 'is_true':
      return value === true || asText(value).toLowerCase() === 'true';
    case 'is_false':
      return value === false || asText(value).toLowerCase() === 'false';
    default:
      return false;
  }
}

/**
 * An empty group passes.
 *
 * Deliberate, and the validator warns about it separately: a half-configured
 * filter should let a test run through rather than silently stop it, because a
 * flow that stops for a reason nobody stated is the harder thing to debug.
 */
export function evaluateGroup(group: FlowConditionGroup, payload: Payload): boolean {
  if (group.conditions.length === 0) return true;
  return group.match === 'all'
    ? group.conditions.every((c) => evaluateCondition(c, payload))
    : group.conditions.some((c) => evaluateCondition(c, payload));
}

/* ==================================================================== */
/* Saying it back in words                                              */
/* ==================================================================== */

const OPERATOR_PHRASE: Record<FlowCondition['operator'], string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  greater_than: 'is more than',
  less_than: 'is less than',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is_true: 'is true',
  is_false: 'is false',
};

const UNARY = new Set<FlowCondition['operator']>(['is_empty', 'is_not_empty', 'is_true', 'is_false']);

/** One condition as a sentence, so a drawn flow can be read rather than decoded. */
export function describeCondition(condition: FlowCondition): string {
  const phrase = OPERATOR_PHRASE[condition.operator];
  return UNARY.has(condition.operator)
    ? `${condition.path} ${phrase}`
    : `${condition.path} ${phrase} ${condition.value ?? ''}`.trim();
}

export function describeGroup(group: FlowConditionGroup): string {
  if (group.conditions.length === 0) return 'anything';
  const joiner = group.match === 'all' ? ' and ' : ' or ';
  return group.conditions.map(describeCondition).join(joiner);
}
