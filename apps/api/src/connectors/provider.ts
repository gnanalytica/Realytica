/**
 * What a connected folder's service has to answer, whichever service it is.
 *
 * The sync (`./sync.ts`) knows nothing of Google: it asks a provider for a
 * folder, for what is in it, and for a file's bytes. Google Drive is the one
 * provider (`./google-drive.ts`). A second kind is another of these and a
 * line in `providerFor` (`./index.ts`).
 */

import type { ConnectorKind } from '@realytica/shared';

/** One thing in a folder, as its service lists it. */
export interface RemoteEntry {
  id: string;
  /** The name it is filed under here: its own, with an extension added where it is exported to a file. */
  name: string;
  /** The type of the bytes `download` gives. */
  mimeType: string;
  folder: boolean;
  /** Absent where the service does not say (a document of its own kind, exported on the way out). */
  sizeBytes?: number;
  /** What tells one state of the file from another: its content's checksum, or for a file with none when it was last changed. */
  checksum: string;
  /** Whether `checksum` is of the content, so two files with the same one are the same file. */
  contentChecksum: boolean;
  modifiedAt?: string;
  link?: string;
  /** The file has no bytes of its own at the service and is exported to `mimeType` on the way out. */
  exported?: true;
  /** Why the service cannot hand this over as a file, where it cannot. */
  unreadable?: string;
}

/** The folder is not there for this deployment: never shared with it, shared no longer, or gone. */
export class FolderGone extends Error {
  constructor(message = 'The folder is not shared with this deployment.') {
    super(message);
    this.name = 'FolderGone';
  }
}

/** This one file cannot be taken, and asking again will not change that until the file does. */
export class FileUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileUnreadable';
  }
}

export interface FolderProvider {
  readonly kind: ConnectorKind;
  /** Whether the deployment holds what it needs to read folders of this kind. */
  configured(): boolean;
  /** The address a folder's owner shares it with. Absent where the deployment is not set up. */
  address(): string | undefined;
  /** The folder itself. Throws `FolderGone` where it is not there for this deployment. */
  folder(folderId: string): Promise<{ id: string; name: string; link?: string }>;
  /**
   * Everything directly in a folder, every page of it. With `since`, its
   * folders and only the files made or changed after then.
   */
  list(folderId: string, since?: string): Promise<RemoteEntry[]>;
  /** A file's bytes, no more than `maxBytes` of them. Throws `FileUnreadable` for one that cannot be taken. */
  download(entry: RemoteEntry, maxBytes: number): Promise<Buffer>;
}

/** Why a file past the limit was left out, with the limit. */
export function tooLarge(maxBytes: number): string {
  return `Larger than ${Math.round(maxBytes / (1024 * 1024))} MB, the most one file can be.`;
}
