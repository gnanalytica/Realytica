import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Circle, Clock, Copy, Download, Inbox, MailQuestion, Plus, Send, Upload, X } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  PAPERS_OWED,
  PAPER_STANDING_LABEL,
  departmentRole,
  paperLineSaid,
  papersOwed,
  papersOwedCsvFile,
  papersOwedSaid,
  papersOwedText,
  reachesEveryProject,
  requirementSheet,
  roleCanEdit,
  type ChecklistDraft,
  type ChecklistItem,
  type DdProject,
  type DepartmentKey,
  type PaperLine,
  type PaperParty,
  type PaperStanding,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Input, Modal, Select, Textarea, cn, useToast, type Tone } from '../ui/kit';
import { RequestActions } from '../project/RequestsPanel';
import { RequestReplies } from '../project/RequestOutside';
import { daySaid } from '@realytica/shared';

const STANDING_TONE: Record<PaperStanding, Tone> = { not_asked: 'neutral', asked: 'warning', answered: 'info', in_hand: 'good' };

function StandingMark({ line }: { line: PaperLine }) {
  if (line.standing === 'in_hand') return <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden />;
  if (line.standing === 'answered') return <MailQuestion size={16} className="shrink-0 text-ai" aria-hidden />;
  if (line.standing === 'asked') return <Clock size={16} className={cn('shrink-0', line.overdue ? 'text-critical' : 'text-warning')} aria-hidden />;
  return <Circle size={16} className="shrink-0 text-ink-muted" aria-hidden />;
}

const day = (iso: string) => daySaid(iso);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==================================================================== */
/* Loading a list                                                        */
/* ==================================================================== */

