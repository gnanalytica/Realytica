import { useState } from 'react';
import { X } from 'lucide-react';
import { REVIEW_COLUMNS_MAX, REVIEW_PAPER_KINDS, REVIEW_QUESTION_MAX, reviewValueKeys, reviewValueLabel, type ReviewPlaybookColumn } from '@realytica/shared';
import { Button, Field, Input, Modal, Select, SubmitButton, useToast } from '../ui/kit';
import { reviewApi, type SavedReviewItem } from '../../lib/review-api';

/** A playbook as it is typed, before it is saved. */
export interface PlaybookDraft {
  /** Set when an existing playbook is being changed. */
  id?: string;
  name: string;
  paper?: string;
  columns: ReviewPlaybookColumn[];
}

/** The listed values as a choice, the ones a kind of paper carries first. */
export function ValueOptions({ paper, taken }: { paper?: string; taken: readonly string[] }) {
  const keys = reviewValueKeys(paper).filter((k) => !taken.includes(k.key));
  const carried = keys.filter((k) => k.carried);
  const rest = keys.filter((k) => !k.carried);
  return (
    <>
      <option value="">Choose a value</option>
      {carried.length ? (
        <optgroup label={paper ?? ''}>
          {carried.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label={carried.length ? 'Other papers' : 'Listed values'}>
        {rest.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </optgroup>
    </>
  );
}

/**
 * Names a set of columns for a kind of paper and saves it to the workspace's
 * library, or changes one that is there. Opened from a table, it starts with
 * the columns on screen.
 */
export function PlaybookEditor({ draft, onClose, onSaved }: { draft: PlaybookDraft; onClose: () => void; onSaved: (item: SavedReviewItem) => void }) {
  const toast = useToast();
  const [name, setName] = useState(draft.name);
  const [paper, setPaper] = useState(draft.paper ?? '');
  const [columns, setColumns] = useState<ReviewPlaybookColumn[]>(draft.columns);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const full = columns.length >= REVIEW_COLUMNS_MAX;

  const addQuestion = () => {
    const text = question.replace(/\s+/g, ' ').trim();
    if (text.length < 3) return;
    setColumns((was) => [...was, { kind: 'question', question: text }]);
    setQuestion('');
  };

  async function save() {
    setBusy(true);
    try {
      const input = { kind: 'playbook' as const, name, ...(paper ? { paper } : {}), columns };
      const { item } = draft.id ? await reviewApi.change(draft.id, input) : await reviewApi.save(input);
      toast(draft.id ? 'Playbook changed' : 'Playbook saved to the library', 'good');
      onSaved(item);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The playbook could not be saved', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? 'Change playbook' : 'Save as playbook'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton needs={[...(name.trim() ? [] : ['Name']), ...(columns.length ? [] : ['A column'])]} busy={busy} onClick={() => void save()}>
            {draft.id ? 'Save changes' : 'Save playbook'}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sale deed checklist" maxLength={80} data-autofocus />
        </Field>
        <Field label="Kind of paper">
          <Select value={paper} onChange={(e) => setPaper(e.target.value)}>
            <option value="">Any paper</option>
            {REVIEW_PAPER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-ink-secondary">Columns</p>
          {columns.length ? (
            <ul className="divide-y divide-hairline rounded-lg ring-1 ring-inset ring-[var(--ring)]">
              {columns.map((column, i) => (
                <li key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">{column.kind === 'value' ? (reviewValueLabel(column.key) ?? column.key) : column.question}</span>
                  <span className="shrink-0 pt-0.5 text-[11px] text-ink-muted">{column.kind === 'value' ? 'Listed value' : 'Question'}</span>
                  <button
                    type="button"
                    aria-label="Remove this column"
                    onClick={() => setColumns((was) => was.filter((_, at) => at !== i))}
                    className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-sunken hover:text-ink coarse:p-2"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-muted">None yet.</p>
          )}
        </div>
        {full ? null : (
          <>
            <Field label="Add a listed value">
              <Select
                value=""
                onChange={(e) => {
                  const key = e.target.value;
                  if (key) setColumns((was) => [...was, { kind: 'value', key }]);
                }}
              >
                <ValueOptions paper={paper || undefined} taken={columns.flatMap((c) => (c.kind === 'value' ? [c.key] : []))} />
              </Select>
            </Field>
            <Field label="Add a question">
              <div className="flex gap-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addQuestion();
                    }
                  }}
                  placeholder="Is there a right of way?"
                  maxLength={REVIEW_QUESTION_MAX}
                />
                <Button onClick={addQuestion} disabled={question.trim().length < 3}>
                  Add
                </Button>
              </div>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
