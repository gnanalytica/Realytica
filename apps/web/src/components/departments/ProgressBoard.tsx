import { useMemo, useState } from 'react';
import { Camera, HardHat, Smartphone, Users } from 'lucide-react';
import {
  constructionGate,
  departmentRole,
  progressSummary,
  roleCanDecide,
  roleCanEdit,
  type DdProject,
  type Milestone,
  type SiteLogEntry,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Input, cn, useToast } from '../ui/kit';

function Ring({ percent }: { percent: number | null }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const share = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <svg viewBox="0 0 84 84" className="h-24 w-24 shrink-0" role="img" aria-label={percent === null ? 'No progress recorded' : `${percent}% complete`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="rgb(var(--brand-rgb))" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 42 42)" />
      <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--text-primary)">
        {percent === null ? '—' : `${Math.round(percent)}%`}
      </text>
    </svg>
  );
}

function Photo({ projectId, entry, index }: { projectId: string; entry: SiteLogEntry; index: number }) {
  const { url, failed } = useAuthedUrl(workspaceApi.sitePhotoUrl(projectId, entry.id, index));
  const photo = entry.photos[index]!;
  if (failed) return null;
  return (
    <figure className="w-28 shrink-0">
      {url ? <img src={url} alt={photo.caption ?? photo.fileName} className="h-20 w-28 rounded-md object-cover ring-1 ring-[var(--ring)]" /> : <div className="h-20 w-28 animate-pulse rounded-md bg-sunken" />}
      {photo.caption ? <figcaption className="mt-0.5 truncate text-micro text-ink-secondary">{photo.caption}</figcaption> : null}
    </figure>
  );
}

function MilestoneRow({ project, milestone, mayEdit, mayRemove, onChanged }: { project: DdProject; milestone: Milestone; mayEdit: boolean; mayRemove: boolean; onChanged: (p: DdProject) => void }) {
  const toast = useToast();
  const [value, setValue] = useState(String(milestone.percent));
  const [busy, setBusy] = useState(false);
  const late = milestone.plannedFinish && milestone.plannedFinish < new Date().toISOString().slice(0, 10) && milestone.percent < 100;

  async function save(patch: Parameters<typeof workspaceApi.updateMilestone>[2]) {
    setBusy(true);
    try {
      onChanged((await workspaceApi.updateMilestone(project.id, milestone.id, patch)).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change it', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-[12rem] flex-1">
        <p className="text-[13px] text-ink">{milestone.name}</p>
        <p className="text-micro text-ink-muted">
          Weight {milestone.weight}
          {milestone.plannedFinish ? ` · planned ${milestone.plannedFinish}` : ''}
          {milestone.completedOn ? ` · done ${milestone.completedOn}` : ''}
          {late ? <span className="text-critical"> · late</span> : null}
        </p>
      </div>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-sunken">
        <div className={cn('h-full rounded-full', milestone.percent >= 100 ? 'bg-good' : 'bg-brand')} style={{ width: `${milestone.percent}%` }} />
      </div>
      {mayEdit ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value);
            if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== milestone.percent) void save({ percent: n });
          }}
        >
          <Input aria-label={`${milestone.name} percent complete`} type="number" min={0} max={100} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-16 text-right" />
          <span className="text-[12px] text-ink-muted">%</span>
          <Button size="sm" type="submit" loading={busy} disabled={Number(value) === milestone.percent}>
            Save
          </Button>
        </form>
      ) : (
        <span className="w-12 text-right font-mono text-[13px] tabular-nums">{milestone.percent}%</span>
      )}
      {mayRemove ? (
        <button
          type="button"
          onClick={() => void workspaceApi.removeMilestone(project.id, milestone.id).then((r) => onChanged(r.project), (e: unknown) => toast(e instanceof Error ? e.message : 'Could not remove it', 'critical'))}
          className="text-[12px] text-ink-muted hover:text-critical"
        >
          Remove
        </button>
      ) : null}
    </li>
  );
}

/**
 * Construction › Progress: how far along the work is, against the milestones
 * the project reports to, from what the site logs every day — most of it from
 * the site app, offline-first on the phone.
 */
