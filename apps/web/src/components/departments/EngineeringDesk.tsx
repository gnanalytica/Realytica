import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Circle, ClipboardCheck, Clock, Copy, Download, FileStack, FolderInput, IndianRupee, Send } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  DEPARTMENTS,
  REQUIREMENT_STATUS_LABEL,
  departmentRole,
  engineeringSummary,
  remedialCostSummary,
  requirementSheet,
  requirementSheetCsv,
  requirementSheetText,
  roleCanEdit,
  supportingDocuments,
  type DdProject,
  type DepartmentKey,
  type FindingSeverity,
  type RequirementItem,
  type RequirementStatus,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { workspaceApi } from '../../lib/workspace-api';
import { money } from '../../lib/format';
import { useMe } from '../../lib/useMe';
import { CompletenessRing, RemedialCostChart } from '../charts';
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, StatTile, TONE_FILL, cn, useToast, type Tone } from '../ui/kit';
import { RESULT_TONE } from './WorkstreamRecords';

const SEVERITY_TONE: Record<FindingSeverity, Tone> = { critical: 'critical', high: 'serious', medium: 'warning', low: 'neutral' };
const SEVERITY_LABEL: Record<FindingSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const SEVERITY_ORDER: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

const STATUS_TONE: Record<RequirementStatus, Tone> = { pending: 'neutral', requested: 'warning', received: 'good' };

function useMayEdit(project: DdProject, department: DepartmentKey): boolean {
  const me = useMe();
  return me ? roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, department)) : false;
}

/* ==================================================================== */
/* The dashboard                                                         */
/* ==================================================================== */

/** One discipline's open findings as a stacked bar: its length is the count, its colours the severities. */
function SeverityBar({ counts, max }: { counts: Record<FindingSeverity, number>; max: number }) {
  const total = SEVERITY_ORDER.reduce((n, s) => n + counts[s], 0);
  return (
    <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]" role="img" aria-label={`${total} open: ${SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(', ') || 'none'}`}>
      {SEVERITY_ORDER.map((s) =>
        counts[s] ? <span key={s} className={cn('h-full', TONE_FILL[SEVERITY_TONE[s]])} style={{ width: `${(counts[s] / Math.max(max, 1)) * 100}%` }} /> : null,
      )}
    </span>
  );
}

/**
 * The technical picture at a glance: four figures, then the disciplines side
 * by side. Every figure is read off the registers, so it moves when a check
 * is answered, a finding raised or a document filed — from here or the chat.
 */
