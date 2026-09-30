import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleAlert, Plus, Search, Sparkles, TriangleAlert } from 'lucide-react';
import {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_LABEL,
  LIFECYCLE_STAGE_LABEL,
  type PortfolioDue,
  type PortfolioView,
  type ProjectSummary,
} from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { readPref, writePref } from '../lib/prefs';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton, cn, useToast } from '../components/ui/kit';
import { Avatar, dayMonth } from '../components/project/ProjectPanels';

const LAST_SEEN_KEY = 'portfolioLastSeen';

type Filter = 'all' | 'active' | 'issued';

function dashboardHref(projectId: string): string {
  return `/projects/${projectId}/dashboard`;
}

function healthChip(p: ProjectSummary) {
  if (p.health === 'red') return <Badge tone="critical" icon={<CircleAlert size={11} />}>At risk</Badge>;
  if (p.health === 'amber') return <Badge tone="warning" icon={<TriangleAlert size={11} />}>Attention</Badge>;
  if (p.health === 'green') return <Badge tone="good">On track</Badge>;
  return null;
}

function EngagementCard({ project, next }: { project: ProjectSummary; next?: PortfolioDue }) {
  const e = project.engagement;
  return (
    <Link
      to={dashboardHref(project.id)}
      className="block rounded-xl bg-surface p-3 ring-1 ring-[var(--ring)] shadow-card transition-colors hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <p className="text-[13px] font-semibold leading-snug text-ink">{project.name}</p>
      {e?.scope ? <p className="mt-0.5 text-[12px] text-ink-secondary">{e.scope}</p> : null}
      <p className="mt-0.5 text-[12px] text-ink-muted">
        {LIFECYCLE_STAGE_LABEL[project.currentStage]} · {project.city}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {healthChip(project)}
        {project.pendingDecisions ? <Badge tone="brand" icon={<Sparkles size={11} />}>{project.pendingDecisions} to decide</Badge> : null}
        {project.waitingOn ? <Badge tone="neutral">{project.waitingOn} waiting</Badge> : null}
        {project.sample ? <Badge tone="neutral" className="border border-dashed border-ink-muted bg-transparent">Sample</Badge> : null}
      </div>
      <div className="mt-2.5 border-t border-hairline pt-2">
        <p className="text-[11px] text-ink-muted">Next</p>
        <div className="flex items-baseline justify-between gap-2 text-[12px]">
          <span className="min-w-0 truncate text-ink">{next ? next.label : e?.dueDate ? 'Report due' : 'Nothing due'}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-secondary">{next ? dayMonth(next.date) : e?.dueDate ? dayMonth(e.dueDate) : ''}</span>
        </div>
      </div>
      {e?.lead ? (
        <div className="mt-2 flex items-center gap-1.5">
          <Avatar name={e.lead} className="h-6 w-6" />
          <span className="truncate text-[11px] text-ink-secondary">{e.lead}</span>
        </div>
      ) : null}
    </Link>
  );
}

