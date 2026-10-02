import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, CalendarDays, CircleAlert, FolderTree, Inbox, Plus, Search, TriangleAlert } from 'lucide-react';
import {
  ENGAGEMENT_STAGE_LABEL,
  STAGES,
  SUB_STAGE_LABEL,
  stageDefinition,
  stageOf,
  type PortfolioDue,
  type PortfolioView,
  type ProjectSummary,
} from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { readPref, writePref } from '../lib/prefs';
import { AnimatedNumber, Reveal, SPRING, Stagger, StaggerItem, motion } from '../lib/motion';
import { AiMark, Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton, Tooltip, cn } from '../components/ui/kit';
import { Avatar, dayMonth } from '../components/project/ProjectPanels';

const LAST_SEEN_KEY = 'portfolioLastSeen';

type Filter = 'all' | 'active' | 'issued';

function projectHref(projectId: string): string {
  return `/projects/${projectId}`;
}

function healthChip(p: ProjectSummary) {
  if (p.health === 'red') return <Badge tone="critical" icon={<CircleAlert size={11} />}>At risk</Badge>;
  if (p.health === 'amber') return <Badge tone="warning" icon={<TriangleAlert size={11} />}>Attention</Badge>;
  if (p.health === 'green') return <Badge tone="good">On track</Badge>;
  return null;
}

/** Where in its stage a project is: one segment a step, the current one ringed. */
function StepBar({ stage }: { stage: ProjectSummary['currentStage'] }) {
  const steps = stageDefinition(stageOf(stage)).subStages;
  const at = steps.indexOf(stage);
  return (
    <span className="flex gap-0.5" aria-label={`Step ${at + 1} of ${steps.length} in its stage`}>
      {steps.map((step, i) => (
        <span key={step} className={cn('h-1 w-4 rounded-full', i < at ? 'bg-ink' : i === at ? 'bg-brand' : 'bg-[var(--axis)]')} />
      ))}
    </span>
  );
}

const HEALTH_RAIL: Record<ProjectSummary['health'], string> = {
  red: 'bg-critical',
  amber: 'bg-warning',
  green: 'bg-good',
  unknown: 'bg-transparent',
};

