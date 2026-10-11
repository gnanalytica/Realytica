/**
 * RA bills on the cost register: contracts, bills, line certification,
 * bill certificates, and payments — wired to cost.ts mutators.
 */

import { useMemo, useState } from 'react';
import {
  billLineStatus,
  billPosition,
  costRegister,
  costSummary,
  moneySaid,
  standingCertification,
  type CostBill,
  type CostContract,
  type DdProject,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Input, cn, useToast } from '../ui/kit';

function money(amount: number, currency: DdProject['currency']): string {
  return moneySaid(amount, currency);
}

export function CostBillsPanel({
  project,
  mayEdit,
  mayDecide,
  onChanged,
}: {
  project: DdProject;
  mayEdit: boolean;
  mayDecide: boolean;
  onChanged: (p: DdProject) => void;
}) {
  const toast = useToast();
  const me = useMe();
  const register = costRegister(project);
  const summary = costSummary(project);
  const [busy, setBusy] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [contractor, setContractor] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [billContractId, setBillContractId] = useState(register.contracts[0]?.id ?? '');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineDesc, setLineDesc] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [linePackageId, setLinePackageId] = useState('');
  const [expandedBill, setExpandedBill] = useState<string | null>(null);

  const packages = register.workPackages;
  const contracts = register.contracts;
  const bills = useMemo(
    () => [...register.bills].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    [register.bills],
  );

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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Register summary"
          subtitle="Committed, certified and paid across contracts and bills"
          action={
            <dl className="flex flex-wrap gap-3 text-right text-[12px]">
              {[
                ['Committed', summary.committed],
                ['Certified', summary.certified],
                ['Paid', summary.paid],
              ].map(([label, amount]) => (
                <div key={label as string}>
                  <dt className="text-micro text-ink-muted">{label}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{money(amount as number, project.currency)}</dd>
                </div>
              ))}
            </dl>
          }
        />
      </Card>

      <Card>
        <CardHeader
          title="Contracts"
          subtitle="Purchase orders / awards against work packages"
          action={
            mayEdit ? (
              <Button size="sm" onClick={() => setShowContract((v) => !v)}>
                {showContract ? 'Cancel' : 'Add contract'}
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-3">
          {showContract && mayEdit ? (
            <div className="space-y-2 rounded-lg bg-sunken p-2.5">
              <div className="flex flex-wrap gap-2">
                <label className="min-w-[10rem] flex-1 text-[12px] text-ink-secondary">
                  Contractor
                  <Input value={contractor} onChange={(e) => setContractor(e.target.value)} className="mt-1" />
                </label>
                <label className="min-w-[10rem] flex-1 text-[12px] text-ink-secondary">
                  Title
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
                </label>
                <label className="text-[12px] text-ink-secondary">
                  Value
                  <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="mt-1 w-32" />
                </label>
              </div>
              {packages.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {packages.map((p) => {
                    const on = packageIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPackageIds((ids) => (on ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
                        className={cn(
                          'rounded-md px-2 py-0.5 text-[12px] ring-1 ring-inset',
                          on ? 'bg-brand-soft text-brand ring-brand/30' : 'text-ink-secondary ring-[var(--ring)]',
                        )}
                      >
                        {[p.code, p.name].filter(Boolean).join(' · ')}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12px] text-ink-muted">Add packages on the Cost Report ledger first so a contract can cover them.</p>
              )}
              <Button
                size="sm"
                loading={busy}
                onClick={() => {
                  const n = Number(value.replace(/[, ]/g, ''));
                  if (!contractor.trim() || !title.trim() || !(n > 0)) {
                    toast('Name the contractor, title and a value above zero.', 'critical');
                    return;
                  }
                  void run('Could not add the contract', () =>
                    workspaceApi.addCostContract(project.id, {
                      contractor: contractor.trim(),
                      title: title.trim(),
                      value: n,
                      workPackageIds: packageIds,
                    }),
                  ).then(() => {
                    setContractor('');
                    setTitle('');
                    setValue('');
                    setPackageIds([]);
                    setShowContract(false);
                  });
                }}
              >
                Save contract
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-hairline">
            {contracts.map((c: CostContract) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <div>
                  <p className="font-medium text-ink">
                    {c.contractor} · {c.title}
                  </p>
                  <p className="text-mini text-ink-muted">
                    {money(c.value, project.currency)}
                    {c.workPackageIds.length ? ` · ${c.workPackageIds.length} package${c.workPackageIds.length === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                {mayDecide ? (
                  <button
                    type="button"
                    className="text-mini text-ink-muted hover:text-[var(--status-critical-text)]"
                    onClick={() => void run('Could not remove', () => workspaceApi.removeCostContract(project.id, c.id))}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {!contracts.length ? <p className="text-[13px] text-ink-muted">No contracts yet.</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Running bills" subtitle="RA bills, line decisions, certificates and payments" />
        <CardBody className="space-y-4">
          {mayEdit && contracts.length ? (
            <div className="space-y-2 rounded-lg bg-sunken p-2.5">
              <p className="text-[12px] font-medium text-ink">New bill</p>
              <div className="flex flex-wrap gap-2">
                <label className="text-[12px] text-ink-secondary">
                  Contract
                  <select
                    value={billContractId}
                    onChange={(e) => setBillContractId(e.target.value)}
                    className="mt-1 block h-9 rounded-lg bg-surface px-2 text-[13px] ring-1 ring-inset ring-[var(--ring)]"
                  >
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.contractor} — {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-ink-secondary">
                  Number
                  <Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} className="mt-1 w-28" placeholder="RA-1" />
                </label>
                <label className="text-[12px] text-ink-secondary">
                  Date
                  <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="mt-1 w-36" />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="min-w-[12rem] flex-1 text-[12px] text-ink-secondary">
                  First line
                  <Input value={lineDesc} onChange={(e) => setLineDesc(e.target.value)} className="mt-1" placeholder="Description" />
                </label>
                <label className="text-[12px] text-ink-secondary">
                  Amount
                  <Input value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} inputMode="decimal" className="mt-1 w-28" />
                </label>
                {packages.length ? (
                  <label className="text-[12px] text-ink-secondary">
                    Package
                    <select
                      value={linePackageId}
                      onChange={(e) => setLinePackageId(e.target.value)}
                      className="mt-1 block h-9 rounded-lg bg-surface px-2 text-[13px] ring-1 ring-inset ring-[var(--ring)]"
                    >
                      <option value="">—</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {[p.code, p.name].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <Button
                size="sm"
                loading={busy}
                onClick={() => {
                  const amt = Number(lineAmount.replace(/[, ]/g, ''));
                  if (!billContractId || !billNumber.trim() || !lineDesc.trim() || !Number.isFinite(amt)) {
                    toast('Give contract, number, date, line description and amount.', 'critical');
                    return;
                  }
                  void run('Could not add the bill', () =>
                    workspaceApi.addCostBill(project.id, {
                      contractId: billContractId,
                      number: billNumber.trim(),
                      date: billDate,
                      lines: [
                        {
                          description: lineDesc.trim(),
                          amount: amt,
                          readBy: 'person',
                          ...(linePackageId ? { workPackageId: linePackageId } : {}),
                        },
                      ],
                    }),
                  ).then(() => {
                    setBillNumber('');
                    setLineDesc('');
                    setLineAmount('');
                  });
                }}
              >
                Add bill
              </Button>
            </div>
          ) : null}

          {bills.map((bill) => (
            <BillCard
              key={bill.id}
              project={project}
              bill={bill}
              contract={contracts.find((c) => c.id === bill.contractId)}
              expanded={expandedBill === bill.id}
              onToggle={() => setExpandedBill((id) => (id === bill.id ? null : bill.id))}
              mayEdit={mayEdit}
              mayDecide={mayDecide}
              busy={busy}
              meEmail={me?.email}
              onRun={run}
            />
          ))}
          {!bills.length ? <p className="text-[13px] text-ink-muted">No running bills yet.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}

function BillCard({
  project,
  bill,
  contract,
  expanded,
  onToggle,
  mayEdit,
  mayDecide,
  busy,
  meEmail,
  onRun,
}: {
  project: DdProject;
  bill: CostBill;
  contract?: CostContract;
  expanded: boolean;
  onToggle: () => void;
  mayEdit: boolean;
  mayDecide: boolean;
  busy: boolean;
  meEmail?: string;
  onRun: (label: string, work: () => Promise<{ project: DdProject }>) => Promise<void>;
}) {
  const toast = useToast();
  const position = billPosition(bill);
  const certificate = standingCertification(bill);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [certDate, setCertDate] = useState(new Date().toISOString().slice(0, 10));

  return (
    <div className="rounded-xl ring-1 ring-inset ring-[var(--ring)]">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left">
        <div>
          <p className="text-[13px] font-semibold text-ink">
            {contract?.contractor ?? 'Bill'} · {bill.number}
          </p>
          <p className="text-mini text-ink-muted">
            {bill.date} · claimed {money(position.claimed, project.currency)}
            {certificate ? ` · certified ${money(certificate.net, project.currency)} net` : ''}
          </p>
        </div>
        <Badge tone={certificate ? 'good' : position.status === 'in_review' ? 'warning' : 'neutral'}>{position.status.replace('_', ' ')}</Badge>
      </button>
      {expanded ? (
        <div className="space-y-3 border-t border-hairline px-3 py-3">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="text-micro uppercase tracking-[0.04em] text-ink-muted">
                <th className="py-1 pr-2 font-medium">Line</th>
                <th className="py-1 pr-2 text-right font-medium">Claimed</th>
                <th className="py-1 pr-2 text-right font-medium">Passed</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => {
                const status = billLineStatus(line, bill);
                return (
                  <tr key={line.id} className="border-t border-hairline/70">
                    <td className="py-1.5 pr-2 text-ink">
                      {line.item ? `${line.item} · ` : ''}
                      {line.description}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(line.amount, project.currency)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {line.certified ? money(line.certified.amount, project.currency) : '—'}
                    </td>
                    <td className="py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-mini text-ink-secondary">{status}</span>
                        {mayEdit && !certificate && status === 'claimed' ? (
                          <Button
                            size="sm"
                            loading={busy}
                            onClick={() =>
                              void onRun('Could not certify the line', () =>
                                workspaceApi.certifyCostBillLine(project.id, bill.id, line.id, { amount: line.amount }),
                              )
                            }
                          >
                            Pass as claimed
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!certificate && mayDecide && bill.lines.every((l) => l.certified) ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-ink-secondary">
                Certified on
                <Input type="date" value={certDate} onChange={(e) => setCertDate(e.target.value)} className="mt-1 w-36" />
              </label>
              <Button
                size="sm"
                loading={busy}
                onClick={() => {
                  if (!meEmail) {
                    toast('Sign in to issue a certificate.', 'critical');
                    return;
                  }
                  void onRun('Could not issue the certificate', () =>
                    workspaceApi.certifyCostBill(project.id, bill.id, {
                      signer: { email: meEmail, profession: 'Quantity Surveyor' },
                      certifiedOn: certDate,
                    }),
                  );
                }}
              >
                Issue certificate
              </Button>
            </div>
          ) : null}

          {certificate && mayDecide ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy}
              onClick={() => void onRun('Could not withdraw', () => workspaceApi.withdrawCostBillCertification(project.id, bill.id, 'Reopened for correction'))}
            >
              Withdraw certificate
            </Button>
          ) : null}

          {mayEdit ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-2">
              <label className="text-[12px] text-ink-secondary">
                Payment
                <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" className="mt-1 w-28" />
              </label>
              <label className="text-[12px] text-ink-secondary">
                Paid on
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 w-36" />
              </label>
              <Button
                size="sm"
                loading={busy}
                onClick={() => {
                  const n = Number(payAmount.replace(/[, ]/g, ''));
                  if (!(n > 0)) {
                    toast('Payment must be above zero.', 'critical');
                    return;
                  }
                  void onRun('Could not record payment', () =>
                    workspaceApi.recordCostPayment(project.id, bill.id, { amount: n, paidOn: payDate }),
                  ).then(() => setPayAmount(''));
                }}
              >
                Record payment
              </Button>
            </div>
          ) : null}

          {bill.payments.filter((p) => !p.voided).length ? (
            <ul className="text-[12px] text-ink-secondary">
              {bill.payments
                .filter((p) => !p.voided)
                .map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-0.5">
                    <span>
                      {money(p.amount, project.currency)} on {p.paidOn}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </span>
                    {mayDecide ? (
                      <button
                        type="button"
                        className="text-mini text-ink-muted hover:text-[var(--status-critical-text)]"
                        onClick={() =>
                          void onRun('Could not void', () => workspaceApi.voidCostPayment(project.id, bill.id, p.id, 'Entered wrongly'))
                        }
                      >
                        Void
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
