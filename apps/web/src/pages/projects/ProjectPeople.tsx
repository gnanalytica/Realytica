import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Callout, Skeleton } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { TeamRoles } from '../../components/departments/TeamRoles';
import { PairPhone } from '../../components/departments/PairPhone';

/**
 * Who does what on this site.
 *
 * People come from the firm (org-wide staff). This page assigns them to
 * departments on the file, and pairs a phone for site work.
 */
export default function ProjectPeople() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const { data, error, loading } = useAsync(() => api.projectPeople(project.id), [project.id]);

  return (
    <div className="space-y-4">
      {error ? <Callout tone="critical" title="Could not load who is on this project">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-32 w-full" /> : null}
      {data ? (
        <TeamRoles
          project={project}
          staff={data.staff}
          named={data.staff.map((s) => ({ email: s.email, name: s.name }))}
          onChanged={setProject}
        />
      ) : null}
      <PairPhone />
    </div>
  );
}
