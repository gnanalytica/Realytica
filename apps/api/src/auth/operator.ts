import type { Request } from 'express';
import { sameEmail, type Principal } from '@realytica/shared';
import { store } from '../store';
import { principalOf } from './middleware';

/**
 * Who may change what the agents are told to do.
 *
 * The prompt registry is one registry for the whole deployment — there is no
 * per-workspace copy, and there should not be, because the prompts are the
 * product rather than anybody's data. That is fine until a second workspace
 * exists, at which point `needs('admin')` means the admin of workspace B can
 * rewrite the instructions workspace A's agents run under. Nothing in the
 * request is wrong; the authority is simply larger than the role.
 *
 * So changing them needs standing that the workspace roles do not grant:
 *
 *   `REALYTICA_OPERATORS` names the addresses that run this deployment. When
 *   it is set, it is the whole answer.
 *
 *   When it is not set, the owner of the only workspace on the deployment is
 *   the operator — which is what a local install and a single-firm deployment
 *   both are, and neither should need configuration to edit a prompt.
 *
 * The second rule stops the moment a second workspace appears. That is
 * deliberate and it is the point: a deployment that has become shared has no
 * operator until somebody says who it is, and refusing an edit is recoverable
 * in a way that letting one firm rewrite another's agents is not.
 *
 * Reading stays with admins. What the agents are told is worth being able to
 * see; it is the writing that is not any admin's to do.
 */
export function operatorEmails(): string[] {
  return (process.env.REALYTICA_OPERATORS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOperator(me: Principal): boolean {
  const named = operatorEmails();
  if (named.length > 0) return named.some((email) => sameEmail(email, me.email));

  const tenants = store.data.tenants ?? [];
  return tenants.length <= 1 && me.role === 'owner';
}

/** Why the refusal, in words a person can act on. */
export function whyNotOperator(): string {
  return operatorEmails().length > 0
    ? 'The prompts belong to whoever runs this deployment. Ask them to make the change.'
    : 'More than one workspace shares these prompts, so no one workspace may rewrite them. '
      + 'Set REALYTICA_OPERATORS to the addresses that run this deployment.';
}

/** Express guard. Reading is an admin's; writing is not. */
export function needsOperator(req: Request, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void): void {
  if (isOperator(principalOf(req))) {
    next();
    return;
  }
  res.status(403).json({ error: whyNotOperator() });
}