function FortnightStrip({ view }: { view: PortfolioView }) {
  const today = view.today;
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const byDay = new Map<string, PortfolioDue[]>();
  for (const item of view.upcoming) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  return (
    <div className="grid grid-cols-7 gap-1 sm:grid-cols-[repeat(14,minmax(0,1fr))]">
      {days.map((d, i) => {
        const date = new Date(`${d}T00:00:00Z`);
        const items = byDay.get(d) ?? [];
        const urgent = items.some((it) => it.kind === 'request' || it.kind === 'report');
        return (
          <div
            key={d}
            title={items.map((it) => `${it.label} · ${it.projectName}`).join('\n') || undefined}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-md py-1 text-center',
              i === 0 ? 'bg-ink text-ink-inverse' : 'text-ink-secondary',
            )}
          >
            <span className="text-[10px] uppercase">{date.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}</span>
            <span className="font-mono text-[12px] font-semibold">{date.getUTCDate()}</span>
            <span
              aria-hidden
              className={cn('h-1.5 w-1.5 rounded-full', items.length ? (urgent ? 'bg-critical' : i === 0 ? 'bg-ink-inverse' : 'bg-ink') : 'bg-transparent')}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The firm's engagements as a pipeline.
 *
 * Outside a case the product is a dashboard: where every engagement stands,
 * what waits for a person's decision, what the firm is waiting on from
 * others, and what falls due in the next two weeks.
 */
export default function Portfolio() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, refresh } = useAsync(() => api.portfolio(), []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [seeding, setSeeding] = useState(false);
  const [lastSeen] = useState<string | null>(() => readPref(LAST_SEEN_KEY));

  // The visit is recorded on the way out, so this visit's digest still reads
  // against the previous one.
  useEffect(() => () => writePref(LAST_SEEN_KEY, new Date().toISOString()), []);

  const nextByProject = useMemo(() => {
    const map = new Map<string, PortfolioDue>();
    for (const item of data?.upcoming ?? []) if (!map.has(item.projectId)) map.set(item.projectId, item);
    return map;
  }, [data]);

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.projects ?? []).filter((p) => {
      const stage = p.engagement?.stage ?? 'intake';
      if (filter === 'active' && stage === 'issued') return false;
      if (filter === 'issued' && stage !== 'issued') return false;
      if (!q) return true;
      return [p.name, p.reference, p.city, p.location, p.engagement?.client, p.engagement?.scope]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [data, query, filter]);

  async function loadSamples() {
    setSeeding(true);
    try {
      await api.seedDemo();
      await refresh();
      toast('Loaded the labelled sample engagements', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the samples', 'critical');
    } finally {
      setSeeding(false);
    }
  }

  const all = data?.projects ?? [];
  const issued = all.filter((p) => p.engagement?.stage === 'issued').length;
  const blockedProjects = all.filter((p) => p.health === 'red').length;
  const openRequests = data?.waitingOn.length ?? 0;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  const digest = useMemo(() => {
    if (!data || !lastSeen) return [];
    return data.projects
      .filter((p) => p.updatedAt > lastSeen)
      .slice(0, 3)
      .map((p) => {
        const decisions = data.decisions.filter((d) => d.projectId === p.id && d.createdAt > lastSeen).length;
        return { project: p, decisions };
      });
  }, [data, lastSeen]);

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Portfolio</h1>
          <p className="text-[13px] text-ink-secondary">
            {all.length} engagement{all.length === 1 ? '' : 's'} · {today}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ring-inset ring-[var(--ring)] focus-within:ring-brand">
            <Search size={14} className="text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects, clients, places"
              className="w-56 bg-transparent text-[13px] text-ink placeholder:text-ink-muted focus:outline-none"
            />
          </label>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/projects/new')}>
            New engagement
          </Button>
        </div>
      </header>

      {error ? <Callout tone="critical" title="Could not load the portfolio">{error}</Callout> : null}

      {digest.length > 0 ? (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-ink">Since your last visit</p>
              <p className="text-[13px] text-ink-secondary">
                {digest
                  .map(({ project, decisions }) => `${project.name}: updated ${dayMonth(project.updatedAt)}${decisions ? `, ${decisions} new proposal${decisions === 1 ? '' : 's'}` : ''}`)
                  .join(' · ')}
              </p>
            </div>
            <Link to={dashboardHref(digest[0]!.project.id)} className="text-[12px] font-medium text-brand">
              Open {digest[0]!.project.name}
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-sunken p-0.5">
          {(
            [
              ['all', `All ${all.length}`],
              ['active', `Active ${all.length - issued}`],
              ['issued', `Issued ${issued}`],
            ] as Array<[Filter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] coarse:min-h-11',
                filter === key ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-secondary hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {data ? (
          <p className="text-[12px] text-ink-secondary">
            {data.blockers} blocker{data.blockers === 1 ? '' : 's'}
            {blockedProjects ? ` across ${blockedProjects} project${blockedProjects === 1 ? '' : 's'}` : ''} · {openRequests} request
            {openRequests === 1 ? '' : 's'} open · {data.visitsInWindow} site visit{data.visitsInWindow === 1 ? '' : 's'} in the next 14 days
          </p>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            title="No engagements yet"
            description="Start an engagement for a client's property. Each one gets a case dashboard and a workspace with the copilot beside it."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => navigate('/projects/new')}>New engagement</Button>
                <Button variant="ghost" onClick={() => void loadSamples()} loading={seeding}>
                  Load the labelled samples
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[1080px] grid-cols-6 gap-3">
            {ENGAGEMENT_STAGES.map((stage) => {
              const column = projects.filter((p) => (p.engagement?.stage ?? 'intake') === stage);
              return (
                <section key={stage} aria-label={ENGAGEMENT_STAGE_LABEL[stage]} className="flex min-h-[12rem] flex-col gap-2 rounded-xl bg-sunken/70 p-2">
                  <h2 className="flex items-center gap-1.5 px-1 pt-0.5 text-[12px] font-semibold text-ink">
                    {ENGAGEMENT_STAGE_LABEL[stage]}
                    <span className="rounded-full bg-surface px-1.5 font-mono text-[10px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                      {column.length}
                    </span>
                  </h2>
                  {column.map((p) => (
                    <EngagementCard key={p.id} project={p} next={nextByProject.get(p.id)} />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {data && all.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className={cn(data.decisions.length > 0 && 'ring-2 ring-brand/40')}>
            <CardHeader
              title="Needs your decision"
              subtitle={data.decisions.length ? `${data.decisions.length} proposal${data.decisions.length === 1 ? '' : 's'}` : 'Nothing waiting'}
            />
            <CardBody>
              {data.decisions.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No proposals are waiting for a person.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.decisions.slice(0, 6).map((d) => (
                    <li key={d.proposalId} className="flex items-center gap-3 py-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand-soft text-brand">
                        <Sparkles size={11} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink">{d.title}</p>
                        <p className="truncate text-[12px] text-ink-secondary">{d.projectName}</p>
                      </div>
                      <Link
                        to={d.kind === 'draft' ? `/projects/${d.projectId}/ai` : `/projects/${d.projectId}`}
                        className="shrink-0 text-[12px] font-medium text-brand"
                      >
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-ink-muted">Only people change the record. AI proposals wait for a decision.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Waiting on others"
              subtitle={`${data.waitingOn.length} open request${data.waitingOn.length === 1 ? '' : 's'}`}
              action={<Link to="/requests" className="text-[12px] font-medium text-brand">All requests</Link>}
            />
            <CardBody>
              {data.waitingOn.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Nothing outstanding. Requests sent from a project's People tab appear here.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.waitingOn.slice(0, 6).map(({ request, projectName, projectId, ageDays, overdue }) => (
                    <li key={request.id}>
                      <Link to={`/projects/${projectId}/people`} className="flex items-center gap-3 py-2">
                        <Avatar name={request.recipient} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink">{request.recipient}</p>
                          <p className="truncate text-[12px] text-ink-secondary">{request.title} · {projectName}</p>
                        </div>
                        <Badge tone={overdue ? 'critical' : ageDays >= 5 ? 'warning' : 'neutral'}>
                          {overdue ? 'Overdue' : request.dueAt ? `Due ${dayMonth(request.dueAt)}` : `${ageDays} days`}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Next 14 days" subtitle={`${dayMonth(data.today)} to ${dayMonth(new Date(Date.parse(`${data.today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10))}`} />
            <CardBody className="space-y-3">
              <FortnightStrip view={data} />
              {data.upcoming.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Nothing falls due. Due dates on requests, actions, visits and reports show here.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.upcoming.slice(0, 7).map((item) => (
                    <li key={`${item.kind}:${item.refId}`}>
                      <Link to={dashboardHref(item.projectId)} className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-2 py-1.5 text-[12px]">
                        <span className="font-mono text-ink-muted">{dayMonth(item.date)}</span>
                        <span className="min-w-0 truncate text-ink">{item.label}</span>
                        <span className="max-w-[9rem] truncate text-right text-ink-secondary">{item.projectName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
