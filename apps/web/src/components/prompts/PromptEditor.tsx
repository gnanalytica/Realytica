import { useEffect, useMemo, useState } from 'react';
import { Check, GitBranch, Save, ShieldAlert, TriangleAlert, XCircle } from 'lucide-react';
import type { PromptDescriptor, PromptInvariantCheck, PromptVersion } from '@realytica/shared';
import { Badge, Button, Callout, Checkbox, Field, Input, Textarea, cn } from '../ui/kit';
import {
  GuardrailWaiver,
  InvariantList,
  UNGUARDED_CONSEQUENCE,
  droppedEvaluations,
  evaluateInvariants,
  missingVariables,
  toChecks,
  unassessedEvaluations,
} from './InvariantList';

/**
 * Write a new version of a prompt, or rewrite a custom one.
 *
 * The design rule here is the whole point of the feature: **the guardrail
 * readout updates on every keystroke.** Someone deleting the never-invent rule
 * watches that guarantee go from Kept to Dropped *as the line disappears*, not
 * after they have saved and moved on. Checking on save would report history;
 * checking live is a warning.
 *
 * Two further rules follow from what a prompt is:
 *
 * - **A missing placeholder is an error, not a warning.** A version that drops
 *   `{{caseContext}}` renders a blank where a case fact belongs, and the run
 *   then fails in a way that looks like a model problem — someone spends a day
 *   debugging the wrong layer. Save is blocked outright.
 * - **A dropped guardrail is allowed, but never quietly.** Saving one requires
 *   ticking each guarantee being given up and typing a phrase that names them.
 *   An operator may genuinely need to rewrite a preamble; nobody may do it by
 *   accident.
 */

export interface PromptDraft {
  label: string;
  content: string;
  notes?: string;
  /** Whether this version should be in force once saved. */
  activate: boolean;
  /**
   * The editor's own evaluation, frozen at save time.
   *
   * Sent so a store with no checker of its own still records something honest.
   * Where the API computes its own checks, its answer wins and the descriptor
   * it returns is what the page renders — the prediction made here is never
   * displayed as the stored result.
   */
  invariants: PromptInvariantCheck[];
}

export interface PromptEditorProps {
  prompt: PromptDescriptor;
  /** The version this draft started from. In `edit` mode it is also the version being overwritten. */
  base: PromptVersion;
  mode: 'new' | 'edit';
  saving?: boolean;
  onSave: (draft: PromptDraft) => void;
  onCancel: () => void;
  /** Reported on every change so the page can guard navigation away from unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Offered when an in-place edit starts changing content — the safer route out. */
  onConvertToNewVersion?: () => void;
  className?: string;
}

