import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CircleSlash,
  Cpu,
  Gauge,
  ServerCog,
  TriangleAlert,
} from 'lucide-react';
import type {
  AgentRoute,
  CapabilityGap,
  LlmCallRecord,
  ProviderDescriptor,
  ProviderId,
  ProviderPerformance,
  TelemetrySummary,
} from '@realytica/shared';

/**
 * What a cost total leaves out.
 *
 * Shipped alongside every total by the telemetry layer, on the rule that
 * nothing there reports a cost without also reporting what it excluded. This
 * page honours the same rule: a route whose rates this deployment does not
 * know contributes zero to the sum, and a total silently missing a third of
 * the spend is a number a reader would trust and should not.
 *
 * Declared structurally rather than imported because it belongs to the
 * telemetry module's view type, not to the frozen domain contract.
 */
interface PricingCoverage {
  confidence: 'exact' | 'upper_bound' | 'unavailable';
  pricedCalls: number;
  upperBoundCalls: number;
  unpricedCalls: number;
  upperBoundRoutes: string[];
  unpricedRoutes: string[];
  note: string;
}

type TelemetryView = TelemetrySummary & { pricing?: PricingCoverage };
import { LatencySpreadChart } from '../components/charts';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Select,
  Skeleton,
  Stat,
  cn,
  type Tone,
} from '../components/ui/kit';

/**
 * Where every model call went, what it cost, and what it could not do.
 *
 * This page exists because the agent layer is no longer "always Anthropic" —
 * a proxy in the base-URL seat can send any call to any vendor.
 * Once each agent can be pointed at a different provider, three questions stop
 * being answerable by inspection: what a case actually cost, which route is
 * genuinely faster, and — the one that matters most here — which calls ran
 * *degraded* because the provider could not supply something the agent wanted.
 *
 * A degraded call is not an error. It returns a plausible answer. Document
 * intelligence on a provider without verified citations still extracts fields;
 * it just cannot prove which page they came from. That distinction is
 * invisible in the output and expensive in a diligence context, so it is given
 * a column of its own rather than folded into an error rate.
 */

const GAP_LABEL: Record<CapabilityGap, string> = {
  citations_unavailable: 'No verified citations',
  prompt_caching_unavailable: 'No prompt caching',
  adaptive_thinking_unavailable: 'No adaptive thinking',
  server_web_search_unavailable: 'No server web search',
  refusal_fallback_unavailable: 'No refusal fallback',
  pdf_input_unavailable: 'No native PDF input',
  strict_tools_unavailable: 'No strict tool schemas',
};

/** Gaps that change what a result *means*, as opposed to what it costs. */
const GROUNDING_GAPS = new Set<CapabilityGap>(['citations_unavailable', 'pdf_input_unavailable']);

function usd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function ms(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}s`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${Math.round(n)}ms`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/* ------------------------------------------------------------------ */
/* Providers & routes                                                  */
/* ------------------------------------------------------------------ */

