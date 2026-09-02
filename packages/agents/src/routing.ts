import type { AgentCapability, AgentKind, AgentRoute, CapabilityGap, ModelTier } from '@realytica/shared';
import { AGENT_TIERS, agentCapability, tierFor } from './client';
import { modelForTier } from './config';

/**
 * Which model each agent runs on, and where that decision came from.
 *
 * Routing is separate from tiering on purpose. A tier is a judgement about how
 * much capability a job needs; a route is which model buys it. Keeping them
 * apart means an operator can move one agent to a cheaper model without
 * restating what kind of work it does.
 *
 * There is no provider in a route any more. Every call leaves in Anthropic's
 * wire format, and which vendor answers is the proxy's decision — so a route
 * that named one would be asserting something this codebase cannot know. See
 * `ProviderId` in the shared types for the measurement behind that.
 */

/** The route for one agent: its tier's model, or the built-in default. */
export function routeFor(agent: AgentKind): AgentRoute {
  const tier = tierFor(agent);
  return { agent, tier, provider: 'anthropic', model: modelForTier(tier), source: 'tier_env', expectedGaps: [] };
}

/** Every agent's route. Used by the capability probe and the observability view. */
export function allRoutes(): AgentRoute[] {
  return (Object.keys(AGENT_TIERS) as AgentKind[]).map(routeFor);
}

/** A route as one string, for a telemetry key or a panel label. */
export function formatRoute(_provider: 'anthropic', model: string): string {
  return model;
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
  // No citations listed: an image block carries none on any provider, so there
  // is nothing here to lose. Strict tools keep the answer inside the declared
  // shape at the provider, which matters more than usual when the shape is the
  // thing stopping a description turning into a diagnosis.
  photo_intelligence: ['prompt_caching_unavailable', 'strict_tools_unavailable', 'adaptive_thinking_unavailable'],
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
