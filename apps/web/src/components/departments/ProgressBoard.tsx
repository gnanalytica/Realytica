import { ApprovalsNotRecorded } from './ApprovalsNotRecorded';
import { useMemo, useRef, useState } from 'react';
import { Camera, HardHat, Smartphone, Upload, Users } from 'lucide-react';
import {
  MILESTONE_PHOTO_WAIVERS,
  MILESTONE_PHOTO_WAIVER_LABEL,
  constructionGate,
  daySaid,
  milestonePhotoChecklist,
  milestonePhotoStanding,
  milestonePhotosRefusal,
  milestonePhotosWanting,
  departmentRole,
  fieldTrend,
  indiaToday,
  progressReadings,
  progressSummary,
  roleCanDecide,
  roleCanEdit,
  scheduleWatch,
  type DdProject,
  type Milestone,
  type MilestonePhotoWaiver,
  type MilestoneWatch,
  type ScheduleSkippedRow,
  type SiteLogEntry,
} from '@realytica/shared';
import { personNamed } from '../../lib/format';
import { Sparkline } from '../CheckFields';
import { TrendChart } from '../fields/TrendChart';
import { workspaceApi } from '../../lib/workspace-api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Input, Modal, Textarea, cn, useToast } from '../ui/kit';
import { MARKED_ROW, useMarkedRow } from '../workspace/marked';

function Ring({ percent }: { percent: number | null }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const share = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <svg viewBox="0 0 84 84" className="h-24 w-24 shrink-0" role="img" aria-label={percent === null ? 'No progress recorded' : `${percent}% complete`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="rgb(var(--brand-rgb))" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 42 42)" />
      <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--text-primary)">
        {percent === null ? '—' : `${percent}%`}
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

