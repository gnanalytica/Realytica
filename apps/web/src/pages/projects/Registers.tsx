import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
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
  SEVERITY_LABEL,
  describeCapture,
  observationIsUseful,
  iso19650Completeness,
  iso19650Name,
  quotesForEvidence,
  ricsConditionRating,
  type CapturePurpose,
  type EnvironmentalCondition,
  type EvidenceAttachment,
  type EvidenceRecord,
  type EvidenceKind,
  type EvidenceStatus,
  type FindingRecord,
  type FindingSeverity,
  type FindingStatus,
  type Iso19650Ref,
  type RicsEscalation,
  type ScopeKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Textarea, cn, useToast , Why } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { severityTone } from './shared';
import { LiveRow } from './LiveRow';
import { EvidenceProof } from './EvidenceProof';
import { EvidenceDropButton, EvidenceDropZone } from '../../components/EvidenceDropZone';
import { useStickyState } from '../../lib/useStickyState';
import { AssignCell } from '../../components/AssignCell';
import { MineToggle, useMine } from '../../components/MineToggle';

const EVIDENCE_STATUSES = Object.keys(EVIDENCE_STATUS_LABEL) as EvidenceStatus[];
const FINDING_STATUSES = Object.keys(FINDING_STATUS_LABEL) as FindingStatus[];

const GAP_STATUSES: EvidenceStatus[] = ['expected', 'requested', 'missing'];

const BULK_STATUSES = ['requested', 'received', 'validated', 'missing'] satisfies EvidenceStatus[];

