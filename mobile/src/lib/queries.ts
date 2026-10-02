/**
 * Server reads, through TanStack Query, each backed by the phone's saved copy.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { readThrough, type Cached } from './cache';
import type { ProjectSummary, SiteAlert, SiteView } from './types';

export const projectsKey = ['projects'] as const;
export const siteKey = (projectId: string) => ['site', projectId] as const;

export function useProjects() {
  return useQuery<Cached<ProjectSummary[]>>({
    queryKey: projectsKey,
    queryFn: () => readThrough(projectsKey, api.projects),
  });
}

export function useSite(projectId: string) {
  return useQuery<Cached<SiteView>>({
    queryKey: siteKey(projectId),
    queryFn: () => readThrough(siteKey(projectId), () => api.site(projectId)),
    enabled: !!projectId,
  });
}

/** Mark alerts read. Needs a connection; the screen says so when there is none. */
export function useMarkAlertsRead(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | 'all') => api.markAlertsRead(projectId, ids),
    onSuccess: (res) => {
      client.setQueryData<Cached<SiteView>>(siteKey(projectId), (prev) =>
        prev
          ? {
              ...prev,
              value: {
                ...prev.value,
                // The answer covers every department; this screen only shows construction's.
                alerts: mergeReadState(prev.value.alerts, res.alerts),
              },
            }
          : prev,
      );
    },
  });
}

function mergeReadState(shown: SiteAlert[], fresh: SiteAlert[]): SiteAlert[] {
  const byId = new Map(fresh.map((a) => [a.id, a]));
  return shown.filter((a) => byId.has(a.id)).map((a) => ({ ...a, readBy: byId.get(a.id)!.readBy }));
}
