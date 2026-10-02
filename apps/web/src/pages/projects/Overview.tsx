import { Suspense, lazy, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  LIFECYCLE_DISPLAY,
  LIFECYCLE_STAGE_LABEL,
  LIFECYCLE_STAGES,
  REPORT_KIND_LABEL,
  cockpitPath,
  lifecycleDisplayIndex,
  type LifecycleStage,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Disclosure, Field, Modal, Select, Skeleton, SubmitButton, Textarea, useToast } from '../../components/ui/kit';
import {
  KeyFacts,
  LifecycleStepper,
  NeedsDecisionCard,
  OpenItemsCard,
  RecentActivityCard,
  ViewTiles,
  WaitingOnCard,
} from '../../components/project/ProjectPanels';
import { EngagementEditor } from '../../components/project/EngagementEditor';
import { PhaseRecordCard, type PhaseOpen } from '../../components/project/PhaseRecord';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

/* The map carries Leaflet. Lazy, so the rest of the overview paints first. */
const GisOverlayCard = lazy(() => import('../../components/GisOverlayCard').then((m) => ({ default: m.GisOverlayCard })));

/**
 * The workspace's first tab, and the project's one summary page.
 *
 * There used to be two: a case dashboard outside the workspace — full width,
 * no chat — and this tab inside it, carrying the same six cards. Two pages
 * saying the same thing, with the map on one and the stage history on the
 * other, meant whichever you were on lacked something. Now there is this one,
 * beside the conversation: where the file stands, where the site is, and
 * what was done in each phase.
 */
export default function Overview() {
  const { project, setProject, onOpenCited } = useOutletContext<ProjectOutlet>();
  const navigate = useNavigate();
  const toast = useToast();
  const [stageOpen, setStageOpen] = useState(false);
  const [stage, setStage] = useState<LifecycleStage>(project.currentStage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  async function changeStage() {
    setBusy(true);
    try {
      await api.changeStage(project.id, { subject: 'project', stage, reason });
      setProject(await api.getProject(project.id));
      setStageOpen(false);
      setReason('');
      toast('Stage updated. The history is kept.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change stage', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const openFromPhase: PhaseOpen = (kind, id) => {
    if (kind === 'decision') navigate(cockpitPath(project.id, 'decisions'));
    else if (kind === 'report') navigate(cockpitPath(project.id, 'reports'));
    else onOpenCited?.(id);
  };

  const latestReport = project.reports.at(-1);
  const subtitle = [
    [project.location, project.city].filter(Boolean).join(', '),
    project.engagement?.scope,
    latestReport ? `${REPORT_KIND_LABEL[latestReport.kind]}, ${latestReport.status === 'issued' ? 'issued' : 'draft'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Project overview</h2>
          <p className="text-[12px] text-ink-secondary">{subtitle || project.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EngagementEditor project={project} onSaved={setProject} />
          <Button size="sm" onClick={() => setStageOpen(true)}>Change stage</Button>
        </div>
      </div>

      <LifecycleStepper project={project} picked={phase} onPick={(key) => setPhase((was) => (was === key ? null : key))} />
      {phase ? <PhaseRecordCard project={project} phase={phase} onOpen={openFromPhase} onClose={() => setPhase(null)} /> : null}

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <GisOverlayCard project={project} onChanged={async () => setProject(await api.getProject(project.id))} />
          </Suspense>
        </div>
        <KeyFacts project={project} />
      </div>

      <section className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Views</h3>
          <p className="text-[12px] text-ink-secondary">Status of each view on the file</p>
        </div>
        <ViewTiles project={project} columns="canvas" />
      </section>

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-2">
        <OpenItemsCard project={project} />
        <NeedsDecisionCard project={project} />
        <WaitingOnCard project={project} />
        <RecentActivityCard project={project} />
      </div>

      {project.stageHistory.length > 0 ? (
        <Disclosure title={`Stage history · ${project.stageHistory.length}`}>
          <ul className="divide-y divide-hairline">
            {project.stageHistory.slice().reverse().map((s) => {
              const key = LIFECYCLE_DISPLAY[lifecycleDisplayIndex(s.stage)]!.key;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setPhase(key)}
                    title="What was done in this phase"
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-1 py-2 text-left hover:bg-sunken"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-ink">{LIFECYCLE_STAGE_LABEL[s.stage]}</p>
                      <p className="text-[12px] text-ink-secondary">{s.reason}</p>
                    </div>
                    <p className="shrink-0 font-mono text-[11px] text-ink-muted">{formatWhen(s.effectiveAt)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      ) : null}

      <Modal
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        title="Change project stage"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStageOpen(false)}>Cancel</Button>
            <SubmitButton onClick={() => void changeStage()} busy={busy} needs={reason.trim() ? [] : ['Reason']}>Save</SubmitButton>
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
          <Field label="Reason" required hint="Kept on the stage history.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
