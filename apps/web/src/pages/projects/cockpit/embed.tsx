import { useOutletContext, useSearchParams } from 'react-router-dom';
import { GraphPane, OrchestratePane } from './panes';
import type { ProjectOutlet } from '../ProjectLayout';

export function CockpitGraph() {
  const { project } = useOutletContext<ProjectOutlet>();
  const [params, setParams] = useSearchParams();
  return (
    <div className="h-full min-h-0">
      <GraphPane
        project={project}
        focusId={params.get('node')}
        onSelect={(id) => {
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (id) next.set('node', id);
              else next.delete('node');
              return next;
            },
            { replace: true },
          );
        }}
      />
    </div>
  );
}

export function CockpitOrchestrate() {
  const { project, refresh } = useOutletContext<ProjectOutlet>();
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <OrchestratePane project={project} onChanged={refresh} />
    </div>
  );
}
