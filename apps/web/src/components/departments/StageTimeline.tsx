import { useMemo, useState } from 'react';
import { Flag, X } from 'lucide-react';
import {
  SUB_STAGE_LABEL,
  stageAndStep,
  stageTimeline,
  type DdProject,
  type LifecycleStage,
  type PhaseRef,
  type TimelineStatus,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { AnimatePresence, EASE_ENTER, motion } from '../../lib/motion';
import { Button, Field, Modal, Textarea, Tooltip, cn, useToast } from '../ui/kit';
import { PhaseRecordCard, type PhaseOpen } from '../project/PhaseRecord';

/** Done is ink, now is a ring with room inside it, ahead is an outline. */
const DOT: Record<TimelineStatus, string> = {
  done: 'size-[7px] bg-ink',
  current: 'size-3 bg-surface ring-[3px] ring-ink',
  ahead: 'size-[7px] bg-surface ring-[1.5px] ring-[var(--axis)]',
};

/**
 * Where the project is in its life, always on screen.
 *
 * Four stages, each a run of its steps on one rule. The rule is drawn solid
 * as far as the project has come and dashed beyond it, so "how far along" is
 * read before any label is. The step it is at is a ring; phases sitting at a
 * step of their own carry a flag. Every stage and step opens what was filed,
 * checked and decided while the project was there — and a step can be made
 * the current one.
 */
export function StageTimeline({ project, onChanged, onOpen, compact = false }: { project: DdProject; onChanged: (p: DdProject) => void; onOpen: PhaseOpen; compact?: boolean }) {
  const timeline = useMemo(() => stageTimeline(project), [project]);
  const [picked, setPicked] = useState<PhaseRef | null>(null);
  const markersAt = (step: LifecycleStage) => timeline.markers.filter((m) => m.stage === step);

  if (compact) {
    const stage = stageAndStep(timeline.current);
    const step = SUB_STAGE_LABEL[timeline.current];
    return (
      <>
        <button
          type="button"
          onClick={() => setPicked({ kind: 'stage', key: timeline.currentStage })}
          aria-label={`Where the project is: ${stage}`}
          /* A 28px pill that still takes a 44px press: the hit area grows, the pill does not.
             It gives way before the page's name does: on a narrow phone the
             step alone says where the project is, and the sheet it opens
             says the rest. */
          className="relative inline-flex h-7 min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-full bg-surface px-2.5 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] before:absolute before:-inset-2 coarse:before:-inset-y-2"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-ink" aria-hidden />
          <span className="truncate sm:hidden">{step}</span>
          <span className="hidden truncate sm:inline">{stage}</span>
        </button>
        {/* On a phone the record of a stage is a sheet, not a dropdown pinned to a pill. */}
        <Modal open={picked !== null} onClose={() => setPicked(null)} title="Where the project is" width="lg">
          {picked ? <StageBody project={project} picked={picked} onPick={setPicked} onChanged={onChanged} onOpen={onOpen} timeline={timeline} /> : null}
        </Modal>
      </>
    );
  }

  return (
    <div className="relative min-w-0 flex-1">
      <ol className="flex min-w-0 items-end gap-2" aria-label="Project stages">
        {timeline.stages.map((stage, index) => {
          const stageOn = picked?.kind === 'stage' && picked.key === stage.key;
          const steps = stage.subStages;
          // How much of this stage's rule is behind the project: all of a done
          // stage, up to the current step in the current one, none ahead.
          const reached = stage.status === 'done' ? 1 : stage.status === 'ahead' ? 0 : Math.max(0, steps.findIndex((x) => x.status === 'current')) / Math.max(1, steps.length - 1);
          return (
            <li key={stage.key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setPicked(stageOn ? null : { kind: 'stage', key: stage.key })}
                aria-pressed={stageOn}
                title={`What happened in ${stage.label}`}
                className={cn(
                  'flex w-full min-w-0 items-baseline gap-1 truncate rounded text-left text-[11px] font-semibold transition-colors duration-quick',
                  stage.status === 'ahead' ? 'text-ink-muted hover:text-ink-secondary' : 'text-ink hover:text-brand',
                  stageOn && 'text-brand',
                )}
              >
                <span className="truncate">{stage.label}</span>
                {stage.status === 'current' && SUB_STAGE_LABEL[timeline.current] !== stage.label ? (
                  <span className="truncate font-medium text-ink-secondary">· {SUB_STAGE_LABEL[timeline.current]}</span>
                ) : null}
              </button>
              <div className="relative mt-1.5 flex h-4 items-center justify-between">
                {/* The rule: dashed underneath, drawn solid over it as far as the project has come. */}
                <span aria-hidden className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-[1.5px] border-dashed border-[var(--axis)]" />
                {reached > 0 ? (
                  <motion.span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-[2px] origin-left -translate-y-1/2 rounded-full bg-ink"
                    style={{ width: `${reached * 100}%` }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.5, ease: EASE_ENTER, delay: 0.08 * index }}
                  />
                ) : null}
                {steps.map((step) => {
                  const on = picked?.kind === 'step' && picked.key === step.key;
                  const flags = markersAt(step.key);
                  return (
                    <Tooltip
                      key={step.key}
                      label={`${step.label}${step.status === 'current' ? ' — now' : ''}${flags.length ? ` · ${flags.map((f) => f.name).join(', ')}` : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => setPicked(on ? null : { kind: 'step', key: step.key })}
                        aria-label={step.label}
                        aria-pressed={on}
                        className="group relative z-10 flex size-4 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        {step.status === 'current' ? (
                          <span aria-hidden className="absolute inset-0 m-auto size-3 animate-ping-once rounded-full bg-brand/40" />
                        ) : null}
                        <span
                          className={cn(
                            'relative rounded-full transition-transform duration-quick ease-state group-hover:scale-125',
                            DOT[step.status],
                            on && 'ring-2 ring-brand ring-offset-1 ring-offset-surface',
                          )}
                        />
                        {flags.length ? (
                          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-warning" aria-hidden>
                            <Flag size={9} fill="currentColor" />
                          </span>
                        ) : null}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <AnimatePresence>
        {picked ? (
          <motion.div
            key="stage-panel"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: EASE_ENTER }}
            className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[70vh] min-w-[min(44rem,92vw)] origin-top overflow-y-auto rounded-2xl bg-surface p-3 shadow-pop ring-1 ring-[var(--ring)]"
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
      toast(`The project is at ${SUB_STAGE_LABEL[step]}. The history is kept.`, 'good');
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
            <Field label={`Move the project to ${SUB_STAGE_LABEL[step]}`} hint="The stage history keeps every move, with its reason.">
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