export function EngineeringDashboard({
  project,
  department = 'construction',
  show = 'all',
  onOpenFindings,
  onOpenActions,
}: {
  project: DdProject;
  department?: DepartmentKey;
  /** The four figures, the charts, or both. */
  show?: 'all' | 'figures' | 'charts';
  onOpenFindings: () => void;
  onOpenActions: () => void;
}) {
  const summary = useMemo(() => engineeringSummary(project, department), [project, department]);
  const cost = useMemo(() => remedialCostSummary(project), [project]);
  const maxFindings = Math.max(1, ...summary.disciplines.map((d) => d.openFindings));
  const material = summary.findings.bySeverity.critical + summary.findings.bySeverity.high;
  const hasCost = cost.rows.some((r) => r.count > 0);
  const withChecks = summary.disciplines.filter((d) => d.checks.total > 0);

  return (
    <div className="space-y-4">
      {show === 'charts' ? null : (
      <div className="grid grid-cols-2 gap-3 [@container(min-width:52rem)]:grid-cols-4">
        <StatTile
          label="Documents in hand"
          value={summary.documents.total ? `${summary.documents.received}/${summary.documents.total}` : '—'}
          hint={summary.documents.total ? `${summary.documents.requested} asked for${summary.documents.overdue ? ` · ${summary.documents.overdue} overdue` : ''}` : 'None expected'}
          tone={summary.documents.overdue ? 'warning' : 'neutral'}
          icon={<FileStack size={15} />}
        />
        <StatTile
          label="Checks answered"
          value={summary.checks.total ? `${summary.checks.answered}/${summary.checks.total}` : '—'}
          hint={summary.checks.issues ? `${summary.checks.issues} with an issue` : summary.checks.total ? 'No issues' : 'None yet'}
          tone={summary.checks.issues ? 'warning' : 'neutral'}
          icon={<ClipboardCheck size={15} />}
        />
        <StatTile
          label="Open findings"
          value={summary.findings.open}
          hint={material ? `${material} critical or high` : 'None critical or high'}
          tone={summary.findings.bySeverity.critical ? 'critical' : material ? 'serious' : 'neutral'}
          icon={<AlertTriangle size={15} />}
        />
        <StatTile
          label="Cost to remedy"
          value={cost.total ? money(cost.total, project.currency, { compact: true }) : '—'}
          hint={cost.uncosted + cost.unbanded ? `${cost.uncosted + cost.unbanded} action${cost.uncosted + cost.unbanded === 1 ? '' : 's'} not yet costed` : cost.total ? 'All costed' : 'None costed'}
          tone="neutral"
          icon={<IndianRupee size={15} />}
        />
      </div>
      )}

      {show === 'figures' ? null : (
        <>
      <div className="grid grid-cols-1 gap-4 [@container(min-width:56rem)]:grid-cols-2">
        <Card>
          <CardHeader
            title="Findings by discipline"
            subtitle={summary.findings.open ? 'Open, by severity' : undefined}
            action={
              summary.findings.open ? (
                <Button size="sm" variant="ghost" onClick={onOpenFindings}>
                  Open the register
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {summary.findings.open ? (
              <>
                <ul className="space-y-2.5">
                  {summary.disciplines
                    .filter((d) => d.openFindings)
                    .map((d) => (
                      <li key={d.scopeKey}>
                        <button type="button" onClick={onOpenFindings} className="group block w-full rounded-lg px-1 py-0.5 text-left hover:bg-sunken/60">
                          <span className="flex items-baseline justify-between gap-2 text-[13px]">
                            <span className="text-ink">{d.label}</span>
                            <span className="font-mono text-micro tabular-nums text-ink-secondary">{d.openFindings}</span>
                          </span>
                          <span className="mt-1 block">
                            <SeverityBar counts={d.findings} max={maxFindings} />
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
                <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-secondary" aria-label="Severity key">
                  {SEVERITY_ORDER.map((s) => (
                    <li key={s} className="inline-flex items-center gap-1.5">
                      <span className={cn('size-2 rounded-full', TONE_FILL[SEVERITY_TONE[s]])} aria-hidden />
                      {SEVERITY_LABEL[s]} · {summary.findings.bySeverity[s]}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[13px] text-ink-secondary">No open findings.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Checks by discipline" subtitle={withChecks.length ? 'Answered, and with an issue' : undefined} />
          <CardBody>
            {withChecks.length ? (
              <ul className="space-y-2.5">
                {withChecks.map((d) => {
                  const clear = d.checks.answered - d.checks.issues;
                  return (
                    <li key={d.scopeKey}>
                      <span className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="text-ink">{d.label}</span>
                        <span className="font-mono text-micro tabular-nums text-ink-secondary">
                          {d.checks.answered}/{d.checks.total}
                        </span>
                      </span>
                      <span
                        className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]"
                        role="img"
                        aria-label={`${d.checks.answered} of ${d.checks.total} answered, ${d.checks.issues} with an issue`}
                      >
                        <span className={cn('h-full', TONE_FILL.good)} style={{ width: `${(clear / d.checks.total) * 100}%` }} />
                        <span className={cn('h-full', TONE_FILL.serious)} style={{ width: `${(d.checks.issues / d.checks.total) * 100}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-secondary">No checks yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {hasCost ? (
        <Card>
          <CardHeader
            title="Remedial cost"
            subtitle="By when it is needed"
            action={
              <Button size="sm" variant="ghost" onClick={onOpenActions}>
                Open the actions
              </Button>
            }
          />
          <CardBody>
            <RemedialCostChart summary={cost} onSelect={() => onOpenActions()} />
          </CardBody>
        </Card>
      ) : null}
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* The requirement sheet                                                 */
/* ==================================================================== */

type Filter = 'all' | RequirementStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Not asked' },
  { key: 'requested', label: 'Asked for' },
  { key: 'received', label: 'In hand' },
];

function StatusMark({ status, overdue }: { status: RequirementStatus; overdue?: boolean }) {
  if (status === 'received') return <CheckCircle2 size={16} className="shrink-0 text-good" aria-label="In hand" />;
  if (status === 'requested') return <Clock size={16} className={cn('shrink-0', overdue ? 'text-critical' : 'text-warning')} aria-label={overdue ? 'Asked for, overdue' : 'Asked for'} />;
  return <Circle size={16} className="shrink-0 text-ink-muted" aria-label="Not asked" />;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Every document the checks expect, as a checklist to work down.
 *
 * Tick the ones to chase, name who is being asked and by when, and one press
 * sends a tracked request for each. A line turns to "in hand" on its own when
 * the paper is filed — in Documents, in the chat, or against the request.
 */
export function RequirementSheetCard({
  project,
  department = 'construction',
  startWorkstream = 'construction.quality',
  onChanged,
  onOpenDocument,
  onOpenCheck,
}: {
  project: DdProject;
  department?: DepartmentKey;
  /** The workstream whose checks start the sheet when the file has none. */
  startWorkstream?: string;
  onChanged: () => Promise<void> | void;
  onOpenDocument: (evidenceId: string) => void;
  onOpenCheck: (where: { ddId: string; scopeId: string; checkId: string }) => void;
}) {
  const toast = useToast();
  const mayEdit = useMayEdit(project, department);
  const sheet = useMemo(() => requirementSheet(project, { department }), [project, department]);
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [recipient, setRecipient] = useState(project.developer ?? project.owner ?? '');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const askable = (i: RequirementItem) => i.status === 'pending' && Boolean(i.evidenceId);
  const pendingIds = sheet.groups.flatMap((g) => g.items.filter(askable).map((i) => i.evidenceId!));
  const chosen = pendingIds.filter((id) => picked.has(id));

  function toggle(id: string) {
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start() {
    setBusy(true);
    try {
      await workspaceApi.startWorkstreamChecks(project.id, startWorkstream);
      await onChanged();
      toast('Checks added.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the checks', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (!recipient.trim()) {
      toast('Say who is being asked.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const rows = sheet.groups.flatMap((g) => g.items).filter((i) => i.evidenceId && chosen.includes(i.evidenceId));
      for (const item of rows) {
        await api.createRequest(project.id, { title: item.title, recipient: recipient.trim(), dueAt: dueAt || undefined, evidenceId: item.evidenceId, send: true });
      }
      setPicked(new Set());
      await onChanged();
      toast(`Asked ${recipient.trim()} for ${rows.length} document${rows.length === 1 ? '' : 's'}.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the requests', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(requirementSheetText(sheet, filter === 'all' ? {} : { only: filter }));
      toast('Copied.', 'good');
    } catch {
      toast('Could not copy.', 'warning');
    }
  }

  if (!sheet.total) {
    return (
      <Card>
        <CardHeader icon={<FileStack size={15} />} title="Requirement sheet" subtitle="Documents to ask for" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">Nothing expected yet. Start the checks to build the list.</p>
            {mayEdit ? (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void start()}>
                Start the checks
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        icon={<FileStack size={15} />}
        title="Requirement sheet"
        subtitle={`${sheet.received}/${sheet.total} in hand · ${sheet.requested} asked for${sheet.overdue ? ` · ${sheet.overdue} overdue` : ''}`}
        action={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => download(`${project.reference}-requirement-sheet.csv`, requirementSheetCsv(sheet), 'text/csv')}>
              Export
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <CompletenessRing score={sheet.percent} size={92} label="In hand" />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]" role="img" aria-label={`${sheet.received} in hand, ${sheet.requested} asked for, ${sheet.pending} not asked`}>
              <span className={cn('h-full', TONE_FILL.good)} style={{ width: `${(sheet.received / sheet.total) * 100}%` }} />
              <span className={cn('h-full', TONE_FILL.warning)} style={{ width: `${(sheet.requested / sheet.total) * 100}%` }} />
            </span>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
              {FILTERS.map((f) => {
                const n = f.key === 'all' ? sheet.total : sheet[f.key];
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
            </div>
          </div>
        </div>

        {mayEdit && pendingIds.length ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-sunken/60 p-2.5 ring-1 ring-inset ring-[var(--ring)]">
            <label className="min-w-[11rem] flex-1 text-micro text-ink-secondary">
              Ask
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Who" className="mt-1" />
            </label>
            <label className="text-micro text-ink-secondary">
              By
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1" />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(chosen.length === pendingIds.length ? [] : pendingIds))}>
              {chosen.length === pendingIds.length ? 'Clear' : `Select all ${pendingIds.length}`}
            </Button>
            <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} disabled={!chosen.length} onClick={() => void ask()}>
              Ask for {chosen.length || 'selected'}
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          {sheet.groups.map((group) => {
            const items = group.items.filter((i) => filter === 'all' || i.status === filter);
            if (!items.length) return null;
            const shut = closed.has(group.key);
            return (
              <section key={group.key} className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() =>
                    setClosed((was) => {
                      const next = new Set(was);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-sunken/60 coarse:min-h-11"
                >
                  <ChevronRight size={14} className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', !shut && 'rotate-90')} aria-hidden />
                  <span className="flex-1 text-[13px] font-semibold text-ink">{group.label}</span>
                  <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)] sm:flex" aria-hidden>
                    <span className={cn('h-full', TONE_FILL.good)} style={{ width: `${(group.received / group.items.length) * 100}%` }} />
                    <span className={cn('h-full', TONE_FILL.warning)} style={{ width: `${(group.requested / group.items.length) * 100}%` }} />
                  </span>
                  <span className="font-mono text-micro tabular-nums text-ink-secondary">
                    {group.received}/{group.items.length}
                  </span>
                </button>
                {shut ? null : (
                  <ul className="divide-y divide-hairline border-t border-hairline">
                    {items.map((item) => {
                      const id = item.evidenceId ?? item.title;
                      const canPick = mayEdit && askable(item);
                      const expanded = open === `${group.key}:${id}`;
                      return (
                        <li key={id} className="px-3 py-2">
                          <div className="flex items-start gap-2.5">
                            {canPick ? (
                              <input
                                type="checkbox"
                                checked={picked.has(item.evidenceId!)}
                                onChange={() => toggle(item.evidenceId!)}
                                aria-label={`Ask for ${item.title}`}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:h-5 coarse:w-5"
                              />
                            ) : (
                              <span className="mt-0.5">
                                <StatusMark status={item.status} overdue={item.overdue} />
                              </span>
                            )}
                            <button type="button" onClick={() => setOpen(expanded ? null : `${group.key}:${id}`)} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
                              <span className={cn('block text-[13px]', item.status === 'received' ? 'text-ink-secondary' : 'text-ink')}>{item.title}</span>
                              {item.status === 'requested' ? (
                                <span className={cn('block text-micro', item.overdue ? 'text-critical' : 'text-ink-muted')}>
                                  Asked of {item.askedOf ?? 'someone'}
                                  {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${item.overdue ? ' (overdue)' : ''}` : ''}
                                </span>
                              ) : item.status === 'received' && item.fileName ? (
                                <span className="block truncate text-micro text-ink-muted">{item.fileName}</span>
                              ) : null}
                            </button>
                            <Badge tone={STATUS_TONE[item.status]}>{REQUIREMENT_STATUS_LABEL[item.status]}</Badge>
                            {item.status === 'received' && item.evidenceId ? (
                              <Button size="sm" variant="ghost" onClick={() => onOpenDocument(item.evidenceId!)}>
                                Open
                              </Button>
                            ) : null}
                          </div>
                          {expanded ? (
                            <ul className="mt-2 space-y-1 pl-[26px]">
                              {item.checks.map((c) => (
                                <li key={c.id}>
                                  <button type="button" onClick={() => onOpenCheck(c.where)} className="flex w-full items-center gap-2 rounded-lg py-0.5 text-left text-[12px] text-ink-secondary hover:text-ink">
                                    <Check size={12} className="shrink-0 text-ink-muted" aria-hidden />
                                    <span className="min-w-0 flex-1">Needed for: {c.title}</span>
                                    <Badge tone={RESULT_TONE[c.result]}>{CHECK_RESULT_LABEL[c.result]}</Badge>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

/* ==================================================================== */
/* Supporting documents                                                  */
/* ==================================================================== */

/**
 * What the client handed over that belongs to a department this project does
 * not run. Still read, still citable; given a place here by hand when the
 * engineering work relies on it.
 */
export function SupportingDocumentsCard({
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
  const mayEdit = useMayEdit(project, department);
  const docs = useMemo(() => supportingDocuments(project), [project]);
  const [busy, setBusy] = useState<string | null>(null);
  const targets = DEPARTMENTS.find((d) => d.key === department)?.workstreams.filter((w) => w.status === 'live') ?? [];
  if (!docs.length) return null;

  async function use(evidenceId: string, workstream: string) {
    setBusy(evidenceId);
    try {
      const res = await workspaceApi.setDocumentWorkstream(project.id, evidenceId, workstream);
      onChanged(res.project);
      toast('Filed.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not move the document', 'critical');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<FolderInput size={15} />}
        title="Supporting documents"
        subtitle={`${docs.length} from departments this project does not run`}
      />
      <CardBody>
        <ul className="divide-y divide-hairline">
          {docs.map(({ evidence, homeLabel }) => (
            <li key={evidence.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <button type="button" onClick={() => onOpenDocument(evidence.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] text-ink hover:underline" title={evidence.title}>
                  {evidence.title}
                </span>
                <span className="block text-micro text-ink-muted">
                  {evidence.documentType ?? 'Document'}
                  {homeLabel ? ` · would sit in ${homeLabel}` : ''}
                </span>
              </button>
              {mayEdit && targets.length ? (
                <Select aria-label={`Use ${evidence.title} in`} value="" disabled={busy === evidence.id} onChange={(e) => e.target.value && void use(evidence.id, e.target.value)} className="w-auto">
                  <option value="">Use in…</option>
                  {targets.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
