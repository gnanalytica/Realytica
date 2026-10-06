import { useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, ChevronRight, Circle, ClipboardList, Copy, Download, FileText, Paperclip, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import {
  ANSWER_SOURCES,
  ANSWER_SOURCE_LABEL,
  departmentRole,
  questionStatus,
  questionnairesOf,
  type DepartmentKey,
  questionnaireCsv,
  questionnaireSummary,
  questionnaireText,
  roleCanDecide,
  roleCanEdit,
  type AnswerProof,
  type AnswerSource,
  type DdProject,
  type Questionnaire,
  type QuestionnaireQuestion,
  type QuestionStatus,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { CompletenessRing } from '../charts';
import { Badge, Button, Card, CardBody, CardHeader, Input, Modal, Select, TONE_FILL, Textarea, cn, useToast, type Tone } from '../ui/kit';

type Filter = 'all' | QuestionStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unanswered', label: 'Unanswered' },
  { key: 'suggested', label: 'Suggested' },
  { key: 'answered', label: 'Answered' },
];

/** How much an answer's footing is worth: the seller's word is the weakest, so it is the one flagged. */
const SOURCE_TONE: Record<AnswerSource, Tone> = { seller: 'warning', document: 'good', site: 'good', engineer: 'neutral' };

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==================================================================== */
/* Importing                                                             */
/* ==================================================================== */

function ImportDialog({ project, department, open, onClose, onDone }: { project: DdProject; department: DepartmentKey; open: boolean; onClose: () => void; onDone: (next: DdProject) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = file
        ? await workspaceApi.importQuestionnaire(project.id, { file, title: title.trim() || undefined, department })
        : await workspaceApi.importQuestionnaire(project.id, { title: title.trim() || 'Questionnaire', text, department });
      const made = (res.project.questionnaires ?? []).find((q) => q.id === res.questionnaireId);
      onDone(res.project);
      toast(made ? `${made.questions.length} questions · ${made.questions.filter((q) => q.answer).length} answered` : 'Imported.', 'good');
      setFile(null);
      setTitle('');
      setText('');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that questionnaire', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import a questionnaire"
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!file && !text.trim()} onClick={() => void run()}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left transition-colors duration-quick ease-state',
            file ? 'border-brand/50 bg-brand-soft/50' : 'border-[var(--axis)] hover:bg-sunken/60',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
            <Upload size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{file ? file.name : 'Choose a file'}</span>
            <span className="block text-micro text-ink-muted">.xlsx, .docx, .pdf, .csv or .txt</span>
          </span>
          {file ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Remove the file"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  setFile(null);
                }
              }}
              className="grid size-7 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <X size={14} />
            </span>
          ) : null}
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.docx,.pdf,.csv,.tsv,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
            if (picked && !title) setTitle(picked.name.replace(/\.[a-z0-9]+$/i, ''));
            e.target.value = '';
          }}
        />
        <label className="block text-micro text-ink-secondary">
          Name
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name" className="mt-1" />
        </label>
        {file ? null : (
          <label className="block text-micro text-ink-secondary">
            Or paste, one question per line
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="What is the column grid size?" className="mt-1" />
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* One question                                                          */
/* ==================================================================== */

function StatusMark({ status }: { status: QuestionStatus }) {
  if (status === 'answered') return <CheckCircle2 size={16} className="shrink-0 text-good" aria-label="Answered" />;
  if (status === 'suggested') return <Sparkles size={16} className="shrink-0 text-brand" aria-label="Suggested, not confirmed" />;
  return <Circle size={16} className="shrink-0 text-ink-muted" aria-label="Unanswered" />;
}

function QuestionRow({
  project,
  questionnaire,
  question,
  number,
  mayEdit,
  mayDecide,
  onChanged,
  onOpenDocument,
}: {
  project: DdProject;
  questionnaire: Questionnaire;
  question: QuestionnaireQuestion;
  number: number;
  mayEdit: boolean;
  mayDecide: boolean;
  onChanged: (next: DdProject) => void;
  onOpenDocument: (evidenceId: string) => void;
}) {
  const toast = useToast();
  const status = questionStatus(question);
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(question.answer ?? '');
  const [source, setSource] = useState<AnswerSource | ''>(question.source ?? '');
  const [proof, setProof] = useState<AnswerProof[]>(question.proof);
  const [attach, setAttach] = useState('');
  const [page, setPage] = useState('');
  const [busy, setBusy] = useState(false);

  const files = useMemo(() => project.evidence.filter((e) => e.attachments.length > 0), [project]);
  const dirty = answer.trim() !== (question.answer ?? '') || source !== (question.source ?? '') || JSON.stringify(proof) !== JSON.stringify(question.proof);

  function toggle() {
    if (!open) {
      setAnswer(question.answer ?? '');
      setSource(question.source ?? '');
      setProof(question.proof);
    }
    setOpen(!open);
  }

  async function send(body: Parameters<typeof workspaceApi.answerQuestion>[3], done: string) {
    setBusy(true);
    try {
      const res = await workspaceApi.answerQuestion(project.id, questionnaire.id, question.id, body);
      onChanged(res.project);
      toast(done, 'good');
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the answer', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await workspaceApi.confirmAnswers(project.id, questionnaire.id, [question.id]);
      onChanged(res.project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not confirm that answer', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await workspaceApi.removeQuestion(project.id, questionnaire.id, question.id);
      onChanged(res.project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the question', 'critical');
    } finally {
      setBusy(false);
    }
  }

  function addProof() {
    if (!attach) return;
    const n = Number(page);
    setProof((was) => [...was.filter((p) => p.evidenceId !== attach), { evidenceId: attach, page: Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined }]);
    if (!source || source === 'seller') {
      const row = files.find((f) => f.id === attach);
      setSource(row?.kind === 'photograph' ? 'site' : 'document');
    }
    setAttach('');
    setPage('');
  }

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5">
          <StatusMark status={status} />
        </span>
        <button type="button" onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="block text-[13px] text-ink">
            <span className="mr-1.5 font-mono text-micro tabular-nums text-ink-muted">{number}</span>
            {question.text}
            {question.omitFromReport ? <span className="ml-1.5 text-micro text-ink-muted">(not in the report)</span> : null}
          </span>
          {question.answer ? <span className={cn('mt-0.5 block text-[13px]', question.suggested ? 'text-brand' : 'font-medium text-ink')}>{question.answer}</span> : <span className="mt-0.5 block text-micro text-ink-muted">Not answered</span>}
          {question.answer && (question.source || question.proof.length) ? (
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {question.source ? <Badge tone={question.proof.length || question.source !== 'seller' ? SOURCE_TONE[question.source] : 'warning'}>{ANSWER_SOURCE_LABEL[question.source]}</Badge> : null}
              {question.proof.map((p) => {
                const row = project.evidence.find((e) => e.id === p.evidenceId);
                const Icon = row?.kind === 'photograph' ? Camera : FileText;
                return (
                  <span
                    key={`${p.evidenceId}:${p.page ?? ''}`}
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDocument(p.evidenceId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        onOpenDocument(p.evidenceId);
                      }
                    }}
                    className="inline-flex max-w-[16rem] cursor-pointer items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:text-ink"
                    title={row?.title}
                  >
                    <Icon size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">{row?.title ?? 'Document'}</span>
                    {p.page ? <span className="shrink-0 font-mono tabular-nums">p.{p.page}</span> : null}
                  </span>
                );
              })}
            </span>
          ) : null}
        </button>
        {status === 'suggested' && mayEdit ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void confirm()}>
            Confirm
          </Button>
        ) : null}
      </div>

      {open && mayEdit ? (
        <div className="mt-2 space-y-2 rounded-xl bg-sunken/60 p-2.5 pl-[26px] ring-1 ring-inset ring-[var(--ring)]">
          <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="The answer" aria-label={`Answer to: ${question.text}`} />
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Where this answer comes from">
            {ANSWER_SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => setSource(s)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                  source === s ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
                )}
              >
                {ANSWER_SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
          {proof.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {proof.map((p) => {
                const row = project.evidence.find((e) => e.id === p.evidenceId);
                return (
                  <li key={`${p.evidenceId}:${p.page ?? ''}`} className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pl-2 pr-1 text-micro text-ink ring-1 ring-inset ring-[var(--ring)]">
                    <span className="max-w-[14rem] truncate">{row?.title ?? 'Document'}</span>
                    {p.page ? <span className="font-mono tabular-nums text-ink-secondary">p.{p.page}</span> : null}
                    <button type="button" aria-label={`Remove ${row?.title ?? 'this proof'}`} onClick={() => setProof((was) => was.filter((x) => x !== p))} className="grid size-5 place-items-center rounded-full text-ink-muted hover:bg-sunken hover:text-ink">
                      <X size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1 text-micro text-ink-secondary">
              Proof
              <Select value={attach} onChange={(e) => setAttach(e.target.value)} className="mt-1">
                <option value="">{files.length ? 'Choose…' : 'Nothing filed yet'}</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.kind === 'photograph' ? 'Photo · ' : ''}
                    {f.title}
                  </option>
                ))}
              </Select>
            </label>
            <label className="w-20 text-micro text-ink-secondary">
              Page
              <Input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" placeholder="—" className="mt-1" />
            </label>
            <Button size="sm" variant="secondary" icon={<Paperclip size={13} />} disabled={!attach} onClick={addProof}>
              Attach
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              {mayDecide ? (
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void remove()}>
                  Remove question
                </Button>
              ) : null}
              {question.answer ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ answer: null }, 'Answer cleared.')}>
                  Clear answer
                </Button>
              ) : null}
              <label className="inline-flex items-center gap-1.5 text-micro text-ink-secondary">
                <input
                  type="checkbox"
                  checked={!question.omitFromReport}
                  disabled={busy}
                  onChange={(e) => void send({ omitFromReport: !e.target.checked }, e.target.checked ? 'Back in the report.' : 'Left out of the report.')}
                  className="h-4 w-4 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:h-5 coarse:w-5"
                />
                In report
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!answer.trim() || (!dirty && !question.suggested)} onClick={() => void send({ answer: answer.trim(), source: source || null, proof }, 'Answer saved.')}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

