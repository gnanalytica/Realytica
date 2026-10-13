/**
 * Finance › Budget: the monthly Cost Report desk.
 *
 * The package ledger is the source of truth. The two executive sheets read the
 * same rows — Budget vs PO vs Paid, and Budget vs Anticipated.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Lock, Printer, Unlock } from 'lucide-react';
import {
  costReportBottomLine,
  costReportTotals,
  costReportsOf,
  departmentRole,
  moneySaid,
  ruleSourceSaid,
  roleCanDecide,
  roleCanEdit,
  type CostReportPackageRow,
  type CostReportPeriod,
  type DdProject,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmIssue, Input, cn, useToast } from '../ui/kit';
import { personNamed } from '../../lib/format';
import { CostReportExtras } from './CostReportExtras';
import { CostBillsPanel } from './CostBillsPanel';
import { CostPapers } from './CostPapers';
import { SinceLastReport } from './SinceLastReport';
import { TenderOffers } from '../procurement/TenderOffers';

function money(amount: number, currency: DdProject['currency']): string {
  return moneySaid(amount, currency);
}

function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replace(/[, ]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function BudgetDesk({ project, onChanged }: { project: DdProject; onChanged: (p: DdProject) => void }) {
  const toast = useToast();
  const me = useMe();
  const role = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, 'finance') : undefined;
  const mayEdit = roleCanEdit(role);
  const mayDecide = roleCanDecide(role);
  const reports = useMemo(
    () => [...costReportsOf(project)].sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt)),
    [project],
  );
  const [reportId, setReportId] = useState<string | null>(null);
  const report = (reportId ? reports.find((r) => r.id === reportId) : undefined) ?? reports[0] ?? null;
  const activeId = report?.id ?? null;

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const noteValue = noteDraft !== null && report ? noteDraft : (report?.note ?? '');

  const totals = report ? costReportTotals(report) : null;
  // Whether a model reader is set up: what a cost report whose tables are pictures says of itself turns on it. Taken as set up until known.
  const [modelSetUp, setModelSetUp] = useState(true);
  useEffect(() => {
    let live = true;
    api.agentCapability().then(
      (capability) => {
        if (live) setModelSetUp(capability.available);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const draft = report?.status === 'draft';
  const currency = project.currency;

  async function run(label: string, work: () => Promise<{ project: DdProject }>) {
    setBusy(true);
    try {
      onChanged((await work()).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : label, 'critical');
    } finally {
      setBusy(false);
    }
  }

  // Issuing is asked once: what is frozen, and who is named as the issuer.
  const [confirmIssue, setConfirmIssue] = useState(false);

  async function startReport() {
    const day = `${month}-01`;
    setBusy(true);
    try {
      const res = await workspaceApi.startCostReport(project.id, { month: day });
      onChanged(res.project);
      setReportId(res.report.id);
      toast(`${res.report.label} started.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start the Cost Report', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {report ? (
        <ConfirmIssue
          open={confirmIssue}
          what={`the Cost Report for ${report.label}`}
          issuer={personNamed(project, me?.email) || 'you'}
          lines={['The ledger, the variations and the basic prices are kept as they read now, and the forecast is compared with the report before it.']}
          busy={busy}
          onClose={() => setConfirmIssue(false)}
          onConfirm={() => {
            setConfirmIssue(false);
            void run('Could not issue', () => workspaceApi.patchCostReport(project.id, report.id, { issue: true }));
          }}
        />
      ) : null}
      {/* What Procurement awarded and offers as PO issued: written on the draft below when Finance accepts it. */}
      <TenderOffers project={project} onChanged={onChanged} />
      <Card>
        <CardHeader
          title="Cost Report"
          subtitle="Budget against PO issued, certified, amount paid and anticipated cost, by work package"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {report ? (
                <Link
                  to={`/projects/${project.id}/cost-reports/${report.id}/print`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:text-ink"
                >
                  <Printer size={13} aria-hidden /> Print
                </Link>
              ) : null}
              {mayEdit ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="month"
                    aria-label="Month for a new Cost Report"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="w-[9.5rem]"
                  />
                  <Button size="sm" icon={<FilePlus2 size={14} />} loading={busy} onClick={() => void startReport()}>
                    New
                  </Button>
                </div>
              ) : null}
            </div>
          }
        />
        <CardBody className="space-y-3">
          {reports.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">
              No Cost Report yet. Start one for a month to enter the package ledger — Budget, PO issued, Paid and Anticipated.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setReportId(r.id);
                    setNoteDraft(null);
                  }}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors',
                    r.id === activeId ? 'bg-brand-soft font-semibold text-brand ring-brand/30' : 'text-ink-secondary ring-[var(--ring)] hover:text-ink',
                  )}
                >
                  {r.label}
                  <span className="ml-1.5 text-ink-muted">{r.status === 'issued' ? 'Issued' : r.status === 'superseded' ? 'Issued, since revised' : r.revises ? 'Revision' : 'Draft'}</span>
                </button>
              ))}
            </div>
          )}

          {report && totals ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Budget', totals.budget],
                ['PO issued', totals.poIssued],
                ['Amount paid', totals.amountPaid],
                ['Anticipated', totals.anticipatedCost],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-sunken px-2.5 py-2">
                  <p className="text-micro text-ink-muted">{label}</p>
                  <p className="text-[14px] font-semibold tabular-nums text-ink">{money(value as number, currency)}</p>
                </div>
              ))}
            </div>
          ) : null}

          {report ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={draft ? 'neutral' : report.status === 'issued' ? 'good' : 'neutral'}>{draft ? (report.revises ? 'Revision of the issued report, which stands until this is issued' : 'Draft') : report.status === 'issued' ? 'Issued' : 'Issued, since revised: kept as it was sent'}</Badge>
              {draft && mayDecide ? (
                <Button
                  size="sm"
                  icon={<Lock size={13} />}
                  loading={busy}
                  onClick={() => setConfirmIssue(true)}
                >
                  Issue
                </Button>
              ) : null}
              {report.status === 'issued' && mayDecide ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Unlock size={13} />}
                  loading={busy}
                  onClick={() =>
                    void run('Could not open a revision', async () => {
                      // The issued report stays as it was sent: a revision opens beside it, and is the one to work on.
                      const out = await workspaceApi.patchCostReport(project.id, report.id, { reopen: true });
                      setReportId(out.report.id);
                      setNoteDraft(null);
                      return out;
                    })
                  }
                >
                  Revise
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* What a cost report on the register offers to the ledger: each row waits here until a lead or signer accepts it. */}
      <CostPapers project={project} report={report} mayDecide={mayDecide} mayEdit={mayEdit} modelSetUp={modelSetUp} onChanged={onChanged} />

      {report ? (
        <>
          <SinceLastReport project={project} report={report} mayEdit={mayEdit && draft} onChanged={onChanged} />
          <PackageLedger
            project={project}
            report={report}
            mayEdit={mayEdit && draft}
            busy={busy}
            onChanged={onChanged}
            setBusy={setBusy}
          />
          <BottomLine project={project} report={report} />
          <ExecTable
            title="Budget vs PO issued vs Amount paid"
            subtitle="Executive summary"
            currency={currency}
            rows={report.rows}
            columns={[
              { key: 'budget', label: 'Budget' },
              { key: 'poIssued', label: 'PO issued' },
              { key: 'amountPaid', label: 'Amount paid' },
            ]}
            totals={totals!}
          />
          <ExecTable
            title="Budget vs Anticipated cost"
            subtitle="Variance to the sanctioned budget"
            currency={currency}
            rows={report.rows}
            columns={[
              { key: 'budget', label: 'Budget' },
              { key: 'anticipatedCost', label: 'Anticipated' },
            ]}
            totals={totals!}
            showVariance
          />
          <Card>
            <CardHeader title="Notes" subtitle="Contingency callouts and period remarks" />
            <CardBody className="space-y-2">
              <textarea
                value={noteValue}
                disabled={!mayEdit || !draft || busy}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg bg-surface px-3 py-2 text-[13px] text-ink outline-none ring-1 ring-inset ring-[var(--ring)] focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70"
                placeholder="e.g. Design contingency absorbs sub-soil drainage and basic price adjustments…"
              />
              {mayEdit && draft ? (
                <Button
                  size="sm"
                  loading={busy}
                  disabled={noteValue === (report.note ?? '')}
                  onClick={() =>
                    void run('Could not save the note', async () => {
                      const res = await workspaceApi.patchCostReport(project.id, report.id, { note: noteValue || null });
                      setNoteDraft(null);
                      return res;
                    })
                  }
                >
                  Save note
                </Button>
              ) : null}
            </CardBody>
          </Card>
          <CostReportExtras project={project} report={report} mayEdit={mayEdit && draft} onChanged={onChanged} />
        </>
      ) : null}

      <CostBillsPanel project={project} mayEdit={mayEdit} mayDecide={mayDecide} onChanged={onChanged} />
    </div>
  );
}

