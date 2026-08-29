import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import type { Comparable, CurrencyCode, MethodRole, ProjectKind, ReferenceData } from '@realytica/shared';
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ProgressBar,
  SectionTitle,
  Stat,
  cn,
} from '../../../components/ui/kit';
import { AnchorWeightChart, ComparablesChart, ResidualWaterfallChart, ValueRangeChart } from '../../../components/charts';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { AssessmentMethodCard } from '../../../components/AssessmentMethodCard';
import { JdSplitCard } from '../../../components/JdSplitCard';
import { PriceTrajectoryCard } from '../../../components/PriceTrajectoryCard';
import { isLandPropertyType, localityBenchmarkPerSqm } from '../../../components/PlotFactsCard';
import { api } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { date, money, num, perSqm, pct, titleCase } from '../../../lib/format';
import { formatArea, formatRate, useAreaUnitFor } from '../../../lib/units';
import type { AreaUnit } from '../../../lib/units';
import type { TabProps } from '../tab-props';
import { SplitProse } from '../../../components/ui/prose';

type SortKey = 'adjustedPricePerSqm' | 'distanceKm' | 'transactedAt' | 'areaSqm' | 'similarity';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'adjustedPricePerSqm', label: 'Adjusted price' },
  { key: 'distanceKm', label: 'Distance' },
  { key: 'transactedAt', label: 'Date' },
  { key: 'areaSqm', label: 'Area' },
  { key: 'similarity', label: 'Similarity' },
];

/** Mirrors `AssessmentMethodCard`, so an anchor reads the same in both places. */
const ANCHOR_ROLE_TONE: Record<MethodRole, 'brand' | 'good' | 'neutral' | 'warning'> = {
  primary: 'brand',
  supporting: 'good',
  sense_check: 'neutral',
  not_applicable: 'warning',
};

const ANCHOR_ROLE_LABEL: Record<MethodRole, string> = {
  primary: 'Leads this assessment',
  supporting: 'Supporting',
  sense_check: 'Sense check',
  not_applicable: 'Not used',
};

function confidenceTone(c: number): 'good' | 'warning' | 'critical' {
  if (c >= 0.7) return 'good';
  if (c >= 0.4) return 'warning';
  return 'critical';
}

function sortValue(c: Comparable, key: SortKey): number {
  if (key === 'transactedAt') return new Date(c.transactedAt).getTime();
  return c[key];
}

