/**
 * Monthly Cost Report as a printable document (Save as PDF).
 *
 * Outside the app shell so what prints is the report — cover plus the three
 * table sheets — and not the navigation around it.
 */

import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { costReportTotals, costReportsOf, moneySaid, projectPhotos, type CostReportPackageRow, type CostReportPeriod, type DdProject } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { Spinner } from '../../components/ui/kit';

function money(amount: number, currency: DdProject['currency']): string {
  return moneySaid(amount, currency);
}

function packageLabel(row: CostReportPackageRow): string {
  return [row.code, row.name].filter(Boolean).join(' · ');
}

function Sheet({
  title,
  children,
  page,
  of,
}: {
  title: string;
  children: React.ReactNode;
  page: number;
  of: number;
}) {
  return (
    <section className="cost-sheet break-after-page flex min-h-[100vh] flex-col px-10 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-black/20 pb-2">
        <h2 className="text-[14px] font-semibold tracking-wide text-black">{title}</h2>
        <p className="text-[11px] text-black/60">
          Sheet {page} of {of}
        </p>
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function MoneyTable({
  report,
  currency,
  columns,
  showVariance,
}: {
  report: CostReportPeriod;
  currency: DdProject['currency'];
  columns: Array<{ key: 'budget' | 'poIssued' | 'amountPaid' | 'anticipatedCost'; label: string }>;
  showVariance?: boolean;
}) {
  const totals = costReportTotals(report);
  return (
    <table className="w-full border-collapse text-left text-[12px]">
      <thead>
        <tr className="border-b border-black/30">
          <th className="py-1.5 pr-3 font-semibold">Package</th>
          {columns.map((c) => (
            <th key={c.key} className="py-1.5 pr-3 text-right font-semibold">
              {c.label}
            </th>
          ))}
          {showVariance ? <th className="py-1.5 text-right font-semibold">Variance</th> : null}
        </tr>
      </thead>
      <tbody>
        {report.rows.map((row) => (
          <tr key={row.id} className="border-b border-black/10">
            <td className="py-1.5 pr-3">{packageLabel(row)}</td>
            {columns.map((c) => (
              <td key={c.key} className="py-1.5 pr-3 text-right tabular-nums">
                {money(row[c.key], currency)}
              </td>
            ))}
            {showVariance ? (
              <td className="py-1.5 text-right tabular-nums">{money(row.anticipatedCost - row.budget, currency)}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className="pt-2 pr-3">Total</td>
          {columns.map((c) => (
            <td key={c.key} className="pt-2 pr-3 text-right tabular-nums">
              {money(totals[c.key], currency)}
            </td>
          ))}
          {showVariance ? <td className="pt-2 text-right tabular-nums">{money(totals.anticipatedVariance, currency)}</td> : null}
        </tr>
      </tfoot>
    </table>
  );
}

export default function CostReportPrint() {
  const { projectId = '', reportId = '' } = useParams<{ projectId: string; reportId: string }>();
  const load = useAsync(() => api.getProject(projectId), [projectId]);
  const project = load.data;
  const report = useMemo(() => (project ? costReportsOf(project).find((r) => r.id === reportId) : undefined), [project, reportId]);

  useEffect(() => {
    if (report) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [report?.id]);

  if (load.loading || !project) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-white">
        <Spinner size={18} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-white p-8 text-center">
        <div>
          <p className="text-[15px] text-black">No Cost Report by that id.</p>
          <Link to={`/projects/${projectId}`} className="mt-3 inline-block text-[13px] text-blue-700 underline">
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  const totals = costReportTotals(report);

  return (
    <div className="cost-report-print bg-white text-black">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .cost-sheet { break-after: page; }
          .cost-sheet:last-child { break-after: auto; }
        }
      `}</style>
      <div className="no-print flex items-center justify-between gap-3 border-b border-black/10 px-6 py-3 text-[13px]">
        <Link to={`/projects/${projectId}/w/finance.budget`} className="text-blue-700 underline">
          Back to Budget
        </Link>
        <button type="button" className="rounded border border-black/20 px-3 py-1" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <section className="cost-sheet flex min-h-[100vh] flex-col items-center justify-center px-10 py-16 text-center">
        <p className="text-[12px] uppercase tracking-[0.14em] text-black/55">Cost Report</p>
        <h1 className="mt-4 max-w-[28rem] text-[28px] font-semibold leading-tight tracking-tight">{project.name}</h1>
        <p className="mt-3 text-[15px] text-black/70">
          {[project.location, project.city].filter(Boolean).join(', ')}
        </p>
        <p className="mt-10 text-[18px] font-medium">{report.label}</p>
        <p className="mt-2 text-[12px] text-black/55">
          {report.from} – {report.to}
          {report.status === 'issued' && report.issuedAt ? ` · Issued ${report.issuedAt.slice(0, 10)}` : ' · Draft'}
        </p>
        <dl className="mt-12 grid w-full max-w-lg grid-cols-2 gap-4 text-left sm:grid-cols-4">
          {[
            ['Budget', totals.budget],
            ['PO issued', totals.poIssued],
            ['Paid', totals.amountPaid],
            ['Anticipated', totals.anticipatedCost],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-[10px] uppercase tracking-[0.08em] text-black/50">{label}</dt>
              <dd className="mt-0.5 text-[14px] font-semibold tabular-nums">{money(value as number, project.currency)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Sheet title="Executive summary — Budget vs PO issued vs Amount paid" page={1} of={6}>
        <MoneyTable
          report={report}
          currency={project.currency}
          columns={[
            { key: 'budget', label: 'Budget' },
            { key: 'poIssued', label: 'PO issued' },
            { key: 'amountPaid', label: 'Amount paid' },
          ]}
        />
      </Sheet>

      <Sheet title="Executive summary — Budget vs Anticipated cost" page={2} of={6}>
        <MoneyTable
          report={report}
          currency={project.currency}
          columns={[
            { key: 'budget', label: 'Budget' },
            { key: 'anticipatedCost', label: 'Anticipated' },
          ]}
          showVariance
        />
        {report.note ? (
          <div className="mt-8 border-t border-black/15 pt-4 text-[12px] leading-relaxed">
            <p className="font-semibold">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-black/80">{report.note}</p>
          </div>
        ) : null}
      </Sheet>

      <Sheet title="Budget details — Package ledger" page={3} of={6}>
        <MoneyTable
          report={report}
          currency={project.currency}
          columns={[
            { key: 'budget', label: 'Budget' },
            { key: 'poIssued', label: 'PO issued' },
            { key: 'amountPaid', label: 'Amount paid' },
            { key: 'anticipatedCost', label: 'Anticipated' },
          ]}
        />
      </Sheet>

      <Sheet title="Cause of project cost increment — Variation log" page={4} of={6}>
        {(report.variations ?? []).length ? (
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-black/30">
                <th className="py-1.5 pr-3 font-semibold">Description</th>
                <th className="py-1.5 pr-3 font-semibold">Drawn from</th>
                <th className="py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(report.variations ?? []).map((v) => (
                <tr key={v.id} className="border-b border-black/10">
                  <td className="py-1.5 pr-3">{v.description}</td>
                  <td className="py-1.5 pr-3">{v.contingencyDrawn ? 'Contingency' : 'Budget'}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(v.amount, project.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[12px] text-black/60">No variations logged for this period.</p>
        )}
      </Sheet>

      <Sheet title="Basic price adjustments" page={5} of={6}>
        {(report.basicPriceAdjustments ?? []).length ? (
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-black/30">
                <th className="py-1.5 pr-3 font-semibold">Item</th>
                <th className="py-1.5 pr-3 font-semibold">Unit</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Tender</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Current</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Qty</th>
                <th className="py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(report.basicPriceAdjustments ?? []).map((row) => (
                <tr key={row.id} className="border-b border-black/10">
                  <td className="py-1.5 pr-3">{row.item}</td>
                  <td className="py-1.5 pr-3">{row.unit ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.tenderRate, project.currency)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.currentRate, project.currency)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{row.quantity ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.amount !== undefined ? money(row.amount, project.currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[12px] text-black/60">No basic price adjustments on this report.</p>
        )}
      </Sheet>

      <ProgressPhotoSheet project={project} report={report} page={6} of={6} />
    </div>
  );
}

function ProgressPhotoSheet({
  project,
  report,
  page,
  of,
}: {
  project: DdProject;
  report: CostReportPeriod;
  page: number;
  of: number;
}) {
  const ids = new Set(report.photoEvidenceIds ?? []);
  const photos = projectPhotos(project, 'construction').filter((p) => p.evidenceId && p.fileId && ids.has(p.evidenceId));
  return (
    <Sheet title="Project progress pictures" page={page} of={of}>
      {photos.length ? (
        <ul className="grid grid-cols-2 gap-4">
          {photos.map((p) => (
            <li key={p.evidenceId}>
              <PrintPhoto projectId={project.id} evidenceId={p.evidenceId!} fileId={p.fileId!} caption={p.caption || p.title} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-black/60">No photographs selected for this Cost Report.</p>
      )}
    </Sheet>
  );
}

function PrintPhoto({
  projectId,
  evidenceId,
  fileId,
  caption,
}: {
  projectId: string;
  evidenceId: string;
  fileId: string;
  caption?: string;
}) {
  const { url } = useAuthedUrl(api.evidenceFileUrl(projectId, evidenceId, fileId, { inline: true }));
  return (
    <figure>
      {url ? <img src={url} alt={caption ?? ''} className="w-full object-cover" /> : <div className="aspect-[4/3] bg-neutral-100" />}
      {caption ? <figcaption className="mt-1 text-[11px] text-black/60">{caption}</figcaption> : null}
    </figure>
  );
}
