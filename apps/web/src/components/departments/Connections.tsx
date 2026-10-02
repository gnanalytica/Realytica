import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Network } from 'lucide-react';
import {
  DEPARTMENT_ROLE_LABEL,
  LINK_TYPE_LABEL,
  projectLinks,
  workstreamDefinition,
  type DdProject,
  type ProjectLink,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Card, CardBody, CardHeader, Skeleton, cn } from '../ui/kit';

function endLabel(project: DdProject, end: ProjectLink['from']): string {
  switch (end.kind) {
    case 'workstream':
      return workstreamDefinition(end.id)?.label ?? end.id;
    case 'approval':
      return end.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    case 'document':
      return project.evidence.find((e) => e.id === end.id)?.title ?? 'A document';
    case 'engagement':
      return project.engagements?.find((e) => e.id === end.id)?.title ?? 'An engagement';
    case 'certified':
      return project.certifiedReports?.find((r) => r.id === end.id)?.title ?? 'A certified report';
    default:
      return end.kind.replace(/_/g, ' ');
  }
}

/**
 * How this workstream reaches the rest of the project, both ways.
 *
 * Upstream is read from the links themselves: what feeds this estimate and
 * what gates this work. Downstream is the graph's own walk — the workstreams
 * a change here reaches through gates and feeds, and the engagements,
 * certified reports and people standing on them — answered by Neo4j in
 * production.
 */
export function Connections({ project, workstream, onOpenWorkstream }: { project: DdProject; workstream: string; onOpenWorkstream: (key: string) => void }) {
  const node = `${project.id}::ws::${workstream}`;
  const impact = useAsync(() => workspaceApi.impact(project.id, node), [project.id, node, project.updatedAt]);
  const upstream = useMemo(
    () =>
      projectLinks(project).filter(
        (l) => l.to.kind === 'workstream' && l.to.id === workstream && (l.type === 'feeds' || l.type === 'gates' || l.type === 'relates') && (l.from.kind === 'workstream' || l.from.kind === 'approval'),
      ),
    [project, workstream],
  );
  const result = impact.data?.impact;

  return (
    <Card>
      <CardHeader
        icon={<Network size={15} />}
        title="Connections"
        subtitle="What this work depends on, and what a change here reaches"
        action={impact.data ? <Badge tone="neutral" title="Where the walk was answered">{impact.data.source === 'neo4j' ? 'Neo4j' : impact.data.source === 'journal' ? 'Local graph' : 'Projection'}</Badge> : null}
      />
      <CardBody className="grid gap-4 [@container(min-width:40rem)]:grid-cols-2">
        <section className="min-w-0">
          <h4 className="mb-1 flex items-center gap-1 text-[12px] font-semibold text-ink">
            <ArrowDownRight size={13} /> Depends on
          </h4>
          {upstream.length ? (
            <ul className="space-y-1">
              {upstream.map((l) => (
                <li key={l.id} className="text-[13px] text-ink">
                  {l.from.kind === 'workstream' ? (
                    <button type="button" className="text-brand hover:underline" onClick={() => onOpenWorkstream(l.from.id)}>
                      {endLabel(project, l.from)}
                    </button>
                  ) : (
                    endLabel(project, l.from)
                  )}{' '}
                  <span className="text-ink-muted">{LINK_TYPE_LABEL[l.type]} this</span>
                  {l.note ? <span className="block text-micro text-ink-muted">{l.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-secondary">Nothing feeds or gates this work.</p>
          )}
        </section>
        <section className="min-w-0">
          <h4 className="mb-1 flex items-center gap-1 text-[12px] font-semibold text-ink">
            <ArrowUpRight size={13} /> A change here reaches
          </h4>
          {impact.loading && !impact.data ? (
            <Skeleton className="h-16 w-full" />
          ) : impact.error ? (
            <p className="text-[13px] text-ink-secondary">The graph did not answer: {impact.error}</p>
          ) : result ? (
            <div className="space-y-2">
              {result.downstream.length ? (
                <ul className="space-y-1">
                  {result.downstream.map((d) => (
                    <li key={d.node.id} className="text-[13px]">
                      <button type="button" className="text-brand hover:underline" onClick={() => d.node.key && onOpenWorkstream(d.node.key)}>
                        {d.node.label}
                      </button>{' '}
                      <span className="text-ink-muted">
                        {d.via === 'gates' ? 'gated' : 'fed'}
                        {d.hops > 1 ? `, ${d.hops} steps away` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-secondary">No other workstream depends on this one.</p>
              )}
              {result.engagements.length ? (
                <p className="text-[12px] text-ink-secondary">
                  Engagements: {result.engagements.map((e) => e.label).join(', ')}
                </p>
              ) : null}
              {result.certified.length ? (
                <p className="text-[12px] text-ink-secondary">
                  Certified reports standing on it:{' '}
                  {result.certified.map((c) => (
                    <span key={c.id} className={cn(c.status === 'revisit' && 'font-medium text-ink')}>
                      {c.label}
                      {c.status === 'revisit' ? ' (to revisit)' : ''}
                    </span>
                  ))}
                </p>
              ) : null}
              {result.people.length ? (
                <p className="text-[12px] text-ink-secondary">
                  Answering for it:{' '}
                  {result.people.map((p) => `${p.node.label} (${p.role === 'leads' ? DEPARTMENT_ROLE_LABEL.lead : DEPARTMENT_ROLE_LABEL.signer}, ${p.department.label})`).join('; ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </CardBody>
    </Card>
  );
}