export function EvidenceRegister() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const assessmentId = searchParams.get('dd') ?? undefined;
  const focusId = searchParams.get('evidence') ?? undefined;
  const focusPage = searchParams.get('page');
  const [statusFilter, setStatusFilter] = useStickyState<'all' | 'gaps' | EvidenceStatus>(
    project.id,
    'evidenceStatus',
    'gaps',
    (v) => v === 'all' || v === 'gaps' || (EVIDENCE_STATUSES as string[]).includes(v),
  );
  const [query, setQuery] = useState('');
  // Not sticky, unlike the status filter: "mine" is a question somebody asks
  // on the way past, and finding the register silently narrowed to it a week
  // later reads as documents having gone missing.
  const [mineOnly, setMineOnly] = useState(false);
  const [proofId, setProofId] = useState<string | null>(focusId ?? null);
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
    if (statusFilter !== 'all' && statusFilter !== 'gaps' && e.status !== statusFilter) return false;
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
  const groups = useMemo(() => {
    const scopeName = new Map<string, string>();
    for (const assessment of project.assessments) {
      for (const scope of assessment.scopes) {
        scopeName.set(
          scope.id,
          project.assessments.length > 1
            ? `${SCOPE_LABEL[scope.scopeKey]} · ${assessment.name}`
            : SCOPE_LABEL[scope.scopeKey],
        );
      }
    }
    const UNFILED = 'Not tied to a scope';
    const byName = new Map<string, typeof rows>();
    for (const row of rows) {
      // A document can serve several scopes; it is filed under the first so
      // the counts across the groups still add up to the number shown.
      const name = row.scopeInstanceIds.map((id) => scopeName.get(id)).find(Boolean) ?? UNFILED;
      const bucket = byName.get(name);
      if (bucket) bucket.push(row);
      else byName.set(name, [row]);
    }
    return [...byName.entries()]
      .map(([name, items]) => ({
        name,
        items,
        gaps: items.filter((e) => GAP_STATUSES.includes(e.status)).length,
      }))
      // Unfiled last; everything else alphabetical, which is stable as the
      // register grows rather than reordering itself on every upload.
      .sort((a, b) => (a.name === UNFILED ? 1 : b.name === UNFILED ? -1 : a.name.localeCompare(b.name)));
  }, [rows, project.assessments]);

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

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EvidenceKind>('document');
  const [source, setSource] = useState('');
  const [iso, setIso] = useState<Iso19650Ref>({});
  const [reading, setReading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (focusId) setProofId(focusId);
  }, [focusId]);

  const proof = proofId ? project.evidence.find((e) => e.id === proofId) : undefined;
  const proofQuotes = useMemo(() => (proof ? quotesForEvidence(project, proof.id) : []), [proof, project]);

  async function add() {
    setBusy(true);
    try {
      await api.addEvidence(project.id, {
        title,
        kind,
        source: source || undefined,
        status: 'received',
        assessmentIds: assessmentId ? [assessmentId] : [],
        iso19650: Object.values(iso).some(Boolean) ? iso : undefined,
      });
      setProject(await api.getProject(project.id));
      setOpen(false);
      setTitle('');
      setIso({});
      toast('Evidence recorded', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add evidence', 'critical');
    } finally {
      setBusy(false);
    }
  }

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
      else if (out.documents) toast('That is a photographed document — read through extraction instead', 'good');
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
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full max-w-xs sm:w-48">
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
          <Button variant="secondary" onClick={() => setOpen(true)}>Record an item</Button>
          <EvidenceDropButton onPick={pick} />
        </div>
      </div>
      {chosen.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 ring-1 ring-inset ring-brand/25">
          <span className="text-[12.5px] font-medium text-brand">{chosen.size} selected</span>
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
        <EmptyState
        title="No evidence yet"
        description="Drop a folder of documents here."
      />
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
              <span className="text-[11.5px] text-ink-muted">
                {chosen.size > 0 ? `${chosen.size} of ${rows.length}` : `${rows.length} shown`}
              </span>
            </div>
            {groups.map((group) => (
              <section key={group.name}>
                <h3>
                  <button
                    type="button"
                    onClick={() => toggle(group.name)}
                    aria-expanded={isOpen(group.name)}
                    className="flex w-full items-center gap-2 border-y border-hairline bg-sunken/60 px-4 py-1.5 text-left hover:bg-sunken"
                  >
                    <ChevronRight
                      size={13}
                      className={cn('shrink-0 text-ink-muted transition-transform duration-quick ease-state', isOpen(group.name) && 'rotate-90')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{group.name}</span>
                    {/*
                      The gap count is the reason to open a section, so it sits
                      on the header rather than being found by opening it — but
                      only when it says something the total does not. Under the
                      Gaps filter every row in view is already a gap, and "9
                      open 9" is the same number twice.
                    */}
                    {group.gaps > 0 && group.gaps !== group.items.length ? (
                      <span className="shrink-0 rounded-full bg-warning/25 px-1.5 text-[10px] tabular-nums text-ink">{group.gaps} open</span>
                    ) : null}
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{group.items.length}</span>
                  </button>
                </h3>
                {isOpen(group.name)
                  ? group.items.map((e) => (
              <LiveRow key={e.id} id={e.id} highlightIds={liveIds} variant="flush" className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.title}`}
                    className="mt-1 shrink-0"
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
                <div>
                  <p className="text-[13px] font-medium text-ink">{e.title}</p>
                  <p className="text-[12px] text-ink-muted">
                    {EVIDENCE_KIND_LABEL[e.kind]}
                    {e.used ? ' · used' : e.considered ? ' · considered' : ''}
                    {(e.attachments ?? []).length ? ` · ${plural(e.attachments.length, 'file')}` : ''}
                  </p>
                  <AssignCell
                    className="-ml-1.5"
                    project={project}
                    targetId={e.id}
                    owner={e.owner}
                    onAssigned={setProject}
                  />
                  {e.iso19650 ? (
                    // Derived from the parts, never stored — the name is a view
                    // of the reference, and two copies of it would drift.
                    <p
                      className="mt-0.5 font-mono text-[11px] text-ink-muted"
                      title={`ISO 19650 information container name. XX is the standard's own placeholder for a part nobody has recorded — ${iso19650Completeness(e.iso19650).known} of ${iso19650Completeness(e.iso19650).total} known.`}
                    >
                      {iso19650Name(project.reference, e.iso19650)}
                    </p>
                  ) : null}
                  {(e.attachments ?? []).length ? (
                    <ul className="mt-1 space-y-1">
                      {e.attachments.map((f) => (
                        <li key={f.id}>
                          <button type="button" onClick={() => setProofId(e.id)} className="text-[12px] text-brand underline">
                            {f.fileName}
                          </button>
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
                  ) : null}
                </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(e.attachments ?? []).length ? (
                    <Button size="sm" variant="ghost" onClick={() => setProofId(e.id)}>
                      Open proof
                    </Button>
                  ) : null}
                  <Select value={e.status} onChange={(ev) => void setStatus(e.id, ev.target.value as EvidenceStatus)}>
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
                        const files = ev.target.files;
                        if (!files?.length) return;
                        void (async () => {
                          try {
                            await api.uploadEvidenceFiles(project.id, e.id, [...files]);
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
              </LiveRow>
                    ))
                  : null}
              </section>
            ))}
          </CardBody>
        </Card>
      )}
      {proof ? (
        <EvidenceProof
          projectId={project.id}
          evidence={proof}
          file={proof.attachments[0]}
          quotes={proofQuotes}
          citedPage={focusPage ? Number(focusPage) || undefined : undefined}
          onClose={() => {
            setProofId(null);
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
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record evidence"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void add()} disabled={busy || !title.trim()}>Add</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>
              {Object.entries(EVIDENCE_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
          {/* Every part optional, and the name still forms. A pack collects
              documents from a dozen sources and most arrive with none of this
              known; refusing to name anything until all six are filled would
              mean naming nothing. Unknown parts become the standard's own XX. */}
          <Field
            label="Document reference (ISO 19650)"
            hint={`Optional, part by part. This one would be named ${iso19650Name(project.reference, iso)}.`}
          >
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['originator', 'Originator'],
                  ['volume', 'Volume'],
                  ['level', 'Level'],
                  ['type', 'Type (DR/SP/RP)'],
                  ['role', 'Role (A/C/S/K/M)'],
                  ['number', 'Number'],
                ] as [keyof Iso19650Ref, string][]
              ).map(([key, label]) => (
                <Input
                  key={key}
                  placeholder={label}
                  value={iso[key] ?? ''}
                  onChange={(e) => setIso((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              ))}
            </div>
          </Field>
        </div>
      </Modal>
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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FindingSeverity>('medium');
  const [discipline, setDiscipline] = useState<ScopeKey>('technical');
  const [busy, setBusy] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const { count: mineCount, rows } = useMine(project.findings, mineOnly);

  async function add() {
    setBusy(true);
    try {
      await api.addFinding(project.id, { title, description, severity, discipline });
      setProject(await api.getProject(project.id));
      setOpen(false);
      setTitle('');
      setDescription('');
      toast('Finding added to the project register', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add finding', 'critical');
    } finally {
      setBusy(false);
    }
  }

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
        <Button onClick={() => setOpen(true)}>Add finding</Button>
      </div>
      {project.findings.length === 0 ? (
        <EmptyState title="No findings" description="Raised from check results, or added here." />
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {rows.map((f) => (
              <LiveRow key={f.id} id={f.id} highlightIds={liveIds} variant="flush" className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{f.title}</p>
                    <Why>{f.description}</Why>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {SCOPE_LABEL[f.discipline]} · {f.assessmentIds.length} DD link(s) · {f.evidenceIds.length} evidence · {f.riskIds.length} risks · {f.actionIds.length} actions
                    </p>
                    <AssignCell
                      className="mt-0.5 -ml-1.5"
                      project={project}
                      targetId={f.id}
                      owner={f.owner}
                      onAssigned={setProject}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Derived from the severity beside it, never stored — see `ricsConditionRating`. */}
                    <Badge tone={severityTone(f.severity)} title={`RICS condition rating ${ricsConditionRating(f.severity)}: ${RICS_RATING_LABEL[ricsConditionRating(f.severity)]}`}>
                      {ricsConditionRating(f.severity)} · {SEVERITY_LABEL[f.severity]}
                    </Badge>
                    <Select value={f.status} onChange={(e) => void setStatus(f.id, e.target.value as FindingStatus)}>
                      {FINDING_STATUSES.map((s) => (
                        <option key={s} value={s}>{FINDING_STATUS_LABEL[s]}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <FindingClassification finding={f} onChange={(body) => void classify(f.id, body)} />
              </LiveRow>
            ))}
          </CardBody>
        </Card>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add finding"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void add()} disabled={busy || !title.trim() || !description.trim()}>Add</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></Field>
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as FindingSeverity)}>
              {(['low', 'medium', 'high', 'critical'] as FindingSeverity[]).map((s) => (
                <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Discipline">
            <Select value={discipline} onChange={(e) => setDiscipline(e.target.value as ScopeKey)}>
              {Object.entries(SCOPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
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
