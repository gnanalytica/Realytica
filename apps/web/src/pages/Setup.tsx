import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { SETUP_STANDING_LABEL, cockpitPath, reachesEveryProject, setupSaid, type SetupRow, type SetupShown, type SetupStanding } from '@realytica/shared';
import { request } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useMe } from '../lib/useMe';
import { Badge, Callout, Card, CardBody, CardHeader, PageHeader, Skeleton, type Tone } from '../components/ui/kit';

const STANDING_TONE: Record<SetupStanding, Tone> = { working: 'good', not_set_up: 'warning', failing: 'critical', not_used: 'neutral' };

/** Where a row is configured: a page of the firm's, or the project's own page. */
function placeOf(row: SetupRow, projectId?: string): string | undefined {
  if (!row.open) return undefined;
  if (row.open.place === 'law') return '/law';
  if (row.open.place === 'integrations') return '/integrations';
  if (!projectId) return undefined;
  return cockpitPath(projectId, row.open.place === 'documents' ? 'evidence' : 'reports');
}

function Rows({ rows, projectId }: { rows: SetupRow[]; projectId?: string }) {
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((row) => {
        const to = placeOf(row, projectId);
        return (
          <li key={row.key} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-3">
            <p className="w-44 shrink-0 text-[13px] font-medium text-ink">{row.label}</p>
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <p className="text-[13px] text-ink-secondary">{row.says}</p>
              {row.error ? <p className="break-words text-[12px] text-critical">{row.error}</p> : null}
              {row.needs ? (
                <p className="text-[12px] text-ink-secondary">
                  <span className="font-medium text-ink">Needed: </span>
                  {row.needs}
                </p>
              ) : null}
              {row.settings?.length ? <p className="break-all font-mono text-[11px] text-ink-muted">{row.settings.join(' · ')}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={STANDING_TONE[row.standing]}>{SETUP_STANDING_LABEL[row.standing]}</Badge>
              {to && row.open ? (
                <Link to={to} className="group/open inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11">
                  {row.open.label}
                  <ArrowRight size={12} className="transition-transform duration-quick ease-state group-hover/open:translate-x-0.5" aria-hidden />
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Set up: each thing that can be connected or scheduled, with one line
 * saying whether it works, what is needed where it does not, and where it
 * is changed.
 */
export default function Setup() {
  const me = useMe();
  const staff = me ? reachesEveryProject(me.role) : false;
  const { data, error, loading } = useAsync(() => (staff ? request<SetupShown>('/setup') : Promise.resolve(null)), [staff]);
  if (me && !staff) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Workspace" title="Set up" />
        <Callout tone="neutral" title="Set up is for the firm’s own people">
          Ask whoever invited you if something you were sent has not arrived.
        </Callout>
      </div>
    );
  }
  return (
    <div className="space-y-4 pb-10">
      <PageHeader eyebrow="Workspace" title="Set up" subtitle={data ? setupSaid(data) : 'What is connected, what runs by itself, and what is needed for the rest'} />
      {error ? <Callout tone="critical" title="Could not load the set up">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-64 w-full rounded-xl" /> : null}
      {data ? (
        <>
          <Card>
            <CardHeader title="The firm" subtitle="Set once, for every project" />
            <CardBody className="py-1">
              <Rows rows={data.firm} />
            </CardBody>
          </Card>
          {data.projects.map((project) => (
            <Card key={project.id}>
              <CardHeader title={project.name} subtitle={project.reference} />
              <CardBody className="py-1">
                <Rows rows={project.rows} projectId={project.id} />
              </CardBody>
            </Card>
          ))}
          {data.projects.length === 0 ? <p className="text-[13px] text-ink-muted">No project yet. A project’s folder and report day are listed here once it is made.</p> : null}
        </>
      ) : null}
    </div>
  );
}
