import type { AgentCapability, AgentKind, AgentRoute, CapabilityGap, ModelTier, ProviderId } from '@realytica/shared';
import { AGENT_TIERS, agentCapability, tierFor, warnOnce } from './client';

/**
 * Which provider and model each agent runs on, and where that decision came
 * from.
 *
 * Routing is separate from tiering on purpose. A tier is a judgement about
 * how much capability a job needs; a route is where that capability is bought.
 * Keeping them apart means an operator can move one agent to a cheaper vendor
 * without restating what kind of work it does, and the two decisions stay
 * independently explicable when a result looks wrong.
 *
 * Every route records its `source`. A surprising route — an agent on a model
 * nobody expected — is otherwise an archaeology exercise across four
 * environment variables, and the one time that matters is during an incident.
 */

/* ==================================================================== */
/* Route syntax                                                          */
/* ==================================================================== */

/**
 * A route is written `provider:model`, or bare `model` for Anthropic.
 *
 * The bare form is what every existing deployment already has in
 * `REALYTICA_MODEL_REASONING` and friends, so those keep working untouched and
 * mean exactly what they meant before.
 *
 *   claude-opus-5
 *   anthropic:claude-opus-5
 *   openai_compatible:anthropic/claude-haiku-4.5
 *   openai_compatible:meta-llama/llama-3.3-70b-instruct
 *
 * The model half is passed through verbatim, including slashes — an
 * OpenRouter model id is `vendor/model` and splitting on anything but the
 * first colon would mangle it.
 */
export function parseRoute(raw: string): { provider: ProviderId; model: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colon = trimmed.indexOf(':');
  if (colon === -1) return { provider: 'anthropic', model: trimmed };
  const provider = trimmed.slice(0, colon);
  const model = trimmed.slice(colon + 1).trim();
  if (!model) return null;
  if (provider === 'anthropic' || provider === 'openai_compatible') return { provider, model };
  return null;
}

export function formatRoute(provider: ProviderId, model: string): string {
  return `${provider}:${model}`;
}

/* ==================================================================== */
/* Resolution                                                            */
/* ==================================================================== */

const TIER_ROUTE_ENV: Record<ModelTier, string> = {
  extraction: 'REALYTICA_MODEL_EXTRACTION',
  reasoning: 'REALYTICA_MODEL_REASONING',
  judgment: 'REALYTICA_MODEL_JUDGMENT',
};

const TIER_DEFAULT_ROUTES: Record<ModelTier, string> = {
  extraction: 'anthropic:claude-haiku-4-5-20251001',
  reasoning: 'anthropic:claude-sonnet-5',
  judgment: 'anthropic:claude-opus-5',
};

function readRoute(name: string): { provider: ProviderId; model: string } | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = parseRoute(raw);
  if (!parsed) {
    // Ignored rather than thrown: a typo in a deployment variable must not
    // take the agent layer down, and the warning names exactly what was
    // dropped so the mistake is findable.
    warnOnce(
      `route:${name}:${raw}`,
      `Ignoring ${name}="${raw}" — expected "model" or "provider:model" with provider one of anthropic/openai_compatible.`,
    );
    return null;
  }
  return parsed;
}

/**
 * The route for one agent, most specific override first.
 *
 *   1. `REALYTICA_ROUTE_<AGENT>`   — this one agent, anywhere
 *   2. `REALYTICA_AGENT_MODEL`     — collapses the whole roster onto one route
 *   3. `REALYTICA_MODEL_<TIER>`    — every agent on that tier
 *   4. the built-in default for the tier
 *
 * `REALYTICA_AGENT_MODEL` sits above the tier variables rather than below them
 * because that is what it already meant: the switch an operator throws to pin
 * everything during an incident. Demoting it would silently un-pin two thirds
 * of the roster on deployments that rely on it. The per-agent override sits
 * above it so a single exception is still expressible while pinned.
 */
export function routeFor(agent: AgentKind): AgentRoute {
  const tier = tierFor(agent);

  const perAgent = readRoute(`REALYTICA_ROUTE_${agent.toUpperCase()}`);
  if (perAgent) return { agent, tier, ...perAgent, source: 'agent_env', expectedGaps: [] };

  const global = readRoute('REALYTICA_AGENT_MODEL');
  if (global) return { agent, tier, ...global, source: 'global_env', expectedGaps: [] };

  const perTier = readRoute(TIER_ROUTE_ENV[tier]);
  if (perTier) return { agent, tier, ...perTier, source: 'tier_env', expectedGaps: [] };

  // The default is a literal this module owns; parseRoute cannot fail on it.
  const fallback = parseRoute(TIER_DEFAULT_ROUTES[tier]) ?? { provider: 'anthropic' as const, model: 'claude-opus-5' };
  return { agent, tier, ...fallback, source: 'default', expectedGaps: [] };
}

