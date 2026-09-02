import type { NextFunction, Request, Response } from 'express';
import { can, type Capability, type Membership, type Principal, type Tenant } from '@realytica/shared';
import { store } from '../store';
import { readAuthSettings, type AuthSettings } from './config';
import { resolvePrincipal } from './principal';
import { TokenRejected, verifyIdToken } from './verify';

/**
 * The gate every API request goes through.
 *
 * Before this, `actorOf(req.body)` took the client's word for who was asking
 * and no route asked whether they were allowed to. Both halves are fixed here:
 * the actor comes from a verified token, and the token is resolved to a
 * membership in exactly one workspace.
 *
 * What a rejection says is deliberately thin. The log gets "expired" or
 * "issued for a different audience", because an operator needs to know which;
 * the client gets "Sign in again", because an attacker probing the difference
 * learns which of their guesses was closer.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

let settings: AuthSettings | null = null;

/** Read once at boot so a misconfiguration is a startup failure, not a 500. */
export function initAuth(env: NodeJS.ProcessEnv = process.env): AuthSettings {
  settings = readAuthSettings(env);
  return settings;
}

export function authSettings(): AuthSettings {
  if (!settings) settings = readAuthSettings();
  return settings;
}

/** Only for tests, which need to swap the mode between cases. */
export function setAuthSettingsForTest(next: AuthSettings | null): void {
  settings = next;
}

function workspace(): { tenants: Tenant[]; memberships: Membership[] } {
  if (!store.data.tenants) store.data.tenants = [];
  if (!store.data.memberships) store.data.memberships = [];
  return { tenants: store.data.tenants, memberships: store.data.memberships };
}

function bearer(req: Request): string | undefined {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return undefined;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return undefined;
  const token = rest.join('');
  return token || undefined;
}

/**
 * With auth off, every request is the same named local operator.
 *
 * A real membership is written for them so the rest of the system — tenant
 * scoping, roles, the members screen — runs down exactly the same path it will
 * in production. A dev-only bypass that skips tenancy is a dev-only bypass
 * that hides tenancy bugs until the day they matter.
 */
function localPrincipal(): { principal: Principal; changed: boolean } {
  const ws = workspace();
  const local = authSettings().localPrincipal;
  let membership = ws.memberships.find((m) => m.subject === local.subject);
  let changed = false;
  if (!membership) {
    let tenant = ws.tenants[0];
    if (!tenant) {
      tenant = { id: 'tnt_local', name: 'Local workspace', createdAt: new Date().toISOString() };
      ws.tenants.push(tenant);
    }
    membership = {
      tenantId: tenant.id,
      subject: local.subject,
      email: local.email,
      name: local.name,
      role: 'owner',
      createdAt: new Date().toISOString(),
    };
    ws.memberships.push(membership);
    changed = true;
  }
  return {
    changed,
    principal: {
      subject: local.subject,
      email: membership.email,
      name: membership.name,
      tenantId: membership.tenantId,
      role: membership.role,
    },
  };
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const config = authSettings();

  if (config.mode === 'off') {
    const { principal, changed } = localPrincipal();
    req.principal = principal;
    if (changed) await store.save();
    next();
    return;
  }

  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }

  try {
    const verified = await verifyIdToken(token, config.verifier!);
    const resolved = resolvePrincipal(workspace(), verified, config);
    if (!resolved.ok) {
      // A 403 is about standing rather than identity, so its reason is safe to
      // return: it tells a real person what to do next and tells an attacker
      // only that their real account is not a member here.
      res.status(resolved.status).json({ error: resolved.reason });
      return;
    }
    req.principal = resolved.principal;
    if (resolved.changed) await store.save();
    next();
  } catch (err) {
    if (err instanceof TokenRejected) {
      console.warn(`auth: rejected a token — ${err.message}`);
      res.status(401).json({ error: 'Sign in again.' });
      return;
    }
    next(err);
  }
}

/** The principal, or a throw. Routes past `authenticate` always have one. */
export function principalOf(req: Request): Principal {
  const principal = req.principal;
  if (!principal) throw new Error('Route reached without authentication');
  return principal;
}

/**
 * Gate a route on a capability.
 *
 * Mounted per router rather than per handler wherever a whole router shares a
 * level, so a route added later inherits the gate instead of being born
 * unguarded — which is the failure mode of per-handler checks.
 */
export function needs(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: 'Sign in to continue.' });
      return;
    }
    if (!can(principal.role, capability)) {
      res.status(403).json({ error: `Your role (${principal.role}) cannot do that.` });
      return;
    }
    next();
  };
}
