import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileBadge,
  FileQuestion,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Mail,
  Map as MapPinIcon,
  Receipt,
  Ruler,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  plural,
  ownedBy,
  EVIDENCE_KIND_LABEL,
  EVIDENCE_STATUS_LABEL,
  CAPTURE_PURPOSES,
  CAPTURE_PURPOSE_LABEL,
  ENVIRONMENTAL_CONDITION_CAVEAT,
  ENVIRONMENTAL_CONDITION_LABEL,
  FINDING_STATUS_LABEL,
  RICS_RATING_LABEL,
  SCOPE_LABEL,
  departmentDefinition,
  documentWorkstream,
  workstreamDefinition,
  SEVERITY_LABEL,
  describeCapture,
  observationIsUseful,
  iso19650Completeness,
  iso19650Name,
  proposedFacts,
  readingLine,
  quotesForEvidence,
  ricsConditionRating,
  type CapturePurpose,
  type DepartmentKey,
  type EnvironmentalCondition,
  type EvidenceAttachment,
  type EvidenceKind,
  type EvidenceRecord,
  type EvidenceStatus,
  type FindingRecord,
  type FindingStatus,
  type RicsEscalation,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Input, RegisterRow, Select, TONE_FILL, andList, cn, toneChip, useToast, type Tone } from '../../components/ui/kit';
import { CreateButton } from '../../components/create/CreateWizard';
import type { ProjectOutlet } from './ProjectLayout';
import { severityTone } from './shared';
import { LiveRow } from './LiveRow';
import { EvidenceProof } from './EvidenceProof';
import { OutgoingFromPaper } from '../../components/outgoing/OutgoingStart';
import { EvidenceDropButton, EvidenceDropZone } from '../../components/EvidenceDropZone';
import { useStickyState } from '../../lib/useStickyState';
import { AssignCell } from '../../components/AssignCell';
import { MineToggle, useMine } from '../../components/MineToggle';
import { DEPARTMENT_ICON } from '../../components/departments/icons';

const EVIDENCE_STATUSES = Object.keys(EVIDENCE_STATUS_LABEL) as EvidenceStatus[];
const FINDING_STATUSES = Object.keys(FINDING_STATUS_LABEL) as FindingStatus[];

const GAP_STATUSES: EvidenceStatus[] = ['expected', 'requested', 'missing'];
const FILED_STATUSES: EvidenceStatus[] = ['received', 'validated', 'used'];

/** A document somebody has actually put on the file. */
function isFiled(e: { status: EvidenceStatus; attachments: unknown[] }): boolean {
  return FILED_STATUSES.includes(e.status) || (e.attachments.length > 0 && e.status !== 'rejected');
}

type RegisterFilter = 'all' | 'gaps' | 'filed' | EvidenceStatus;

const BULK_STATUSES = ['requested', 'received', 'validated', 'missing'] satisfies EvidenceStatus[];

/** Status → tone: gaps warm, filed cool, problems loud. */
const EVIDENCE_STATUS_TONE: Record<EvidenceStatus, Tone> = {
  expected: 'neutral',
  requested: 'warning',
  received: 'info',
  validated: 'good',
  used: 'good',
  superseded: 'neutral',
  rejected: 'critical',
  missing: 'serious',
};

const EVIDENCE_KIND_ICON: Record<EvidenceKind, LucideIcon> = {
  document: FileText,
  drawing: Ruler,
  approval: ShieldCheck,
  contract: FileSignature,
  boq: FileSpreadsheet,
  invoice: Receipt,
  photograph: Camera,
  schedule: CalendarDays,
  inspection: ClipboardCheck,
  test_report: ClipboardCheck,
  certificate: FileBadge,
  correspondence: Mail,
  market_comparable: ScrollText,
  gis: MapPinIcon,
  other: FileQuestion,
};

/** Soft tile behind the kind mark — readable colour without competing with status. */
const EVIDENCE_KIND_TILE: Record<EvidenceKind, string> = {
  document: 'bg-sunken text-ink-secondary',
  drawing: 'bg-warning/20 text-[var(--status-warning-text)]',
  approval: 'bg-good/15 text-[var(--status-good-text)]',
  contract: 'bg-serious/12 text-[var(--status-serious-text)]',
  boq: 'bg-brand-soft text-brand',
  invoice: 'bg-brand-soft text-brand',
  photograph: 'bg-provenance/10 text-provenance-ink',
  schedule: 'bg-warning/20 text-[var(--status-warning-text)]',
  inspection: 'bg-good/15 text-[var(--status-good-text)]',
  test_report: 'bg-good/15 text-[var(--status-good-text)]',
  certificate: 'bg-good/15 text-[var(--status-good-text)]',
  correspondence: 'bg-sunken text-ink-secondary',
  market_comparable: 'bg-brand-soft text-brand',
  gis: 'bg-warning/20 text-[var(--status-warning-text)]',
  other: 'bg-sunken text-ink-muted',
};