function nextVersionNumber(prompt: PromptDescriptor): number {
  return prompt.versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

export function PromptEditor({
  prompt,
  base,
  mode,
  saving,
  onSave,
  onCancel,
  onDirtyChange,
  onConvertToNewVersion,
  className,
}: PromptEditorProps) {
  const initialLabel = mode === 'edit' ? base.label : `Based on v${base.version}`;
  const initialNotes = mode === 'edit' ? base.notes ?? '' : '';

  const [label, setLabel] = useState(initialLabel);
  const [notes, setNotes] = useState(initialNotes);
  const [content, setContent] = useState(base.content);
  const [activate, setActivate] = useState(mode === 'edit' ? base.id === prompt.activeVersionId : true);
  const [waiverOpen, setWaiverOpen] = useState(false);

  const evaluations = useMemo(() => evaluateInvariants(prompt, content), [prompt, content]);
  const dropped = droppedEvaluations(evaluations);
  const unassessed = unassessedEvaluations(evaluations);
  const missing = missingVariables(prompt, content);

  const contentChanged = content !== base.content;
  const dirty = contentChanged || label !== initialLabel || notes !== initialNotes;
  const blocked = missing.length > 0 || label.trim() === '' || content.trim() === '';

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // A browser-level guard for the case the in-app one cannot see: a reload, a
  // closed tab, a typed URL. Unsaved prompt text is not recoverable.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const lineCount = content === '' ? 0 : content.split('\n').length;

  const commit = () => {
    onSave({
      label: label.trim(),
      content,
      notes: notes.trim() === '' ? undefined : notes.trim(),
      activate,
      invariants: toChecks(evaluations),
    });
  };

  const attemptSave = () => {
    if (blocked) return;
    if (dropped.length > 0) setWaiverOpen(true);
    else commit();
  };

  const saveLabel = mode === 'edit' ? `Save over v${base.version}` : `Save as v${nextVersionNumber(prompt)}`;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-semibold text-ink">
          {mode === 'edit' ? `Editing v${base.version}` : `New version from v${base.version}`}
        </h3>
        <span className="font-mono text-micro text-ink-muted">{prompt.key}</span>
        {dirty ? (
          <Badge tone="warning" className="ml-auto">
            Unsaved changes
          </Badge>
        ) : (
          <span className="ml-auto text-mini text-ink-muted">No changes yet</span>
        )}
      </div>

      {mode === 'edit' && contentChanged ? (
        <Callout tone="warning" title="This rewrites text a run may already be attributed to">
          <p>
            v{base.version} has a content hash that past runs recorded. Overwriting it means those runs point at text
            that no longer exists as they saw it, and "the extraction changed last Tuesday" stops being answerable.
            Saving a new version instead keeps the record intact.
          </p>
          {onConvertToNewVersion ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              icon={<GitBranch size={13} />}
              onClick={onConvertToNewVersion}
            >
              Make this a new version instead
            </Button>
          ) : null}
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" required htmlFor="prompt-version-label" hint="How this version is identified in the history.">
          <Input
            id="prompt-version-label"
            data-testid="editor-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Tighter extraction instructions"
          />
        </Field>
        <Field label="Notes" htmlFor="prompt-version-notes" hint="Why this change was made. Read by whoever inherits it.">
          <Input
            id="prompt-version-notes"
            data-testid="editor-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reduced hedging on encumbrance wording"
          />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor="prompt-content" className="text-xs font-medium text-ink-secondary">
              Prompt text
            </label>
            <span className="tabular text-mini text-ink-muted">
              {lineCount} lines · {content.length} characters
            </span>
          </div>
          <Textarea
            id="prompt-content"
            data-testid="editor-content"
            value={content}
            spellCheck={false}
            onChange={(e) => setContent(e.target.value)}
            className="h-[clamp(20rem,58vh,52rem)] resize-y font-mono text-[12px] leading-[1.65]"
          />
          <p className="mt-1 text-mini leading-relaxed text-ink-muted">
            Placeholders may be written <span className="font-mono">{'{{name}}'}</span> or{' '}
            <span className="font-mono">{'{name}'}</span>; both are recognised. Long prompts are expected — drag the
            corner to grow this box.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <h4 className="mb-1.5 text-mini font-semibold uppercase tracking-[0.07em] text-ink-muted">
              Declared placeholders
            </h4>
            {prompt.variables.length === 0 ? (
              <p className="text-xs text-ink-muted">This prompt declares no placeholders.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {prompt.variables.map((name) => {
                  const absent = missing.includes(name);
                  return (
                    <Badge
                      key={name}
                      tone={absent ? 'critical' : 'good'}
                      icon={absent ? <XCircle size={11} /> : <Check size={11} />}
                      className="font-mono"
                      data-testid={`variable-${name}`}
                    >
                      {`{{${name}}}`}
                    </Badge>
                  );
                })}
              </div>
            )}
            {missing.length > 0 ? (
              <div
                className="mt-2 rounded-lg bg-critical/10 p-2.5 ring-1 ring-inset ring-critical/40"
                data-testid="missing-variable-error"
              >
                <p className="flex items-start gap-1.5 text-xs font-semibold text-critical">
                  <XCircle size={13} className="mt-0.5 shrink-0" />
                  {missing.length} declared placeholder{missing.length > 1 ? 's are' : ' is'} missing — this cannot be
                  saved
                </p>
                <p className="mt-1 text-mini leading-relaxed text-ink-secondary">
                  Without {missing.map((m) => `{{${m}}}`).join(', ')} the rendered prompt has a hole where a case fact
                  belongs. The model answers around it and the run fails in a way that looks like a model problem
                  rather than a template one. This is blocked rather than warned about for that reason.
                </p>
              </div>
            ) : null}
          </div>

          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-mini font-semibold uppercase tracking-[0.07em] text-ink-muted">
              Guardrails
              <span className="font-normal normal-case tracking-normal text-ink-muted">(checked as you type)</span>
            </h4>
            <InvariantList evaluations={evaluations} />
          </div>

          {dropped.length > 0 ? (
            <div
              className="rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40"
              data-testid="editor-dropped-banner"
            >
              <p className="flex items-start gap-1.5 text-xs font-semibold text-critical">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                This draft drops {dropped.length} guardrail{dropped.length > 1 ? 's' : ''}
              </p>
              <p className="mt-1 text-mini leading-relaxed text-ink-secondary">{UNGUARDED_CONSEQUENCE}</p>
            </div>
          ) : unassessed.length > 0 ? (
            <Callout
              tone="warning"
              title={`${unassessed.length} guardrail${unassessed.length > 1 ? 's' : ''} cannot be checked here`}
            >
              Saving records {unassessed.length > 1 ? 'them' : 'it'} as unmet — an unchecked guarantee is treated as
              absent rather than assumed — until a registry that can check {unassessed.length > 1 ? 'them' : 'it'} says
              otherwise.
            </Callout>
          ) : (
            <div className="rounded-lg bg-good/10 p-3 ring-1 ring-inset ring-good/35">
              <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--status-good-text)]">
                <Check size={13} className="mt-0.5 shrink-0" />
                Every declared guardrail is still present in this draft.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
        <Checkbox
          checked={activate}
          onChange={setActivate}
          label={<span className="text-xs">Make this version active on save</span>}
        />
        {activate && dropped.length > 0 ? (
          <span className="flex items-center gap-1 text-mini font-medium text-critical">
            <TriangleAlert size={12} /> This puts unguarded text in force immediately.
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={dropped.length > 0 && !blocked ? 'danger' : 'primary'}
            icon={dropped.length > 0 && !blocked ? <ShieldAlert size={14} /> : <Save size={14} />}
            onClick={attemptSave}
            disabled={blocked}
            loading={saving}
            data-testid="editor-save"
            title={
              missing.length > 0
                ? 'A declared placeholder is missing from the text.'
                : label.trim() === ''
                  ? 'A version needs a label.'
                  : undefined
            }
          >
            {dropped.length > 0 && !blocked ? `${saveLabel} anyway…` : saveLabel}
          </Button>
        </div>
      </div>

      <GuardrailWaiver
        open={waiverOpen}
        onClose={() => setWaiverOpen(false)}
        onConfirm={() => {
          setWaiverOpen(false);
          commit();
        }}
        title={`Save ${prompt.label} without ${dropped.length} guardrail${dropped.length > 1 ? 's' : ''}?`}
        lead={`${saveLabel} removes text this prompt is checked for.${activate ? ' It becomes the version in force as soon as it is saved.' : ' It will be saved but not made active.'}`}
        dropped={dropped}
        actionLabel={`${saveLabel} unguarded`}
        busy={saving}
      />
    </div>
  );
}

export default PromptEditor;
