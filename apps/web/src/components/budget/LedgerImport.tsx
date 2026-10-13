/**
 * The Cost Report's import: a cost table pasted or uploaded as a consultant
 * lays it out.
 *
 * It is shown before it is written. The first press reads the table and says
 * what it would do: the rows it would take, the lines it read as headings,
 * sub-totals, the total, GST and the grand total, and whether the rows add up
 * to the table's own total. Nothing reaches the ledger until the person
 * presses again. With `beside`, a cost report whose tables are pictures is
 * open next to the box to paste from.
 */

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { COST_COLUMN_LABEL, COST_LINE_SAID, formatMoneyInFull, type CostImportPreview, type CostReportPeriod, type CostTotalsMoved, type DdProject } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { workspaceApi } from '../../lib/workspace-api';
import { Button, Card, CardBody, CardHeader, cn, useToast } from '../ui/kit';

/** A paper to keep open beside the box. */
export interface PaperBeside {
  evidenceId: string;
  fileId: string;
  title: string;
}

function PaperOpen({ projectId, paper }: { projectId: string; paper: PaperBeside }) {
  const { url } = useAuthedUrl(api.evidenceFileUrl(projectId, paper.evidenceId, paper.fileId, { inline: true }));
  return url ? (
    <iframe src={url} title={paper.title} className="h-[28rem] w-full rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]" />
  ) : (
    <div className="h-[28rem] w-full animate-pulse rounded-lg bg-sunken" />
  );
}

type Sent = { file: File } | { text: string };

export function LedgerImport({ project, report, onChanged, beside }: { project: DdProject; report: CostReportPeriod; onChanged: (p: DdProject) => void; beside?: PaperBeside }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** What was read and is waiting to be confirmed, with what was sent to read it. */
  const [shown, setShown] = useState<{ sent: Sent; preview: CostImportPreview; check: string } | null>(null);
  const currency = project.currency;

  async function read(sent: Sent) {
    setBusy(true);
    try {
      setShown({ sent, ...(await workspaceApi.previewCostImport(project.id, report.id, sent)) });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that table', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!shown) return;
    setBusy(true);
    try {
      const res = await workspaceApi.importCostReport(project.id, report.id, shown.sent);
      onChanged(res.project);
      toast(`Imported: ${res.added} added, ${res.updated} updated.`, 'good');
      setShown(null);
      setText('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not import', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const box = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void read({ file });
            e.target.value = '';
          }}
        />
        <Button size="sm" icon={<Upload size={14} />} loading={busy} onClick={() => fileRef.current?.click()}>
          Upload file
        </Button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setShown(null);
        }}
        rows={beside ? 12 : 4}
        aria-label="Cost table to import"
        placeholder={'Packages\tBudget\tAwarded value\tAwarded to\tAnticipated final cost\tAmount certified\nRCC structure\t12,50,00,000\t12,18,60,000\tNorthgate Constructions\t12,46,10,000\t6,04,25,000'}
        className="w-full resize-y rounded-lg bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none ring-1 ring-inset ring-[var(--ring)] focus-visible:ring-2 focus-visible:ring-brand"
      />
      {shown ? null : (
        <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => void read({ text })}>
          Read the table
        </Button>
      )}
      {shown ? <Preview shown={shown} currency={currency} busy={busy} onConfirm={() => void confirm()} onCancel={() => setShown(null)} /> : null}
    </div>
  );

  return (
    <Card>
      <CardHeader title="Import ledger" subtitle="Paste the cost table as the report lays it out, or upload a CSV or Excel sheet. It is shown before anything is written." />
      <CardBody>
        {beside ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <PaperOpen projectId={project.id} paper={beside} />
            {box}
          </div>
        ) : (
          box
        )}
      </CardBody>
    </Card>
  );
}

