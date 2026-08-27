import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardCopy,
  Download,
  FileText,
  Minus,
  Printer,
  Sparkles,
  X,
} from 'lucide-react';
import { LENS_PROFILES, buildDdGraph, buildGraphReport } from '@realytica/shared';
import type { GraphReportJudgement, LensKey, LensSection } from '@realytica/shared';
import type {
  ActionPriority,
  Comparable,
  ComplianceCheck,
  ConfidenceFactor,
  DriverCategory,
  EvidenceItem,
  RecommendedAction,
  RiskFlag,
  RiskSeverity,
  RiskStatus,
  ValueAnchor,
  ValueDriver,
} from '@realytica/shared';
import { SITE_CONSTRAINT_KEYS } from '@realytica/shared';
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
import { formatArea, formatRate, useAreaUnitFor } from '../../../lib/units';
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
import { StatutoryProvenance } from '../../../components/StatutoryProvenance';
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

const COMPLIANCE_VERDICT_RANK: Record<ComplianceCheck['verdict'], number> = {
  blocker: 0,
  attention: 1,
  unknown: 2,
  clear: 3,
};

function complianceVerdictTone(v: ComplianceCheck['verdict']): Tone {
  switch (v) {
    case 'clear':
      return 'good';
    case 'attention':
      return 'warning';
    case 'blocker':
      return 'critical';
    case 'unknown':
    default:
      return 'neutral';
  }
}

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

const CONSTRAINT_KEYS = new Set<string>(SITE_CONSTRAINT_KEYS);

const VALLEY_LABEL: Record<string, string> = {
  vrishabhavathi: 'Vrishabhavathi',
  koramangala_challaghatta: 'Koramangala–Challaghatta',
  hebbal_nagavara: 'Hebbal–Nagavara',
};

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
  /*
   * A collapsed section still prints. The lens decides what a reader opens
   * with on screen; it must not decide what a lender receives — a report is
   * only a report if it is complete.
   */
  .vly-report-print details.report-section > :not(summary),
  .vly-report-print details.print-open > :not(summary) {
    display: block !important;
  }
  .vly-report-print summary {
    list-style: none;
  }
  @page {
    margin: 14mm;
  }
}