function ProjectCard({ project, next }: { project: ProjectSummary; next?: PortfolioDue }) {
  const e = project.engagement;
  return (
    <Link
      to={projectHref(project.id)}
      className={cn(
        'group relative block overflow-hidden rounded-2xl bg-surface p-3.5 pl-4 ring-1 ring-[var(--ring)] shadow-card',
        'transition-[transform,box-shadow] duration-base ease-enter hover:-translate-y-0.5 hover:shadow-raised active:translate-y-0 motion-reduce:hover:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      )}
    >
      {/* The file's health, as an edge: read down a column without reading a word. */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', HEALTH_RAIL[project.health])} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13.5px] font-semibold leading-snug text-ink">{project.name}</p>
        <ArrowRight size={14} className="mt-0.5 shrink-0 -translate-x-1 text-ink-muted opacity-0 transition-[opacity,transform] duration-quick ease-state group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-muted">
        <StepBar stage={project.currentStage} />
        <span className="truncate">
          {SUB_STAGE_LABEL[project.currentStage]} · {project.city}
        </span>
      </div>
      {e ? (
        <p className="mt-0.5 text-[12px] text-ink-secondary">
          {e.title}
          {e.client ? ` for ${e.client}` : ''} · {ENGAGEMENT_STAGE_LABEL[e.stage]}
          {project.engagements && project.engagements > 1 ? ` · +${project.engagements - 1} more` : ''}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {healthChip(project)}
        {project.openAlerts ? (
          <Badge tone={project.criticalAlerts ? 'critical' : 'warning'} icon={<Bell size={11} />}>
            {project.openAlerts} alert{project.openAlerts === 1 ? '' : 's'}
          </Badge>
        ) : null}
        {project.pendingDecisions ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-ai/10 px-1.5 py-0.5 text-mini font-medium leading-4 text-ai-ink ring-1 ring-inset ring-ai/25">
            <AiMark size="xs" className="size-3 text-[6px]" />
            {project.pendingDecisions} to decide
          </span>
        ) : null}
        {project.waitingOn ? <Badge tone="neutral">{project.waitingOn} waiting</Badge> : null}
      </div>
      <div className="mt-3 border-t border-hairline pt-2">
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
        const cell = (
          <div
            className={cn(
              'flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-center transition-colors duration-quick',
              i === 0 ? 'bg-ink text-ink-inverse shadow-card' : items.length ? 'bg-sunken text-ink hover:bg-[var(--hairline)]' : 'text-ink-secondary',
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
        return items.length ? (
          <Tooltip key={d} className="w-full" label={items.map((it) => `${it.label} · ${it.projectName}`).join(' — ')}>
            {cell}
          </Tooltip>
        ) : (
          <div key={d}>{cell}</div>
        );
      })}
    </div>
  );
}

function PortfolioFigure({
  icon: Icon,
  ai = false,
  label,
  value,
  hint,
  tone,
}: {
  icon?: typeof FolderTree;
  ai?: boolean;
  label: string;
  value: number;
  hint?: string;
  tone?: 'critical';
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="flex items-center gap-1.5 truncate text-[12px] text-ink-muted">
        {ai ? <AiMark size="xs" /> : Icon ? <Icon size={13} aria-hidden /> : null}
        {label}
      </p>
      <p className={cn('mt-1.5 text-[24px] font-semibold leading-none tracking-tight tabular-nums', tone === 'critical' && value > 0 ? 'text-critical' : 'text-ink')}>
        <AnimatedNumber value={value} />
      </p>
      {hint ? <p className="mt-1 truncate text-[12px] text-ink-secondary">{hint}</p> : null}
    </div>
  );
}

/**
 * Every project the firm works on, by the stage of its life it is in.
 *
 * Outside a project the product is a dashboard: where each project stands,
 * what waits for a person's decision, what the firm is waiting on from
 * others, and what falls due in the next two weeks.
 */
export default function Portfolio() {
  const navigate = useNavigate();
  const { data, error, loading } = useAsync(() => api.portfolio(), []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
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
      <Reveal>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-ink-muted">{today}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">Portfolio</h1>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface px-3 py-2 shadow-card ring-1 ring-inset ring-[var(--ring)] transition-[box-shadow] duration-quick focus-within:ring-2 focus-within:ring-brand sm:flex-none">
            <Search size={14} className="shrink-0 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects, clients, places"
              className="w-full min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-muted focus:outline-none coarse:text-base sm:w-56"
            />
          </label>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/projects/new')}>
            New project
          </Button>
        </div>
      </header>
      </Reveal>

      {error ? <Callout tone="critical" title="Could not load the portfolio">{error}</Callout> : null}

      {data && all.length > 0 ? (
        <Reveal delay={0.05}>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-hairline shadow-card ring-1 ring-[var(--ring)] lg:grid-cols-5 [&>*]:bg-surface max-lg:[&>*:last-child]:col-span-2">
            <PortfolioFigure icon={FolderTree} label="Projects" value={all.length} hint={`${all.length - issued} active`} />
            <PortfolioFigure icon={CircleAlert} label="At risk" value={blockedProjects} tone={blockedProjects ? 'critical' : undefined} hint={`${data.blockers} blocker${data.blockers === 1 ? '' : 's'}`} />
            <PortfolioFigure ai label="Waiting for a decision" value={data.decisions.length} hint="AI proposals" />
            <PortfolioFigure icon={Inbox} label="Requests open" value={openRequests} hint="Waiting on others" />
            <PortfolioFigure icon={CalendarDays} label="Site visits" value={data.visitsInWindow} hint="Next 14 days" />
          </div>
        </Reveal>
      ) : null}

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
            <Link to={projectHref(digest[0]!.project.id)} className="text-[12px] font-medium text-brand">
              Open {digest[0]!.project.name}
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-sunken p-0.5 ring-1 ring-inset ring-[var(--ring)]">
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
                'relative rounded-[10px] px-3 py-1 text-[12px] transition-colors duration-quick coarse:min-h-11',
                filter === key ? 'font-semibold text-ink' : 'text-ink-secondary hover:text-ink',
              )}
            >
              {filter === key ? <motion.span layoutId="portfolio-filter" aria-hidden className="absolute inset-0 rounded-[10px] bg-surface shadow-card ring-1 ring-[var(--ring)]" transition={SPRING.snappy} /> : null}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
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
            title="No projects yet"
            description="Start a project for a property — a site, a scheme under construction, a building in use. It gets a workspace with its departments, its documents and the chat beside it."
            action={
              <Button variant="primary" onClick={() => navigate('/projects/new')}>
                New project
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 no-scrollbar [scroll-padding-inline:1rem] snap-x snap-mandatory sm:mx-0 sm:px-0 lg:overflow-visible">
          <div className="grid auto-cols-[82%] grid-flow-col items-start gap-3 sm:auto-cols-[minmax(15rem,1fr)] lg:grid-flow-row lg:grid-cols-4">
            {STAGES.map((stage, index) => {
              const column = projects.filter((p) => stageOf(p.currentStage) === stage.key);
              return (
                <section key={stage.key} aria-label={stage.label} className="flex snap-start flex-col gap-2 rounded-2xl bg-sunken/70 p-2 ring-1 ring-inset ring-[var(--ring)]">
                  <h2 className="flex items-center gap-2 px-1.5 pt-1 text-[12.5px] font-semibold text-ink">
                    <span className="font-mono text-[10px] text-ink-muted">0{index + 1}</span>
                    {stage.label}
                    <span className="ml-auto rounded-full bg-surface px-1.5 font-mono text-[10px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                      {column.length}
                    </span>
                  </h2>
                  {column.length === 0 ? (
                    <p className="m-1 rounded-xl border border-dashed border-[var(--axis)] px-3 py-7 text-center text-[12px] text-ink-muted">No projects here</p>
                  ) : (
                    <Stagger className="flex flex-col gap-2">
                      {column.map((p) => (
                        <StaggerItem key={p.id}>
                          <ProjectCard project={p} next={nextByProject.get(p.id)} />
                        </StaggerItem>
                      ))}
                    </Stagger>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {data && all.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className={cn(data.decisions.length > 0 && 'ring-[1.5px] ring-ai/45')}>
            <CardHeader
              title="Needs your decision"
              icon={data.decisions.length > 0 ? <AiMark size="xs" /> : undefined}
              subtitle={data.decisions.length ? `${data.decisions.length} proposal${data.decisions.length === 1 ? '' : 's'}` : 'Nothing waiting'}
            />
            <CardBody>
              {data.decisions.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No proposals are waiting for a person.</p>
              ) : (
                <Stagger as="ul" className="divide-y divide-hairline">
                  {data.decisions.slice(0, 6).map((d) => (
                    <StaggerItem as="li" key={d.proposalId} className="flex items-center gap-3 py-2">
                      <AiMark size="xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink">{d.title}</p>
                        <p className="truncate text-[12px] text-ink-secondary">{d.projectName}</p>
                      </div>
                      <Link
                        to={d.kind === 'draft' ? `/projects/${d.projectId}/ai` : `/projects/${d.projectId}`}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-brand hover:bg-brand-soft"
                      >
                        Review
                      </Link>
                    </StaggerItem>
                  ))}
                </Stagger>
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
                      <Link to={projectHref(item.projectId)} className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-2 py-1.5 text-[12px]">
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
