import type { ComplianceCheck, ComplianceVerdict, CountryCode, ScreenResult } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, KeyValue, SectionTitle, cn } from './ui/kit';
import type { Tone } from './ui/kit';
import { StatutoryProvenance } from './StatutoryProvenance';
import { ComparablesSchedule } from './ComparablesSchedule';
import { FormulaTip } from './FormulaTip';
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
 * Which slice of the working to render.
 *
 * The screen produces fourteen cards. Measured on a real file that is about
 * eighteen screens in an eight-hundred-pixel pane, with "Value drivers" on the
 * tenth — behind five screens of statutory compliance — which is a strange
 * place to put the answer to "why is it worth this". Nothing here is too much
 * to show; it is too much to show AT ONCE, and the fix is a place for each
 * group rather than a cut.
 *
 * Grouped by the question being asked, not by which engine produced it:
 *
 * - `range` — what the blend of anchors says, and how it was blended
 * - `market` — the transactions and the drivers the figure rests on
 * - `compliance` — what the state's own rules say about the title
 * - `costs` — what acquiring it costs on top of the price
 * - `evidence` — how much of this is documented, and where each figure came from
 *
 * `blockers` is deliberately its own group and not part of `compliance`: a
 * B-khata classification is a stop-spending finding, and it has to be visible
 * from whichever group the reader is standing in rather than only from the one
 * it belongs to.
 *
 * Omitting the prop renders everything, in the original order, which is what
 * a report or a print view wants.
 */
