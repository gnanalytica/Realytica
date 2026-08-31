import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  EVIDENCE_KIND_LABEL,
  EVIDENCE_STATUS_LABEL,
  FINDING_STATUS_LABEL,
  SCOPE_LABEL,
  SEVERITY_LABEL,
  quotesForEvidence,
  type EvidenceKind,
  type EvidenceStatus,
  type FindingSeverity,
  type FindingStatus,
  type ScopeKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { severityTone } from './shared';
import { LiveRow } from './LiveRow';
import { EvidenceProof } from './EvidenceProof';

const EVIDENCE_STATUSES = Object.keys(EVIDENCE_STATUS_LABEL) as EvidenceStatus[];
const FINDING_STATUSES = Object.keys(FINDING_STATUS_LABEL) as FindingStatus[];

const GAP_STATUSES: EvidenceStatus[] = ['expected', 'requested', 'missing'];

export function EvidenceRegister() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const assessmentId = searchParams.get('dd') ?? undefined;
  const focusId = searchParams.get('evidence') ?? undefined;
  const focusPage = searchParams.get('page');
  const [statusFilter, setStatusFilter] = useState<'all' | 'gaps' | EvidenceStatus>('gaps');
  const [query, setQuery] = useState('');
  const [proofId, setProofId] = useState<string | null>(focusId ?? null);
  const scoped = assessmentId ? project.evidence.filter((e) => e.assessmentIds.includes(assessmentId)) : project.evidence;
  const liveIds = [...(highlightIds ?? []), ...(focusId ? [focusId] : [])];
  const rows = scoped.filter((e) => {
    if (focusId && e.id === focusId) return true;
    if (statusFilter === 'gaps' && !GAP_STATUSES.includes(e.status)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'gaps' && e.status !== statusFilter) return false;
    if (query.trim() && !e.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EvidenceKind>('document');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (focusId) setProofId(focusId);
  }, [focusId]);

  const proof = proofId ? project.evidence.find((e) => e.id === proofId) : undefined;
  const proofQuotes = useMemo(() => (proof ? quotesForEvidence(project, proof.id) : []), [proof, project]);

  async function add() {
    setBusy(true);
    try {
      await api.addEvidence(project.id, { title, kind, source: source || undefined, status: 'received', assessmentIds: assessmentId ? [assessmentId] : [] });
      setProject(await api.getProject(project.id));
      setOpen(false);
      setTitle('');
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-ink-secondary">
          Project evidence register. Status includes considered vs used — relied-upon evidence is marked used, not merely received.
        </p>
        <Button onClick={() => setOpen(true)}>Add evidence</Button>
      </div>
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
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No evidence yet" description="Expected items are created when a DD starts. Upload or record what arrives." />
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {rows.map((e) => (
              <LiveRow key={e.id} id={e.id} highlightIds={liveIds} variant="flush" className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <p className="text-[13px] font-medium text-ink">{e.title}</p>
                  <p className="text-[12px] text-ink-muted">
                    {EVIDENCE_KIND_LABEL[e.kind]}
                    {e.used ? ' · used' : e.considered ? ' · considered' : ''}
                    {(e.attachments ?? []).length ? ` · ${e.attachments.length} file(s)` : ''}
                  </p>
                  {(e.attachments ?? []).length ? (
                    <p className="mt-1 flex flex-wrap gap-2">
                      {e.attachments.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setProofId(e.id)}
                          className="text-[12px] text-brand underline"
                        >
                          {f.fileName}
                        </button>
                      ))}
                    </p>
                  ) : null}
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
        </div>
      </Modal>
    </div>
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-ink-secondary">
          Shared finding register. One finding can be linked into several DDs and scopes rather than copied.
        </p>
        <Button onClick={() => setOpen(true)}>Add finding</Button>
      </div>
      {project.findings.length === 0 ? (
        <EmptyState title="No findings" description="Findings are created from material check results, or recorded here directly." />
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {project.findings.map((f) => (
              <LiveRow key={f.id} id={f.id} highlightIds={liveIds} variant="flush" className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{f.title}</p>
                    <p className="mt-1 text-[12px] text-ink-secondary">{f.description}</p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {SCOPE_LABEL[f.discipline]} · {f.assessmentIds.length} DD link(s) · {f.evidenceIds.length} evidence · {f.riskIds.length} risks · {f.actionIds.length} actions
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={severityTone(f.severity)}>{SEVERITY_LABEL[f.severity]}</Badge>
                    <Select value={f.status} onChange={(e) => void setStatus(f.id, e.target.value as FindingStatus)}>
                      {FINDING_STATUSES.map((s) => (
                        <option key={s} value={s}>{FINDING_STATUS_LABEL[s]}</option>
                      ))}
                    </Select>
                  </div>
                </div>
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
