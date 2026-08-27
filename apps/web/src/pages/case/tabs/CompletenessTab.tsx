import { useMemo } from 'react';
import { AlertTriangle, Check, ClipboardCheck, Gauge, Info, Zap } from 'lucide-react';
import type { CompletenessItem, ConfidenceFactor } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { DOCUMENT_KIND_LABEL } from '../../../lib/format';
import { Button, Callout, Card, CardBody, CardHeader, EmptyState, SectionTitle, cn } from '../../../components/ui/kit';
import { CompletenessRing, ConfidenceGauge } from '../../../components/charts';
import { SplitProse } from '../../../components/ui/prose';

function shareOf(weight: number, totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  return Math.round((weight / totalWeight) * 100);
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}`;
}

/** No explicit target-tab field ships on ConfidenceFactor/ConfidenceSummary, so the
 * "jump to the relevant tab" button infers a destination from the lever's own wording. */
function inferLeverTab(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('risk')) return 'risks';
  if (t.includes('planning') || t.includes('zoning') || t.includes('far ')) return 'planning';
  if (t.includes('evidence')) return 'evidence';
  if (t.includes('action')) return 'actions';
  return 'documents';
}

function ItemRow({ item, onOpenDocument }: { item: CompletenessItem; onOpenDocument: () => void }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-hairline py-2.5 last:border-0">
      {item.present ? (
        <Check size={14} className="mt-0.5 shrink-0 text-good" aria-hidden="true" />
      ) : (
        <AlertTriangle size={14} className={cn('mt-0.5 shrink-0', item.required ? 'text-critical' : 'text-warning')} aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          {item.present ? (
            <button
              type="button"
              onClick={onOpenDocument}
              className="truncate text-left text-[13px] font-medium text-ink underline-offset-2 hover:underline"
            >
              {item.label}
            </button>
          ) : (
            <span className="truncate text-[13px] font-medium text-ink">{item.label}</span>
          )}
        </div>
        {!item.present ? (
          <p className="mt-0.5 text-xs text-ink-secondary">
            Satisfied by: {item.satisfiedBy.map((k) => DOCUMENT_KIND_LABEL[k]).join(' or ')}
          </p>
        ) : item.note ? (
          <SplitProse text={item.note} className="mt-0.5" />
        ) : null}
      </div>
    </div>
  );
}

function FactorRow({ factor, maxAbs }: { factor: ConfidenceFactor; maxAbs: number }) {
  const positive = factor.contribution >= 0;
  const widthPct = maxAbs > 0 ? (Math.abs(factor.contribution) / maxAbs) * 50 : 0;
  return (
    <li className="flex flex-col gap-1 border-b border-hairline py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{factor.label}</span>
        <span
          className="tabular text-[13px] font-semibold"
          style={{ color: positive ? 'var(--series-1)' : 'var(--series-8)' }}
        >
          {signed(factor.contribution)}
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-sunken" role="img" aria-label={`${factor.label}: ${signed(factor.contribution)} points`}>
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--axis)]" />
        {positive ? (
          <div
            className="absolute inset-y-0 left-1/2 rounded-r-full"
            style={{ width: `${widthPct}%`, backgroundColor: 'var(--series-1)' }}
          />
        ) : (
          <div
            className="absolute inset-y-0 right-1/2 rounded-l-full"
            style={{ width: `${widthPct}%`, backgroundColor: 'var(--series-8)' }}
          />
        )}
      </div>
      <p className="text-xs leading-relaxed text-ink-secondary">{factor.note}</p>
    </li>
  );
}

export default function CompletenessTab({ result, runScreen, running, goToTab }: TabProps) {
  const completeness = result?.completeness ?? null;
  const confidence = result?.confidence ?? null;

  const totalWeight = useMemo(
    () => (completeness ? completeness.items.reduce((sum, i) => sum + i.weight, 0) : 0),
    [completeness],
  );

  const required = useMemo(() => completeness?.items.filter((i) => i.required) ?? [], [completeness]);
  const optional = useMemo(() => completeness?.items.filter((i) => !i.required) ?? [], [completeness]);

  const contributionSum = useMemo(
    () => (confidence ? confidence.factors.reduce((sum, f) => sum + f.contribution, 0) : 0),
    [confidence],
  );
  const base = confidence ? Math.round((confidence.score - contributionSum) * 10) / 10 : 0;
  const maxAbsContribution = useMemo(
    () => (confidence ? Math.max(1, ...confidence.factors.map((f) => Math.abs(f.contribution))) : 1),
    [confidence],
  );

  const missingCriticalLabels = useMemo(() => {
    if (!completeness) return [];
    return completeness.missingCritical.map((keyOrLabel) => {
      const match = completeness.items.find((i) => i.key === keyOrLabel || i.label === keyOrLabel);
      return match ? match.label : keyOrLabel;
    });
  }, [completeness]);

  if (!result || !completeness || !confidence) {
    return (
      <EmptyState
        icon={<ClipboardCheck size={28} />}
        title="Not screened yet"
        description="Run the screen to see what documents are missing and how much confidence the engine has in the numbers it produced."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  const leverTab = inferLeverTab(confidence.biggestLever);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Document completeness"
          subtitle="What is present, what is missing, and how much each item is worth"
          icon={<ClipboardCheck size={16} />}
        />
        <CardBody className="flex flex-col gap-4">
          {missingCriticalLabels.length > 0 ? (
            <Callout tone="critical" title="Missing critical documents">
              {missingCriticalLabels.join(', ')} — resolve these before relying on this screen for a decision.
            </Callout>
          ) : null}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
            <CompletenessRing score={completeness.score} size={104} label="Complete" />
            <p className="max-w-md text-xs leading-relaxed text-ink-secondary sm:pt-2">
              Score = (sum of present items&rsquo; weights ÷ total weight) × 100. Each item below shows its own weight
              as a share of that total, so the arithmetic stays inspectable.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <SectionTitle hint={`${required.filter((i) => i.present).length}/${required.length} present`}>
                Required
              </SectionTitle>
              {required.length > 0 ? (
                <ul>
                  {required.map((item) => (
                    <li key={item.key} className="group">
                      <ItemRow item={item} onOpenDocument={() => goToTab('documents')} />
                      <div className="-mt-2.5 mb-1 pl-6 text-[11px] tabular text-ink-muted">
                        {shareOf(item.weight, totalWeight)}% of score
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-muted">No required items defined.</p>
              )}
            </div>
            <div>
              <SectionTitle hint={`${optional.filter((i) => i.present).length}/${optional.length} present`}>
                Optional
              </SectionTitle>
              {optional.length > 0 ? (
                <ul>
                  {optional.map((item) => (
                    <li key={item.key} className="group">
                      <ItemRow item={item} onOpenDocument={() => goToTab('documents')} />
                      <div className="-mt-2.5 mb-1 pl-6 text-[11px] tabular text-ink-muted">
                        {shareOf(item.weight, totalWeight)}% of score
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-muted">No optional items defined.</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <Callout tone="info" title="How these two cards relate" collapsible>
        Completeness counts what evidence exists; confidence weighs how reliable it is. A file can be complete and
        still earn low confidence if the evidence inside it is stale, conflicting, or unverified — closing the gaps
        above is usually, but not always, the fastest way to raise the score below.
      </Callout>

      <Card>
        <CardHeader
          title="Confidence score"
          subtitle={`${titleCaseBand(confidence.band)} confidence — built from a base plus named, signed factors`}
          icon={<Gauge size={16} />}
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
            <ConfidenceGauge score={confidence.score} band={confidence.band} size={104} label={titleCaseBand(confidence.band)} />
            <p className="max-w-md text-xs leading-relaxed text-ink-secondary sm:pt-2">
              Base <strong className="tabular text-ink">{base}</strong> + net contribution{' '}
              <strong className="tabular text-ink">{signed(contributionSum)}</strong> = Score{' '}
              <strong className="tabular text-ink">{Math.round(confidence.score)}</strong>. Each factor below is one
              named, signed contribution to that total.
            </p>
          </div>

          <ul>
            {confidence.factors.map((factor) => (
              <FactorRow key={factor.key} factor={factor} maxAbs={maxAbsContribution} />
            ))}
          </ul>

          <div className="flex flex-col gap-3 rounded-lg border border-brand/25 bg-brand-soft/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Zap size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
                  Fastest way to raise confidence
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink">{confidence.biggestLever}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => goToTab(leverTab)}>
              Go there
            </Button>
          </div>

          <div className="border-t border-hairline pt-3">
            <SectionTitle>What this band means for your next decision</SectionTitle>
            <div className="flex flex-col gap-2 text-xs leading-relaxed text-ink-secondary">
              <p className={cn('flex gap-1.5', confidence.band === 'low' && 'font-medium text-ink')}>
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-ink">Low —</strong> treat every figure as an early estimate. Work through
                  the Actions tab before relying on this for an offer.
                </span>
              </p>
              <p className={cn('flex gap-1.5', confidence.band === 'moderate' && 'font-medium text-ink')}>
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-ink">Moderate —</strong> the headline is directionally right. Sanity-check
                  it against one more independent anchor before you commit.
                </span>
              </p>
              <p className={cn('flex gap-1.5', confidence.band === 'high' && 'font-medium text-ink')}>
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-ink">High —</strong> the numbers are well-supported. You can act on this
                  screen directly, subject to the usual pre-offer actions.
                </span>
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function titleCaseBand(band: 'low' | 'moderate' | 'high'): string {
  return band.charAt(0).toUpperCase() + band.slice(1);
}