export default function ValuationTab({ caseData, result, refresh, running }: TabProps) {
  const areaUnit = useAreaUnitFor(caseData.identity.country);
  const unitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';
  const isLand = isLandPropertyType(caseData.identity.propertyType);
  // Resolved independently from the reference data rather than trusted
  // wholesale from `marketContext.medianPricePerSqm` — a site's rate must
  // never be benchmarked against the built-up basis used for apartments and
  // villas, so a land subject without a resolvable land-rate figure falls
  // back to "—", never to the wrong number.
  const { data: reference } = useAsync<ReferenceData>(() => api.reference(), []);
  const [expandedComparableIds, setExpandedComparableIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('similarity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [settingKind, setSettingKind] = useState(false);

  const setProjectKind = async (kind: ProjectKind) => {
    setSettingKind(true);
    try {
      // The screen re-runs server-side, so the case has to be re-read — the
      // whole point of stating the kind is that the numbers on this page
      // change, and a stale `result` would hide exactly that.
      await api.setProjectKind(caseData.id, { kind });
      await refresh();
    } finally {
      setSettingKind(false);
    }
  };

  const sortedComparables = useMemo(() => {
    if (!result) return [];
    const arr = [...result.comparables];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [result, sortKey, sortDir]);

  if (!result) {
    return (
      <EmptyState
        title="Not screened yet"
        description="Run the screen to see the indicative value range, anchors and comparables."
      />
    );
  }

  const { indicativeValue: iv, anchors, marketContext } = result;
  const currency = iv.currency;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleComparable = (id: string) => {
    setExpandedComparableIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalWeight = anchors.reduce((s, a) => s + a.weight, 0) || 1;
  const weightPct = (w: number) => (w / totalWeight) * 100;

  const weightParts = anchors.map((a) => `${a.label} (${pct(weightPct(a.weight), 0)})`);
  const weightSentence =
    weightParts.length > 1
      ? `${weightParts.slice(0, -1).join(', ')} and ${weightParts[weightParts.length - 1]}`
      : (weightParts[0] ?? 'no anchors');

  const localityRate = localityBenchmarkPerSqm(reference, caseData.identity);
  const localityRateForSubject = isLand ? localityRate : (localityRate ?? marketContext.medianPricePerSqm);
  const vsMedianPct =
    localityRateForSubject !== null && localityRateForSubject > 0
      ? ((iv.perSqm.mid - localityRateForSubject) / localityRateForSubject) * 100
      : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Placed above the range, not below it: what kind of project this is
          decides which methods produced the range, so reading the number
          before the method is reading it out of order. */}
      {result.project && result.assessment && (
        <AssessmentMethodCard
          project={result.project}
          profile={result.assessment}
          anchors={anchors}
          onChangeKind={setProjectKind}
          busy={settingKind || running}
          reference={caseData.reference}
        />
      )}

      <Card>
        <CardHeader title="Indicative value range" />
        <CardBody>
          <ValueRangeChart
            low={iv.low}
            mid={iv.mid}
            high={iv.high}
            currency={currency}
            askingPrice={caseData.identity.askingPrice ?? null}
            anchors={anchors.map((a) => ({ label: a.label, method: titleCase(a.method), low: a.low, mid: a.mid, high: a.high }))}
          />
        </CardBody>
      </Card>

      <Callout tone="neutral" title="This is an indicative screening range" collapsible>
        Not a certified valuation, a legal title opinion, or a formal mortgage valuation. Use it to decide whether further diligence is
        worth the effort — not as the basis for a lending or legal decision.
      </Callout>

      {/* Directly under the range on purpose: on a joint development the
          ratio, not the range, is the number the deal is signed on. */}
      {result.jdSplit && <JdSplitCard split={result.jdSplit} evidence={result.evidence} />}

      {result.priceTrajectory && <PriceTrajectoryCard trajectory={result.priceTrajectory} />}

      <Card>
        <CardHeader title="Value anchors" />
        <CardBody className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            The blended mid of <span className="font-semibold text-ink">{money(iv.mid, currency)}</span> is a weighted combination of{' '}
            {anchors.length} value anchor{anchors.length === 1 ? '' : 's'}: {weightSentence}.
          </p>
          <AnchorWeightChart anchors={anchors} currency={currency} />
          <div className="flex flex-col gap-3">
            {anchors.map((a) => (
              <Card key={a.id} className="!shadow-none">
                <CardBody className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-semibold text-ink">{a.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{titleCase(a.method)}</Badge>
                        {a.role && <Badge tone={ANCHOR_ROLE_TONE[a.role]}>{ANCHOR_ROLE_LABEL[a.role]}</Badge>}
                      </div>
                    </div>
                    <EvidenceLink ids={a.evidenceIds} evidence={result.evidence} />
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
                    <span className="text-ink-secondary">
                      Low <span className="tabular font-medium text-ink">{money(a.low, currency)}</span>
                    </span>
                    <span className="text-ink-secondary">
                      Mid <span className="tabular font-semibold text-ink">{money(a.mid, currency)}</span>
                    </span>
                    <span className="text-ink-secondary">
                      High <span className="tabular font-medium text-ink">{money(a.high, currency)}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ProgressBar value={weightPct(a.weight)} tone="brand" label="Weight in blend" />
                    <ProgressBar value={a.confidence * 100} tone={confidenceTone(a.confidence)} label="Confidence" />
                  </div>
                  {/*
                    * The residual's arithmetic as a picture, and the sentence
                    * cut down to what a picture cannot say. A subtraction
                    * chain was being carried entirely in prose — 969
                    * characters of it — because the engine kept only the
                    * final figure. Now the steps are data, and which of
                    * construction or margin eats the scheme is visible rather
                    * than reconstructed.
                    */}
                  {a.residual ? (
                    <ResidualWaterfallChart
                      residual={a.residual}
                      formatArea={(sqm) => formatArea(sqm, areaUnit)}
                      formatRate={(rate) => formatRate(rate, areaUnit, a.residual!.currency)}
                    />
                  ) : null}
                  <SplitProse text={a.rationale} />
                  {a.roleNote && (
                    <p className="border-l-2 border-[var(--ring)] pl-3 text-[12.5px] leading-relaxed text-ink-muted">
                      <span className="font-medium text-ink-secondary">Why it {a.role === 'primary' ? 'leads' : a.role === 'sense_check' ? 'is only a check' : 'supports'} here:</span>{' '}
                      {a.roleNote}
                    </p>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Per ${unitLabel} summary`}
          subtitle={isLand ? "Subject land rate against the locality's land-rate benchmark" : 'Subject range against the locality median'}
        />
        <CardBody>
          {isLand ? (
            <div className="mb-3">
              <Callout tone="info" title="Land-rate basis" collapsible>
                Every figure below is a rate per {unitLabel} of <span className="font-medium text-ink">plot area</span> — benchmarked
                against the locality's land rate, not the built-up price basis used for apartments and villas.
              </Callout>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={`Subject ${isLand ? 'land rate' : 'price'} low / ${unitLabel}`} value={formatRate(iv.perSqm.low, areaUnit, currency)} />
            <Stat
              label={`Subject ${isLand ? 'land rate' : 'price'} mid / ${unitLabel}`}
              value={formatRate(iv.perSqm.mid, areaUnit, currency)}
              sub={vsMedianPct !== null ? `${pct(vsMedianPct, 1, true)} vs. locality ${isLand ? 'land rate' : 'median'}` : undefined}
            />
            <Stat
              label={`Subject ${isLand ? 'land rate' : 'price'} high / ${unitLabel}`}
              value={formatRate(iv.perSqm.high, areaUnit, currency)}
            />
            <Stat
              label={`Locality ${isLand ? 'land rate' : 'median price'} / ${unitLabel}`}
              value={formatRate(localityRateForSubject, areaUnit, currency)}
              sub={marketContext.source}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Comparables" subtitle={`${result.comparables.length} transactions considered`} />
        <CardBody className="flex flex-col gap-4">
          <ComparablesChart comparables={result.comparables} subjectPricePerSqm={iv.perSqm.mid} currency={currency} />
          <div className="overflow-x-auto rounded-lg ring-1 ring-[var(--ring)]">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline bg-sunken text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Comparable</th>
                  {SORT_COLUMNS.map((col) => (
                    <th key={col.key} className="px-3 py-2">
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-ink',
                          sortKey === col.key ? 'text-ink' : 'text-ink-muted',
                        )}
                      >
                        {col.label}
                        {col.key === 'adjustedPricePerSqm' ? ` / ${unitLabel}` : ''}
                        {sortKey === col.key ? sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedComparables.map((c) => (
                  <ComparableRow
                    key={c.id}
                    comparable={c}
                    currency={currency}
                    expanded={expandedComparableIds.has(c.id)}
                    onToggle={() => toggleComparable(c.id)}
                    areaUnit={areaUnit}
                  />
                ))}
                {sortedComparables.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-xs text-ink-muted">
                      No comparables were found for this property.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ComparableRow({
  comparable,
  currency,
  expanded,
  onToggle,
  areaUnit,
}: {
  comparable: Comparable;
  currency: CurrencyCode;
  expanded: boolean;
  onToggle: () => void;
  areaUnit: AreaUnit;
}) {
  return (
    <>
      <tr className="border-b border-hairline last:border-0 hover:bg-sunken/60">
        <td className="px-3 py-2 align-top">
          <button
            onClick={onToggle}
            aria-label={expanded ? `Collapse adjustments for ${comparable.label}` : `Expand adjustments for ${comparable.label}`}
            aria-expanded={expanded}
            className="text-ink-muted hover:text-ink"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="font-medium text-ink">{comparable.label}</div>
          <div className="text-xs text-ink-muted">{comparable.address}</div>
          <div className="mt-0.5 text-[11px] text-ink-muted">{comparable.source}</div>
        </td>
        <td className="tabular px-3 py-2 align-top font-medium text-ink">{formatRate(comparable.adjustedPricePerSqm, areaUnit, currency)}</td>
        <td className="tabular px-3 py-2 align-top text-ink-secondary">{comparable.distanceKm.toFixed(1)} km</td>
        <td className="px-3 py-2 align-top text-ink-secondary">{date(comparable.transactedAt)}</td>
        <td className="tabular px-3 py-2 align-top text-ink-secondary">{formatArea(comparable.areaSqm, areaUnit)}</td>
        <td className="px-3 py-2 align-top">
          <div className="w-20">
            <ProgressBar value={comparable.similarity * 100} tone="brand" showValue={false} />
          </div>
          <div className="tabular mt-1 text-[11px] text-ink-muted">{Math.round(comparable.similarity * 100)}%</div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-hairline bg-sunken/40 last:border-0">
          <td />
          <td colSpan={6} className="px-3 py-3">
            <AdjustmentChain comparable={comparable} currency={currency} areaUnit={areaUnit} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AdjustmentChain({ comparable, currency, areaUnit }: { comparable: Comparable; currency: CurrencyCode; areaUnit: AreaUnit }) {
  const unitLabel = areaUnit === 'sqft' ? 'sq ft' : 'm²';
  let running = comparable.pricePerSqm;
  const steps = comparable.adjustments.map((adj) => {
    const before = running;
    running = running * (1 + adj.pct / 100);
    return { ...adj, before, after: running };
  });

  return (
    <div className="flex max-w-md flex-col gap-1.5 text-[12px]">
      <SectionTitle>{`Adjustments — raw to adjusted price / ${unitLabel}`}</SectionTitle>
      <div className="flex items-center justify-between border-b border-hairline py-1">
        <span className="text-ink-secondary">{`Raw transacted price / ${unitLabel}`}</span>
        <span className="tabular font-medium text-ink">{formatRate(comparable.pricePerSqm, areaUnit, currency)}</span>
      </div>
      {steps.map((s) => (
        <div key={s.key} className="flex items-center justify-between border-b border-hairline py-1 last:border-0">
          <span className="text-ink-secondary">{s.label}</span>
          <span className="flex items-center gap-2">
            <span className={cn('tabular font-medium', s.pct >= 0 ? 'text-[var(--status-good-text)]' : 'text-critical')}>
              {pct(s.pct, 1, true)}
            </span>
            <span className="tabular text-ink-muted">{formatRate(s.after, areaUnit, currency)}</span>
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1 font-semibold text-ink">
        <span>{`Adjusted price / ${unitLabel}`}</span>
        <span className="tabular">{formatRate(comparable.adjustedPricePerSqm, areaUnit, currency)}</span>
      </div>
    </div>
  );
}
