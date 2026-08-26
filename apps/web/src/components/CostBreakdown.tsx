import { Coins, TrendingDown } from 'lucide-react';
import type { CaseCostSummary, ModelTier } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, cn, type Tone } from './ui/kit';

/**
 * What this run cost, per agent, and what it would have cost undifferentiated.
 *
 * Shown rather than logged because cost-per-case is a product decision, not an
 * operational detail: it is the variable that decides what a screen can be
 * priced at, and therefore who can buy one. A user comparing a ₹500 screen
 * against a ₹5,000 one is looking at this number.
 *
 * The comparison figure re-prices the tokens actually spent at the judgment
 * model's rate. That keeps it honest — it is not a hypothetical run with
 * invented token counts, and judgment-tier agents contribute identically to
 * both sides and so show no saving, which is correct.
 */

const TIER_TONE: Record<ModelTier, Tone> = {
  extraction: 'good',
  reasoning: 'brand',
  judgment: 'warning',
};

const AGENT_LABEL: Record<string, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  critic: 'Critic',
  explorer: 'Explorer',
  document_intelligence: 'Document intelligence',
  proof_pathways: 'Proof pathways',
  analyst_copilot: 'Analyst copilot',
  market_research: 'Market research',
  diligence_planner: 'Diligence planner',
  title_graph: 'Title graph',
};

function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function CostBreakdown({ cost }: { cost: CaseCostSummary }) {
  const savedPct =
    cost.singleTierComparisonUsd > 0
      ? (cost.savedUsd / cost.singleTierComparisonUsd) * 100
      : 0;
  // A negative saving is a real outcome — a deployment that overrode an agent
  // upwards should see that it is paying for the choice, not have it hidden.
  const overspent = cost.savedUsd < 0;

  return (
    <Card>
      <CardHeader
        title="What this run cost"

        icon={<Coins size={16} />}
        action={<Badge tone={overspent ? 'warning' : 'good'}>{usd(cost.total.estimatedCostUsd)}</Badge>}
      />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="pb-1.5 pr-3 font-semibold">Agent</th>
                <th className="pb-1.5 pr-3 font-semibold">Tier</th>
                <th className="pb-1.5 pr-3 font-semibold">Model</th>
                <th className="pb-1.5 pr-3 text-right font-semibold">In</th>
                <th className="pb-1.5 pr-3 text-right font-semibold">Out</th>
                <th className="pb-1.5 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {cost.perAgent.map((row) => (
                <tr key={`${row.agent}-${row.model}`} className="border-b border-hairline last:border-0">
                  <td className="py-1.5 pr-3 align-top text-ink">{AGENT_LABEL[row.agent] ?? row.agent}</td>
                  <td className="py-1.5 pr-3 align-top">
                    <Badge tone={TIER_TONE[row.tier]}>{row.tier}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 align-top font-mono text-[11px] text-ink-muted">{row.model}</td>
                  <td className="tabular py-1.5 pr-3 text-right align-top text-ink-secondary">
                    {tokens(row.usage.inputTokens)}
                    {row.usage.cacheReadTokens > 0 && (
                      <span className="text-ink-muted"> +{tokens(row.usage.cacheReadTokens)}c</span>
                    )}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right align-top text-ink-secondary">
                    {tokens(row.usage.outputTokens)}
                  </td>
                  <td className="tabular py-1.5 text-right align-top font-medium text-ink">
                    {usd(row.usage.estimatedCostUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-sunken p-3">
          <TrendingDown
            size={14}
            className={cn('shrink-0', overspent ? 'rotate-180 text-warning' : 'text-good')}
          />
          <span className="text-xs text-ink-secondary">
            {overspent ? 'Costing' : 'Saved'}{' '}
            <span className="font-semibold text-ink">{usd(Math.abs(cost.savedUsd))}</span>{' '}
            {overspent ? 'more than' : 'against'}{' '}
            <span className="tabular">{usd(cost.singleTierComparisonUsd)}</span> — the same tokens with every
            agent on the judgment model
            {!overspent && savedPct > 0 && (
              <span className="tabular text-ink-muted"> ({Math.round(savedPct)}% less)</span>
            )}
            .
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
