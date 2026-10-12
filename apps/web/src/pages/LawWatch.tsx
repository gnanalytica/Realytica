import { useState } from 'react';
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DEPARTMENT_KEYS, DEPARTMENT_SHORT, LAW_ACTIONS_A_PROJECT, STAGES, lawDay, type DepartmentKey, type LawChange, type LawProposedAction, type LawSource, type LawSourceInput, type StageKey } from '@realytica/shared';
import { lawWatchApi, type LawWaiting, type LawWatchShown } from '../lib/law-watch-api';
import { useAsync } from '../lib/useAsync';
import { AiMark, Badge, Button, Callout, Card, CardBody, CardHeader, Checkbox, Disclosure, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea, useToast } from '../components/ui/kit';

/**
 * The firm's law and policy watch: the official pages it watches, how each
 * last read, and the changes waiting on a person.
 *
 * A change shows the lines that came and went. Where a model proposed a
 * summary and actions they are marked as a model's and open in boxes a
 * person edits. Nothing reaches a project until somebody presses Confirm.
 */

interface Draft {
  summary: string;
  /** Actions by project id. */
  actions: Record<string, LawProposedAction[]>;
}

function draftOf(change: LawWaiting): Draft {
  const actions: Record<string, LawProposedAction[]> = {};
  for (const project of change.bearsOn) {
    const proposed = change.proposal?.projects.find((row) => row.projectId === project.id)?.actions ?? [];
    actions[project.id] = proposed.filter((action) => project.departments.includes(action.department));
  }
  return { summary: change.proposal?.summary ?? '', actions };
}

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

function Waiting({ change, mayReview, busy, onConfirm, onDismiss }: { change: LawWaiting; mayReview: boolean; busy: boolean; onConfirm: (draft: Draft) => void; onDismiss: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(change));
  const setActions = (projectId: string, next: LawProposedAction[]) => setDraft((held) => ({ ...held, actions: { ...held.actions, [projectId]: next } }));
  const count = Object.values(draft.actions).reduce((sum, rows) => sum + rows.filter((row) => row.title.trim()).length, 0);
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
      {mayReview ? (
        <>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                {change.proposal ? <AiMark size="xs" /> : null}
                What changed
              </span>
            }
            hint={change.proposal ? 'Proposed by a model. Read the lines above and edit before confirming.' : undefined}
          >
            <Textarea rows={3} value={draft.summary} maxLength={1200} onChange={(e) => setDraft((held) => ({ ...held, summary: e.target.value }))} />
          </Field>
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
                    <Input aria-label="Action" className="min-w-[12rem] flex-1" value={row.title} maxLength={200} onChange={(e) => setActions(project.id, rows.map((held, at) => (at === i ? { ...held, title: e.target.value } : held)))} />
                    <Button variant="ghost" size="sm" aria-label="Remove action" icon={<Trash2 size={14} />} onClick={() => setActions(project.id, rows.filter((_, at) => at !== i))} />
                  </div>
                ))}
                {rows.length < LAW_ACTIONS_A_PROJECT ? (
                  <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setActions(project.id, [...rows, { department: project.departments[0]!, title: '' }])}>
                    Add action
                  </Button>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !draft.summary.trim()} onClick={() => onConfirm(draft)}>
              {count ? `Confirm and add ${count} ${count === 1 ? 'action' : 'actions'}` : 'Confirm, no actions'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onDismiss}>Not relevant</Button>
          </div>
        </>
      ) : change.proposal ? (
        <p className="flex items-start gap-1.5 text-[13px] text-ink-secondary">
          <AiMark size="xs" className="mt-0.5" />
          <span>{change.proposal.summary}</span>
        </p>
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
  const { data: loaded, error, loading } = useAsync(() => lawWatchApi.open(), []);
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
      <p className="text-[13px] text-ink-secondary">Watches the pages listed here only. Not legal advice.</p>

      {error ? <Callout tone="critical" title="Could not load the watch">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-64 w-full rounded-xl" /> : null}

      {data ? (
        <>
          <Card>
            <CardHeader title="Changes waiting" subtitle={`${data.waiting.length} to review${data.model ? '' : ' · no model set up, so no proposals'}`} />
            <CardBody>
              {data.waiting.length ? (
                <div className="space-y-4">
                  {data.waiting.map((change) => (
                    <Waiting
                      key={change.id}
                      change={change}
                      mayReview={data.mayReview}
                      busy={busy}
                      onConfirm={(draft) =>
                        void run(
                          () =>
                            lawWatchApi.confirm(
                              change.id,
                              draft.summary.trim(),
                              Object.entries(draft.actions)
                                .map(([projectId, actions]) => ({ projectId, actions: actions.filter((action) => action.title.trim()) }))
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

          {data.decided.length ? (
            <Disclosure title="Decided" count={data.decided.length}>
              <ul className="space-y-2">
                {data.decided.map((change) => (
                  <li key={change.id} className="text-[13px]">
                    <a href={change.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-brand">{change.sourceTitle}</a>
                    <span className="text-ink-muted"> · seen {lawDay(change.seenAt)}</span>
                    {change.summary ? <p className="text-ink-secondary">{change.summary}</p> : null}
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