function MilestoneRow({
  project,
  milestone,
  watch,
  mayEdit,
  mayRemove,
  onChanged,
  marked,
}: {
  project: DdProject;
  milestone: Milestone;
  /** The milestone against its dates today. */
  watch: MilestoneWatch | undefined;
  mayEdit: boolean;
  mayRemove: boolean;
  onChanged: (p: DdProject) => void;
  /** A link named this milestone. */
  marked: boolean;
}) {
  const toast = useToast();
  const [value, setValue] = useState(String(milestone.percent));
  const [busy, setBusy] = useState(false);
  // The day the reading is of: today, unless a person says it was seen on an earlier day and is being typed now.
  const today = indiaToday(new Date());
  const [on, setOn] = useState(today);
  const earlier = on < today;
  const moved = milestone.baselineFinish && milestone.baselineFinish !== milestone.plannedFinish;
  const readings = useMemo(() => progressReadings(project, milestone), [project, milestone]);
  // The photographs it needs before it reads complete: the stations with none this period, and how a completion already made stands.
  const wanting = useMemo(() => (milestone.percent < 100 ? milestonePhotosWanting(project, milestone.id) : []), [project, milestone.id, milestone.percent]);
  const check = useMemo(() => milestonePhotoChecklist(project).find((held) => held.milestoneId === milestone.id), [project, milestone.id]);
  const standing = check?.complete && check.short ? milestonePhotoStanding(check) : undefined;
  const short = check?.complete && check.short && !check.waived ? check.stations.filter((station) => !station.have) : [];
  // Asked to be marked complete with a photograph missing: it is not sent, and the stations are named.
  const [refused, setRefused] = useState(false);
  const stopped = refused && wanting.length > 0 ? wanting : short;

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
    <li data-marked={marked ? '' : undefined} className={cn('flex flex-wrap items-center gap-3 px-1 py-2', marked && MARKED_ROW)}>
      <div className="min-w-[12rem] flex-1">
        <p className="text-[13px] text-ink">{milestone.name}</p>
        <p className="text-micro text-ink-muted">
          Weight {milestone.weight}
          {/* The day it is held to now: its planned finish, moved by the days of extension granted on its contract. */}
          {(watch?.plannedFinish ?? milestone.plannedFinish) ? ` · planned ${daySaid(watch?.plannedFinish ?? milestone.plannedFinish)}` : ''}
          {watch?.extensionDays ? ` (moved ${watch.extensionDays} ${watch.extensionDays === 1 ? 'day' : 'days'} by extensions granted, from ${daySaid(milestone.plannedFinish)})` : ''}
          {moved ? ` (first planned ${daySaid(milestone.baselineFinish)})` : ''}
          {milestone.completedOn ? ` · done ${daySaid(milestone.completedOn)}` : ''}
          {standing ? <span data-milestone-photos className={check?.waived ? undefined : 'font-medium text-critical'}>{` · ${standing}`}</span> : null}
          {!milestone.completedOn && watch?.expectedPercent !== undefined ? ` · expected ${watch.expectedPercent}% today` : ''}
        </p>
      </div>
      {watch?.level ? (
        <Badge tone={watch.level === 'late' ? 'critical' : 'warning'} title={watch.say}>
          {watch.level === 'late' ? 'Late' : watch.level === 'behind' ? 'Behind' : 'Late at the current rate'}
        </Badge>
      ) : null}
      {/* What was reported of it, day by day, as a small line where there are three readings or more. */}
      {readings.length >= 3 ? <Sparkline points={readings.map((reading) => reading.percent)} label={`${milestone.name}: ${readings.length} readings from ${daySaid(readings[0]!.on)} to ${daySaid(readings[readings.length - 1]!.on)}`} /> : null}
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-sunken">
        <div className={cn('h-full rounded-full', milestone.percent >= 100 ? 'bg-good' : 'bg-brand')} style={{ width: `${milestone.percent}%` }} />
      </div>
      {mayEdit ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 100 || (n === milestone.percent && !earlier) || !on || on > today) return;
            if (Math.round(n) === 100 && wanting.length && !earlier) setRefused(true);
            else void save({ percent: n, ...(earlier ? { on } : {}) }).then(() => setOn(today));
          }}
        >
          <Input aria-label={`${milestone.name} percent complete`} type="number" min={0} max={100} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-16 text-right" />
          <span className="text-[12px] text-ink-muted">% on</span>
          <Input aria-label={`The day this reading of ${milestone.name} is of`} title="The day the reading is of. Pick an earlier day for progress seen then and typed now." type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} className="h-8 w-[8.5rem]" />
          <Button size="sm" type="submit" loading={busy} disabled={(Number(value) === milestone.percent && !earlier) || !on || on > today}>
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
      {stopped.length ? (
        <div role="alert" data-milestone-refused className="basis-full rounded-lg border border-hairline bg-sunken px-3 py-2 text-[12px] text-ink">
          <p>{refused && wanting.length ? milestonePhotosRefusal(milestone.name, wanting) : `Complete, with ${stopped.length === 1 ? 'a required photograph' : `${stopped.length} required photographs`} not taken: ${stopped.map((station) => station.label).join(', ')}.`}</p>
          {mayRemove ? (
            <label className="mt-1.5 flex flex-wrap items-center gap-2 text-ink-secondary">
              Complete without {stopped.length === 1 ? 'it' : 'them'}, because
              <select
                aria-label={`Why ${milestone.name} is complete without its photographs`}
                value=""
                disabled={busy}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setRefused(false);
                  void save({ percent: 100, photoWaiver: event.target.value as MilestonePhotoWaiver });
                }}
                className="h-8 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink coarse:h-11"
              >
                <option value="">Pick why…</option>
                {MILESTONE_PHOTO_WAIVERS.map((reason) => (
                  <option key={reason} value={reason}>
                    {MILESTONE_PHOTO_WAIVER_LABEL[reason]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mt-1 text-ink-muted">A lead or signer of Construction can pick why it is complete without {stopped.length === 1 ? 'it' : 'them'}.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Bring the schedule in from where it is kept: a file, or the table pasted. What could not be read is listed back. */
function ScheduleImport({ project, onChanged, onClose }: { project: DdProject; onChanged: (p: DdProject) => void; onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<ScheduleSkippedRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  async function run(input: { file: File } | { text: string }) {
    setBusy(true);
    try {
      const res = await workspaceApi.importSchedule(project.id, input);
      onChanged(res.project);
      toast(`${res.added} added, ${res.updated} updated${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`, res.skipped.length ? 'warning' : 'good');
      setSkipped(res.skipped);
      setNotes(res.notes);
      if (!res.skipped.length && !res.notes.length) onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not import', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import schedule"
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run({ file });
              e.target.value = '';
            }}
          />
          <Button size="sm" icon={<Upload size={14} />} loading={busy} onClick={() => fileRef.current?.click()}>
            Upload file
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void run({ text })}>
            Import pasted table
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-[13px] text-ink-secondary">CSV, Excel or a pasted table. Progress already recorded is never lowered.</p>
        <Textarea
          aria-label="Schedule table"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={'Activity,Planned start,Planned finish,Weight\nPlinth,01-11-2026,30-11-2026,5'}
          className="font-mono text-[12px]"
        />
        {notes.length ? (
          <Callout tone="info" title="How the dates were read">
            <ul className="space-y-0.5">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
        {skipped.length ? (
          <Callout tone="warning" title={`${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped`}>
            <ul className="space-y-0.5">
              {skipped.map((row) => (
                <li key={row.line}>
                  Row {row.line}
                  {row.name ? `, ${row.name}` : ''}: {row.reason}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Construction › Progress: how far along the work is, against the milestones
 * the project reports to, from what the site logs every day — most of it from
 * the site app, offline-first on the phone.
 */
export function ProgressBoard({
  project,
  onChanged,
  onPairPhone,
  marked,
}: {
  project: DdProject;
  onChanged: (p: DdProject) => void;
  onPairPhone: () => void;
  /** A milestone or a site log entry a link named, by its id: it is lit and brought into view. */
  marked?: string | null;
}) {
  const board = useMarkedRow<HTMLDivElement>(marked);
  const me = useMe();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const summary = useMemo(() => progressSummary(project), [project]);
  const schedule = useMemo(() => scheduleWatch(project, new Date()), [project]);
  // Planned against actual, month by month: the readings the milestones keep, drawn against what their dates planned.
  const curve = useMemo(() => fieldTrend(project, { set: 'construction.progress.programme', field: 'actual_percent' }), [project]);
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
      toast('Nine milestones added.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add them', 'critical');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div ref={board} className="space-y-4">
      {gate.unrecorded ? (
        // Nothing recorded of the approvals: one quiet line with the two ways on, never a warning against an empty register.
        <ApprovalsNotRecorded project={project} onChanged={onChanged} />
      ) : !gate.open ? (
        <Callout tone={log.length ? 'critical' : 'warning'} title={log.length ? 'Work is being logged before it is allowed' : 'Not cleared to build yet'}>
          Not on file: {gate.missing.join(', ')}. See Legal › Approvals.
        </Callout>
      ) : null}
      <Card>
        <CardHeader icon={<HardHat size={15} />} title="Progress" subtitle={summary.lastEntry ? `Last logged ${daySaid(summary.lastEntry.date)} by ${personNamed(project, summary.lastEntry.author)}` : 'Nothing logged from site yet'} />
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
        {curve ? (
          <CardBody className="border-t border-hairline">
            <div data-progress-curve>
              <p className="text-[12px] font-medium text-ink">Planned against actual, by month</p>
              <div className="mt-1 max-w-xl">
                <TrendChart trend={curve} width={520} height={120} />
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">{curve.said}</p>
            </div>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Milestones"
          subtitle="Weighted share of milestones complete"
          action={
            mayEdit ? (
              <Button size="sm" icon={<Upload size={14} />} onClick={() => setImporting(true)}>
                Import schedule
              </Button>
            ) : null
          }
        />
        <CardBody>
          {schedule.plannedCompletion ? (
            <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-secondary">
              <span>
                Planned completion <span className="font-mono text-ink">{daySaid(schedule.plannedCompletion)}</span>
                {schedule.extensionDays ? ` · moved ${schedule.extensionDays} ${schedule.extensionDays === 1 ? 'day' : 'days'} by extensions of time granted, from ${daySaid(schedule.completionBeforeExtensions)}` : ''}
                {schedule.projectedCompletion ? (
                  <>
                    {' · at the current rate '}
                    <span className="font-mono text-ink">{daySaid(schedule.projectedCompletion)}</span>
                  </>
                ) : null}
              </span>
              {schedule.extensionLikely ? <Badge tone="warning">Extension of time likely</Badge> : null}
            </p>
          ) : null}
          {milestones.length ? (
            <ul className="divide-y divide-hairline">
              {milestones.map((m) => (
                <MilestoneRow
                  key={m.id}
                  project={project}
                  milestone={m}
                  watch={schedule.milestones.find((w) => w.id === m.id)}
                  mayEdit={mayEdit}
                  mayRemove={mayRemove}
                  onChanged={onChanged}
                  marked={m.id === marked}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">No milestones yet. Import the schedule, or start from the usual nine.</p>
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
        <CardHeader icon={<Camera size={15} />} title="Site log" subtitle={log.length ? `${log.length} entr${log.length === 1 ? 'y' : 'ies'}` : 'From the site app, with photographs'} />
        <CardBody>
          {log.length ? (
            <ol className="space-y-4">
              {log.slice(0, 30).map((entry) => (
                <li key={entry.id} data-marked={entry.id === marked ? '' : undefined} className={cn('rounded-lg p-3', entry.id === marked ? MARKED_ROW : 'bg-sunken/50')}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-mono text-[12px] font-semibold text-ink">{daySaid(entry.date)}</p>
                    <p className="text-[12px] text-ink-secondary">{personNamed(project, entry.author)}</p>
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
            <p className="text-[13px] text-ink-secondary">Pair a phone to log the day from site.</p>
          )}
        </CardBody>
      </Card>
      {importing ? <ScheduleImport project={project} onChanged={onChanged} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
