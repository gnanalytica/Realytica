import type { ComplianceCheck, ComplianceVerdict, CountryCode, ScreenResult } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, KeyValue, SectionTitle } from './ui/kit';
import type { Tone } from './ui/kit';
import { StatutoryProvenance } from './StatutoryProvenance';
import { JdSplitCard } from './JdSplitCard';
import { PlaybookPanel } from './PlaybookPanel';
import { PriceTrajectoryCard } from './PriceTrajectoryCard';
import { SchematicYieldCard } from './SchematicYieldCard';
import { WaterExposureCard } from './WaterExposureCard';
import {
  AnchorWeightChart,
  CostWaterfallChart,
  ComparablesChart,
  CompletenessRing,
  ConfidenceGauge,
  DriverImpactChart,
  MarketTrendChart,
  ProvenanceBar,
  ResidualWaterfallChart,
  RiskProfileChart,
  ValueRangeChart,
} from './charts';
import { money, pct } from '../lib/format';
import { formatArea, formatRate, useAreaUnitFor } from '../lib/units';

/**
 * The working behind a screen verdict.
 *
 * The engine computes anchors, comparables, drivers, a confidence
 * arithmetic, a document-completeness list, the state's own title checks and
 * the transaction costs on every run. The project path wrote the conclusions
 * into the registers and then discarded all of that, leaving the reader a
 * verdict and a number with no way to ask why either one — which is the exact
 * shape of assertion this product's first principle forbids.
 *
 * Nothing here is new analysis. Every figure is read straight off the stored
 * `ScreenResult`, and every chart is the same component the case workspace
 * used, so this view cannot disagree with the run it describes.
 *
 * Compliance leads, and blockers lead within it. A B-khata classification or
 * unconverted agricultural land is the finding that should stop somebody
 * before they spend money on lawyers, so it is not something to scroll to.
 */

const COMPLIANCE_TONE: Record<ComplianceVerdict, Tone> = {
  clear: 'good',
  attention: 'warning',
  blocker: 'critical',
  unknown: 'neutral',
};

const COMPLIANCE_WORD: Record<ComplianceVerdict, string> = {
  clear: 'Clear',
  attention: 'Attention',
  blocker: 'Blocker',
  unknown: 'Not established',
};

/** Blockers first, then attention, then unresolved, then clear. */
const COMPLIANCE_ORDER: ComplianceVerdict[] = ['blocker', 'attention', 'unknown', 'clear'];