/** Every agent's route. Used by the capability probe and the observability view. */
export function allRoutes(): AgentRoute[] {
  return (Object.keys(AGENT_TIERS) as AgentKind[]).map(routeFor);
}

/* ==================================================================== */
/* What each agent needs from a provider                                 */
/* ==================================================================== */

/**
 * Capabilities each agent actually uses.
 *
 * Declared here rather than discovered at call time so a route can be checked
 * before a single token is spent: pointing document intelligence at a provider
 * with no citation support is knowable from configuration alone, and telling
 * an operator that at startup beats telling them after a case has been
 * screened without verified page references.
 *
 * The list is what the agent *uses*, not what it requires. Most of these
 * degrade — losing prompt caching costs money, losing citations costs
 * grounding — which is why the consequence is spelled out per agent in
 * `describeGap` rather than left as a boolean.
 */
export const AGENT_CAPABILITY_NEEDS: Record<AgentKind, CapabilityGap[]> = {
  property_discovery: ['server_web_search_unavailable', 'prompt_caching_unavailable'],
  document_intelligence: ['citations_unavailable', 'pdf_input_unavailable', 'prompt_caching_unavailable', 'strict_tools_unavailable'],
  proof_pathways: ['prompt_caching_unavailable', 'adaptive_thinking_unavailable', 'strict_tools_unavailable'],
  market_research: ['server_web_search_unavailable', 'prompt_caching_unavailable'],
  explorer: ['server_web_search_unavailable', 'adaptive_thinking_unavailable'],
  analyst_copilot: ['prompt_caching_unavailable', 'adaptive_thinking_unavailable', 'strict_tools_unavailable'],
  critic: ['adaptive_thinking_unavailable', 'strict_tools_unavailable'],
  planner: ['adaptive_thinking_unavailable', 'strict_tools_unavailable'],
  diligence_planner: ['prompt_caching_unavailable', 'strict_tools_unavailable'],
  // Caching matters most here of anywhere: the system prompt is identical on
  // every turn of a conversation, so without it the whole prefix is re-billed
  // per message. Strict tools keep a capture inside the declared field table
  // at the provider rather than only at our own validator.
  intake_concierge: ['prompt_caching_unavailable', 'strict_tools_unavailable'],
  title_graph: ['adaptive_thinking_unavailable', 'strict_tools_unavailable'],
  orchestrator: [],
};

/**
 * What losing a capability actually costs, in this product's terms.
 *
 * Written for the person reading an observability panel at the moment a
 * result looks thin, so each line names the consequence rather than the
 * feature. "citations_unavailable" is a fact; "page references are
 * self-reported and may be wrong" is what they need to know.
 */
export function describeGap(gap: CapabilityGap): string {
  switch (gap) {
    case 'citations_unavailable':
      return 'Page references are self-reported by the model rather than verified against the document, so a quoted page can be wrong. Extraction confidence is reduced accordingly.';
    case 'pdf_input_unavailable':
      return 'PDFs must be converted before sending, so layout and page structure are lost and a scanned document may not be readable at all.';
    case 'prompt_caching_unavailable':
      return 'The stable prefix is re-sent and re-billed on every call. Costs more; changes nothing about the answer.';
    case 'adaptive_thinking_unavailable':
      return 'The model cannot allocate extra reasoning to a hard case, so quality is flat across easy and difficult work.';
    case 'server_web_search_unavailable':
      return 'No provider-run search, so this agent has no route to information outside the case file.';
    case 'refusal_fallback_unavailable':
      return 'A safety decline ends the run rather than being retried on another model.';
    case 'strict_tools_unavailable':
      return 'Tool arguments are not schema-guaranteed, so a malformed response is possible and has to be validated and retried in-app.';
  }
}

/* ==================================================================== */
/* Capability, composed                                                  */
/* ==================================================================== */

/**
 * `agentCapability()` plus full routing.
 *
 * Kept here rather than folded into `agentCapability` itself, and not merely
 * to avoid an import cycle. The core probe answers "can the agent layer run
 * at all", which has to stay true with no provider configured and no routing
 * resolved — that is exactly the state a disabled deployment is in, and it is
 * when an operator most needs a straight answer. Routing is a layer above
 * that: it presumes the question is already settled and asks where each agent
 * would go.
 *
 * `expectedGaps` is filled by the caller that knows the provider registry.
 * This function deliberately does not reach for it, so the capability probe
 * never depends on a provider being constructible.
 */
export function capabilityWithRoutes(): AgentCapability {
  return { ...agentCapability(), routes: allRoutes() };
}
