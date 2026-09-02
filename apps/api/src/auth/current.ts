import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from '@realytica/shared';

/**
 * Who the request in flight belongs to, readable from anywhere below it.
 *
 * Ambient state is usually the wrong answer and it is the right one here. The
 * alternative is a `tenantId` threaded through every agent, every provider
 * adapter and every model call site — and the field beside this one on the
 * telemetry record, `caseId`, is the experiment that already ran: it was
 * threaded by hand, almost nobody passed it, and the per-case cost filter
 * matched nothing for most of the app's calls. A parameter that must be
 * remembered at forty call sites is a parameter that is missing at thirty of
 * them, and the failure is silent in the direction that loses the scoping.
 *
 * `AsyncLocalStorage` follows the request across every await between the
 * middleware and the provider, so a call made six frames deep inside an agent
 * is attributed without the agent knowing a workspace exists.
 */
const store = new AsyncLocalStorage<Principal>();

/** Run the rest of a request with this principal in scope. */
export function withPrincipal<T>(principal: Principal, run: () => T): T {
  return store.run(principal, run);
}

/** The principal of the request in flight, or nothing outside one. */
export function currentPrincipal(): Principal | undefined {
  return store.getStore();
}

export function currentTenantId(): string | undefined {
  return store.getStore()?.tenantId;
}