function LoadDialog({ project, department, open, onClose, onDone }: { project: DdProject; department: DepartmentKey; open: boolean; onClose: () => void; onDone: (next: DdProject) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await workspaceApi.importChecklist(project.id, file ? { file, department } : { text, department });
      onDone(res.project);
      toast(`${res.added} added${res.skipped ? ` · ${res.skipped} already there` : ''}`, 'good');
      setFile(null);
      setText('');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that list', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load a list"
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!file && !text.trim()} onClick={() => void run()}>
            Load
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
            <span className="block text-micro text-ink-muted">.xlsx, .csv, .tsv or .txt</span>
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
          accept=".xlsx,.csv,.tsv,.txt,.md"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        {file ? null : (
          <label className="block text-micro text-ink-secondary">
            Or paste, one paper per line
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'Concept:\nSoil investigation report\nBuilt-up area statement'} className="mt-1" />
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* One line                                                              */
/* ==================================================================== */

/** A line's own fields, for a new line or one already on the list. */
function LineForm({ start, busy, submit, onSubmit, children }: { start: ChecklistDraft; busy: boolean; submit: string; onSubmit: (draft: ChecklistDraft) => void; children?: React.ReactNode }) {
  const [draft, setDraft] = useState<ChecklistDraft>(start);
  const set = (key: keyof ChecklistDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((was) => ({ ...was, [key]: e.target.value }));
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-micro text-ink-secondary sm:col-span-2">
          Paper
          <Input value={draft.title} onChange={set('title')} className="mt-1" />
        </label>
        <label className="text-micro text-ink-secondary">
          Stage
          <Input value={draft.stage ?? ''} onChange={set('stage')} className="mt-1" />
        </label>
        <label className="text-micro text-ink-secondary">
          Package
          <Input value={draft.package ?? ''} onChange={set('package')} className="mt-1" />
        </label>
        <label className="text-micro text-ink-secondary">
          Owed by
          <Input value={draft.owedBy ?? ''} onChange={set('owedBy')} className="mt-1" />
        </label>
        <label className="text-micro text-ink-secondary">
          Note
          <Input value={draft.note ?? ''} onChange={set('note')} className="mt-1" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!draft.title.trim()} onClick={() => onSubmit(draft)}>
          {submit}
        </Button>
        {children}
      </div>
    </div>
  );
}

const draftOf = (item: ChecklistItem): ChecklistDraft => ({ title: item.title, stage: item.stage, package: item.package, owedBy: item.owedBy, note: item.note });

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

/**
 * Papers owed: every paper a department waits for, as one list by who owes it.
 *
 * The documents the checks expect, the lines of a list somebody sent and the
 * requests made by hand are three records and one list here. A line says
 * where it stands (not asked, asked for, answered and waiting to be
 * confirmed, in hand) and carries what can be done to it: ask, confirm a
 * reply, mark in hand. It is one department's list, shown on the Documents
 * of that department's functions.
 */
export function PapersOwedCard({
  project,
  department,
  startWorkstream,
  marked,
  onChanged,
  onOpenDocument,
  onOpenCheck,
}: {
  project: DdProject;
  department: DepartmentKey;
  /** The function whose checks start the list when a desk has none. */
  startWorkstream?: string;
  /** A line to open on arrival, by its key. */
  marked?: string | null;
  onChanged: (next: DdProject) => void;
  onOpenDocument: (evidenceId: string) => void;
  onOpenCheck: (where: { ddId: string; scopeId: string; checkId: string }) => void;
}) {
  const toast = useToast();
  const me = useMe();
  const staff = me ? reachesEveryProject(me.role) : false;
  const mayEdit = (desk: DepartmentKey | undefined): boolean => Boolean(me && desk && roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, desk)));
  const view = useMemo(() => papersOwed(project, { department, outside: !staff }), [project, department, staff]);
  const documents = useMemo(() => project.evidence.filter((e) => e.attachments.length > 0 && !e.supersededById), [project.evidence]);
  // The desk a list is loaded on, for somebody of the firm who may edit it.
  const desk = staff && mayEdit(department) ? department : undefined;
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set(['in-hand']));
  const [open, setOpen] = useState<string | null>(marked ?? null);
  const [linked, setLinked] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [recipient, setRecipient] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  // Show only the lines standing one way: what was not asked, what waits on others, what waits on a person here.
  const [only, setOnly] = useState<PaperStanding | 'all'>('all');
  const shown = (line: PaperLine): boolean => only === 'all' || line.standing === only;

  const refresh = async () => onChanged(await api.getProject(project.id));
  const askable = (line: PaperLine): boolean =>
    line.standing === 'not_asked' && mayEdit(line.department) && (line.from === 'list' ? staff : line.from === 'checks' ? Boolean(line.requirement?.evidenceId) : false);
  const all = view.parties.flatMap((party) => party.lines);
  const chosen = all.filter((line) => picked.has(line.key) && askable(line));
  const unnamed = chosen.filter((line) => !line.party).length;
  const startable = startWorkstream && mayEdit(department) && !requirementSheet(project, { department }).total;

  function toggle(keys: string[], on: boolean) {
    setPicked((was) => {
      const next = new Set(was);
      for (const key of keys) (on ? next.add(key) : next.delete(key));
      return next;
    });
  }

  function fold(key: string) {
    setClosed((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function change(run: () => Promise<{ project: DdProject }>, said?: string): Promise<boolean> {
    setBusy(true);
    try {
      onChanged((await run()).project);
      if (said) toast(said, 'good');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the list', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Ask for what is ticked: one request a document the checks expect, and one to each party for everything of a list it owes. */
  async function ask() {
    if (unnamed && !recipient.trim()) {
      toast('Say who is asked for the papers nobody is named for.', 'warning');
      return;
    }
    setBusy(true);
    try {
      for (const line of chosen.filter((l) => l.from === 'checks')) {
        await api.createRequest(project.id, { title: line.title, recipient: line.party ?? recipient.trim(), dueAt: dueAt || undefined, evidenceId: line.requirement!.evidenceId, send: true });
      }
      const byDesk = new Map<DepartmentKey, string[]>();
      for (const line of chosen.filter((l) => l.from === 'list')) byDesk.set(line.department!, [...(byDesk.get(line.department!) ?? []), line.checklist!.item.id]);
      for (const [held, itemIds] of byDesk) await workspaceApi.askForChecklist(project.id, { department: held, itemIds, recipient: recipient.trim() || undefined, dueAt: dueAt || undefined });
      setPicked(new Set());
      await refresh();
      toast(`Asked for ${chosen.length} paper${chosen.length === 1 ? '' : 's'}. Send each request by email or WhatsApp from its line.`, 'good');
    } catch (e) {
      await refresh().catch(() => undefined);
      toast(e instanceof Error ? e.message : 'Could not ask for them', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(papersOwedText(view, day, only === 'all' || only === 'in_hand' ? {} : { only }));
      toast('Copied, to paste into a message.', 'good');
    } catch {
      toast('Could not copy.', 'warning');
    }
  }

  async function start() {
    if (!startWorkstream) return;
    setBusy(true);
    try {
      await workspaceApi.startWorkstreamChecks(project.id, startWorkstream);
      await refresh();
      toast('Checks added.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the checks', 'critical');
    } finally {
      setBusy(false);
    }
  }

  // An outside collaborator with nothing on their copy is shown no empty card.
  if (!view.total && !desk) return null;

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {desk ? (
        <>
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
            Add
          </Button>
          <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => setLoading(true)}>
            Load a list
          </Button>
        </>
      ) : null}
      {view.owed ? (
        <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
          Copy
        </Button>
      ) : null}
      {view.total ? (
        <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => download(`${project.reference}-papers-owed.csv`, papersOwedCsvFile(view))}>
          Export
        </Button>
      ) : null}
    </div>
  );

  function row(line: PaperLine) {
    const editable = line.from === 'list' && staff && mayEdit(line.department);
    const expanded = open === line.key;
    const canExpand = editable || line.from === 'checks' || Boolean(line.request && staff);
    const item = line.checklist?.item;
    const suggestion = line.checklist?.suggestion;
    const said = [paperLineSaid(line, day), line.where, item?.note].filter(Boolean).join(' · ');
    return (
      <li key={line.key} className="px-3 py-2">
        <div className="flex items-start gap-2.5">
          {askable(line) ? (
            <input
              type="checkbox"
              checked={picked.has(line.key)}
              onChange={(e) => toggle([line.key], e.target.checked)}
              aria-label={`Ask for ${line.title}`}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:h-5 coarse:w-5"
            />
          ) : (
            <span className="mt-0.5">
              <StandingMark line={line} />
            </span>
          )}
          <button type="button" disabled={!canExpand} aria-expanded={canExpand ? expanded : undefined} onClick={() => (setOpen(expanded ? null : line.key), setLinked(''))} className="min-w-0 flex-1 text-left">
            <span className={cn('block text-[13px]', line.standing === 'in_hand' ? 'text-ink-secondary' : 'text-ink')}>{line.title}</span>
            <span className={cn('block text-micro', line.overdue ? 'text-critical' : 'text-ink-muted')}>{said}</span>
          </button>
          <Badge tone={STANDING_TONE[line.standing]}>{PAPER_STANDING_LABEL[line.standing]}</Badge>
          {line.standing === 'in_hand' && line.evidenceId ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenDocument(line.evidenceId!)}>
              Open
            </Button>
          ) : null}
        </div>
        {/* A reply that waits is shown on the line itself, with Confirm beside it: it is the one thing here that waits for a person. */}
        {line.request && staff && (line.standing === 'answered' || expanded) ? (
          <div className="mt-2 flex flex-wrap items-start gap-2 pl-[26px] [&>div:last-child]:pl-0">
            {expanded ? <RequestActions projectId={project.id} request={line.request} onChanged={refresh} /> : null}
            <RequestReplies projectId={project.id} request={line.request} onChanged={refresh} />
          </div>
        ) : null}
        {suggestion ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
            <button type="button" onClick={() => onOpenDocument(suggestion.evidenceId)} className="min-w-0 flex-1 truncate text-left text-[12px] text-ink-secondary hover:text-ink">
              Looks like {suggestion.title}
            </button>
            {editable ? (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item!.id, { evidenceId: suggestion.evidenceId }), 'In hand.')}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item!.id, { dismiss: suggestion.evidenceId }))}>
                  Not this
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {expanded && line.requirement ? (
          <ul className="mt-2 space-y-1 pl-[26px]">
            {line.requirement.checks.map((check) => (
              <li key={check.id}>
                <button type="button" onClick={() => onOpenCheck(check.where)} className="flex w-full items-center gap-2 rounded-lg py-0.5 text-left text-[12px] text-ink-secondary hover:text-ink">
                  <span className="min-w-0 flex-1">Needed for: {check.title}</span>
                  <Badge>{CHECK_RESULT_LABEL[check.result]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {expanded && editable && item ? (
          <LineForm
            start={draftOf(item)}
            busy={busy}
            submit="Save"
            onSubmit={(draft) =>
              void change(() =>
                workspaceApi.patchChecklistItem(project.id, item.id, { title: draft.title.trim(), stage: draft.stage?.trim() || null, package: draft.package?.trim() || null, owedBy: draft.owedBy?.trim() || null, note: draft.note?.trim() || null }),
              ).then((ok) => {
                if (ok) setOpen(null);
              })
            }
          >
            {line.standing === 'in_hand' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item.id, line.checklist!.byHand ? { received: false } : { dismiss: line.checklist!.evidenceId }))}
              >
                {line.checklist!.byHand ? 'Reopen' : 'Not this document'}
              </Button>
            ) : (
              <>
                <Select value={linked} onChange={(e) => setLinked(e.target.value)} aria-label="The document" className="min-w-0 max-w-[14rem] flex-1">
                  <option value="">No document</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item.id, { received: true, evidenceId: linked || undefined }), 'In hand.')}>
                  Mark in hand
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => workspaceApi.removeChecklistItem(project.id, item.id))}>
              Remove
            </Button>
          </LineForm>
        ) : null}
      </li>
    );
  }

  /** A long group is read under the headings of its own record: the discipline a check sits in, or the stage and package of a list. */
  function body(lines: PaperLine[]) {
    const heads = [...new Set(lines.map((line) => line.where ?? ''))];
    if (lines.length <= 8 || heads.length < 2) return <ul className="divide-y divide-hairline border-t border-hairline">{lines.map(row)}</ul>;
    return heads.map((head) => {
      const under = lines.filter((line) => (line.where ?? '') === head);
      return (
        <div key={head || 'none'} className="border-t border-hairline">
          <div className="flex items-center gap-2 bg-sunken/60 px-3 py-1.5">
            <span className="flex-1 text-[12px] font-medium text-ink-secondary">{head || 'Other'}</span>
            <span className="font-mono text-micro tabular-nums text-ink-muted">{under.length}</span>
          </div>
          <ul className="divide-y divide-hairline">{under.map(row)}</ul>
        </div>
      );
    });
  }

  function group(party: PaperParty) {
    const lines = party.lines.filter(shown);
    if (!lines.length) return null;
    const shut = closed.has(party.key);
    const mine = lines.filter(askable).map((line) => line.key);
    const every = mine.length > 0 && mine.every((key) => picked.has(key));
    const said = [party.answered ? `${party.answered} to confirm` : '', party.overdue ? `${party.overdue} overdue` : '', party.notAsked ? `${party.notAsked} not asked` : ''].filter(Boolean).join(' · ');
    return (
      <section key={party.key || 'nobody'} className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
        <div className="flex items-center gap-2 rounded-xl pr-2 hover:bg-sunken/60">
          <button type="button" aria-expanded={!shut} onClick={() => fold(party.key)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left coarse:min-h-11">
            <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !shut && 'rotate-90')} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{party.party ?? 'Nobody named'}</span>
              {said ? <span className={cn('block text-micro', party.overdue ? 'text-critical' : 'text-ink-muted')}>{said}</span> : null}
            </span>
            <span className="font-mono text-micro tabular-nums text-ink-secondary">{lines.length}</span>
          </button>
          {mine.length ? (
            <Button size="sm" variant="ghost" onClick={() => toggle(mine, !every)}>
              {every ? 'Clear' : `Select ${mine.length} to ask`}
            </Button>
          ) : null}
        </div>
        {shut ? null : body(lines)}
      </section>
    );
  }

  const filters: Array<{ key: PaperStanding | 'all'; label: string; n: number }> = [
    { key: 'all', label: 'All', n: view.total },
    { key: 'answered', label: PAPER_STANDING_LABEL.answered, n: view.answered },
    { key: 'asked', label: PAPER_STANDING_LABEL.asked, n: view.asked },
    { key: 'not_asked', label: PAPER_STANDING_LABEL.not_asked, n: view.notAsked },
    { key: 'in_hand', label: PAPER_STANDING_LABEL.in_hand, n: view.inHand.length },
  ];

  return (
    <Card>
      <CardHeader icon={<Inbox size={15} />} title={PAPERS_OWED} subtitle={papersOwedSaid(view)} action={actions} />
      <CardBody className="space-y-3">
        {adding && desk ? (
          <LineForm
            start={{ title: '' }}
            busy={busy}
            submit="Add"
            onSubmit={(draft) =>
              void change(() => workspaceApi.addChecklistItem(project.id, { ...draft, title: draft.title.trim(), department: desk })).then((ok) => {
                if (ok) setAdding(false);
              })
            }
          >
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </LineForm>
        ) : null}
        {chosen.length ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
            {unnamed ? (
              <label className="min-w-[11rem] flex-1 text-micro text-ink-secondary">
                Who is asked, for the {unnamed} nobody is named for
                <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Name, or their firm" className="mt-1" />
              </label>
            ) : (
              <p className="min-w-[11rem] flex-1 text-[12px] text-ink-secondary">One request goes to each party, naming everything it owes.</p>
            )}
            <label className="text-micro text-ink-secondary">
              By
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1" />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
            <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} onClick={() => void ask()}>
              Ask for {chosen.length}
            </Button>
          </div>
        ) : null}
        {view.total > 8 ? (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
            {filters.filter((f) => f.key === 'all' || f.n).map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={only === f.key}
                onClick={() => (setOnly(f.key), f.key === 'in_hand' && setClosed((was) => new Set([...was].filter((key) => key !== 'in-hand'))))}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                  only === f.key ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
                )}
              >
                {f.label}
                <span className="font-mono tabular-nums">{f.n}</span>
              </button>
            ))}
          </div>
        ) : null}
        {view.total ? (
          <div className="space-y-2">
            {only === 'in_hand' ? null : view.parties.map(group)}
            {view.inHand.length && (only === 'all' || only === 'in_hand') ? (
              <section className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                <button type="button" aria-expanded={!closed.has('in-hand')} onClick={() => fold('in-hand')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken/60 coarse:min-h-11">
                  <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !closed.has('in-hand') && 'rotate-90')} aria-hidden />
                  <span className="flex-1 text-[13px] font-semibold text-ink-secondary">In hand</span>
                  <span className="font-mono text-micro tabular-nums text-ink-secondary">{view.inHand.length}</span>
                </button>
                {closed.has('in-hand') ? null : <ul className="divide-y divide-hairline border-t border-hairline">{view.inHand.map(row)}</ul>}
              </section>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-ink-secondary">Nothing is asked for yet. Load the list of papers as it was sent, or add a line.</p>
        )}
        {startable ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[12px] text-ink-muted">This desk’s checks are not started, so the documents they expect are not listed.</p>
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void start()}>
              Start the checks
            </Button>
          </div>
        ) : null}
      </CardBody>
      {desk ? <LoadDialog project={project} department={desk} open={loading} onClose={() => setLoading(false)} onDone={onChanged} /> : null}
    </Card>
  );
}
