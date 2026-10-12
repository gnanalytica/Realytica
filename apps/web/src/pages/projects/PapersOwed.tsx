import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { PAPERS_OWED, cockpitPath, reachesEveryProject } from '@realytica/shared';
import { useMe } from '../../lib/useMe';
import { Card, EmptyState } from '../../components/ui/kit';
import { PapersOwedCard } from '../../components/papers/PapersOwedCard';
import type { ProjectOutlet } from './ProjectLayout';

/**
 * Papers owed, for the whole project: what every desk waits for, by who owes
 * it, with the replies that wait to be confirmed.
 *
 * It names every party the firm is chasing, so it is the firm's own page, as
 * Review and People are. Somebody working from a grant keeps the list of each
 * department they were given, on that department's Documents.
 */
export default function PapersOwed() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const navigate = useNavigate();
  const me = useMe();
  const [params] = useSearchParams();
  if (!me) return null;
  if (!reachesEveryProject(me.role)) {
    return (
      <Card>
        <EmptyState icon={<Inbox size={18} />} title={`${PAPERS_OWED} is the firm’s own page`} description="The papers asked of you are on each department’s Documents." />
      </Card>
    );
  }
  return (
    <PapersOwedCard
      project={project}
      marked={params.get('line')}
      onChanged={setProject}
      onOpenDocument={(evidenceId) => navigate(cockpitPath(project.id, 'evidence', { evidenceId }))}
      onOpenCheck={(where) => navigate(cockpitPath(project.id, 'scope', where))}
    />
  );
}