const DEPT_MARK: Record<DepartmentKey, string> = {
  finance: 'bg-brand-soft text-brand',
  legal: 'bg-serious/12 text-[var(--status-serious-text)]',
  design: 'bg-warning/20 text-[var(--status-warning-text)]',
  construction: 'bg-good/15 text-[var(--status-good-text)]',
  procurement: 'bg-sunken text-ink-secondary',
  commercial: 'bg-brand-soft text-brand',
};

function evidenceRowIcon(e: EvidenceRecord): LucideIcon {
  if ((e.attachments ?? []).some((f) => f.mimeType.startsWith('image/'))) return ImageIcon;
  return EVIDENCE_KIND_ICON[e.kind] ?? FileQuestion;
}

export function EvidenceRegister() {
  const { project, setProject, highlightIds, onReviewDocument } = useOutletContext<ProjectOutlet>();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const assessmentId = searchParams.get('dd') ?? undefined;
  const focusId = searchParams.get('evidence') ?? undefined;
  const focusPage = searchParams.get('page');
  /*
   * A file with documents on it opens on them; one with none opens on what is
   * missing. Either way the choice sticks per project once somebody makes it.
   */
  const [statusFilter, setStatusFilter] = useStickyState<RegisterFilter>(
    project.id,
    'evidenceStatus',
    project.evidence.some(isFiled) ? 'filed' : 'gaps',
    (v) => v === 'all' || v === 'gaps' || v === 'filed' || (EVIDENCE_STATUSES as string[]).includes(v),
  );
  const [query, setQuery] = useState('');
  // Not sticky, unlike the status filter: "mine" is a question somebody asks
  // on the way past, and finding the register silently narrowed to it a week
  // later reads as documents having gone missing.
  const [mineOnly, setMineOnly] = useState(false);
  const [proofId, setProofId] = useState<string | null>(focusId ?? null);
  // The file of the row that was asked for by name. None means the one that was read: the row's latest.
  const [proofFileId, setProofFileId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const scoped = assessmentId ? project.evidence.filter((e) => e.assessmentIds.includes(assessmentId)) : project.evidence;
  const liveIds = [...(highlightIds ?? []), ...(focusId ? [focusId] : [])];
  // Ahead of the filter below, which reads `me`: `.filter` runs its callback
  // immediately, so a `const` declared after it is still in its dead zone.
  const { me, count: mineCount } = useMine(scoped, mineOnly);
  const rows = scoped.filter((e) => {
    if (focusId && e.id === focusId) return true;
    if (statusFilter === 'gaps' && !GAP_STATUSES.includes(e.status)) return false;
    if (statusFilter === 'filed' && !isFiled(e)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'gaps' && statusFilter !== 'filed' && e.status !== statusFilter) return false;
    if (query.trim() && !e.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (mineOnly && !(me && ownedBy(e.owner, me))) return false;
    return true;
  });
  /*
   * Two hundred and seventy-eight rows is not a list, it is a filing cabinet
   * with the drawers taken out.
   *
   * This is the screen a reviewer lives in, and it was the least organised one
   * in the product: every expected document for every scope of every
   * assessment in one flat run, narrowed only by a status filter and a title
   * search. "Which of the Legal items are still missing" was a question you
   * answered by scrolling.
   *
   * Grouped by scope, because that is the unit the work is actually divided
   * into — Technical & Design is one person's morning, Legal is another's —
   * and it is the same vocabulary the assessment pages already use. Items on
   * no scope keep a group of their own rather than being dropped: an
   * unfiled document is exactly the one somebody needs to notice.
   */
  /*
   * What is currently hiding rows, in the reader's words.
   *
   * Empty because nothing is filed and empty because a filter excluded
   * everything are opposite facts that rendered identically, and the status
   * filter defaults to `gaps` — so the most common way to see an empty
   * register is to have no outstanding documents at all.
   */
  const narrowing = [
    ...(statusFilter === 'gaps'
      ? ['outstanding']
      : statusFilter === 'filed'
        ? ['on file']
        : statusFilter === 'all'
          ? []
          : [EVIDENCE_STATUS_LABEL[statusFilter].toLowerCase()]),
    ...(query.trim() ? [`a match for \u201c${query.trim()}\u201d`] : []),
    ...(mineOnly ? ['yours'] : []),
  ];

  /*
   * Grouped by the workstream each document belongs to — Legal › Title,
   * Legal › Approvals, Construction › Site — because that is how the work is
   * divided now, and it is the same place the document shows from inside its
   * department. A document nothing has claimed yet keeps a group of its own.
   */
  const groups = useMemo(() => {
    const UNFILED = 'Not yet given to a function';
    const byName = new Map<string, { items: typeof rows; department?: DepartmentKey }>();
    for (const row of rows) {
      const ws = documentWorkstream(project, row);
      const def = ws ? workstreamDefinition(ws) : undefined;
      const name = def ? `${departmentDefinition(def.department).label.split(' ')[0]} › ${def.label}` : UNFILED;
      const bucket = byName.get(name);
      if (bucket) bucket.items.push(row);
      else byName.set(name, { items: [row], department: def?.department });
    }
    return [...byName.entries()]
      .map(([name, { items, department }]) => ({
        name,
        items,
        department,
        gaps: items.filter((e) => GAP_STATUSES.includes(e.status)).length,
      }))
      .sort((a, b) => (a.name === UNFILED ? 1 : b.name === UNFILED ? -1 : a.name.localeCompare(b.name)));
  }, [rows, project]);

  /*
   * Open when the answer fits on a screen, shut when it does not.
   *
   * Collapsing six groups a reviewer can already see is obstruction; leaving
   * two hundred rows open is the problem this exists to solve.
   */
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const openByDefault = rows.length <= 40;
  const isOpen = (name: string) => (toggled.has(name) ? !openByDefault : openByDefault);
  const toggle = (name: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  /*
   * Rows stay compact until somebody opens one. A deep-link expands that row
   * so the file they asked for is not buried under assignees and ISO names.
   */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => (focusId ? new Set([focusId]) : new Set()));
  const isExpanded = (id: string) => expandedIds.has(id);
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [reading, setReading] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) {
      setProofId(focusId);
      setExpandedIds((prev) => (prev.has(focusId) ? prev : new Set([...prev, focusId])));
    }
  }, [focusId]);

  const proof = proofId ? project.evidence.find((e) => e.id === proofId) : undefined;
  const proofQuotes = useMemo(() => (proof ? quotesForEvidence(project, proof.id) : []), [proof, project]);

  async function setStatus(id: string, status: EvidenceStatus) {
    try {
      await api.patchEvidence(project.id, id, { status });
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'critical');
    }
  }

  /**
   * Marking twenty rows "considered" one select at a time is twenty round
   * trips and twenty chances to lose your place. Selection is deliberately
   * cleared afterwards: a set that survives its own action invites a second
   * one nobody meant.
   */
  async function setStatusOfChosen(status: EvidenceStatus) {
    const ids = [...chosen];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const { project: next } = await api.setEvidenceStatusBulk(project.id, ids, status);
      setProject(next);
      setChosen(new Set());
      toast(`${ids.length} row${ids.length === 1 ? '' : 's'} set to ${EVIDENCE_STATUS_LABEL[status].toLowerCase()}`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update those rows', 'critical');
    } finally {
      setBulkBusy(false);
    }
  }

  async function readPhoto(evidenceId: string, fileId: string) {
    setReading(fileId);
    try {
      const out = await api.readPhotographs(project.id, { evidenceId, fileId });
      setProject(await api.getProject(project.id));
      const first = out.results?.[0];
      if (first?.error) toast(first.error, 'warning');
      else if (out.drafts) toast(`Read — ${out.drafts} finding${out.drafts === 1 ? '' : 's'} proposed`, 'good');
      else if (out.documents) toast('That is a photographed document; read it through extraction.', 'good');
      else toast('Read', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that photograph', 'critical');
    } finally {
      setReading(null);
    }
  }

  async function setCapture(evidenceId: string, fileId: string, body: Parameters<typeof api.setCapture>[3]) {
    try {
      await api.setCapture(project.id, evidenceId, fileId, body);
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not describe the capture', 'critical');
    }
  }

  return (
    <EvidenceDropZone
      projectId={project.id}
      rows={rows}
      onFiled={async () => setProject(await api.getProject(project.id))}
    >
      {(pick) => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          aria-label="Filter the register by status"
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="w-full max-w-xs sm:w-48"
        >
          <option value="filed">On file ({scoped.filter(isFiled).length})</option>
          <option value="gaps">Gaps ({scoped.filter((e) => GAP_STATUSES.includes(e.status)).length})</option>
          <option value="all">All ({scoped.length})</option>
          {EVIDENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EVIDENCE_STATUS_LABEL[s]} ({scoped.filter((e) => e.status === s).length})
            </option>
          ))}
        </Select>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title" className="w-full max-w-xs" />
        <MineToggle count={mineCount} on={mineOnly} onChange={setMineOnly} />
        <div className="flex-grow" />
        <div className="flex items-center gap-2">
          <CreateButton
            kind="file_evidence"
            project={project}
            onCreated={setProject}
            initial={assessmentId ? { assessmentIds: [assessmentId] } : undefined}
          />
          <EvidenceDropButton onPick={pick} />
        </div>
      </div>
      {chosen.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 ring-1 ring-inset ring-brand/25">
          <span className="text-[13px] font-medium text-brand">{chosen.size} selected</span>
          <div className="flex-grow" />
          {/* The transitions somebody actually makes to a batch: chase them,
              book them in, validate them, or record that they will not come.
              Declared without a cast so a status that does not exist is a
              compile error rather than a button with no label on it. */}
          {BULK_STATUSES.map((st) => (
            <Button
              key={st}
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => void setStatusOfChosen(st)}
            >
              {EVIDENCE_STATUS_LABEL[st]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>Clear</Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        narrowing.length === 0 ? (
          <EmptyState title="No evidence yet" description="Drop a folder of documents here." />
        ) : (
          /* An empty register and an empty filter look identical on screen and
             are opposite facts. This one used to say "No evidence yet" over a
             project holding forty-six documents — and the register opens on
             the gaps filter, so it said it on a project where nothing is
             outstanding, which is the best possible news, reported as a
             blank. Say what is hiding the rows, and offer to stop. */
          <EmptyState
            title="Nothing matches this filter"
            description={`${scoped.length} ${scoped.length === 1 ? 'item is' : 'items are'} filed here. None ${scoped.length === 1 ? 'is' : 'are'} ${andList(narrowing)}.`}
            action={
              <Button
                onClick={() => {
                  setStatusFilter('all');
                  setQuery('');
                  setMineOnly(false);
                }}
              >
                Show everything
              </Button>
            }
          />
        )
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            <div className="flex items-center gap-2.5 px-4 py-2">
              <input
                type="checkbox"
                aria-label={chosen.size === rows.length ? 'Clear selection' : 'Select every row shown'}
                checked={chosen.size > 0 && chosen.size === rows.length}
                // Some-but-not-all is its own state; a plain tick there would
                // claim the rows below the fold are selected too.
                ref={(el) => {
                  if (el) el.indeterminate = chosen.size > 0 && chosen.size < rows.length;
                }}
                onChange={(ev) => setChosen(ev.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
              />
              <span className="text-[12px] text-ink-muted">
                {chosen.size > 0 ? `${chosen.size} of ${rows.length}` : `${rows.length} shown`}
              </span>
            </div>
            {groups.map((group) => {
              const DeptIcon = group.department ? DEPARTMENT_ICON[group.department] : FileText;
              const deptMark = group.department ? DEPT_MARK[group.department] : 'bg-sunken text-ink-muted';
              return (
              <section key={group.name}>
                <h3>
                  <button
                    type="button"
                    onClick={() => toggle(group.name)}
                    aria-expanded={isOpen(group.name)}
                    className="flex w-full items-center gap-2.5 border-y border-hairline bg-sunken/50 px-4 py-2 text-left hover:bg-sunken coarse:min-h-11"
                  >
                    <ChevronRight
                      size={13}
                      className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', isOpen(group.name) && 'rotate-90')}
                      aria-hidden="true"
                    />
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', deptMark)} aria-hidden>
                      <DeptIcon size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{group.name}</span>
                    {/*
                      The gap count is the reason to open a section, so it sits
                      on the header rather than being found by opening it — but
                      only when it says something the total does not. Under the
                      Gaps filter every row in view is already a gap, and "9
                      open 9" is the same number twice.
                    */}
                    {group.gaps > 0 && group.gaps !== group.items.length ? (
                      <Badge tone="warning">{group.gaps} open</Badge>
                    ) : null}
                    <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] tabular-nums text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                      {group.items.length}
                    </span>
                  </button>
                </h3>
                {isOpen(group.name)
                  ? group.items.map((e) => {
              const Icon = evidenceRowIcon(e);
              const files = e.attachments ?? [];
              const open = isExpanded(e.id);
              const pending = onReviewDocument ? proposedFacts(e).length : 0;
              const statusTone = EVIDENCE_STATUS_TONE[e.status];
              return (
              <LiveRow
                key={e.id}
                id={e.id}
                highlightIds={liveIds}
                variant="flush"
                className={cn('relative transition-colors duration-quick', open ? 'bg-sunken/30' : 'hover:bg-sunken/40')}
              >
                <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', TONE_FILL[statusTone])} />
                <div className="flex items-start gap-2.5 px-4 py-2.5 pl-5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.title}`}
                    className="mt-2.5 shrink-0"
                    checked={chosen.has(e.id)}
                    onChange={(ev) =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (ev.target.checked) next.add(e.id);
                        else next.delete(e.id);
                        return next;
                      })
                    }
                  />
                  <span
                    className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ring-[var(--ring)]', EVIDENCE_KIND_TILE[e.kind])}
                    aria-hidden
                  >
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(e.id)}
                        aria-expanded={open}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="text-[14px] font-semibold leading-snug text-ink">{e.title}</p>
                        <p className="mt-0.5 text-[12px] text-ink-muted">
                          {EVIDENCE_KIND_LABEL[e.kind]}
                          {e.used ? ' · used' : e.considered ? ' · considered' : ''}
                          {files.length ? ` · ${plural(files.length, 'file')}` : ' · no file yet'}
                        </p>
                      </button>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone}>{EVIDENCE_STATUS_LABEL[e.status]}</Badge>
                        {pending > 0 ? (
                          <button
                            type="button"
                            onClick={() => onReviewDocument?.(e.id)}
                            aria-label={`Review the ${pending} values waiting on ${e.title}`}
                            className={cn('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-mini font-medium', toneChip('info'))}
                          >
                            <span className="size-1.5 rounded-full bg-provenance" aria-hidden />
                            {pending} to review
                          </button>
                        ) : null}
                        {files.length ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Open the proof for ${e.title}`}
                            onClick={() => {
                              setProofFileId(null);
                              setProofId(e.id);
                            }}
                          >
                            Open
                          </Button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleExpanded(e.id)}
                          aria-expanded={open}
                          aria-label={open ? `Hide details for ${e.title}` : `Show details for ${e.title}`}
                          className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink coarse:min-h-11 coarse:min-w-11"
                        >
                          <ChevronDown
                            size={16}
                            className={cn('transition-transform duration-quick ease-state', open && 'rotate-180')}
                            aria-hidden
                          />
                        </button>
                      </div>
                    </div>

                    {open ? (
                      <div className="mt-3 space-y-3 border-t border-hairline pt-3">
                        <AssignCell
                          className="-ml-1.5"
                          project={project}
                          targetId={e.id}
                          subject={e.title}
                          owner={e.owner}
                          onAssigned={setProject}
                        />
                        {e.iso19650 ? (
                          <p
                            className="font-mono text-[11px] text-ink-muted"
                            title={`ISO 19650 information container name. XX is the standard's own placeholder for a part nobody has recorded — ${iso19650Completeness(e.iso19650).known} of ${iso19650Completeness(e.iso19650).total} known.`}
                          >
                            {iso19650Name(project.reference, e.iso19650)}
                          </p>
                        ) : null}
                        {files.length ? (
                          <ul className="space-y-2 rounded-xl bg-surface p-2.5 ring-1 ring-inset ring-[var(--ring)]">
                            {files.map((f) => (
                              <li key={f.id} className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setProofFileId(f.id);
                                    setProofId(e.id);
                                  }}
                                  className="truncate text-[12px] font-medium text-brand underline"
                                >
                                  {f.fileName}
                                </button>
                                {readingLine(f.reading) ? <p className="text-[11px] text-ink-muted">{readingLine(f.reading)}</p> : null}
                                {f.mimeType.startsWith('image/') ? (
                                  <>
                                    <CaptureStrip
                                      evidence={e}
                                      attachment={f}
                                      visits={project.siteVisits ?? []}
                                      onChange={(body) => void setCapture(e.id, f.id, body)}
                                    />
                                    <ObservationStrip
                                      attachment={f}
                                      busy={reading === f.id}
                                      onRead={() => void readPhoto(e.id, f.id)}
                                    />
                                  </>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[12px] text-ink-muted">Nothing attached yet — upload a file or change the status.</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <OutgoingFromPaper projectId={project.id} row={e} />
                          <Select
                            value={e.status}
                            aria-label={`Status of ${e.title}`}
                            onChange={(ev) => void setStatus(e.id, ev.target.value as EvidenceStatus)}
                          >
                            {EVIDENCE_STATUSES.map((s) => (
                              <option key={s} value={s}>{EVIDENCE_STATUS_LABEL[s]}</option>
                            ))}
                          </Select>
                          <label className="cursor-pointer text-[12px] font-medium text-brand">
                            Upload
                            <input
                              type="file"
                              className="sr-only"
                              multiple
                              onChange={(ev) => {
                                const picked = ev.target.files;
                                if (!picked?.length) return;
                                void (async () => {
                                  try {
                                    await api.uploadEvidenceFiles(project.id, e.id, [...picked]);
                                    setProject(await api.getProject(project.id));
                                    toast('File attached', 'good');
                                  } catch (err) {
                                    toast(err instanceof Error ? err.message : 'Upload failed', 'critical');
                                  } finally {
                                    ev.target.value = '';
                                  }
                                })();
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </LiveRow>
              );
                  })
                  : null}
              </section>
              );
            })}
          </CardBody>
        </Card>
      )}
      {proof ? (
        <EvidenceProof
          projectId={project.id}
          evidence={proof}
          // The file asked for by name, else the one that was read: the row's values, pages and reading are the latest file's.
          file={proof.attachments.find((a) => a.id === proofFileId) ?? proof.attachments[proof.attachments.length - 1]}
          quotes={proofQuotes}
          citedPage={focusPage ? Number(focusPage) || undefined : undefined}
          onProject={setProject}
          onClose={() => {
            setProofId(null);
            setProofFileId(null);
            if (focusId) {
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.delete('evidence');
                  next.delete('page');
                  return next;
                },
                { replace: true },
              );
            }
          }}
        />
      ) : null}
    </div>
      )}
    </EvidenceDropZone>
  );
}

