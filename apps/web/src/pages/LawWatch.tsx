import { RuleRows } from '../components/law/RuleRows';
import { useState } from 'react';
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_SHORT,
  LAW_ACTIONS_A_PROJECT,
  LAW_NEXT,
  LAW_NEXT_LABEL,
  STAGES,
  lawChangeSaid,
  lawDay,
  lawLists,
  reachesEveryProject,
  ruleSourceSaid,
  type DepartmentKey,
  type LawChange,
  type LawChangeFields,
  type LawLists,
  type LawNext,
  type LawProposedAction,
  type LawRuleRowOffer,
  type LawSource,
  type LawSourceInput,
  type StageKey,
} from '@realytica/shared';
import { AboutSelect, LawFieldsEdit, LawFieldsRead, aboutChoices } from '../components/law/LawChangeFields';
import { lawWatchApi, type LawWaiting, type LawWatchShown } from '../lib/law-watch-api';
import { useAsync } from '../lib/useAsync';
import { useMe } from '../lib/useMe';
import { AiMark, Badge, Button, Callout, Card, CardBody, CardHeader, Checkbox, Disclosure, Field, Input, Modal, PageHeader, Select, Skeleton, useToast } from '../components/ui/kit';

/**
 * The firm's law and policy watch: the official pages it watches, how each
 * last read, and the changes waiting on a person.
 *
 * A change shows the lines that came and went: they are the source, and
 * what a person reads. Beside them are the change's fields (the instrument,
 * its reference and dates, the kind of change, what a figure was and is,
 * what it affects), filled by a model where one is set up and marked as a
 * model's, each a pick, a day, a number or a reference a person corrects.
 * An action is a department, a next step off a list and what it is about.
 * Nobody types a summary or an instruction, and no model writes one.
 * Nothing reaches a project until somebody presses Confirm.
 *
 * A change proposed or confirmed before this was so still shows what was
 * written then, marked as written by a model before the change.
 */

interface Draft {
  fields: LawChangeFields;
  /** Actions by project id. */
  actions: Record<string, LawProposedAction[]>;
}

function draftOf(change: LawWaiting): Draft {
  const actions: Record<string, LawProposedAction[]> = {};
  for (const project of change.bearsOn) {
    const proposed = change.proposal?.projects.find((row) => row.projectId === project.id)?.actions ?? [];
    // An action kept before actions were fields has no next step: it is shown above as it was written, and not carried into the draft.
    actions[project.id] = proposed.filter((action) => action.next && project.departments.includes(action.department));
  }
  return { fields: change.proposal?.fields ?? { affects: [] }, actions };
}

const TODAY = new Date().toISOString().slice(0, 10);

function Lines({ sign, lines, total }: { sign: '+' | '−'; lines: string[]; total: number }) {
  if (!lines.length) return null;
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <p key={i} className={`break-words font-mono text-[12px] leading-snug ${sign === '+' ? 'text-good' : 'text-ink-muted line-through'}`}>
          <span aria-hidden="true">{sign} </span>
          <span className="sr-only">{sign === '+' ? 'Added: ' : 'Removed: '}</span>
          {line}
        </p>
      ))}
      {total > lines.length ? <p className="text-[12px] text-ink-muted">and {total - lines.length} more</p> : null}
    </div>
  );
}

/** What a model wrote for a change before changes were fields, shown as that and nothing more. */
function WrittenBefore({ change }: { change: LawWaiting | LawChange }) {
  const before = [change.proposal?.summary ?? change.summary, ...(change.proposal?.projects ?? []).flatMap((row) => row.actions.filter((action) => !action.next && action.title).map((action) => `${DEPARTMENT_SHORT[action.department]}: ${action.title}`))].filter(Boolean);
  if (!before.length) return null;
  return (
    <div className="space-y-1 rounded-lg border border-hairline p-3">
      <p className="text-[11px] font-medium text-ink-muted">Written by a model, before this change</p>
      {before.map((line, i) => (
        <p key={i} className="text-[13px] text-ink-secondary">
          {line}
        </p>
      ))}
    </div>
  );
}

