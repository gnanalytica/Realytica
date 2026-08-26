import { AlertTriangle, ArrowRight, Ban, CheckCircle2, HandCoins, Scale, TrendingDown } from 'lucide-react';
import type { ForcedSaleValue, OfferAdvice, OfferStance } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { money } from '../../../lib/format';
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, Stat, cn } from '../../../components/ui/kit';
import type { Tone } from '../../../components/ui/kit';
import { EvidenceLink } from '../../../components/EvidenceLink';

/**
 * What to offer, and the argument for it.
 *
 * The layout follows the order a buyer actually needs the information in,
 * which is not the order the data structure is in: the stance first, because
 * on a case with a blocker every number below it is hypothetical; then the
 * three prices; then what the money actually costs at completion; then the
 * arguments; then what is not priced.
 *
 * Two deliberate refusals. The three prices are never shown as a single
 * "recommended offer" figure, because a negotiation has a floor, a target and
 * a ceiling and collapsing them loses the only part a buyer can act on. And
 * an argument with no figure attached is shown with the same weight as one
 * that has a figure — the drivers behind a price are not lesser evidence for
 * having no rupee sign, and formatting them as a footnote would teach the
 * reader to skip the reasoning and take the number.
 */

const STANCE: Record<OfferStance, { tone: Tone; label: string; icon: typeof HandCoins }> = {
  offer: { tone: 'good', label: 'Ready to offer', icon: CheckCircle2 },
  offer_conditionally: { tone: 'warning', label: 'Offer only with conditions', icon: AlertTriangle },
  do_not_offer: { tone: 'critical', label: 'Do not offer yet', icon: Ban },
};

function PriceLadder({ offer }: { offer: OfferAdvice }) {
  const blocked = offer.stance === 'do_not_offer';
  // Under a blocking stance the three prices are still worth showing — they
  // are what the property would be worth once the blockers clear, which is
  // exactly what a buyer needs to decide whether clearing them is worth
  // pursuing. But they must not read as an instruction to go and offer, so
  // they are muted and captioned as conditional rather than presented as the
  // recommendation.

  const rungs = [
    { key: 'opening', label: 'Open at', value: offer.opening, note: 'The lowest number the evidence on file supports.' },
    { key: 'target', label: 'Settle at', value: offer.target, note: 'Where the evidence says this deal sits.' },
    { key: 'walkaway', label: 'Walk away above', value: offer.walkAway, note: blocked ? 'There is no headroom to concede into until the items below clear.' : 'Past this you are paying for something nobody has shown you.' },
  ];
  return (
    <div className="flex flex-col gap-2">
      {blocked && (
        <p className="m-0 text-[12px] font-medium text-critical">
          These are what the property would be worth once the blockers clear — not numbers to put to the seller today.
        </p>
      )}
      <div className={cn('grid gap-3 sm:grid-cols-3', blocked && 'opacity-70')}>
      {rungs.map(rung => (
        <div
          key={rung.key}
          className={cn(
            'rounded-lg border px-3 py-3',
            rung.key === 'target' && !blocked ? 'border-brand/40 bg-brand-soft' : 'border-hairline bg-sunken',
          )}
        >
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{rung.label}</p>
          <p className="m-0 mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight text-ink">
            {money(rung.value, offer.currency)}
          </p>
          <p className="m-0 mt-1 text-[12px] leading-snug text-ink-secondary">{rung.note}</p>
        </div>
      ))}
      </div>
    </div>
  );
}

