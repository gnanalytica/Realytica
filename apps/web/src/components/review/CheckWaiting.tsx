import { useState } from 'react';
import { AlertTriangle, Check, FileText, Sparkles } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  checkFieldReading,
  formatFieldValue,
  waitingOnCheck,
  type CheckFieldDef,
  type CheckFieldValue,
  type CheckInstance,
  type CheckResult,
  type DdProject,
  type WaitingCheckValue,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { cn, useToast } from '../ui/kit';
import { DecideButtons } from './Decide';

function shown(def: CheckFieldDef | undefined, value: unknown): string {
  if (!def) return String(value);
  return formatFieldValue(def, { value } as CheckFieldValue);
}

/** Where a value was read, as a way to the page. It says which value it stands for, so two of one paper each show their own words. */
function SourceChip({ value, onShow }: { value: WaitingCheckValue; onShow?: (evidenceId: string, value?: WaitingCheckValue) => void }) {
  const text = `${value.source ?? 'Document'}${value.page ? ` · p.${value.page}` : ''}`;
  if (!value.sourceEvidenceId || !onShow) {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-micro text-ink-secondary">{text}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onShow(value.sourceEvidenceId!, value)}
      title="Show it on the page"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-micro text-ink-secondary hover:bg-provenance/10 hover:text-provenance-ink"
    >
      <FileText size={10} aria-hidden />
      {text}
    </button>
  );
}

/**
 * The page's words with the value inside them marked, so a choice between
 * documents is made on what they say. A number is looked for as the page
 * would write it — 11,850 or 11850.
 */
function Quote({ text, value }: { text: string; value: unknown }) {
  const n = typeof value === 'number' ? value : Number.NaN;
  const forms = [String(value), ...(Number.isFinite(n) ? [n.toLocaleString('en-IN'), n.toLocaleString('en-US')] : [])].filter((f) => f.length > 0);
  const lower = text.toLowerCase();
  const hit = forms.map((f) => ({ f, at: lower.indexOf(f.toLowerCase()) })).find((h) => h.at >= 0);
  if (!hit) return <>“{text}”</>;
  return (
    <>
      “{text.slice(0, hit.at)}
      <mark className="rounded-[2px] bg-mark/45 px-0.5 text-ink">{text.slice(hit.at, hit.at + hit.f.length)}</mark>
      {text.slice(hit.at + hit.f.length)}”
    </>
  );
}

/**
 * What waits on one check, decided field by field.
 *
 * A value read off a document waits on the field it answers, with where it
 * came from beside it: accept it onto the check or set it aside. When the
 * documents disagree about a field — two deeds, two extents — the values are
 * laid side by side with their words, and the person carries one; the
 * documents themselves still say what they say. A result suggested for the
 * check, and anything else that names it, wait below with the same two
 * decisions.
 */
