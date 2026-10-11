/**
 * Cost Report sections beyond the package ledger: variation log, basic price
 * adjustments, progress photographs, and CSV/Excel intake.
 */

import { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  moneySaid,
  projectPhotos,
  type CostReportBasicPrice,
  type CostReportPeriod,
  type CostReportVariation,
  type DdProject,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Input, cn, useToast } from '../ui/kit';

function money(amount: number, currency: DdProject['currency']): string {
  return moneySaid(amount, currency);
}

export function CostReportExtras({
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
  return (
    <div className="space-y-4">
      <VariationLog project={project} report={report} mayEdit={mayEdit} onChanged={onChanged} />
      <BasicPriceSheet project={project} report={report} mayEdit={mayEdit} onChanged={onChanged} />
      <ProgressPhotos project={project} report={report} mayEdit={mayEdit} onChanged={onChanged} />
      {mayEdit ? <LedgerImport project={project} report={report} onChanged={onChanged} /> : null}
    </div>
  );
}

function VariationLog({
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [contingency, setContingency] = useState(false);
  const rows = report.variations ?? [];
  const total = rows.reduce((s, r) => s + r.amount, 0);

  async function add() {
    const n = Number(amount.replace(/[, ]/g, ''));
    if (!description.trim() || !Number.isFinite(n)) {
      toast('Give a description and an amount.', 'critical');
      return;
    }
    setBusy(true);
    try {
      onChanged(
        (
          await workspaceApi.addCostReportVariation(project.id, report.id, {
            description: description.trim(),
            amount: n,
            contingencyDrawn: contingency,
          })
        ).project,
      );
      setDescription('');
      setAmount('');
      setContingency(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the variation', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Variation log" subtitle="Cause of project cost increment" />
      <CardBody className="space-y-3">
        {mayEdit ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-sunken p-2.5">
            <label className="min-w-[14rem] flex-1 text-[12px] text-ink-secondary">
              Description
              <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
            </label>
            <label className="text-[12px] text-ink-secondary">
              Amount
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-28" />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-secondary">
              <input type="checkbox" checked={contingency} onChange={(e) => setContingency(e.target.checked)} />
              Contingency
            </label>
            <Button size="sm" loading={busy} onClick={() => void add()}>
              Add
            </Button>
          </div>
        ) : null}
        <table className="w-full min-w-[28rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
              <th className="py-1.5 pr-2 font-medium">Description</th>
              <th className="py-1.5 pr-2 font-medium">Drawn from</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
              {mayEdit ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: CostReportVariation) => (
              <tr key={row.id} className="border-b border-hairline/70">
                <td className="py-1.5 pr-2 text-ink">{row.description}</td>
                <td className="py-1.5 pr-2 text-ink-secondary">{row.contingencyDrawn ? 'Contingency' : 'Budget'}</td>
                <td className="py-1.5 text-right tabular-nums">{money(row.amount, project.currency)}</td>
                {mayEdit ? (
                  <td className="py-1.5 pl-2">
                    <button
                      type="button"
                      className="text-mini text-ink-muted hover:text-[var(--status-critical-text)]"
                      onClick={() =>
                        void workspaceApi
                          .removeCostReportVariation(project.id, report.id, row.id)
                          .then((r) => onChanged(r.project), (e: unknown) => toast(e instanceof Error ? e.message : 'Could not remove it', 'critical'))
                      }
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr className="font-semibold">
                <td className="pt-2" colSpan={2}>
                  Total
                </td>
                <td className="pt-2 text-right tabular-nums">{money(total, project.currency)}</td>
                {mayEdit ? <td /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {!rows.length ? <p className="text-[13px] text-ink-muted">No variations logged for this period.</p> : null}
      </CardBody>
    </Card>
  );
}

function BasicPriceSheet({
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState('');
  const [unit, setUnit] = useState('');
  const [tender, setTender] = useState('');
  const [current, setCurrent] = useState('');
  const [qty, setQty] = useState('');
  const rows = report.basicPriceAdjustments ?? [];

  async function add() {
    const t = Number(tender.replace(/[, ]/g, ''));
    const c = Number(current.replace(/[, ]/g, ''));
    const q = qty.trim() ? Number(qty.replace(/[, ]/g, '')) : undefined;
    if (!item.trim() || !Number.isFinite(t) || !Number.isFinite(c)) {
      toast('Give the item and both rates.', 'critical');
      return;
    }
    setBusy(true);
    try {
      onChanged(
        (
          await workspaceApi.addCostReportBasicPrice(project.id, report.id, {
            item: item.trim(),
            ...(unit.trim() ? { unit: unit.trim() } : {}),
            tenderRate: t,
            currentRate: c,
            ...(q !== undefined && Number.isFinite(q) ? { quantity: q } : {}),
          })
        ).project,
      );
      setItem('');
      setUnit('');
      setTender('');
      setCurrent('');
      setQty('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the line', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Basic price adjustments" subtitle="Tender rate versus current rate" />
      <CardBody className="space-y-3 overflow-x-auto">
        {mayEdit ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-sunken p-2.5">
            <label className="min-w-[10rem] flex-1 text-[12px] text-ink-secondary">
              Item
              <Input value={item} onChange={(e) => setItem(e.target.value)} className="mt-1" />
            </label>
            <label className="text-[12px] text-ink-secondary">
              Unit
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 w-20" />
            </label>
            <label className="text-[12px] text-ink-secondary">
              Tender
              <Input value={tender} onChange={(e) => setTender(e.target.value)} inputMode="decimal" className="mt-1 w-24" />
            </label>
            <label className="text-[12px] text-ink-secondary">
              Current
              <Input value={current} onChange={(e) => setCurrent(e.target.value)} inputMode="decimal" className="mt-1 w-24" />
            </label>
            <label className="text-[12px] text-ink-secondary">
              Qty
              <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="mt-1 w-20" />
            </label>
            <Button size="sm" loading={busy} onClick={() => void add()}>
              Add
            </Button>
          </div>
        ) : null}
        <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
              <th className="py-1.5 pr-2 font-medium">Item</th>
              <th className="py-1.5 pr-2 font-medium">Unit</th>
              <th className="py-1.5 pr-2 text-right font-medium">Tender</th>
              <th className="py-1.5 pr-2 text-right font-medium">Current</th>
              <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
              <th className="py-1.5 text-right font-medium">Amount</th>
              {mayEdit ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: CostReportBasicPrice) => (
              <tr key={row.id} className="border-b border-hairline/70">
                <td className="py-1.5 pr-2 text-ink">{row.item}</td>
                <td className="py-1.5 pr-2 text-ink-secondary">{row.unit ?? '—'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(row.tenderRate, project.currency)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(row.currentRate, project.currency)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{row.quantity ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums">{row.amount !== undefined ? money(row.amount, project.currency) : '—'}</td>
                {mayEdit ? (
                  <td className="py-1.5 pl-2">
                    <button
                      type="button"
                      className="text-mini text-ink-muted hover:text-[var(--status-critical-text)]"
                      onClick={() =>
                        void workspaceApi
                          .removeCostReportBasicPrice(project.id, report.id, row.id)
                          .then((r) => onChanged(r.project), (e: unknown) => toast(e instanceof Error ? e.message : 'Could not remove it', 'critical'))
                      }
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="text-[13px] text-ink-muted">No basic price adjustments on this report.</p> : null}
      </CardBody>
    </Card>
  );
}

function ProgressPhotos({
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
  const toast = useToast();
  const selected = new Set(report.photoEvidenceIds ?? []);
  const candidates = useMemo(() => projectPhotos(project, 'construction').filter((p) => p.evidenceId), [project]);

  async function toggle(evidenceId: string) {
    const next = new Set(selected);
    if (next.has(evidenceId)) next.delete(evidenceId);
    else next.add(evidenceId);
    try {
      onChanged((await workspaceApi.patchCostReport(project.id, report.id, { photoEvidenceIds: [...next] })).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update photographs', 'critical');
    }
  }

  const shown = candidates.filter((p) => selected.has(p.evidenceId!));

  return (
    <Card>
      <CardHeader title="Project progress pictures" subtitle="Photographs from the site log / vault for this period" />
      <CardBody className="space-y-3">
        {mayEdit && candidates.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {candidates.map((p) => {
              const id = p.evidenceId!;
              const on = selected.has(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => void toggle(id)}
                    className={cn(
                      'w-full overflow-hidden rounded-lg text-left ring-1 ring-inset',
                      on ? 'ring-brand' : 'ring-[var(--ring)]',
                    )}
                  >
                    <PhotoThumb projectId={project.id} evidenceId={id} fileId={p.fileId!} />
                    <span className="flex items-center justify-between gap-1 px-1.5 py-1 text-micro text-ink-secondary">
                      <span className="truncate">{p.caption || p.title || 'Photo'}</span>
                      {on ? <Badge tone="brand">In report</Badge> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {!mayEdit || !candidates.length ? (
          shown.length ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {shown.map((p) => (
                <li key={p.evidenceId} className="overflow-hidden rounded-lg ring-1 ring-inset ring-[var(--ring)]">
                  <PhotoThumb projectId={project.id} evidenceId={p.evidenceId!} fileId={p.fileId!} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-muted">
              {candidates.length === 0
                ? 'No site photographs on the vault yet — file them from Progress first.'
                : 'No photographs selected for this Cost Report.'}
            </p>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}

function PhotoThumb({ projectId, evidenceId, fileId }: { projectId: string; evidenceId: string; fileId: string }) {
  const { url } = useAuthedUrl(api.evidenceFileUrl(projectId, evidenceId, fileId, { inline: true }));
  return url ? (
    <img src={url} alt="" className="aspect-[4/3] w-full object-cover" />
  ) : (
    <div className="aspect-[4/3] w-full animate-pulse bg-sunken" />
  );
}

function LedgerImport({
  project,
  report,
  onChanged,
}: {
  project: DdProject;
  report: CostReportPeriod;
  onChanged: (p: DdProject) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(input: { file: File } | { text: string }) {
    setBusy(true);
    try {
      const res = await workspaceApi.importCostReport(project.id, report.id, input);
      onChanged(res.project);
      toast(`Imported: ${res.added} added, ${res.updated} updated.`, 'good');
      setText('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not import', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Import ledger" subtitle="CSV, Excel, or a pasted table with Package / Budget / PO / Paid / Anticipated columns" />
      <CardBody className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run({ file });
              e.target.value = '';
            }}
          />
          <Button size="sm" icon={<Upload size={14} />} loading={busy} onClick={() => fileRef.current?.click()}>
            Upload file
          </Button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={'Package,Budget,PO issued,Paid,Anticipated\nCivil,370000000,376000000,269100000,378000000'}
          className="w-full resize-y rounded-lg bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none ring-1 ring-inset ring-[var(--ring)] focus-visible:ring-2 focus-visible:ring-brand"
        />
        <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => void run({ text })}>
          Import pasted table
        </Button>
      </CardBody>
    </Card>
  );
}
