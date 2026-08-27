import { Receipt } from 'lucide-react';
import type { TransactionCostBreakdown } from '@realytica/shared';
import { CostWaterfallChart } from '../../../components/charts';
import type { TabProps } from '../tab-props';
import { StatutoryProvenance } from '../../../components/StatutoryProvenance';
import { money, pct } from '../../../lib/format';
import { Button, Callout, Card, CardBody, CardHeader, EmptyState, Stat } from '../../../components/ui/kit';

/**
 * What buying this actually costs on top of the price.
 *
 * Split out of the compliance view, where it had been sitting at the bottom
 * of thirteen thousand pixels of title checks. It was in the wrong place
 * twice over: a reader who wants to know the all-in number is asking a money
 * question, not a title question, and by the time the duty appeared they had
 * scrolled past every khata finding in the case to reach it.
 */
export default function CostsTab({ caseData, result, runScreen, running }: TabProps) {
  const costs = result?.transactionCosts ?? null;

  if (!result) {
    return (
      <EmptyState
        icon={<Receipt size={28} />}
        title="Not screened yet"
        description="Run the screen to see stamp duty, cess, surcharge and registration on top of the price — computed on whichever is higher, the agreed price or the guidance value."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  if (!costs) {
    return (
      <EmptyState
        icon={<Receipt size={28} />}
        title="Acquisition costs are not available for this case"
        description="Stamp duty, cess and registration are computed by a State Pack. The pack covering this property's state either does not exist yet or could not resolve a guidance value for the locality — and an unpriced cost is left unpriced rather than shown as zero."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <AcquisitionCostCard costs={costs} askingPrice={caseData.identity.askingPrice} />
    </div>
  );
}

function CostTable({ lines, currency }: { lines: TransactionCostBreakdown['lines']; currency: TransactionCostBreakdown['currency'] }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-[var(--ring)]">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
            <th className="px-3 py-2">Line item</th>
            <th className="px-3 py-2">Rate</th>
            <th className="px-3 py-2">Note</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-b border-hairline last:border-0 align-top">
              <td className="px-3 py-2 font-medium text-ink">{line.label}</td>
              <td className="px-3 py-2 tabular text-ink-secondary">{line.pct != null ? pct(line.pct, 2) : '—'}</td>
              <td className="px-3 py-2 text-ink-secondary">{line.note}</td>
              <td className="px-3 py-2 text-right tabular font-medium text-ink">{money(line.amount, currency, { compact: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AcquisitionCostCard({
  costs,
  askingPrice,
}: {
  costs: TransactionCostBreakdown;
  askingPrice: number | undefined;
}) {
  const onGuidanceValue = costs.dutiableBasis === 'statutory_guidance_value';
  const upliftPct = onGuidanceValue && askingPrice ? ((costs.dutiableValue - askingPrice) / askingPrice) * 100 : null;

  return (
    <Card>
      <CardHeader
        title="Indicative acquisition costs"
        subtitle="Stamp duty, cess, surcharge and registration on top of the price"
        icon={<Receipt size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        {/*
         * The chart leads and the table follows. Four line items are a thing
         * nobody adds up, and the total is the question — the table is still
         * there underneath for anyone checking a figure against a receipt.
         */}
        <CostWaterfallChart costs={costs} askingPrice={askingPrice} />
        <Callout tone="info" title="Duty is charged on the higher of price and guidance value" collapsible>
          Karnataka computes stamp duty and registration fees on whichever is higher: the agreed sale consideration or
          the government&rsquo;s guidance value for the locality — never on the lower figure, even if the negotiated
          price is lower. Most buyers only discover this at the sub-registrar&rsquo;s office.
        </Callout>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Dutiable value" value={money(costs.dutiableValue, costs.currency)} />
          <Stat
            label="Basis used"
            value={onGuidanceValue ? 'Guidance value' : 'Sale consideration'}
            tone={onGuidanceValue ? 'warning' : 'neutral'}
          />
          <Stat label="Total cost" value={money(costs.total, costs.currency)} />
          <Stat label="As % of price" value={pct(costs.totalPctOfPrice, 1)} />
        </div>

        {onGuidanceValue ? (
          <Callout tone="warning" title="Guidance value exceeds the agreed price">
            This property&rsquo;s statutory guidance value is higher than the price used for this screen, so duty is
            charged on the guidance value of {money(costs.dutiableValue, costs.currency, { compact: false })}
            {upliftPct != null ? ` — ${pct(upliftPct, 1, true)} above the price` : ''}, not the lower agreed
            consideration.
          </Callout>
        ) : (
          <p className="text-xs leading-relaxed text-ink-secondary">
            The agreed price is at or above the guidance value here, so duty is charged on the sale consideration of{' '}
            {money(costs.dutiableValue, costs.currency, { compact: false })}.
          </p>
        )}

        <CostTable lines={costs.lines} currency={costs.currency} />

        <div className="flex items-baseline justify-between border-t border-hairline pt-2.5 text-[13px] font-semibold text-ink">
          <span>Total indicative cost</span>
          <span className="tabular">
            {money(costs.total, costs.currency, { compact: false })}{' '}
            <span className="font-normal text-ink-secondary">({pct(costs.totalPctOfPrice, 1)} of price)</span>
          </span>
        </div>

        <StatutoryProvenance asOf={costs.asOf} source={costs.source} verifyNote={costs.verifyNote} />
      </CardBody>
    </Card>
  );
}
