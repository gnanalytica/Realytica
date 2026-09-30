import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { LIFECYCLE_STAGE_LABEL, LIFECYCLE_STAGES, type LifecycleStage } from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Disclosure, Field, Modal, Select, SubmitButton, Textarea, useToast } from '../../components/ui/kit';
import {
  KeyFacts,
  LifecycleStepper,
  NeedsDecisionCard,
  OpenItemsCard,
  RecentActivityCard,
  ViewTiles,
  WaitingOnCard,
} from '../../components/project/ProjectPanels';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

/**
 * The workspace's first tab: where the file stands, beside the conversation.
 *
 * The same panels as the case dashboard, laid out for the narrower canvas.
 * The map and the site readings live on the Site tab; this is the summary a
 * person reads before asking the copilot anything.
 */
export default function Overview() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [stageOpen, setStageOpen] = useState(false);
  const [stage, setStage] = useState<LifecycleStage>(project.currentStage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Project overview</h2>
          <p className="text-[12px] text-ink-secondary">{project.name}</p>
        </div>
        <Button size="sm" onClick={() => setStageOpen(true)}>Change stage</Button>
      </div>

      <LifecycleStepper project={project} />

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <KeyFacts project={project} />
        <section className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-[13px] font-semibold text-ink">Views</h3>
            <p className="text-[12px] text-ink-secondary">Status of each view on the file</p>
          </div>
          <ViewTiles project={project} columns="canvas" />
        </section>
      </div>

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-2">
        <OpenItemsCard project={project} />
        <NeedsDecisionCard project={project} />
        <WaitingOnCard project={project} />
        <RecentActivityCard project={project} />
      </div>

      {project.stageHistory.length > 0 ? (
        <Disclosure title={`Stage history · ${project.stageHistory.length}`}>
          <ul className="divide-y divide-hairline">
            {project.stageHistory.slice().reverse().map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 py-2">
                <div>
                  <p className="text-[13px] font-medium text-ink">{LIFECYCLE_STAGE_LABEL[s.stage]}</p>
                  <p className="text-[12px] text-ink-secondary">{s.reason}</p>
                </div>
                <p className="shrink-0 font-mono text-[11px] text-ink-muted">{formatWhen(s.effectiveAt)}</p>
              </li>
            ))}
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
