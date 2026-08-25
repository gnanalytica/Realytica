import { useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ClipboardCopy,
  Download,
  FileText,
  Minus,
  Printer,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  ActionPriority,
  Comparable,
  ConfidenceFactor,
  DriverCategory,
  EvidenceItem,
  RecommendedAction,
  RiskFlag,
  RiskSeverity,
  RiskStatus,
  ValueAnchor,
  ValueDriver,
} from '@valytica/shared';
import {
  area,
  confidenceTone,
  date,
  money,
  num,
  perSqm,
  pct,
  titleCase,
  VERDICT_LABEL,
  verdictTone,
} from '../../../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  KeyValue,
  ProgressBar,
  TONE_ICON,
  Toggle,
  toneText,
  useToast,
  type Tone,
} from '../../../components/ui/kit';
import ValueRangeChart from '../../../components/charts/ValueRangeChart';
import AnchorWeightChart from '../../../components/charts/AnchorWeightChart';
import ComparablesChart from '../../../components/charts/ComparablesChart';
import DriverImpactChart from '../../../components/charts/DriverImpactChart';
import RiskProfileChart from '../../../components/charts/RiskProfileChart';
import type { TabProps } from '../tab-props';

/* ------------------------------------------------------------------ */
/* Small local helpers                                                 */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<RiskSeverity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };
const STATUS_RANK: Record<RiskStatus, number> = { open: 0, mitigated: 1, accepted: 2 };
const PRIORITY_ORDER: ActionPriority[] = ['now', 'before_offer', 'before_completion'];
const EVIDENCE_SOURCE_LABEL: Record<EvidenceItem['sourceType'], string> = {
  document: 'Document',
  external_dataset: 'External dataset',
  comparable: 'Comparable',
  user_input: 'User input',
  model_inference: 'Model inference',
};

function driverTone(direction: ValueDriver['direction']): Tone {
  if (direction === 'positive') return 'good';
  if (direction === 'negative') return 'critical';
  return 'neutral';
}

function DriverDirectionIcon({ direction }: { direction: ValueDriver['direction'] }) {
  if (direction === 'positive') return <ArrowUpRight size={13} />;
  if (direction === 'negative') return <ArrowDownRight size={13} />;
  return <Minus size={13} />;
}

const OUT_OF_SCOPE = [
  'a certified valuation',
  'a legal title certificate',
  'a formal legal opinion',
  'an engineering inspection',
  'lending approval',
  'a formal mortgage valuation',
  'a full project feasibility study',
  'an automated purchase recommendation without explanation',
];

/** Frozen light-mode token values so the report prints the same way regardless of the active theme. */
const PRINT_STYLE = `
@media print {
  .vly-report-print {
    --page: #f9f9f7;
    --surface-1: #fcfcfb;
    --surface-2: #ffffff;
    --surface-3: #f2f1ed;
    --hairline: #e1e0d9;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --text-inverse: #ffffff;
    --brand: #2a78d6;
    --brand-strong: #1c5cab;
    --brand-soft: #e8f1fd;
    --brand-ink: #ffffff;
    --status-good: #0ca30c;
    --status-warning: #fab219;
    --status-serious: #ec835a;
    --status-critical: #d03b3b;
    --status-good-text: #006300;
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --series-4: #eda100;
    --series-5: #e87ba4;
    --series-6: #008300;
    --series-7: #4a3aa7;
    --series-8: #e34948;
    --gridline: #e1e0d9;
    --axis: #c3c2b7;
    --ring: rgba(11, 11, 11, 0.1);
    background: #ffffff;
  }
  .vly-report-print .print-block {
    box-shadow: none !important;
    break-inside: avoid;
  }
  @page {
    margin: 14mm;
  }
}
`;

