import type { ComplianceCheck, ComplianceVerdict, ScreenResult } from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, KeyValue, SectionTitle } from './ui/kit';
import type { Tone } from './ui/kit';
import { StatutoryProvenance } from './StatutoryProvenance';
import {
  AnchorWeightChart,
  ComparablesChart,
  CompletenessRing,
  ConfidenceGauge,
  DriverImpactChart,
  RiskProfileChart,
  ValueRangeChart,
} from './charts';
import { money, pct } from '../lib/format';

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

export function ScreenResultPanel({ result }: { result: ScreenResult }) {
  const currency = result.indicativeValue.currency;
  const compliance = result.stateCompliance;
  const costs = result.transactionCosts;

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
          subtitle="A band, never a point. Each anchor carries its own range, weight and rationale."
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
          <CardHeader title="Value drivers" subtitle="What pushes this site above or below the locality median." />
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
            subtitle="Adjusted price per m² against recency. Adjustments are shown per transaction."
          />
          <CardBody>
            <ComparablesChart comparables={result.comparables} currency={currency} />
          </CardBody>
        </Card>
      ) : null}

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
          <p className="text-xs leading-relaxed text-ink-secondary">
            Each entry carries its source type: a document, an external dataset, a comparable, your own
            input, or an explicitly-labelled model inference. Nothing in this screen is asserted without one.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export default ScreenResultPanel;
