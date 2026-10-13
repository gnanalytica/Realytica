import type { ProjectCockpitPane, WaitingEntry } from '@realytica/shared';

/**
 * What waits for a person on the page in view.
 *
 * On a register it is everything that waits in that register's tab. On a
 * function's page it is only what concerns that function: a proposal about
 * another function, or about none (the project's address), is not this
 * page's to show, and is counted on the bell, which walks to it.
 *
 * `sameTab` says whether two panes sit under one tab; the rail knows.
 */
export function waitingOnPane(
  entries: readonly WaitingEntry[],
  at: { pane: ProjectCockpitPane; workstream?: string; sameTab: (a: ProjectCockpitPane, b: ProjectCockpitPane) => boolean },
): WaitingEntry[] {
  if (at.pane === 'workstream') return entries.filter((entry) => Boolean(at.workstream) && entry.pane === 'workstream' && entry.fn === at.workstream);
  return entries.filter((entry) => at.sameTab(entry.pane, at.pane) || (at.pane === 'dd' && entry.pane === 'scope'));
}
