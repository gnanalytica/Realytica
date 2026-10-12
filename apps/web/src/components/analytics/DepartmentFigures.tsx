import { useMemo } from 'react';
import { departmentAnalytics, readsAnalytics, type DdProject } from '@realytica/shared';
import { useMe } from '../../lib/useMe';
import { Card, CardBody, CardHeader } from '../ui/kit';
import { FigureButton } from './FigureList';

/**
 * One project by department: what waits for acceptance and for how long, the
 * actions open and overdue, the requests out and their age.
 *
 * Read from the project already on the page, so it moves with every change
 * made there. For the firm's own people: somebody working from a grant holds
 * a copy with parts taken out, and counts of it would be counts of something
 * else.
 */
export function DepartmentFigures({ project }: { project: DdProject }) {
  const me = useMe();
  const view = useMemo(() => departmentAnalytics(project, new Date()), [project]);
  if (!me || !readsAnalytics(me.role)) return null;
  const busy = view.departments.filter((d) => d.waiting.count || d.actionsOpen.count || d.requestsOut.count);
  const waiting = busy.reduce((n, d) => n + d.waiting.count, 0);
  const overdue = busy.reduce((n, d) => n + d.actionsOverdue.count, 0);
  return (
    <Card>
      <CardHeader title="By department" subtitle={busy.length ? `${waiting} to accept · ${overdue} overdue` : 'Nothing waiting'} />
      <CardBody>
        {busy.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing waits in any department.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {busy.map((d) => (
              // The name sits over its figures until the card has room to put it beside them.
              <li key={d.department ?? 'none'} className="space-y-1.5 py-2 [@container(min-width:40rem)]:flex [@container(min-width:40rem)]:items-center [@container(min-width:40rem)]:gap-3 [@container(min-width:40rem)]:space-y-0">
                <p className="shrink-0 text-[13px] font-medium text-ink [@container(min-width:40rem)]:w-28">{d.label}</p>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  <FigureButton label="to accept" title={`${d.label}: waiting for acceptance`} figure={d.waiting} showProject={false}>
                    {d.waiting.count ? <span className="text-ink-muted">· oldest {d.waitingOldestDays}d</span> : null}
                  </FigureButton>
                  <FigureButton label={d.actionsOpen.count === 1 ? 'action open' : 'actions open'} title={`${d.label}: actions open`} figure={d.actionsOpen} showProject={false} />
                  {d.actionsOverdue.count ? <FigureButton label="overdue" title={`${d.label}: actions overdue`} figure={d.actionsOverdue} tone="critical" showProject={false} /> : null}
                  <FigureButton label={d.requestsOut.count === 1 ? 'request out' : 'requests out'} title={`${d.label}: requests out`} figure={d.requestsOut} tone={d.requestsOverdue ? 'critical' : undefined} showProject={false}>
                    {d.requestsOut.count ? <span className="text-ink-muted">· oldest {d.requestsOldestDays}d</span> : null}
                  </FigureButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
