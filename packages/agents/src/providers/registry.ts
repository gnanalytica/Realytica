/**
 * Provider resolution: turning "which agent is this" into "which endpoint
 * answers, and what will it not be able to do".
 *
 * `routing.ts` already decides *where* an agent runs (`routeFor`) and declares
 * *what each agent uses* (`AGENT_CAPABILITY_NEEDS`). This file is the join
 * between those two and the providers themselves: it hands back the provider
 * object for a route, fills in `AgentRoute.expectedGaps`, and produces the
 * wording an agent shows a user when its route has no credentials.
 *
 * The expected-gap calculation is the point of the whole exercise. Pointing
 * document intelligence at an OpenAI-compatible endpoint costs verified page
 * citations, and that is knowable from configuration alone — before a token is
 * spent, before a case is screened, before anyone reads an extracted field and
 * assumes a page number behind it. Telling an operator at startup beats
 * telling them afterwards.
 */

import type { AgentKind, AgentRoute, CapabilityGap, ProviderCapabilities, ProviderDescriptor, ProviderId } from '@realytica/shared';
import { AGENT_CAPABILITY_NEEDS, formatRoute, routeFor } from '../routing';
import { anthropicProvider } from './anthropic';
import { instrument } from './instrument';
import { openAiCompatibleProvider } from './openai';
import type { LlmProvider } from './types';

const PROVIDERS: Record<ProviderId, LlmProvider> = {
  anthropic: anthropicProvider,
  openai_compatible: openAiCompatibleProvider,
};

/**
 * Instrumented once, at module load.
 *
 * `providerFor` is the single point every agent reaches a provider through, so
 * wrapping here means a new agent is recorded by existing rather than by
 * remembering to opt in. Built eagerly rather than per call so the wrapper is
 * not re-allocated on every model request.
 */
const INSTRUMENTED: Record<ProviderId, LlmProvider> = {
  anthropic: instrument(PROVIDERS.anthropic, 'anthropic'),
  openai_compatible: instrument(PROVIDERS.openai_compatible, 'openai_compatible'),
};

/** The provider object for an id. Total over `ProviderId`, so a new id is a compile error here. */
export function providerFor(id: ProviderId): LlmProvider {
  return INSTRUMENTED[id];
}

/**
 * The provider without telemetry, for the capability probe and anything else
 * that must not appear in the cost view. Kept separate rather than adding a
 * flag to `providerFor`, so an unrecorded call is a deliberate import.
 */
export function rawProviderFor(id: ProviderId): LlmProvider {
  return PROVIDERS[id];
}

/** Every provider's current state, for the capability probe and the observability view. */
export function describeProviders(): ProviderDescriptor[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).map(id => PROVIDERS[id].descriptor());
}

/**
 * Which of the capabilities an agent uses this provider does not have.
 *
 * Intersected with `AGENT_CAPABILITY_NEEDS` rather than reported wholesale:
 * an OpenAI-compatible endpoint lacks server web search, but telling someone
 * that document intelligence has "no route to information outside the case
 * file" would be noise — that agent never asks for search. The gaps a run
 * *actually* hits are recorded per call by the provider itself; this is the
 * pre-flight view, and it is only useful if it stays specific.
 */
export function gapsFor(agent: AgentKind, capabilities: ProviderCapabilities): CapabilityGap[] {
  const missing: Partial<Record<CapabilityGap, boolean>> = {
    citations_unavailable: !capabilities.documentCitations,
    pdf_input_unavailable: !capabilities.pdfInput,
    prompt_caching_unavailable: !capabilities.promptCaching,
    adaptive_thinking_unavailable: !capabilities.adaptiveThinking,
    server_web_search_unavailable: !capabilities.serverWebSearch,
    refusal_fallback_unavailable: !capabilities.refusalFallback,
    strict_tools_unavailable: !capabilities.strictTools,
  };
  return AGENT_CAPABILITY_NEEDS[agent].filter(gap => missing[gap] === true);
}

export interface ResolvedRoute {
  route: AgentRoute;
  provider: LlmProvider;
  descriptor: ProviderDescriptor;
}

/**
 * Everything an agent needs to make its first decision: where it is going,
 * whether that place is reachable, and what it will lose by going there.
 *
 * `route.expectedGaps` is filled here rather than in `routeFor` because
 * `routeFor` must stay free of any dependency on a configured provider — it is
 * called by the capability probe on deployments that have no provider at all,
 * and a route is still a fact worth reporting when nothing can serve it.
 */
export function resolveRoute(agent: AgentKind): ResolvedRoute {
  const route = routeFor(agent);
  const provider = providerFor(route.provider);
  const descriptor = provider.descriptor();
  return {
    route: { ...route, expectedGaps: gapsFor(agent, descriptor.capabilities) },
    provider,
    descriptor,
  };
}

/* ==================================================================== */
/* Wording for an unreachable route                                      */
/* ==================================================================== */

/**
 * The short form: `"<why> — <what that means for this agent>"`.
 *
 * The Anthropic half is word-for-word what each agent said before the port
 * existed, because these strings reach users and a migration is not a licence
 * to reword them. The OpenAI-compatible half names the two variables an
 * operator has to set, since "not configured" without them is a scavenger
 * hunt.
 */
export function missingCredentialsReason(route: AgentRoute, clause: string): string {
  const head =
    route.provider === 'anthropic'
      ? 'Anthropic credentials are not configured'
      : `No OpenAI-compatible endpoint is configured for route ${formatRoute(route.provider, route.model)} (set REALYTICA_OPENAI_BASE_URL, and REALYTICA_OPENAI_API_KEY where the endpoint needs one)`;
  return `${head} — ${clause}`;
}

/** The long form, used where an agent already spelled out every credential it looks for. */
export function missingCredentialsDetail(route: AgentRoute, clause?: string): string {
  const head =
    route.provider === 'anthropic'
      ? 'Anthropic credentials are not configured for this deployment (no ANTHROPIC_API_KEY, auth token, or `ant auth login` profile was found)'
      : `No OpenAI-compatible endpoint is configured for this deployment (route ${formatRoute(route.provider, route.model)} needs REALYTICA_OPENAI_BASE_URL, and REALYTICA_OPENAI_API_KEY where the endpoint needs one)`;
  return clause ? `${head} — ${clause}` : `${head}.`;
}

/**
 * Whether a run may go ahead given the deployment-level capability probe.
 *
 * `agentCapability()` answers two questions at once: is the agent layer
 * switched on at all, and does this deployment hold Anthropic credentials.
 * The first applies to every route; the second only applies to a route that
 * actually goes to Anthropic. Blocking an OpenAI-compatible route because
 * there is no `ANTHROPIC_API_KEY` would make the whole port unusable on the
 * deployments it exists for.
 */
export function capabilityBlocksRoute(
  route: AgentRoute,
  capability: { available: boolean; reason: string },
): boolean {
  if (capability.available) return false;
  if (capability.reason === 'disabled') return true;
  return route.provider === 'anthropic';
}