function CapabilityDots({ descriptor }: { descriptor: ProviderDescriptor }) {
  const caps = Object.entries(descriptor.capabilities) as [string, boolean][];
  return (
    <div className="flex flex-wrap gap-1">
      {caps.map(([key, on]) => (
        <span
          key={key}
          title={`${key}: ${on ? 'supported' : 'not supported'}`}
          className={cn(
            'rounded px-1.5 py-0.5 text-micro font-medium',
            on ? 'bg-good-soft text-good' : 'bg-sunken text-ink-muted line-through',
          )}
        >
          {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
        </span>
      ))}
    </div>
  );
}

function RoutingCard({ routes, providers }: { routes: AgentRoute[]; providers: ProviderDescriptor[] }) {
  const degraded = routes.filter((r) => r.expectedGaps.length > 0);
  /*
   * "No gaps" and "gaps not computed" look identical in the data and must not
   * look identical here.
   *
   * `expectedGaps` is filled by whichever layer knows the provider registry.
   * An API build that does not fill it returns empty arrays, which would
   * render as a confident "Full capability" badge over routes nobody checked.
   *
   * Behind a proxy the badge cannot be confident even when the layer IS
   * assessed: the declaration describes the wire format, and which vendor
   * answers — and therefore whether citations come back at all — is the
   * proxy's business. So a proxied roster says "not assessed" and leaves the
   * real answer to the per-call gaps, which are measured from the reply.
   * Claiming a guarantee nothing checked is the worst of the three answers.
   */
  const proxied = providers.some((p) => Boolean(p.baseUrl));
  const assessed = providers.length > 0 && !proxied;
  const badge = degraded.length > 0
    ? <Badge tone="warning">{degraded.length} degraded</Badge>
    : assessed
      ? <Badge tone="good">Full capability</Badge>
      : <Badge tone="neutral">Capability not assessed</Badge>;
  return (
    <Card>
      <CardHeader
        title="Routing"

        icon={<ServerCog size={16} />}
        action={badge}
      />
      <CardBody>
        <div className="mb-4 space-y-2">
          {providers.map((p) => (
            <div key={p.id} className="rounded-lg bg-sunken p-2.5">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-ink">{p.label}</span>
                <Badge tone={p.configured ? 'good' : 'neutral'}>{p.configured ? 'configured' : 'no credentials'}</Badge>
                {p.baseUrl && <span className="font-mono text-micro text-ink-muted">{p.baseUrl}</span>}
              </div>
              <CapabilityDots descriptor={p} />
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-mini uppercase tracking-wide text-ink-muted">
                <th className="pb-1.5 pr-3 font-semibold">Agent</th>
                <th className="pb-1.5 pr-3 font-semibold">Tier</th>
                <th className="pb-1.5 pr-3 font-semibold">Route</th>
                <th className="pb-1.5 pr-3 font-semibold">Decided by</th>
                <th className="pb-1.5 font-semibold">Degrades</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const grounding = r.expectedGaps.filter((g) => GROUNDING_GAPS.has(g));
                return (
                  <tr key={r.agent} className="border-b border-hairline last:border-0">
                    <td className="py-1.5 pr-3 align-top text-ink">{r.agent.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 pr-3 align-top">
                      <Badge tone="neutral">{r.tier}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 align-top font-mono text-mini text-ink-secondary">
                      {r.model}
                    </td>
                    <td className="py-1.5 pr-3 align-top text-mini text-ink-muted">{r.source.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 align-top">
                      {r.expectedGaps.length === 0 ? (
                        <span className="text-mini text-ink-muted">
                          {!assessed && r.provider !== 'anthropic' ? 'not assessed' : '—'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.expectedGaps.map((g) => (
                            <Badge key={g} tone={GROUNDING_GAPS.has(g) ? 'critical' : 'warning'}>
                              {GAP_LABEL[g]}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {grounding.length > 0 && (
                        <p className="mt-1 text-mini leading-relaxed text-critical">
                          This route changes what the output means, not just what it costs.
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

function PerformanceTable({ rows }: { rows: ProviderPerformance[] }) {
  return (
    <Card>
      <CardHeader
        title="Performance by route"
        info="Median rather than mean — one slow outlier should not define a route's profile."
        icon={<Gauge size={16} />}
      />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-xs text-ink-muted">No calls recorded in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-xs">
              <thead>
                <tr className="border-b border-hairline text-mini uppercase tracking-wide text-ink-muted">
                  <th className="pb-1.5 pr-3 font-semibold">Route</th>
                  <th className="pb-1.5 pr-3 text-right font-semibold">Calls</th>
                  <th className="pb-1.5 pr-3 text-right font-semibold">Median</th>
                  <th className="pb-1.5 pr-3 text-right font-semibold">p95</th>
                  <th className="pb-1.5 pr-3 text-right font-semibold">Cache</th>
                  <th className="pb-1.5 pr-3 text-right font-semibold">Degraded</th>
                  <th className="pb-1.5 pr-3 text-right font-semibold">Fail</th>
                  <th className="pb-1.5 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.provider}-${r.model}`} className="border-b border-hairline last:border-0">
                    <td className="py-1.5 pr-3 align-top">
                      <span className="font-mono text-ink">{r.model}</span>
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right align-top text-ink-secondary">{r.calls}</td>
                    <td className="tabular py-1.5 pr-3 text-right align-top text-ink">{ms(r.medianDurationMs)}</td>
                    <td className="tabular py-1.5 pr-3 text-right align-top text-ink-secondary">{ms(r.p95DurationMs)}</td>
                    <td className="tabular py-1.5 pr-3 text-right align-top text-ink-secondary">{pct(r.cacheHitRate)}</td>
                    <td className={cn('tabular py-1.5 pr-3 text-right align-top', r.degradedCallRate > 0 ? 'text-warning' : 'text-ink-muted')}>
                      {pct(r.degradedCallRate)}
                    </td>
                    <td className={cn('tabular py-1.5 pr-3 text-right align-top', r.failures > 0 ? 'text-critical' : 'text-ink-muted')}>
                      {r.failures}
                      {r.refusals > 0 && <span className="text-warning"> +{r.refusals}r</span>}
                    </td>
                    <td className="tabular py-1.5 text-right align-top font-medium text-ink">
                      {usd(r.totalUsage.estimatedCostUsd)}
                      <span className="block text-micro font-normal text-ink-muted">
                        {tokens(r.totalUsage.inputTokens)}/{tokens(r.totalUsage.outputTokens)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Call log                                                            */
/* ------------------------------------------------------------------ */

type CallFilter = 'all' | 'degraded' | 'failed';

function CallLog({ calls }: { calls: LlmCallRecord[] }) {
  const [filter, setFilter] = useState<CallFilter>('all');
  const shown = useMemo(() => {
    if (filter === 'degraded') return calls.filter((c) => c.capabilityGaps.length > 0);
    if (filter === 'failed') return calls.filter((c) => c.outcome !== 'succeeded');
    return calls;
  }, [calls, filter]);

  return (
    <Card>
      <CardHeader
        title="Recent calls"
        subtitle="Newest first"
        icon={<Activity size={16} />}
        action={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as CallFilter)} className="w-36">
            <option value="all">All calls</option>
            <option value="degraded">Degraded only</option>
            <option value="failed">Failed or refused</option>
          </Select>
        }
      />
      <CardBody>
        {shown.length === 0 ? (
          <EmptyState
            icon={<CircleSlash size={22} />}
            title={filter === 'all' ? 'No calls recorded' : 'Nothing matches this filter'}
            description={
              filter === 'all'
                ? 'Model calls appear here once an agent run has happened. The deterministic screen makes no model calls.'
                : 'That is the good outcome — nothing in this window hit it.'
            }
          />
        ) : (
          shown.slice(0, 60).map((c) => (
            <div key={c.id} className="border-b border-hairline py-2 last:border-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-ink">{c.agent.replace(/_/g, ' ')}</span>
                <Badge
                  tone={c.outcome === 'succeeded' ? 'good' : c.outcome === 'refused' ? 'warning' : 'critical'}
                >
                  {c.outcome}
                </Badge>
                <span className="font-mono text-micro text-ink-muted">
                  {c.model}
                </span>
                <span className="tabular ml-auto text-mini text-ink-muted">
                  {ms(c.durationMs)}
                  {c.timeToFirstTokenMs !== undefined && ` (ttft ${ms(c.timeToFirstTokenMs)})`}
                  {' · '}
                  {usd(c.usage.estimatedCostUsd)}
                  {' · '}
                  {relativeTime(c.startedAt)}
                </span>
              </div>
              {c.capabilityGaps.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.capabilityGaps.map((g) => (
                    <Badge key={g} tone={GROUNDING_GAPS.has(g) ? 'critical' : 'warning'}>
                      {GAP_LABEL[g]}
                    </Badge>
                  ))}
                </div>
              )}
              {c.error && <p className="mt-1 text-mini leading-relaxed text-critical">{c.error}</p>}
              {c.retries > 0 && <p className="mt-1 text-mini text-ink-muted">{c.retries} retry/retries</p>}
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Observability() {
  const { data: capability, loading: capLoading } = useAsync(() => api.agentCapability(), []);
  // Telemetry is caught rather than allowed to reject: an API build without the
  // endpoint should cost this page its call log, not the routing table that
  // does not depend on it. A page that blanks entirely because one of its two
  // sources is missing is worse than one that says which half it is showing.
  const { data: telemetry, loading: telLoading, error: telError } = useAsync(
    () => api.telemetry().catch(() => null),
    [],
  );

  if (capLoading || telLoading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const routes = capability?.routes ?? [];
  const providers = capability?.providers ?? [];
  const summary: TelemetryView | null = telemetry ?? null;
  const degradedCalls = summary?.recentCalls.filter((c) => c.capabilityGaps.length > 0).length ?? 0;
  const groundingDegraded =
    summary?.recentCalls.filter((c) => c.capabilityGaps.some((g) => GROUNDING_GAPS.has(g))).length ?? 0;

  const tone: Tone = groundingDegraded > 0 ? 'critical' : degradedCalls > 0 ? 'warning' : 'good';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-ink">AI activity</h1>
        <p className="mt-0.5 text-sm text-ink-secondary">
          Where every model call went, what it cost, and what it could not do.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calls" value={String(summary?.callCount ?? 0)} hint="in this window" tone="neutral" />
        <Stat
          label="Spend"
          value={usd(summary?.totalCostUsd ?? 0)}
          hint={
            summary?.pricing && summary.pricing.unpricedCalls > 0
              ? `lower bound — ${summary.pricing.unpricedCalls} call(s) unpriced`
              : 'across all routes'
          }
          tone={summary?.pricing && summary.pricing.unpricedCalls > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Routes"
          value={String(summary?.byProvider.length ?? 0)}
          hint={`${providers.filter((p) => p.configured).length} provider(s) configured`}
          tone="neutral"
        />
        <Stat
          label="Degraded"
          value={String(degradedCalls)}
          hint={groundingDegraded > 0 ? `${groundingDegraded} affect grounding` : 'cost only'}
          tone={tone}
        />
      </div>

      {groundingDegraded > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg bg-critical-soft p-3 ring-1 ring-critical">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-critical" />
          <p className="text-xs leading-relaxed text-ink">
            <span className="font-semibold">{groundingDegraded} call(s) ran without verified grounding.</span> These
            returned answers, and the answers may be right — but page references on the fields they produced are
            self-reported rather than checked against the document. Findings from those calls should be treated as
            unverified until confirmed against the source.
          </p>
        </div>
      )}

      {summary?.pricing && summary.pricing.confidence !== 'exact' && (
        <div className="flex items-start gap-2.5 rounded-lg bg-warning-soft p-3 ring-1 ring-warning">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-xs leading-relaxed text-ink">{summary.pricing.note}</p>
            {summary.pricing.unpricedRoutes.length > 0 && (
              <p className="mt-1.5 text-mini leading-relaxed text-ink-secondary">
                Declare rates for{' '}
                {summary.pricing.unpricedRoutes.map((r) => (
                  <span key={r} className="font-mono">
                    {r}{' '}
                  </span>
                ))}
                in <span className="font-mono">REALYTICA_PRICING</span> to make this total complete.
              </p>
            )}
          </div>
        </div>
      )}

      {routes.length > 0 ? (
        <RoutingCard routes={routes} providers={providers} />
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Cpu size={24} />}
              title="Routing not reported"
              description="This API build predates the provider port, so it does not report which model each agent runs on."
            />
          </CardBody>
        </Card>
      )}

      {summary === null && !telError ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Activity size={24} />}
              title="No call telemetry available"
              description="This API build does not report model-call telemetry, so cost, latency and degradation cannot be shown. Routing above is unaffected."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/*
           * The spread first, the figures below.
           *
           * Median and p95 in separate columns leaves the relationship between
           * them for the reader to compute, and that relationship is the whole
           * signal: 800ms/12s and 1.2s/1.5s are completely different routes.
           */}
          <div className="mb-4">
            <LatencySpreadChart rows={summary?.byProvider ?? []} />
          </div>
          <PerformanceTable rows={summary?.byProvider ?? []} />
          <CallLog calls={summary?.recentCalls ?? []} />
        </>
      )}

      <p className="flex items-start gap-2 text-mini leading-relaxed text-ink-muted">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Costs are estimates from published per-token rates, not billed amounts. A route whose rates this deployment
        does not know is shown unpriced rather than as zero.
      </p>
    </div>
  );
}