function ComplianceRow({ check }: { check: ComplianceCheck }) {
  return (
    <li className="border-t border-hairline py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{check.label}</span>
        <Badge tone={COMPLIANCE_TONE[check.verdict]}>{COMPLIANCE_WORD[check.verdict]}</Badge>
      </div>
      <p className="mt-1 text-[13px] text-ink">{check.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{check.finding}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        <span className="text-ink-muted">Why it matters — </span>
        {check.consequence}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        <span className="text-ink-muted">Next step — </span>
        {check.nextStep}
      </p>
      {check.statute ? <p className="mt-1 font-mono text-mini text-ink-muted">{check.statute}</p> : null}
    </li>
  );
}

/**
 * Everything the screen worked out, in one place.
 *
 * The engine has always computed the water exposure, the schematic yield, the
 * JD split, the parcel's own price record and the eight-quarter market trend —
 * and the cards that render them were written and then never given a home, so
 * a valuer paid for the computation and never saw it. Each is conditional on
 * its own data, which is why a screen that could not work one out simply does
 * not show it rather than showing an empty frame.
 */
export function ScreenResultPanel({
  result,
  askingPrice,
  country = 'IN',
  locality,
}: {
  result: ScreenResult;
  askingPrice?: number;
  country?: CountryCode;
  locality?: string;
}) {
  const currency = result.indicativeValue.currency;
  const compliance = result.stateCompliance;
  const costs = result.transactionCosts;
  const unit = useAreaUnitFor(country);
  const residual = result.anchors.find((a) => a.residual)?.residual;

  const orderedChecks = compliance
    ? [...compliance.checks].sort(
        (a, b) => COMPLIANCE_ORDER.indexOf(a.verdict) - COMPLIANCE_ORDER.indexOf(b.verdict),
      )
    : [];
  const blockers = orderedChecks.filter((c) => c.verdict === 'blocker');

  return (
    <div className="space-y-4">
      {blockers.length > 0 ? (
        <Callout tone="critical" title={`${blockers.length} blocker${blockers.length > 1 ? 's' : ''} on this site`}>
          {blockers.map((c) => c.label).join(' · ')}. These are the findings that should stop spending before
          they are resolved — read them under Compliance below.
        </Callout>
      ) : null}

      <Card>
        <CardHeader
          title="Indicative range"
          info="A band, never a point. Each anchor carries its own range, weight and rationale."
        />
        <CardBody className="space-y-5">
          <ValueRangeChart
            low={result.indicativeValue.low}
            mid={result.indicativeValue.mid}
            high={result.indicativeValue.high}
            currency={currency}
            anchors={result.anchors.map((a) => ({
              label: a.label,
              method: a.method,
              low: a.low,
              mid: a.mid,
              high: a.high,
            }))}
          />
          <div>
            <SectionTitle hint="How much each method carries">Anchor weights</SectionTitle>
            <AnchorWeightChart anchors={result.anchors} currency={currency} />
          </div>
          <ul className="space-y-2">
            {result.anchors.map((anchor) => (
              <li key={anchor.method} className="border-t border-hairline pt-2 text-xs leading-relaxed">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">{anchor.label}</span>
                  <span className="font-mono text-ink">
                    {money(anchor.low, currency, { compact: true })} – {money(anchor.high, currency, { compact: true })}
                    <span className="ml-2 text-ink-muted">weight {pct(anchor.weight * 100, 0)}</span>
                  </span>
                </div>
                <p className="mt-0.5 text-ink-secondary">{anchor.rationale}</p>
              </li>
            ))}
          </ul>
          {/* The residual is the one anchor that is arithmetic rather than a
              rate times an area, and it is the one a reader most often wants
              to argue with. Showing the steps is the whole point of it. */}
          {residual ? (
            <div>
              <SectionTitle hint="Gross realisation down to the land">Residual, step by step</SectionTitle>
              <ResidualWaterfallChart
                residual={residual}
                formatArea={(sqm) => formatArea(sqm, unit)}
                formatRate={(rate) => formatRate(rate, unit, currency)}
              />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Confidence" subtitle="What the score is made of, factor by factor." />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-6">
              <ConfidenceGauge score={result.confidence.score} band={result.confidence.band} />
              <CompletenessRing score={result.completeness.score} />
            </div>
            <ul className="space-y-1.5">
              {result.confidence.factors.map((factor) => (
                <li key={factor.key} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-ink-secondary">{factor.label}</span>
                  <span className="shrink-0 font-mono text-ink">{factor.contribution > 0 ? '+' : ''}{factor.contribution}</span>
                </li>
              ))}
            </ul>
            {result.confidence.biggestLever ? (
              <Callout tone="info" title="Raises confidence most">{result.confidence.biggestLever}</Callout>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Risk profile" subtitle="Every flag the screen raised, by severity." />
          <CardBody>
            <RiskProfileChart risks={result.risks} />
          </CardBody>
        </Card>
      </div>

      {compliance ? (
        <Card>
          <CardHeader
            title={`${compliance.state} compliance`}
            subtitle={`${compliance.checks.length} state checks · ${compliance.score}/100 clear`}
            action={<Badge tone={blockers.length ? 'critical' : 'neutral'}>{compliance.statePackId}</Badge>}
          />
          <CardBody className="space-y-3">
            <StatutoryProvenance
              asOf={compliance.rulesAsOf}
              source={`${compliance.state} state pack`}
              verifyNote={compliance.verifyNote}
            />
            <ul>
              {orderedChecks.map((check) => (
                <ComplianceRow key={check.key} check={check} />
              ))}
            </ul>
            {compliance.datasets?.length ? (
              <p className="text-xs leading-relaxed text-ink-secondary">
                <span className="text-ink-muted">Written against — </span>
                {compliance.datasets.join(' · ')}. Anything not listed was not consulted.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Callout tone="warning" title="No state pack for this jurisdiction">
          The state-specific title checks, stamp duty and required-document list did not run. The screen
          below is indicative of the market only, not of the legal position.
        </Callout>
      )}

      {costs ? (
        <Card>
          <CardHeader
            title="Indicative transaction costs"
            subtitle={`Charged on the ${costs.dutiableBasis === 'consideration' ? 'consideration' : 'statutory guidance value'} — the higher of the two.`}
          />
          <CardBody className="space-y-3">
            {/* The list below is the audit trail; this is the shape. Stamp duty
                against cess against registration reads as proportions long
                before it reads as six numbers, and which line dominates is the
                thing a buyer asks first. */}
            <CostWaterfallChart costs={costs} askingPrice={askingPrice} />
            <ul className="space-y-1.5">
              {costs.lines.map((line) => (
                <li key={line.key} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0">
                    <span className="text-[13px] text-ink">{line.label}</span>
                    {line.pct !== null ? <span className="ml-1.5 text-ink-muted">{pct(line.pct, 2)}</span> : null}
                    <span className="block text-ink-secondary">{line.note}</span>
                  </span>
                  <span className="shrink-0 font-mono text-ink">{money(line.amount, costs.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-hairline pt-2">
              <KeyValue
                label={`Total (${pct(costs.totalPctOfPrice, 1)} of price)`}
                value={money(costs.total, costs.currency)}
                mono
              />
            </div>
            <StatutoryProvenance asOf={costs.asOf} source={costs.source} verifyNote={costs.verifyNote} />
          </CardBody>
        </Card>
      ) : null}

      {result.drivers.length > 0 ? (
        <Card>
          <CardHeader title="Value drivers" />
          <CardBody className="space-y-4">
            <DriverImpactChart drivers={result.drivers} />
            <ul className="space-y-2">
              {result.drivers.map((driver) => (
                <li key={driver.id} className="border-t border-hairline pt-2 text-xs leading-relaxed">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{driver.label}</span>
                    <span className="font-mono text-ink">{pct(driver.impactPct, 1, true)}</span>
                  </div>
                  <p className="mt-0.5 text-ink-secondary">{driver.explanation}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {result.comparables.length > 0 ? (
        <Card>
          <CardHeader
            title="Comparables"
            info="Adjusted price per m² against recency. Adjustments are shown per transaction."
          />
          <CardBody>
            <ComparablesChart comparables={result.comparables} currency={currency} />
          </CardBody>
        </Card>
      ) : null}

      {result.marketContext.trend.length > 1 ? (
        <Card>
          <CardHeader
            title="Locality trend"
            info={`Median price per m² over the last ${result.marketContext.trend.length} quarters. Source: ${result.marketContext.source}.`}
          />
          <CardBody>
            <MarketTrendChart trend={result.marketContext.trend} currency={currency} />
          </CardBody>
        </Card>
      ) : null}

      {result.priceTrajectory ? <PriceTrajectoryCard trajectory={result.priceTrajectory} /> : null}

      {result.waterExposure ? (
        <WaterExposureCard water={result.waterExposure} locality={locality ?? result.marketContext.source} />
      ) : null}

      {result.yield ? <SchematicYieldCard yieldResult={result.yield} country={country} /> : null}

      {result.jdSplit ? <JdSplitCard split={result.jdSplit} evidence={result.evidence} /> : null}

      {result.playbooks?.length ? <PlaybookPanel runs={result.playbooks} /> : null}

      <Card>
        <CardHeader
          title="Document completeness"
          subtitle={`${result.completeness.items.filter((i) => i.present).length} of ${result.completeness.items.length} expected documents on file.`}
        />
        <CardBody>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {result.completeness.items.map((item) => (
              <li key={item.key} className="flex items-start gap-2 text-xs">
                <Badge tone={item.present ? 'good' : item.required ? 'warning' : 'neutral'}>
                  {item.present ? 'On file' : item.required ? 'Missing' : 'Optional'}
                </Badge>
                <span className="min-w-0 text-ink-secondary">{item.label}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Evidence ledger"
          subtitle={`${result.evidence.length} entries — every figure above traces to one.`}
        />
        <CardBody>
          <ProvenanceBar evidence={result.evidence} />
        </CardBody>
      </Card>
    </div>
  );
}

export default ScreenResultPanel;
