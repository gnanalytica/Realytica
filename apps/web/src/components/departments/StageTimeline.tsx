import { useMemo, useState } from 'react';
import { Flag, X } from 'lucide-react';
import {
  SUB_STAGE_LABEL,
  stageAndStep,
  stageTimeline,
  type DdProject,
  type PhaseRef,
  type StageKey,
  type TimelineStatus,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { AnimatePresence, EASE_ENTER, motion } from '../../lib/motion';
import { Button, Field, Modal, Textarea, cn, useToast } from '../ui/kit';
import { PhaseRecordCard, type PhaseOpen } from '../project/PhaseRecord';
import { StageTrack, type TrackStage } from '../workspace/WorkspaceBar';

/** The record's three states, in the track's words. */
const WHEN: Record<TimelineStatus, TrackStage['when']> = { done: 'past', current: 'now', ahead: 'future' };

/**
 * Where the project is in its life, always on screen.
 *
 * Four stages on one track: Land, Pre-construction, Under construction,
 * Completed. A stage is the state of the property, so the track shows no
 * steps under it. Pressing a stage opens what was filed, checked and decided
 * while the project was there; the finer steps a project moves through are
 * inside that record, and it is where a step is made the current one.
 *
 * The record hangs from the bar the track sits in, not from the track: the
 * track ends well short of the bar's right edge, and a panel hung from it
 * ran off the left of a narrower window. So this component is not itself
 * positioned, and the bar that holds it must be (`relative`).
 */
export function StageTimeline({ project, onChanged, onOpen, compact = false }: { project: DdProject; onChanged: (p: DdProject) => void; onOpen: PhaseOpen; compact?: boolean }) {
  const timeline = useMemo(() => stageTimeline(project), [project]);
  const [picked, setPicked] = useState<PhaseRef | null>(null);

  if (compact) {
    const stage = stageAndStep(timeline.current);
    const short = timeline.stages.find((s) => s.key === timeline.currentStage)!.label;
    return (
      <>
        <button
          type="button"
          onClick={() => setPicked({ kind: 'stage', key: timeline.currentStage })}
          aria-label={`Where the project is: ${stage}`}
          /* A 28px pill that still takes a 44px press: the hit area grows, the pill does not.
             It gives way before the page's name does: on a narrow phone the
             stage alone says where the project is, and the sheet it opens
             says the rest. */
          className="relative inline-flex h-7 min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-full bg-surface px-2.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] before:absolute before:-inset-2 coarse:before:-inset-y-2"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-ink" aria-hidden />
          <span className="truncate sm:hidden">{short}</span>
          <span className="hidden truncate sm:inline">{stage}</span>
        </button>
        {/* On a phone the record of a stage is a sheet, not a dropdown pinned to a pill. */}
        <Modal open={picked !== null} onClose={() => setPicked(null)} title="Where the project is" width="lg">
          {picked ? <StageBody project={project} picked={picked} onPick={setPicked} onChanged={onChanged} onOpen={onOpen} timeline={timeline} /> : null}
        </Modal>
      </>
    );
  }

  const pickedStage = picked ? timeline.stages.find((s) => (picked.kind === 'stage' ? s.key === picked.key : s.subStages.some((x) => x.key === picked.key)))?.key : null;

  return (
    <div className="flex min-w-[16rem] flex-1">
      <StageTrack
        className="flex-1"
        stages={timeline.stages.map((s) => ({ key: s.key, label: s.label, when: WHEN[s.status] }))}
        picked={pickedStage}
        onPick={(key) => setPicked(pickedStage === key ? null : { kind: 'stage', key: key as StageKey })}
      />
      <AnimatePresence>
        {picked ? (
          <motion.div
            key="stage-panel"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: EASE_ENTER }}
            className="absolute right-4 top-full z-40 mt-2 max-h-[70vh] w-[min(44rem,calc(100%-2rem))] origin-top-right overflow-y-auto rounded-2xl bg-surface p-3 shadow-pop ring-1 ring-[var(--ring)]"
          >
            <StageBody project={project} picked={picked} onPick={setPicked} onChanged={onChanged} onOpen={onOpen} timeline={timeline} closable />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StageBody({
  project,
  picked,
  onPick,
  onChanged,
  onOpen,
  timeline,
  closable = false,
}: {
  project: DdProject;
  picked: PhaseRef;
  onPick: (p: PhaseRef | null) => void;
  onChanged: (p: DdProject) => void;
  onOpen: PhaseOpen;
  timeline: ReturnType<typeof stageTimeline>;
  /** A dropdown carries its own close; a sheet has one in its header already. */
  closable?: boolean;
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
        {!closable ? (
          <div className="mb-1 flex w-full gap-1 overflow-x-auto no-scrollbar">
            {timeline.stages.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => onPick({ kind: 'stage', key: x.key })}
                className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] coarse:min-h-11', x.key === stage.key ? 'bg-ink font-medium text-[var(--text-inverse)]' : 'text-ink-secondary ring-1 ring-inset ring-[var(--ring)]')}
              >
                {x.label}
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
        <span className="flex-1" />
        {closable ? (
          <button type="button" onClick={() => onPick(null)} aria-label="Close" className="rounded-lg p-1.5 text-ink-muted hover:bg-sunken hover:text-ink">
            <X size={15} />
          </button>
        ) : null}
      </div>
      {markers.length ? (
        <p className="mb-2 text-[12px] text-ink-secondary">
          <Flag size={11} className="mr-1 inline text-warning" />
          At this {step ? 'step' : 'stage'} on their own: {markers.map((m) => `${m.name} (${SUB_STAGE_LABEL[m.stage]})`).join(', ')}
        </p>
      ) : null}
      <PhaseRecordCard project={project} phase={picked} onOpen={(kind, id) => { onPick(null); onOpen(kind, id); }} onClose={() => onPick(null)} />
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
