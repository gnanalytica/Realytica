import { Link } from 'react-router-dom';
import { Bell, CalendarClock, FileQuestion, Gavel, Wallet } from 'lucide-react';
import { cockpitPath, meetingDay, moneySaid, readsAnalytics, type AcrossProjects as AcrossProjectsView, type AnalyticsFigure, type AnalyticsRow } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useMe } from '../../lib/useMe';
import { Badge, Card, CardBody, CardHeader, ProgressBar, cn } from '../ui/kit';
import { FigureButton } from './FigureList';

/**
 * The firm's projects side by side: money, time, papers, alerts, and what
 * waits on the owner. Each number opens the rows it counts.
 *
 * For the firm's own people. Somebody working from a grant is not asked for
 * it and is shown nothing; the server refuses them in any case.
 */

const PARTIES_SHOWN = 8;
const DECISIONS_SHOWN = 5;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function gather(figures: readonly AnalyticsFigure[]): AnalyticsFigure {
  const rows = figures.flatMap((f) => f.rows);
  const more = figures.reduce((n, f) => n + (f.more ?? 0), 0);
  return { count: figures.reduce((n, f) => n + f.count, 0), rows, ...(more ? { more } : {}) };
}

function RowLink({ row }: { row: AnalyticsRow }) {
  return (
    <li>
      <Link to={cockpitPath(row.projectId, row.pane, row.extra)} className="block py-1.5">
        <p className="truncate text-[13px] text-ink">{row.title}</p>
        <p className="truncate text-[12px] text-ink-secondary">{row.projectName}</p>
      </Link>
    </li>
  );
}

