import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Circle, Clock, ListChecks, Plus, Send, Upload, X } from 'lucide-react';
import {
  CHECKLIST_NO_PACKAGE,
  REQUIREMENT_STATUS_LABEL,
  checklistSheet,
  departmentRole,
  roleCanEdit,
  type ChecklistDraft,
  type ChecklistItem,
  type ChecklistLine,
  type DdProject,
  type DepartmentKey,
  type RequirementStatus,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Input, Modal, Select, Textarea, cn, useToast, type Tone } from '../ui/kit';

const STATUS_TONE: Record<RequirementStatus, Tone> = { pending: 'neutral', requested: 'warning', received: 'good' };

function StatusMark({ status, overdue }: { status: RequirementStatus; overdue?: boolean }) {
  if (status === 'received') return <CheckCircle2 size={16} className="shrink-0 text-good" aria-label="In hand" />;
  if (status === 'requested') return <Clock size={16} className={cn('shrink-0', overdue ? 'text-critical' : 'text-warning')} aria-label={overdue ? 'Asked for, overdue' : 'Asked for'} />;
  return <Circle size={16} className="shrink-0 text-ink-muted" aria-label="Not asked" />;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

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
      toast(e instanceof Error ? e.message : 'Could not read that checklist', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load a checklist"
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

function sublineOf(line: ChecklistLine): { text: string; critical?: boolean } {
  if (line.status === 'received') return { text: line.fileName ?? 'Marked in hand' };
  if (line.status === 'requested') return { text: `Asked of ${line.askedOf ?? 'someone'}${line.dueAt ? ` · due ${day(line.dueAt)}${line.overdue ? ' (overdue)' : ''}` : ''}`, critical: line.overdue };
  return { text: line.item.owedBy ? `Owed by ${line.item.owedBy}` : 'Nobody named' };
}

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

/**
 * The checklist somebody sent, worked by stage and package.
 *
 * A line is in hand when a filed document carries its name or a person says
 * so. A document that only looks like it is offered under the line, for a
 * person to confirm. One press asks each party for everything it still owes.
 */
export function ChecklistCard({
  project,
  department,
  onChanged,
  onOpenDocument,
}: {
  project: DdProject;
  department: DepartmentKey;
  onChanged: (next: DdProject) => void;
  onOpenDocument: (evidenceId: string) => void;
}) {
  const toast = useToast();
  const me = useMe();
  const mayEdit = me ? me.role !== 'collaborator' && roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, department)) : false;
  const sheet = useMemo(() => checklistSheet(project, { department }), [project, department]);
  const documents = useMemo(() => project.evidence.filter((e) => e.attachments.length > 0 && !e.supersededById), [project.evidence]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [linked, setLinked] = useState('');
  const [recipient, setRecipient] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);

  const unnamed = sheet.owing.find((g) => !g.owedBy)?.lines.length ?? 0;
  const named = sheet.pending - unnamed;
  const asking = named + (recipient.trim() ? unnamed : 0);

  async function change(run: () => Promise<{ project: DdProject }>, said?: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await run();
      onChanged(res.project);
      if (said) toast(said, 'good');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the checklist', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    setBusy(true);
    try {
      const res = await workspaceApi.askForChecklist(project.id, { department, recipient: recipient.trim() || undefined, dueAt: dueAt || undefined });
      onChanged(res.project);
      toast(`${res.requests.length} request${res.requests.length === 1 ? '' : 's'} sent${res.unassigned ? ` · ${res.unassigned} with nobody named` : ''}`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the requests', 'critical');
    } finally {
      setBusy(false);
    }
  }

  if (!sheet.total && !mayEdit) return null;

  const dialog = <LoadDialog project={project} department={department} open={loading} onClose={() => setLoading(false)} onDone={onChanged} />;
  const newLine = adding ? (
    <LineForm
      start={{ title: '' }}
      busy={busy}
      submit="Add"
      onSubmit={(draft) =>
        void change(() => workspaceApi.addChecklistItem(project.id, { ...draft, title: draft.title.trim(), department })).then((ok) => {
          if (ok) setAdding(false);
        })
      }
    >
      <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
        Cancel
      </Button>
    </LineForm>
  ) : null;
  const actions = mayEdit ? (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
        Add
      </Button>
      <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => setLoading(true)}>
        Load
      </Button>
    </div>
  ) : undefined;

  if (!sheet.total) {
    return (
      <Card>
        <CardHeader icon={<ListChecks size={15} />} title="Checklist" subtitle="A list somebody sent" action={actions} />
        <CardBody>
          <p className="text-[13px] text-ink-secondary">No checklist yet. Load the list as it was sent.</p>
          {newLine}
        </CardBody>
        {dialog}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        icon={<ListChecks size={15} />}
        title="Checklist"
        subtitle={`${sheet.received}/${sheet.total} in hand · ${sheet.requested} asked for${sheet.toConfirm ? ` · ${sheet.toConfirm} to confirm` : ''}${sheet.overdue ? ` · ${sheet.overdue} overdue` : ''}`}
        action={actions}
      />
      <CardBody className="space-y-3">
        {newLine}

        {mayEdit && sheet.pending ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
            <p className="min-w-[11rem] flex-1 text-[12px] text-ink-secondary">
              {sheet.owing.map((g) => `${g.owedBy ?? 'Nobody named'} ${g.lines.length}`).join(' · ')}
            </p>
            {unnamed ? (
              <label className="text-micro text-ink-secondary">
                Ask for the unnamed
                <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Who" className="mt-1" />
              </label>
            ) : null}
            <label className="text-micro text-ink-secondary">
              By
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1" />
            </label>
            <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} disabled={!asking} onClick={() => void ask()}>
              Ask for {asking || 'missing'}
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          {sheet.stages.map((stage) => {
            const shut = closed.has(stage.key);
            return (
              <section key={stage.key} className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() =>
                    setClosed((was) => {
                      const next = new Set(was);
                      if (next.has(stage.key)) next.delete(stage.key);
                      else next.add(stage.key);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken/60 coarse:min-h-11"
                >
                  <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !shut && 'rotate-90')} aria-hidden />
                  <span className="flex-1 text-[13px] font-semibold text-ink">{stage.label}</span>
                  <span className="font-mono text-micro tabular-nums text-ink-secondary">
                    {stage.received}/{stage.total}
                  </span>
                </button>
                {shut
                  ? null
                  : stage.packages.map((pack) => (
                      <div key={pack.key} className="border-t border-hairline">
                        {stage.packages.length > 1 || pack.label !== CHECKLIST_NO_PACKAGE ? (
                          <div className="flex items-center gap-2 bg-sunken/60 px-3 py-1.5">
                            <span className="flex-1 text-[12px] font-medium text-ink-secondary">{pack.label}</span>
                            <span className="font-mono text-micro tabular-nums text-ink-muted">
                              {pack.received}/{pack.total}
                            </span>
                          </div>
                        ) : null}
                        <ul className="divide-y divide-hairline">
                          {pack.lines.map((line) => {
                            const { item } = line;
                            const sub = sublineOf(line);
                            const editing = mayEdit && open === item.id;
                            return (
                              <li key={item.id} className="px-3 py-2">
                                <div className="flex items-start gap-2.5">
                                  <span className="mt-0.5">
                                    <StatusMark status={line.status} overdue={line.overdue} />
                                  </span>
                                  <button
                                    type="button"
                                    disabled={!mayEdit}
                                    aria-expanded={editing}
                                    onClick={() => {
                                      setOpen(editing ? null : item.id);
                                      setLinked('');
                                    }}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <span className={cn('block text-[13px]', line.status === 'received' ? 'text-ink-secondary' : 'text-ink')}>{item.title}</span>
                                    <span className={cn('block truncate text-micro', sub.critical ? 'text-critical' : 'text-ink-muted')}>
                                      {sub.text}
                                      {item.note ? ` · ${item.note}` : ''}
                                    </span>
                                  </button>
                                  <Badge tone={STATUS_TONE[line.status]}>{REQUIREMENT_STATUS_LABEL[line.status]}</Badge>
                                  {line.status === 'received' && line.evidenceId ? (
                                    <Button size="sm" variant="ghost" onClick={() => onOpenDocument(line.evidenceId!)}>
                                      Open
                                    </Button>
                                  ) : null}
                                </div>
                                {line.suggestion ? (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                                    <button type="button" onClick={() => onOpenDocument(line.suggestion!.evidenceId)} className="min-w-0 flex-1 truncate text-left text-[12px] text-ink-secondary hover:text-ink">
                                      Looks like {line.suggestion.title}
                                    </button>
                                    {mayEdit ? (
                                      <>
                                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item.id, { evidenceId: line.suggestion!.evidenceId }), 'In hand.')}>
                                          Confirm
                                        </Button>
                                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item.id, { dismiss: line.suggestion!.evidenceId }))}>
                                          Not this
                                        </Button>
                                      </>
                                    ) : null}
                                  </div>
                                ) : null}
                                {editing ? (
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
                                    {line.status === 'received' ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => void change(() => workspaceApi.patchChecklistItem(project.id, item.id, line.byHand ? { received: false } : { dismiss: line.evidenceId }))}
                                      >
                                        {line.byHand ? 'Reopen' : 'Not this document'}
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
                          })}
                        </ul>
                      </div>
                    ))}
              </section>
            );
          })}
        </div>
      </CardBody>
      {dialog}
    </Card>
  );
}
