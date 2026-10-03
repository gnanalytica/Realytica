import { useMemo, useState } from 'react';
import { Camera, Copy, Download, ImagePlus, Pencil, Plus, ShieldAlert, Sparkles, X } from 'lucide-react';
import {
  RISK_LABEL,
  SCOPE_LABEL,
  departmentRole,
  observationStatement,
  observationSummary,
  observations,
  observationsCsv,
  observationsText,
  roleCanEdit,
  unusedPhotos,
  type DdProject,
  type FindingRecord,
  type FindingSeverity,
  type ObservationInput,
  type PhotoCandidate,
  type ScopeKey,
} from '@realytica/shared';
import { evidenceFileUrl } from '../../lib/api';
import { workspaceApi } from '../../lib/workspace-api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, Textarea, cn, useToast, type Tone } from '../ui/kit';

const RISKS: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];
const RISK_TONE: Record<FindingSeverity, Tone> = { critical: 'critical', high: 'serious', medium: 'warning', low: 'neutral' };
const RISK_SHORT: Record<FindingSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Moderate', low: 'Low' };
const DISCIPLINES: readonly ScopeKey[] = ['technical', 'quality', 'hse', 'condition_operations', 'regulatory'];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==================================================================== */
/* Photographs                                                           */
/* ==================================================================== */

/** A filed photograph, small. Loads with the session's token, so it works where sign-in is on. */
function FiledThumb({ project, evidenceId, onOpen }: { project: DdProject; evidenceId: string; onOpen?: () => void }) {
  const row = project.evidence.find((e) => e.id === evidenceId);
  const shot = row?.attachments.find((a) => a.mimeType.startsWith('image/'));
  const { url } = useAuthedUrl(row && shot ? evidenceFileUrl(project.id, row.id, shot.id, { inline: true }) : undefined);
  if (!row) return null;
  if (!shot) {
    return (
      <button type="button" onClick={onOpen} className="inline-flex max-w-[12rem] items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:text-ink" title={row.title}>
        <span className="truncate">{row.title}</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} title={row.title} className="size-14 shrink-0 overflow-hidden rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]">
      {url ? <img src={url} alt={row.title} className="size-full object-cover" /> : <Camera size={14} className="m-auto text-ink-muted" aria-hidden />}
    </button>
  );
}

export function CandidateThumb({ project, photo, size = 'md' }: { project: DdProject; photo: PhotoCandidate; size?: 'md' | 'lg' }) {
  const row = photo.evidenceId ? project.evidence.find((e) => e.id === photo.evidenceId) : undefined;
  const shot = row?.attachments.find((a) => a.mimeType.startsWith('image/'));
  const path = row && shot ? evidenceFileUrl(project.id, row.id, shot.id, { inline: true }) : photo.siteLog ? workspaceApi.sitePhotoUrl(project.id, photo.siteLog.entryId, photo.siteLog.index) : undefined;
  const { url } = useAuthedUrl(path);
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]', size === 'lg' ? 'aspect-[4/3] w-full' : 'size-16')}>
      {url ? <img src={url} alt={photo.title} className="size-full object-cover" /> : <Camera size={16} className="text-ink-muted" aria-hidden />}
    </span>
  );
}

/* ==================================================================== */
/* The form                                                              */
/* ==================================================================== */

interface Draft {
  area: string;
  description: string;
  severity: FindingSeverity;
  mitigation: string;
  standardRef: string;
  discipline: ScopeKey;
  evidenceIds: string[];
}

const BLANK: Draft = { area: '', description: '', severity: 'medium', mitigation: '', standardRef: '', discipline: 'technical', evidenceIds: [] };

