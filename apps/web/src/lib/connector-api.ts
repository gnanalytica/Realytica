import type { ConnectorKind, ProjectConnector } from '@realytica/shared';
import { request } from './api';

/**
 * The calls for a project's connected folder. Every one answers with how the
 * folder stands afterwards: whether the firm has set this up, the address a
 * folder is shared with, the connector, and whether this person may change it.
 */

export interface ConnectorShown {
  /** Whether the deployment holds what it needs to read a folder. */
  configured: boolean;
  kind: ConnectorKind;
  /** The address a folder's owner shares it with. */
  address?: string;
  connector?: ProjectConnector;
  mayChange: boolean;
  /** What the read just asked for came to. */
  run?: { takenIn: number; changed: number; skipped: number; waiting: number; failed: number; error?: string };
}

const at = (projectId: string) => `/projects/${projectId}/connector`;

export const connectorApi = {
  open: (projectId: string) => request<ConnectorShown>(at(projectId)),
  connect: (projectId: string, link: string) => request<ConnectorShown>(at(projectId), { method: 'PUT', body: JSON.stringify({ link }) }),
  sync: (projectId: string) => request<ConnectorShown>(`${at(projectId)}/sync`, { method: 'POST', body: '{}' }),
  disconnect: (projectId: string) => request<ConnectorShown>(at(projectId), { method: 'DELETE' }),
};
