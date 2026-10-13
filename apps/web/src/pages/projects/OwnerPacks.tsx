import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, FileText } from 'lucide-react';
import {
  PACK_MONTH,
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
  // A link from the chat may name the month to open (`month:2026-09`): it is picked here, ready to open.
  const linked = marked?.startsWith(PACK_MONTH) ? marked.slice(PACK_MONTH.length) : '';
  const [month, setMonth] = useState(() => linked || indiaToday(new Date()).slice(0, 7));
  const navigate = useNavigate();
  useEffect(() => {
    if (!linked) return;
    setSpan('month');
    setMonth(linked);
    // Asked for by its month, the pack itself is what opens: the paper, in this tab, in place of this page with a month picked. Back returns to where the person was.
    navigate(`/projects/${project.id}/owner-pack/print?month=${linked}`, { replace: true });
  }, [linked, navigate, project.id]);
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
  const setting = project.reportDay?.setting;
  const asked = span === 'month' ? (month ? `month=${month}` : '') : `quarter=${quarter}`;
  const open = (query: string) => window.open(`/projects/${project.id}/owner-pack/print?${query}`, '_blank', 'noopener');

  const prepared = kept.filter((pack) => pack.status === 'prepared');
  const issued = kept.filter((pack) => pack.status === 'issued');
  const picker = (
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
      {/* The one thing done here each month when nothing waits: open the pack, read it, and issue it from the paper. */}
      <Button variant={prepared.length ? 'secondary' : 'primary'} className="shrink-0 whitespace-nowrap" disabled={!asked} onClick={() => open(asked)}>
        Open the pack
      </Button>
    </div>
  );
  return (
    <Card>
      <CardHeader
        icon={<FileText />}
        title="Owner pack"
        subtitle={prepared.length ? `${prepared.length} waiting to be issued${issued.length ? ` · ${issued.length} issued` : ''}` : issued.length ? `${issued.length} issued` : 'One paper for the owner, for a month or a quarter'}
      />
      <CardBody className="space-y-3">
        {/* A pack that waits is the page's one action: it is read on its own paper and issued there, under a name. */}
        {prepared.map((pack) => (
          <div key={pack.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-3 ring-1 ring-inset ${marked === pack.id ? 'bg-brand-soft ring-brand/30' : 'bg-sunken/60 ring-[var(--ring)]'}`}>
            <span className="min-w-0 flex-1 basis-48">
              <span className="block text-[14px] font-semibold text-ink">{reportPeriodSaid(pack.pack.period, year)}</span>
              <span className="block text-[12px] text-ink-secondary">{ownerPackStanding(project, pack)}</span>
            </span>
            <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={() => open(`pack=${pack.id}`)}>
              Check and issue
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 basis-40 text-[13px] text-ink-secondary">{prepared.length ? 'Another month or quarter' : kept.length ? 'The pack for a month or a quarter' : 'No pack kept yet. Open one, read it, and issue it from the paper.'}</p>
          {picker}
        </div>
        {issued.length ? (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {issued.map((pack) => (
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
                  <Badge tone="good">Issued</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-hairline pt-3">
          <CalendarClock size={15} className="shrink-0 text-ink-muted" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">
            {setting ? `Report day: ${reportDaySaid(setting).replace(/^The /, 'the ')}` : 'No report day set. Set one to have the pack prepared each month.'}
            {setting && shown && !shown.email ? <span className="block text-[11px] text-ink-muted">Nobody is emailed when a report is prepared: email is not set up. It waits here.</span> : null}
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