function Preview({ shown, currency, busy, onConfirm, onCancel }: { shown: { preview: CostImportPreview; check: string }; currency: DdProject['currency']; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { preview, check } = shown;
  const { read } = preview;
  const figures = read.columns.filter((column) => column !== 'code' && column !== 'name' && column !== 'description' && column !== 'perArea');
  const held = read.checks.filter((line) => line.difference === 0);
  // A figure checked against the table it was read from is written to the rupee, as the table writes it.
  const cell = (amount: number | undefined): string => (amount === undefined ? '' : formatMoneyInFull(amount, currency));
  const unplaced = preview.rows.filter((row) => row.unplaced || row.problems?.length).length;
  return (
    <div className="space-y-2 rounded-lg bg-sunken p-2.5">
      <p className="text-[13px] font-semibold text-ink">
        {preview.rows.length === 1 ? '1 row' : `${preview.rows.length} rows`} to take
        <span className="ml-1.5 font-normal text-ink-secondary">
          {preview.adds} new, {preview.updates} already on the report{read.lines.length ? `; ${read.lines.length} ${read.lines.length === 1 ? 'line is' : 'lines are'} not packages` : ''}
        </span>
      </p>
      {read.header === 'assumed' ? (
        <p className="text-[12px] text-[var(--status-warning-text)]">
          No row names the columns, so they were read in the usual order: {read.columns.filter((column) => column !== 'code').map((column) => COST_COLUMN_LABEL[column]).join(', ')}. Check the first row below.
        </p>
      ) : null}
      {check ? (
        <p className="text-[13px] font-medium text-[var(--status-critical-text)]">The rows do not add up to the table’s total. {check}</p>
      ) : read.tie.holds ? (
        <p className="text-[12px] text-[var(--status-good-text)]">
          {read.tie.said}
          {held.length ? ` ${held.map((line) => `${COST_COLUMN_LABEL[line.column]} ${formatMoneyInFull(line.stated, currency)}`).join(', ')}, before GST.` : ''}
        </p>
      ) : (
        <p className="text-[12px] text-ink-secondary">The table states no total, so the rows are held to none.</p>
      )}
      <TotalsMoved totals={preview.totals} currency={currency} />
      {unplaced ? (
        <p className="text-[12px] text-[var(--status-warning-text)]">
          {unplaced === 1 ? '1 row has' : `${unplaced} rows have`} a figure that could not be read into its column. It is imported without that figure, to be typed on the ledger.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
              <th className="py-1 pr-2 font-medium">Package</th>
              {figures.map((column) => (
                <th key={column} className={cn('py-1 pr-2 font-medium', column === 'awardedTo' ? '' : 'text-right')}>
                  {COST_COLUMN_LABEL[column]}
                </th>
              ))}
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.line} className="border-b border-hairline/70">
                <td className="py-1 pr-2 text-ink">
                  {row.name}
                  {row.kind ? <span className="ml-1.5 text-ink-muted">{row.kind === 'fee' ? 'Fee' : 'Contingency'}</span> : null}
                </td>
                {figures.map((column) => (
                  <td key={column} className={cn('py-1 pr-2 tabular-nums text-ink', column === 'awardedTo' ? '' : 'text-right')}>
                    {column === 'awardedTo'
                      ? (row.awardedTo ?? '')
                      : cell(column === 'budget' ? row.budget : column === 'awarded' ? row.poIssued : column === 'paid' ? row.amountPaid : column === 'anticipated' ? row.anticipatedCost : column === 'certified' ? row.certified : row.variations)}
                  </td>
                ))}
                <td className="py-1 text-ink-muted">{row.on === 'update' ? 'Updates the row' : 'New'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {read.lines.length || preview.notTaken.length ? (
        <details open>
          <summary className="cursor-pointer text-[12px] text-ink-secondary">Not taken as packages: {read.lines.length + preview.notTaken.length}, each with why</summary>
          <ul className="mt-1 space-y-0.5 text-[12px] text-ink-secondary">
            {[...read.lines.map((line) => ({ line: line.line, label: line.label, why: COST_LINE_SAID[line.as] })), ...preview.notTaken.map((row) => ({ line: row.line, label: row.quote, why: row.why }))]
              .sort((a, b) => a.line - b.line)
              .map((line) => (
                <li key={line.line}>
                  <span className="text-ink">{line.label}</span>: {line.why}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} disabled={!preview.rows.length} onClick={onConfirm}>
          {check ? 'Import all the same' : `Import ${preview.rows.length === 1 ? 'this row' : `these ${preview.rows.length} rows`}`}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The ledger's totals as they stand and as they would stand once the rows shown are written. */
export function TotalsMoved({ totals, currency }: { totals: CostTotalsMoved; currency: DdProject['currency'] }) {
  const { before, after } = totals;
  const line = (label: string, was: number, now: number) => (was === now ? null : `${label} ${formatMoneyInFull(was, currency)} to ${formatMoneyInFull(now, currency)}`);
  const moved = [line('budget', before.budget, after.budget), line('PO issued', before.poIssued, after.poIssued), line('certified', before.certified, after.certified), line('paid', before.amountPaid, after.amountPaid), line('anticipated', before.anticipatedCost, after.anticipatedCost)].filter((said): said is string => said !== null);
  return (
    <p className="text-[12px] text-ink-secondary">
      The ledger holds {before.rows === 1 ? '1 row' : `${before.rows} rows`} now and would hold {after.rows}.{moved.length ? ` Its totals would go: ${moved.join('; ')}.` : ' Its totals would not change.'}
    </p>
  );
}