/* Chrome/Safari still draw their own disclosure marker without this. */
details.report-section > summary::-webkit-details-marker {
  display: none;
}
`;

/**
 * How many report sections open by default, over and above the ones that
 * always do.
 *
 * Counted in *report* sections rather than lens sections, which is the fix
 * for a rule that looked right and was not: "open the lens's first four
 * sections" opened eleven of seventeen for a developer, because six report
 * sections — the range, the offer, the forced sale, the basis, the
 * comparables, the drivers — all map to `value`. Ranking the report's own
 * sections by where their lens section falls, then taking the top few, keeps
 * the promise the rule was making.
 */
const REPORT_LEAD_SECTIONS = 5;

/**
 * Sections that open under every lens.
 *
 * The cover and the recommendation because a folded verdict is not a report,
 * and the scope note because a reader must not have to click to find out what
 * this document is not.
 */
/**
 * Every section of the report, in the order it is printed, tagged with the
 * lens section it answers.
 *
 * Declared as a list rather than inferred from the JSX so the ranking below
 * can be computed once, before anything renders. The two must agree — a
 * section tagged here but not rendered simply never opens; a section rendered
 * without a tag falls through to `'evidence'`, the least-privileged rank, and
 * starts folded, which is the safe direction to fail in.
 */
const REPORT_SECTION_ORDER: { id: string; section: LensSection | 'always' }[] = [
  { id: 'cover', section: 'always' },
  { id: 'recommendation', section: 'always' },
  { id: 'value', section: 'value' },
  { id: 'offer', section: 'offer' },
  { id: 'forcedSale', section: 'value' },
  { id: 'basis', section: 'value' },
  { id: 'comparables', section: 'value' },
  { id: 'drivers', section: 'value' },
  { id: 'risks', section: 'risks' },
  { id: 'compliance', section: 'compliance' },
  { id: 'costs', section: 'costs' },
  { id: 'constraints', section: 'constraints' },
  { id: 'planning', section: 'planning' },
  { id: 'completeness', section: 'documents' },
  { id: 'confidence', section: 'evidence' },
  { id: 'traceability', section: 'evidence' },
  { id: 'actions', section: 'actions' },
  { id: 'appendix', section: 'evidence' },
  { id: 'scope', section: 'always' },
];

/**
 * At most this many report sections per lens section may open.
 *
 * Without it a developer opened five sections and every one of them was
 * `value` — the range, the forced sale, the basis, the comparables and the
 * drivers — while "What to offer", the thing a developer opens the report
 * for, stayed folded behind them. One lens section must not be able to spend
 * the whole budget.
 */
const MAX_OPEN_PER_SECTION = 2;

/**
 * Decide which sections a reader opens with.
 *
 * Walk this reader's lens sections in their order, take up to two report
 * sections from each in document order, and stop once the budget is spent.
 * `always` sections are outside the count.
 */
function makeOpenFor(lens: LensKey, expandAll: boolean): (id: string) => boolean {
  if (expandAll) return () => true;
  const open = new Set<string>(REPORT_SECTION_ORDER.filter(r => r.section === 'always').map(r => r.id));
  let budget = REPORT_LEAD_SECTIONS;
  for (const lensSection of LENS_PROFILES[lens].sections) {
    if (budget <= 0) break;
    const inSection = REPORT_SECTION_ORDER.filter(r => r.section === lensSection);
    for (const report of inSection.slice(0, MAX_OPEN_PER_SECTION)) {
      if (budget <= 0) break;
      open.add(report.id);
      budget -= 1;
    }
  }
  return (id: string) => open.has(id);
}

/**
 * One numbered section of the report.
 *
 * Collapsible on screen, never in print. The report reproduces every section
 * of a screen — nineteen of them, most of a metre of scroll — because a
 * report has to be complete: a section left out of a document someone sends
 * to a lender is a section that does not exist. But complete is not the same
 * as all-open, and which sections a reader opens with depends on which reader
 * they are, so `open` comes from the lens.
 *
 * The collapse is a `<details>` rather than conditional rendering, for one
 * reason that matters more than it looks: the browser's own find-in-page and
 * the print stylesheet can both reach inside a closed `<details>`, and cannot
 * reach content React never rendered. A collapsed section is still in the
 * document, still printed, still findable — folded, not filtered, which is
 * the same rule the lenses follow everywhere else.
 */
function Section({
  n,
  title,
  subtitle,
  action,
  open,
  children,
}: {
  n: number;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Whether this section starts expanded. The reader can still open any of them. */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <details open={open !== false} className="report-section group">
        <summary className="cursor-pointer list-none">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <span className="text-ink-muted">{String(n).padStart(2, '0')}</span>
                {title}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="no-print text-ink-faint transition-transform duration-base group-open:rotate-180"
                />
              </span>
            }
            subtitle={subtitle}
            action={action}
          />
        </summary>
        <CardBody className="space-y-3">{children}</CardBody>
      </details>
    </Card>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg ring-1 ring-[var(--ring)]">{children}</div>;
}

const COMPLIANCE_VERDICT_LABEL: Record<ComplianceCheck['verdict'], string> = {
  clear: 'Clear',
  attention: 'Attention',
  blocker: 'Blocker',
  unknown: 'Unknown',
};

/** One Karnataka compliance check, printed with the same fields as the Compliance tab card. */
function ComplianceCheckRow({ check }: { check: ComplianceCheck }) {
  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={complianceVerdictTone(check.verdict)}>{COMPLIANCE_VERDICT_LABEL[check.verdict]}</Badge>
        <span className="text-[13px] font-medium text-ink">{check.label}</span>
        <span className="ml-auto rounded bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-secondary">
          {check.statute}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{check.finding}</p>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">Consequence</div>
          <p className="text-xs text-ink-secondary">{check.consequence}</p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">Next step</div>
          <p className="text-xs text-ink-secondary">{check.nextStep}</p>
        </div>
      </div>
    </div>
  );
}

function judgementTone(j: GraphReportJudgement): Tone {
  const { severity, verdict } = j.node.attributes;
  if (severity === 'critical' || verdict === 'blocker') return 'critical';
  if (severity === 'serious') return 'serious';
  if (severity === 'warning' || verdict === 'attention') return 'warning';
  if (verdict === 'clear') return 'good';
  return 'neutral';
}

/**
 * One conclusion, printed with the chain the graph actually holds behind it.
 * The chain reads claims-then-files because that is the direction a reviewer
 * checks it: what was said, then where it was said. An empty chain is stated
 * in words — the one thing this section exists to make impossible is a
 * conclusion whose support cannot be seen.
 */
function TracedJudgementRow({ judgement }: { judgement: GraphReportJudgement }) {
  const { node, claims, evidence, contradictions, unevidenced } = judgement;
  const badge = (node.attributes.verdict ?? node.attributes.severity ?? node.kind) as string;
  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={judgementTone(judgement)}>{titleCase(badge)}</Badge>
        <Badge tone="neutral">{titleCase(node.kind)}</Badge>
        <span className="text-[13px] font-medium text-ink">{node.label}</span>
      </div>
      {claims.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {claims.map((c) => (
            <li key={c.id} className="text-xs leading-relaxed text-ink-secondary">
              — {c.label}
              {typeof c.attributes.sourceLabel === 'string' && c.attributes.sourceLabel ? (
                <span className="text-ink-faint"> ({c.attributes.sourceLabel})</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.length > 0 ? (
        <p className="mt-1 text-[11px] text-ink-muted">On file: {evidence.map((e) => e.label).join(' · ')}</p>
      ) : null}
      {contradictions.map((c) => (
        <p key={c.id} className="mt-1 text-[11px] font-medium text-critical">
          Live contradiction in this chain: {c.label}
        </p>
      ))}
      {unevidenced ? (
        <p className="mt-1 text-[11px] text-ink-muted">
          No evidence chain in the graph derives this conclusion — it rests on the screen's own computation, not on a
          document on file.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export default function ReportTab({ caseData, result, runScreen, running, goToTab, lens }: TabProps) {
  const toast = useToast();
  const areaUnit = useAreaUnitFor(caseData.identity.country);
  const unitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';
  const [showAppendix, setShowAppendix] = useState(false);
  const [expandAll, setExpandAll] = useState(false);

  /*
   * The report as a graph traversal: every department's conclusions with the
   * evidence chain the DD graph actually holds behind each one. Built here
   * from the case itself — the graph is a deterministic projection, so the
   * printed trace and the copilot's trace_conclusion answer are one query.
   */
  const graphReport = useMemo(() => buildGraphReport(buildDdGraph(caseData, caseData.updatedAt)), [caseData]);

  /*
   * Which sections this reader opens with.
   *
   * The report carries all nineteen — that is what makes it a report — but a
   * developer opening it to nineteen expanded sections has to scroll past the
   * planning envelope to reach the offer, and an architect has to scroll past
   * the offer to reach the envelope. The lens's leading sections start open;
   * the rest start folded, one click and a find-in-page away, and always
   * printed.
   */
  const openFor = makeOpenFor(lens, expandAll);

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
      `REALYTICA PROPERTY SCREEN — ${caseData.reference}`,
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

  // The State / Municipality Pack sections only exist for a state a pack covers
  // (Karnataka in this release) — both are inserted together, or neither is,
  // and every later section number shifts by this amount.
  const stateCompliance = result.stateCompliance ?? null;
  const transactionCosts = result.transactionCosts ?? null;
  const hasStatePack = Boolean(stateCompliance);

  /*
   * Section numbers are counted, not written.
   *
   * They used to be literals with a `+ extra` offset that modelled exactly
   * two conditional sections — which meant every insertion renumbered the
   * whole document by hand, and any third conditional section would have
   * silently produced a report with two sections numbered the same. A
   * counter is correct for any number of them, and makes adding a section a
   * one-line change instead of a fourteen-line one.
   *
   * Reset on every render because the component re-runs top to bottom, and a
   * counter that survived a render would climb forever.
   */
  let sectionCount = 0;
  const nextSection = (): number => (sectionCount += 1);

  // Constraints are pulled out of the compliance list so they can be reported
  // together with the flood exposure they belong beside — and so the count of
  // unchecked ones is visible on the section header rather than buried in six
  // rows a reader has to tally themselves.
  const constraintChecks = (stateCompliance?.checks ?? []).filter((c) => CONSTRAINT_KEYS.has(c.key));
  const uncheckedConstraints = constraintChecks.filter((c) => c.verdict === 'unknown').length;
  const complianceBlockers = stateCompliance ? stateCompliance.checks.filter((c) => c.verdict === 'blocker') : [];
  // Constraints are excluded here because they get their own section below.
  // They are also not title checks: the compliance section asks whether this
  // can be transferred to you, and a transmission corridor has nothing to say
  // about that. A blocking constraint would still surface in the blockers
  // group above, which is deliberate — a blocker is a blocker wherever it
  // came from.
  const complianceRest = stateCompliance
    ? [...stateCompliance.checks]
        .filter((c) => c.verdict !== 'blocker' && !CONSTRAINT_KEYS.has(c.key))
        .sort((a, b) => COMPLIANCE_VERDICT_RANK[a.verdict] - COMPLIANCE_VERDICT_RANK[b.verdict])
    : [];
  const complianceUnresolved = stateCompliance
    ? stateCompliance.unresolved.map((keyOrLabel) => {
        const match = stateCompliance.checks.find((c) => c.key === keyOrLabel || c.label === keyOrLabel);
        return match ? match.label : keyOrLabel;
      })
    : [];

  return (
    <div className="vly-report-print mx-auto max-w-4xl">
      <style>{PRINT_STYLE}</style>

      {/* toolbar */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">Property Screen report</h1>
          <p className="text-xs text-ink-secondary">{caseData.reference} · generated {date(result.generatedAt, 'long')}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Opened for the <span className="font-medium text-ink-secondary">{LENS_PROFILES[lens].label.toLowerCase()}</span>:{' '}
            {LENS_PROFILES[lens].question} Every section is in the document and every section prints — the folded ones are
            the ones another reader came for.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={expandAll} onChange={setExpandAll} label="Expand every section" size="sm" />
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
        {/* Cover */}
        <Section n={nextSection()} title="Cover" open={openFor('cover')}>
          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">Realytica Property Screen</div>
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

        {/* Recommendation */}
        <Section n={nextSection()} title="Recommendation" open={openFor('recommendation')}>
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

        {/* Indicative value */}
        <Section n={nextSection()} title="Indicative value" subtitle="A range, never a point — uncertainty is the point" open={openFor('value')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Range" value={`${money(result.indicativeValue.low, currency)} – ${money(result.indicativeValue.high, currency)}`} />
            <KeyValue label="Mid" value={money(result.indicativeValue.mid, currency)} mono />
            <KeyValue label="Spread" value={`± ${pct(result.indicativeValue.spreadPct, 1)}`} mono />
            <KeyValue
              label="Asking vs mid"
              value={result.indicativeValue.askingVsMidPct != null ? pct(result.indicativeValue.askingVsMidPct, 1, true) : '—'}
              mono
            />
            <KeyValue label={`Per ${unitLabel} — low`} value={formatRate(result.indicativeValue.perSqm.low, areaUnit, currency)} mono />
            <KeyValue label={`Per ${unitLabel} — mid`} value={formatRate(result.indicativeValue.perSqm.mid, areaUnit, currency)} mono />
            <KeyValue label={`Per ${unitLabel} — high`} value={formatRate(result.indicativeValue.perSqm.high, areaUnit, currency)} mono />
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

        {/*
          * What to offer.
          *
          * Placed immediately after the range and before the working, because
          * this is the section the reader opened the report for. Everything
          * from here to the appendix explains how it was reached.
          */}
        {result.offer && (
          <Section
            n={nextSection()}
            title="What to offer"
          open={openFor('offer')}
            subtitle="Three prices, and the argument for each"
            action={
              <Badge tone={result.offer.stance === 'do_not_offer' ? 'critical' : result.offer.stance === 'offer_conditionally' ? 'warning' : 'good'}>
                {result.offer.stance === 'do_not_offer' ? 'Do not offer yet' : result.offer.stance === 'offer_conditionally' ? 'Conditional' : 'Ready to offer'}
              </Badge>
            }
          >
            <Callout
              tone={result.offer.stance === 'do_not_offer' ? 'critical' : result.offer.stance === 'offer_conditionally' ? 'warning' : 'good'}
            >
              {result.offer.headline}
            </Callout>
            {/* Two across, not four: KeyValue lays label and value on one
                line, and "Cash needed at settle" in a quarter-width column
                truncates the number it exists to show. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <KeyValue label="Open at" value={money(result.offer.opening, currency)} mono />
              <KeyValue label="Settle at" value={money(result.offer.target, currency)} mono />
              <KeyValue label="Walk away above" value={money(result.offer.walkAway, currency)} mono />
              <KeyValue label="Cash needed at settle" value={money(result.offer.allInAtTarget, currency)} mono />
            </div>
            {result.offer.arguments.length > 0 && (
              <TableWrap>
                <table className="w-full min-w-[560px] border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-sunken text-left">
                      <th className="px-3 py-2 font-medium text-ink-secondary">Point</th>
                      <th className="px-3 py-2 text-right font-medium text-ink-secondary">Effect</th>
                      <th className="px-3 py-2 font-medium text-ink-secondary">Argument</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.offer.arguments.map((a) => (
                      <tr key={a.key} className="border-t border-hairline align-top">
                        <td className="px-3 py-2 font-medium text-ink">{a.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                          {a.amount !== null ? money(a.amount, currency) : <span className="text-ink-muted">no deduction</span>}
                        </td>
                        <td className="px-3 py-2 leading-relaxed text-ink-secondary">{a.argument}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {result.offer.preconditions.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
                  Must be true before any offer
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
                  {result.offer.preconditions.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.offer.unpriced.length > 0 && (
              <Callout tone="warning" title="Not deducted above, and not zero">
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
                  {result.offer.unpriced.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </Callout>
            )}
          </Section>
        )}

        {/* What it would fetch under duress */}
        {result.forcedSale && (
          <Section
            n={nextSection()}
            title="Value under a forced sale"
          open={openFor('forcedSale')}
            subtitle={`What this would realise inside ${result.forcedSale.marketingPeriodDays} days`}
            action={<Badge tone={result.forcedSale.lendable ? 'neutral' : 'critical'}>{result.forcedSale.lendable ? `−${result.forcedSale.discountPct}%` : 'Not a lending figure'}</Badge>}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KeyValue label="Forced-sale value" value={money(result.forcedSale.value, currency)} mono />
              <KeyValue label="Discount from mid" value={`− ${pct(result.forcedSale.discountPct, 1)}`} mono />
              <KeyValue label="Marketing window" value={`${result.forcedSale.marketingPeriodDays} days`} mono />
            </div>
            <Callout tone={result.forcedSale.lendable ? 'info' : 'critical'}>{result.forcedSale.basis}</Callout>
            <TableWrap>
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="bg-sunken text-left">
                    <th className="px-3 py-2 font-medium text-ink-secondary">Component</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Discount</th>
                    <th className="px-3 py-2 font-medium text-ink-secondary">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {result.forcedSale.components.map((c) => (
                    <tr key={c.key} className="border-t border-hairline align-top">
                      <td className="px-3 py-2 font-medium text-ink">{c.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">− {pct(c.pct, 1)}</td>
                      <td className="px-3 py-2 leading-relaxed text-ink-secondary">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        )}

        {/* Basis of the range */}
        <Section n={nextSection()} title="Basis of the range" open={openFor('basis')}>
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

        {/* Market comparables */}
        <Section n={nextSection()} title="Market comparables" subtitle={`${result.comparables.length} used in this range`} open={openFor('comparables')}>
          <TableWrap>
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
                  <th className="px-3 py-2">Comparable</th>
                  <th className="px-3 py-2">Transacted</th>
                  <th className="px-3 py-2">Area</th>
                  <th className="px-3 py-2">{`Raw /${unitLabel}`}</th>
                  <th className="px-3 py-2">Adjustments</th>
                  <th className="px-3 py-2">{`Adjusted /${unitLabel}`}</th>
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
                    <td className="px-3 py-2 tabular text-ink-secondary">{formatArea(c.areaSqm, areaUnit)}</td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{formatRate(c.pricePerSqm, areaUnit, currency)}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {c.adjustments.length > 0
                        ? c.adjustments.map((adj) => `${adj.label} ${pct(adj.pct, 1, true)}`).join(', ')
                        : 'None'}
                    </td>
                    <td className="px-3 py-2 tabular font-medium text-ink">{formatRate(c.adjustedPricePerSqm, areaUnit, currency)}</td>
                    <td className="px-3 py-2 tabular text-ink-secondary">{pct(c.similarity * 100, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <ComparablesChart comparables={result.comparables} subjectPricePerSqm={result.indicativeValue.perSqm.mid} currency={currency} />
        </Section>

        {/* Value drivers */}
        <Section n={nextSection()} title="Value drivers" open={openFor('drivers')}>
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

        {/* Material risks */}
        <Section
          n={nextSection()}
          title="Material risks"
          open={openFor('risks')}

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

        {/* State compliance (Karnataka) — only when a State Pack covers this property's state */}
        {stateCompliance ? (
          <Section
            n={nextSection()}
            title={`State compliance (${stateCompliance.state})`}
          open={openFor('compliance')}
            subtitle="Title and municipal checks specific to this state — not a legal opinion or certified title report"
            action={<Badge tone={complianceBlockers.length > 0 ? 'critical' : 'good'}>{complianceBlockers.length} blocker{complianceBlockers.length === 1 ? '' : 's'}</Badge>}
          >
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Compliance score</div>
                <div className="text-3xl font-semibold text-ink">
                  {stateCompliance.score}
                  <span className="text-base text-ink-muted">/100</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                <KeyValue label="Clear" value={stateCompliance.checks.filter((c) => c.verdict === 'clear').length} mono />
                <KeyValue label="Attention" value={stateCompliance.checks.filter((c) => c.verdict === 'attention').length} mono />
                <KeyValue label="Blocker" value={complianceBlockers.length} mono />
                <KeyValue label="Unknown" value={stateCompliance.checks.filter((c) => c.verdict === 'unknown').length} mono />
              </div>
            </div>

            {complianceBlockers.length > 0 ? (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-critical">
                  Blockers — resolve before proceeding
                </div>
                <div className="space-y-2">
                  {complianceBlockers.map((c) => (
                    <ComplianceCheckRow key={c.key} check={c} />
                  ))}
                </div>
              </div>
            ) : (
              <Callout tone="good" title="No blockers found">
                None of the applicable checks came back as a hard blocker.
              </Callout>
            )}

            {complianceRest.length > 0 ? (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Other checks</div>
                <div className="space-y-2">
                  {complianceRest.map((c) => (
                    <ComplianceCheckRow key={c.key} check={c} />
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Unresolved checks</div>
              {complianceUnresolved.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
                  {complianceUnresolved.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-muted">Every applicable check could be resolved from what was supplied.</p>
              )}
            </div>

            <StatutoryProvenance
              asOf={stateCompliance.rulesAsOf}
              source={`${stateCompliance.state} State Pack — ${stateCompliance.statePackId}`}
              verifyNote={stateCompliance.verifyNote}
            />
          </Section>
        ) : null}

        {/* Indicative acquisition costs — only alongside state compliance */}
        {transactionCosts ? (
          <Section
            n={nextSection()}
            title="Indicative acquisition costs"
          open={openFor('costs')}
            subtitle="Stamp duty, cess, surcharge and registration on top of the price"
          >
            <Callout tone="info" title="Duty is charged on the higher of price and guidance value">
              Stamp duty and registration fees are computed on whichever is higher: the agreed sale consideration or
              the government&rsquo;s statutory guidance value for the locality — never on the lower figure.
            </Callout>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KeyValue
                label="Dutiable value"
                value={money(transactionCosts.dutiableValue, transactionCosts.currency)}
                mono
              />
              <KeyValue
                label="Basis used"
                value={transactionCosts.dutiableBasis === 'statutory_guidance_value' ? 'Guidance value' : 'Sale consideration'}
              />
              <KeyValue label="Total cost" value={money(transactionCosts.total, transactionCosts.currency)} mono />
              <KeyValue label="As % of price" value={pct(transactionCosts.totalPctOfPrice, 1)} mono />
            </div>
            <TableWrap>
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.05em] text-ink-muted">
                    <th className="px-3 py-2">Line item</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionCosts.lines.map((line) => (
                    <tr key={line.key} className="border-b border-hairline last:border-0 align-top">
                      <td className="px-3 py-2 font-medium text-ink">{line.label}</td>
                      <td className="px-3 py-2 tabular text-ink-secondary">{line.pct != null ? pct(line.pct, 2) : '—'}</td>
                      <td className="px-3 py-2 text-ink-secondary">{line.note}</td>
                      <td className="px-3 py-2 tabular font-medium text-ink">{money(line.amount, transactionCosts.currency, { compact: false })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="px-3 py-2 text-[13px] font-semibold text-ink" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 tabular text-[13px] font-semibold text-ink">
                      {money(transactionCosts.total, transactionCosts.currency, { compact: false })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
            <StatutoryProvenance asOf={transactionCosts.asOf} source={transactionCosts.source} verifyNote={transactionCosts.verifyNote} />
          </Section>
        ) : null}

        {/*
          * What restricts the parcel other than its title.
          *
          * Sits between the compliance checks and the planning position
          * because it belongs to both: these are the reasons the planning
          * position may not be achievable, and none of them is in a deed.
          */}
        {(result.waterExposure || constraintChecks.length > 0) && (
          <Section
            n={nextSection()}
            title="Restrictions beyond title"
          open={openFor('constraints')}
            subtitle="Flooding, and the statutory constraints no deed will mention"
            action={
              uncheckedConstraints > 0 ? <Badge tone="neutral">{uncheckedConstraints} unchecked</Badge> : undefined
            }
          >
            {result.waterExposure && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <KeyValue label="Flood exposure" value={titleCase(result.waterExposure.floodExposure)} />
                  <KeyValue label="Valley system" value={VALLEY_LABEL[result.waterExposure.valley]} />
                  <KeyValue label="Lake chain" value={result.waterExposure.lakeChain} />
                </div>
                <Callout tone="info" title="This describes the locality, not this parcel">
                  A site on high ground in a high-exposure locality does not flood, and a site on a filled tank bed in a
                  low-exposure one may flood every year. Levels for this survey number against the nearest drain are the
                  only thing that answers it for this property.
                </Callout>
                <p className="text-[13px] leading-relaxed text-ink-secondary">{result.waterExposure.note}</p>
                {result.waterExposure.knownInundationPoints.length > 0 && (
                  <KeyValue label="Reported inundation nearby" value={result.waterExposure.knownInundationPoints.join(' · ')} />
                )}
                <StatutoryProvenance
                  asOf={result.waterExposure.asOf}
                  source={result.waterExposure.source}
                  verifyNote={result.waterExposure.verifyNote}
                />
              </>
            )}
            {constraintChecks.map((check) => (
              <ComplianceCheckRow key={check.key} check={check} />
            ))}
          </Section>
        )}

        {/* Planning position */}
        <Section n={nextSection()} title="Planning position" open={openFor('planning')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KeyValue label="Zoning" value={result.planning.zoning} />
            <KeyValue label="Development potential" value={titleCase(result.planning.developmentPotential)} />
            <KeyValue label="Buildable potential" value={formatArea(result.planning.buildablePotentialSqm, areaUnit)} mono />
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

        {/* Document completeness */}
        <Section
          n={nextSection()}
          title="Document completeness"
          open={openFor('completeness')}
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

        {/* Confidence */}
        <Section n={nextSection()} title="Confidence" subtitle="Stated as arithmetic, not a black box" open={openFor('confidence')}>
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

        {/* Conclusions with their derivation — the report as a graph traversal */}
        {graphReport.sections.length > 0 ? (
          <Section
            n={nextSection()}
            title="Findings by department, each with its evidence chain"
            subtitle={
              `${graphReport.totals.judgements} conclusion${graphReport.totals.judgements === 1 ? '' : 's'}` +
              (graphReport.totals.unevidenced > 0 ? ` · ${graphReport.totals.unevidenced} with no evidence chain` : '') +
              (graphReport.totals.contradictions > 0 ? ` · ${graphReport.totals.contradictions} live contradiction${graphReport.totals.contradictions === 1 ? '' : 's'}` : '')
            }
            open={openFor('traceability')}
          >
            <div className="space-y-4">
              {graphReport.sections.map((section) => (
                <div key={section.domain}>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{section.label}</span>
                    <span className="text-[11px] text-ink-faint">{section.question}</span>
                  </div>
                  <div className="space-y-2">
                    {section.judgements.map((j) => (
                      <TracedJudgementRow key={j.node.id} judgement={j} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Recommended actions */}
        <Section n={nextSection()} title="Recommended actions" open={openFor('actions')}>
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

        {/* Evidence appendix */}
        {showAppendix ? (
          <Section n={nextSection()} title="Evidence appendix" subtitle={`Full ledger — ${result.evidence.length} items`} open={openFor('appendix')}>
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

        {/* Scope and limitations */}
        <Section n={nextSection()} title="Scope and limitations" open={openFor('scope')}>
          <p className="text-[13px] leading-relaxed text-ink-secondary">This Property Screen report is an evidence-based indicative screen. It is not:</p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-secondary">
            {OUT_OF_SCOPE.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          {/* Named because a reader will not go looking for what a screen
              cannot see, and this class of risk is the one sellers exploit:
              side agreements signed with several buyers and never registered
              are invisible to every records-based check in this report. */}
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            <span className="font-semibold text-ink">What no records-based screen can see: </span>
            an agreement to sell that was signed but never registered, an oral family arrangement, or a dispute that has not reached a
            court leaves no trace in the registered record, the encumbrance certificate, or any portal this screen reads. Physical
            possession, a public-notice advertisement before purchase, and enquiries with neighbours and the local Sub-Registrar are the
            only checks that reach it — none of which this report replaces.
          </p>
          {!result.waterExposure && (
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              <span className="font-semibold text-ink">Not assessed in this report: </span>
              flood and storm-water exposure for {caseData.identity.locality} — no catchment classification is carried for this locality
              yet, and an unassessed exposure is not a clear one.
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            Every figure in this report carries an evidence trail and a confidence level rather than false precision. Use it to decide
            whether — and how — to pursue formal diligence, not as a substitute for it.
          </p>
        </Section>
      </div>
    </div>
  );
}
