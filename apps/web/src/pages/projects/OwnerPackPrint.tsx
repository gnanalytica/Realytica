/**
 * The owner pack as a printable document (Save as PDF).
 *
 * Outside the app shell, as the other printed reports are, so what prints is
 * the pack and not the navigation around it. Every line is read from the
 * record by `ownerPack`, with what it was read from under it.
 */

import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { cockpitPath, meetingDay, ownerPack, ownerPackPeriod, ownerPackTitle, type OwnerPackLine, type OwnerPackPart } from '@realytica/shared';
import { api } from '../../lib/api';
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

export default function OwnerPackPrint() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [query] = useSearchParams();
  const load = useAsync(() => api.getProject(projectId), [projectId]);
  const project = load.data;
  const [month, from, to] = [query.get('month'), query.get('from'), query.get('to')];
  const pack = useMemo(() => (project ? ownerPack(project, ownerPackPeriod({ month, from, to })) : undefined), [project, month, from, to]);
  const title = project && pack ? ownerPackTitle(project, pack.period) : undefined;

  useEffect(() => {
    if (!title) return;
    document.title = title;
    // After the fonts and layout settle, so the dialog prints the finished page.
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [title]);

  if (load.error) return <p className="bg-white p-8 text-[14px] text-black">Could not load the project: {load.error}</p>;
  if (!project || !pack) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-white">
        <Spinner size={18} />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-white text-black">
      <style>{`
        @page { margin: 18mm 16mm 20mm; }
        @media print { .no-print { display: none !important; } body { background: white; } }
      `}</style>
      <div className="no-print flex items-center justify-between gap-3 border-b border-black/10 px-6 py-3 text-[13px]">
        <Link to={cockpitPath(project.id, 'reports')} className="text-blue-700 underline">
          Back to Reports
        </Link>
        <button type="button" className="rounded border border-black/20 px-3 py-1" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <article className="mx-auto max-w-[760px] px-4 py-8 text-[13px] leading-relaxed sm:px-10">
        <header className="border-b border-black/20 pb-4">
          <p className="text-[12px] uppercase tracking-[0.14em] text-black/60">Owner pack</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{project.name}</h1>
          <p className="mt-1 text-[15px] text-black/70">{[project.location, project.city].filter(Boolean).join(', ')}</p>
          <p className="mt-3 text-[18px] font-medium">{pack.periodSaid}</p>
          <p className="mt-1 text-[12px] text-black/60">
            {project.reference} · Read from the project record as it stood on {meetingDay(pack.asOf)}. No line is written by a model.
          </p>
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
