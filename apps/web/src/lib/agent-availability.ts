import type { AgentCapability, AgentKind } from '@valytica/shared';

/**
 * Can this agent actually run on this deployment?
 *
 * Not the same question as `capability.available`, which is the *Anthropic*
 * credential probe. A deployment that routes everything at an
 * OpenAI-compatible endpoint reports `available: false, reason:
 * no_credentials` and answers questions perfectly well, so a UI that reads
 * that flag tells the user their AI is switched off while it is working.
 *
 * That mistake has now been made twice — once in the intake opener, once in
 * the case chat — which is why it lives here rather than being recomputed at
 * each call site. The honest question is whether the provider serving *this
 * agent's route* has credentials, and the capability payload already carries
 * both halves.
 *
 * Falls back to `capability.available` when the payload predates per-route
 * reporting, and returns `undefined` while capability is still loading — so a
 * caller can tell "cannot" from "do not know yet" and avoid flashing a
 * switched-off notice at someone whose model is fine.
 */
export function agentAvailable(capability: AgentCapability | null | undefined, agent: AgentKind): boolean | undefined {
  if (!capability) return undefined;
  const route = capability.routes?.find(r => r.agent === agent);
  if (!route) return capability.available;
  const provider = capability.providers?.find(p => p.id === route.provider);
  if (!provider) return capability.available;
  return provider.configured;
}
