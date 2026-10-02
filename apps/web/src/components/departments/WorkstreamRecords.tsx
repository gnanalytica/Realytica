import { useMemo, useState } from 'react';
import { Briefcase, ClipboardList, FileText } from 'lucide-react';
import {
  CHECK_RESULT_LABEL,
  ENGAGEMENT_KINDS,
  departmentRole,
  engagementsIn,
  roleCanEdit,
  workstreamDefinition,
  workstreamDocuments,
  workstreamOfCheck,
  type CheckResult,
  type DdProject,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, cn, useToast, type Tone } from '../ui/kit';

export const RESULT_TONE: Record<CheckResult, Tone> = {
  pending: 'neutral',
  compliant: 'good',
  non_compliant: 'critical',
  partially_compliant: 'warning',
  not_applicable: 'neutral',
  unable_to_verify: 'warning',
  missing_evidence: 'warning',
  requires_expert_review: 'info',
};

interface CheckRow {
  definitionId: string;
  title: string;
  result: CheckResult;
  evidence: number;
  updatedAt: string;
  where: { ddId: string; scopeId: string; checkId: string };
  /** How many DDs carry this same check. */
  copies: number;
}

/**
 * One row per check in the workstream. Where an older file put the same check
 * in more than one DD, the answered one shows — a check answered once is
 * answered for every engagement that needs it.
 */
function checkRows(project: DdProject, workstream: string): CheckRow[] {
  const byDef = new Map<string, CheckRow>();
  for (const a of project.assessments) {
    if (a.status === 'archived') continue;
    for (const s of a.scopes) {
      for (const c of s.checks) {
        if (workstreamOfCheck(c.definitionId) !== workstream) continue;
        const row: CheckRow = { definitionId: c.definitionId, title: c.title, result: c.result, evidence: c.evidenceIds.length, updatedAt: c.updatedAt, where: { ddId: a.id, scopeId: s.id, checkId: c.id }, copies: 1 };
        const held = byDef.get(c.definitionId);
        if (!held) byDef.set(c.definitionId, row);
        else {
          const better = (held.result === 'pending' && row.result !== 'pending') || (held.result !== 'pending' && row.result !== 'pending' && row.updatedAt > held.updatedAt);
          byDef.set(c.definitionId, better ? { ...row, copies: held.copies + 1 } : { ...held, copies: held.copies + 1 });
        }
      }
    }
  }
  return [...byDef.values()];
}

export function WorkstreamChecks({
  project,
  workstream,
  onChanged,
  onOpenCheck,
}: {
  project: DdProject;
  workstream: string;
  onChanged: (p: DdProject) => void;
  onOpenCheck: (where: { ddId: string; scopeId: string; checkId: string }) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ws = workstreamDefinition(workstream)!;
  const rows = useMemo(() => checkRows(project, workstream), [project, workstream]);
  const answered = rows.filter((r) => r.result !== 'pending').length;
  const issues = rows.filter((r) => r.result === 'non_compliant' || r.result === 'partially_compliant' || r.result === 'missing_evidence').length;
  const mayEdit = me ? roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, ws.department)) : false;

  async function start() {
    setBusy(true);
    try {
      const res = await workspaceApi.startWorkstreamChecks(project.id, workstream);
      onChanged(res.project);
      toast(`The ${ws.label} checks are on the file.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the checks', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<ClipboardList size={15} />}
        title="Checks"
        subtitle={rows.length ? `${answered} of ${rows.length} answered${issues ? ` · ${issues} with an issue` : ''}` : 'The standard checks for this work'}
      />
      <CardBody>
        {rows.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">No checks on the file for {ws.label} yet. They come from the library, each answered once for every engagement that needs it.</p>
            {mayEdit ? (
              <Button size="sm" loading={busy} onClick={() => void start()}>
                Add the {ws.label} checks
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((r) => (
              <li key={r.definitionId}>
                <button type="button" onClick={() => onOpenCheck(r.where)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-sunken/60">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">{r.title}</span>
                  {r.evidence ? <span className="shrink-0 text-micro text-ink-muted">{r.evidence} doc{r.evidence === 1 ? '' : 's'}</span> : null}
                  <Badge tone={RESULT_TONE[r.result]}>{CHECK_RESULT_LABEL[r.result]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function WorkstreamDocuments({ project, workstream, onOpenDocument }: { project: DdProject; workstream: string; onOpenDocument: (evidenceId: string) => void }) {
  const docs = useMemo(() => workstreamDocuments(project, workstream).filter((e) => e.attachments.length), [project, workstream]);
  return (
    <Card>
      <CardHeader icon={<FileText size={15} />} title="Documents" subtitle={docs.length ? `${docs.length} in the vault belong to this work` : 'None in the vault belong to this work yet'} />
      <CardBody>
        {docs.length ? (
          <ul className="divide-y divide-hairline">
            {docs.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onOpenDocument(e.id)} className="flex w-full items-baseline gap-3 py-2 text-left hover:bg-sunken/60">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={e.title}>{e.title}</span>
                  {e.documentType ? <span className="shrink-0 text-micro text-ink-secondary">{e.documentType}</span> : null}
                  <span className="shrink-0 font-mono text-micro text-ink-muted">{new Date(e.attachments[0]!.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-secondary">Drop documents into Documents or the chat. Each is read, typed and given to the workstream it belongs to.</p>
        )}
      </CardBody>
    </Card>
  );
}

export function WorkstreamEngagements({ project, workstream }: { project: DdProject; workstream: string }) {
  const list = engagementsIn(project, workstream);
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader icon={<Briefcase size={15} />} title="Engagements drawing on this work" />
      <CardBody>
        <ul className="space-y-1.5">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-medium text-ink">{e.title}</span>
              <span className="text-ink-secondary">{ENGAGEMENT_KINDS[e.kind].label}</span>
              {e.client ? <span className="text-ink-secondary">for {e.client}</span> : null}
              {e.dueDate ? <span className={cn('font-mono text-micro', e.dueDate < new Date().toISOString().slice(0, 10) && e.stage !== 'issued' ? 'text-critical' : 'text-ink-muted')}>due {e.dueDate}</span> : null}
              <Badge tone={e.stage === 'issued' ? 'good' : 'neutral'}>{e.stage.replace('_', ' ')}</Badge>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
