/**
 * The firm's own menu: the places in the sidebar, and who is shown each.
 *
 * A place a person cannot use is not listed for them. Law and policy is the
 * firm's own people's; Integrations is for the firm's owner and managers;
 * Set up is read by the firm's own people. The server refuses each of them
 * to anybody else whatever the menu shows: hiding an entry is a courtesy.
 */
import { can, reachesEveryProject, type WorkspaceRole } from './tenancy';

export type WorkspacePlaceKey = 'portfolio' | 'work' | 'requests' | 'members' | 'law' | 'libraries' | 'setup' | 'integrations' | 'about';

export interface WorkspacePlace {
  key: WorkspacePlaceKey;
  to: string;
  label: string;
  /** Above the rule is the work; below it is how the workspace is set up, and reference. */
  group: 'work' | 'more';
}

export const WORKSPACE_PLACES: readonly WorkspacePlace[] = [
  { key: 'portfolio', to: '/portfolio', label: 'Portfolio', group: 'work' },
  { key: 'work', to: '/work', label: 'My work', group: 'work' },
  { key: 'requests', to: '/requests', label: 'Requests', group: 'work' },
  { key: 'members', to: '/members', label: 'People', group: 'work' },
  { key: 'law', to: '/law', label: 'Law and policy', group: 'more' },
  { key: 'libraries', to: '/libraries', label: 'Libraries', group: 'more' },
  { key: 'setup', to: '/setup', label: 'Set up', group: 'more' },
  { key: 'integrations', to: '/integrations', label: 'Integrations', group: 'more' },
  { key: 'about', to: '/about', label: 'About', group: 'more' },
];

/** Whether somebody in a role may use a place. Nobody signed in yet is shown only what everybody is. */
export function mayOpenWorkspacePlace(role: WorkspaceRole | undefined, key: WorkspacePlaceKey): boolean {
  if (key === 'law' || key === 'setup') return role ? reachesEveryProject(role) : false;
  if (key === 'integrations') return role ? can(role, 'admin') : false;
  return true;
}

/** The menu as one person is shown it. */
export function workspacePlaces(role: WorkspaceRole | undefined): WorkspacePlace[] {
  return WORKSPACE_PLACES.filter((place) => mayOpenWorkspacePlace(role, place.key));
}