function CostCard({ cost }: { cost: AcrossProjectsView['cost'] }) {
  const overBudget = gather(cost.lines.map((line) => line.overBudget));
  return (
    <Card>
      <CardHeader title="Forecast against budget" icon={<Wallet />} subtitle={cost.lines.length ? `From ${plural(cost.lines.length, 'issued Cost Report', 'issued Cost Reports')}` : 'No Cost Report issued'} />
      <CardBody className="space-y-3">
        {cost.totals.map((total) => {
          const money = (n: number) => moneySaid(n, total.currency);
          return (
            <p key={total.currency} className="text-[13px] text-ink">
              <span className="font-mono font-semibold tabular-nums">{money(total.forecast)}</span>
              <span className="text-ink-secondary"> against {money(total.budget)}</span>
              <span className={cn('font-medium', total.over > 0 ? 'text-critical' : 'text-ink-secondary')}> · {total.over > 0 ? `${money(total.over)} over` : total.over < 0 ? `${money(-total.over)} under` : 'on budget'}</span>
              {total.compared ? <span className="text-ink-secondary"> · {total.movement > 0 ? '+' : ''}{money(total.movement)} since the reports before</span> : null}
            </p>
          );
        })}
        {cost.lines.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No project has a Cost Report issued.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {cost.lines.map((line) => {
              const money = (n: number) => moneySaid(n, line.currency);
              return (
                <li key={line.projectId} className="py-2">
                  <Link to={cockpitPath(line.projectId, 'workstream', { workstream: 'finance.budget' })} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate font-medium text-ink">{line.projectName}</span>
                    <span className={cn('shrink-0 font-mono text-[12px] tabular-nums', line.over > 0 ? 'text-critical' : 'text-ink-secondary')}>
                      {line.over > 0 ? `${money(line.over)} over` : line.over < 0 ? `${money(-line.over)} under` : 'On budget'}
                    </span>
                  </Link>
                  <ProgressBar className="mt-1.5" value={line.budget > 0 ? (line.forecast / line.budget) * 100 : 0} tone={line.over > 0 ? 'critical' : 'good'} showValue={false} />
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {line.reportLabel}: {money(line.forecast)} against {money(line.budget)}
                    {line.movement !== undefined ? ` · ${line.movement > 0 ? '+' : ''}${money(line.movement)} since ${line.previousLabel}` : ' · first report'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {overBudget.count || cost.notIssued.count ? (
          <div className="flex flex-wrap gap-1.5">
            {overBudget.count ? <FigureButton label={overBudget.count === 1 ? 'package over budget' : 'packages over budget'} figure={overBudget} tone="critical" /> : null}
            {cost.notIssued.count ? <FigureButton label={cost.notIssued.count === 1 ? 'project with no report issued' : 'projects with no report issued'} figure={cost.notIssued} /> : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ScheduleCard({ schedule }: { schedule: AcrossProjectsView['schedule'] }) {
  const n = schedule.extensions.count;
  return (
    <Card>
      <CardHeader
        title="Schedule"
        icon={<CalendarClock />}
        subtitle={schedule.lines.length ? plural(schedule.lines.length, 'project with milestones', 'projects with milestones') : 'No milestones'}
        action={n ? <FigureButton label={n === 1 ? 'extension of time likely' : 'extensions of time likely'} figure={schedule.extensions} tone="warning" /> : undefined}
      />
      <CardBody>
        {schedule.lines.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No project has milestones on its schedule.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {schedule.lines.map((line) => (
              <li key={line.projectId} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Link to={cockpitPath(line.projectId, 'workstream', { workstream: 'construction.progress' })} className="min-w-0 truncate text-[13px] font-medium text-ink">
                    {line.projectName}
                  </Link>
                  {line.extensionLikely ? <Badge tone="warning">Extension likely</Badge> : null}
                </div>
                <p className="mt-0.5 text-[12px] text-ink-secondary">
                  {line.plannedCompletion ? `Planned ${meetingDay(line.plannedCompletion)}` : 'No planned finish'}
                  {line.projectedCompletion ? ` · projected ${meetingDay(line.projectedCompletion)}` : line.plannedCompletion ? ' · no projection yet' : ''}
                  {line.projectedDaysLate ? ` · ${plural(line.projectedDaysLate, 'day', 'days')} late` : ''}
                </p>
                {line.warned.count ? (
                  <FigureButton className="mt-1.5" label={line.warned.count === 1 ? 'milestone late, behind or slipping' : 'milestones late, behind or slipping'} figure={line.warned} tone="warning" showProject={false} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function PapersCard({ papers }: { papers: AcrossProjectsView['papers'] }) {
  const named = papers.parties.filter((party) => party.party).length;
  const shown = papers.parties.slice(0, PARTIES_SHOWN);
  const rest = papers.parties.slice(PARTIES_SHOWN);
  return (
    <Card>
      <CardHeader title="Papers owed" icon={<FileQuestion />} subtitle={papers.owed ? `${papers.owed} owed · ${plural(named, 'party named', 'parties named')}` : 'Nothing owed'} />
      <CardBody>
        {papers.owed === 0 ? (
          <p className="text-[13px] text-ink-muted">No paper is owed on any project.</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((party) => (
              <li key={party.party ?? ''}>
                <FigureButton className="w-full" label={party.party ?? 'Nobody named'} title={`Owed by ${party.party ?? 'nobody named'}`} figure={party.papers}>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-ink-muted">
                    {party.overdue ? <Badge tone="critical">{party.overdue} overdue</Badge> : null}
                    {plural(party.projects, 'project', 'projects')}
                  </span>
                </FigureButton>
              </li>
            ))}
            {rest.length ? (
              <li>
                <FigureButton className="w-full" label={`owed by ${plural(rest.length, 'other party', 'other parties')}`} figure={gather(rest.map((party) => party.papers))} />
              </li>
            ) : null}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function AlertsCard({ alerts }: { alerts: AcrossProjectsView['alerts'] }) {
  return (
    <Card>
      <CardHeader title="Open alerts" icon={<Bell />} subtitle={alerts.open ? `${alerts.open} open` : 'None open'} />
      <CardBody>
        {alerts.open === 0 ? (
          <p className="text-[13px] text-ink-muted">No alert is open on any project.</p>
        ) : (
          <ul className="space-y-1.5">
            {alerts.kinds.map((kind) => (
              <li key={kind.kind}>
                <FigureButton className="w-full" label={kind.label} figure={kind.alerts} tone={kind.critical ? 'critical' : undefined}>
                  {kind.critical ? <Badge tone="critical" className="ml-auto">{kind.critical} critical</Badge> : null}
                </FigureButton>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function DecisionsCard({ decisions }: { decisions: AnalyticsFigure }) {
  return (
    <Card>
      <CardHeader
        title="Waiting on the owner"
        icon={<Gavel />}
        subtitle={decisions.count ? plural(decisions.count, 'decision', 'decisions') : 'Nothing waiting'}
        action={decisions.count > DECISIONS_SHOWN ? <FigureButton label="in all" figure={decisions} /> : undefined}
      />
      <CardBody>
        {decisions.count === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing waits on the owner.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {decisions.rows.slice(0, DECISIONS_SHOWN).map((row, i) => (
              <RowLink key={`${row.projectId}:${row.title}:${i}`} row={row} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function AcrossProjects() {
  const me = useMe();
  const firm = Boolean(me && readsAnalytics(me.role));
  const { data } = useAsync<AcrossProjectsView | null>(() => (firm ? api.analyticsPortfolio() : Promise.resolve(null)), [firm]);
  if (!data || data.projects === 0) return null;
  return (
    <section aria-label="Across projects" className="space-y-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">Across projects</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CostCard cost={data.cost} />
        <ScheduleCard schedule={data.schedule} />
        <DecisionsCard decisions={data.decisions} />
        <PapersCard papers={data.papers} />
        <AlertsCard alerts={data.alerts} />
      </div>
    </section>
  );
}
