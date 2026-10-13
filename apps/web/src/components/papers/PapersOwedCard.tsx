import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Circle, CircleDot, CircleSlash, Clock, Copy, Download, Inbox, MailQuestion, Plus, Send, Upload, X } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  DEPARTMENT_SHORT,
  PAPERS_OWED,
  PAPER_STANDING_LABEL,
  TENDER_TERMS,
  WORKSTREAMS,
  assumableFields,
  checklistSummary,
  departmentDefinition,
  departmentRole,
  fieldCatalogFor,
  functionSections,
  listLoadSaid,
  paperLineSaid,
  papersOwed,
  papersOwedCsvFile,
  papersOwedSaid,
  papersOwedText,
  reachesEveryProject,
  refChoices,
  requirementSheet,
  roleCanDecide,
  roleCanEdit,
  type ChecklistDraft,
  type ChecklistItem,
  type ChecklistSummary,
  type DdProject,
  type DepartmentKey,
  type ListLoadReport,
  type PaperLine,
  type PaperParty,
  type PaperStanding,
  type TenderFormReport,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { workspaceApi, type ListPreview, type ListSend } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Input, Modal, Select, Textarea, cn, useToast, type Tone } from '../ui/kit';
import { RequestActions } from '../project/RequestsPanel';
import { RequestReplies } from '../project/RequestOutside';
import { daySaid } from '@realytica/shared';

const STANDING_TONE: Record<PaperStanding, Tone> = { not_asked: 'neutral', asked: 'warning', answered: 'info', partial: 'warning', assumed: 'neutral', in_hand: 'good' };

function StandingMark({ line }: { line: PaperLine }) {
  if (line.standing === 'in_hand') return <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden />;
  if (line.standing === 'answered') return <MailQuestion size={16} className="shrink-0 text-ai" aria-hidden />;
  if (line.standing === 'partial') return <CircleDot size={16} className={cn('shrink-0', line.overdue ? 'text-critical' : 'text-warning')} aria-hidden />;
  if (line.standing === 'assumed') return <CircleSlash size={16} className="shrink-0 text-ink-muted" aria-hidden />;
  if (line.standing === 'asked') return <Clock size={16} className={cn('shrink-0', line.overdue ? 'text-critical' : 'text-warning')} aria-hidden />;
  return <Circle size={16} className="shrink-0 text-ink-muted" aria-hidden />;
}

