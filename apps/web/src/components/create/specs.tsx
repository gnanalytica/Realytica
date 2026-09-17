/**
 * One form per creatable record, used by both ways of creating it.
 *
 * ## The problem this exists for
 *
 * Every register grew its own "Add …" modal, and the copilot grew its own way
 * of creating the same records: a card in the chat with an Approve button and
 * a payload nobody could see. Two paths to one row in one register, and they
 * had nothing in common — not the fields, not the validation, not the
 * vocabulary. Approving a card was the only write in the product that
 * happened without anybody reading what was about to be written.
 *
 * So the form moved here, and both paths open it. The register's button opens
 * it blank. A chat card opens it filled in with what the model proposed, and
 * the person edits and confirms. The card stops being a promise and becomes a
 * draft — which is the only honest thing it ever was.
 *
 * ## Why the draft is untyped
 *
 * A chat payload really is `Record<string, unknown>`: it arrives as JSON from
 * a model, is stored as JSON, and is coerced at the point it is applied. A
 * draft is that same object part-way through being corrected by a person, so
 * it has the same type, and the readers below do the narrowing at the edge.
 * Typing it as `CreateFindingInput` would have meant asserting a shape the
 * data does not have yet, one layer earlier than the engine already asserts
 * it — two places to be wrong instead of one.
 *
 * The whole draft is submitted, not just the rendered fields. A `file_evidence`
 * card carries a storage key, quotes and page numbers that no form shows and
 * every one of which must survive the round trip.
 */

import type { ReactNode } from 'react';
import {
  ACTION_KIND_LABEL,
  DECISION_TYPE_LABEL,
  EVIDENCE_KIND_LABEL,
  IMPACT_TYPE_LABEL,
  LIFECYCLE_STAGES,
  SCOPE_LABEL,
  SEVERITY_LABEL,
  UNICLASS_ENTITIES,
  iso19650Name,
  looksLikeUniclassCode,
  type ActionKind,
  type CreateActionInput,
  type CreateAssetInput,
  type CreateDecisionInput,
  type CreateEvidenceInput,
  type CreateFindingInput,
  type CreateRiskInput,
  type DdProject,
  type DecisionType,
  type EvidenceKind,
  type FindingSeverity,
  type ImpactScore,
  type Iso19650Ref,
  type LifecycleStage,
  type Probability,
  type RiskImpactType,
  type ScopeKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Field, Input, Select, Textarea } from '../ui/kit';
import { OwnerInput } from '../OwnerInput';

/** The records a chat card can propose and a register can add. */
export type CreateKind = 'add_asset' | 'file_evidence' | 'add_finding' | 'add_risk' | 'add_action' | 'add_decision';

export type Draft = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Readers — the narrowing, at the edge, once                          */
/* ------------------------------------------------------------------ */

