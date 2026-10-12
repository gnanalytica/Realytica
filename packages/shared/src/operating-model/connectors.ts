/**
 * A project connected to a folder kept somewhere else.
 *
 * The folder is its owner's: they share it with the address this deployment
 * reads as, and paste its link here. Files that appear in it are taken in as
 * if they had been dropped in the app, each carrying where it came from.
 *
 * One connector a project, of one kind. Google Drive is the only kind there
 * is; a second (OneDrive) is another member of `ConnectorKind`, another line
 * in `CONNECTOR_KIND_LABEL`, another link reader in `folderIdOf`, and another
 * provider in the API. Nothing else here names Drive.
 *
 * What is kept on the project is small: which folder, who connected it, when
 * it was last read, what came of that, and the files left out with the
 * reason. Which file of the folder is which paper is kept beside the
 * project's documents, not on it: a folder of two thousand files would
 * otherwise be two thousand lines saved with every change to the project.
 *
 * Everything here is optional on a stored project, and a project without a
 * connector is read as one that was never connected.
 */

import type { DdProject } from './types';

export type ConnectorKind = 'google_drive';

export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  google_drive: 'Google Drive',
};

/** A file of the folder that was not taken in, and why. */
export interface ConnectorSkipped {
  fileId: string;
  /** Where it sits in the folder, folder names and its own, joined by " / ". */
  path: string;
  reason: string;
  at: string;
}

/** What the reads of a folder have come to since it was connected. */
export interface ConnectorCounts {
  /** Files taken in as papers, each change of a file counted once more. */
  takenIn: number;
  /** Of those, the ones that were a file already taken in, changed since. */
  changed: number;
  /** Files left out, as `skipped` lists them. */
  skipped: number;
  /** Files seen on the last read and not yet taken in: the read stopped at its limit. */
  waiting: number;
}

export interface ProjectConnector {
  kind: ConnectorKind;
  folderId: string;
  /** The folder's name, as the service gave it when it was connected. */
  folderName?: string;
  /** The link to open the folder, as the service gave it. */
  folderLink?: string;
  connectedBy: string;
  connectedAt: string;
  /** When the folder was last read to the end of the read, whatever it found. */
  lastSyncAt?: string;
  /**
   * Up to when the folder has been read in full: the next timed read asks
   * only for what was made or changed after it. Absent until one read has
   * gone through the whole folder with nothing left waiting.
   */
  cursor?: string;
  /** Why the last read failed. Gone once a read goes through. */
  lastError?: { message: string; at: string; /** The folder is no longer shared with this deployment. */ revoked?: boolean };
  counts: ConnectorCounts;
  /** The files left out, newest first, each once. Bounded: see `MAX_SKIPPED_KEPT`. */
  skipped: ConnectorSkipped[];
}

/**
 * Where a file on the record came from, when it was not dropped by a person:
 * the folder it was taken from, its place there, and which state of it this
 * is. Kept on the file itself, so a paper says its source wherever it is shown.
 */
export interface FileOrigin {
  kind: ConnectorKind;
  fileId: string;
  /** Folder names and the file's own, joined by " / ", from the connected folder down. */
  path: string;
  link?: string;
  /** What tells this state of the file from another: its checksum, or for a file with none its version. */
  checksum: string;
  /** When the file was last changed there. */
  modifiedAt?: string;
  takenAt: string;
}

/** How many left-out files a project keeps. The count goes on past it; the list does not. */
export const MAX_SKIPPED_KEPT = 50;

/** The longest link or id taken from a person. */
export const MAX_FOLDER_LINK = 400;

const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;

/**
 * The folder a pasted link names, for its kind. A Drive folder's link holds
 * its id after `/folders/`, or as `id=` on an older link; the bare id is
 * taken too. Anything else names no folder.
 */
