import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { buildProjectGraph, type ProjectGraphNode } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, Select } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { useStickyState } from '../../lib/useStickyState';

const KIND_ORDER: ProjectGraphNode['kind'][] = [
  'project',
  'asset',
  'assessment',
  'scope',
  'check',
  'finding',
  'risk',
  'action',
  'decision',
  'evidence',
  'report',
  'question',
  'thought',
  'proposal',
];

export default function ProjectGraph() {
  const { project, onOpenCited } = useOutletContext<ProjectOutlet>();
  const graph = useMemo(() => buildProjectGraph(project), [project]);
  const [kind, setKind] = useStickyState<'all' | ProjectGraphNode['kind']>(
    project.id,
    'graphKind',
    'all',
    (v) => v === 'all' || (KIND_ORDER as readonly string[]).includes(v),
  );
  const nodes = kind === 'all' ? graph.nodes : graph.nodes.filter((n) => n.kind === kind || n.kind === 'project');
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const grouped = KIND_ORDER.map((k) => ({ kind: k, rows: nodes.filter((n) => n.kind === k) })).filter((g) => g.rows.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-full max-w-xs sm:w-48">
          <option value="all">All nodes ({graph.nodes.length})</option>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>{k} ({graph.nodes.filter((n) => n.kind === k).length})</option>
          ))}
        </Select>
        <p className="tabular text-[12px] text-ink-muted">{nodes.length} nodes · {edges.length} links</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {grouped.map((group) => (
          <Card key={group.kind}>
            <CardHeader title={group.kind} subtitle={`${group.rows.length}`} />
            <CardBody className="max-h-80 space-y-2 overflow-y-auto">
              {group.rows.map((n) => (
                <div
                  key={n.id}
                  className="cursor-pointer border-b border-hairline pb-2 last:border-0"
                  onClick={() => onOpenCited?.(n.id)}
                >
                  <p className="text-[13px] font-medium text-ink">{n.label}</p>
                  {n.detail ? <p className="text-[12px] text-ink-muted">{n.detail}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {edges.filter((e) => e.from === n.id || e.to === n.id).slice(0, 4).map((e) => (
                      <Badge key={e.id}>{e.rel}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
