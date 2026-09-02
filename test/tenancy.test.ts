/**
 * Who may do what, and the two ways a workspace can be lost.
 *
 * The rules are small enough to read, which is the point — an authorisation
 * model nobody can hold in their head is one that gets worked around. What is
 * worth testing is the handful of places where the obvious implementation is
 * wrong: an invite that could steal a bound account, a last owner who demotes
 * themselves out of their own workspace, and an email that differs only by
 * case between two identity providers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_ROLES,
  actorOf,
  can,
  domainOf,
  membershipFor,
  sameEmail,
  wouldOrphanWorkspace,
  type Membership,
  type WorkspaceRole,
} from '@realytica/shared';

function member(over: Partial<Membership> = {}): Membership {
  return {
    tenantId: 't1',
    email: 'a@firm.in',
    role: 'staff',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('what a role may do', () => {
  it('gives a viewer reading and nothing else', () => {
    assert.equal(can('viewer', 'read'), true);
    assert.equal(can('viewer', 'write'), false);
    assert.equal(can('viewer', 'admin'), false);
    assert.equal(can('viewer', 'owner'), false);
  });

  it('lets staff record but not run the workspace', () => {
    assert.equal(can('staff', 'write'), true);
    assert.equal(can('staff', 'admin'), false);
  });

  it('keeps the workspace itself to its owner', () => {
    assert.equal(can('manager', 'admin'), true);
    assert.equal(can('manager', 'owner'), false);
    assert.equal(can('owner', 'owner'), true);
  });

  it('gives a collaborator nothing at the workspace level beyond the gate', () => {
    // Their writing is decided per project by their grant, so the workspace
    // capability is deliberately permissive and deliberately not the answer.
    assert.equal(can('collaborator', 'admin'), false);
    assert.equal(can('collaborator', 'owner'), false);
  });

  it('never grants a capability without the ones below it', () => {
    const ladder = ['read', 'write', 'admin', 'owner'] as const;
    for (const role of WORKSPACE_ROLES) {
      const held = ladder.map((c) => can(role, c));
      const firstDenied = held.indexOf(false);
      if (firstDenied === -1) continue;
      assert.ok(
        held.slice(firstDenied).every((h) => !h),
        `${role} holds a capability above one it is denied`,
      );
    }
  });
});

describe('matching a token to a membership', () => {
  it('finds the membership its subject is bound to', () => {
    const rows = [member({ subject: 'sub-1', email: 'asha@firm.in' })];
    const hit = membershipFor(rows, { subject: 'sub-1', email: 'asha@firm.in' });
    assert.equal(hit?.email, 'asha@firm.in');
  });

  it('claims an invite written against the email before anybody has signed in', () => {
    const rows = [member({ email: 'new@firm.in', role: 'manager' })];
    const hit = membershipFor(rows, { subject: 'sub-9', email: 'new@firm.in' });
    assert.equal(hit?.role, 'manager');
    assert.equal(hit?.subject, undefined, 'binding is the caller’s job, not the lookup’s');
  });

  it('ignores case, because two providers will not agree on it', () => {
    const rows = [member({ email: 'Asha@Firm.IN' })];
    assert.ok(membershipFor(rows, { subject: 's', email: 'asha@firm.in' }));
    assert.equal(sameEmail('A@B.C', 'a@b.c '), true);
  });

  it('does not let a fresh invite outrank an account already bound to that address', () => {
    // The attack this closes: a manager invites "asha@firm.in" as owner while
    // Asha's own account is already bound as staff. Matching the invite first
    // would silently promote whoever signs in next.
    const rows = [
      member({ subject: 'sub-1', email: 'asha@firm.in', role: 'staff' }),
      member({ email: 'asha@firm.in', role: 'owner' }),
    ];
    const hit = membershipFor(rows, { subject: 'sub-1', email: 'asha@firm.in' });
    assert.equal(hit?.role, 'staff');
  });

  it('returns nothing for somebody with no membership at all', () => {
    assert.equal(membershipFor([member()], { subject: 'x', email: 'stranger@else.com' }), undefined);
  });
});

describe('keeping a workspace administrable', () => {
  const rows = (roles: WorkspaceRole[]) => roles.map((role, i) => member({ role, subject: `s${i}` }));

  it('refuses to let the last owner step down', () => {
    const only = rows(['owner', 'manager', 'staff']);
    assert.equal(wouldOrphanWorkspace(only, 't1', only[0]!, 'staff'), true);
    assert.equal(wouldOrphanWorkspace(only, 't1', only[0]!, 'removed'), true);
  });

  it('allows it once there is a second owner', () => {
    const two = rows(['owner', 'owner']);
    assert.equal(wouldOrphanWorkspace(two, 't1', two[0]!, 'staff'), false);
  });

  it('does not care what happens to anybody who is not an owner', () => {
    const some = rows(['owner', 'manager']);
    assert.equal(wouldOrphanWorkspace(some, 't1', some[1]!, 'removed'), false);
  });

  it('counts owners in this workspace only', () => {
    const here = member({ role: 'owner', subject: 'a' });
    const elsewhere = member({ tenantId: 't2', role: 'owner', subject: 'b' });
    assert.equal(wouldOrphanWorkspace([here, elsewhere], 't1', here, 'staff'), true);
  });
});

describe('how a caller is written down', () => {
  it('prints the email, because a trail is read by people', () => {
    assert.equal(
      actorOf({ subject: '1148203984710', email: 'asha@firm.in', tenantId: 't1', role: 'staff' }),
      'asha@firm.in',
    );
  });

  it('falls back to the subject when a provider gives no email', () => {
    assert.equal(actorOf({ subject: 'sub-1', email: '', tenantId: 't1', role: 'staff' }), 'sub-1');
  });

  it('reads a domain off an address', () => {
    assert.equal(domainOf('Asha@Firm.IN'), 'firm.in');
    assert.equal(domainOf('not-an-email'), '');
  });
});