export function folderIdOf(kind: ConnectorKind, link: string): string | undefined {
  const said = link.trim();
  if (!said || said.length > MAX_FOLDER_LINK) return undefined;
  if (kind !== 'google_drive') return undefined;
  if (DRIVE_ID.test(said)) return said;
  // Read by pattern, not as a URL: this package is built for places that have no URL type.
  const parts = /^https:\/\/(?:[a-z0-9-]+\.)*google\.com(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i.exec(said);
  if (!parts) return undefined;
  const inPath = /\/folders\/([A-Za-z0-9_-]+)/.exec(parts[1] ?? '')?.[1];
  const inQuery = /(?:^|&)id=([A-Za-z0-9_-]+)(?:&|$)/.exec(parts[2] ?? '')?.[1];
  const id = inPath ?? inQuery ?? '';
  return DRIVE_ID.test(id) ? id : undefined;
}

function trail(project: DdProject, actor: string, action: string, at: string, newValue?: string, oldValue?: string): void {
  project.audit.push({
    id: `aud_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    at,
    actor,
    action,
    entityType: 'connector',
    entityId: project.id,
    ...(oldValue ? { oldValue } : {}),
    ...(newValue ? { newValue } : {}),
  });
  project.updatedAt = at;
}

/** Connects the project to a folder, in place of any it was connected to. Nothing is read by this. */
export function connectFolder(
  project: DdProject,
  input: { kind: ConnectorKind; folderId: string; folderName?: string; folderLink?: string },
  actor: string,
  at = new Date().toISOString(),
): ProjectConnector {
  const before = project.connector;
  const connector: ProjectConnector = {
    kind: input.kind,
    folderId: input.folderId,
    ...(input.folderName ? { folderName: input.folderName.slice(0, 200) } : {}),
    ...(input.folderLink ? { folderLink: input.folderLink.slice(0, MAX_FOLDER_LINK) } : {}),
    connectedBy: actor,
    connectedAt: at,
    counts: { takenIn: 0, changed: 0, skipped: 0, waiting: 0 },
    skipped: [],
  };
  project.connector = connector;
  trail(project, actor, 'connector_connected', at, `${CONNECTOR_KIND_LABEL[input.kind]} · ${connector.folderName ?? connector.folderId}`, before ? (before.folderName ?? before.folderId) : undefined);
  return connector;
}

/** Disconnects the folder. The papers taken from it stay on the record. */
export function disconnectFolder(project: DdProject, actor: string, at = new Date().toISOString()): void {
  const before = project.connector;
  if (!before) return;
  project.connector = undefined;
  trail(project, actor, 'connector_disconnected', at, undefined, `${CONNECTOR_KIND_LABEL[before.kind]} · ${before.folderName ?? before.folderId}`);
}

/** Notes a file left out: once a file, newest first, the list bounded and the count not. */
export function noteSkipped(connector: ProjectConnector, skipped: ConnectorSkipped): void {
  const known = connector.skipped.some((held) => held.fileId === skipped.fileId);
  connector.skipped = [skipped, ...connector.skipped.filter((held) => held.fileId !== skipped.fileId)].slice(0, MAX_SKIPPED_KEPT);
  if (!known) connector.counts.skipped += 1;
}

/** A file that was left out and has now been taken in is left out no longer. */
export function clearSkipped(connector: ProjectConnector, fileId: string): void {
  if (!connector.skipped.some((held) => held.fileId === fileId)) return;
  connector.skipped = connector.skipped.filter((held) => held.fileId !== fileId);
  connector.counts.skipped = Math.max(0, connector.counts.skipped - 1);
}

/** How a connected folder stands, in a word a screen can show. */
export function connectorStanding(connector: ProjectConnector): 'not_read' | 'read' | 'waiting' | 'failed' | 'revoked' {
  if (connector.lastError) return connector.lastError.revoked ? 'revoked' : 'failed';
  if (!connector.lastSyncAt) return 'not_read';
  return connector.counts.waiting > 0 ? 'waiting' : 'read';
}

/** Where a file on the record came from, said in a line: "Google Drive · Site / Drawings / plan.pdf". */
export function originSaid(origin: FileOrigin): string {
  return `${CONNECTOR_KIND_LABEL[origin.kind]} · ${origin.path}`;
}
