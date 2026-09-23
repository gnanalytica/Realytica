/**
 * The dialog that creates a record, from either direction.
 *
 * Opened from a register's own button it is an ordinary form. Opened from a
 * chat card it is the same form with the model's proposal already in it —
 * and the difference between those two situations is the only thing this
 * component adds to `CREATE_SPECS`.
 *
 * ## Why an auto-filled field has to say so
 *
 * A form that opens full of values somebody else chose, rendered exactly like
 * values they typed themselves, does not collect consent — it collects a
 * reflex. The person confirms a screen they have no reason to read, which is
 * the Approve button again with more steps. So a field carrying a proposed
 * value is marked, the count is stated above the form, and the mark comes off
 * the moment the person edits that field, because from then on it is theirs.
 *
 * ## Why it submits the whole draft
 *
 * A chat payload holds more than any form shows: a storage key, extracted
 * quotes with page numbers, the scope and check ids the card was pinned to.
 * The draft starts as the entire payload and is submitted entire, so editing
 * a title cannot silently drop the file the title belongs to.
 */

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { DdProject } from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Modal, SubmitButton, cn, useToast } from '../ui/kit';
import { CREATE_SPECS, type CreateKind, type Draft } from './specs';

export function CreateWizard({
  kind,
  project,
  open,
  /** A chat card's payload. Absent for the register's own button. */
  proposed,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  kind: CreateKind;
  project: DdProject;
  open: boolean;
  proposed?: Record<string, unknown>;
  /**
   * What the surrounding page already knows — the assessment a register is
   * filtered to, the asset a pane is about.
   *
   * Not marked as proposed, because nobody proposed it: it is the context the
   * person is already standing in, and flagging it for review would ask them
   * to confirm where they are.
   */
  initial?: Draft;
  busy?: boolean;
  onClose: () => void;
  /** The confirmed draft — either created directly or committed as the card. */
  onSubmit: (draft: Draft) => void;
}) {
  if (!open) return null;
  return (
    <WizardBody
      // Remounts when the subject changes, so a second card does not open on
      // the first one's draft.
      key={kind}
      kind={kind}
      project={project}
      proposed={proposed}
      initial={initial}
      busy={busy}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

function WizardBody({
  kind,
  project,
  proposed,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  kind: CreateKind;
  project: DdProject;
  proposed?: Record<string, unknown>;
  initial?: Draft;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const spec = CREATE_SPECS[kind];
  const [draft, setDraft] = useState<Draft>(() => ({ ...spec.blank(project), ...(initial ?? {}), ...(proposed ?? {}) }));
  // Which keys arrived from the model and have not been touched since.
  const [fromModel, setFromModel] = useState<Set<string>>(
    () => new Set(Object.keys(proposed ?? {}).filter((k) => (proposed as Draft)[k] !== undefined)),
  );

  const set = (patch: Draft) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setFromModel((prev) => {
      const next = new Set(prev);
      for (const key of Object.keys(patch)) next.delete(key);
      return next;
    });
  };

  const needs = spec.needs(draft);
  // Only the marks a field actually shows. A payload carries keys with no
  // control behind them — a storage key is not something anybody reviewed —
  // and counting those would claim a scrutiny the form never offered.
  const shown = useMemo(
    () => [...fromModel].filter((key) => REVIEWABLE.has(key)),
    [fromModel],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={spec.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <SubmitButton busy={busy} needs={needs} onClick={() => onSubmit(draft)}>
            {spec.verb}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-3">
        {proposed ? (
          <p
            className={cn(
              'flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12px] leading-relaxed',
              shown.length > 0 ? 'bg-brand-soft text-brand' : 'bg-sunken text-ink-secondary',
            )}
          >
            <Sparkles size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {shown.length > 0
                ? `${shown.length} ${shown.length === 1 ? 'field was' : 'fields were'} filled in from the conversation. Change anything that is wrong — nothing is filed until you press ${spec.verb}.`
                : `Nothing is filed until you press ${spec.verb}.`}
            </span>
          </p>
        ) : null}
        <spec.Fields draft={draft} set={set} project={project} />
      </div>
    </Modal>
  );
}

/**
 * Payload keys a form actually puts a control behind.
 *
 * The union of every spec's fields. Kept as a list rather than derived,
 * because deriving it would mean rendering each form to find out.
 */
const REVIEWABLE = new Set([
  'name',
  'assetType',
  'uniclassCode',
  'parentId',
  'currentStage',
  'title',
  'kind',
  'source',
  'iso19650',
  'description',
  'severity',
  'discipline',
  'cause',
  'category',
  'probability',
  'impactScore',
  'owner',
  'dueDate',
  'decisionType',
  'decisionMaker',
  'rationale',
]);

/**
 * A register's own way in: the button, and the same dialog behind it.
 *
 * Exists so that a register cannot accidentally grow a second version of a
 * form the copilot also fills. Adding a field to a spec adds it to both
 * paths, and there is nowhere for them to drift apart.
 */
export function CreateButton({
  kind,
  project,
  onCreated,
  initial,
  variant = 'secondary',
  label,
}: {
  kind: CreateKind;
  project: DdProject;
  onCreated: (project: DdProject) => void;
  /** Context the page already holds — see `CreateWizard`. */
  initial?: Draft;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Overrides the spec's own wording, where a page calls it something else. */
  label?: string;
}) {
  const spec = CREATE_SPECS[kind];
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(draft: Draft) {
    setBusy(true);
    try {
      await spec.create(project.id, draft);
      onCreated(await api.getProject(project.id));
      setOpen(false);
      toast(spec.filed, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : `Could not ${spec.verb.toLowerCase()} that`, 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label ?? spec.openLabel}
      </Button>
      <CreateWizard
        kind={kind}
        project={project}
        open={open}
        initial={initial}
        busy={busy}
        onClose={() => setOpen(false)}
        onSubmit={(draft) => void submit(draft)}
      />
    </>
  );
}
