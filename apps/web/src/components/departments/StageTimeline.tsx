import { useMemo, useState } from 'react';
import { Flag } from 'lucide-react';
import {
  SUB_STAGE_LABEL,
  stageAndStep,
  stageOf,
  stageTimeline,
  type DdProject,
  type LifecycleStage,
  type PhaseRef,
  type StageKey,
  type TimelineStatus,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Field, Modal, Textarea, cn, useToast } from '../ui/kit';
import { PhaseRecordCard, type PhaseOpen } from '../project/PhaseRecord';
import { StageTrack, type TrackStage } from '../workspace/WorkspaceBar';

/** The record's three states, in the track's words. */
const WHEN: Record<TimelineStatus, TrackStage['when']> = { done: 'past', current: 'now', ahead: 'future' };

/**
 * Where the project is in its life, always on screen, and the way to look at
 * it in another stage.
 *
 * Four stages on one track: Land, Pre-construction, Under construction,
 * Completed. A stage is the state of the property, so the track shows no
 * steps under it. Pressing a stage looks at the project in that stage: the
 * selector, the function tabs and the pages under them follow it. Looking
 * changes nothing on the record: the project is at one stage, marked Live
 * whichever one is looked at, and pressing it goes back to it.
 *
 * What was filed, checked and decided in a stage, its finer steps and the
 * control that makes a step the current one are a section of Overview
 * (`StageRecord`), not a panel hung from this bar.
 */
export function StageTimeline({ project, stage, onStage }: { project: DdProject; stage: StageKey; onStage: (stage: StageKey) => void }) {
  const timeline = useMemo(() => stageTimeline(project), [project]);
  return (
    <StageTrack
      className="flex-1"
      stages={timeline.stages.map((s) => ({ key: s.key, label: s.label, when: WHEN[s.status] }))}
      picked={stage}
      onPick={(key) => onStage(key as StageKey)}
    />
  );
}

/**
 * The stages on a phone, where the track is not on screen: a pill naming the
 * stage being looked at, which opens that stage's record as a sheet. The
 * sheet's tabs are the four stages, and pressing one looks at the project in
 * it, as pressing it on the track does.
 */
