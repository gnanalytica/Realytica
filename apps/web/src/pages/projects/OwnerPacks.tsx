import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, FileText } from 'lucide-react';
import {
  QUARTER_YEAR_DEFAULT,
  TIMED_REPORTS,
  TIMED_REPORT_LABEL,
  indiaToday,
  ownerPackStanding,
  ownerPacksKept,
  quarterYearOf,
  quartersBefore,
  reportDaySaid,
  reportPeriodSaid,
  type DdProject,
  type QuarterYear,
  type ReportEvery,
  type TimedReport,
} from '@realytica/shared';
import { api, type ReportDayShown } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Modal, Select, useToast } from '../../components/ui/kit';

/**
 * The owner packs of a project: one opened for a month or a quarter, the
 * ones kept (waiting to be issued, or issued and frozen), and the day of the
 * month reports are prepared on without being asked.
 *
 * A pack opens as a printable page in its own tab; keeping, issuing and
 * reopening one are done there, on the paper a person has just read.
 */
export function OwnerPacks({ project, setProject, marked }: { project: DdProject; setProject: (next: DdProject) => void; marked?: string | null }) {
  const toast = useToast();
  const [shown, setShown] = useState<ReportDayShown | null>(null);
  const [span, setSpan] = useState<ReportEvery>('month');
  const [month, setMonth] = useState(() => indiaToday(new Date()).slice(0, 7));
  const year = quarterYearOf(project);
  const quarters = useMemo(() => quartersBefore(new Date(), year), [year]);
  // The last quarter that has ended, until another is picked.
  const [picked, setQuarter] = useState('');
  const quarter = picked || quarters[1]?.key || quarters[0]!.key;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    api.reportDay(project.id).then(
      (next) => live && setShown(next),
      () => live && setShown(null),
    );
    return () => {
      live = false;
    };
  }, [project.id, project.updatedAt]);

  const kept = ownerPacksKept(project);
  const waiting = kept.filter((pack) => pack.status === 'prepared').length;
  const setting = project.reportDay?.setting;
  const asked = span === 'month' ? (month ? `month=${month}` : '') : `quarter=${quarter}`;
  const open = (query: string) => window.open(`/projects/${project.id}/owner-pack/print?${query}`, '_blank', 'noopener');

  return (
    <Card>
      <CardHeader
        icon={<FileText />}
        title="Owner packs"
        subtitle={kept.length ? `${kept.length} kept${waiting ? ` · ${waiting} waiting to be issued` : ''}` : 'One paper for the owner, for a month or a quarter'}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-[6.5rem] shrink-0">
              <Select aria-label="Period of the owner pack" value={span} onChange={(e) => setSpan(e.target.value as ReportEvery)}>
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
              </Select>
            </div>
            <div className={span === 'month' ? 'w-[9.5rem] shrink-0' : 'w-[13rem] min-w-0 shrink'}>
              {span === 'month' ? (
                <Input type="month" aria-label="Month of the owner pack" value={month} onChange={(e) => setMonth(e.target.value)} />
              ) : (
                <Select aria-label="Quarter of the owner pack" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                  {quarters.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <Button variant="secondary" className="shrink-0 whitespace-nowrap" disabled={!asked} onClick={() => open(asked)}>
              Owner pack
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        {kept.length ? (
          <ul className="divide-y divide-hairline">
            {kept.map((pack) => (
              <li key={pack.id}>
                <button
                  type="button"
                  onClick={() => open(`pack=${pack.id}`)}
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left text-[13px] ${marked === pack.id ? 'bg-brand-soft' : 'hover:bg-sunken'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{reportPeriodSaid(pack.pack.period, year)}</span>
                    <span className="block text-[11px] text-ink-muted">{ownerPackStanding(project, pack)}</span>
                  </span>
                  <Badge tone={pack.status === 'issued' ? 'good' : 'warning'}>{pack.status === 'issued' ? 'Issued' : 'Waiting'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-muted">No pack kept yet.</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-hairline pt-3">
          <CalendarClock size={15} className="shrink-0 text-ink-muted" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">
            {setting ? reportDaySaid(setting) : 'No report day set.'}
            {setting && shown && !shown.email ? <span className="block text-[11px] text-ink-muted">Email is not set up here, so nobody is mailed. Prepared reports wait on this page.</span> : null}
          </p>
          {shown?.mayIssue ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {setting ? 'Change' : 'Set a day'}
            </Button>
          ) : null}
        </div>
      </CardBody>
      {editing && shown ? (
        <ReportDayForm
          project={project}
          shown={shown}
          onClose={() => setEditing(false)}
          onSaved={(next, said) => {
            setProject(next);
            setEditing(false);
            toast(said, 'good');
          }}
        />
      ) : null}
    </Card>
  );
}

function ReportDayForm({ project, shown, onClose, onSaved }: { project: DdProject; shown: ReportDayShown; onClose: () => void; onSaved: (next: DdProject, said: string) => void }) {
  const toast = useToast();
  const held = shown.setting;
  const [day, setDay] = useState(String(held?.day ?? 1));
  const [reports, setReports] = useState<TimedReport[]>(held?.reports ?? [...TIMED_REPORTS]);
  const [every, setEvery] = useState<ReportEvery>(held?.every ?? 'month');
  const [quarters, setQuarters] = useState<QuarterYear>(held?.quarters ?? QUARTER_YEAR_DEFAULT);
  const [tell, setTell] = useState<string[]>(held?.tell ?? []);
  const [busy, setBusy] = useState(false);
  const dayNumber = Number(day);
  const valid = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 31 && reports.length > 0;

  async function send(body: Parameters<typeof api.setReportDay>[1], said: string) {
    setBusy(true);
    try {
      onSaved((await api.setReportDay(project.id, body)).project, said);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the report day', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Report day"
      footer={
        <>
          {held ? (
            <Button variant="ghost" disabled={busy} onClick={() => void send({ clear: true }, 'Report day cleared')}>
              Clear
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !valid} onClick={() => void send({ day: dayNumber, reports, every, quarters, tell }, 'Report day set')}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink-secondary">Prepared on the day and left waiting. A person issues it; nothing is sent to the owner.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Day of the month" hint="India time. In a shorter month, its last day.">
            <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="How often" hint={every === 'quarter' ? 'In January, April, July and October.' : 'For the month before.'}>
            <Select value={every} onChange={(e) => setEvery(e.target.value as ReportEvery)}>
              <option value="month">Every month</option>
              <option value="quarter">Every quarter</option>
            </Select>
          </Field>
        </div>
        <Field label="Quarters are numbered in">
          <Select value={quarters} onChange={(e) => setQuarters(e.target.value as QuarterYear)}>
            <option value="financial">The financial year, April to March</option>
            <option value="calendar">The calendar year</option>
          </Select>
        </Field>
        <Field label="Reports">
          <div className="flex flex-wrap gap-x-5">
            {TIMED_REPORTS.map((kind) => (
              <Checkbox key={kind} label={TIMED_REPORT_LABEL[kind]} checked={reports.includes(kind)} onChange={(on) => setReports(TIMED_REPORTS.filter((k) => (k === kind ? on : reports.includes(k))))} />
            ))}
          </div>
        </Field>
        <Field label={`Who is told · ${tell.length}`} hint={shown.email ? 'By email, when a report is ready to check.' : 'Email is not set up here, so nobody is mailed.'}>
          <div className="flex flex-col">
            {shown.people.map((person) => (
              <Checkbox
                key={person.email}
                label={person.name ? `${person.name} · ${person.email}` : person.email}
                checked={tell.includes(person.email)}
                onChange={(on) => setTell(on ? [...tell, person.email] : tell.filter((email) => email !== person.email))}
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
