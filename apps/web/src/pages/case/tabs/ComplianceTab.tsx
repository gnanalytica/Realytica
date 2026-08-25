import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Filter,
  HelpCircle,
  MapPinned,
  Receipt,
  ScrollText,
  XCircle,
} from 'lucide-react';
import type { ComplianceCheck, ComplianceVerdict, EvidenceItem, TransactionCostBreakdown } from '@valytica/shared';
import type { TabProps } from '../tab-props';
import { StatutoryProvenance } from '../../../components/StatutoryProvenance';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { money, pct } from '../../../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ProgressBar,
  Select,
  Stat,
  TONE_ICON,
  Toggle,
  cn,
  type Tone,
} from '../../../components/ui/kit';

/* ------------------------------------------------------------------ */
/* Verdict presentation                                                */
/* ------------------------------------------------------------------ */

const VERDICT_TONE: Record<ComplianceVerdict, Tone> = {
  clear: 'good',
  attention: 'warning',
  blocker: 'critical',
  unknown: 'neutral',
};

const VERDICT_TEXT: Record<ComplianceVerdict, string> = {
  clear: 'Clear',
  attention: 'Attention',
  blocker: 'Blocker',
  unknown: 'Unknown',
};

const VERDICT_RANK: Record<ComplianceVerdict, number> = { blocker: 0, attention: 1, unknown: 2, clear: 3 };

type RestFilter = 'all' | 'attention' | 'unknown' | 'clear';

function complianceBand(score: number, blockerCount: number): { label: string; tone: Tone } {
  if (blockerCount > 0) {
    return { label: `${blockerCount} blocker${blockerCount === 1 ? '' : 's'} — do not proceed yet`, tone: 'critical' };
  }
  if (score >= 85) return { label: 'Clear to proceed', tone: 'good' };
  if (score >= 60) return { label: 'Proceed with caution', tone: 'warning' };
  return { label: 'Material concerns', tone: 'serious' };
}

/** Small, dense two-column block used for Consequence / Next step inside a check card. */
function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-sunken p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      <p className="text-xs leading-relaxed text-ink-secondary">{children}</p>
    </div>
  );
}

