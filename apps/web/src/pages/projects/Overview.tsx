import { Suspense, lazy, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import {
  projectTolerances,
  ASSESSMENT_STATUS_LABEL,
  CAPABILITY_KIND_LABEL,
  LIFECYCLE_STAGE_LABEL,
  LIFECYCLE_STAGES,
  cockpitPath,
  materialOpenFindings,
  packCompleteness,
  projectNextStep,
  toDashboard,
  type LifecycleStage,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Field, Modal, Select, Skeleton, StatTile, Textarea, useToast } from '../../components/ui/kit';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';
import { LiveRow } from './LiveRow';
/*
 * The map carries Leaflet, which is the largest thing on the overview and is
 * of no use at all to anybody who never scrolls to it. Lazy so the rest of the
 * project — every register, every chart — paints without waiting for a mapping
 * library.
 */
const SitePlaceCard = lazy(() =>
  import('../../components/SitePlaceCard').then((m) => ({ default: m.SitePlaceCard })),
);
const GisOverlayCard = lazy(() =>
  import('../../components/GisOverlayCard').then((m) => ({ default: m.GisOverlayCard })),
);
import { ToleranceChart } from '../../components/charts';

export default function Overview() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [stageOpen, setStageOpen] = useState(false);
  const [stage, setStage] = useState<LifecycleStage>(project.currentStage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const dash = toDashboard(project);
  // Recomputed on every render from the live checks, like everything else that
  // reads the registers — a chart of a snapshot would drift the moment a value
  // is recorded three panes away.
  const tolerances = projectTolerances(project);
  const navigate = useNavigate();
  const step = projectNextStep(project);
  const pack = dash.packCompleteness ?? packCompleteness(project);
  const material = materialOpenFindings(project);
  const overdue = project.actions.filter((a) => a.status === 'overdue');

  async function changeStage() {
    setBusy(true);
    try {
      await api.changeStage(project.id, { subject: 'project', stage, reason });
      const next = await api.getProject(project.id);
      setProject(next);
      setStageOpen(false);
      setReason('');
      toast('Stage updated — history preserved', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change stage', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Today"
          subtitle={project.reference}
          action={
            <Link to={cockpitPath(project.id, step.pane, step.extra)} className="text-[12px] text-brand">
              Open this sitting
            </Link>
          }
        />
        <CardBody className="space-y-1">
          <p className="text-[15px] font-medium text-ink">{step.title}</p>
          <p className="text-[13px] text-ink-secondary">{step.why}</p>
        </CardBody>
      </Card>

      {/*
        Container widths, not window widths — these tiles sit in the cockpit's
        right pane, which is a few hundred pixels while the window is a
        thousand. Keyed to `lg:` they went to four columns the moment the
        *window* passed 1024px and gave each tile about ninety pixels, with
        "Priority pack" broken across two lines and the hint clipped.
      */}
      <div className="grid gap-3 [@container(min-width:30rem)]:grid-cols-2 [@container(min-width:56rem)]:grid-cols-4">
        {/*
          Red means "somebody has to do something about this", and it stopped
          meaning that when a completeness percentage wore it too. A pack at 7%
          and three material findings were the same colour, so the tile that
          reports a real problem had to compete with the one reporting
          progress. Amber carries "thin, keep going"; red is kept for the
          counts that are actually bad.
        */}
        <StatTile
          label="Priority pack"
          value={`${pack.percent}%`}
          hint={`${pack.received}/${pack.total} core items`}
          tone={pack.percent >= 80 ? 'good' : pack.percent < 40 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Material findings"
          value={String(material.length)}
          hint={`${material.filter((f) => f.evidenceIds.length === 0).length} unevidenced`}
          tone={material.length ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Overdue actions"
          value={String(dash.actionAging.overdue)}
          hint={`${dash.actionAging.dueSoon} due in 14 days`}
          tone={dash.actionAging.overdue ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Active DDs"
          value={String(dash.ddProgress.filter((d) => d.status === 'active' || d.status === 'in_review').length)}
        />
      </div>

      {tolerances.length > 0 ? (
        <Card>
          <CardHeader
            title="Tolerance breaches"
            info="Each comparison is plotted as a multiple of its own tolerance, so variances of different kinds are comparable."
          />
          <CardBody>
            <ToleranceChart rows={tolerances} onSelect={(checkId) => navigate(`../dd?check=${encodeURIComponent(checkId)}`)} />
          </CardBody>
        </Card>
      ) : null}

      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <GisOverlayCard project={project} onChanged={async () => setProject(await api.getProject(project.id))} />
      </Suspense>

      {/*
        Beneath the overlay rather than inside it, because they answer
        different questions. The overlay is about the parcel — a survey sketch
        against the civic layers, which is a boundary question. This is about
        the place: where the geocoder put the address, what the road looks
        like, and what stands within walking distance. Blending them would
        invite the pin to be read as the extent, which is exactly what the
        site-context model refuses to let happen.
      */}
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <SitePlaceCard project={project} />
      </Suspense>

      {project.portfolio ? (
        <p className="text-[12px] text-ink-muted">Portfolio: {project.portfolio}</p>
      ) : null}

      <div className="grid gap-4 [@container(min-width:48rem)]:grid-cols-2">
        <Card>
          <CardHeader title="Material findings" action={<Link to="findings" className="text-[12px] text-brand">Register</Link>} />
          <CardBody>
            {material.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No high or critical open findings.</p>
            ) : (
              <ul className="space-y-2">
                {material.map((f) => (
                  <li key={f.id}>
                    <LiveRow id={f.id} highlightIds={highlightIds} variant="flush" className="flex items-start justify-between gap-2 text-[13px]">
                    <span className="text-ink">
                      {f.title}
                      {f.evidenceIds.length === 0 ? (
                        <span className="ml-2 text-[11px] font-medium text-ink-muted">unevidenced</span>
                      ) : null}
                    </span>
                    <Badge tone={f.severity === 'critical' ? 'critical' : 'serious'}>{f.severity}</Badge>
                    </LiveRow>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Overdue" action={<Link to="risks" className="text-[12px] text-brand">Actions</Link>} />
          <CardBody>
            {overdue.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No overdue actions.</p>
            ) : (
              <ul className="space-y-2">
                {overdue.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <LiveRow id={a.id} highlightIds={highlightIds} variant="flush" className="flex items-start justify-between gap-2 text-[13px]">
                    <span className="text-ink">{a.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-muted">{a.dueDate ?? a.owner}</span>
                    </LiveRow>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 [@container(min-width:48rem)]:grid-cols-2">
        <Card>
          <CardHeader title="DD progress" action={<Link to="dd" className="text-[12px] text-brand">All DDs</Link>} />
          <CardBody className="space-y-3">
            {dash.ddProgress.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No assessments yet.</p>
            ) : (
              dash.ddProgress.map((row) => (
                <LiveRow key={row.id} id={row.id} highlightIds={highlightIds} variant="flush">
                <Link to={`dd/${row.id}`} className="block space-y-1 border-b border-hairline pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-ink">{row.name}</p>
                    <Badge>{ASSESSMENT_STATUS_LABEL[row.status]}</Badge>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full bg-brand" style={{ width: `${row.percent}%` }} />
                  </div>
                  <p className="font-mono text-[11px] text-ink-muted">{row.checkDone}/{row.checkTotal} checks · {row.percent}%</p>
                </Link>
                </LiveRow>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lifecycle"
            subtitle={LIFECYCLE_STAGE_LABEL[project.currentStage]}
            info="Changing stage does not overwrite prior assessments."
            action={<Button size="sm" onClick={() => setStageOpen(true)}>Change stage</Button>}
          />
          <CardBody className="space-y-2">
            {project.stageHistory.slice().reverse().map((s) => (
              <div key={s.id} className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-0">
                <div>
                  <p className="text-[13px] font-medium text-ink">{LIFECYCLE_STAGE_LABEL[s.stage]}</p>
                  <p className="text-[12px] text-ink-secondary">{s.reason}</p>
                </div>
                <p className="shrink-0 font-mono text-[11px] text-ink-muted">{formatWhen(s.effectiveAt)}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Capabilities" action={<Link to="valuation" className="text-[12px] text-brand">Valuation</Link>} />
        <CardBody className="grid gap-3 [@container(min-width:30rem)]:grid-cols-2 [@container(min-width:52rem)]:grid-cols-3">
          {dash.capabilities.map((cap) => (
            <div key={cap.kind} className="rounded-lg border border-hairline p-3">
              <p className="text-[12px] font-medium text-ink">{CAPABILITY_KIND_LABEL[cap.kind]}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{cap.summary}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      {dash.changeSincePrevious.length > 0 ? (
        <Card>
          <CardHeader title="Change since previous DD" />
          <CardBody className="space-y-2">
            {dash.changeSincePrevious.map((row) => (
              <Link key={row.assessmentId} to={`dd/${row.assessmentId}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline py-2 last:border-0">
                <p className="text-[13px] text-ink">{row.assessmentName} vs {row.priorName}</p>
                <p className="font-mono text-[11px] text-ink-muted">
                  {row.newCount} new · {row.closedCount} closed · {row.unresolvedCount} unresolved
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        title="Change project stage"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStageOpen(false)}>Cancel</Button>
            <Button onClick={() => void changeStage()} disabled={busy || !reason.trim()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="New stage">
            <Select value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)}>
              {LIFECYCLE_STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" hint="Kept on the stage history.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
