import type { AgentKind, ProviderId } from '@realytica/shared';
import { withCall } from '../telemetry/recorder';
import type { TelemetrySink } from '../telemetry/types';
import { routeFor } from '../routing';
import type { LlmProvider, LlmResult, LlmToolRequest, LlmRequest } from './types';

/**
 * The sink every model call is recorded to, once an app installs one.
 *
 * Held as module state rather than threaded through every agent's parameters,
 * for the same reason the prompt store is: the alternative is one more
 * argument on ten call sites that none of them have an opinion about.
 *
 * Null means "time nothing, store nothing", which is what a package used
 * directly by a script does. `withCall` already treats an absent sink as
 * valid, so nothing here has to branch on it.
 */
let sink: TelemetrySink | null = null;

/**
 * Point the provider layer at a telemetry sink.
 *
 * Until this is called, every model call in the app is unrecorded — which is
 * exactly what was happening before this module existed. The sink, the pricing
 * table, the retention policy and the Model ops page were all built and
 * plumbed, and nothing ever called `beginCall`, so the summary was assembled
 * from an empty record set and reported zero spend on a working deployment.
 * A cost view that reads zero because nothing feeds it looks identical to one
 * that reads zero because nothing was spent.
 */
export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next;
}

export function telemetrySinkInstalled(): boolean {
  return sink !== null;
}

/**
 * How a call learns which workspace it belongs to.
 *
 * A resolver rather than a field, and installed rather than imported, for two
 * separate reasons. Installed, because this package must not know the API
 * exists — the app owns request scoping and hands in a way to read it, exactly
 * as it hands in a sink. A resolver rather than a parameter, because `caseId`
 * beside it is the version that was threaded by hand: it is optional on every
 * request type, almost no call site fills it in, and the per-case cost filter
 * consequently matches almost nothing. Attribution that depends on being
 * remembered is attribution that is absent, and absent here means every
 * workspace admin reads every workspace's bill.
 */
let tenantOf: (() => string | undefined) | null = null;

export function setTenantResolver(next: (() => string | undefined) | null): void {
  tenantOf = next;
}

/** Never throws: a resolver that misbehaves costs an unattributed record, not a run. */
function currentTenant(): string | undefined {
  if (!tenantOf) return undefined;
  try {
    return tenantOf() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wrap a provider so every call through it is timed, priced and recorded.
 *
 * Applied at `providerFor`, which is the one place every agent reaches a
 * provider, so a new agent is instrumented by existing rather than by
 * remembering to opt in. That is the property worth having: the previous
 * design required each call site to record itself, and the failure mode of
 * that design is silence rather than an error.
 *
 * Observation only. The result and any thrown error pass through untouched.
 */
export function instrument(provider: LlmProvider, id: ProviderId): LlmProvider {
  const start = (agent: AgentKind, model: string, caseId?: string) => ({
    caseId,
    tenantId: currentTenant(),
    agent,
    // Read from the route rather than passed in: the tier is what the routing
    // decision recorded, and a second opinion here could disagree with the
    // tier the run reports.
    tier: routeFor(agent).tier,
    provider: id,
    model,
  });

  const record = async <T extends LlmResult>(
    req: { agent: AgentKind; model: string; caseId?: string },
    run: () => Promise<T>,
  ): Promise<T> =>
    withCall(start(req.agent, req.model, req.caseId), { sink: sink ?? undefined }, async call => {
      const result = await run();
      await call.succeeded(
        {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
        },
        { capabilityGaps: result.capabilityGaps, retries: result.retries },
      );
      return result;
    });

  return {
    id: provider.id,
    descriptor: () => provider.descriptor(),
    complete: (req: LlmRequest) => record(req, () => provider.complete(req)),
    runTools: (req: LlmToolRequest) => record(req, () => provider.runTools(req)),
  };
}