function ComplianceCheckCard({
  check,
  emphasize,
  evidence,
  onOpenEvidence,
  onJumpToRisks,
}: {
  check: ComplianceCheck;
  emphasize?: boolean;
  evidence: EvidenceItem[];
  onOpenEvidence: (ids: string[]) => void;
  onJumpToRisks: () => void;
}) {
  const tone = VERDICT_TONE[check.verdict];
  const Icon = TONE_ICON[tone];
  return (
    <Card className={cn(emphasize && 'ring-2 ring-critical/50')}>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={tone} icon={<Icon size={11} />}>
            {VERDICT_TEXT[check.verdict]}
          </Badge>
          <span className="text-[13px] font-semibold text-ink">{check.label}</span>
          <span
            className="ml-auto rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
            title="Governing statute / rule"
          >
            {check.statute}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-ink">{check.finding}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoBlock title="Consequence">{check.consequence}</InfoBlock>
          <InfoBlock title="Next step">{check.nextStep}</InfoBlock>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5">
          <EvidenceLink ids={check.evidenceIds} evidence={evidence} onOpen={onOpenEvidence} />
          {check.relatedRiskIds.length > 0 ? (
            <Button variant="ghost" size="sm" icon={<ArrowRight size={13} />} onClick={onJumpToRisks}>
              {check.relatedRiskIds.length} related risk{check.relatedRiskIds.length === 1 ? '' : 's'}
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
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

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export default function ComplianceTab({ caseData, result, runScreen, running, goToTab }: TabProps) {
  const navigate = useNavigate();
  const [restFilter, setRestFilter] = useState<RestFilter>('all');
  const [hideClear, setHideClear] = useState(false);

  const openEvidence = (ids: string[]) => {
    navigate(`/cases/${caseData.id}/evidence?evidence=${encodeURIComponent(ids.join(','))}`);
  };

  const compliance = result?.stateCompliance ?? null;
  const costs = result?.transactionCosts ?? null;

  const counts = useMemo(() => {
    const c: Record<ComplianceVerdict, number> = { clear: 0, attention: 0, blocker: 0, unknown: 0 };
    if (!compliance) return c;
    for (const check of compliance.checks) c[check.verdict] += 1;
    return c;
  }, [compliance]);

  const blockers = useMemo(
    () => (compliance ? compliance.checks.filter((c) => c.verdict === 'blocker') : []),
    [compliance],
  );

  // Blockers always render in their own group above and are never hidden by the
  // filters below — a filter is a convenience for browsing routine checks, not
  // a way to make a blocking title issue disappear.
  const rest = useMemo(() => {
    if (!compliance) return [];
    return compliance.checks
      .filter((c) => c.verdict !== 'blocker')
      .filter((c) => restFilter === 'all' || c.verdict === restFilter)
      .filter((c) => !(hideClear && c.verdict === 'clear'))
      .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
  }, [compliance, restFilter, hideClear]);

  const unresolved = useMemo(() => {
    if (!compliance) return [];
    return compliance.unresolved.map((keyOrLabel) => {
      const match = compliance.checks.find((c) => c.key === keyOrLabel || c.label === keyOrLabel);
      return { text: match ? match.label : keyOrLabel, check: match ?? null };
    });
  }, [compliance]);

  if (!result) {
    return (
      <EmptyState
        icon={<ScrollText size={28} />}
        title="Not screened yet"
        description="Run the screen to surface state-specific title compliance — khata classification, land conversion, buffer distances and RERA registration — each with a plain-language finding, consequence and next step."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  if (!compliance) {
    const stateName = caseData.identity.state || 'this property’s state';
    return (
      <Card>
        <CardHeader title="Compliance" icon={<ScrollText size={16} />} />
        <CardBody>
          <EmptyState
            icon={<MapPinned size={28} />}
            title={`No State Pack covers ${stateName} yet`}
            description={
              <>
                Valytica&rsquo;s state-specific title and compliance checks — khata classification, land conversion,
                buffer distances, stamp duty — are built state by state. <strong className="text-ink">Karnataka /
                Bengaluru</strong> is the covered State / Municipality Pack in this release; {stateName} does not yet
                have one. The general risk, valuation, planning and completeness checks in the other tabs still apply
                to this case.
              </>
            }
          />
        </CardBody>
      </Card>
    );
  }

  const band = complianceBand(compliance.score, blockers.length);
  const filtersActive = restFilter !== 'all' || hideClear;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card>
        <CardHeader
          title={`${compliance.state} title & compliance screen`}
          subtitle="A documentary title screen, not a legal opinion or certified title report"
          icon={<ScrollText size={16} />}
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm flex-1">
              <ProgressBar value={compliance.score} tone={band.tone} label="Compliance score" />
              <Badge tone={band.tone} className="mt-2">
                {band.label}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Clear" value={counts.clear} tone="good" />
              <Stat label="Attention" value={counts.attention} tone="warning" />
              <Stat label="Blocker" value={counts.blocker} tone="critical" />
              <Stat label="Unknown" value={counts.unknown} tone="neutral" />
            </div>
          </div>
          <StatutoryProvenance
            asOf={compliance.rulesAsOf}
            source={`${compliance.state} State Pack — ${compliance.statePackId}`}
            verifyNote={compliance.verifyNote}
          />
        </CardBody>
      </Card>

      {/* Blockers first — never sorted below routine checks */}
      {blockers.length > 0 ? (
        <Card className="ring-2 ring-critical/50">
          <CardHeader
            title={`${blockers.length} blocker${blockers.length === 1 ? '' : 's'} found`}
            subtitle="Resolve these before spending on lawyers, a survey or a loan application"
            icon={<XCircle size={16} className="text-critical" />}
          />
          <CardBody className="flex flex-col gap-3">
            <Callout tone="critical" title="These stop a clean transaction under current Karnataka rules">
              A blocker is a finding severe enough to jeopardise financing, resale or registration outright — for
              example a B-khata classification or unconverted agricultural land. Get professional advice on each one
              before committing further time or money.
            </Callout>
            {blockers.map((check) => (
              <ComplianceCheckCard
                key={check.key}
                check={check}
                emphasize
                evidence={result.evidence}
                onOpenEvidence={openEvidence}
                onJumpToRisks={() => goToTab('risks')}
              />
            ))}
          </CardBody>
        </Card>
      ) : (
        <Callout tone="good" title="No blockers found">
          None of the applicable Karnataka title checks came back as a hard blocker. Review the checks below — an
          &ldquo;attention&rdquo; or &ldquo;unknown&rdquo; verdict can still be material.
        </Callout>
      )}

      {/* Unresolved checks — uncertainty must be visible, not buried */}
      <Card>
        <CardHeader
          title="Unresolved checks"
          subtitle="What the screen could not answer from what has been supplied so far"
          icon={<HelpCircle size={16} />}
        />
        <CardBody>
          {unresolved.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">Every applicable Karnataka check could be resolved one way or another.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {unresolved.map((u, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-2 rounded-lg bg-sunken p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{u.text}</p>
                    {u.check ? <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{u.check.finding}</p> : null}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    icon={<ArrowRight size={13} />}
                    onClick={() => goToTab('documents')}
                  >
                    Supply documents
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Filters + remaining checks — hidden entirely when every check is already a blocker above */}
      {compliance.checks.length > blockers.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Filter size={13} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <div className="w-44">
              <Select
                aria-label="Filter by verdict"
                value={restFilter}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setRestFilter(e.target.value as RestFilter)}
              >
                <option value="all">All verdicts</option>
                <option value="attention">Attention</option>
                <option value="unknown">Unknown</option>
                <option value="clear">Clear</option>
              </Select>
            </div>
            <Toggle checked={hideClear} onChange={setHideClear} label="Hide clear checks" size="sm" />
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRestFilter('all');
                  setHideClear(false);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          {rest.length === 0 ? (
            <EmptyState
              icon={<Filter size={24} />}
              title="No checks match these filters"
              description="Try widening the verdict filter or turning off “hide clear checks”."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {rest.map((check) => (
                <ComplianceCheckCard
                  key={check.key}
                  check={check}
                  evidence={result.evidence}
                  onOpenEvidence={openEvidence}
                  onJumpToRisks={() => goToTab('risks')}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Acquisition costs */}
      {costs ? <AcquisitionCostCard costs={costs} askingPrice={caseData.identity.askingPrice} /> : null}
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
        <Callout tone="info" title="Duty is charged on the higher of price and guidance value">
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