function Waiting({ change, lists, mayReview, busy, onConfirm, onDismiss }: { change: LawWaiting; lists: LawLists; mayReview: boolean; busy: boolean; onConfirm: (draft: Draft) => void; onDismiss: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(change));
  const setActions = (projectId: string, next: LawProposedAction[]) => setDraft((held) => ({ ...held, actions: { ...held.actions, [projectId]: next } }));
  const count = Object.values(draft.actions).reduce((sum, rows) => sum + rows.length, 0);
  // An action is about one of the things the change affects, or about the change itself.
  const abouts = aboutChoices(lists);
  return (
    <article className="space-y-3 border-b border-hairline pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <a href={change.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[14px] font-semibold text-ink hover:text-brand">
          <span className="truncate">{change.sourceTitle}</span>
          <ExternalLink size={13} className="shrink-0" />
        </a>
        <span className="text-[12px] text-ink-muted">Seen {lawDay(change.seenAt)}</span>
      </div>
      <div className="space-y-2 rounded-lg bg-sunken p-3">
        <Lines sign="+" lines={change.diff.added} total={change.diff.addedCount} />
        <Lines sign="−" lines={change.diff.removed} total={change.diff.removedCount} />
      </div>
      {(change.decidedFor ?? []).map((held) => (
        <p key={held.projectId} className="text-[12px] text-ink-muted">
          {held.decision === 'confirmed' ? 'Confirmed' : 'Dismissed'} for {held.projectName} by {held.byName ?? held.by}, {lawDay(held.at)}
          {held.decision === 'confirmed' ? ` · ${held.actionIds.length} ${held.actionIds.length === 1 ? 'action' : 'actions'}` : held.why ? `: ${held.why}` : ''}
        </p>
      ))}
      {mayReview && change.mayDecide ? (
        <>
          <WrittenBefore change={change} />
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              {change.proposal?.fields ? <AiMark size="xs" /> : null}
              {change.proposal?.fields ? 'Filled by a model from the lines above. Check each against them before confirming.' : 'Fill from the lines above.'}
            </p>
            {change.proposal?.quote ? <p className="break-words font-mono text-[12px] text-ink-muted">“{change.proposal.quote}”</p> : null}
            <LawFieldsEdit fields={draft.fields} lists={lists} onChange={(fields) => setDraft((held) => ({ ...held, fields }))} />
          </div>
          {change.bearsOn.length === 0 ? <p className="text-[12px] text-ink-muted">No project of yours is one this source bears on.</p> : null}
          {change.bearsOn.map((project) => {
            const rows = draft.actions[project.id] ?? [];
            return (
              <div key={project.id} className="space-y-2">
                <p className="text-[13px] font-medium text-ink">{project.name}</p>
                {rows.map((row, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Select aria-label="Department" value={row.department} className="w-36" onChange={(e) => setActions(project.id, rows.map((held, at) => (at === i ? { ...held, department: e.target.value as DepartmentKey } : held)))}>
                      {project.departments.map((key) => (
                        <option key={key} value={key}>{DEPARTMENT_SHORT[key]}</option>
                      ))}
                    </Select>
                    <Select aria-label="Next step" value={row.next ?? 'read_change'} className="min-w-0 flex-1 basis-56" onChange={(e) => setActions(project.id, rows.map((held, at) => (at === i ? { ...held, next: e.target.value as LawNext } : held)))}>
                      {LAW_NEXT.map((key) => (
                        <option key={key} value={key}>{LAW_NEXT_LABEL[key]}</option>
                      ))}
                    </Select>
                    <AboutSelect
                      label="What it is about"
                      value={row.about}
                      choices={abouts}
                      none="About the change itself"
                      onChange={(about) =>
                        setActions(
                          project.id,
                          rows.map((held, at) => {
                            if (at !== i) return held;
                            const { about: _was, ...rest } = held;
                            return about ? { ...rest, about } : rest;
                          }),
                        )
                      }
                    />
                    <Button variant="ghost" size="sm" aria-label="Remove action" icon={<Trash2 size={14} />} onClick={() => setActions(project.id, rows.filter((_, at) => at !== i))} />
                  </div>
                ))}
                {rows.length < LAW_ACTIONS_A_PROJECT ? (
                  <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setActions(project.id, [...rows, { department: project.departments[0]!, next: 'read_change', ...(draft.fields.affects[0] ? { about: draft.fields.affects[0] } : {}) }])}>
                    Add action
                  </Button>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !draft.fields.change} onClick={() => onConfirm(draft)}>
              {count ? `Confirm and add ${count} ${count === 1 ? 'action' : 'actions'}` : 'Confirm, no actions'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onDismiss}>Not relevant</Button>
          </div>
        </>
      ) : change.proposal ? (
        <div className="space-y-2">
          <WrittenBefore change={change} />
          {change.proposal.fields ? (
            <div className="flex items-start gap-1.5">
              <AiMark size="xs" className="mt-0.5" />
              <LawFieldsRead fields={change.proposal.fields} quote={change.proposal.quote} />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function standing(source: LawSource): { tone: 'neutral' | 'good' | 'critical' | 'warning'; says: string } {
  if (source.paused) return { tone: 'neutral', says: 'Paused' };
  if (source.lastError) return { tone: 'critical', says: 'Not read' };
  if (source.lastReadAt) return { tone: 'good', says: `Read ${lawDay(source.lastReadAt)}` };
  return { tone: 'warning', says: 'Not looked at yet' };
}

const EMPTY: LawSourceInput = { title: '', url: 'https://', jurisdiction: 'India', governs: '', departments: ['legal'], projectKinds: [], stages: [], everyDays: 7 };

function SourceForm({ start, onClose, onSave, busy }: { start: LawSourceInput; onClose: () => void; onSave: (input: LawSourceInput) => void; busy: boolean }) {
  const [form, setForm] = useState<LawSourceInput>(start);
  const set = <K extends keyof LawSourceInput>(key: K, value: LawSourceInput[K]) => setForm((held) => ({ ...held, [key]: value }));
  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((held) => held !== item) : [...list, item]);
  const ready = form.title.trim() && /^https:\/\/\S+\.\S+/.test(form.url.trim()) && form.departments.length > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Source"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSave(form)}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" required>
          <Input value={form.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Official page" required hint="An https address of a government or regulator page.">
          <Input type="url" value={form.url} maxLength={500} onChange={(e) => set('url', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Applies in" hint="A state, or India.">
            <Input value={form.jurisdiction} maxLength={60} onChange={(e) => set('jurisdiction', e.target.value)} />
          </Field>
          <Field label="Look every">
            <Select value={String(form.everyDays)} onChange={(e) => set('everyDays', Number(e.target.value))}>
              {[1, 7, 14, 30, 90].map((days) => (
                <option key={days} value={days}>{days === 1 ? 'Day' : `${days} days`}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="What it governs">
          <Input value={form.governs} maxLength={240} onChange={(e) => set('governs', e.target.value)} />
        </Field>
        <Field label="Departments" required>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {DEPARTMENT_KEYS.map((key) => (
              <Checkbox key={key} label={DEPARTMENT_SHORT[key]} checked={form.departments.includes(key)} onChange={() => set('departments', toggle(form.departments, key))} />
            ))}
          </div>
        </Field>
        <Field label="Stages" hint="None ticked: every stage.">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {STAGES.map((stage) => (
              <Checkbox key={stage.key} label={stage.label} checked={(form.stages ?? []).includes(stage.key)} onChange={() => set('stages', toggle<StageKey>(form.stages ?? [], stage.key))} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

const inputOf = (source: LawSource): LawSourceInput => ({ title: source.title, url: source.url, jurisdiction: source.jurisdiction, governs: source.governs, departments: source.departments, projectKinds: source.projectKinds, stages: source.stages ?? [], everyDays: source.everyDays });

function decidedLine(change: LawChange): string {
  const who = change.decidedByName ?? change.decidedBy ?? '';
  const when = change.decidedAt ? lawDay(change.decidedAt) : '';
  if (change.state === 'dismissed') return `Dismissed by ${who}, ${when}${change.why ? `: ${change.why}` : ''}`;
  const actions = (change.applied ?? []).reduce((sum, row) => sum + row.actionIds.length, 0);
  return `Confirmed by ${who}, ${when} · ${actions} ${actions === 1 ? 'action' : 'actions'} on ${(change.applied ?? []).map((row) => row.projectName).join(', ') || 'no project'}`;
}

export default function LawWatch() {
  // The watch is the firm's own people's: somebody working from a grant is told so, and nothing is asked of the server for them.
  const me = useMe();
  const staff = me ? reachesEveryProject(me.role) : false;
  const { data: loaded, error, loading } = useAsync(() => (staff ? lawWatchApi.open() : Promise.resolve(null)), [staff]);
  const [fresh, setFresh] = useState<LawWatchShown | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LawSource | 'new' | null>(null);
  const toast = useToast();
  const data = fresh ?? loaded;

  async function run(fn: () => Promise<LawWatchShown>, said?: string): Promise<boolean> {
    setBusy(true);
    try {
      const next = await fn();
      setFresh(next);
      const line = next.said ?? said;
      if (line) toast(line, 'good');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not go through', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const failing = data?.sources.filter((source) => source.lastError && !source.paused).length ?? 0;

  return (
    <div className="space-y-4 pb-10">
      <PageHeader
        eyebrow="Workspace"
        title="Law and policy"
        subtitle={data ? `${data.sources.length} ${data.sources.length === 1 ? 'source' : 'sources'} · ${data.waiting.length} waiting` : undefined}
        actions={
          data?.mayManage ? (
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>
              Add source
            </Button>
          ) : null
        }
      />
      {me && !staff ? (
        <Callout tone="neutral" title="Law and policy is for the firm’s own people">
          An action that comes of a change in the law is on the project it was added to.
        </Callout>
      ) : (
        <p className="text-[13px] text-ink-secondary">Watches the pages listed here only. Not legal advice.</p>
      )}

      {error ? <Callout tone="critical" title="Could not load the watch">{error}</Callout> : null}
      {staff && loading && !data ? <Skeleton className="h-64 w-full rounded-xl" /> : null}

      {data ? (
        <>
          <Card>
            <CardHeader title="Changes waiting" subtitle={`${data.waiting.length} to review${data.model ? '' : ' · no model set up, so no fields are filled for you'}`} />
            <CardBody>
              {data.waiting.length ? (
                <div className="space-y-4">
                  {data.waiting.map((change) => (
                    <Waiting
                      key={change.id}
                      change={change}
                      lists={lawLists(data.sources.find((source) => source.id === change.sourceId) ?? { departments: [...DEPARTMENT_KEYS], jurisdiction: '' }, TODAY)}
                      mayReview={data.mayReview}
                      busy={busy}
                      onConfirm={(draft) =>
                        void run(
                          () =>
                            lawWatchApi.confirm(
                              change.id,
                              draft.fields,
                              Object.entries(draft.actions)
                                .map(([projectId, actions]) => ({ projectId, actions }))
                                .filter((row) => row.actions.length),
                            ),
                          'Confirmed',
                        )
                      }
                      onDismiss={() => void run(() => lawWatchApi.dismiss(change.id), 'Dismissed')}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-ink-muted">Nothing waiting.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Sources" subtitle={`${data.sources.filter((source) => !source.paused).length} watched${failing ? ` · ${failing} not read` : ''}`} />
            <CardBody>
              {data.sources.length ? (
                <ul className="divide-y divide-hairline">
                  {data.sources.map((source) => {
                    const state = standing(source);
                    return (
                      <li key={source.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1 basis-64 space-y-1">
                          <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-ink hover:text-brand">
                            <span className="truncate">{source.title}</span>
                            <ExternalLink size={12} className="shrink-0" />
                          </a>
                          <p className="text-[12px] text-ink-secondary">
                            {source.jurisdiction} · {source.departments.map((key) => DEPARTMENT_SHORT[key]).join(', ')} · every {source.everyDays === 1 ? 'day' : `${source.everyDays} days`}
                          </p>
                          {source.governs ? <p className="text-[12px] text-ink-muted">{source.governs}</p> : null}
                          {source.lastError && !source.paused ? <p className="text-[12px] text-critical">{source.lastError}</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={state.tone}>{state.says}</Badge>
                          {data.mayManage ? (
                            <>
                              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} disabled={busy || Boolean(source.paused)} onClick={() => void run(() => lawWatchApi.look(source.id))}>
                                Look now
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => lawWatchApi.change(source.id, { ...inputOf(source), paused: !source.paused }), source.paused ? 'Resumed' : 'Paused')}>
                                {source.paused ? 'Resume' : 'Pause'}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(source)}>Edit</Button>
                              <Button size="sm" variant="ghost" aria-label={`Remove ${source.title}`} icon={<Trash2 size={13} />} disabled={busy} onClick={() => void run(() => lawWatchApi.remove(source.id), 'Removed')} />
                            </>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-muted">No sources. Add an official page to watch.</p>
              )}
            </CardBody>
          </Card>

          {data.offeredRows?.length ? (
            <Card>
              <CardHeader title="Rule rows offered" subtitle="A confirmed change of a rate offers a new dated row. It is not verified until a firm admin checks it against the instrument." />
              <CardBody>
                <ul className="divide-y divide-hairline">
                  {data.offeredRows.map((offer: LawRuleRowOffer) => (
                    <li key={offer.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                        <p className="text-[13px] font-medium text-ink">
                          {offer.row.label}: <span className="font-mono tabular-nums">{offer.row.value}</span>
                          {offer.row.unit ? ` ${offer.row.unit}` : ''}, in force from {lawDay(offer.row.from)}
                        </p>
                        <p className="text-[12px] text-ink-muted">
                          {ruleSourceSaid(offer.row.source)} · supersedes the row in force from {lawDay(offer.supersedes.from)}
                        </p>
                      </div>
                      {offer.row.verified ? (
                        <Badge tone="good">Verified by {offer.row.verifiedBy}</Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge tone="warning">Not verified</Badge>
                          {data.mayManage ? (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => lawWatchApi.verifyRow(offer.id), 'Marked verified')}>
                              Mark verified
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <RuleRows />

          {data.decided.length ? (
            <Disclosure title="Decided" count={data.decided.length}>
              <ul className="space-y-2">
                {data.decided.map((change) => (
                  <li key={change.id} className="text-[13px]">
                    <a href={change.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-brand">{change.sourceTitle}</a>
                    <span className="text-ink-muted"> · seen {lawDay(change.seenAt)}</span>
                    {change.fields ? <p className="text-ink-secondary">{lawChangeSaid(change.fields)}</p> : null}
                    {!change.fields && change.summary ? (
                      <p className="text-ink-secondary">
                        {change.summary} <span className="text-[12px] text-ink-muted">Written by a model, before this change.</span>
                      </p>
                    ) : null}
                    <p className="text-[12px] text-ink-muted">{decidedLine(change)}</p>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <SourceForm
          start={editing === 'new' ? EMPTY : inputOf(editing)}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            void run(() => (editing === 'new' ? lawWatchApi.add(input) : lawWatchApi.change(editing.id, { ...input, paused: Boolean(editing.paused) })), 'Saved').then((ok) => {
              if (ok) setEditing(null);
            })
          }
        />
      ) : null}
    </div>
  );
}
