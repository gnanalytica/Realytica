/**
 * Rows a cost report filed as a paper offers to the Cost Report.
 *
 * A consultant's monthly cost report dropped on the project has its tables
 * read, and each package row is offered here with the page it is on. Nothing
 * offered is on the ledger: a lead or signer of Finance accepts a row, or all
 * the rows of a page, and may correct a cell first. A row whose figures could
 * not be put in their columns shows the page's own line to type from, and a
 * row a model read that was not found among the page's words says so.
 *
 * Where no row could be read because the tables are pictures, it says that in
 * one line and opens the paste import with the PDF beside it.
 */

import { useState } from 'react';
import { costPaperSaid, costPapersOf, formatMoneyInFull, type CostOfferCorrection, type CostPaper, type CostReportPeriod, type CostRowOffer, type DdProject } from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { Badge, Button, Card, CardBody, CardHeader, Input, useToast } from '../ui/kit';
import { LedgerImport, type PaperBeside } from './LedgerImport';

const CELLS = [
  { key: 'budget', label: 'Budget' },
  { key: 'poIssued', label: 'Awarded or PO' },
  { key: 'certified', label: 'Certified' },
  { key: 'amountPaid', label: 'Paid' },
  { key: 'anticipatedCost', label: 'Anticipated' },
  { key: 'variations', label: 'Variations' },
] as const;
type CellKey = (typeof CELLS)[number]['key'];

const READER_SAID: Record<CostRowOffer['reader'], string> = { text: 'read from the page’s text', ocr: 'read by OCR', model: 'read by a model' };

