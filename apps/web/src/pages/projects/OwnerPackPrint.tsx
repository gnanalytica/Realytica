/**
 * The owner pack as a printable document (Save as PDF).
 *
 * Outside the app shell, as the other printed reports are, so what prints is
 * the pack and not the navigation around it. Every line is read from the
 * record by `ownerPack`, with what it was read from under it.
 *
 * Opened for a period it reads the record as it stands. Opened for a kept
 * pack (`?pack=`) it shows that pack as it was prepared, and once issued as
 * it was issued, whatever the record has done since. Keeping, issuing and
 * reopening are done from the bar above the paper, by those who may.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { cockpitPath, isQuarter, meetingDay, ownerPack, ownerPackPeriod, ownerPackStanding, ownerPackTitle, quarterKey, quarterYearOf, reportPeriodSaid, type OwnerPackLine, type OwnerPackPart } from '@realytica/shared';
import { api, type ReportDayShown } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { useAsync } from '../../lib/useAsync';
import { Spinner } from '../../components/ui/kit';

function Line({ line }: { line: OwnerPackLine }) {
  return (
    <li className="break-inside-avoid border-b border-black/10 py-1.5">
      <p className={line.overdue ? 'font-semibold' : undefined}>{line.what}</p>
      <p className="text-[11px] text-black/60">
        {line.who ? `${line.who} · ` : ''}From {line.source}
      </p>
    </li>
  );
}

function Part({ part }: { part: OwnerPackPart }) {
  return (
    <div className="mt-3">
      {part.heading ? <h3 className="break-after-avoid text-[12px] font-semibold uppercase tracking-[0.08em] text-black/60">{part.heading}</h3> : null}
      {part.lines.length ? (
        <ul className="mt-1">
          {part.lines.map((line, at) => (
            <Line key={at} line={line} />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-black/60">{part.empty}</p>
      )}
      {part.note ? <p className="mt-1 text-[11px] text-black/60">{part.note}</p> : null}
    </div>
  );
}

const BAR_BUTTON = 'rounded border border-black/20 px-3 py-1 disabled:opacity-50';

export default function OwnerPackPrint() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [query, setQuery] = useSearchParams();
  const load = useAsync(() => api.getProject(projectId), [projectId]);
  // The project as the last step here left it, ahead of the one first loaded.
  const [stepped, setStepped] = useState<Awaited<ReturnType<typeof api.getProject>>>();
  const project = stepped ?? load.data;
  const me = useMe();
  const [may, setMay] = useState<ReportDayShown>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [month, quarter, from, to, packId] = [query.get('month'), query.get('quarter'), query.get('from'), query.get('to'), query.get('pack')];
  const kept = packId ? project?.ownerPacks?.find((held) => held.id === packId) : undefined;
  const pack = useMemo(() => (kept ? kept.pack : project && !packId ? ownerPack(project, ownerPackPeriod({ month, quarter, from, to })) : undefined), [project, kept, packId, month, quarter, from, to]);
  const title = kept ? kept.title : project && pack ? ownerPackTitle(project, pack.period) : undefined;

  useEffect(() => {
    let live = true;
    // What this person may do with a pack. Somebody who may do nothing is shown the paper and its Print button alone.
    api.reportDay(projectId).then(
      (shown) => live && setMay(shown),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!title) return;
    document.title = title;
    // A kept pack is opened to be read and issued; a pack opened for a period prints, as it always has.
    if (packId) return;
    // After the fonts and layout settle, so the dialog prints the finished page.
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [title, packId]);

  /** Keep, read again, issue or reopen, then show the pack as it now stands. */
  async function step(work: () => Promise<{ project: NonNullable<typeof project>; pack: { id: string } }>) {
    setBusy(true);
    setFailed('');
    try {
      const done = await work();
      setStepped(done.project);
      if (done.pack.id !== packId) setQuery({ pack: done.pack.id }, { replace: true });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'That could not be done.');
    } finally {
      setBusy(false);
    }
  }

  if (load.error) return <p className="bg-white p-8 text-[14px] text-black">Could not load the project: {load.error}</p>;
  if (project && packId && !kept) return <p className="bg-white p-8 text-[14px] text-black">No owner pack by that name is kept on this project.</p>;
  if (!project || !pack) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-white">
        <Spinner size={18} />
      </div>
    );
  }

  // A kept pack is headed as the project was named when it was prepared.
  const heading = kept?.heading ?? { name: project.name, reference: project.reference, place: [project.location, project.city].filter(Boolean).join(', ') };
  // The period on the address, as the route that keeps a pack takes it.
  const asked = month ? { month } : quarter ? { quarter } : from && to ? { from, to } : isQuarter(pack.period) ? { quarter: quarterKey(pack.period)! } : { month: pack.period.from.slice(0, 7) };

  return (
    <div className="min-h-[100dvh] bg-white text-black">
      <style>{`
        @page { margin: 18mm 16mm 20mm; }
        @media print { .no-print { display: none !important; } body { background: white; } }
      `}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 text-[13px] sm:px-6">
        <Link to={cockpitPath(project.id, 'reports')} className="text-blue-700 underline">
          Back to Reports
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {kept ? <span className="text-black/60">{ownerPackStanding(project, kept)}</span> : null}
          {!kept && may?.mayPrepare ? (
            <button type="button" className={BAR_BUTTON} disabled={busy} onClick={() => void step(() => api.keepOwnerPack(project.id, asked))}>
              Keep
            </button>
          ) : null}
          {kept?.status === 'prepared' && may?.mayPrepare ? (
            <button type="button" className={BAR_BUTTON} disabled={busy} onClick={() => void step(() => api.ownerPackStep(project.id, kept.id, 'refresh'))}>
              Read again
            </button>
          ) : null}
          {kept?.status !== 'issued' && may?.mayIssue ? (
            <button
              type="button"
              className={`${BAR_BUTTON} bg-black text-white`}
              disabled={busy}
              onClick={() => void step(() => (kept ? api.ownerPackStep(project.id, kept.id, 'issue', me?.name) : api.keepOwnerPack(project.id, { ...asked, issue: true, name: me?.name })))}
            >
              Issue
            </button>
          ) : null}
          {kept?.status === 'issued' && may?.mayIssue ? (
            <button type="button" className={BAR_BUTTON} disabled={busy} onClick={() => void step(() => api.ownerPackStep(project.id, kept.id, 'reopen'))}>
              Reopen
            </button>
          ) : null}
          <button type="button" className={BAR_BUTTON} onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>
      {failed ? <p className="no-print border-b border-black/10 px-6 py-2 text-[13px] text-red-700">{failed}</p> : null}

      <article className="mx-auto max-w-[760px] px-4 py-8 text-[13px] leading-relaxed sm:px-10">
        <header className="border-b border-black/20 pb-4">
          <p className="text-[12px] uppercase tracking-[0.14em] text-black/60">Owner pack</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{heading.name}</h1>
          <p className="mt-1 text-[15px] text-black/70">{heading.place}</p>
          <p className="mt-3 text-[18px] font-medium">{isQuarter(pack.period) ? reportPeriodSaid(pack.period, quarterYearOf(project)) : pack.periodSaid}</p>
          <p className="mt-1 text-[12px] text-black/60">
            {heading.reference} · Read from the project record as it stood on {meetingDay(pack.asOf)}. No line is written by a model.
          </p>
          {kept ? <p className="mt-1 text-[12px] font-medium text-black/80">{ownerPackStanding(project, kept)}.</p> : null}
        </header>

        {pack.sections.map((section, at) => (
          <section key={section.key} className="mt-6">
            <h2 className="break-after-avoid border-b border-black/30 pb-1 text-[14px] font-semibold tracking-wide">
              {at + 1}. {section.title}
            </h2>
            {section.parts.map((part, n) => (
              <Part key={part.heading ?? n} part={part} />
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