export function text(draft: Draft, key: string): string {
  const value = draft[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/** A value from a closed set, or the fallback when the model offered nonsense. */
function choice<T extends string>(draft: Draft, key: string, allowed: readonly T[], fallback: T): T {
  const value = draft[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function ref(draft: Draft, key: string): Iso19650Ref {
  const value = draft[key];
  return value && typeof value === 'object' ? (value as Iso19650Ref) : {};
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const PROBABILITIES = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'] as const;
const SCOPE_KEYS = Object.keys(SCOPE_LABEL) as ScopeKey[];
const EVIDENCE_KINDS = Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[];
const IMPACT_TYPES = Object.keys(IMPACT_TYPE_LABEL) as RiskImpactType[];
const ACTION_KINDS = Object.keys(ACTION_KIND_LABEL) as ActionKind[];
const DECISION_TYPES = Object.keys(DECISION_TYPE_LABEL) as DecisionType[];

/* ------------------------------------------------------------------ */
/* The spec                                                            */
/* ------------------------------------------------------------------ */

export interface FieldsProps {
  draft: Draft;
  /** Merges a patch into the draft and marks those keys as the person's own. */
  set: (patch: Draft) => void;
  project: DdProject;
}

export interface CreateSpec {
  /** The dialog's heading, and what the chat card's button offers to open. */
  title: string;
  /** The submit's verb. */
  verb: string;
  /** What the register's own button says. */
  openLabel: string;
  /** Said once it is filed. */
  filed: string;
  /** A draft with nothing in it but the defaults a person would not think to set. */
  blank: (project: DdProject) => Draft;
  /** Labels of the fields still required, worded exactly as the labels are. */
  needs: (draft: Draft) => string[];
  Fields: (props: FieldsProps) => ReactNode;
  /** The register's path: straight to the create endpoint. */
  create: (projectId: string, draft: Draft) => Promise<unknown>;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

const asset: CreateSpec = {
  title: 'Add asset / component',
  verb: 'Add',
  openLabel: 'Add asset',
  filed: 'Asset added',
  blank: (project) => ({ assetType: 'Residential tower', currentStage: project.currentStage }),
  needs: (d) => (text(d, 'name').trim() ? [] : ['Name']),
  Fields: ({ draft, set, project }) => (
    <>
      <Field label="Name" required>
        <Input value={text(draft, 'name')} onChange={(e) => set({ name: e.target.value })} placeholder="Tower A" />
      </Field>
      <Field label="Asset type">
        <Input value={text(draft, 'assetType')} onChange={(e) => set({ assetType: e.target.value })} />
      </Field>
      {/* A datalist rather than a dropdown: the suggestions are a working
          subset of a table with thousands of rows, maintained at source, so
          the field has to take a code this build has never seen. */}
      <Field
        label="Uniclass code"
        hint={
          text(draft, 'uniclassCode').trim() &&
          !looksLikeUniclassCode(text(draft, 'uniclassCode')) &&
          !UNICLASS_ENTITIES.some((e) => e.code === text(draft, 'uniclassCode').trim())
            ? 'That does not look like a Uniclass code (e.g. En_20_20_53). Kept as typed.'
            : 'Optional. What a cost consultant or a BIM model calls this — beside your own asset type, not instead of it.'
        }
      >
        <Input
          list="uniclass-entities"
          value={text(draft, 'uniclassCode')}
          onChange={(e) => set({ uniclassCode: e.target.value })}
          placeholder="En_20_20_53"
        />
        <datalist id="uniclass-entities">
          {UNICLASS_ENTITIES.map((e) => (
            <option key={e.code} value={e.code}>{e.title}</option>
          ))}
        </datalist>
      </Field>
      <Field label="Parent" hint="Leave empty for a top-level asset.">
        <Select value={text(draft, 'parentId')} onChange={(e) => set({ parentId: e.target.value })}>
          <option value="">None — top level</option>
          {project.assets.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Stage">
        <Select
          value={choice<LifecycleStage>(draft, 'currentStage', LIFECYCLE_STAGES.map((s) => s.key), project.currentStage)}
          onChange={(e) => set({ currentStage: e.target.value })}
        >
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </Select>
      </Field>
    </>
  ),
  create: (projectId, d) =>
    api.addAsset(projectId, {
      name: text(d, 'name'),
      assetType: text(d, 'assetType') || 'Land',
      uniclassCode: text(d, 'uniclassCode').trim() || undefined,
      uniclassTitle: UNICLASS_ENTITIES.find((e) => e.code === text(d, 'uniclassCode').trim())?.title,
      parentId: text(d, 'parentId') || undefined,
      currentStage: (d.currentStage as LifecycleStage | undefined) ?? undefined,
    } satisfies CreateAssetInput),
};

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

const evidence: CreateSpec = {
  title: 'Record evidence',
  verb: 'Add',
  openLabel: 'Record an item',
  filed: 'Evidence recorded',
  blank: () => ({ kind: 'document', status: 'received' }),
  needs: (d) => (text(d, 'title').trim() ? [] : ['Title']),
  Fields: ({ draft, set, project }) => {
    const iso = ref(draft, 'iso19650');
    return (
      <>
        {/* A card raised from an upload already has the file. Saying so stops
            the form reading as though it were asking for one. */}
        {text(draft, 'fileName') ? (
          <p className="rounded-md bg-sunken px-2.5 py-2 text-[12px] text-ink-secondary">
            Filed against <span className="font-medium text-ink">{text(draft, 'fileName')}</span>
            {typeof draft.pages === 'number' ? ` · ${draft.pages} pages` : ''}
          </p>
        ) : null}
        <Field label="Title" required>
          <Input value={text(draft, 'title')} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Kind">
          <Select value={choice<EvidenceKind>(draft, 'kind', EVIDENCE_KINDS, 'document')} onChange={(e) => set({ kind: e.target.value })}>
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>{EVIDENCE_KIND_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Input value={text(draft, 'source')} onChange={(e) => set({ source: e.target.value })} />
        </Field>
        {/* Every part optional, and the name still forms. A pack collects
            documents from a dozen sources and most arrive with none of this
            known. Unknown parts become the standard's own XX. */}
        <Field
          label="Document reference (ISO 19650)"
          hint={`Optional, part by part. This one would be named ${iso19650Name(project.reference, iso)}.`}
        >
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['originator', 'Originator'],
                ['volume', 'Volume'],
                ['level', 'Level'],
                ['type', 'Type (DR/SP/RP)'],
                ['role', 'Role (A/C/S/K/M)'],
                ['number', 'Number'],
              ] as [keyof Iso19650Ref, string][]
            ).map(([key, label]) => (
              <Input
                key={key}
                placeholder={label}
                value={iso[key] ?? ''}
                onChange={(e) => set({ iso19650: { ...iso, [key]: e.target.value } })}
              />
            ))}
          </div>
        </Field>
      </>
    );
  },
  create: (projectId, d) =>
    api.addEvidence(projectId, {
      title: text(d, 'title'),
      kind: choice<EvidenceKind>(d, 'kind', EVIDENCE_KINDS, 'document'),
      source: text(d, 'source') || undefined,
      status: 'received',
      assessmentIds: (d.assessmentIds as string[] | undefined) ?? [],
      iso19650: Object.values(ref(d, 'iso19650')).some(Boolean) ? ref(d, 'iso19650') : undefined,
    } satisfies CreateEvidenceInput),
};

/* ------------------------------------------------------------------ */
/* Findings, risks, actions, decisions                                 */
/* ------------------------------------------------------------------ */

const finding: CreateSpec = {
  title: 'Add finding',
  verb: 'Add',
  openLabel: 'Add finding',
  filed: 'Finding added to the project register',
  blank: () => ({ severity: 'medium', discipline: 'technical' }),
  needs: (d) => [
    ...(text(d, 'title').trim() ? [] : ['Title']),
    ...(text(d, 'description').trim() ? [] : ['Description']),
  ],
  Fields: ({ draft, set }) => (
    <>
      <Field label="Title" required>
        <Input value={text(draft, 'title')} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Description" required>
        <Textarea value={text(draft, 'description')} onChange={(e) => set({ description: e.target.value })} rows={3} />
      </Field>
      <Field label="Severity">
        <Select value={choice<FindingSeverity>(draft, 'severity', SEVERITIES, 'medium')} onChange={(e) => set({ severity: e.target.value })}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Discipline">
        <Select value={choice<ScopeKey>(draft, 'discipline', SCOPE_KEYS, 'technical')} onChange={(e) => set({ discipline: e.target.value })}>
          {SCOPE_KEYS.map((k) => (
            <option key={k} value={k}>{SCOPE_LABEL[k]}</option>
          ))}
        </Select>
      </Field>
    </>
  ),
  create: (projectId, d) =>
    api.addFinding(projectId, {
      title: text(d, 'title'),
      description: text(d, 'description'),
      severity: choice<FindingSeverity>(d, 'severity', SEVERITIES, 'medium'),
      discipline: choice<ScopeKey>(d, 'discipline', SCOPE_KEYS, 'technical'),
    } satisfies CreateFindingInput),
};

const risk: CreateSpec = {
  title: 'Add risk',
  verb: 'Add',
  openLabel: 'Add risk',
  filed: 'Risk added',
  blank: () => ({ category: 'cost', probability: 'possible', impactScore: 3, materiality: 'high' }),
  needs: (d) => [
    ...(text(d, 'title').trim() ? [] : ['Title']),
    ...(text(d, 'cause').trim() ? [] : ['Cause']),
  ],
  Fields: ({ draft, set }) => (
    <>
      <Field label="Title" required>
        <Input value={text(draft, 'title')} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Cause" required>
        <Textarea value={text(draft, 'cause')} onChange={(e) => set({ cause: e.target.value })} rows={3} />
      </Field>
      <Field label="Impact category">
        <Select
          value={choice<RiskImpactType>(draft, 'category', IMPACT_TYPES, 'cost')}
          /* `impactType` is the same answer under the name the engine reads;
             they have never been allowed to differ. */
          onChange={(e) => set({ category: e.target.value, impactType: e.target.value })}
        >
          {IMPACT_TYPES.map((k) => (
            <option key={k} value={k}>{IMPACT_TYPE_LABEL[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Probability">
        <Select value={choice<Probability>(draft, 'probability', PROBABILITIES, 'possible')} onChange={(e) => set({ probability: e.target.value })}>
          {PROBABILITIES.map((p) => (
            <option key={p} value={p}>{p.replaceAll('_', ' ')}</option>
          ))}
        </Select>
      </Field>
      <Field label="Impact score">
        <Select value={String(draft.impactScore ?? 3)} onChange={(e) => set({ impactScore: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Select>
      </Field>
    </>
  ),
  create: (projectId, d) => {
    const category = choice<RiskImpactType>(d, 'category', IMPACT_TYPES, 'cost');
    return api.addRisk(projectId, {
      title: text(d, 'title'),
      cause: text(d, 'cause'),
      category,
      impactType: category,
      probability: choice<Probability>(d, 'probability', PROBABILITIES, 'possible'),
      impactScore: (Number(d.impactScore) || 3) as ImpactScore,
      materiality: choice<FindingSeverity>(d, 'materiality', SEVERITIES, 'high'),
    } satisfies CreateRiskInput);
  },
};

const action: CreateSpec = {
  title: 'Add action',
  verb: 'Add',
  openLabel: 'Add action',
  filed: 'Action added',
  blank: (project) => ({ kind: 'remediation', priority: 'high', owner: project.owner ?? '' }),
  needs: (d) => [
    ...(text(d, 'title').trim() ? [] : ['Title']),
    ...(text(d, 'owner').trim() ? [] : ['Owner']),
  ],
  Fields: ({ draft, set, project }) => (
    <>
      <Field label="Title" required>
        <Input value={text(draft, 'title')} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Owner" required>
        <OwnerInput value={text(draft, 'owner')} onChange={(next) => set({ owner: next })} project={project} />
      </Field>
      <Field label="Kind">
        <Select value={choice<ActionKind>(draft, 'kind', ACTION_KINDS, 'remediation')} onChange={(e) => set({ kind: e.target.value })}>
          {ACTION_KINDS.map((k) => (
            <option key={k} value={k}>{ACTION_KIND_LABEL[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Due date">
        <Input type="date" value={text(draft, 'dueDate')} onChange={(e) => set({ dueDate: e.target.value })} />
      </Field>
    </>
  ),
  create: (projectId, d) =>
    api.addAction(projectId, {
      title: text(d, 'title'),
      kind: choice<ActionKind>(d, 'kind', ACTION_KINDS, 'remediation'),
      owner: text(d, 'owner'),
      priority: choice<FindingSeverity>(d, 'priority', SEVERITIES, 'high'),
      dueDate: text(d, 'dueDate') || undefined,
    } satisfies CreateActionInput),
};

const decision: CreateSpec = {
  title: 'Record decision',
  verb: 'Save',
  openLabel: 'Record decision',
  filed: 'Decision recorded',
  blank: () => ({ decisionType: 'proceed' }),
  needs: (d) => [
    ...(text(d, 'title').trim() ? [] : ['Title']),
    ...(text(d, 'decisionMaker').trim() ? [] : ['Decision maker']),
    ...(text(d, 'rationale').trim() ? [] : ['Rationale']),
  ],
  Fields: ({ draft, set }) => (
    <>
      <Field label="Title" required>
        <Input value={text(draft, 'title')} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Type">
        <Select value={choice<DecisionType>(draft, 'decisionType', DECISION_TYPES, 'proceed')} onChange={(e) => set({ decisionType: e.target.value })}>
          {DECISION_TYPES.map((k) => (
            <option key={k} value={k}>{DECISION_TYPE_LABEL[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Decision maker" required>
        <Input value={text(draft, 'decisionMaker')} onChange={(e) => set({ decisionMaker: e.target.value })} />
      </Field>
      <Field label="Rationale" required>
        <Textarea value={text(draft, 'rationale')} onChange={(e) => set({ rationale: e.target.value })} rows={3} />
      </Field>
    </>
  ),
  create: (projectId, d) =>
    api.addDecision(projectId, {
      title: text(d, 'title'),
      decisionType: choice<DecisionType>(d, 'decisionType', DECISION_TYPES, 'proceed'),
      decisionMaker: text(d, 'decisionMaker'),
      rationale: text(d, 'rationale'),
    } satisfies CreateDecisionInput),
};

export const CREATE_SPECS: Record<CreateKind, CreateSpec> = {
  add_asset: asset,
  file_evidence: evidence,
  add_finding: finding,
  add_risk: risk,
  add_action: action,
  add_decision: decision,
};

/**
 * Whether a chat card of this kind has a form behind it.
 *
 * `request_evidence` files an action and shares the action's form. The kinds
 * that are not here are not creations — a stage change, a check result, a
 * report edit — and they already show their own before-and-after, which is
 * the right thing for a change and the wrong thing for a blank form.
 */
export function specForProposal(kind: string): { kind: CreateKind; spec: CreateSpec } | null {
  const key = kind === 'request_evidence' ? 'add_action' : kind;
  const spec = CREATE_SPECS[key as CreateKind];
  return spec ? { kind: key as CreateKind, spec } : null;
}
