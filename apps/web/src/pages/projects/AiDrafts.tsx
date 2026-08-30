import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AI_DRAFT_KIND_LABEL, AI_DRAFT_STATUS_LABEL, type AiDraftStatus } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Callout, Card, CardBody, EmptyState, useToast } from '../../components/ui/kit';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

function toneFor(status: AiDraftStatus) {
  if (status === 'committed') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  if (status === 'accepted' || status === 'in_review') return 'warning' as const;
  return 'neutral' as const;
}

export default function AiDrafts() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const drafts = [...(project.aiDrafts ?? [])].slice().reverse();

  async function propose() {
    setBusy(true);
    try {
      const result = await api.proposeAiDrafts(project.id);
      setProject(await api.getProject(project.id));
      toast(
        result.agent.available
          ? `${result.drafts.length} drafts proposed (model credentials present; drafts still start from registers)`
          : `${result.drafts.length} drafts proposed from registers — no model required`,
        'good',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not propose drafts', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, status: 'accepted' | 'rejected' | 'in_review') {
    try {
      await api.reviewAiDraft(project.id, id, status);
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not review', 'critical');
    }
  }

  async function commit(id: string) {
    try {
      const result = await api.commitAiDraft(project.id, id);
      setProject(await api.getProject(project.id));
      toast(result.recordId ? 'Committed into the project register' : 'Marked committed (plan / comment — no new register row)', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not commit', 'critical');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-ink-secondary">
          Controlled AI: drafts are proposed from live registers. Nothing writes a finding, risk or action until a person reviews and commits.
        </p>
        <Button onClick={() => void propose()} disabled={busy}>Propose from registers</Button>
      </div>
      <Callout title="Manual-first">
        The DD operating model works with no model key. A configured model does not auto-commit. Orchestrator plans recommend next DDs; they do not run them.
      </Callout>
      {drafts.length === 0 ? (
        <EmptyState title="No drafts yet" description="Propose from evidence gaps, material findings and unfinished checks. Review before anything lands in a register." />
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <Card key={d.id}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{d.title}</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">
                      {AI_DRAFT_KIND_LABEL[d.kind]} · {d.source} · {formatWhen(d.createdAt)}
                    </p>
                  </div>
                  <Badge tone={toneFor(d.status)}>{AI_DRAFT_STATUS_LABEL[d.status]}</Badge>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-secondary">{d.body}</pre>
                {d.status !== 'committed' && d.status !== 'rejected' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => void review(d.id, 'in_review')}>Mark in review</Button>
                    <Button size="sm" variant="ghost" onClick={() => void review(d.id, 'accepted')}>Accept</Button>
                    <Button size="sm" variant="ghost" onClick={() => void review(d.id, 'rejected')}>Reject</Button>
                    <Button size="sm" onClick={() => void commit(d.id)}>Commit to register</Button>
                  </div>
                ) : null}
                {d.committedRecordId ? (
                  <p className="font-mono text-[11px] text-ink-muted">Wrote {d.committedRecordId}</p>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
