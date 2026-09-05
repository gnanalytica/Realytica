/**
 * What a card would change, shown as the change.
 *
 * A proposal that CREATES something is fully described by its title: "Add
 * Land parcel", "Start the Approval / Compliance DD". You know what approving
 * does because there was nothing there before.
 *
 * A proposal that CHANGES something is not. "Record the built-up area" does
 * not say that the file already holds 9,290 sqm and this would make it 8,140,
 * and the rationale — written by a model, in prose — is exactly the wrong
 * place to learn it. Somebody approving that card is approving a number they
 * cannot see, against a number they cannot see either.
 *
 * So an edit card carries its arithmetic: the value on the file, and the value
 * proposed. Both, side by side, before the button. This is the one thing that
 * does not belong behind the disclosure with the reasoning — it IS the
 * decision.
 *
 * Nothing here reads a model's prose. Every "from" comes from the project and
 * every "to" from the card's own payload, so a card whose rationale disagrees
 * with its payload is caught by the row rather than believed.
 */

import { CHECK_RESULT_LABEL, LIFECYCLE_STAGE_LABEL } from './catalogs';
import { checkFieldReading, checkSchema } from './operations';
import type { ChatProposal, CheckFieldValue, DdProject } from './types';

/** One field a card would change. `from` absent means the file holds nothing yet. */
export interface ProposalChange {
  label: string;
  /** The value on the file today, already formatted. Absent when unset. */
  from?: string;
  /** What approving would make it. */
  to: string;
  /** The unit, when the field carries one — shown once, not on both sides. */
  unit?: string;
}

/** Long prose is compared by its opening, not dumped twice into a card. */
function clip(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function show(value: CheckFieldValue['value'] | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) return value.length ? `${value.length} row${value.length === 1 ? '' : 's'}` : undefined;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  return clip(String(value));
}

/**
 * A coordinate, written the way it is read out.
 *
 * Its own formatter because the generic one stringifies an object, and a card
 * whose whole job is to show a person the number before they approve it
 * cannot show them `[object Object]`.
 */
function showPoint(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const point = value as { lat?: unknown; lng?: unknown };
  if (typeof point.lat !== 'number' || typeof point.lng !== 'number') return undefined;
  return `${point.lat}, ${point.lng}`;
}

/** Fields on a project a `patch_project` card may touch, with readable names. */
const PROJECT_FIELDS: Array<{
  key: keyof DdProject;
  label: string;
  unit?: string;
  format?: (value: unknown) => string | undefined;
}> = [
  { key: 'name', label: 'Name' },
  { key: 'owner', label: 'Owner' },
  { key: 'developer', label: 'Developer' },
  { key: 'city', label: 'City' },
  { key: 'location', label: 'Location' },
  { key: 'jurisdiction', label: 'Jurisdiction' },
  // Where the property is. Both feed the geocoder and every register search,
  // so a card that sets one is exactly the kind a person should see before
  // approving rather than after.
  { key: 'siteAddress', label: 'Site address' },
  { key: 'parcelId', label: 'Parcel' },
  { key: 'siteCoordinate', label: 'Pin', format: showPoint },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'landAreaSqm', label: 'Land area', unit: 'sqm' },
  { key: 'builtUpAreaSqm', label: 'Built-up area', unit: 'sqm' },
  { key: 'budget', label: 'Budget', unit: '₹' },
];

/**
 * The rows an edit card should show, or an empty list for a card that creates.
 *
 * Returning nothing is the common and correct answer: most cards add a record
 * rather than move a value, and a diff of nothing against something is just
 * the title again.
 */
export function proposalChanges(project: DdProject, proposal: ChatProposal): ProposalChange[] {
  const payload = proposal.payload as Record<string, unknown>;
  const out: ProposalChange[] = [];

  if (proposal.kind === 'record_check_fields') {
    const checkId = typeof payload.checkId === 'string' ? payload.checkId : undefined;
    const values = (payload.values ?? {}) as Record<string, unknown>;
    const hit = checkId ? findCheckSafely(project, checkId) : undefined;
    if (!hit) return out;
    const defs = checkSchema(hit.check).fields;
    const reading = checkFieldReading(hit.check);
    for (const [key, next] of Object.entries(values)) {
      const def = defs.find((row) => row.key === key);
      const to = show(next as CheckFieldValue['value']);
      if (to === undefined) continue;
      out.push({
        label: def?.label ?? key,
        from: show(reading.values[key]?.value),
        to,
        unit: def?.unit,
      });
    }
    return out;
  }

  if (proposal.kind === 'record_check') {
    const checkId = typeof payload.checkId === 'string' ? payload.checkId : undefined;
    const hit = checkId ? findCheckSafely(project, checkId) : undefined;
    const result = typeof payload.result === 'string' ? payload.result : undefined;
    if (!hit || !result) return out;
    const to = CHECK_RESULT_LABEL[result as keyof typeof CHECK_RESULT_LABEL] ?? result;
    const from = CHECK_RESULT_LABEL[hit.check.result];
    if (from !== to) out.push({ label: 'Result', from, to });
    return out;
  }

  if (proposal.kind === 'change_stage') {
    const stage = typeof payload.stage === 'string' ? payload.stage : undefined;
    if (!stage) return out;
    const to = LIFECYCLE_STAGE_LABEL[stage as keyof typeof LIFECYCLE_STAGE_LABEL] ?? stage;
    const from = LIFECYCLE_STAGE_LABEL[project.currentStage];
    if (from !== to) out.push({ label: 'Stage', from, to });
    return out;
  }

  if (proposal.kind === 'patch_project') {
    for (const field of PROJECT_FIELDS) {
      if (!(field.key in payload)) continue;
      const as = field.format ?? ((v: unknown) => show(v as CheckFieldValue['value']));
      const to = as(payload[field.key]);
      if (to === undefined) continue;
      const from = as(project[field.key]);
      if (from === to) continue;
      out.push({ label: field.label, from, to, unit: field.unit });
    }
    return out;
  }

  if (proposal.kind === 'edit_report') {
    const blockId = typeof payload.blockId === 'string' ? payload.blockId : undefined;
    const text = typeof payload.text === 'string' ? payload.text : undefined;
    if (!blockId || !text) return out;
    const report = project.reports.find((r) => (r.body.blocks ?? []).some((row) => row.id === blockId));
    const block = (report?.body.blocks ?? []).find((row) => row.id === blockId);
    if (!block) return out;
    const from = typeof block.text === 'string' ? clip(block.text) : undefined;
    const to = clip(text);
    if (from !== to) out.push({ label: block.heading || 'Paragraph', from, to });
    return out;
  }

  return out;
}

/** `findCheck` throws for an id this project does not hold; a card must not. */
function findCheckSafely(project: DdProject, checkId: string) {
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      const check = scope.checks.find((c) => c.id === checkId);
      if (check) return { assessment, scope, check };
    }
  }
  return undefined;
}
