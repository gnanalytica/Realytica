import { useRef } from 'react';
import { useParams } from 'react-router-dom';
import type { DdProject, StageKey, WaitingCheckValue } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Callout, Skeleton } from '../../components/ui/kit';
import type { PhaseOpen } from '../../components/project/PhaseRecord';
import ProjectCockpit from './ProjectCockpit';

export interface ProjectOutlet {
  project: DdProject;
  refresh: () => Promise<void>;
  setProject: (next: DdProject) => void;
  /** The stage being looked at: the project's own, unless another was picked on the track. */
  stage?: StageKey;
  /** Open a record named in a stage's look-back. */
  onOpenFromStage?: PhaseOpen;
  /** Accept something waiting where it sits — as proposed, or as corrected in its form. */
  onAcceptWaiting?: (id: string, payload?: Record<string, unknown>) => void;
  onSetAsideWaiting?: (id: string) => void;
  /** A decision on the canvas is in flight. */
  waitingBusy?: boolean;
  /** Open a document on the desk, with the values waiting on it. Given the value a source chip stands for, at that value's page with its words marked. */
  onReviewDocument?: (evidenceId: string, value?: Pick<WaitingCheckValue, 'proposalId' | 'key' | 'page'>) => void;
  highlightIds?: string[];
  onOpenCited?: (id: string) => void;
}

export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, error, loading, refresh, setData } = useAsync(() => api.getProject(projectId as string), [projectId]);
  // The project the address names now, for whatever arrives late.
  const named = useRef(projectId);
  named.current = projectId;

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
      // One page for one project. Another project starts it afresh: the draft, the files staged, the chat being read and a reply on its way stay with the project they belong to.
      key={project.id}
      outlet={{
        project,
        refresh,
        // Only the project in the address is drawn. One read for a project the person has since left is dropped.
        setProject: (next) => {
          if (next.id === named.current) setData(next);
        },
      }}
    />
  );
}