export function StagePill({
  project,
  stage,
  onStage,
  onChanged,
  onOpen,
}: {
  project: DdProject;
  stage: StageKey;
  onStage: (stage: StageKey) => void;
  onChanged: (p: DdProject) => void;
  onOpen: PhaseOpen;
}) {
  const timeline = useMemo(() => stageTimeline(project), [project]);
  const [picked, setPicked] = useState<PhaseRef | null>(null);
  const looking = timeline.stages.find((s) => s.key === stage)!;
  const own = stage === timeline.currentStage;
  const standing = stageAndStep(timeline.current);
  // The step is said with the project's own stage. A stage that is only looked at has no step to say.
  const full = own ? standing : looking.label;
  return (
    <>
      <button
        type="button"
        onClick={() => setPicked({ kind: 'stage', key: stage })}
        aria-label={own ? `Where the project is: ${standing}` : `Looking at ${looking.label}. The project is at ${standing}`}
        /* A 28px pill that still takes a 44px press: the hit area grows, the pill does not.
           It gives way before the page's name does: on a narrow phone the
           stage alone says where the project is, and the sheet it opens
           says the rest. */
        className="relative inline-flex h-7 min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-full bg-surface px-2.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] before:absolute before:-inset-2 coarse:before:-inset-y-2"
      >
        {/* The track's own marks: solid where the project is, green for a stage behind it, hollow for one ahead. */}
        <span
          className={cn('size-1.5 shrink-0 rounded-full', own ? 'bg-ink' : looking.status === 'done' ? 'bg-good' : 'ring-1 ring-inset ring-[var(--axis)]')}
          aria-hidden
        />
        <span className="truncate sm:hidden">{looking.label}</span>
        <span className="hidden truncate sm:inline">{full}</span>
        {/* Only the stage the project is at carries the word. A stage that is only looked at never does. */}
        {own ? <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand">Live</span> : null}
      </button>
      {/* On a phone the record of a stage is a sheet, not a section of a page that may not be the one on screen. */}
      <Modal open={picked !== null} onClose={() => setPicked(null)} title="Stages" width="lg">
        {picked ? (
          <StageBody
            project={project}
            picked={picked}
            onPick={(next) => {
              setPicked(next);
              if (next?.kind === 'stage' && next.key !== stage) onStage(next.key);
            }}
            onChanged={onChanged}
            onOpen={onOpen}
            timeline={timeline}
            sheet
          />
        ) : null}
      </Modal>
    </>
  );
}

/**
 * The record of the stage being looked at, as a section of a page: what was
 * filed, started or recorded while the project was there, the finer steps
 * inside the stage, and the control that makes a step the current one.
 */
export function StageRecord({ project, stage, onChanged, onOpen }: { project: DdProject; stage: StageKey; onChanged: (p: DdProject) => void; onOpen: PhaseOpen }) {
  const timeline = useMemo(() => stageTimeline(project), [project]);
  const [step, setStep] = useState<LifecycleStage | null>(null);
  // A step stays picked only while its own stage is the one looked at. Another stage opens on the whole of it.
  const picked = useMemo<PhaseRef>(() => (step && stageOf(step) === stage ? { kind: 'step', key: step } : { kind: 'stage', key: stage }), [step, stage]);
  return (
    <section aria-label="Stage record">
      <StageBody project={project} picked={picked} onPick={(next) => setStep(next?.kind === 'step' ? next.key : null)} onChanged={onChanged} onOpen={onOpen} timeline={timeline} />
    </section>
  );
}

function StageBody({
  project,
  picked,
  onPick,
  onChanged,
  onOpen,
  timeline,
  sheet = false,
}: {
  project: DdProject;
  picked: PhaseRef;
  /** A stage, a step inside it, or nothing: a sheet closes, a page goes back to the whole stage. */
  onPick: (p: PhaseRef | null) => void;
  onChanged: (p: DdProject) => void;
  onOpen: PhaseOpen;
  timeline: ReturnType<typeof stageTimeline>;
  /** In a phone's sheet, where the four stages are tabs and the record can close it. */
  sheet?: boolean;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const step = picked.kind === 'step' ? picked.key : null;
  const stage = timeline.stages.find((s) => (picked.kind === 'stage' ? s.key === picked.key : s.subStages.some((x) => x.key === picked.key)))!;
  const markers = timeline.markers.filter((m) => (step ? m.stage === step : stage.subStages.some((x) => x.key === m.stage)));

  async function move() {
    if (!step) return;
    setBusy(true);
    try {
      await api.changeStage(project.id, { subject: 'project', stage: step, reason: reason.trim() || `Moved to ${SUB_STAGE_LABEL[step]}` });
      onChanged(await api.getProject(project.id));
      toast(`Now at ${SUB_STAGE_LABEL[step]}.`, 'good');
      setReason('');
      onPick(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the stage', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {/* On a phone the four stages are tabs here, since the rule they sit on is not on screen. */}
        {sheet ? (
          <div className="mb-1 flex w-full gap-1 overflow-x-auto no-scrollbar">
            {timeline.stages.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => onPick({ kind: 'stage', key: x.key })}
                aria-pressed={x.key === stage.key}
                className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] coarse:min-h-11', x.key === stage.key ? 'bg-ink font-medium text-[var(--text-inverse)]' : 'text-ink-secondary ring-1 ring-inset ring-[var(--ring)]')}
              >
                {x.label}
                {x.status === 'current' ? ' · live' : ''}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" onClick={() => onPick({ kind: 'stage', key: stage.key })} className={cn('rounded-full px-2.5 py-1 text-[12px] coarse:min-h-11', picked.kind === 'stage' ? 'bg-brand-soft font-medium text-brand' : 'text-ink-secondary hover:bg-sunken')}>
          All of {stage.label}
        </button>
        {stage.subStages.map((s) => (
          <button key={s.key} type="button" onClick={() => onPick({ kind: 'step', key: s.key })} className={cn('rounded-full px-2.5 py-1 text-[12px] coarse:min-h-11', step === s.key ? 'bg-brand-soft font-medium text-brand' : 'text-ink-secondary hover:bg-sunken')}>
            {s.label}
            {s.status === 'current' ? ' · now' : ''}
          </button>
        ))}
      </div>
      {markers.length ? (
        <p className="mb-2 text-[12px] text-ink-secondary">
          <Flag size={11} className="mr-1 inline text-warning" />
          At this {step ? 'step' : 'stage'} on their own: {markers.map((m) => `${m.name} (${SUB_STAGE_LABEL[m.stage]})`).join(', ')}
        </p>
      ) : null}
      <PhaseRecordCard project={project} phase={picked} onOpen={(kind, id) => { onPick(null); onOpen(kind, id); }} onClose={sheet ? () => onPick(null) : undefined} />
      {step && step !== timeline.current ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-sunken p-3">
          <div className="min-w-[16rem] flex-1">
            <Field label={`Move the project to ${SUB_STAGE_LABEL[step]}`} hint="Kept in the stage history.">
              <Textarea rows={1} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — e.g. commencement certificate issued" />
            </Field>
          </div>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void move()}>
            Move here
          </Button>
        </div>
      ) : null}
    </div>
  );
}
