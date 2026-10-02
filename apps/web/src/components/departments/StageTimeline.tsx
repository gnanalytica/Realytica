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
import { Button, Field, Textarea, cn, useToast } from '../ui/kit';
import { PhaseRecordCard, type PhaseOpen } from '../project/PhaseRecord';

const DOT: Record<TimelineStatus, string> = {
  done: 'h-2 w-2 bg-ink-secondary',
  current: 'h-3 w-3 bg-brand ring-[3px] ring-brand/25',
  ahead: 'h-2 w-2 bg-surface ring-[1.5px] ring-[var(--ring)]',
};

/**
 * Where the project is in its life, always on screen.
 *
 * Four stages, each a row of its steps. The step the project is at is the
 * blue one; phases sitting at a step of their own carry a flag on it. Every
 * stage and step can be opened to see what was filed, checked and decided
 * while the project was there — and a step can be made the current one.
 */
export function StageTimeline({ project, onChanged, onOpen, compact = false }: { project: DdProject; onChanged: (p: DdProject) => void; onOpen: PhaseOpen; compact?: boolean }) {
  const timeline = useMemo(() => stageTimeline(project), [project]);
  const [picked, setPicked] = useState<PhaseRef | null>(null);
  const markersAt = (step: LifecycleStage) => timeline.markers.filter((m) => m.stage === step);

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setPicked((p) => (p ? null : { kind: 'stage', key: timeline.currentStage }))}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand coarse:min-h-11"
        >
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          {stageAndStep(timeline.current)}
        </button>
        {picked ? <StagePanel project={project} picked={picked} onPick={setPicked} onChanged={onChanged} onOpen={onOpen} timeline={timeline} /> : null}
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1">
      <ol className="flex min-w-0 items-end gap-3" aria-label="Project stages">
        {timeline.stages.map((stage) => {
          const stageOn = picked?.kind === 'stage' && picked.key === stage.key;
          return (
            <li key={stage.key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setPicked(stageOn ? null : { kind: 'stage', key: stage.key })}
                aria-pressed={stageOn}
                title={`What happened in ${stage.label}`}
                className={cn(
                  'block w-full truncate text-left text-[10px] font-semibold uppercase tracking-[0.06em]',
                  stage.status === 'current' ? 'text-brand' : stage.status === 'done' ? 'text-ink-secondary' : 'text-ink-muted',
                  stageOn && 'underline underline-offset-2',
                )}
              >
                {stage.label}
              </button>
              <div className="relative mt-1 flex h-4 items-center justify-between">
                <span aria-hidden className={cn('absolute inset-x-0 top-1/2 -translate-y-1/2 border-t', stage.status === 'ahead' ? 'border-dashed border-[var(--ring)]' : 'border-ink-muted')} />
                {stage.subStages.map((step) => {
                  const on = picked?.kind === 'step' && picked.key === step.key;
                  const flags = markersAt(step.key);
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => setPicked(on ? null : { kind: 'step', key: step.key })}
                      title={`${step.label}${step.status === 'current' ? ' — now' : ''}${flags.length ? ` · ${flags.map((f) => f.name).join(', ')}` : ''}`}
                      aria-label={step.label}
                      aria-pressed={on}
                      className="relative z-10 flex h-4 w-4 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      <span className={cn('rounded-full', DOT[step.status], on && 'ring-2 ring-ink')} />
                      {flags.length ? (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-warning" aria-hidden>
                          <Flag size={9} fill="currentColor" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className={cn('mt-0.5 truncate text-[11px]', stage.status === 'current' ? 'font-medium text-ink' : 'text-transparent')}>
                {stage.status === 'current' ? SUB_STAGE_LABEL[timeline.current] : '·'}
              </p>
            </li>
          );
        })}
      </ol>
      {picked ? <StagePanel project={project} picked={picked} onPick={setPicked} onChanged={onChanged} onOpen={onOpen} timeline={timeline} /> : null}
    </div>
  );
}

function StagePanel({
  project,
  picked,
  onPick,
  onChanged,
  onOpen,
  timeline,
}: {
  project: DdProject;
  picked: PhaseRef;
  onPick: (p: PhaseRef | null) => void;
  onChanged: (p: DdProject) => void;
  onOpen: PhaseOpen;
  timeline: ReturnType<typeof stageTimeline>;
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
    <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[70vh] min-w-[min(44rem,92vw)] overflow-y-auto rounded-xl bg-surface p-3 shadow-pop ring-1 ring-[var(--ring)]">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onPick({ kind: 'stage', key: stage.key })} className={cn('rounded-full px-2.5 py-1 text-[12px]', picked.kind === 'stage' ? 'bg-brand-soft font-medium text-brand' : 'text-ink-secondary hover:bg-sunken')}>
          All of {stage.label}
        </button>
        {stage.subStages.map((s) => (
          <button key={s.key} type="button" onClick={() => onPick({ kind: 'step', key: s.key })} className={cn('rounded-full px-2.5 py-1 text-[12px]', step === s.key ? 'bg-brand-soft font-medium text-brand' : 'text-ink-secondary hover:bg-sunken')}>
            {s.label}
            {s.status === 'current' ? ' · now' : ''}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => onPick(null)} aria-label="Close" className="rounded-lg p-1.5 text-ink-muted hover:bg-sunken hover:text-ink">
          <X size={15} />
        </button>
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
