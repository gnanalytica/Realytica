/**
 * The records of a field set as a module outside the field system may read
 * them: those still on their list, each cut to the values that stand.
 *
 * The schedule, the tender tracker and the figures door are modules of their
 * own and do not resolve sheets. Where one of them follows a consequence of
 * what a department recorded (the days an extension of time grants, a
 * variation that is approved, the period an encumbrance certificate covers)
 * it asks here, so a value a paper or a model offered and nobody accepted
 * can reach none of them. Worked-out fields are not here: they are never
 * stored. A module that needs one works it out from the typed values, as the
 * sheet does.
 */

import { standingValues } from './check-fields';
import type { CheckFieldValue, DdProject } from './types';

export interface StandingRecord {
  id: string;
  /** Only what stands: accepted, typed or assumed. */
  values: Record<string, CheckFieldValue>;
}

/** The records on a set's list, each with only the values that stand. */
export function standingRecords(project: Partial<Pick<DdProject, 'fieldSheets'>>, setId: string): StandingRecord[] {
  return (project.fieldSheets?.[setId]?.records ?? []).flatMap((held) => (held.removed ? [] : [{ id: held.id, values: standingValues(held.values) }]));
}

/** One standing value of a record, where it is of the kind asked for. */
export function standingText(of: StandingRecord | undefined, key: string): string | undefined {
  const value = of?.values[key]?.value;
  return typeof value === 'string' && value ? value : undefined;
}

export function standingNumber(of: StandingRecord | undefined, key: string): number | undefined {
  const value = of?.values[key]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