function ForcedSaleCard({ forced }: { forced: ForcedSaleValue }) {
  return (
    <Card>
      <CardHeader
        title="If it had to be sold quickly"
        subtitle={`What this would realise inside ${forced.marketingPeriodDays} days, rather than on the open market`}
        icon={<TrendingDown size={16} />}
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-[26px] font-semibold tabular-nums tracking-tight text-ink">{money(forced.value, forced.currency)}</span>
          <Badge tone={forced.discountPct >= 30 ? 'critical' : forced.discountPct >= 15 ? 'warning' : 'neutral'}>
            {forced.discountPct}% below the open-market mid
          </Badge>
          {!forced.lendable && <Badge tone="critical">Not a lending figure</Badge>}
        </div>

        <Callout tone={forced.lendable ? 'info' : 'critical'} title={forced.lendable ? 'What this figure is for' : 'Read this before using the number'}>
          {forced.basis}
        </Callout>

        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Where the discount comes from</h4>
          <ul className="m-0 list-none space-y-2 p-0">
            {forced.components.map(component => (
              <li key={component.key} className="border-b border-hairline pb-2 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink">{component.label}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-ink-secondary">−{component.pct}%</span>
                </div>
                <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{component.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

export default function OfferTab({ result, runScreen, running }: TabProps) {
  if (!result?.offer) {
    return (
      <EmptyState
        icon={<HandCoins size={28} />}
        title="No offer advice yet"
        description="Run the screen to turn the value range, the acquisition costs and the open findings into a number to offer and the argument behind it."
        action={
          <button type="button" className="text-[13px] font-medium text-brand hover:underline" disabled={running} onClick={() => void runScreen()}>
            {running ? 'Running…' : 'Run screen'}
          </button>
        }
      />
    );
  }

  const offer = result.offer;
  const stance = STANCE[offer.stance];
  // "Below the evidence" rather than merely "not above it": a gap of a few
  // percent either way is noise in a range this wide, and flagging it would
  // make the warning meaningless when it matters.
  const askBelow = offer.gapToAsking !== null && offer.gapToAsking < 0 && Math.abs(offer.gapToAsking) > offer.target * 0.05;
  const StanceIcon = stance.icon;
  const forced = result.forcedSale;

  return (
    <div className="flex flex-col gap-4">
      <Callout tone={stance.tone} title={stance.label}>
        {offer.headline}
      </Callout>

      <Card>
        <CardHeader title="The number" subtitle="Three prices, because a negotiation has three" icon={<StanceIcon size={16} />} />
        <CardBody className="flex flex-col gap-4">
          <PriceLadder offer={offer} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Cash needed at settle"
              value={money(offer.allInAtTarget, offer.currency)}
              hint={offer.acquisitionCostsAtTarget > 0 ? `includes ${money(offer.acquisitionCostsAtTarget, offer.currency)} of duty, cess and fees` : 'acquisition costs not computed'}
              tone="neutral"
            />
            <Stat
              label="Asking price"
              value={offer.askingPrice !== null ? money(offer.askingPrice, offer.currency) : '—'}
              hint={offer.askingPrice === null ? 'none recorded on this case' : 'as recorded on this case'}
              tone="neutral"
            />
            {/*
              * An ask below the evidence is never rendered as good news.
              *
              * The comparable pool is drawn from properties whose paperwork is
              * in order. When the seller's own number sits well under it, the
              * market has usually already priced something the file has not
              * confirmed — and a green figure here would invite the reader to
              * bank a discount that is really a warning. So a negative gap is
              * shown as its absolute size, labelled as the seller asking
              * *less*, in a cautionary tone.
              */}
            <Stat
              label={askBelow ? 'Ask sits below the evidence' : 'Gap to argue'}
              value={offer.gapToAsking !== null ? money(Math.abs(offer.gapToAsking), offer.currency) : '—'}
              hint={
                offer.gapToAsking === null
                  ? 'no asking price to compare'
                  : askBelow
                    ? 'below what comparables support — usually a priced-in defect, not headroom'
                    : offer.gapToAsking > 0
                      ? 'between the ask and where the evidence lands'
                      : 'the ask is level with the evidence'
              }
              tone={offer.gapToAsking === null ? 'neutral' : askBelow ? 'serious' : offer.gapToAsking > 0 ? 'warning' : 'good'}
            />
          </div>
        </CardBody>
      </Card>

      {offer.arguments.length > 0 && (
        <Card>
          <CardHeader
            title="What to say"
            subtitle="Each point, and whether it carries a figure or only an argument"
            icon={<Scale size={16} />}
          />
          <CardBody>
            <ul className="m-0 list-none space-y-3 p-0">
              {offer.arguments.map(argument => (
                <li key={argument.key} className="border-b border-hairline pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{argument.label}</span>
                    {argument.amount !== null ? (
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-critical">{money(argument.amount, offer.currency)}</span>
                    ) : (
                      <Badge tone="neutral">Argument, no deduction</Badge>
                    )}
                  </div>
                  <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-secondary">{argument.argument}</p>
                  {argument.evidenceIds.length > 0 && (
                    <div className="mt-1.5">
                      <EvidenceLink ids={argument.evidenceIds} evidence={result.evidence} compact />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {offer.preconditions.length > 0 && (
        <Card>
          <CardHeader
            title="Before you put anything in writing"
            subtitle="Conditions, not costs — these are things that must be true, not money to negotiate"
            icon={<AlertTriangle size={16} />}
          />
          <CardBody>
            <ul className="m-0 list-none space-y-2 p-0">
              {offer.preconditions.map(condition => (
                <li key={condition} className="flex gap-2 text-[13px] leading-relaxed text-ink-secondary">
                  <ArrowRight size={14} className="mt-0.5 shrink-0 text-ink-muted" />
                  <span>{condition}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {offer.unpriced.length > 0 && (
        <Callout tone="warning" title="Not deducted above, and not zero">
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {offer.unpriced.map(item => (
              <li key={item} className="text-[13px] leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {forced && <ForcedSaleCard forced={forced} />}
    </div>
  );
}