/** A figure as typed: digits with commas or spaces. Empty is no figure, and undefined is not a figure. */
function typed(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[,\s₹]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function CostPapers({ project, report, mayDecide, mayEdit, modelSetUp, onChanged }: { project: DdProject; report: CostReportPeriod | null; mayDecide: boolean; mayEdit: boolean; modelSetUp: boolean; onChanged: (p: DdProject) => void }) {
  const papers = costPapersOf(project).filter((paper) => project.evidence.some((row) => row.id === paper.evidenceId));
  const waiting = papers.filter((paper) => paper.offers.some((offer) => offer.status === 'offered') || costPaperSaid(paper, modelSetUp));
  if (!waiting.length) return null;
  return (
    <>
      {waiting.map((paper) => (
        <PaperOffers key={paper.evidenceId} project={project} paper={paper} report={report} mayDecide={mayDecide} mayEdit={mayEdit} modelSetUp={modelSetUp} onChanged={onChanged} />
      ))}
    </>
  );
}

function PaperOffers({ project, paper, report, mayDecide, mayEdit, modelSetUp, onChanged }: { project: DdProject; paper: CostPaper; report: CostReportPeriod | null; mayDecide: boolean; mayEdit: boolean; modelSetUp: boolean; onChanged: (p: DdProject) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const row = project.evidence.find((held) => held.id === paper.evidenceId)!;
  const file = row.attachments[row.attachments.length - 1];
  const draft = report?.status === 'draft' ? report : null;
  const said = costPaperSaid(paper, modelSetUp);
  const offered = paper.offers.filter((offer) => offer.status === 'offered');
  const pages = [...new Set(offered.map((offer) => offer.page))].sort((a, b) => a - b);
  const currency = project.currency;

  async function run(work: () => Promise<{ project: DdProject }>, failed: string) {
    setBusy(true);
    try {
      onChanged((await work()).project);
    } catch (e) {
      toast(e instanceof Error ? e.message : failed, 'critical');
    } finally {
      setBusy(false);
    }
  }

  if (said) {
    const beside: PaperBeside | undefined = file ? { evidenceId: row.id, fileId: file.id, title: row.title } : undefined;
    return (
      <div className="space-y-2">
        <Card>
          <CardHeader title={row.title} subtitle="A cost report on the register" />
          <CardBody>
            <p className="text-[13px] text-ink">{said}</p>
          </CardBody>
        </Card>
        {draft && mayEdit ? <LedgerImport project={project} report={draft} onChanged={onChanged} beside={beside} /> : <p className="text-[13px] text-ink-secondary">Start a Cost Report for the month to paste the table into.</p>}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader title={`Offered by ${row.title}`} subtitle={`${offered.length === 1 ? '1 row' : `${offered.length} rows`} read from the report’s tables. None is on the ledger until it is accepted.`} />
      <CardBody className="space-y-4">
        {!draft ? <p className="text-[13px] text-ink-secondary">Start a Cost Report for the month, or open a revision, to accept these rows onto it.</p> : null}
        {draft && !mayDecide ? <p className="text-[13px] text-ink-secondary">A lead or signer of Finance accepts these.</p> : null}
        {pages.map((page) => {
          const on = paper.pages.find((held) => held.page === page);
          const rows = offered.filter((offer) => offer.page === page);
          const off = on?.checks.filter((check) => check.difference !== 0) ?? [];
          return (
            <section key={page} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-semibold text-ink">
                  Page {page}
                  <span className="ml-1.5 font-normal text-ink-secondary">{READER_SAID[rows[0]!.reader]}</span>
                </p>
                {on?.addsUp === true ? <Badge tone="good">Adds up to the page’s total</Badge> : null}
                {on?.addsUp === false ? <Badge tone="warning">Does not add up to the page’s total</Badge> : null}
                {draft && mayDecide ? (
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const out = await workspaceApi.acceptCostOffersOnPage(project.id, draft.id, paper.evidenceId, page);
                        toast(out.left ? `${out.accepted} accepted. ${out.left} left for you to look at.` : `${out.accepted} accepted.`, 'good');
                        return out;
                      }, 'Could not accept the rows of that page')
                    }
                  >
                    Accept all on this page
                  </Button>
                ) : null}
              </div>
              {off.length ? (
                <p className="text-[12px] text-[var(--status-warning-text)]">
                  {off.map((check) => `The rows read come to ${formatMoneyInFull(check.taken, currency)} and the page’s total is ${formatMoneyInFull(check.stated, currency)}`).join('; ')}. A row may have been misread: check each against the page.
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-hairline text-micro uppercase tracking-[0.04em] text-ink-muted">
                      <th className="py-1 pr-2 font-medium">Package</th>
                      {CELLS.map((cell) => (
                        <th key={cell.key} className="py-1 pr-2 text-right font-medium">
                          {cell.label}
                        </th>
                      ))}
                      <th className="py-1 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((offer) => (
                      <OfferRow
                        key={offer.id}
                        offer={offer}
                        currency={currency}
                        mayDecide={Boolean(draft) && mayDecide}
                        busy={busy}
                        onAccept={(corrected) => void run(() => workspaceApi.acceptCostOffer(project.id, draft!.id, paper.evidenceId, offer.id, corrected), 'Could not accept that row')}
                        onSetAside={() => void run(() => workspaceApi.setAsideCostOffer(project.id, paper.evidenceId, offer.id), 'Could not set that row aside')}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </CardBody>
    </Card>
  );
}

function OfferRow({ offer, currency, mayDecide, busy, onAccept, onSetAside }: { offer: CostRowOffer; currency: DdProject['currency']; mayDecide: boolean; busy: boolean; onAccept: (corrected: CostOfferCorrection) => void; onSetAside: () => void }) {
  const toast = useToast();
  const asRead = (key: CellKey): string => (offer.cells[key] === undefined ? '' : String(offer.cells[key]));
  const [cells, setCells] = useState<Record<CellKey, string>>(() => Object.fromEntries(CELLS.map((cell) => [cell.key, asRead(cell.key)])) as Record<CellKey, string>);
  const flagged = offer.unplaced || offer.problems?.length || offer.proof === 'unverified';

  function accept() {
    const corrected: CostOfferCorrection = {};
    for (const { key, label } of CELLS) {
      if (cells[key] === asRead(key)) continue;
      const amount = typed(cells[key]);
      if (amount === undefined) {
        toast(`${label} is a figure: digits, with commas if you like.`, 'critical');
        return;
      }
      if (amount !== null) corrected[key] = amount;
    }
    onAccept(corrected);
  }

  return (
    <>
      <tr className={flagged ? '' : 'border-b border-hairline/70'}>
        <td className="py-1 pr-2 text-ink">
          {offer.cells.name}
          {offer.cells.awardedTo ? <span className="ml-1.5 text-ink-muted">to {offer.cells.awardedTo}</span> : null}
          {offer.cells.kind ? <span className="ml-1.5 text-ink-muted">{offer.cells.kind === 'fee' ? 'Fee' : 'Contingency'}</span> : null}
        </td>
        {CELLS.map(({ key, label }) => (
          <td key={key} className="py-1 pr-2 text-right tabular-nums text-ink">
            {mayDecide ? (
              <Input value={cells[key]} inputMode="decimal" aria-label={`${label} of ${offer.cells.name}`} disabled={busy} onChange={(e) => setCells((held) => ({ ...held, [key]: e.target.value }))} className="ml-auto w-28 text-right tabular-nums" />
            ) : offer.cells[key] === undefined ? (
              ''
            ) : (
              formatMoneyInFull(offer.cells[key]!, currency)
            )}
          </td>
        ))}
        <td className="py-1 whitespace-nowrap">
          {mayDecide ? (
            <span className="flex gap-1.5">
              <Button size="sm" disabled={busy} onClick={accept}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onSetAside}>
                Not this
              </Button>
            </span>
          ) : null}
        </td>
      </tr>
      {flagged ? (
        <tr className="border-b border-hairline/70">
          <td colSpan={CELLS.length + 2} className="pb-1.5 text-[12px] text-[var(--status-warning-text)]">
            {offer.unplaced ? 'Its figures could not be put in their columns. Type them from the page’s line: ' : offer.proof === 'unverified' ? 'A model read this row and its figures were not found among the words read on that page. Check it against the page: ' : `${(offer.problems ?? []).join(' ')} The page’s line: `}
            <span className="font-mono text-ink-secondary">{offer.quote}</span>
          </td>
        </tr>
      ) : null}
    </>
  );
}
