import type { ConnectorKind } from '@realytica/shared';
import { googleDrive } from './google-drive';
import type { FolderProvider } from './provider';

/** The provider that reads folders of a kind. A second kind is another case here. */
export function providerFor(kind: ConnectorKind): FolderProvider {
  switch (kind) {
    case 'google_drive':
      return googleDrive();
  }
}