function packageLabel(row: CostReportPackageRow): string {
  return [row.code, row.name].filter(Boolean).join(' · ');
}

/** What a row is besides its name, in a quiet line under it: who it was awarded to, or that it is money set aside or a fee. */
function rowSaid(row: CostReportPackageRow): string {
  return [row.kind === 'contingency' ? 'Contingency' : row.kind === 'fee' ? 'Fee' : '', row.awardedTo ? `Awarded to ${row.awardedTo}` : '', row.from ? `from page ${row.from.page} of a report` : ''].filter(Boolean).join(' · ');
}

/**
 * The lines a cost report ends in, worked out from the ledger and typed by
 * nobody: the total, GST on it at the rule row's rate, the total with GST, and
 * the cost for each square foot where the built-up area is on file.
 */
function BottomLine({ project, report }: { project: DdProject; report: CostReportPeriod }) {
  if (!report.rows.length) return null;
  const line = costReportBottomLine(project, report);
  const currency = project.currency;
  const rows: Array<[string, number, number]> = [
    ['Total before GST', line.beforeGst.budget, line.beforeGst.anticipatedCost],
    ...(line.gst ? ([[`GST at ${line.gst.ratePct}%`, line.gst.budget, line.gst.anticipatedCost]] as Array<[string, number, number]>) : []),
    ...(line.afterGst ? ([['Total with GST', line.afterGst.budget, line.afterGst.anticipatedCost]] as Array<[string, number, number]>) : []),
    ...(line.perArea ? ([[`Cost per sq ft, on ${line.perArea.areaSqft.toLocaleString('en-IN')} sq ft built-up, before GST`, line.perArea.budgetPerSqft, line.perArea.anticipatedPerSqft]] as Array<[string, number, number]>) : []),
  ];
  return (
    <Card>
      <CardHeader title="Bottom line" subtitle="Worked out from the ledger" />
      <CardBody className="space-y-1.5 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
              <th className="py-1.5 pr-3 font-medium" />
              <th className="py-1.5 pr-3 text-right font-medium">Budget</th>
              <th className="py-1.5 text-right font-medium">Anticipated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, budget, anticipated]) => (
              <tr key={label} className={cn('border-b border-hairline/70', label === 'Total with GST' ? 'font-semibold' : '')}>
                <td className="py-1.5 pr-3 text-ink">{label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(budget, currency)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{money(anticipated, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {line.beforeGst.certified !== undefined ? <p className="text-[12px] text-ink-secondary">Certified to date: {money(line.beforeGst.certified, currency)}</p> : null}
        {line.gst ? (
          <p className="text-[12px] text-ink-muted">
            GST rate: {ruleSourceSaid(line.gst.rule.source)}
            {line.gst.rule.verified ? '' : '. Rule not checked'}
          </p>
        ) : null}
        {!line.perArea ? <p className="text-[12px] text-ink-muted">No built-up area is on the project’s file, so no cost per sq ft is worked out.</p> : null}
      </CardBody>
    </Card>
  );
}

function ExecTable({
  title,
  subtitle,
  currency,
  rows,
  columns,
  totals,
  showVariance,
}: {
  title: string;
  subtitle: string;
  currency: DdProject['currency'];
  rows: CostReportPackageRow[];
  columns: Array<{ key: 'budget' | 'poIssued' | 'amountPaid' | 'anticipatedCost'; label: string }>;
  totals: ReturnType<typeof costReportTotals>;
  showVariance?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
              <th className="py-1.5 pr-3 font-medium">Package</th>
              {columns.map((c) => (
                <th key={c.key} className="py-1.5 pr-3 text-right font-medium">
                  {c.label}
                </th>
              ))}
              {showVariance ? <th className="py-1.5 text-right font-medium">Variance</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const variance = row.anticipatedCost - row.budget;
              return (
                <tr key={row.id} className="border-b border-hairline/70">
                  <td className="py-1.5 pr-3 text-ink">{packageLabel(row)}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="py-1.5 pr-3 text-right tabular-nums text-ink">
                      {money(row[c.key], currency)}
                    </td>
                  ))}
                  {showVariance ? (
                    <td className={cn('py-1.5 text-right tabular-nums', variance > 0 ? 'text-[var(--status-warning-text)]' : 'text-ink-secondary')}>
                      {money(variance, currency)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-ink">
              <td className="pt-2 pr-3">Total</td>
              {columns.map((c) => (
                <td key={c.key} className="pt-2 pr-3 text-right tabular-nums">
                  {money(totals[c.key], currency)}
                </td>
              ))}
              {showVariance ? (
                <td className="pt-2 text-right tabular-nums">{money(totals.anticipatedVariance, currency)}</td>
              ) : null}
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 ? <p className="mt-2 text-[13px] text-ink-muted">No packages on this report yet.</p> : null}
      </CardBody>
    </Card>
  );
}

function PackageLedger({
  project,
  report,
  mayEdit,
  busy,
  onChanged,
  setBusy,
}: {
  project: DdProject;
  report: CostReportPeriod;
  mayEdit: boolean;
  busy: boolean;
  onChanged: (p: DdProject) => void;
  setBusy: (v: boolean) => void;
}) {
  const toast = useToast();
  const currency = project.currency;
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newBudget, setNewBudget] = useState('');

  async function saveRow(rowId: string, patch: Parameters<typeof workspaceApi.updateCostReportRow>[3]) {
    setBusy(true);
    try {
      onChanged((await workspaceApi.updateCostReportRow(project.id, report.id, rowId, patch)).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the row', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function addPackage() {
    const budget = parseMoney(newBudget);
    if (!newName.trim()) {
      toast('Give the package a name.', 'critical');
      return;
    }
    if (budget === undefined) {
      toast('Budget must be a number.', 'critical');
      return;
    }
    setBusy(true);
    try {
      onChanged(
        (
          await workspaceApi.addCostReportPackage(project.id, report.id, {
            name: newName.trim(),
            ...(newCode.trim() ? { code: newCode.trim() } : {}),
            budget,
            anticipatedCost: budget,
          })
        ).project,
      );
      setNewName('');
      setNewCode('');
      setNewBudget('');
      setAdding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the package', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Package ledger"
        subtitle="Edit these figures — the executive sheets follow"
        action={
          mayEdit ? (
            <Button size="sm" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add package'}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3 overflow-x-auto">
        {adding ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-sunken p-2.5">
            <label className="block text-[12px] text-ink-secondary">
              Code
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} className="mt-1 w-20" />
            </label>
            <label className="block min-w-[10rem] flex-1 text-[12px] text-ink-secondary">
              Name
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1" />
            </label>
            <label className="block text-[12px] text-ink-secondary">
              Budget
              <Input value={newBudget} onChange={(e) => setNewBudget(e.target.value)} inputMode="decimal" className="mt-1 w-32" />
            </label>
            <Button size="sm" loading={busy} onClick={() => void addPackage()}>
              Add
            </Button>
          </div>
        ) : null}
        <table className="w-full min-w-[54rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
              <th className="py-1.5 pr-2 font-medium">Package</th>
              <th className="py-1.5 pr-2 text-right font-medium">Budget</th>
              <th className="py-1.5 pr-2 text-right font-medium">PO issued</th>
              <th className="py-1.5 pr-2 text-right font-medium">Certified</th>
              <th className="py-1.5 pr-2 text-right font-medium">Paid</th>
              <th className="py-1.5 pr-2 text-right font-medium">Anticipated</th>
              {mayEdit ? <th className="py-1.5 font-medium" /> : null}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <LedgerRow
                key={`${row.id}:${row.budget}:${row.poIssued}:${row.certified ?? ''}:${row.amountPaid}:${row.anticipatedCost}`}
                row={row}
                currency={currency}
                mayEdit={mayEdit}
                busy={busy}
                onSave={(patch) => void saveRow(row.id, patch)}
                onRemove={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      onChanged((await workspaceApi.removeCostReportPackage(project.id, report.id, row.id)).project);
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Could not remove it', 'critical');
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              />
            ))}
          </tbody>
        </table>
        {report.rows.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            {mayEdit ? 'Add a package to begin the ledger.' : 'No packages on this report.'}
          </p>
        ) : null}
        {!mayEdit && report.status === 'issued' ? (
          <p className="text-mini text-ink-muted">Issued, and not edited. A lead or signer opens a revision to change figures.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function LedgerRow({
  row,
  currency,
  mayEdit,
  busy,
  onSave,
  onRemove,
}: {
  row: CostReportPackageRow;
  currency: DdProject['currency'];
  mayEdit: boolean;
  busy: boolean;
  onSave: (patch: Parameters<typeof workspaceApi.updateCostReportRow>[3]) => void;
  onRemove: () => void;
}) {
  const [budget, setBudget] = useState(String(row.budget));
  const [po, setPo] = useState(String(row.poIssued));
  const [paid, setPaid] = useState(String(row.amountPaid));
  const [anticipated, setAnticipated] = useState(String(row.anticipatedCost));
  // Certified to date is a figure a report may not state: empty is none, and is kept as none.
  const [certified, setCertified] = useState(row.certified === undefined ? '' : String(row.certified));

  const certifiedTyped = certified.trim() ? parseMoney(certified) : null;
  const dirty =
    Number(budget) !== row.budget || Number(po) !== row.poIssued || Number(paid) !== row.amountPaid || Number(anticipated) !== row.anticipatedCost || (certifiedTyped ?? undefined) !== row.certified;

  function commit() {
    const b = parseMoney(budget);
    const p = parseMoney(po);
    const a = parseMoney(paid);
    const ant = parseMoney(anticipated);
    if (b === undefined || p === undefined || a === undefined || ant === undefined || certifiedTyped === undefined) return;
    onSave({ budget: b, poIssued: p, amountPaid: a, anticipatedCost: ant, ...((certifiedTyped ?? undefined) !== row.certified ? { certified: certifiedTyped } : {}) });
  }

  const said = rowSaid(row);
  const name = (
    <td className="py-1.5 pr-2 text-ink">
      {packageLabel(row)}
      {said ? <span className="block text-[12px] text-ink-muted">{said}</span> : null}
    </td>
  );

  if (!mayEdit) {
    return (
      <tr className="border-b border-hairline/70">
        {name}
        <td className="py-1.5 pr-2 text-right tabular-nums">{money(row.budget, currency)}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{money(row.poIssued, currency)}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{row.certified === undefined ? '' : money(row.certified, currency)}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{money(row.amountPaid, currency)}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{money(row.anticipatedCost, currency)}</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-hairline/70">
      {name}
      {(
        [
          [budget, setBudget],
          [po, setPo],
          [certified, setCertified],
          [paid, setPaid],
          [anticipated, setAnticipated],
        ] as const
      ).map(([value, setValue], i) => (
        <td key={i} className="py-1 pr-2">
          <Input
            value={value}
            inputMode="decimal"
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (dirty) commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="ml-auto w-24 text-right tabular-nums"
          />
        </td>
      ))}
      <td className="py-1.5">
        <button type="button" disabled={busy} className="text-mini text-ink-muted hover:text-[var(--status-critical-text)]" onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  );
}