function ObservationForm({
  project,
  areas,
  initial,
  busy,
  saveLabel,
  onSave,
  onCancel,
}: {
  project: DdProject;
  areas: string[];
  initial: Draft;
  busy: boolean;
  saveLabel: string;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [attach, setAttach] = useState('');
  const files = useMemo(() => project.evidence.filter((e) => e.attachments.length > 0 && !draft.evidenceIds.includes(e.id)), [project, draft.evidenceIds]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((was) => ({ ...was, [key]: value }));
  const listId = `areas-${project.id}`;

  return (
    <div className="space-y-2.5 rounded-xl bg-sunken/60 p-3 ring-1 ring-inset ring-[var(--ring)]">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[10rem] flex-1 text-micro text-ink-secondary">
          Area
          <Input list={listId} value={draft.area} onChange={(e) => set('area', e.target.value)} placeholder="Pump room" className="mt-1" />
          <datalist id={listId}>
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <div className="text-micro text-ink-secondary">
          Risk
          <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Risk category">
            {RISKS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={draft.severity === r}
                onClick={() => set('severity', r)}
                className={cn(
                  'rounded-full px-2.5 py-1.5 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                  draft.severity === r ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
                )}
              >
                {RISK_SHORT[r]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="block text-micro text-ink-secondary">
        Observation
        <Textarea value={draft.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="What was seen" className="mt-1" />
      </label>
      <label className="block text-micro text-ink-secondary">
        Mitigation
        <Textarea value={draft.mitigation} onChange={(e) => set('mitigation', e.target.value)} rows={2} placeholder="What to do" className="mt-1" />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-micro text-ink-secondary">
          Reference
          <Input value={draft.standardRef} onChange={(e) => set('standardRef', e.target.value)} placeholder="NBC 2016 Part 4, cl. 4.16.1" className="mt-1" />
        </label>
        <label className="text-micro text-ink-secondary">
          Discipline
          <Select value={draft.discipline} onChange={(e) => set('discipline', e.target.value as ScopeKey)} className="mt-1 w-auto">
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {SCOPE_LABEL[d]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {draft.evidenceIds.map((id) => (
          <span key={id} className="relative">
            <FiledThumb project={project} evidenceId={id} />
            <button
              type="button"
              aria-label="Remove this proof"
              onClick={() => set('evidenceIds', draft.evidenceIds.filter((x) => x !== id))}
              className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-surface text-ink-secondary shadow-card ring-1 ring-[var(--ring)] hover:text-ink"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <Select
          aria-label="Attach a photograph or document"
          value={attach}
          onChange={(e) => {
            if (e.target.value) set('evidenceIds', [...draft.evidenceIds, e.target.value]);
            setAttach('');
          }}
          className="w-auto max-w-[16rem]"
        >
          <option value="">{files.length ? 'Attach a photograph or document…' : 'Nothing filed to attach'}</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.kind === 'photograph' ? 'Photo · ' : ''}
              {f.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!draft.description.trim()} onClick={() => onSave(draft)}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

function toInput(draft: Draft): ObservationInput {
  return {
    area: draft.area.trim() || undefined,
    description: draft.description.trim(),
    severity: draft.severity,
    mitigation: draft.mitigation.trim() || undefined,
    standardRef: draft.standardRef.trim() || undefined,
    discipline: draft.discipline,
    evidenceIds: draft.evidenceIds,
  };
}

function toDraft(f: FindingRecord): Draft {
  return { area: f.area ?? '', description: f.description || f.title, severity: f.severity, mitigation: f.mitigation ?? '', standardRef: f.standardRef ?? '', discipline: f.discipline, evidenceIds: f.evidenceIds };
}

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

type Filter = 'all' | FindingSeverity;

/**
 * Observations and mitigations, area by area: what was seen, how much it
 * matters, what to do, the code it is judged against, and the photographs
 * that show it. Below it, the photographs nothing cites yet.
 */
export function ObservationsCard({ project, onChanged, onOpenDocument }: { project: DdProject; onChanged: (next: DdProject) => void; onOpenDocument: (evidenceId: string) => void }) {
  const me = useMe();
  const toast = useToast();
  const mayEdit = me ? roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, 'construction')) : false;
  const rows = useMemo(() => observations(project, 'construction'), [project]);
  const summary = useMemo(() => observationSummary(project, rows), [project, rows]);
  const photos = useMemo(() => unusedPhotos(project), [project]);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numberOf = new Map(rows.map((f, i) => [f.id, i + 1]));
  const shown = rows.filter((f) => filter === 'all' || f.severity === filter);
  const groups: Array<{ area: string; items: FindingRecord[] }> = [];
  for (const f of shown) {
    const area = f.area ?? 'General';
    const last = groups[groups.length - 1];
    if (last && last.area.toLowerCase() === area.toLowerCase()) last.items.push(f);
    else groups.push({ area, items: [f] });
  }
  const material = summary.byRisk.critical + summary.byRisk.high;
  const unmitigated = summary.total - summary.withMitigation;

  async function run<T>(work: () => Promise<{ project: DdProject } & T>, done: string): Promise<({ project: DdProject } & T) | undefined> {
    setBusy(true);
    try {
      const res = await work();
      onChanged(res.project);
      toast(done, 'good');
      return res;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not save', 'critical');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function create(draft: Draft) {
    const res = await run(() => workspaceApi.addObservation(project.id, toInput(draft)), 'Observation recorded.');
    if (res) setAdding(null);
  }

  async function save(findingId: string, draft: Draft) {
    const res = await run(
      () => workspaceApi.patchObservation(project.id, findingId, { ...toInput(draft), area: draft.area.trim() || null, mitigation: draft.mitigation.trim() || null, standardRef: draft.standardRef.trim() || null }),
      'Observation updated.',
    );
    if (res) setEditing(null);
  }

  /** A photograph is cited by its row on the register; a site-log one gets its row here. */
  async function filed(photo: PhotoCandidate): Promise<{ evidenceId: string; project: DdProject } | undefined> {
    if (photo.evidenceId) return { evidenceId: photo.evidenceId, project };
    if (!photo.siteLog) return undefined;
    setBusy(true);
    try {
      const res = await workspaceApi.fileSitePhoto(project.id, photo.siteLog.entryId, photo.siteLog.index);
      onChanged(res.project);
      return res;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not file that photograph', 'critical');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function startFrom(photo: PhotoCandidate, suggestion?: PhotoCandidate['suggestions'][number]) {
    const got = await filed(photo);
    if (!got) return;
    setEditing(null);
    setAdding({ ...BLANK, area: photo.area ?? '', description: suggestion?.description ?? photo.seen ?? '', severity: suggestion?.severity ?? 'medium', evidenceIds: [got.evidenceId] });
  }

  async function attachTo(photo: PhotoCandidate, findingId: string) {
    const got = await filed(photo);
    if (!got) return;
    const target = got.project.findings.find((f) => f.id === findingId);
    if (!target) return;
    await run(() => workspaceApi.patchObservation(project.id, findingId, { evidenceIds: [...target.evidenceIds, got.evidenceId] }), 'Photograph attached.');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(observationsText(rows));
      toast('Copied.', 'good');
    } catch {
      toast('Could not copy.', 'warning');
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<ShieldAlert size={15} />}
          title="Observations and mitigations"
          subtitle={
            summary.total
              ? `${summary.total} · ${material} critical or high${unmitigated ? ` · ${unmitigated} no mitigation` : ''} · ${summary.withPhoto} with photo`
              : 'What was seen, the risk, and the fix'
          }
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              {summary.total ? (
                <>
                  <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy()}>
                    Copy
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={() => download(`${project.reference}-observations.csv`, observationsCsv(project, rows), 'text/csv')}>
                    Export
                  </Button>
                </>
              ) : null}
              {mayEdit ? (
                <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => (setEditing(null), setAdding({ ...BLANK }))}>
                  Add observation
                </Button>
              ) : null}
            </div>
          }
        />
        <CardBody className="space-y-3">
          {summary.total ? (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
              {(['all', ...RISKS] as Filter[]).map((key) => {
                const n = key === 'all' ? summary.total : summary.byRisk[key];
                if (key !== 'all' && !n) return null;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                      filter === key ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
                    )}
                  >
                    {key === 'all' ? 'All' : RISK_SHORT[key]}
                    <span className="font-mono tabular-nums">{n}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {adding ? <ObservationForm project={project} areas={summary.areas} initial={adding} busy={busy} saveLabel="Record" onSave={(d) => void create(d)} onCancel={() => setAdding(null)} /> : null}

          {!summary.total && !adding ? (
            <p className="text-[13px] text-ink-secondary">Nothing recorded yet.</p>
          ) : null}

          {groups.map((group) => (
            <section key={group.area} className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
              <h3 className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] font-semibold text-ink">
                {group.area}
                <span className="font-mono text-micro tabular-nums text-ink-secondary">{group.items.length}</span>
              </h3>
              <ul className="divide-y divide-hairline border-t border-hairline">
                {group.items.map((f) =>
                  editing === f.id ? (
                    <li key={f.id} className="p-2">
                      <ObservationForm project={project} areas={summary.areas} initial={toDraft(f)} busy={busy} saveLabel="Save" onSave={(d) => void save(f.id, d)} onCancel={() => setEditing(null)} />
                    </li>
                  ) : (
                    <li key={f.id} className="px-3 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-micro tabular-nums text-ink-muted">{numberOf.get(f.id)}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-[13px] text-ink">{observationStatement(f)}</p>
                          {f.mitigation ? (
                            <p className="text-[13px] text-ink-secondary">
                              <span className="font-medium text-ink">Mitigation:</span> {f.mitigation}
                            </p>
                          ) : (
                            <p className="text-micro text-ink-muted">No mitigation yet</p>
                          )}
                          {f.standardRef ? <p className="font-mono text-micro text-ink-secondary">{f.standardRef}</p> : null}
                          {f.evidenceIds.length ? (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              {f.evidenceIds.map((id) => (
                                <FiledThumb key={id} project={project} evidenceId={id} onOpen={() => onOpenDocument(id)} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <Badge tone={RISK_TONE[f.severity]}>{RISK_LABEL[f.severity]}</Badge>
                        <label className={cn('inline-flex shrink-0 items-center gap-1.5 text-micro', f.includeInReport === false ? 'text-ink-muted' : 'text-ink-secondary')}>
                          <input
                            type="checkbox"
                            checked={f.includeInReport !== false}
                            disabled={!mayEdit || busy}
                            onChange={(e) => void run(() => workspaceApi.patchObservation(project.id, f.id, { includeInReport: e.target.checked }), e.target.checked ? 'Back in the report.' : 'Left out of the report.')}
                            className="h-4 w-4 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:h-5 coarse:w-5"
                          />
                          In report
                        </label>
                        {mayEdit ? (
                          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} aria-label={`Edit observation ${numberOf.get(f.id)}`} onClick={() => (setAdding(null), setEditing(f.id))}>
                            Edit
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </CardBody>
      </Card>

      {photos.length ? (
        <Card>
          <CardHeader icon={<ImagePlus size={15} />} title="Unused photographs" subtitle={`${photos.length} not cited yet`} />
          <CardBody>
            <ul className="divide-y divide-hairline">
              {photos.slice(0, 30).map((photo) => (
                <li key={photo.key} className="flex flex-wrap items-start gap-3 py-2.5">
                  <CandidateThumb project={project} photo={photo} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-[13px] text-ink" title={photo.title}>
                      {photo.title}
                    </p>
                    <p className="text-micro text-ink-muted">
                      {photo.takenAt ? new Date(photo.takenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded'}
                      {photo.area ? ` · ${photo.area}` : ''}
                      {photo.siteLog ? ' · from the site log' : ''}
                    </p>
                    {photo.seen && photo.seen !== photo.title ? <p className="text-[12px] text-ink-secondary">{photo.seen}</p> : null}
                    {photo.suggestions.map((s) => (
                      <button
                        key={s.title}
                        type="button"
                        disabled={!mayEdit || busy}
                        onClick={() => void startFrom(photo, s)}
                        className="flex w-full items-start gap-1.5 rounded-lg bg-brand-soft/50 px-2 py-1.5 text-left text-[12px] text-ink ring-1 ring-inset ring-brand/20 hover:bg-brand-soft"
                      >
                        <Sparkles size={12} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">Suggested: {s.title}</span>
                          <span className="block text-ink-secondary">{s.description}</span>
                        </span>
                        <Badge tone={RISK_TONE[s.severity]}>{RISK_SHORT[s.severity]}</Badge>
                      </button>
                    ))}
                  </div>
                  {mayEdit ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="secondary" icon={<Plus size={13} />} disabled={busy} onClick={() => void startFrom(photo)}>
                        New observation
                      </Button>
                      {rows.length ? (
                        <Select aria-label={`Attach ${photo.title} to an observation`} value="" disabled={busy} onChange={(e) => e.target.value && void attachTo(photo, e.target.value)} className="w-auto max-w-[14rem]">
                          <option value="">Attach to…</option>
                          {rows.map((f) => (
                            <option key={f.id} value={f.id}>
                              {numberOf.get(f.id)}. {observationStatement(f).slice(0, 60)}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
