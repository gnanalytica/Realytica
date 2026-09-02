import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import {
  checkFieldReading,
  type CheckFieldDef,
  type CheckFieldWrite,
  CHECK_RESULT_LABEL,
  EVIDENCE_STATUS_LABEL,
  SCOPE_LABEL,
  checkAdvise,
  proposalExtractionNotes,
  proposalQuotes,
  proposalsPinnedToCheck,
  quotesForCheck,
  type CheckInstance,
  type CheckResult,
  type FindingSeverity,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { CheckFields } from '../../components/CheckFields';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Modal, Select, Textarea, cn, useToast } from '../../components/ui/kit';
import { AssignCell } from '../../components/AssignCell';
import type { ProjectOutlet } from './ProjectLayout';
import { checkTone } from './shared';
import { useLiveHighlight } from './LiveRow';
import { FieldAdvise, TickCrossButtons } from './cockpit/FieldAdvise';

const RESULTS: CheckResult[] = [
  'compliant',
  'non_compliant',
  'partially_compliant',
  'not_applicable',
  'unable_to_verify',
  'missing_evidence',
  'requires_expert_review',
];

export default function ScopeWorkspace() {
  const { ddId, scopeId } = useParams<{ ddId: string; scopeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { project, setProject, onApproveProposal, onSkipProposal, proposalBusy, highlightIds, onOpenCited } =
    useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const assessment = project.assessments.find((a) => a.id === ddId);
  const scope = assessment?.scopes.find((s) => s.id === scopeId);
  const requestedCheck = searchParams.get('check');
  const [checkId, setCheckId] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult>('compliant');
  const [comments, setComments] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [severity, setSeverity] = useState<FindingSeverity>('high');
  const [busy, setBusy] = useState(false);

  /** The sitting lives in the URL, so it survives a reload and can be linked. */
  const selectCheck = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('check', id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /**
   * Sixty-two checks a project, and until now every one of them cost a click to
   * select and a click to record, with a scroll between.
   *
   * Bound at the window rather than on a focused list because the thing being
   * driven — the sitting card — is not where the pointer is, and asking a
   * reviewer to click into a list before the arrows work is the friction this
   * is meant to remove. Typing anywhere real gives the keys straight back.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (checkId) return; // the details modal owns the keyboard while it is open
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select|button)$/i.test(el.tagName))) return;
      const checks = scope?.checks ?? [];
      if (checks.length === 0) return;

      const at = checks.findIndex((c) => c.id === requestedCheck);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        selectCheck((checks[Math.min(checks.length - 1, at + 1)] as CheckInstance).id);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        selectCheck((checks[at <= 0 ? 0 : at - 1] as CheckInstance).id);
        return;
      }
      const here = at >= 0 ? checks[at] : undefined;
      if (!here || here.result !== 'pending' || busy) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void recordLean(here, 'compliant');
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        void recordLean(here, 'missing_evidence');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function openCheck(ch: { id: string; result: CheckResult; comments: string; evidenceIds: string[] }) {
    setCheckId(ch.id);
    setResult(ch.result === 'pending' ? 'compliant' : ch.result);
    setComments(ch.comments);
    setEvidenceIds([...ch.evidenceIds]);
  }

  if (!assessment || !scope) {
    return <Callout tone="critical" title="Scope not found">This scope is not on the assessment.</Callout>;
  }

  const sittingCheck = requestedCheck ? scope.checks.find((c) => c.id === requestedCheck) : undefined;
  const check = scope.checks.find((c) => c.id === checkId);
  const evidence = project.evidence.filter((e) => e.scopeInstanceIds.includes(scope.id) || e.assessmentIds.includes(assessment.id));
  const pinned = check ? proposalsPinnedToCheck(project, check.id) : [];
  const quotes = check ? quotesForCheck(project, check.id) : [];
  const sittingQuotes = sittingCheck ? quotesForCheck(project, sittingCheck.id) : [];
  const liveIds = [...(highlightIds ?? []), ...(requestedCheck ? [requestedCheck] : [])];

  // Read live from the check rather than held in state: recording a value
  // re-reads the project, and the insights must recompute from what is stored
  // rather than from a copy that has already drifted.
  const reading = check ? checkFieldReading(check) : { defs: [], values: {}, insights: [], missing: [], filled: 0, total: 0 };

  /**
   * Values save as they are entered, one field at a time.
   *
   * Deliberately not batched behind the “Record result” button: transcribing
   * what a deed says is not the same act as concluding the check passes, and
   * making somebody commit to a result before they can write down a number
   * they just read is backwards.
   */
  async function saveFields(values: Record<string, CheckFieldWrite>) {
    if (!check) return;
    setBusy(true);
    try {
      const { project: next } = await api.recordCheckFields(project.id, check.id, values);
      setProject(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record that value', 'critical');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Files dropped straight onto a check field.
   *
   * Creates the evidence row AND uploads in one go, because the alternative is
   * leave the check, open the register, create a row, upload, come back, find
   * it — and four of those five steps are where a citation gets abandoned.
   *
   * The row is titled after the field so the register stays readable to
   * somebody who never opens this check: "Site photographs — Fire & life
   * safety" says where it came from, which a filename does not.
   */
  async function attachToField(def: CheckFieldDef, files: File[]): Promise<string[]> {
    if (!check) return [];
    const record = await api.addEvidence(project.id, {
      title: `${def.label} — ${check.title}`,
      kind: def.accepts === 'image' ? 'photograph' : 'document',
      status: 'received',
      checkIds: [check.id],
      assessmentIds: assessment ? [assessment.id] : [],
    });
    await api.uploadEvidenceFiles(project.id, record.id, files);
    setProject(await api.getProject(project.id));
    return [record.id];
  }

  async function save() {
    if (!check) return;
    setBusy(true);
    try {
      const { project: next } = await api.recordCheck(project.id, check.id, {
        result,
        comments,
        evidenceIds,
        findingSeverity: severity,
      });
      setProject(next);
      setCheckId(null);
      toast('Check recorded', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record check', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function recordLean(ch: CheckInstance, next: 'compliant' | 'missing_evidence') {
    setBusy(true);
    try {
      const { project: updated } = await api.recordCheck(project.id, ch.id, {
        result: next,
        comments: next === 'compliant' ? 'Tick from the sitting.' : 'Cross from the sitting — expected proof still missing.',
      });
      setProject(updated);
      toast(next === 'compliant' ? 'Recorded compliant' : 'Recorded missing evidence', 'good');
      // Land on the next thing to do rather than on the thing just done. The
      // next check is read out of the response, not out of `scope`, which is
      // still the copy from before this write.
      const after = updated.assessments
        .find((a) => a.id === ddId)
        ?.scopes.find((s) => s.id === scopeId)?.checks;
      if (after) {
        const at = after.findIndex((c) => c.id === ch.id);
        const onwards = after.slice(at + 1).find((c) => c.result === 'pending');
        const wrapped = onwards ?? after.slice(0, at).find((c) => c.result === 'pending');
        if (wrapped) selectCheck(wrapped.id);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record check', 'critical');
    } finally {
      setBusy(false);
    }
  }

  function selectField(ch: CheckInstance) {
    if (onOpenCited) onOpenCited(ch.id);
  }


  return (
    <div className="space-y-4">
      <div>
        <Link to={`/projects/${project.id}/dd/${assessment.id}`} className="text-[12px] text-brand">
          {assessment.name}
        </Link>
        <h2 className="mt-1 text-lg font-semibold text-ink">{SCOPE_LABEL[scope.scopeKey]}</h2>
      </div>

      {sittingCheck ? (
        <Card className="ring-1 ring-inset ring-brand/25">
          <CardHeader title="This field" />
          <CardBody>
            <FieldAdvise
              check={sittingCheck}
              scope={scope}
              assessmentName={assessment.name}
              advise={checkAdvise(project, sittingCheck)}
              quotes={sittingQuotes}
              pending={sittingCheck.result === 'pending'}
              busy={busy}
              onTick={() => void recordLean(sittingCheck, 'compliant')}
              onCross={() => void recordLean(sittingCheck, 'missing_evidence')}
              onDetails={() => openCheck(sittingCheck)}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Checks"
          action={
            <p className="hidden text-[11px] text-ink-muted sm:block">
              <kbd className="font-mono">↑↓</kbd> move · <kbd className="font-mono">↵</kbd> tick ·{' '}
              <kbd className="font-mono">X</kbd> cross
            </p>
          }
        />
        <CardBody className="divide-y divide-hairline p-0">
          {scope.checks.map((ch) => (
            <CheckRow
              key={ch.id}
              check={ch}
              sitting={sittingCheck?.id === ch.id}
              highlightIds={liveIds}
              pending={ch.result === 'pending'}
              lean={ch.result === 'pending' ? checkAdvise(project, ch).lean : undefined}
              busy={busy}
              onOpen={() => selectField(ch)}
              onTick={() => void recordLean(ch, 'compliant')}
              onCross={() => void recordLean(ch, 'missing_evidence')}
            />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Evidence on this scope" />
        <CardBody className="space-y-1">
          {evidence.slice(0, 12).map((e) => (
            <div key={e.id} className="flex flex-wrap justify-between gap-2 text-[13px]">
              <span className="min-w-0">{e.title}</span>
              <Badge>{EVIDENCE_STATUS_LABEL[e.status]}</Badge>
            </div>
          ))}
          {evidence.length === 0 ? <p className="text-[13px] text-ink-muted">No evidence linked yet.</p> : null}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(check)}
        onClose={() => setCheckId(null)}
        title={check?.title ?? 'Check'}
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckId(null)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>Record result</Button>
          </>
        }
      >
        {check ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-secondary">{check.purpose}</p>
            <p className="text-[12px] text-ink-muted">Acceptance: {check.acceptanceCriteria}</p>
            {/* Here rather than on the row: the list is a keyboard surface
                whose rows are themselves buttons, and an editor inside one
                would be a control nobody can reach with the arrow keys. */}
            <AssignCell
              className="-ml-1.5"
              project={project}
              targetId={check.id}
              owner={check.owner}
              onAssigned={setProject}
            />
            <CheckFields
              defs={reading.defs}
              values={reading.values}
              insights={reading.insights}
              disabled={busy}
              evidence={project.evidence}
              onAttachEvidence={attachToField}
              onCommit={(values) => void saveFields(values)}
            />
            <Field label="Result">
              <Select value={result} onChange={(e) => setResult(e.target.value as CheckResult)}>
                {RESULTS.map((r) => (
                  <option key={r} value={r}>{CHECK_RESULT_LABEL[r]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Comments">
              <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} />
            </Field>
            <Field label="Evidence used">
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2">
                {project.evidence.slice(0, 40).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={evidenceIds.includes(e.id)}
                      onChange={(ev) =>
                        setEvidenceIds((prev) => (ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                      }
                    />
                    {e.title}
                  </label>
                ))}
              </div>
            </Field>
            {result !== 'compliant' && result !== 'not_applicable' && result !== 'pending' ? (
              <Field label="Finding severity if a finding is created">
                <Select value={severity} onChange={(e) => setSeverity(e.target.value as FindingSeverity)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </Select>
              </Field>
            ) : null}
            {pinned.length ? (
              <div className="space-y-2 rounded-lg bg-sunken px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
                <p className="text-[12px] font-medium text-ink">Cards for this check</p>
                {pinned.map((item) => (
                  <div key={item.id}>
                    <p className="text-[12.5px] font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{item.rationale}</p>
                    {proposalQuotes(item.payload).length ? (
                      <div className="mt-1.5 space-y-1 rounded-md bg-surface px-2 py-1.5">
                        {proposalQuotes(item.payload).slice(0, 3).map((q, i) => (
                          <p key={i} className="text-[11.5px] leading-relaxed text-ink">
                            “{q.text}”{q.page ? <span className="text-ink-muted"> · p.{q.page}</span> : null}
                          </p>
                        ))}
                        {proposalExtractionNotes(item.payload) ? (
                          <p className="text-[11px] text-ink-muted">{proposalExtractionNotes(item.payload)}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {onApproveProposal && onSkipProposal ? (
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" variant="primary" disabled={proposalBusy} onClick={() => onApproveProposal(item.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" disabled={proposalBusy} onClick={() => onSkipProposal(item.id)}>
                          Skip
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {quotes.length > 0 && !pinned.length ? (
              <div className="space-y-1 rounded-lg bg-sunken px-3 py-2">
                <p className="text-[12px] font-medium text-ink">Quoted from the file</p>
                {quotes.slice(0, 4).map((q, i) => (
                  <p key={i} className="text-[11.5px] leading-relaxed text-ink-secondary">
                    “{q.text}”{q.page ? ` · p.${q.page}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CheckRow({
  check,
  sitting,
  highlightIds,
  pending,
  lean,
  busy,
  onOpen,
  onTick,
  onCross,
}: {
  check: { id: string; title: string; section: string; expectedEvidence: string[]; result: CheckResult; owner?: string };
  sitting: boolean;
  highlightIds?: string[];
  pending: boolean;
  lean?: 'tick' | 'cross' | 'none';
  busy?: boolean;
  onOpen: () => void;
  onTick: () => void;
  onCross: () => void;
}) {
  const { ref, on } = useLiveHighlight<HTMLDivElement>(check.id, highlightIds);
  return (
    <div
      ref={ref}
      className={cn(
        'flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-sunken/60 coarse:min-h-11',
        sitting ? 'bg-brand-soft/50' : '',
        on && 'bg-brand-soft ring-2 ring-inset ring-brand/35',
      )}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className="text-[13px] font-medium text-ink">{check.title}</p>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          {check.section} · {check.expectedEvidence.join(', ')}
          {check.owner ? ` · ${check.owner}` : ''}
        </p>
      </button>
      <div className="flex items-center gap-2">
        {pending && sitting ? <TickCrossButtons lean={lean} busy={busy} onTick={onTick} onCross={onCross} /> : null}
        <Badge tone={checkTone(check.result)}>{CHECK_RESULT_LABEL[check.result]}</Badge>
      </div>
    </div>
  );
}