function Section({
  n,
  title,
  subtitle,
  action,
  children,
}: {
  n: number;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span>
            <span className="mr-2 text-ink-muted">{String(n).padStart(2, '0')}</span>
            {title}
          </span>
        }
        subtitle={subtitle}
        action={action}
      />
      <CardBody className="space-y-3">{children}</CardBody>
    </Card>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg ring-1 ring-[var(--ring)]">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export default function ReportTab({ caseData, result, runScreen, running, goToTab }: TabProps) {
  const toast = useToast();
  const [showAppendix, setShowAppendix] = useState(false);

  if (!result) {
    return (
      <Card>
        <EmptyState
          icon={<FileText size={28} />}
          title="No screen has been run yet"
          description="The Property Screen report is assembled from a completed screen — the indicative value, drivers, risks, planning position, completeness and confidence it needs don't exist until the engine has run at least once."
          action={
            <Button variant="primary" icon={<Sparkles size={14} />} loading={running} onClick={() => void runScreen()}>
              Run screen
            </Button>
          }
        />
      </Card>
    );
  }

  // A stable, non-null alias — closures defined below (copySummary) don't retain
  // the early-return narrowing on the `result` prop itself.
  const screen = result;
  const { identity } = caseData;
  const currency = screen.indicativeValue.currency;
  const verdictColor = verdictTone(result.recommendation.verdict);
  const VerdictIcon = TONE_ICON[verdictColor];

  function copySummary() {
    const lines: (string | null)[] = [
      `VALYTICA PROPERTY SCREEN — ${caseData.reference}`,
      identity.label,
      `${identity.addressLine}, ${identity.locality}, ${identity.city}, ${identity.state} ${identity.postalCode}`,
      '',
      `Verdict: ${VERDICT_LABEL[screen.recommendation.verdict]}`,
      screen.recommendation.headline,
      '',
      `Indicative value: ${money(screen.indicativeValue.low, currency, { compact: false })} – ${money(
        screen.indicativeValue.high,
        currency,
        { compact: false },
      )} (mid ${money(screen.indicativeValue.mid, currency, { compact: false })})`,
      `Spread: ±${pct(screen.indicativeValue.spreadPct, 1)} of mid`,
      screen.indicativeValue.askingVsMidPct != null
        ? `Asking price is ${pct(Math.abs(screen.indicativeValue.askingVsMidPct), 1)} ${
            screen.indicativeValue.askingVsMidPct >= 0 ? 'above' : 'below'
          } mid`
        : null,
      '',
      `Confidence: ${screen.confidence.score}/100 (${titleCase(screen.confidence.band)})`,
      `Completeness: ${screen.completeness.score}/100`,
      '',
      'Reasoning:',
      ...screen.recommendation.reasoning.map((r) => `- ${r}`),
      '',
      screen.recommendation.conditions.length > 0 ? 'Conditions that must clear:' : null,
      ...screen.recommendation.conditions.map((c) => `- ${c}`),
      '',
      `Material risks (${openRisksCount} open of ${screen.risks.length}):`,
      ...screen.risks
        .filter((r) => r.status === 'open')
        .slice(0, 6)
        .map((r) => `- [${r.severity.toUpperCase()}] ${r.title}`),
      '',
      `Generated ${date(screen.generatedAt, 'long')} · engine ${screen.engineVersion}`,
      '',
      'This report is not a certified valuation, legal title certificate, formal legal opinion, engineering inspection, lending approval, formal mortgage valuation, full project feasibility study, or an automated purchase recommendation without explanation.',
    ];
    const text = lines.filter((l): l is string => l !== null).join('\n');
    navigator.clipboard
      .writeText(text)
      .then(() => toast('Executive summary copied to clipboard', 'good'))
      .catch(() => toast('Could not copy — clipboard unavailable', 'critical'));
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${caseData.reference.replace(/\s+/g, '_')}-property-screen.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const driversByCategory = new Map<DriverCategory, ValueDriver[]>();
  for (const d of result.drivers) {
    const list = driversByCategory.get(d.category) ?? [];
    list.push(d);
    driversByCategory.set(d.category, list);
  }

  const sortedRisks = [...result.risks].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const actionsByPriority = new Map<ActionPriority, RecommendedAction[]>();
  for (const a of result.actions) {
    const list = actionsByPriority.get(a.priority) ?? [];
    list.push(a);
    actionsByPriority.set(a.priority, list);
  }

  const farRatio = result.planning.farAllowed > 0 ? (result.planning.farUsed / result.planning.farAllowed) * 100 : 0;
  const factorSum = result.confidence.factors.reduce((s, f) => s + f.contribution, 0);
  const openRisksCount = result.risks.filter((r) => r.status === 'open').length;

  return (
    <div className="vly-report-print mx-auto max-w-4xl">
      <style>{PRINT_STYLE}</style>

      {/* toolbar */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">Property Screen report</h1>
          <p className="text-xs text-ink-secondary">{caseData.reference} · generated {date(result.generatedAt, 'long')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={showAppendix} onChange={setShowAppendix} label="Include evidence appendix" size="sm" />
          <Button variant="secondary" size="sm" icon={<ClipboardCopy size={13} />} onClick={copySummary}>
            Copy summary
          </Button>
          <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={downloadJson}>
            Download JSON
          </Button>
          <Button variant="primary" size="sm" icon={<Printer size={13} />} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {/* 1. Cover */}
        <Section n={1} title="Cover">
          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">Valytica Property Screen</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{identity.label}</h2>
            <p className="mt-1 text-[13px] text-ink-secondary">
              {identity.addressLine}, {identity.locality}, {identity.city}, {identity.state} {identity.postalCode}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-hairline pt-3 sm:grid-cols-4">
            <KeyValue label="Case reference" value={caseData.reference} />
            <KeyValue label="Prepared for" value={caseData.ownerName} />
            <KeyValue label="Generated" value={date(result.generatedAt, 'long')} />
            <KeyValue label="Engine version" value={result.engineVersion} mono />
          </div>
        </Section>

        {/* 2. Recommendation */}
        <Section n={2} title="Recommendation">
          <div className="flex items-center gap-3">
            <span className={toneText(verdictColor)}>
              <VerdictIcon size={26} />
            </span>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Verdict</div>
              <div className={`text-2xl font-semibold leading-tight ${toneText(verdictColor)}`}>{VERDICT_LABEL[result.recommendation.verdict]}</div>
            </div>
          </div>
          <p className="text-[14px] leading-relaxed text-ink">{result.recommendation.headline}</p>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Reasoning</div>
            <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
              {result.recommendation.reasoning.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Conditions that must clear</div>
            {result.recommendation.conditions.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
                {result.recommendation.conditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">No outstanding conditions.</p>
            )}
          </div>
        </Section>

        {/* 3. Indicative value */}
        <Section n={3} title="Indicative value" subtitle="A range, never a point — uncertainty is the point">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Range" value={`${money(result.indicativeValue.low, currency)} – ${money(result.indicativeValue.high, currency)}`} />
            <KeyValue label="Mid" value={money(result.indicativeValue.mid, currency)} mono />
            <KeyValue label="Spread" value={`± ${pct(result.indicativeValue.spreadPct, 1)}`} mono />
            <KeyValue
              label="Asking vs mid"
              value={result.indicativeValue.askingVsMidPct != null ? pct(result.indicativeValue.askingVsMidPct, 1, true) : '—'}
              mono
            />
            <KeyValue label="Per m² — low" value={perSqm(result.indicativeValue.perSqm.low, currency)} mono />
            <KeyValue label="Per m² — mid" value={perSqm(result.indicativeValue.perSqm.mid, currency)} mono />
            <KeyValue label="Per m² — high" value={perSqm(result.indicativeValue.perSqm.high, currency)} mono />
            <KeyValue label="Asking price" value={identity.askingPrice != null ? money(identity.askingPrice, currency) : 'Not supplied'} mono />
          </div>
          <ValueRangeChart
            low={result.indicativeValue.low}
            mid={result.indicativeValue.mid}
            high={result.indicativeValue.high}
            currency={currency}
            askingPrice={identity.askingPrice ?? null}
            height={140}
          />
        </Section>

        {/* 4. Basis of the range */}
        <Section n={4} title="Basis of the range" subtitle="Every anchor method, its weight and its confidence">
          <TableWrap>
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Range</th>
                  <th className="px-3 py-2">Weight</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {result.anchors.map((a: ValueAnchor) => (
                  <tr key={a.id} className="border-b border-hairline last:border-0 align-top">
                    <td className="px-3 py-2 font-medium text-ink">
                      {a.label}
                      <div className="text-[11px] text-ink-muted">{titleCase(a.method)}</div>
                    </td>
                    <td className="px-3 py-2 tabular text-ink-secondary">
                      {money(a.low, currency)} – {money(a.high, currency)}
                    </td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{pct(a.weight * 100, 0)}</td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{pct(a.confidence * 100, 0)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{a.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <AnchorWeightChart anchors={result.anchors} currency={currency} />
        </Section>

        {/* 5. Market comparables */}
        <Section n={5} title="Market comparables" subtitle={`${result.comparables.length} used in this range`}>
          <TableWrap>
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
                  <th className="px-3 py-2">Comparable</th>
                  <th className="px-3 py-2">Transacted</th>
                  <th className="px-3 py-2">Area</th>
                  <th className="px-3 py-2">Raw /m²</th>
                  <th className="px-3 py-2">Adjustments</th>
                  <th className="px-3 py-2">Adjusted /m²</th>
                  <th className="px-3 py-2">Similarity</th>
                </tr>
              </thead>
              <tbody>
                {result.comparables.map((c: Comparable) => (
                  <tr key={c.id} className="border-b border-hairline last:border-0 align-top">
                    <td className="px-3 py-2 font-medium text-ink">
                      {c.label}
                      <div className="text-[11px] text-ink-muted">
                        {c.address} · {c.distanceKm.toFixed(1)} km · {c.source}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{date(c.transactedAt)}</td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{area(c.areaSqm)}</td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{perSqm(c.pricePerSqm, currency)}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {c.adjustments.length > 0
                        ? c.adjustments.map((adj) => `${adj.label} ${pct(adj.pct, 1, true)}`).join(', ')
                        : 'None'}
                    </td>
                    <td className="px-3 py-2 tabular font-medium text-ink">{perSqm(c.adjustedPricePerSqm, currency)}</td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{pct(c.similarity * 100, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <ComparablesChart comparables={result.comparables} subjectPricePerSqm={result.indicativeValue.perSqm.mid} currency={currency} />
        </Section>

        {/* 6. Value drivers */}
        <Section n={6} title="Value drivers">
          <DriverImpactChart drivers={result.drivers} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from(driversByCategory.entries()).map(([category, drivers]) => (
              <div key={category} className="rounded-lg border border-hairline p-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{titleCase(category)}</div>
                <div className="space-y-2">
                  {drivers.map((d) => (
                    <div key={d.id} className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 ${toneText(driverTone(d.direction))}`}>
                        <DriverDirectionIcon direction={d.direction} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[13px] font-medium text-ink">{d.label}</span>
                          <span className={`text-xs font-semibold ${toneText(driverTone(d.direction))}`}>{pct(d.impactPct, 1, true)}</span>
                        </div>
                        <p className="text-xs leading-relaxed text-ink-secondary">{d.explanation}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 7. Material risks */}
        <Section
          n={7}
          title="Material risks"
          subtitle="Open risks first"
          action={<Badge tone={openRisksCount > 0 ? 'critical' : 'good'}>{openRisksCount} open</Badge>}
        >
          <RiskProfileChart risks={result.risks} />
          <div className="space-y-2">
            {sortedRisks.map((r: RiskFlag) => (
              <div key={r.id} className="rounded-lg border border-hairline p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={r.severity}>{titleCase(r.severity)}</Badge>
                    <Badge tone="neutral">{titleCase(r.category)}</Badge>
                    <span className="text-[13px] font-medium text-ink">{r.title}</span>
                  </div>
                  <Badge tone={r.status === 'open' ? 'warning' : 'neutral'}>{titleCase(r.status)}</Badge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{r.description}</p>
                <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">Impact</div>
                    <p className="text-xs text-ink-secondary">{r.impact}</p>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">Mitigation</div>
                    <p className="text-xs text-ink-secondary">{r.mitigation}</p>
                  </div>
                </div>
              </div>
            ))}
            {sortedRisks.length === 0 ? <p className="text-[13px] text-ink-muted">No material risks were flagged.</p> : null}
          </div>
        </Section>

        {/* 8. Planning position */}
        <Section n={8} title="Planning position">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Zoning" value={result.planning.zoning} />
            <KeyValue label="Development potential" value={titleCase(result.planning.developmentPotential)} />
            <KeyValue label="Buildable potential" value={area(result.planning.buildablePotentialSqm)} mono />
            <KeyValue label="Source" value={result.planning.source} />
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-ink-secondary">FAR used vs allowed</span>
              <span className="tabular font-medium text-ink">
                {num(result.planning.farUsed, 2)} / {num(result.planning.farAllowed, 2)}
              </span>
            </div>
            <ProgressBar value={farRatio} showValue={false} tone={farRatio > 100 ? 'critical' : 'brand'} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Permitted uses</div>
              <div className="flex flex-wrap gap-1">
                {result.planning.permittedUses.map((u, i) => (
                  <Badge key={i} tone="neutral">
                    {u}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Restrictions</div>
              {result.planning.restrictions.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-secondary">
                  {result.planning.restrictions.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-muted">None on record.</p>
              )}
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{result.planning.statusNote}</p>
          <p className="text-[11px] text-ink-muted">Last checked {date(result.planning.lastCheckedAt)}</p>
        </Section>

        {/* 9. Document completeness */}
        <Section
          n={9}
          title="Document completeness"
          action={
            <Button variant="ghost" size="sm" onClick={() => goToTab('documents')}>
              Go to Documents
            </Button>
          }
        >
          <ProgressBar value={result.completeness.score} tone={result.completeness.score >= 80 ? 'good' : result.completeness.score >= 50 ? 'warning' : 'critical'} label="Completeness score" />
          <TableWrap>
            <table className="w-full min-w-[480px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
                  <th className="px-3 py-2">Requirement</th>
                  <th className="px-3 py-2">Required</th>
                  <th className="px-3 py-2">Present</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {result.completeness.items.map((item) => (
                  <tr key={item.key} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{item.label}</td>
                    <td className="px-3 py-2">{item.required ? <Badge tone="neutral">Required</Badge> : <span className="text-ink-muted">Optional</span>}</td>
                    <td className="px-3 py-2">
                      {item.present ? (
                        <span className="inline-flex items-center gap-1 text-[var(--status-good-text)]">
                          <Check size={13} /> Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-critical">
                          <X size={13} /> Missing
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{item.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {result.completeness.missingCritical.length > 0 ? (
            <Callout tone="critical" title="Missing critical documents">
              <ul className="list-disc pl-4">
                {result.completeness.missingCritical.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </Section>

        {/* 10. Confidence */}
        <Section n={10} title="Confidence" subtitle="Stated as arithmetic, not a black box">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Score</div>
              <div className={`text-3xl font-semibold ${toneText(confidenceTone(result.confidence.band))}`}>{result.confidence.score}<span className="text-base text-ink-muted">/100</span></div>
              <Badge tone={confidenceTone(result.confidence.band)}>{titleCase(result.confidence.band)} confidence</Badge>
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Factor breakdown</div>
              <div className="space-y-1 text-[13px]">
                {result.confidence.factors.map((f: ConfidenceFactor) => (
                  <div key={f.key} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1 last:border-0">
                    <span className="text-ink-secondary">{f.label}</span>
                    <span className={`tabular font-medium ${f.contribution >= 0 ? 'text-[var(--status-good-text)]' : 'text-critical'}`}>
                      {f.contribution >= 0 ? '+' : ''}
                      {f.contribution} pts
                    </span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 pt-1 text-[13px] font-semibold text-ink">
                  <span>Sum of factors</span>
                  <span className="tabular">{factorSum} pts</span>
                </div>
                {factorSum !== result.confidence.score ? (
                  <p className="text-[11px] text-ink-muted">Reported score ({result.confidence.score}) differs from the factor sum — a baseline or rounding term applies upstream.</p>
                ) : null}
              </div>
            </div>
          </div>
          <Callout tone="info" title="Biggest lever">
            {result.confidence.biggestLever}
          </Callout>
        </Section>

        {/* 11. Recommended actions */}
        <Section n={11} title="Recommended actions">
          <div className="space-y-4">
            {PRIORITY_ORDER.map((priority) => {
              const list = actionsByPriority.get(priority) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={priority}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{titleCase(priority)}</div>
                  <div className="space-y-2">
                    {list.map((a: RecommendedAction) => (
                      <div key={a.id} className="rounded-lg border border-hairline p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-ink">{a.title}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge tone="neutral">{titleCase(a.owner)}</Badge>
                            <Badge tone="neutral">{titleCase(a.effort)} effort</Badge>
                            <Badge tone={a.done ? 'good' : 'neutral'}>{a.done ? 'Done' : 'Open'}</Badge>
                          </div>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{a.description}</p>
                        {a.unblocks.length > 0 ? (
                          <p className="mt-1 text-[11px] text-ink-muted">Unblocks: {a.unblocks.join('; ')}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {result.actions.length === 0 ? <p className="text-[13px] text-ink-muted">No actions were recommended.</p> : null}
          </div>
        </Section>

        {/* 12. Evidence appendix */}
        {showAppendix ? (
          <Section n={12} title="Evidence appendix" subtitle={`Full ledger — ${result.evidence.length} items`}>
            <TableWrap>
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
                    <th className="px-3 py-2">Statement</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {result.evidence.map((e) => (
                    <tr key={e.id} className="border-b border-hairline last:border-0 align-top">
                      <td className="px-3 py-2 text-ink">{e.statement}</td>
                      <td className="px-3 py-2 text-ink-secondary">
                        {EVIDENCE_SOURCE_LABEL[e.sourceType]}
                        <div className="text-[11px] text-ink-muted">{e.sourceLabel}</div>
                      </td>
                      <td className="px-3 py-2 tabular text-ink-secondary">{pct(e.confidence * 100, 0)}</td>
                      <td className="px-3 py-2 tabular text-ink-secondary">{date(e.capturedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        ) : (
          <div className="no-print">
            <Callout tone="neutral" title="Evidence appendix hidden">
              Turn on “Include evidence appendix” above to add the full {result.evidence.length}-item ledger to this document, or open the{' '}
              <button type="button" className="font-medium text-brand underline" onClick={() => goToTab('evidence')}>
                Evidence tab
              </button>{' '}
              to browse it without printing it.
            </Callout>
          </div>
        )}

        {/* 13. Scope and limitations */}
        <Section n={showAppendix ? 13 : 12} title="Scope and limitations">
          <p className="text-[13px] leading-relaxed text-ink-secondary">This Property Screen report is an evidence-based indicative screen. It is not:</p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
            {OUT_OF_SCOPE.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            Every figure in this report carries an evidence trail and a confidence level rather than false precision. Use it to decide
            whether — and how — to pursue formal diligence, not as a substitute for it.
          </p>
        </Section>
      </div>
    </div>
  );
}