export function ProgressBoard({ project, onChanged, onPairPhone }: { project: DdProject; onChanged: (p: DdProject) => void; onPairPhone: () => void }) {
  const me = useMe();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const summary = useMemo(() => progressSummary(project), [project]);
  const gate = useMemo(() => constructionGate(project), [project]);
  const role = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, 'construction') : undefined;
  const mayEdit = roleCanEdit(role);
  const mayRemove = roleCanDecide(role);
  const milestones = project.milestones ?? [];
  const log = useMemo(() => [...(project.siteLog ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [project.siteLog]);

  async function addUsualMilestones() {
    setAdding(true);
    try {
      onChanged((await workspaceApi.addMilestones(project.id, { template: true })).project);
      toast('Nine usual milestones added. Weights and dates are yours to change.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add them', 'critical');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      {!gate.open ? (
        <Callout tone={log.length ? 'critical' : 'warning'} title={log.length ? 'Work is being logged before it is allowed' : 'Not cleared to build yet'}>
          Not on file: {gate.missing.join(', ')}. See Legal › Approvals.
        </Callout>
      ) : null}
      <Card>
        <CardHeader icon={<HardHat size={15} />} title="Progress" subtitle={summary.lastEntry ? `Last logged ${summary.lastEntry.date} by ${summary.lastEntry.author}` : 'Nothing logged from site yet'} />
        <CardBody className="flex flex-wrap items-center gap-6">
          <Ring percent={summary.percent} />
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            <div>
              <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">Milestones</dt>
              <dd className="font-semibold text-ink tabular-nums">
                {summary.complete} of {summary.milestones} done
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">Late</dt>
              <dd className={cn('font-semibold tabular-nums', summary.late.length ? 'text-critical' : 'text-ink')}>{summary.late.length}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">On site, last day</dt>
              <dd className="font-semibold text-ink tabular-nums">{summary.lastEntry ? summary.lastEntry.manpower : '—'}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">Issues raised</dt>
              <dd className="font-semibold text-ink tabular-nums">{summary.openIssues}</dd>
            </div>
          </dl>
          <Button size="sm" icon={<Smartphone size={14} />} onClick={onPairPhone}>
            Pair a phone for the site log
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Milestones" subtitle="Progress is the weighted share of milestones complete" />
        <CardBody>
          {milestones.length ? (
            <ul className="divide-y divide-hairline">
              {milestones.map((m) => (
                <MilestoneRow key={m.id} project={project} milestone={m} mayEdit={mayEdit} mayRemove={mayRemove} onChanged={onChanged} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">No milestones yet. Start from the usual nine — excavation to OC, weighted the way stage payments usually are — and make them this project's.</p>
              {mayEdit ? (
                <Button size="sm" loading={adding} onClick={() => void addUsualMilestones()}>
                  Use the usual milestones
                </Button>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<Camera size={15} />} title="Site log" subtitle={log.length ? `${log.length} entr${log.length === 1 ? 'y' : 'ies'}` : 'Entries arrive from the site app, with photographs and where they were taken'} />
        <CardBody>
          {log.length ? (
            <ol className="space-y-4">
              {log.slice(0, 30).map((entry) => (
                <li key={entry.id} className="rounded-lg bg-sunken/50 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-mono text-[12px] font-semibold text-ink">{entry.date}</p>
                    <p className="text-[12px] text-ink-secondary">{entry.author}</p>
                    {entry.weather ? <Badge tone="neutral">{entry.weather}</Badge> : null}
                    {entry.manpower.length ? (
                      <span className="flex items-center gap-1 text-[12px] text-ink-secondary">
                        <Users size={12} /> {entry.manpower.reduce((n, m) => n + m.count, 0)} on site ({entry.manpower.map((m) => `${m.count} ${m.trade}`).join(', ')})
                      </span>
                    ) : null}
                  </div>
                  {entry.workDone ? <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{entry.workDone}</p> : null}
                  {entry.milestoneUpdates.length ? (
                    <p className="mt-1 text-[12px] text-ink-secondary">
                      Moved: {entry.milestoneUpdates.map((u) => `${milestones.find((m) => m.id === u.milestoneId)?.name ?? 'a milestone'} to ${u.percent}%`).join('; ')}
                    </p>
                  ) : null}
                  {entry.issues.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {entry.issues.map((i, n) => (
                        <li key={n} className="text-[12px]">
                          <Badge tone={i.severity === 'high' ? 'critical' : i.severity === 'medium' ? 'warning' : 'neutral'}>{i.severity}</Badge> <span className="text-ink">{i.title}</span>
                          {i.note ? <span className="text-ink-secondary"> — {i.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.photos.length ? (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {entry.photos.map((_, i) => (
                        <Photo key={i} projectId={project.id} entry={entry} index={i} />
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-ink-secondary">Pair a phone and log the day from site: manpower, work done, progress against milestones, weather, photographs and issues. It works with no signal and sends when it can.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
