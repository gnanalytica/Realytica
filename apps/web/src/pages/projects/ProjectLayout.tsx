import { useParams } from 'react-router-dom';
import type { DdProject } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Callout, Skeleton } from '../../components/ui/kit';
import ProjectCockpit from './ProjectCockpit';

export interface ProjectOutlet {
  project: DdProject;
  refresh: () => Promise<void>;
  setProject: (next: DdProject) => void;
}

export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, error, loading, refresh, setData } = useAsync(() => api.getProject(projectId as string), [projectId]);

  if (loading && !project) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !project) {
    return (
      <div className="p-5">
        <Callout tone="critical" title="Project not found">{error ?? 'This project is not in the store.'}</Callout>
      </div>
    );
  }

  return (
    <ProjectCockpit
      outlet={{
        project,
        refresh,
        setProject: (next) => setData(next),
      }}
    />
  );
}
