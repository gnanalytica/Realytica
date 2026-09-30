import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { ENGAGEMENT_STAGE_LABEL, type DdProject, type EngagementStage } from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Field, Input, Modal, Select, useToast } from '../ui/kit';

const STAGES = Object.keys(ENGAGEMENT_STAGE_LABEL) as EngagementStage[];

/**
 * Who asked, for what, led by whom, due when: set after the fact.
 *
 * The new-engagement form asks for these, but a file opened before
 * engagements existed had nowhere to put them, and one whose client or due
 * date moved had no way to say so. Without an engagement a project sits
 * outside the portfolio pipeline, so this is also how an old file joins it.
 */
export function EngagementEditor({ project, onSaved }: { project: DdProject; onSaved: (next: DdProject) => void }) {
  const toast = useToast();
  const current = project.engagement;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<EngagementStage>(current?.stage ?? 'intake');
  const [client, setClient] = useState(current?.client ?? '');
  const [scope, setScope] = useState(current?.scope ?? '');
  const [lead, setLead] = useState(current?.lead ?? project.owner ?? '');
  const [dueDate, setDueDate] = useState(current?.dueDate ?? '');

  const start = () => {
    setStage(current?.stage ?? 'intake');
    setClient(current?.client ?? '');
    setScope(current?.scope ?? '');
    setLead(current?.lead ?? project.owner ?? '');
    setDueDate(current?.dueDate ?? '');
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.patchProject(project.id, {
        // Patched whole: a stage and a due date go together.
        engagement: {
          ...current,
          stage,
          client: client.trim() || undefined,
          scope: scope.trim() || undefined,
          lead: lead.trim() || undefined,
          dueDate: dueDate || undefined,
        },
      });
      onSaved(next);
      setOpen(false);
      toast('Engagement saved', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the engagement', 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={start}>
        {current ? 'Edit engagement' : 'Set up the engagement'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="The engagement"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stage" hint="Where it sits in the portfolio pipeline.">
              <Select value={stage} onChange={(e) => setStage(e.target.value as EngagementStage)}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {ENGAGEMENT_STAGE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Report due" hint="Shows on the portfolio's next 14 days.">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Client" hint="Who the report is for.">
            <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. the developer, or a bank branch" />
          </Field>
          <Field label="What was asked for" hint="In the client's words.">
            <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Screening and technical DD" />
          </Field>
          <Field label="Lead" hint="Who leads it and signs.">
            <Input value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Name" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
