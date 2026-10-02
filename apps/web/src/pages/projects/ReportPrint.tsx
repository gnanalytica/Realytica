import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  engagementForReport,
  REPORT_KIND_LABEL,
  readReportBlock,
  reportIsFrozen,
  reportSummaryLine,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';

/**
 * The report as a printable document, for "Save as PDF".
 *
 * Its own page, outside the app shell, so what prints is the report and not
 * the navigation around it. The same blocks the editor shows, in the same
 * order; a draft says so at the top and in the page footer.
 */
export default function ReportPrint() {
  const { projectId, reportId } = useParams<{ projectId: string; reportId: string }>();
  const { data: project, error } = useAsync(() => api.getProject(projectId as string), [projectId]);
  const report = project?.reports.find((r) => r.id === reportId);

  useEffect(() => {
    if (!report) return;
    document.title = `${project!.reference} ${report.title}`;
    // After the fonts and layout settle, so the dialog prints the finished page.
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [report, project]);

  if (error) return <p className="p-8 text-[14px]">Could not load the report: {error}</p>;
  if (!project) return <p className="p-8 text-[14px]">Loading the report…</p>;
  if (!report) return <p className="p-8 text-[14px]">No such report on this project.</p>;

  const frozen = reportIsFrozen(report.status);
  const issued = report.status === 'issued';
  const summary = frozen ? report.body.summary : reportSummaryLine(project);
  const dated = new Date(issued && report.signedAt ? report.signedAt : Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-white text-[#111]">
      <style>{`
        @page { margin: 18mm 16mm 20mm; }
        @media print { .screen-only { display: none !important; } body { background: white; } }
      `}</style>
      <div className="screen-only sticky top-0 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-3 text-[13px]">
        <span>Print or save as PDF from your browser's dialog.</span>
        <button type="button" onClick={() => window.print()} className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white">
          Print
        </button>
      </div>
      <article className="mx-auto max-w-[760px] px-8 py-10 font-[Georgia,'Times_New_Roman',serif] text-[14px] leading-relaxed">
        <header className="border-b border-neutral-300 pb-4">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{report.title}</h1>
          <p className="mt-2 text-[16px] font-semibold">{project.name}</p>
          <p className="text-neutral-600">{[project.siteAddress || project.location, project.city].filter(Boolean).join(', ')}</p>
          <p className="mt-1 text-[13px] text-neutral-600">
            {REPORT_KIND_LABEL[report.kind]} · {project.reference} · {dated}
            {engagementForReport(project, report.id)?.client ? ` · For ${engagementForReport(project, report.id)!.client}` : ''}
          </p>
        </header>

        {!issued ? (
          <p className="mt-4 font-semibold text-[#B42318]">
            DRAFT. Not issued and not signed. Sections that read the project registers show what they say today.
          </p>
        ) : null}

        {summary ? (
          <section className="mt-6">
            <h2 className="text-[17px] font-semibold">Summary</h2>
            <p className="mt-1">{summary}</p>
          </section>
        ) : null}

        {report.body.blocks.map((block) => {
          const resolved = readReportBlock(project, block, frozen);
          return (
            <section key={block.id} className="mt-6 break-inside-avoid-page">
              <h2 className="text-[17px] font-semibold">{block.heading ?? 'Section'}</h2>
              {block.origin === 'derived' ? (
                resolved.lines.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {resolved.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 italic text-neutral-600">{resolved.note ?? 'Nothing recorded for this section.'}</p>
                )
              ) : (
                (block.text ?? '')
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i} className="mt-1">
                      {p}
                    </p>
                  ))
              )}
            </section>
          );
        })}

        <section className="mt-10 border-t border-neutral-300 pt-4">
          <h2 className="text-[17px] font-semibold">Sign-off</h2>
          {issued ? (
            <p className="mt-1">
              Signed: {report.signedBy ?? report.reviewer}
              {report.signedRole ? `, ${report.signedRole}` : ''} · {dated}
            </p>
          ) : (
            <p className="mt-1 italic text-neutral-600">Not signed. This draft has not been issued.</p>
          )}
        </section>
      </article>
    </div>
  );
}
