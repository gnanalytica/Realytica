/**
 * Cost Report: what moved since the report issued before this one, and why.
 *
 * Total forecast then and now, the three largest package movements with what
 * accounts for each, what nothing accounts for, and the decisions the figures
 * ask for. The desk and the printed report read the same comparison.
 */

import { useState } from 'react';
import {
  costReportChanges,
  largestCostMovements,
  moneySaid,
  type CostReportChangeCause,
  type CostReportComparison,
  type CostReportPackageChange,
  type CostReportPeriod,
  type DdProject,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { Badge, Card, CardBody, CardHeader, Input, cn, useToast } from '../ui/kit';

type Currency = DdProject['currency'];

const NO_EARLIER_REPORT = 'No earlier issued report to compare with.';

/** A change, with its direction written: +₹1,200 or −₹1,200. */
function signed(amount: number, currency: Currency): string {
  return `${amount > 0 ? '+' : ''}${moneySaid(amount, currency)}`;
}

function packageLabel(pack: { code?: string; name: string }): string {
  return [pack.code, pack.name].filter(Boolean).join(' · ');
}

function causeSaid(cause: CostReportChangeCause, currency: Currency): string {
  return cause.kind === 'variation'
    ? `Variation: ${cause.description}${cause.contingencyDrawn ? ' (contingency)' : ''}`
    : `Awarded at ${moneySaid(cause.poIssued, currency)}`;
}

/** What accounts for a package's movement, a line each, with the amount it accounts for. */
function accountOf(change: CostReportPackageChange, currency: Currency): Array<{ said: string; amount?: number; unexplained?: boolean }> {
  const lines: Array<{ said: string; amount?: number; unexplained?: boolean }> = [];
  if (change.status === 'added') lines.push({ said: 'New package' });
  if (change.status === 'removed') lines.push({ said: 'No longer on the report' });
  for (const cause of change.causes) lines.push({ said: causeSaid(cause, currency), amount: cause.amount });
  if (change.unexplained !== 0) lines.push({ said: 'Unexplained', amount: change.unexplained, unexplained: true });
  return lines;
}

function decisionLines(comparison: CostReportComparison, currency: Currency): string[] {
  const { overBudget, unawarded } = comparison.decisions;
  return [
    ...(overBudget.length ? [`Over budget: ${overBudget.map((p) => `${packageLabel(p)} by ${moneySaid(p.over, currency)}`).join(', ')}`] : []),
    ...(unawarded.length ? [`Not awarded: ${unawarded.map(packageLabel).join(', ')}`] : []),
  ];
}

function billedSaid(comparison: CostReportComparison, currency: Currency): string | null {
  const billed = comparison.billed;
  if (!billed) return null;
  const waiting = billed.awaitingCertificate ? `, ${billed.awaitingCertificate} of ${billed.bills} not yet certified` : '';
  return `Bills: claimed ${moneySaid(billed.claimed, currency)}, certified ${moneySaid(billed.certified, currency)}, difference ${moneySaid(billed.difference, currency)}${waiting}`;
}

/** Every package with an unexplained amount, each with its own: they are not netted against each other. */
function unexplainedSaid(comparison: CostReportComparison, currency: Currency): string | null {
  const left = comparison.packages.filter((p) => p.unexplained !== 0);
  return left.length ? `Unexplained: ${left.map((p) => `${packageLabel(p)} ${signed(p.unexplained, currency)}`).join(', ')}` : null;
}

function looseVariationsSaid(comparison: CostReportComparison, currency: Currency): string | null {
  const loose = comparison.unassignedVariations;
  if (!loose.length) return null;
  const amount = loose.reduce((total, v) => total + v.amount, 0);
  return `Variations against no package: ${signed(amount, currency)}`;
}

export function SinceLastReport({
  project,
  report,
  mayEdit,
  onChanged,
}: {
  project: DdProject;
  report: CostReportPeriod;
  mayEdit: boolean;
  onChanged: (p: DdProject) => void;
}) {
  const comparison = costReportChanges(project, report.id);
  const currency = project.currency;

  if (!comparison) {
    return (
      <Card>
        <CardHeader title="Since last report" />
        <CardBody>
          <p className="text-[13px] text-ink-muted">{NO_EARLIER_REPORT}</p>
        </CardBody>
      </Card>
    );
  }

  const forecast = comparison.totals.figures.anticipatedCost;
  const against = comparison.totals.forecastAgainstBudget;
  const largest = largestCostMovements(comparison, 3);
  const rest = largestCostMovements(comparison, comparison.packages.length).slice(largest.length);
  const decisions = decisionLines(comparison, currency);
  const billed = billedSaid(comparison, currency);
  const unexplained = unexplainedSaid(comparison, currency);
  const loose = looseVariationsSaid(comparison, currency);
  const row = (change: CostReportPackageChange) => (
    <MovementRow
      key={`${change.workPackageId}:${change.reason ?? ''}`}
      project={project}
      report={report}
      change={change}
      mayEdit={mayEdit}
      onChanged={onChanged}
    />
  );

  return (
    <Card>
      <CardHeader title="Since last report" subtitle={`${comparison.previous.label} to ${comparison.current.label}`} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Forecast then', moneySaid(forecast.previous, currency)],
            ['Forecast now', moneySaid(forecast.current, currency)],
            ['Change', signed(forecast.change, currency)],
            ['Against budget', signed(against.current, currency)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-sunken px-2.5 py-2">
              <p className="text-micro text-ink-muted">{label}</p>
              <p className="text-[14px] font-semibold tabular-nums text-ink">{value}</p>
            </div>
          ))}
        </div>

        {largest.length ? <ul>{largest.map(row)}</ul> : <p className="text-[13px] text-ink-muted">No package moved.</p>}
        {rest.length ? (
          <details>
            <summary className="cursor-pointer text-[12px] text-ink-secondary">{rest.length} more</summary>
            <ul>{rest.map(row)}</ul>
          </details>
        ) : null}

        {comparison.totals.certified ? (
          <p className="text-[13px] text-ink-secondary">
            Certified to date: {moneySaid(comparison.totals.certified.previous, currency)} then, {moneySaid(comparison.totals.certified.current, currency)} now, {signed(comparison.totals.certified.change, currency)}
          </p>
        ) : null}
        {unexplained ? <p className="text-[13px] text-[var(--status-warning-text)]">{unexplained}</p> : null}
        {loose ? <p className="text-[13px] text-ink-secondary">{loose}</p> : null}
        {billed ? <p className="text-[13px] text-ink-secondary">{billed}</p> : null}

        <div>
          <p className="text-micro uppercase tracking-[0.04em] text-ink-muted">Decisions needed</p>
          {decisions.length ? (
            decisions.map((line) => (
              <p key={line} className="text-[13px] text-ink">
                {line}
              </p>
            ))
          ) : (
            <p className="text-[13px] text-ink-muted">None.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function MovementRow({
  project,
  report,
  change,
  mayEdit,
  onChanged,
}: {
  project: DdProject;
  report: CostReportPeriod;
  change: CostReportPackageChange;
  mayEdit: boolean;
  onChanged: (p: DdProject) => void;
}) {
  const toast = useToast();
  const currency = project.currency;
  const [reason, setReason] = useState(change.reason ?? '');
  const [busy, setBusy] = useState(false);
  const anticipated = change.figures.anticipatedCost;

  async function save() {
    if (reason.trim() === (change.reason ?? '')) return;
    setBusy(true);
    try {
      onChanged((await workspaceApi.setCostReportChangeReason(project.id, report.id, change.workPackageId, reason.trim() || null)).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the reason', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-1 border-b border-hairline/70 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[13px] text-ink">
          {packageLabel(change)}
          {change.status === 'added' ? <Badge className="ml-2">Added</Badge> : null}
          {change.status === 'removed' ? <Badge className="ml-2">Removed</Badge> : null}
        </p>
        <p className="text-[13px] font-semibold tabular-nums text-ink">{signed(anticipated.change, currency)}</p>
      </div>
      {accountOf(change, currency).map((line, at) => (
        <div
          key={at}
          className={cn('flex items-baseline justify-between gap-3 text-[12px]', line.unexplained ? 'text-[var(--status-warning-text)]' : 'text-ink-secondary')}
        >
          <span>{line.said}</span>
          {line.amount !== undefined ? <span className="tabular-nums">{signed(line.amount, currency)}</span> : null}
        </div>
      ))}
      {mayEdit ? (
        <Input
          value={reason}
          aria-label={`Reason for ${change.name}`}
          placeholder="Reason"
          maxLength={240}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      ) : change.reason ? (
        <p className="text-[12px] text-ink">{change.reason}</p>
      ) : null}
    </li>
  );
}

/** The same block on the printed Cost Report. */
export function SinceLastReportPrint({ project, report }: { project: DdProject; report: CostReportPeriod }) {
  const comparison = costReportChanges(project, report.id);
  const currency = project.currency;
  if (!comparison) return <p className="text-[12px] text-black/60">{NO_EARLIER_REPORT}</p>;

  const forecast = comparison.totals.figures.anticipatedCost;
  const largest = largestCostMovements(comparison, 3);
  const decisions = decisionLines(comparison, currency);
  const billed = billedSaid(comparison, currency);
  const unexplained = unexplainedSaid(comparison, currency);
  const loose = looseVariationsSaid(comparison, currency);

  return (
    <div className="space-y-6 text-[12px]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black/30">
            <th className="py-1.5 pr-3 font-semibold">Forecast</th>
            <th className="py-1.5 pr-3 text-right font-semibold">{comparison.previous.label}</th>
            <th className="py-1.5 pr-3 text-right font-semibold">{comparison.current.label}</th>
            <th className="py-1.5 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-black/10">
            <td className="py-1.5 pr-3">Anticipated cost</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{moneySaid(forecast.previous, currency)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{moneySaid(forecast.current, currency)}</td>
            <td className="py-1.5 text-right tabular-nums">{signed(forecast.change, currency)}</td>
          </tr>
          <tr className="border-b border-black/10">
            <td className="py-1.5 pr-3">Against budget</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{signed(comparison.totals.forecastAgainstBudget.previous, currency)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{signed(comparison.totals.forecastAgainstBudget.current, currency)}</td>
            <td className="py-1.5 text-right tabular-nums">{signed(comparison.totals.forecastAgainstBudget.change, currency)}</td>
          </tr>
        </tbody>
      </table>

      {largest.length ? (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black/30">
              <th className="py-1.5 pr-3 font-semibold">Largest movements</th>
              <th className="py-1.5 pr-3 font-semibold">Why</th>
              <th className="py-1.5 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {largest.map((change) => (
              <tr key={change.workPackageId} className="border-b border-black/10 align-top">
                <td className="py-1.5 pr-3">{packageLabel(change)}</td>
                <td className="py-1.5 pr-3">
                  {accountOf(change, currency).map((line, at) => (
                    <p key={at}>
                      {line.said}
                      {line.amount !== undefined ? ` ${signed(line.amount, currency)}` : ''}
                    </p>
                  ))}
                  {change.reason ? <p className="text-black/80">{change.reason}</p> : null}
                </td>
                <td className="py-1.5 text-right tabular-nums">{signed(change.figures.anticipatedCost.change, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-black/60">No package moved.</p>
      )}

      <div className="space-y-1">
        {unexplained ? <p>{unexplained}</p> : null}
        {loose ? <p>{loose}</p> : null}
        {billed ? <p>{billed}</p> : null}
      </div>

      <div>
        <p className="font-semibold">Decisions needed</p>
        {decisions.length ? decisions.map((line) => <p key={line}>{line}</p>) : <p className="text-black/60">None.</p>}
      </div>
    </div>
  );
}
