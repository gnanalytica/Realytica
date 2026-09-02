/**
 * The site as somebody actually observed it.
 *
 * Two registers that belong together and nowhere else. A VISIT is the thing
 * photographs are taken on — who went, when, and above all what they could not
 * get to. A SHEET is a plan somebody downloaded, and the control points that
 * put it where it belongs on the ground. Both answer "what do we know about
 * this place from having looked at it", as against the documentary registers
 * next door which answer "what do we know from what we were sent".
 *
 * The limitations list is the part of this page a diligence report actually
 * depends on. A condition inspection carried out in heavy rain cannot report
 * on ponding; one where the roof hatch was padlocked cannot report on the
 * roof. Without that written down, "no defect found" and "could not look" read
 * identically — and only one of them is worth anything to a buyer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  CAPTURE_PURPOSES,
  CAPTURE_PURPOSE_LABEL,
  CAPTURE_PURPOSE_NOTE,
  SHEET_KIND_LABEL,
  VISIT_LIMITATION_LABEL,
  describeCapture,
  type CaptureConcern,
  type CapturePurpose,
  type SheetKind,
  type SheetPlacement,
  type SiteVisitRecord,
  type VisitCoverageRow,
  type VisitLimitationKind,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, InfoTip, Input, Modal, Select, Textarea, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { SheetPlacer } from '../../components/SheetPlacer';

const LIMITATION_KINDS = Object.keys(VISIT_LIMITATION_LABEL) as VisitLimitationKind[];

export default function SiteRecord() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();

  const [visits, setVisits] = useState<SiteVisitRecord[]>([]);
  const [coverage, setCoverage] = useState<VisitCoverageRow[]>([]);
  const [concerns, setConcerns] = useState<CaptureConcern[]>([]);
  const [placements, setPlacements] = useState<SheetPlacement[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [v, s] = await Promise.all([api.listVisits(project.id), api.listSheets(project.id)]);
    setVisits(v.visits);
    setCoverage(v.coverage);
    setConcerns(v.concerns);
    setPlacements(s.sheets);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load, project.updatedAt]);

  const byVisit = useMemo(() => new Map(coverage.map((c) => [c.visitId, c])), [coverage]);
  const placement = placing ? placements.find((p) => p.sheet.id === placing) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button onClick={() => setOpen(true)}>Record a visit</Button>
      </div>

      {concerns.length ? (
        <Card>
          <CardBody className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Capture warnings</p>
            {/* Computed from the files, never stored. Nothing here rejects a
                photograph — a shot two kilometres away might be of the access
                road — but a reader should be told before citing one. */}
            <ul className="space-y-1">
              {concerns.slice(0, 8).map((c) => (
                <li key={`${c.attachmentId}-${c.code}`} className="text-[12px] text-ink-secondary">
                  <span className="font-medium text-ink">{c.fileName}</span> — {c.say}
                </li>
              ))}
            </ul>
            {concerns.length > 8 ? <p className="text-[11px] text-ink-muted">and {concerns.length - 8} more.</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Site visits</h2>
        {visits.length === 0 ? (
          <EmptyState
            title="No visit recorded"
            description="A visit is what photographs are taken on — and it exists even when nobody could get in."
            action={<Button onClick={() => setOpen(true)}>Record the first visit</Button>}
          />
        ) : (
          <Card>
            <CardBody className="divide-y divide-hairline p-0">
              {visits.map((visit) => {
                const row = byVisit.get(visit.id);
                return (
                  <div key={visit.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-medium text-ink">{visit.title}</p>
                        <p className="text-[12px] text-ink-secondary">
                          {visit.visitedOn} · {visit.surveyor}
                          {visit.accompaniedBy ? ` with ${visit.accompaniedBy}` : ''}
                          {visit.weather ? ` · ${visit.weather}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-muted">
                          {CAPTURE_PURPOSE_LABEL[visit.purpose]} · {row?.photos ?? 0} photo(s)
                          {row?.geotagged ? `, ${row.geotagged} geotagged` : ''} · {visit.assetIds.length} asset(s)
                        </p>
                      </div>
                      <Badge tone={visit.status === 'aborted' ? 'critical' : visit.status === 'planned' ? 'neutral' : 'good'}>
                        {visit.status}
                      </Badge>
                    </div>

                    {visit.limitations.length ? (
                      <ul className="space-y-0.5">
                        {visit.limitations.map((l, i) => (
                          <li key={i} className="text-[11.5px] text-status-warning">
                            {VISIT_LIMITATION_LABEL[l.kind]} — {l.what}
                          </li>
                        ))}
                      </ul>
                    ) : row?.limitationsStated ? (
                      <p className="text-[11.5px] text-ink-muted">No limitation recorded — full access stated.</p>
                    ) : (
                      /* The distinction that makes the list mean anything. An
                         empty list is a claim of full access; a visit nobody
                         wrote up is silence, and a report must not read the
                         second as the first. */
                      <p className="text-[11.5px] text-status-warning">
                        Nothing recorded about what could or could not be inspected — this visit has not been written up.
                      </p>
                    )}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Sheets on the map</h2>
          <InfoTip label="A sheet is placed from its control points, and the placement is worked out fresh every time." />
        </div>
        {placements.length === 0 ? (
          <EmptyState
            title="No sheet placed"
            description="File a master plan, zoning or layout sheet on the evidence register, then place it here to see it under the pin."
          />
        ) : (
          <Card>
            <CardBody className="divide-y divide-hairline p-0">
              {placements.map(({ sheet, reading }) => (
                <div key={sheet.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{sheet.title}</p>
                    <p className="text-[12px] text-ink-secondary">
                      {SHEET_KIND_LABEL[sheet.kind]}
                      {sheet.issuer ? ` · ${sheet.issuer}` : ''}
                      {sheet.asOf ? ` · as at ${sheet.asOf}` : ''}
                    </p>
                    <p
                      className={
                        reading.verdict === 'good'
                          ? 'mt-0.5 text-[11px] text-ink-muted'
                          : reading.verdict === 'rotated' || reading.verdict === 'unusable'
                            ? 'mt-0.5 text-[11px] text-status-critical'
                            : 'mt-0.5 text-[11px] text-status-warning'
                      }
                    >
                      {reading.say}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={reading.verdict === 'good' ? 'good' : reading.verdict === 'unusable' || reading.verdict === 'rotated' ? 'critical' : 'warning'}>
                      {reading.verdict}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => setPlacing(sheet.id)}>
                      Place
                    </Button>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        )}
        <NewSheet project={project} onAdded={() => void load()} />
      </section>

      {placement ? (
        <SheetPlacer
          projectId={project.id}
          placement={placement}
          onClose={() => setPlacing(null)}
          onSaved={async () => {
            await load();
            setProject(await api.getProject(project.id));
          }}
        />
      ) : null}

      <VisitModal
        open={open}
        busy={busy}
        onClose={() => setOpen(false)}
        onSubmit={async (input) => {
          setBusy(true);
          try {
            await api.addVisit(project.id, input);
            await load();
            setProject(await api.getProject(project.id));
            setOpen(false);
            toast('Visit recorded', 'good');
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Could not record the visit', 'critical');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/**
 * A sheet is a piece of evidence first.
 *
 * It has to name the evidence row its file is filed on, rather than carrying
 * its own copy — a second store of the same document is a second thing to keep
 * in step, and the sheet then has no status, no source and no place in the
 * pack. So this picks from the register rather than taking an upload.
 */
function NewSheet({ project, onAdded }: { project: ProjectOutlet['project']; onAdded: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<SheetKind>('master_plan');
  const [evidenceId, setEvidenceId] = useState('');
  const [issuer, setIssuer] = useState('');
  const [asOf, setAsOf] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = project.evidence.filter((e) => (e.attachments ?? []).length > 0);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Add a sheet
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a sheet"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !title.trim() || !evidenceId}
              onClick={() => {
                setBusy(true);
                void api
                  .addSheet(project.id, { title, kind, evidenceId, issuer: issuer || undefined, asOf: asOf || undefined })
                  .then(() => {
                    setOpen(false);
                    setTitle('');
                    setEvidenceId('');
                    onAdded();
                  })
                  .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Could not add the sheet', 'critical'))
                  .finally(() => setBusy(false));
              }}
            >
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="RMP 2015, sheet 12" /></Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as SheetKind)}>
              {(Object.keys(SHEET_KIND_LABEL) as SheetKind[]).map((k) => (
                <option key={k} value={k}>{SHEET_KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="The file it is filed as" hint="Only evidence rows with a file attached can be placed.">
            <Select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
              <option value="">Choose an evidence row…</option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Issuer" hint="BDA, BBMP, the vendor's architect — provenance decides weight."><Input value={issuer} onChange={(e) => setIssuer(e.target.value)} /></Field>
          <Field label="In force as at" hint="Master plans are dated and superseded."><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

function VisitModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: Parameters<typeof api.addVisit>[1]) => void;
}) {
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState<CapturePurpose>('diligence_inspection');
  const [visitedOn, setVisitedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [surveyor, setSurveyor] = useState('');
  const [accompaniedBy, setAccompaniedBy] = useState('');
  const [weather, setWeather] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'planned' | 'completed' | 'aborted'>('completed');
  const [limitations, setLimitations] = useState<Array<{ kind: VisitLimitationKind; what: string }>>([]);
  const draft = useRef<{ kind: VisitLimitationKind; what: string }>({ kind: 'no_access', what: '' });
  const [draftWhat, setDraftWhat] = useState('');
  const [draftKind, setDraftKind] = useState<VisitLimitationKind>('no_access');
  draft.current = { kind: draftKind, what: draftWhat };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a site visit"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !title.trim() || !surveyor.trim()}
            onClick={() =>
              onSubmit({
                title,
                purpose,
                visitedOn,
                surveyor,
                status,
                accompaniedBy: accompaniedBy || undefined,
                weather: weather || undefined,
                notes: notes || undefined,
                limitations,
              })
            }
          >
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Condition walk, towers A and B" /></Field>
        <Field label="Purpose" hint={CAPTURE_PURPOSE_NOTE[purpose]}>
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value as CapturePurpose)}>
            {CAPTURE_PURPOSES.map((p) => (
              <option key={p} value={p}>{CAPTURE_PURPOSE_LABEL[p]}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={visitedOn} onChange={(e) => setVisitedOn(e.target.value)} /></Field>
          <Field label="Outcome">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="completed">Completed</option>
              <option value="planned">Planned</option>
              <option value="aborted">Aborted — could not inspect</option>
            </Select>
          </Field>
          <Field label="Surveyor" hint="A report has to say who looked."><Input value={surveyor} onChange={(e) => setSurveyor(e.target.value)} /></Field>
          <Field label="Accompanied by"><Input value={accompaniedBy} onChange={(e) => setAccompaniedBy(e.target.value)} /></Field>
        </div>
        <Field label="Conditions" hint="Heavy rain means no report on ponding. Recorded because it limits what the visit can say.">
          <Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="Dry, overcast, 28°C" />
        </Field>

        <Field
          label="What could not be inspected"
          hint="Leave empty only if the surveyor genuinely got everywhere — an empty list is read as a claim of full access."
        >
          <div className="space-y-2">
            {limitations.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="text-ink-secondary">{VISIT_LIMITATION_LABEL[l.kind]} — {l.what}</span>
                <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setLimitations(limitations.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Select value={draftKind} onChange={(e) => setDraftKind(e.target.value as VisitLimitationKind)} className="w-48">
                {LIMITATION_KINDS.map((k) => (
                  <option key={k} value={k}>{VISIT_LIMITATION_LABEL[k]}</option>
                ))}
              </Select>
              <Input
                value={draftWhat}
                onChange={(e) => setDraftWhat(e.target.value)}
                placeholder="Roof — hatch padlocked, no key holder"
                className="flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={!draftWhat.trim()}
                onClick={() => {
                  setLimitations([...limitations, { kind: draftKind, what: draftWhat.trim() }]);
                  setDraftWhat('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </Field>

        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Re-exported so the capture editor elsewhere can say the same sentence. */
export { describeCapture };