export function CheckWaiting({
  project,
  check,
  busy,
  onProject,
  onAccept,
  onSetAside,
  onShowSource,
}: {
  project: DdProject;
  check: CheckInstance;
  busy?: boolean;
  onProject: (next: DdProject) => void;
  /** Accept a waiting card where it sits — a suggested result, a request. */
  onAccept?: (id: string, payload?: Record<string, unknown>) => void;
  onSetAside?: (id: string) => void;
  /** Open the document a value was read from, at that value. */
  onShowSource?: (evidenceId: string, value?: WaitingCheckValue) => void;
}) {
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const waiting = waitingOnCheck(project, check.id);
  const defs = new Map(checkFieldReading(check).defs.map((d) => [d.key, d]));
  const plain = waiting.fields.filter((f) => !f.disagree);
  const contested = waiting.fields.filter((f) => f.disagree);
  const count = waiting.fields.reduce((n, f) => n + f.values.length, 0) + waiting.results.length + waiting.other.length;
  if (!count) return null;
  const disabled = busy || working;

  async function run(work: () => Promise<{ project: DdProject }>, failed: string) {
    setWorking(true);
    try {
      const { project: next } = await work();
      onProject(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : failed, 'critical');
    } finally {
      setWorking(false);
    }
  }
  const decide = (v: WaitingCheckValue, decision: 'accept' | 'reject') =>
    void run(() => api.decideCheckFields(project.id, v.proposalId, { keys: [v.key], decision }), 'That value could not be recorded');
  const pick = (key: string, proposalId: string | null) =>
    void run(() => api.pickCheckValue(project.id, check.id, key, proposalId), 'That value could not be carried');

  return (
    <section data-waiting-anchor="check" className="scroll-mt-3 space-y-2 rounded-xl bg-surface p-3 ring-1 ring-inset ring-provenance/30" aria-label="Waiting on this check">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-provenance-ink">
        <Sparkles size={13} aria-hidden />
        {plain.length || contested.length ? 'Filled from the documents' : 'Suggested for this check'} · {count} to confirm
      </p>

      {plain.map((field) => {
        const v = field.values[0]!;
        const def = defs.get(field.key);
        const label = def?.label ?? field.key;
        return (
          // Sized by the pane, not the window: a viewport breakpoint fires at
          // 1040px on a pane the conversation has left 330px of.
          <div key={field.key} className="flex items-center gap-3 rounded-lg bg-raised px-3 py-2 ring-1 ring-inset ring-provenance/40">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[12px] text-ink-secondary">{label}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-all font-mono text-[14px] font-semibold text-ink">{shown(def, v.value)}</span>
                <SourceChip value={v} onShow={onShowSource} />
              </span>
            </div>
            <DecideButtons label={label} busy={disabled} size="sm" onAccept={() => decide(v, 'accept')} onSetAside={() => decide(v, 'reject')} />
          </div>
        );
      })}

      {contested.map((field) => {
        const def = defs.get(field.key);
        const label = def?.label ?? field.key;
        return (
          <div key={field.key} className="space-y-2 rounded-lg bg-raised p-3 ring-1 ring-inset ring-warning/50">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <AlertTriangle size={14} className="text-[var(--status-warning-text)]" aria-hidden />
              {label}: the documents disagree
            </p>
            <p className="text-[12px] text-ink-secondary">Carry one onto the check. Each document still says what it says.</p>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
              {field.recorded !== undefined ? (
                <div className="flex flex-col gap-2 rounded-lg bg-surface p-3 ring-1 ring-inset ring-good/40">
                  <span className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">On the check now</span>
                  <span className="font-mono text-[18px] font-bold text-ink">{shown(def, field.recorded)}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(field.key, null)}
                    aria-label={`Keep ${shown(def, field.recorded)} for ${label}`}
                    className="inline-flex items-center gap-2 self-start text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
                  >
                    <span className="flex size-8 items-center justify-center rounded-lg text-[var(--status-good-text)] ring-1 ring-inset ring-good/40 hover:bg-good/10">
                      <Check size={16} strokeWidth={2.6} aria-hidden />
                    </span>
                    Keep this one
                  </button>
                </div>
              ) : null}
              {field.values.map((v) => {
                const text = shown(def, v.value);
                return (
                  <div key={v.proposalId} className="flex flex-col gap-2 rounded-lg bg-surface p-3 ring-1 ring-inset ring-[var(--ring)]">
                    <SourceChip value={v} onShow={onShowSource} />
                    {v.fileName ? <span className="-mt-1 truncate text-micro text-ink-muted" title={v.fileName}>{v.fileName}</span> : null}
                    <span className="font-mono text-[18px] font-bold text-ink">{text}</span>
                    {v.quote ? (
                      <p className="rounded-md bg-sunken px-2 py-1.5 font-serif text-[12px] leading-relaxed text-ink-secondary">
                        <Quote text={v.quote} value={v.value} />
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => pick(field.key, v.proposalId)}
                      aria-label={`Carry ${text} from the ${v.source ?? 'document'} for ${label}`}
                      className="inline-flex items-center gap-2 self-start text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50"
                    >
                      <span className="flex size-8 items-center justify-center rounded-lg text-[var(--status-good-text)] ring-1 ring-inset ring-good/40 hover:bg-good/10">
                        <Check size={16} strokeWidth={2.6} aria-hidden />
                      </span>
                      Carry this one
                    </button>
                  </div>
                );
              })}
            </div>
            {field.recorded === undefined ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => pick(field.key, null)}
                className="text-[12px] text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                None of them — leave {label.toLowerCase()} blank
              </button>
            ) : null}
          </div>
        );
      })}

      {[...waiting.results, ...waiting.other].map((item) => {
        const result = item.kind === 'record_check' && typeof item.payload.result === 'string' ? (item.payload.result as CheckResult) : null;
        return (
          <div key={item.id} className={cn('flex items-start gap-2.5 rounded-lg bg-raised px-3 py-2 ring-1 ring-inset ring-provenance/40')}>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                {result ? `Suggested: ${CHECK_RESULT_LABEL[result] ?? result}` : item.title}
              </p>
              {item.rationale ? <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{item.rationale}</p> : null}
            </div>
            {onAccept && onSetAside ? (
              <DecideButtons
                label={result ? `the suggested result, ${CHECK_RESULT_LABEL[result] ?? result}` : item.title}
                busy={disabled}
                size="sm"
                onAccept={() => onAccept(item.id)}
                onSetAside={() => onSetAside(item.id)}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** How much waits on a check, for its row in a list. */
export function checkWaitingCount(project: DdProject, checkId: string): number {
  const w = waitingOnCheck(project, checkId);
  return w.fields.reduce((n, f) => n + f.values.length, 0) + w.results.length + w.other.length;
}
