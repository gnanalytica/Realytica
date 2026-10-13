/**
 * The project's parties, as one short list by role.
 *
 * Who the owner is, who manages the project, the architect, the structural
 * and MEP consultants, the cost consultant, the contractors and the lender:
 * the people a paper is owed by and a field refers to. They are the shared
 * party records (`shared.parties`), entered once; this is the same list read
 * by role, for the project's People page. Nothing is kept here.
 *
 * Only a name that stands is listed: one a paper offered and nobody has
 * accepted is counted, never named as a party. Read from whatever copy of
 * the project is in hand, so somebody working from a grant sees the parties
 * their copy holds and no others.
 */

import { SHARED_RECORD_SETS } from './field-sets/shared-records';
import { standingRecords, standingText } from './standing-records';
import type { DdProject } from './types';

export interface ProjectParty {
  id: string;
  name: string;
  organisation?: string;
  /** Every role the record gives it, by key. */
  roles: string[];
}

export interface PartyGroup {
  key: string;
  /** "Architect", "Contractors". */
  label: string;
  /** The role a party added under this heading is given. Absent for the heading that gathers the rest. */
  role?: string;
  parties: ProjectParty[];
}

/** The headings of the list, in the order a project names them, each with the roles of the party record it gathers. */
export const PARTY_GROUPS: ReadonlyArray<{ key: string; label: string; role: string; roles: readonly string[] }> = [
  { key: 'owner', label: 'Owner', role: 'owner', roles: ['owner', 'developer'] },
  { key: 'project_manager', label: 'Project manager', role: 'project_manager', roles: ['project_manager'] },
  { key: 'architect', label: 'Architect', role: 'architect', roles: ['architect'] },
  { key: 'structural', label: 'Structural consultant', role: 'structural_consultant', roles: ['structural_consultant', 'engineer'] },
  { key: 'mep', label: 'MEP consultant', role: 'mep_consultant', roles: ['mep_consultant'] },
  { key: 'cost', label: 'Cost consultant', role: 'cost_consultant', roles: ['cost_consultant'] },
  { key: 'contractor', label: 'Contractors', role: 'contractor', roles: ['contractor'] },
  { key: 'lender', label: 'Lender', role: 'lender', roles: ['lender'] },
];

export interface ProjectParties {
  /** Every heading, in order, with nobody under it where nobody is named; then "Other parties" where any party fits none. */
  groups: PartyGroup[];
  /** Every party that stands, by name. */
  named: number;
  /** Parties a paper offered that nobody has accepted: counted, and named nowhere. */
  offered: number;
}

/** The project's parties by role, from the shared party records of the copy in hand. */
export function partiesByRole(project: Partial<Pick<DdProject, 'fieldSheets'>>): ProjectParties {
  // Through the one door other modules read a set's records by: each record still on its list, cut to what stands.
  const kept = standingRecords(project, SHARED_RECORD_SETS.party);
  const parties: ProjectParty[] = [];
  for (const held of kept) {
    const name = standingText(held, 'name')?.trim();
    if (!name) continue;
    const roles = held.values.roles?.value;
    const organisation = standingText(held, 'organisation')?.trim();
    parties.push({ id: held.id, name, ...(organisation ? { organisation } : {}), roles: Array.isArray(roles) ? (roles as unknown[]).filter((role): role is string => typeof role === 'string') : [] });
  }
  // A record with no name that stands is one a paper offered and nobody has accepted, or one nobody has named yet.
  const offered = kept.length - parties.length;
  const byName = (a: ProjectParty, b: ProjectParty): number => a.name.localeCompare(b.name);
  const placed = new Set<string>();
  const groups: PartyGroup[] = PARTY_GROUPS.map((group) => {
    const held = parties.filter((party) => party.roles.some((role) => group.roles.includes(role))).sort(byName);
    for (const party of held) placed.add(party.id);
    return { key: group.key, label: group.label, role: group.role, parties: held };
  });
  const rest = parties.filter((party) => !placed.has(party.id)).sort(byName);
  if (rest.length) groups.push({ key: 'other', label: 'Other parties', parties: rest });
  return { groups, named: parties.length, offered };
}