export function FindingRegister() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const focusId = searchParams.get('finding') ?? undefined;
  const liveIds = [...(highlightIds ?? []), ...(focusId ? [focusId] : [])];
  const [mineOnly, setMineOnly] = useState(false);
  const { count: mineCount, rows } = useMine(project.findings, mineOnly);

  async function setStatus(id: string, status: FindingStatus) {
    try {
      await api.patchFinding(project.id, id, status);
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'critical');
    }
  }

  async function classify(id: string, body: { escalation?: RicsEscalation | null; environmentalCondition?: EnvironmentalCondition | null }) {
    try {
      await api.classifyFinding(project.id, id, body);
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not classify', 'critical');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MineToggle count={mineCount} on={mineOnly} onChange={setMineOnly} />
        <div className="flex-grow" />
        <CreateButton kind="add_finding" project={project} onCreated={setProject} />
      </div>
      {rows.length === 0 ? (
        mineOnly && project.findings.length > 0 ? (
          <EmptyState
            title="None of these are yours"
            description={`${project.findings.length} ${project.findings.length === 1 ? 'finding is' : 'findings are'} on this register, owned by somebody else.`}
            action={<Button onClick={() => setMineOnly(false)}>Show everyone's</Button>}
          />
        ) : (
          <EmptyState title="No findings" description="Raised from check results, or added here." />
        )
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {rows.map((f) => (
              <LiveRow key={f.id} id={f.id} highlightIds={liveIds} variant="flush" className="pb-3">
                <RegisterRow
                  className="pb-0"
                  title={f.title}
                  why={f.description}
                  meta={
                    <>
                      <span>
                        {SCOPE_LABEL[f.discipline]} · {f.assessmentIds.length} DD link(s) · {f.evidenceIds.length} evidence ·{' '}
                        {f.riskIds.length} risks · {f.actionIds.length} actions
                      </span>
                      {/*
                        Inline, as on Risks. The owner had a line to itself here
                        — the fix Risks carries a comment about was never
                        applied to this register, so a column every row shares
                        was costing a line per finding.
                      */}
                      <AssignCell className="-ml-1.5" project={project} targetId={f.id} subject={f.title} owner={f.owner} onAssigned={setProject} />
                    </>
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      {/* Derived from the severity beside it, never stored — see `ricsConditionRating`. */}
                      <Badge
                        tone={severityTone(f.severity)}
                        title={`RICS condition rating ${ricsConditionRating(f.severity)}: ${RICS_RATING_LABEL[ricsConditionRating(f.severity)]}`}
                      >
                        {ricsConditionRating(f.severity)} · {SEVERITY_LABEL[f.severity]}
                      </Badge>
                      <Select
                        value={f.status}
                        aria-label={`Status of finding ${f.title}`}
                        onChange={(e) => void setStatus(f.id, e.target.value as FindingStatus)}
                      >
                        {FINDING_STATUSES.map((s) => (
                          <option key={s} value={s}>{FINDING_STATUS_LABEL[s]}</option>
                        ))}
                      </Select>
                    </div>
                  }
                />
                <div className="px-4">
                <FindingClassification finding={f} onChange={(body) => void classify(f.id, body)} />
                </div>
              </LiveRow>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/**
 * The two things a severity cannot say.
 *
 * "Serious" and "somebody could be hurt today" are different questions, and
 * RICS keeps them apart: the rating grades the defect, the escalation records
 * that a person was told before the report existed. So the toggle is its own
 * control rather than a fifth severity — and once it is on, the row asks who
 * was notified, because an escalated defect with nobody named is the gap worth
 * showing rather than the one worth hiding.
 *
 * The environmental class is on every finding rather than only the ESG ones:
 * contamination surfaces under legal (an indemnity), technical (a slab) and
 * ESG alike, and hiding the field behind a discipline would mean the finding
 * that most needs the word cannot carry it.
 */
function FindingClassification({
  finding,
  onChange,
}: {
  finding: FindingRecord;
  onChange: (body: { escalation?: RicsEscalation | null; environmentalCondition?: EnvironmentalCondition | null }) => void;
}) {
  const escalated = finding.escalation?.immediateAction ?? false;
  const [notified, setNotified] = useState(finding.escalation?.notifiedTo ?? '');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={escalated}
          onChange={(e) =>
            onChange({
              escalation: e.target.checked
                ? { immediateAction: true, notifiedTo: notified.trim() || undefined, notifiedAt: new Date().toISOString().slice(0, 10) }
                : null,
            })
          }
        />
        Immediate action
      </label>
      {escalated ? (
        <span className="flex items-center gap-1.5">
          <Input
            className="h-6 w-40 text-[11px]"
            placeholder="Who was told"
            value={notified}
            onChange={(e) => setNotified(e.target.value)}
            onBlur={() =>
              onChange({ escalation: { immediateAction: true, notifiedTo: notified.trim() || undefined, notifiedAt: finding.escalation?.notifiedAt } })
            }
          />
          {finding.escalation?.notifiedTo ? (
            <span>notified{finding.escalation.notifiedAt ? ` on ${finding.escalation.notifiedAt}` : ''}</span>
          ) : (
            <span className="text-[var(--status-warning-text)]">nobody recorded as notified</span>
          )}
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        {/*
          The unset value used to read "Not an environmental finding" — a full
          negative sentence where a placeholder belongs, which made an unset
          classification look like an assertion somebody had made about the
          finding. The label says what the control is; the option says it is
          not set yet.
        */}
        <Select
          aria-label="Environmental classification"
          title="Environmental classification"
          className="h-6 text-[11px]"
          value={finding.environmentalCondition ?? ''}
          onChange={(e) => onChange({ environmentalCondition: (e.target.value || null) as EnvironmentalCondition | null })}
        >
          <option value="">Environmental: none set</option>
          {(Object.keys(ENVIRONMENTAL_CONDITION_LABEL) as EnvironmentalCondition[]).map((c) => (
            <option key={c} value={c}>{ENVIRONMENTAL_CONDITION_LABEL[c].split(' — ')[0]}</option>
          ))}
        </Select>
        {finding.environmentalCondition ? <span title={ENVIRONMENTAL_CONDITION_CAVEAT}>ASTM E1527 · vocabulary only, no US liability protection</span> : null}
      </span>
    </div>
  );
}

/**
 * What a photograph says about itself, and the two things a person adds.
 *
 * The line above the controls is `describeCapture` — one function, so the
 * register, the check panel, the report and an agent's reading of a photograph
 * all say the same sentence with the same caveats. It names the SOURCE of
 * every fact, because "geotagged" and "somebody says this is the north
 * boundary" are different strengths of claim.
 *
 * Only purpose and visit are editable here. Position and taken-at are the
 * camera's, and while they can be corrected (on the proof view, where the
 * photograph is actually visible), doing it from a list of filenames is how a
 * coordinate gets typed against the wrong shot.
 */
function CaptureStrip({
  evidence,
  attachment,
  visits,
  onChange,
}: {
  evidence: EvidenceRecord;
  attachment: EvidenceAttachment;
  visits: Array<{ id: string; title: string; visitedOn: string }>;
  onChange: (body: { purpose?: CapturePurpose; visitId?: string; caption?: string }) => void;
}) {
  const capture = attachment.capture;
  return (
    <div className="ml-0.5 mt-0.5 space-y-1 border-l border-hairline pl-2">
      <p className="text-[11px] text-ink-muted">{describeCapture(capture)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          className="h-6 text-[11px]"
          value={capture?.purpose ?? ''}
          onChange={(e) => onChange({ purpose: (e.target.value || undefined) as CapturePurpose | undefined })}
          aria-label={`Purpose of ${attachment.fileName}`}
        >
          <option value="">No purpose recorded</option>
          {CAPTURE_PURPOSES.map((p) => (
            <option key={p} value={p}>{CAPTURE_PURPOSE_LABEL[p]}</option>
          ))}
        </Select>
        {visits.length ? (
          <Select
            className="h-6 text-[11px]"
            value={capture?.visitId ?? ''}
            onChange={(e) => onChange({ visitId: e.target.value })}
            aria-label={`Visit for ${attachment.fileName}`}
          >
            <option value="">Not on a recorded visit</option>
            {visits.map((v) => (
              <option key={v.id} value={v.id}>{v.title} — {v.visitedOn}</option>
            ))}
          </Select>
        ) : null}
        <span className="sr-only">{evidence.title}</span>
      </div>
    </div>
  );
}

/**
 * What a model saw, under what a person said, never mixed with it.
 *
 * Rendered as a quotation rather than as file content: the "Read by
 * claude-…" prefix is the cheapest possible guard against a description
 * acquiring the file's own voice, and it is the same guard `describeObservation`
 * puts on the graph node and the report.
 *
 * The proposed findings are COUNTED here and shown nowhere else. They live on
 * the AI drafts pane, where accepting one is a deliberate act with the whole
 * card in front of you — showing them inline would put a model's guess at a
 * defect in the same visual register as a filed observation, one glance away
 * from being read as a finding.
 */
function ObservationStrip({
  attachment,
  busy,
  onRead,
}: {
  attachment: EvidenceAttachment;
  busy: boolean;
  onRead: () => void;
}) {
  const observation = attachment.observation;

  if (!observation) {
    return (
      <button type="button" disabled={busy} onClick={onRead} className="ml-0.5 mt-0.5 block text-[11px] text-brand underline disabled:opacity-50">
        {busy ? 'Reading…' : 'Read this photograph'}
      </button>
    );
  }

  if (!observationIsUseful(observation)) {
    // A photograph a model could not read is a different thing from one
    // nobody has looked at, and the file says which.
    return (
      <p className="ml-0.5 mt-0.5 border-l border-hairline pl-2 text-[11px] text-ink-muted">
        Could not be read: {observation.limits ?? 'no reason recorded'}.{' '}
        <button type="button" disabled={busy} onClick={onRead} className="text-brand underline disabled:opacity-50">
          try again
        </button>
      </p>
    );
  }

  return (
    <div className="ml-0.5 mt-0.5 space-y-1 border-l-2 border-brand/30 pl-2">
      <p className="text-[11px] text-ink-secondary">
        <span className="text-ink-muted">Read by {observation.model}:</span> {observation.description}
      </p>
      {observation.notes.length ? (
        <ul className="space-y-0.5">
          {observation.notes.map((n, i) => (
            <li key={i} className="text-[11px] text-ink-secondary">
              {n.text}
              <span className="text-ink-muted"> — {(n.confidence * 100).toFixed(0)}% sure{n.wouldSettle ? `; ${n.wouldSettle} would settle it` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {observation.limits ? <p className="text-[11px] text-ink-muted">Not shown by this photograph: {observation.limits}</p> : null}
      {observation.suggestedFindings.length ? (
        <p className="text-[11px] text-[var(--status-warning-text)]">
          {observation.suggestedFindings.length} proposed — review on AI drafts
        </p>
      ) : null}
    </div>
  );
}
