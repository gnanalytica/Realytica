import type { ApiKeyScope, WebhookEventType } from '@realytica/shared';
import { request } from './api';

/**
 * The calls behind the Integrations page: the firm's API keys, the addresses
 * it has registered for events, and what was sent to them. For an owner or a
 * manager; the server refuses anybody else.
 */

export interface ApiKeyShown {
  id: string;
  name: string;
  /** The start of the key. The rest was shown once, when it was made. */
  prefix: string;
  scopes: ApiKeyScope[];
  projectIds: string[] | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface EndpointShown {
  id: string;
  url: string;
  events: WebhookEventType[];
  createdAt: string;
  createdBy: string;
  failingSince: string | null;
}

export interface DeliveryShown {
  id: string;
  endpointId: string;
  eventId: string;
  type: string;
  projectId?: string;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'delivered' | 'failed' | 'gave_up';
  lastStatus?: number;
  lastError?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
}

export interface IntegrationsShown {
  keys: ApiKeyShown[];
  endpoints: EndpointShown[];
  deliveries: DeliveryShown[];
  /** Whether this deployment can keep a signing secret, and the setting it needs when it cannot. */
  webhooks: { available: true } | { available: false; needs: string };
  projects: Array<{ id: string; reference: string; name: string }>;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export const integrationsApi = {
  open: () => request<IntegrationsShown>('/integrations'),
  createKey: (input: { name: string; scopes: ApiKeyScope[]; projectIds?: string[]; expiresInDays: number | null }) =>
    request<{ token: string; key: ApiKeyShown }>('/integrations/keys', post(input)),
  revokeKey: (id: string) => request<{ key: ApiKeyShown }>(`/integrations/keys/${id}`, { method: 'DELETE' }),
  addEndpoint: (input: { url: string; events: WebhookEventType[] }) => request<{ secret: string; endpoint: EndpointShown }>('/integrations/endpoints', post(input)),
  removeEndpoint: (id: string) => request<void>(`/integrations/endpoints/${id}`, { method: 'DELETE' }),
  testEndpoint: (id: string) => request<{ delivery: DeliveryShown }>(`/integrations/endpoints/${id}/test`, post()),
};