/**
 * The questions put to the building, worked down like a checklist.
 *
 * Each answer carries where it came from and what stands behind it. A
 * suggestion from the chat is marked until a person confirms it. The sheet
 * goes back out in the order it came in.
 */
export function QuestionnaireCard({
  project,
  department = 'construction',
  onChanged,
  onOpenDocument,
}: {
  project: DdProject;
  department?: DepartmentKey;
  onChanged: (next: DdProject) => void;
  onOpenDocument: (evidenceId: string) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const role = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, department) : undefined;
  const mayEdit = roleCanEdit(role);
  const mayDecide = roleCanDecide(role);
  const all = useMemo(() => questionnairesOf(project, department), [project, department]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const questionnaire = all.find((q) => q.id === pickedId) ?? all[all.length - 1];
  const summary = useMemo(() => (questionnaire ? questionnaireSummary(questionnaire) : null), [questionnaire]);

  const importDialog = <ImportDialog project={project} department={department} open={importing} onClose={() => setImporting(false)} onDone={(next) => (onChanged(next), setPickedId(null))} />;

  if (!questionnaire || !summary) {
    return (
      <Card>
        <CardHeader icon={<ClipboardList size={15} />} title="Questionnaire" subtitle="The client’s questions, answered with proof" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">No questionnaire yet.</p>
            {mayEdit ? (
              <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={() => setImporting(true)}>
                Import a questionnaire
              </Button>
            ) : null}
          </div>
        </CardBody>
        {importDialog}
      </Card>
    );
  }

  const ordered = questionnaire.questions.slice().sort((a, b) => a.order - b.order);
  const numberOf = new Map(ordered.map((q, i) => [q.id, i + 1]));
  const sections: Array<{ key: string; label: string; questions: QuestionnaireQuestion[] }> = [];
  for (const q of ordered) {
    const label = q.section ?? 'Questions';
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.questions.push(q);
    else sections.push({ key: `${label}:${sections.length}`, label, questions: [q] });
  }

  async function confirmAll() {
    setBusy(true);
    try {
      const res = await workspaceApi.confirmAnswers(project.id, questionnaire!.id);
      onChanged(res.project);
      toast(`${res.confirmed} answer${res.confirmed === 1 ? '' : 's'} confirmed.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not confirm the answers', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!adding.trim()) return;
    setBusy(true);
    try {
      const res = await workspaceApi.addQuestion(project.id, questionnaire!.id, { text: adding.trim() });
      onChanged(res.project);
      setAdding('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the question', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function removeSheet() {
    setBusy(true);
    try {
      const res = await workspaceApi.removeQuestionnaire(project.id, questionnaire!.id);
      onChanged(res.project);
      setPickedId(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the questionnaire', 'critical');
    } finally {
      setBusy(false);
    }
  }

  /** The answered sheet as a file to send back: Excel or PDF, each answer with its source. */
  async function save(format: 'xlsx' | 'pdf' | 'file') {
    setBusy(true);
    try {
      const name = format === 'file' ? (questionnaire!.fileName ?? 'questionnaire') : `${project.reference}-${questionnaire!.title}`;
      await workspaceApi.saveQuestionnaire(project.id, questionnaire!.id, format, name.replace(/[\\/:*?"<>|]+/g, '-'));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not take the questionnaire out', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(questionnaireText(project, questionnaire!));
      toast('Copied.', 'good');
    } catch {
      toast('Could not copy.', 'warning');
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<ClipboardList size={15} />}
        title={questionnaire.title}
        subtitle={`${summary.answered}/${summary.total} answered · ${summary.proven} with proof${summary.suggested ? ` · ${summary.suggested} suggested` : ''}${summary.sellerOnly ? ` · ${summary.sellerOnly} seller’s word only` : ''}`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {all.length > 1 ? (
              <Select aria-label="Questionnaire" value={questionnaire.id} onChange={(e) => setPickedId(e.target.value)} className="w-auto">
                {all.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
              Copy
            </Button>
            {questionnaire.fileKey ? (
              <Button size="sm" variant="ghost" icon={<Download size={13} />} disabled={busy} title="The file it was taken in from, as it was sent" onClick={() => void save('file')}>
                As sent
              </Button>
            ) : null}
            {(['xlsx', 'pdf'] as const).map((format) => (
              <Button key={format} size="sm" variant="ghost" icon={<Download size={13} />} disabled={busy} onClick={() => void save(format)}>
                {format === 'xlsx' ? 'Excel' : 'PDF'}
              </Button>
            ))}
            <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => download(`${project.reference}-questionnaire.csv`, questionnaireCsv(project, questionnaire), 'text/csv')}>
              CSV
            </Button>
            {mayEdit ? (
              <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => setImporting(true)}>
                Import
              </Button>
            ) : null}
          </div>
        }
      />
      <CardBody className="space-y-3">
        {questionnaire.leftOut ? <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-ink">{questionnaire.leftOut}</p> : null}
        <div className="flex flex-wrap items-center gap-4">
          <CompletenessRing score={summary.percent} size={92} label="Answered" />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]" role="img" aria-label={`${summary.answered} answered, ${summary.suggested} suggested, ${summary.unanswered} unanswered`}>
              <span className={cn('h-full', TONE_FILL.good)} style={{ width: `${(summary.answered / Math.max(summary.total, 1)) * 100}%` }} />
              <span className={cn('h-full', TONE_FILL.brand)} style={{ width: `${(summary.suggested / Math.max(summary.total, 1)) * 100}%` }} />
            </span>
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Show">
              {FILTERS.map((f) => {
                const n = f.key === 'all' ? summary.total : summary[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                      filter === f.key ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
                    )}
                  >
                    {f.label}
                    <span className="font-mono tabular-nums">{n}</span>
                  </button>
                );
              })}
              {summary.suggested && mayEdit ? (
                <Button size="sm" variant="secondary" icon={<Sparkles size={13} />} loading={busy} onClick={() => void confirmAll()}>
                  Confirm all {summary.suggested}
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {questionnaire.header.length ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-sunken/60 p-3 ring-1 ring-inset ring-[var(--ring)] [@container(min-width:48rem)]:grid-cols-4">
            {questionnaire.header.map((h) => (
              <div key={h.label} className="min-w-0">
                <dt className="truncate text-micro text-ink-muted">{h.label}</dt>
                <dd className="truncate text-[13px] font-medium text-ink" title={h.value}>
                  {h.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="space-y-2">
          {sections.map((section) => {
            const shown = section.questions.filter((q) => filter === 'all' || questionStatus(q) === filter);
            if (!shown.length) return null;
            const done = section.questions.filter((q) => questionStatus(q) === 'answered').length;
            const shut = closed.has(section.key);
            return (
              <section key={section.key} className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() =>
                    setClosed((was) => {
                      const next = new Set(was);
                      if (next.has(section.key)) next.delete(section.key);
                      else next.add(section.key);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken/60 coarse:min-h-11"
                >
                  <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !shut && 'rotate-90')} aria-hidden />
                  <span className="flex-1 text-[13px] font-semibold text-ink">{section.label}</span>
                  <span className="font-mono text-micro tabular-nums text-ink-secondary">
                    {done}/{section.questions.length}
                  </span>
                </button>
                {shut ? null : (
                  <ul className="divide-y divide-hairline border-t border-hairline">
                    {shown.map((q) => (
                      <QuestionRow
                        key={`${q.id}:${q.answeredAt ?? ''}:${q.suggested ? 's' : ''}`}
                        project={project}
                        questionnaire={questionnaire}
                        question={q}
                        number={numberOf.get(q.id) ?? 0}
                        mayEdit={mayEdit}
                        mayDecide={mayDecide}
                        onChanged={onChanged}
                        onOpenDocument={onOpenDocument}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        {mayEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1 text-micro text-ink-secondary">
              Add a question
              <Input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Question" className="mt-1" />
            </label>
            <Button size="sm" variant="secondary" icon={<Plus size={13} />} loading={busy} disabled={!adding.trim()} onClick={() => void add()}>
              Add
            </Button>
            {mayDecide ? (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void removeSheet()}>
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardBody>
      {importDialog}
    </Card>
  );
}