export type ScreenSection = 'blockers' | 'range' | 'market' | 'compliance' | 'costs' | 'evidence';

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
  only,
  headline,
  subjectAreaSqm,
}: {
  result: ScreenResult;
  askingPrice?: number;
  country?: CountryCode;
  locality?: string;
  /**
   * The subject's own area, for turning a rate back into a value.
   *
   * Passed in rather than read off the result: `PropertySnapshot` is a
   * headline and a list of key facts, and carries no area field at all — the
   * areas live on the project record.
   */
  subjectAreaSqm?: number;
  /** Render only these groups, in the order given. Omit for all of them. */
  only?: ScreenSection[];
  /**
   * The figure the page is showing above this, when it came from a different
   * run than this screen.
   *
   * The Value tab pins the latest valuation run's figure at the top and then
   * renders this screen's own blend below it. Those are two engines answering
   * the same question — the run reconciles the four IBBI approaches over
   * recorded inputs, the screen blends market anchors — so they routinely
   * differ, and two eleven-digit numbers on one page that differ by a third
   * with nothing to say why is the single most confusing thing this page can
   * do. Given the headline, the range card reconciles itself against it.
   */
  headline?: { value: number; label: string };
}) {
  const currency = result.indicativeValue.currency;
  const compliance = result.stateCompliance;
  const costs = result.transactionCosts;
  const unit = useAreaUnitFor(country);
  const residual = result.anchors.find((a) => a.residual)?.residual;

  /*
   * The drivers somebody could name, and the remainder nobody could.
   *
   * Split rather than sorted together: the reconciling row is a measure of how
   * much the itemised drivers fail to explain, and putting it in the same
   * ranking made it the headline finding whenever the file was thin.
   */
  const itemisedDrivers = result.drivers.filter((d) => !d.reconciling);
  const reconcilingDriver = result.drivers.find((d) => d.reconciling);
  const explainedTotal = itemisedDrivers.reduce((sum, d) => sum + Math.abs(d.impactPct), 0);
  const dominatesDrivers =
    reconcilingDriver !== undefined && Math.abs(reconcilingDriver.impactPct) > explainedTotal;

  const orderedChecks = compliance
    ? [...compliance.checks].sort(
        (a, b) => COMPLIANCE_ORDER.indexOf(a.verdict) - COMPLIANCE_ORDER.indexOf(b.verdict),
      )
    : [];
  const blockers = orderedChecks.filter((c) => c.verdict === 'blocker');

  const show = (s: ScreenSection) => !only || only.includes(s);

  /*
   * The weighted blend, spelled out.
   *
   * The anchors carry weights that do not sum to one — the engine assigns each
   * a weight on its own merits and normalises at the end — so a reader adding
   * the printed percentages gets something other than 100 and concludes the
   * page is wrong. It is not; the divisor is simply not printed. Here it is.
   */
  const anchorWeightTotal = result.anchors.reduce((sum, a) => sum + a.weight, 0);

  /*
   * How far the pinned figure and this screen's own blend are apart.
   *
   * Against the mid, because that is the number a reader compares. Only stated
   * when it is big enough to notice — below a few percent the two engines have
   * effectively agreed, and a note saying so is noise on every file.
   */
  const headlineGapPct =
    headline && result.indicativeValue.mid > 0
      ? ((headline.value - result.indicativeValue.mid) / result.indicativeValue.mid) * 100
      : null;
  const headlineDisagrees = headlineGapPct !== null && Math.abs(headlineGapPct) >= 3;

  return (
    <div className="space-y-4">
      {show('blockers') && blockers.length > 0 ? (
        <Callout tone="critical" title={`${blockers.length} blocker${blockers.length > 1 ? 's' : ''} on this site`}>
          {blockers.map((c) => c.label).join(' · ')}. These are the findings that should stop spending before
          they are resolved — read them under Compliance.
        </Callout>
      ) : null}

      {show('range') ? (
      <Card>
        <CardHeader
          title="Indicative range — property screen"
          subtitle="The screen's own blend of market anchors. Not the same calculation as an indicative valuation run."
          info="A band, never a point. Each anchor carries its own range, weight and rationale."
        />
        <CardBody className="space-y-5">
          {/*
            Two engines, one question, and until now no acknowledgement on the
            page that both had answered it. The run's figure was pinned at the
            top in the largest type on the tab and this card printed a
            different one four hundred pixels below, both labelled as the
            value. Naming the difference is cheaper than hiding one of them,
            and hiding one would be the wrong call anyway — a reader who is
            about to act on a number is entitled to know a second method
            disagreed and by how much.
          */}
          {headlineDisagrees && headlineGapPct !== null ? (
            <p className="rounded-lg bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
              <span className="font-medium text-ink">
                This is not the figure at the top of the tab.
              </span>{' '}
              {headline?.label} puts it at{' '}
              <span className="font-mono tabular-nums text-ink">{money(headline!.value, currency)}</span>, which is{' '}
              <span className="font-mono tabular-nums text-ink">
                {headlineGapPct > 0 ? '+' : ''}{headlineGapPct.toFixed(0)}%
              </span>{' '}
              against this screen&rsquo;s{' '}
              <span className="font-mono tabular-nums text-ink">{money(result.indicativeValue.mid, currency)}</span>.
              They are different methods over different inputs, not two attempts at the same one — where they
              disagree this widely, the file is thin somewhere and the evidence ledger says where.
            </p>
          ) : null}

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
                    <FormulaTip
                      label={anchor.label}
                      derivation={{
                        formula: 'low – high, at this method’s own mid',
                        substituted: `mid ${money(anchor.mid, currency, { compact: true })}`,
                        note: (
                          <>
                            Contributes{' '}
                            {anchorWeightTotal > 0
                              ? money((anchor.mid * anchor.weight) / anchorWeightTotal, currency, { compact: true })
                              : '—'}{' '}
                            to the blended mid — its own mid times{' '}
                            {anchorWeightTotal > 0 ? pct((anchor.weight / anchorWeightTotal) * 100, 0) : '—'} of the
                            total weight. Confidence in this anchor: {pct(anchor.confidence * 100, 0)}.
                          </>
                        ),
                      }}
                    >
                      {money(anchor.low, currency, { compact: true })} – {money(anchor.high, currency, { compact: true })}
                    </FormulaTip>
                    <span className="ml-2 text-ink-muted">weight {pct(anchor.weight * 100, 0)}</span>
                  </span>
                </div>
                <p className="mt-0.5 text-ink-secondary">{anchor.rationale}</p>
              </li>
            ))}
          </ul>
          {/*
            The weights are assigned per anchor and normalised at the end, so
            they do not sum to 100 on the page. A reader who adds them up and
            gets 135 has found a real discrepancy in what is PRINTED, and the
            divisor is the answer to it.
          */}
          {result.anchors.length > 1 ? (
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Weights are assigned per anchor and normalised over their total of{' '}
              <span className="font-mono tabular-nums">{pct(anchorWeightTotal * 100, 0)}</span>, which is why the
              column above does not add to 100%. The blended mid is Σ(anchor mid × weight) ÷{' '}
              <span className="font-mono tabular-nums">{anchorWeightTotal.toFixed(2)}</span>.
            </p>
          ) : null}
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
              {/*
                The waterfall draws the shape; the rate and area it was all
                computed from sit outside every bar and were nowhere on the
                page. They are the two inputs a reader disputes first.
              */}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                Computed on{' '}
                <FormulaTip
                  label="Gross realisation"
                  derivation={{
                    formula: 'area × rate',
                    substituted: `${formatArea(residual.areaSqm, unit)} × ${formatRate(residual.ratePerSqm, unit, currency)}`,
                    result: money(residual.areaSqm * residual.ratePerSqm, currency, { compact: true }),
                    note: `Area basis: ${residual.areaBasis}. Every deduction below comes off this figure.`,
                    steps: residual.steps.map((s) => ({
                      label: s.label,
                      value: money(s.amount, currency, { compact: true }),
                    })),
                  }}
                >
                  <span className="font-mono tabular-nums">{formatArea(residual.areaSqm, unit)}</span>
                </FormulaTip>{' '}
                of {residual.areaBasis} at{' '}
                <span className="font-mono tabular-nums">{formatRate(residual.ratePerSqm, unit, currency)}</span>.
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>
      ) : null}

      {show('evidence') || show('compliance') ? (
      <div className="grid gap-4 lg:grid-cols-2">
        {show('evidence') ? (
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
                  {/*
                    The note behind each factor — "anchors span 41% of their
                    average mid", "3 of 5 comparables inside twelve months" —
                    is the whole reason the number is what it is, and it was
                    computed and dropped. A signed integer with no note is a
                    score somebody has to take on trust.
                  */}
                  <span className="shrink-0 font-mono text-ink">
                    <FormulaTip
                      label={factor.label}
                      derivation={{
                        formula: 'points added to the 0–100 score',
                        result: `${factor.contribution > 0 ? '+' : ''}${factor.contribution}`,
                        note: factor.note,
                      }}
                    >
                      {factor.contribution > 0 ? '+' : ''}{factor.contribution}
                    </FormulaTip>
                  </span>
                </li>
              ))}
              <li className="flex items-start justify-between gap-3 border-t border-hairline pt-1.5 text-xs">
                <span className="font-medium text-ink">Confidence score</span>
                <span className="shrink-0 font-mono font-medium text-ink">
                  {result.confidence.score} / 100
                </span>
              </li>
            </ul>
            {result.confidence.biggestLever ? (
              <Callout tone="info" title="Raises confidence most">{result.confidence.biggestLever}</Callout>
            ) : null}
          </CardBody>
        </Card>
        ) : null}

        {show('compliance') ? (
        <Card>
          <CardHeader title="Risk profile" subtitle="Every flag the screen raised, by severity." />
          <CardBody>
            <RiskProfileChart risks={result.risks} />
          </CardBody>
        </Card>
        ) : null}
      </div>
      ) : null}

      {show('compliance') ? (
        compliance ? (
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
        )
      ) : null}

      {show('costs') && costs ? (
        <Card>
          <CardHeader
            title="Indicative transaction costs"
            subtitle={`Charged on the ${costs.dutiableBasis === 'consideration' ? 'consideration' : 'statutory guidance value'} — the higher of the two.`}
          />
          <CardBody className="space-y-3">
            {/*
              The dutiable value is the base every line below is a percentage
              of, and it was never stated — so a reader could see "5.6%" and
              "₹4,42,000" and have no way to check that one produced the other.
            */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-sunken px-3 py-2">
              <span className="text-[12px] text-ink-secondary">
                Dutiable value —{' '}
                {costs.dutiableBasis === 'consideration' ? 'the consideration' : 'the statutory guidance value'}
              </span>
              <span className="font-mono text-[12.5px] tabular-nums text-ink">
                {money(costs.dutiableValue, costs.currency)}
              </span>
            </div>
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
                  <span className="shrink-0 font-mono text-ink">
                    {line.pct !== null ? (
                      <FormulaTip
                        label={line.label}
                        derivation={{
                          formula: 'dutiable value × rate',
                          substituted: `${money(costs.dutiableValue, costs.currency)} × ${pct(line.pct, 2)}`,
                          result: money(line.amount, costs.currency),
                          note: line.note,
                        }}
                      >
                        {money(line.amount, costs.currency)}
                      </FormulaTip>
                    ) : (
                      <FormulaTip
                        label={line.label}
                        derivation={{
                          formula: 'a fixed charge, not a percentage',
                          result: money(line.amount, costs.currency),
                          note: line.note,
                        }}
                      >
                        {money(line.amount, costs.currency)}
                      </FormulaTip>
                    )}
                  </span>
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

      {show('market') && result.drivers.length > 0 ? (
        <Card>
          <CardHeader
            title="Value drivers"
            info="Each driver is a signed adjustment against the locality median. The remainder the screen could not itemise is stated separately below, not charted as a driver."
          />
          <CardBody className="space-y-4">
            {/*
              The chart shows what was actually modelled.
              The reconciling remainder used to be sorted into it, where — being
              routinely an order of magnitude larger than any real driver — it
              became the tallest bar in a chart titled "Value drivers". It is a
              statement about how much is NOT explained, so it is stated as one.
            */}
            <DriverImpactChart drivers={itemisedDrivers} />
            <ul className="space-y-2">
              {itemisedDrivers.map((driver) => (
                <li key={driver.id} className="border-t border-hairline pt-2 text-xs leading-relaxed">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{driver.label}</span>
                    <span className="font-mono text-ink">
                      <FormulaTip
                        label={driver.label}
                        derivation={{
                          formula: 'signed % applied to the locality median',
                          substituted: `${money(result.marketContext.medianPricePerSqm, currency)}/m² × (1 ${driver.impactPct >= 0 ? '+' : '−'} ${Math.abs(driver.impactPct).toFixed(1)}%)`,
                          note: (
                            <>
                              {driver.explanation}
                              {driver.evidenceIds.length
                                ? ` Traced to ${driver.evidenceIds.length} evidence ${driver.evidenceIds.length === 1 ? 'entry' : 'entries'}.`
                                : ' Not traced to a document — this is a model inference.'}
                            </>
                          ),
                        }}
                      >
                        {pct(driver.impactPct, 1, true)}
                      </FormulaTip>
                    </span>
                  </div>
                  <p className="mt-0.5 text-ink-secondary">{driver.explanation}</p>
                </li>
              ))}
            </ul>
            {reconcilingDriver ? (
              <div
                className={cn(
                  'rounded-lg p-3 text-xs leading-relaxed ring-1 ring-inset',
                  // Loud only when it dwarfs the drivers it sits under: at that
                  // point the itemised list is not really an explanation.
                  dominatesDrivers
                    ? 'bg-warning/10 ring-warning/40'
                    : 'bg-sunken ring-[var(--ring)]',
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">{reconcilingDriver.label}</span>
                  <span className="font-mono text-ink">{pct(reconcilingDriver.impactPct, 1, true)}</span>
                </div>
                <p className="mt-0.5 text-ink-secondary">{reconcilingDriver.explanation}</p>
                {dominatesDrivers ? (
                  <p className="mt-1.5 font-medium text-ink">
                    This is larger than every driver above it put together, so the list above explains
                    little of the difference from the locality median. Recording tenure, encumbrances and
                    a comparable rate is what moves value out of this row.
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {show('market') && result.comparables.length > 0 ? (
        <Card>
          <CardHeader
            title="Comparables"
            info="Adjusted price per m² against how recently each transacted. The adjustment that moved each one is in the schedule below."
          />
          <CardBody>
            <ComparablesChart comparables={result.comparables} currency={currency} />
          </CardBody>
        </Card>
      ) : null}

      {/*
        The chain that produced every adjusted rate in the chart above.
        The engine computes nine possible adjustments per transaction, stores
        each signed percentage, and until now rendered none of them — under a
        card whose own caption claimed they were shown per transaction.
      */}
      {show('market') ? (
        <ComparablesSchedule
          comparables={result.comparables}
          currency={currency}
          subjectAreaSqm={subjectAreaSqm}
        />
      ) : null}

      {show('market') && result.marketContext.trend.length > 1 ? (
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

      {show('market') && result.priceTrajectory ? <PriceTrajectoryCard trajectory={result.priceTrajectory} /> : null}

      {show('market') && result.waterExposure ? (
        <WaterExposureCard water={result.waterExposure} locality={locality ?? result.marketContext.source} />
      ) : null}

      {show('market') && result.yield ? <SchematicYieldCard yieldResult={result.yield} country={country} /> : null}

      {show('market') && result.jdSplit ? <JdSplitCard split={result.jdSplit} evidence={result.evidence} /> : null}

      {show('compliance') && result.playbooks?.length ? <PlaybookPanel runs={result.playbooks} /> : null}

      {show('evidence') ? (
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
      ) : null}

      {show('evidence') ? (
      <Card>
        <CardHeader
          title="Evidence ledger"
          subtitle={`${result.evidence.length} entries — every figure above traces to one.`}
        />
        <CardBody>
          <ProvenanceBar evidence={result.evidence} />
        </CardBody>
      </Card>
      ) : null}
    </div>
  );
}

export default ScreenResultPanel;
