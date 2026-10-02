import { useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import {
  ENGAGEMENT_KINDS,
  ENGAGEMENT_STAGE_LABEL,
  WORKSTREAMS,
  type DdProject,
  type Engagement,
  type EngagementKind,
  type EngagementStage,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from '../ui/kit';

const STAGES = Object.keys(ENGAGEMENT_STAGE_LABEL) as EngagementStage[];
const KINDS = Object.keys(ENGAGEMENT_KINDS) as EngagementKind[];
const LIVE = WORKSTREAMS.filter((w) => w.status === 'live');

interface Draft {
  kind: EngagementKind;
  title: string;
  client: string;
  lead: string;
  dueDate: string;
  scope: string;
  fee: string;
  stage: EngagementStage;
  workstreams: string[];
}

function draftOf(project: DdProject, e?: Engagement): Draft {
  return {
    kind: e?.kind ?? 'acquisition_screening',
    title: e?.title ?? '',
    client: e?.client ?? '',
    lead: e?.lead ?? project.owner ?? '',
    dueDate: e?.dueDate ?? '',
    scope: e?.scope ?? '',
    fee: e?.fee !== undefined ? String(e.fee) : '',
    stage: e?.stage ?? 'intake',
    workstreams: e?.workstreams ?? ENGAGEMENT_KINDS['acquisition_screening'].workstreams,
  };
}

/**
 * The pieces of work clients commissioned on this project — acquisition
 * screening for the developer, technical DD for the lender — each drawing on
 * the workstreams it needs. Checks are answered once, in their workstream,
 * for every engagement that draws on them.
 */
export function EngagementsCard({ project, onSaved }: { project: DdProject; onSaved: (next: DdProject) => void }) {
  const toast = useToast();
  const list = project.engagements ?? [];
  const [editing, setEditing] = useState<Engagement | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(project));
  const [busy, setBusy] = useState(false);

  const open = (e?: Engagement) => {
    setDraft(draftOf(project, e));
    setEditing(e ?? 'new');
  };

  async function save() {
    setBusy(true);
    try {
      const fee = draft.fee.trim() ? Number(draft.fee) : undefined;
      const common = {
        title: draft.title.trim() || undefined,
        client: draft.client.trim() || undefined,
        lead: draft.lead.trim() || undefined,
        dueDate: draft.dueDate || undefined,
        scope: draft.scope.trim() || undefined,
        ...(fee !== undefined && Number.isFinite(fee) ? { fee } : {}),
        workstreams: draft.workstreams,
      };
      const res =
        editing === 'new'
          ? await workspaceApi.createEngagement(project.id, { kind: draft.kind, ...common })
          : await workspaceApi.updateEngagement(project.id, (editing as Engagement).id, { ...common, stage: draft.stage });
      onSaved(res.project);
      setEditing(null);
      toast(editing === 'new' ? 'Engagement opened. Its workstreams carry the checks it needs.' : 'Engagement saved', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the engagement', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Briefcase size={15} />}
        title="Engagements"
        subtitle={list.length ? `${list.length} on this project` : 'Work clients have commissioned on this project'}
        action={
          <Button size="sm" icon={<Plus size={13} />} onClick={() => open()}>
            New engagement
          </Button>
        }
      />
      <CardBody>
        {list.length ? (
          <ul className="divide-y divide-hairline">
            {list.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => open(e)} className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-left hover:bg-sunken/60">
                  <span className="text-[13px] font-medium text-ink">{e.title}</span>
                  {e.client ? <span className="text-[12px] text-ink-secondary">for {e.client}</span> : null}
                  <span className="flex-1" />
                  {e.dueDate ? <span className="font-mono text-micro text-ink-muted">due {e.dueDate}</span> : null}
                  <Badge tone={e.stage === 'issued' ? 'good' : 'neutral'}>{ENGAGEMENT_STAGE_LABEL[e.stage]}</Badge>
                  <span className="w-full text-micro text-ink-muted">Draws on {e.workstreams.map((w) => WORKSTREAMS.find((x) => x.key === w)?.label ?? w).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-secondary">None yet. An engagement says who the work is for, what was asked, who leads it and when it is due, and which workstreams it draws on.</p>
        )}
      </CardBody>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New engagement' : 'Engagement'}
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!draft.workstreams.length} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {editing === 'new' ? (
              <Field label="Kind of work" hint={ENGAGEMENT_KINDS[draft.kind].purpose}>
                <Select
                  value={draft.kind}
                  onChange={(e) => {
                    const kind = e.target.value as EngagementKind;
                    setDraft({ ...draft, kind, workstreams: ENGAGEMENT_KINDS[kind].workstreams.length ? ENGAGEMENT_KINDS[kind].workstreams : draft.workstreams });
                  }}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ENGAGEMENT_KINDS[k].label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Stage" hint="Where it sits in the portfolio pipeline.">
                <Select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value as EngagementStage })}>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {ENGAGEMENT_STAGE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Title" hint="Defaults to the kind of work.">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={ENGAGEMENT_KINDS[draft.kind].label} />
            </Field>
            <Field label="Client" hint="Who the report is for.">
              <Input value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} placeholder="e.g. the developer, or a bank branch" />
            </Field>
            <Field label="Lead" hint="Who leads it and signs.">
              <Input value={draft.lead} onChange={(e) => setDraft({ ...draft, lead: e.target.value })} />
            </Field>
            <Field label="Report due">
              <Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
            </Field>
            <Field label="Fee (₹)" hint="Only firm staff see fees.">
              <Input type="number" min={0} value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} />
            </Field>
          </div>
          <Field label="What was asked for" hint="In the client's words.">
            <Textarea rows={2} value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
          </Field>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-ink-secondary">Draws on</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {LIVE.map((w) => (
                <Checkbox
                  key={w.key}
                  label={w.label}
                  checked={draft.workstreams.includes(w.key)}
                  onChange={(on) => setDraft({ ...draft, workstreams: on ? [...draft.workstreams, w.key] : draft.workstreams.filter((x) => x !== w.key) })}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>
    </Card>
  );
}
