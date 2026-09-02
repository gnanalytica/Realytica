import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import {
  ACTION_STATUS_LABEL,
  ASSESSMENT_STATUS_LABEL,
  CHECK_RESULT_LABEL,
  EVIDENCE_STATUS_LABEL,
  FINDING_STATUS_LABEL,
  SCOPE_STATUS_LABEL,
  SEVERITY_LABEL,
  WORK_KIND_LABEL,
  cockpitPath,
  type ActionStatus,
  type AssessmentStatus,
  type CheckResult,
  type EvidenceStatus,
  type FindingStatus,
  type ScopeStatus,
  type WorkItem,
  type WorkKind,
} from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useMe } from '../lib/useMe';
import { Badge, Callout, Card, CardBody, EmptyState, Skeleton, cn } from '../components/ui/kit';
import { severityTone } from './projects/shared';

/**
 * What I am supposed to be doing.
 *
 * The question the product could not answer. Sixteen fields in the model name
 * a person and every one is free text, so asking it meant opening each project
 * in turn and reading its registers — which is the same as not being able to
 * ask at all.
 *
 * One flat list across every file, ordered by what is late rather than grouped
 * by project. Grouping would be tidier and would put the reader back where
 * they started: deciding which project to look in first is the work this
 * screen exists to remove.
 */

/** The register's own word for where a row stands, whatever kind it is. */
function statusLabel(item: WorkItem): string {
  if (item.kind === 'action') return ACTION_STATUS_LABEL[item.status as ActionStatus] ?? item.status;
  if (item.kind === 'finding') return FINDING_STATUS_LABEL[item.status as FindingStatus] ?? item.status;
  if (item.kind === 'evidence') return EVIDENCE_STATUS_LABEL[item.status as EvidenceStatus] ?? item.status;
  if (item.kind === 'check') return CHECK_RESULT_LABEL[item.status as CheckResult] ?? item.status;
  if (item.kind === 'assessment') return ASSESSMENT_STATUS_LABEL[item.status as AssessmentStatus] ?? item.status;
  if (item.kind === 'scope') return SCOPE_STATUS_LABEL[item.status as ScopeStatus] ?? item.status;
  return SEVERITY_LABEL[item.severity ?? 'low'] ?? item.status;
}

/**
 * A due date is a day, not a moment.
 *
 * `formatWhen` prints the time beside it, which on "due Aug 1" is always
 * 12:00 AM and always noise.
 */
function dueOn(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Where the row lives. The pane is the record's register; the check is its scope. */
function linkFor(item: WorkItem): string {
  if (item.kind === 'check') return cockpitPath(item.projectId, 'scope', { ddId: item.ddId, scopeId: item.scopeId, checkId: item.id });
  if (item.kind === 'scope') return cockpitPath(item.projectId, 'scope', { ddId: item.ddId, scopeId: item.scopeId });
  if (item.kind === 'assessment') return cockpitPath(item.projectId, 'dd', { ddId: item.ddId });
  if (item.kind === 'action') return cockpitPath(item.projectId, 'actions', { actionId: item.id });
  if (item.kind === 'risk') return cockpitPath(item.projectId, 'risks', { riskId: item.id });
  if (item.kind === 'finding') return cockpitPath(item.projectId, 'findings', { findingId: item.id });
  return cockpitPath(item.projectId, 'evidence', { evidenceId: item.id });
}

/*
 * The filter chips, in the order they read rather than alphabetically by
 * accident. Assessment and scope go last because they are the containers —
 * somebody scanning this wants the individual things they owe first.
 */
const KINDS: WorkKind[] = ['action', 'check', 'evidence', 'finding', 'risk', 'scope', 'assessment'];

export default function MyWork() {
  const me = useMe();
  const { data, error, loading } = useAsync(() => api.myWork(), []);
  const [kind, setKind] = useState<WorkKind | 'all'>('all');

  const items = useMemo(() => data?.items ?? [], [data]);
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const overdue = items.filter((i) => i.overdue).length;
  const counts = useMemo(() => {
    const map = new Map<WorkKind, number>();
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    return map;
  }, [items]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">My work</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">
          {items.length === 0
            ? 'Everything across every project with your name on it.'
            : `${items.length} open across every project${overdue > 0 ? ` · ${overdue} late` : ''}`}
        </p>
      </div>

      {error ? <Callout tone="critical" title="Could not load your work">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-40 w-full" /> : null}

      {data && items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...KINDS] as const).map((key) => {
            const on = kind === key;
            const n = key === 'all' ? items.length : (counts.get(key) ?? 0);
            if (key !== 'all' && n === 0) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] coarse:min-h-11',
                  on ? 'bg-brand-soft font-semibold text-brand' : 'bg-sunken text-ink-secondary hover:text-ink',
                )}
              >
                {key === 'all' ? 'Everything' : `${WORK_KIND_LABEL[key]}s`}
                <span className="text-ink-muted">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {data && items.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<CircleCheck size={18} />}
              title="Nothing is waiting on you"
              description={
                me
                  ? `Work is yours when its owner reads ${me.email}${me.name ? ` or ${me.name}` : ''}. Typing a name a different way is why a row can be missing here and present on the project.`
                  : 'Work is yours when its owner field names you.'
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {shown.length > 0 ? (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {shown.map((item) => (
              <Link
                key={`${item.projectId}:${item.id}`}
                to={linkFor(item)}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-sunken"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{item.title}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    <span className="font-mono">{item.projectReference}</span> · {item.projectName} ·{' '}
                    {WORK_KIND_LABEL[item.kind]}
                    {item.dueDate ? ` · due ${dueOn(item.dueDate)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.overdue ? <Badge tone="critical">Late</Badge> : null}
                  {item.severity ? (
                    <Badge tone={severityTone(item.severity)}>{SEVERITY_LABEL[item.severity]}</Badge>
                  ) : null}
                  {/* An action whose status is already "overdue" would otherwise
                      carry the same fact twice, in two different words. */}
                  {item.overdue && item.status === 'overdue' ? null : <Badge>{statusLabel(item)}</Badge>}
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