const day = (iso: string) => daySaid(iso);
const fold = (text: string | undefined) => (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

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

/** The functions a package's lines may go to: the ones with a Documents part, where a list is shown. */
const DESKS = WORKSTREAMS.filter((ws) => functionSections(ws.key).includes('documents'));

/** A few of the lines a load would move, and how many more. */
function Moved({ label, lines }: { label: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <li className="text-[12px] text-ink-secondary">
      <span className="font-medium text-ink">
        {label} ({lines.length})
      </span>
      : {lines.slice(0, 4).join('; ')}
      {lines.length > 4 ? `, and ${lines.length - 4} more` : ''}
    </li>
  );
}

function LoadDialog({ project, department, open, onClose, onDone }: { project: DdProject; department: DepartmentKey; open: boolean; onClose: () => void; onDone: (next: DdProject) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // What the list was read as, before anything is changed: a tracked list and a tender form are shown first.
  const [preview, setPreview] = useState<ListPreview | null>(null);
  const [desks, setDesks] = useState<Record<string, string>>({});
  const [record, setRecord] = useState('');
  const tenders = useMemo(() => (open ? refChoices(project, { set: TENDER_TERMS }) : []), [project, open]);

  const sent = (): ListSend => ({ ...(file ? { file } : { text }), department, ...(Object.keys(desks).length ? { desks } : {}), ...(record ? { record } : {}) });

  function reset() {
    setFile(null);
    setText('');
    setPreview(null);
    setDesks({});
    setRecord('');
  }

  async function load() {
    const res = await workspaceApi.importChecklist(project.id, sent());
    onDone(res.project);
    toast(res.said ?? `${res.added} added${res.skipped ? ` · ${res.skipped} already there` : ''}`, 'good');
    reset();
    onClose();
  }

  async function run() {
    setBusy(true);
    try {
      if (preview) await load();
      else {
        const read = await workspaceApi.previewChecklist(project.id, sent());
        // A plain list is one paper to a line: there is nothing to look at first.
        if (read.kind === 'plain') await load();
        else {
          setPreview(read);
          setDesks(Object.fromEntries((read.desks ?? []).filter((desk) => desk.fn).map((desk) => [desk.package, desk.fn!])));
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that list', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const tracked = preview?.kind === 'tracked' ? (preview.report as ListLoadReport) : undefined;
  const form = preview?.kind === 'tender_form' ? (preview.report as TenderFormReport) : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load a list"
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={preview ? () => setPreview(null) : onClose} disabled={busy}>
            {preview ? 'Back' : 'Cancel'}
          </Button>
          <Button variant="primary" loading={busy} disabled={!file && !text.trim()} onClick={() => void run()}>
            Load
          </Button>
        </>
      }
    >
      {tracked ? (
        <div className="space-y-3">
          <div>
            <p className="text-[13px] font-medium text-ink">{preview!.list}</p>
            <p className="text-micro text-ink-muted">
              {preview!.lines} lines · {listLoadSaid(tracked)}
            </p>
          </div>
          <ul className="space-y-1">
            <Moved label="New" lines={tracked.added} />
            <Moved label="Now received" lines={tracked.becameReceived} />
            <Moved label="Now partial" lines={tracked.becamePartial} />
            <Moved label="Now to be assumed" lines={tracked.becameAssumed} />
            <Moved label="Pending again" lines={tracked.reopened} />
            <Moved label="No longer on the list, and kept" lines={tracked.gone} />
          </ul>
          <div className="space-y-1.5">
            <p className="text-micro text-ink-secondary">Where each package goes</p>
            {(preview!.desks ?? []).map((desk) => (
              <label key={desk.package} className="flex items-center gap-2 text-[13px] text-ink">
                <span className="min-w-0 flex-1 truncate">{desk.package}</span>
                <Select value={desks[desk.package] ?? ''} onChange={(e) => setDesks((was) => ({ ...was, [desk.package]: e.target.value }))} aria-label={`Function for ${desk.package}`} className="w-52">
                  <option value="">This desk ({DEPARTMENT_SHORT[department]})</option>
                  {DESKS.map((ws) => (
                    <option key={ws.key} value={ws.key}>
                      {DEPARTMENT_SHORT[ws.department]} › {ws.label}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </div>
      ) : form ? (
        <div className="space-y-3">
          <div>
            <p className="text-[13px] font-medium text-ink">A tender form: {form.list.replace(/^Tender terms: /, '')}</p>
            <p className="text-micro text-ink-muted">
              {form.rows} rows · {preview!.said}
            </p>
          </div>
          <label className="block text-micro text-ink-secondary">
            Fills the Tender terms of
            <Select value={record} onChange={(e) => setRecord(e.target.value)} className="mt-1">
              <option value="">{form.record && !tenders.some((tender) => tender.id === form.record) ? 'The tender this form filled before' : 'A new tender'}</option>
              {tenders.map((tender) => (
                <option key={tender.id} value={tender.id}>
                  {tender.label}
                </option>
              ))}
            </Select>
          </label>
          <p className="text-[12px] text-ink-secondary">Each answer is offered on its field with this file, its sheet and its row as the source. Nothing counts until a lead or signer accepts it.</p>
          <ul className="space-y-1">
            <Moved label="Still owed by the client" lines={form.owed.added} />
            <Moved label="To type by hand" lines={form.unread.map((row) => `${row.no} ${row.item}`)} />
            <Moved label="Not on the form" lines={form.unmatched.map((row) => `${row.no} ${row.item}`)} />
            <Moved label="Not taken" lines={form.refused.map((row) => `${row.no} ${row.item}: ${row.error}`)} />
          </ul>
        </div>
      ) : (
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
          <p className="text-micro text-ink-muted">A list with numbers and a status column updates the lines it loaded before. A form of answers is read into Tender terms.</p>
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== */
/* One line                                                              */
/* ==================================================================== */

/** A line's own fields, for a new line or one already on the list. `more` adds the day it is wanted by and what came back. */
function LineForm({ start, busy, submit, more, onSubmit, children }: { start: ChecklistDraft; busy: boolean; submit: string; more?: boolean; onSubmit: (draft: ChecklistDraft) => void; children?: React.ReactNode }) {
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
        {more ? (
          <label className="text-micro text-ink-secondary">
            Wanted by
            <Input type="date" value={draft.targetDate ?? ''} onChange={set('targetDate')} className="mt-1" />
          </label>
        ) : null}
        <label className="text-micro text-ink-secondary">
          Note
          <Input value={draft.note ?? ''} onChange={set('note')} className="mt-1" />
        </label>
        {more ? (
          <label className="text-micro text-ink-secondary">
            What came back
            <Input value={draft.remark ?? ''} onChange={set('remark')} maxLength={200} className="mt-1" />
          </label>
        ) : null}
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

const draftOf = (item: ChecklistItem): ChecklistDraft => ({ title: item.title, stage: item.stage, package: item.package, owedBy: item.owedBy, note: item.note, targetDate: item.targetDate, remark: item.remark?.text });

/**
 * The two standings a person sets on a line of a list: partly in hand, with
 * what is still wanted, and to be assumed, with who assumes and the field the
 * paper would have filled. A value given for that field stands in on it as
 * assumed until a real one is typed or accepted.
 */
function StandingForm({ project, line, busy, change }: { project: DdProject; line: PaperLine; busy: boolean; change: (run: () => Promise<{ project: DdProject }>, said?: string) => Promise<boolean> }) {
  const item = line.checklist!.item;
  const [wanted, setWanted] = useState(item.partial?.wanted ?? '');
  const [assumer, setAssumer] = useState(item.assumed?.assumer ?? '');
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  // The fields of this department's sheets a paper could have filled, by sheet.
  const fields = useMemo(() => {
    const catalog = fieldCatalogFor(project);
    return departmentDefinition(item.department).workstreams.flatMap((ws) => assumableFields(ws.key, catalog));
  }, [project, item.department]);
  const sheets = [...new Set(fields.map((held) => held.set.id))];
  const named = fields.find((held) => `${held.address.set}::${held.address.field}` === field);
  const stood = (item.assumed?.fields ?? []).map((held) => {
    const known = fields.find((f) => f.address.set === held.address.set && f.address.field === held.address.field);
    return `${known ? `${known.set.title} › ${known.def.label}` : held.address.field} at ${String(held.value)}`;
  });
  const patch = (body: Parameters<typeof workspaceApi.patchChecklistItem>[2], said?: string) => void change(() => workspaceApi.patchChecklistItem(project.id, item.id, body), said);

  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="space-y-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
        <label className="block text-micro text-ink-secondary">
          Partly in hand: what is still wanted
          <Input value={wanted} onChange={(e) => setWanted(e.target.value)} maxLength={200} className="mt-1" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => patch({ partial: { wanted: wanted.trim() || null } }, 'Marked partial.')}>
            {item.partial ? 'Save' : 'Mark partial'}
          </Button>
          {item.partial ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ partial: false })}>
              Not partial
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
        <label className="block text-micro text-ink-secondary">
          It will not come: who is to assume
          <Input value={assumer} onChange={(e) => setAssumer(e.target.value)} maxLength={120} className="mt-1" />
        </label>
        {stood.length ? <p className="text-[12px] text-ink-secondary">Stands in for {stood.join('; ')}</p> : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Select value={field} onChange={(e) => setField(e.target.value)} aria-label="The field it stands in for">
            <option value="">No field</option>
            {sheets.map((sheet) => (
              <optgroup key={sheet} label={fields.find((held) => held.set.id === sheet)!.set.title}>
                {fields
                  .filter((held) => held.set.id === sheet)
                  .map((held) => (
                    <option key={held.address.field} value={`${held.address.set}::${held.address.field}`}>
                      {held.def.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
          <Input value={value} onChange={(e) => setValue(e.target.value)} disabled={!named} placeholder="Assumed at" aria-label="The value assumed" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !assumer.trim() || Boolean(named && !value.trim())}
            onClick={() => patch({ assumed: { assumer: assumer.trim(), fields: named ? [{ address: named.address, value: value.trim() }] : (item.assumed?.fields ?? []) } }, 'Marked to be assumed.')}
          >
            {item.assumed ? 'Save' : 'Mark to be assumed'}
          </Button>
          {item.assumed ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ assumed: false })}>
              Take back
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* The summary                                                           */
/* ==================================================================== */

/**
 * What a consultant counts at the foot of the list: for each package and in
 * total, how many are received, partial, to be assumed and pending. Worked
 * out from the lines, so it cannot disagree with them. A package another
 * department holds is said to be theirs.
 */
function SummaryTable({ summary, department }: { summary: ChecklistSummary; department: DepartmentKey }) {
  const cell = 'px-2 py-1 text-right font-mono tabular-nums';
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-[var(--ring)]">
      <table className="w-full min-w-[26rem] text-[12px] text-ink">
        <thead>
          <tr className="bg-sunken/60 text-micro text-ink-secondary">
            <th scope="col" className="px-3 py-1.5 text-left font-medium">
              Package
            </th>
            {['Total', 'Received', 'Partial', 'To assume', 'Pending', 'Received %'].map((head) => (
              <th key={head} scope="col" className="px-2 py-1.5 text-right font-medium">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {[...summary.rows, summary.total].map((row) => {
            const elsewhere = row.key !== 'total' && !row.departments.includes(department);
            return (
              <tr key={row.key} className={cn(row.key === 'total' && 'font-semibold', elsewhere && 'text-ink-secondary')}>
                <th scope="row" className="px-3 py-1 text-left font-[inherit]">
                  {row.package}
                  {elsewhere ? <span className="ml-1.5 text-micro text-ink-muted">{row.departments.map((held) => DEPARTMENT_SHORT[held]).join(', ')}</span> : null}
                </th>
                <td className={cell}>{row.total}</td>
                <td className={cell}>{row.received}</td>
                <td className={cell}>{row.partial}</td>
                <td className={cell}>{row.assumed}</td>
                <td className={cell}>{row.pending}</td>
                <td className={cell}>{row.percent}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ==================================================================== */
/* Tender forms                                                          */
/* ==================================================================== */

/**
 * The tender forms of a project, on Procurement's list: each tender's form
 * to write out and send, and the rows a client marked "Not Applicable" on a
 * form that came back, each for a lead or signer to take or set aside.
 */
function TenderForms({ project, mayDecide, onChanged }: { project: DdProject; mayDecide: boolean; onChanged: (next: DdProject) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tenders = useMemo(() => refChoices(project, { set: TENDER_TERMS }), [project]);
  const forms = project.tenderForms ?? [];
  const rows = [...tenders.map((tender) => ({ id: tender.id, label: tender.label, standing: true })), ...forms.filter((form) => !tenders.some((tender) => tender.id === form.record)).map((form) => ({ id: form.record, label: form.package ?? form.file, standing: false }))];
  if (!rows.length) return null;

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      const out = await run();
      if (out && typeof out === 'object' && 'project' in out) onChanged((out as { project: DdProject }).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not do that', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
      <div className="px-3 py-2 text-[13px] font-semibold text-ink-secondary">Tender forms</div>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {rows.map((row) => {
          const form = forms.find((held) => held.record === row.id);
          return (
            <li key={row.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{row.label || 'Tender'}</span>
                  <span className="block text-micro text-ink-muted">
                    {form ? `Read from ${form.file}${form.responseBy ? ` · reply by ${day(form.responseBy)}` : ''}` : 'No form read into it'}
                    {row.standing ? '' : ' · open Tender terms to accept what it offered'}
                  </span>
                </span>
                <Button size="sm" variant="ghost" icon={<Download size={13} />} disabled={busy} onClick={() => void act(() => workspaceApi.saveTenderForm(project.id, row.id, `${project.reference}-tender-form`))}>
                  Export the form
                </Button>
              </div>
              {(form?.notApplicable ?? []).map((offer) => (
                <div key={offer.id} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">
                    {offer.no} {offer.item}: marked Not Applicable on the form, row {offer.row}
                  </span>
                  {mayDecide ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => workspaceApi.decideTenderFormOffer(project.id, form!.id, offer.id, 'take'))}>
                        Mark not applicable
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => workspaceApi.decideTenderFormOffer(project.id, form!.id, offer.id, 'set_aside'))}>
                        Not this
                      </Button>
                    </>
                  ) : null}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

type Only = PaperStanding | 'all' | 'unnamed' | 'undated';

/**
 * Papers owed: every paper a department waits for, as one list by who owes it.
 *
 * The documents the checks expect, the lines of a list somebody sent and the
 * requests made by hand are three records and one list here. A line says
 * where it stands (not asked, asked for, answered and waiting to be
 * confirmed, partly in hand, to be assumed, in hand) and carries what can be
 * done to it: ask, confirm a reply, mark in hand, say who owes it and by
 * when. A tracked list is counted above it, package by package. It is one
 * department's list, shown on the Documents of that department's functions.
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
  const roleAt = (desk: DepartmentKey | undefined) => (me && desk ? departmentRole(project, { email: me.email, workspaceRole: me.role }, desk) : undefined);
  const mayEdit = (desk: DepartmentKey | undefined): boolean => roleCanEdit(roleAt(desk));
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
  // Show only the lines standing one way, or the ones with nobody named or no day; and only those asked for in one round.
  const [only, setOnly] = useState<Only>('all');
  const [round, setRound] = useState<string | null>(null);
  // The consultant's count, over the whole list: its packages run across departments.
  const summary = useMemo(() => (view.tracked ? checklistSummary(project, round ? { round } : {}) : undefined), [project, view.tracked, round]);
  const shown = (line: PaperLine): boolean =>
    (only === 'all' || (only === 'unnamed' ? Boolean(line.unnamed) : only === 'undated' ? Boolean(line.undated) : line.standing === only)) && (!round || fold(line.round) === fold(round));

  const refresh = async () => onChanged(await api.getProject(project.id));
  const askable = (line: PaperLine): boolean =>
    line.standing === 'not_asked' && mayEdit(line.department) && (line.from === 'list' ? staff : line.from === 'checks' ? Boolean(line.requirement?.evidenceId) : false);
  // A line of a list still owed can be given its party and its day, whether or not it was asked for.
  const assignable = (line: PaperLine): boolean => line.from === 'list' && staff && mayEdit(line.department) && line.standing !== 'in_hand' && line.standing !== 'assumed';
  const all = view.parties.flatMap((party) => party.lines);
  const chosen = all.filter((line) => picked.has(line.key) && askable(line));
  const toAssign = all.filter((line) => picked.has(line.key) && assignable(line));
  const unnamed = chosen.filter((line) => !line.party).length;
  const startable = startWorkstream && mayEdit(department) && !requirementSheet(project, { department }).total;

  function toggle(keys: string[], on: boolean) {
    setPicked((was) => {
      const next = new Set(was);
      for (const key of keys) (on ? next.add(key) : next.delete(key));
      return next;
    });
  }

  function foldGroup(key: string) {
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

  /** Name who owes the ticked lines, and the day they are wanted by, in one act. */
  async function assign() {
    if (!recipient.trim() && !dueAt) {
      toast('Name who owes them, or the day they are wanted by.', 'warning');
      return;
    }
    const ok = await change(
      () => workspaceApi.assignChecklist(project.id, { itemIds: toAssign.map((line) => line.checklist!.item.id), ...(recipient.trim() ? { owedBy: recipient.trim() } : {}), ...(dueAt ? { targetDate: dueAt } : {}) }),
      `Set for ${toAssign.length} line${toAssign.length === 1 ? '' : 's'}.`,
    );
    if (ok) setPicked(new Set());
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(papersOwedText(view, day, only === 'all' || only === 'in_hand' || only === 'assumed' || only === 'unnamed' || only === 'undated' ? {} : { only }));
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

  const tenderForms = staff && department === 'procurement' ? <TenderForms project={project} mayDecide={roleCanDecide(roleAt('procurement'))} onChanged={onChanged} /> : null;

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
    const said = [paperLineSaid(line, day, { tracked: view.tracked }), line.where, line.remark, item?.note].filter(Boolean).join(' · ');
    const tick = askable(line) || assignable(line);
    return (
      <li key={line.key} className="px-3 py-2">
        <div className="flex items-start gap-2.5">
          {tick ? (
            <input
              type="checkbox"
              checked={picked.has(line.key)}
              onChange={(e) => toggle([line.key], e.target.checked)}
              aria-label={`Select ${line.title}`}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:h-5 coarse:w-5"
            />
          ) : (
            <span className="mt-0.5">
              <StandingMark line={line} />
            </span>
          )}
          <button type="button" disabled={!canExpand} aria-expanded={canExpand ? expanded : undefined} onClick={() => (setOpen(expanded ? null : line.key), setLinked(''))} className="min-w-0 flex-1 text-left">
            <span className={cn('block text-[13px]', line.standing === 'in_hand' || line.standing === 'assumed' ? 'text-ink-secondary' : 'text-ink')}>
              {line.ref ? <span className="mr-1.5 font-mono text-micro tabular-nums text-ink-muted">{line.ref}</span> : null}
              {line.title}
            </span>
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
          <>
            <LineForm
              start={draftOf(item)}
              busy={busy}
              submit="Save"
              more
              onSubmit={(draft) =>
                void change(() =>
                  workspaceApi.patchChecklistItem(project.id, item.id, {
                    title: draft.title.trim(),
                    stage: draft.stage?.trim() || null,
                    package: draft.package?.trim() || null,
                    owedBy: draft.owedBy?.trim() || null,
                    note: draft.note?.trim() || null,
                    targetDate: draft.targetDate?.trim() || null,
                    remark: draft.remark?.trim() || null,
                  }),
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
            {line.standing === 'in_hand' ? null : <StandingForm project={project} line={line} busy={busy} change={change} />}
          </>
        ) : null}
      </li>
    );
  }

  /** A long group is read under the headings of its own record: the discipline a check sits in, or the stage, package and sections of a list. */
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
    const mine = lines.filter((line) => askable(line) || assignable(line)).map((line) => line.key);
    const toAsk = lines.filter(askable).length;
    const every = mine.length > 0 && mine.every((key) => picked.has(key));
    const said = [party.answered ? `${party.answered} to confirm` : '', party.overdue ? `${party.overdue} overdue` : '', party.partial ? `${party.partial} partial` : '', party.notAsked ? `${party.notAsked} not asked` : ''].filter(Boolean).join(' · ');
    return (
      <section key={party.key || 'nobody'} className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
        <div className="flex items-center gap-2 rounded-xl pr-2 hover:bg-sunken/60">
          <button type="button" aria-expanded={!shut} onClick={() => foldGroup(party.key)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left coarse:min-h-11">
            <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !shut && 'rotate-90')} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{party.party ?? 'Nobody named'}</span>
              {said ? <span className={cn('block text-micro', party.overdue ? 'text-critical' : 'text-ink-muted')}>{said}</span> : null}
            </span>
            <span className="font-mono text-micro tabular-nums text-ink-secondary">{lines.length}</span>
          </button>
          {mine.length ? (
            <Button size="sm" variant="ghost" onClick={() => toggle(mine, !every)}>
              {every ? 'Clear' : toAsk === mine.length ? `Select ${mine.length} to ask` : `Select ${mine.length}`}
            </Button>
          ) : null}
        </div>
        {shut ? null : body(lines)}
      </section>
    );
  }

  const assumed = view.assumed.filter(shown);
  const inHand = view.inHand.filter((line) => !round || fold(line.round) === fold(round));
  const filters: Array<{ key: Only; label: string; n: number }> = [
    { key: 'all', label: 'All', n: view.total },
    { key: 'answered', label: PAPER_STANDING_LABEL.answered, n: view.answered },
    { key: 'partial', label: PAPER_STANDING_LABEL.partial, n: view.partial },
    { key: 'asked', label: PAPER_STANDING_LABEL.asked, n: view.asked },
    { key: 'not_asked', label: PAPER_STANDING_LABEL.not_asked, n: view.notAsked },
    { key: 'assumed', label: PAPER_STANDING_LABEL.assumed, n: view.assumed.length },
    { key: 'in_hand', label: PAPER_STANDING_LABEL.in_hand, n: view.inHand.length },
    // Who owes it and by when, where a tracked list leaves either blank.
    { key: 'unnamed', label: 'Nobody named', n: view.tracked ? view.nobodyNamed : 0 },
    { key: 'undated', label: 'No date', n: view.tracked ? view.noDate : 0 },
  ];
  const chip = (on: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
      on ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
    );

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
        {summary ? (
          <div className="space-y-2">
            <SummaryTable summary={summary} department={department} />
            {summary.rounds.length ? (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Asked in">
                <button type="button" role="tab" aria-selected={!round} onClick={() => setRound(null)} className={chip(!round)}>
                  Every round
                </button>
                {summary.rounds.map((held) => (
                  <button key={held.round} type="button" role="tab" aria-selected={fold(round ?? undefined) === fold(held.round)} onClick={() => setRound(held.round)} className={chip(fold(round ?? undefined) === fold(held.round))}>
                    Asked in {held.round}
                    <span className="font-mono tabular-nums">{held.total}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {chosen.length || toAssign.length ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
            <label className="min-w-[11rem] flex-1 text-micro text-ink-secondary">
              {toAssign.length ? 'Who owes them' : unnamed ? `Who is asked, for the ${unnamed} nobody is named for` : 'One request goes to each party, naming everything it owes'}
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Name, or their firm" className="mt-1" />
            </label>
            <label className="text-micro text-ink-secondary">
              By
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1" />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
            {toAssign.length ? (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void assign()}>
                Set for {toAssign.length}
              </Button>
            ) : null}
            {chosen.length ? (
              <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} onClick={() => void ask()}>
                Ask for {chosen.length}
              </Button>
            ) : null}
          </div>
        ) : null}
        {view.total > 8 || view.tracked ? (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
            {filters.filter((f) => f.key === 'all' || f.n).map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={only === f.key}
                onClick={() => (setOnly(f.key), f.key === 'in_hand' && setClosed((was) => new Set([...was].filter((key) => key !== 'in-hand'))))}
                className={chip(only === f.key)}
              >
                {f.label}
                <span className="font-mono tabular-nums">{f.n}</span>
              </button>
            ))}
          </div>
        ) : null}
        {view.total ? (
          <div className="space-y-2">
            {only === 'in_hand' || only === 'assumed' ? null : view.parties.map(group)}
            {assumed.length && (only === 'all' || only === 'assumed') ? (
              <section className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                <button type="button" aria-expanded={!closed.has('assumed')} onClick={() => foldGroup('assumed')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken/60 coarse:min-h-11">
                  <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !closed.has('assumed') && 'rotate-90')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink-secondary">To be assumed</span>
                    <span className="block text-micro text-ink-muted">Will not come. Owed by nobody, and not in hand.</span>
                  </span>
                  <span className="font-mono text-micro tabular-nums text-ink-secondary">{assumed.length}</span>
                </button>
                {closed.has('assumed') ? null : <ul className="divide-y divide-hairline border-t border-hairline">{assumed.map(row)}</ul>}
              </section>
            ) : null}
            {inHand.length && (only === 'all' || only === 'in_hand') ? (
              <section className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                <button type="button" aria-expanded={!closed.has('in-hand')} onClick={() => foldGroup('in-hand')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken/60 coarse:min-h-11">
                  <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !closed.has('in-hand') && 'rotate-90')} aria-hidden />
                  <span className="flex-1 text-[13px] font-semibold text-ink-secondary">In hand</span>
                  <span className="font-mono text-micro tabular-nums text-ink-secondary">{inHand.length}</span>
                </button>
                {closed.has('in-hand') ? null : <ul className="divide-y divide-hairline border-t border-hairline">{inHand.map(row)}</ul>}
              </section>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-ink-secondary">Nothing is asked for yet. Load the list of papers as it was sent, or add a line.</p>
        )}
        {tenderForms}
        {/* What the checks would want and nobody has asked for: owed by nobody yet, counted nowhere, and one press away to ask for. */}
        {view.expected.length && (only === 'all' || only === 'not_asked') && !round ? (
          <details className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
            <summary className="flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunken/60 coarse:min-h-11">
              <span className="flex-1 text-[13px] font-semibold text-ink-secondary">The checks also expect</span>
              <span className="font-mono text-micro tabular-nums text-ink-secondary">{view.expected.length}</span>
            </summary>
            <p className="border-t border-hairline px-3 py-2 text-[12px] text-ink-muted">Not asked for and not counted as owed. Tick the ones this project needs and ask for them.</p>
            <ul className="divide-y divide-hairline border-t border-hairline">{view.expected.map(row)}</ul>
          </details>
        ) : null}
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
